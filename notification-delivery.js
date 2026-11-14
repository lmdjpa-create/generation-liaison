const { applicationDefault, cert, getApps, initializeApp } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');
const webPush = require('web-push');
const twilio = require('twilio');
const { Resend } = require('resend');

const RETRY_DELAY_MS = 60 * 1000;
const MAX_RETRY_DELAY_MS = 60 * 60 * 1000;

let firebaseApp;
let twilioClient;
let resendClient;

function getFirebaseApp() {
  if (firebaseApp) return firebaseApp;

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const credential = serviceAccountJson
    ? cert(JSON.parse(serviceAccountJson))
    : applicationDefault();
  firebaseApp = getApps()[0] || initializeApp({ credential });
  return firebaseApp;
}

function getTwilioClient() {
  if (!twilioClient) {
    const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;
    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !process.env.TWILIO_FROM_NUMBER) {
      throw new Error('Configuration Twilio incomplète.');
    }
    twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  }
  return twilioClient;
}

function getResendClient() {
  if (!resendClient) {
    if (!process.env.RESEND_API_KEY || !process.env.NOTIFICATIONS_FROM_EMAIL) {
      throw new Error('Configuration Resend incomplète.');
    }
    resendClient = new Resend(process.env.RESEND_API_KEY);
  }
  return resendClient;
}

async function sendPasswordResetEmail(email, url) {
  const result = await getResendClient().emails.send({
    from: process.env.NOTIFICATIONS_FROM_EMAIL,
    to: email,
    subject: 'Réinitialisation de votre mot de passe Génération Liaison',
    text: `Pour choisir un nouveau mot de passe, ouvrez ce lien dans les 15 minutes :\n\n${url}\n\nSi vous n’avez pas demandé cette modification, ignorez cet e-mail.`
  });
  if (result.error) throw new Error(`Échec d’envoi e-mail Resend : ${result.error.message}`);
}

async function sendSeniorUnlinkCode(email, code) {
  const result = await getResendClient().emails.send({
    from: process.env.NOTIFICATIONS_FROM_EMAIL,
    to: email,
    subject: 'Confirmation du retrait d’un accès Génération Liaison',
    text: `Vous avez demandé le retrait de l’accès d’un aidant. Son accès est déjà suspendu.\n\nSaisissez ce code dans votre espace senior dans les 30 minutes :\n\n${code}\n\nSi vous n’avez pas demandé ce retrait, contactez l’administration.`
  });
  if (result.error) throw new Error(`Échec d’envoi e-mail Resend : ${result.error.message}`);
}

async function sendSeniorInvitation(email, appUrl) {
  const result = await getResendClient().emails.send({
    from: process.env.NOTIFICATIONS_FROM_EMAIL,
    to: email,
    subject: 'Invitation à découvrir Génération Liaison',
    text: `Un proche vous invite à découvrir Génération Liaison.\n\n` +
      `Vous pouvez ouvrir l’application en ligne ou trouver les indications pour la télécharger ici :\n${appUrl}\n\n` +
      `Si un proche demande accès à votre profil, vous restez libre d’accepter ou de refuser dans votre espace. ` +
      `Si vous ne souhaitez pas utiliser l’application, vous pouvez ignorer ce message.`
  });
  if (result.error) throw new Error(`Échec d’envoi e-mail Resend : ${result.error.message}`);
}

function configureWebPush() {
  const { WEB_PUSH_PUBLIC_KEY, WEB_PUSH_PRIVATE_KEY, WEB_PUSH_SUBJECT } = process.env;
  if (!WEB_PUSH_PUBLIC_KEY && !WEB_PUSH_PRIVATE_KEY && !WEB_PUSH_SUBJECT) return;
  if (!WEB_PUSH_PUBLIC_KEY || !WEB_PUSH_PRIVATE_KEY || !WEB_PUSH_SUBJECT) {
    throw new Error('Configuration Web Push incomplète.');
  }
  webPush.setVapidDetails(WEB_PUSH_SUBJECT, WEB_PUSH_PUBLIC_KEY, WEB_PUSH_PRIVATE_KEY);
}

function isConfigured() {
  const firebaseConfigured = Boolean(
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS
  );
  const webPushConfigured = Boolean(
    process.env.WEB_PUSH_PUBLIC_KEY && process.env.WEB_PUSH_PRIVATE_KEY && process.env.WEB_PUSH_SUBJECT
  );
  return {
    push: firebaseConfigured || webPushConfigured,
    nativePush: firebaseConfigured,
    webPush: webPushConfigured,
    sms: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER),
    email: Boolean(process.env.RESEND_API_KEY && process.env.NOTIFICATIONS_FROM_EMAIL)
  };
}

function publicConfiguration() {
  return {
    webPushPublicKey: process.env.WEB_PUSH_PUBLIC_KEY || null,
    channels: isConfigured()
  };
}

function safeMessage(title) {
  return `Génération Liaison : ${title}. Connectez-vous à l’application pour consulter les détails.`;
}

async function sendPush(delivery) {
  const subscriptions = delivery.subscriptions || [];
  if (!subscriptions.length) return false;

  const nativeTokens = subscriptions
    .filter(subscription => subscription.platform === 'android' || subscription.platform === 'ios')
    .map(subscription => subscription.token);
  const webSubscriptions = subscriptions
    .filter(subscription => subscription.platform === 'web')
    .map(subscription => ({ id: subscription.id, subscription: JSON.parse(subscription.token) }));

  if (nativeTokens.length) {
    const app = getFirebaseApp();
    const result = await getMessaging(app).sendEachForMulticast({
      tokens: nativeTokens,
      notification: { title: delivery.title, body: safeMessage(delivery.title) },
      data: {
        notificationId: delivery.notification_id,
        url: '/app-mobile.html'
      }
    });
    const invalidTokens = result.responses
      .map((response, index) => ({ response, token: nativeTokens[index] }))
      .filter(({ response }) => !response.success &&
        ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(response.error?.code))
      .map(({ token }) => token);
    if (invalidTokens.length) {
      await delivery.pool.query(
        'DELETE FROM app_push_subscriptions WHERE platform IN (\'android\', \'ios\') AND token = ANY($1)',
        [invalidTokens]
      );
    }
    if (result.failureCount) {
      throw new Error(`${result.failureCount} notification(s) push FCM non distribuée(s).`);
    }
  }

  if (webSubscriptions.length) {
    if (!process.env.WEB_PUSH_PUBLIC_KEY || !process.env.WEB_PUSH_PRIVATE_KEY || !process.env.WEB_PUSH_SUBJECT) {
      throw new Error('Configuration Web Push incomplète.');
    }
    configureWebPush();
    const payload = JSON.stringify({
      title: delivery.title,
      body: safeMessage(delivery.title),
      data: { notificationId: delivery.notification_id, url: '/app-mobile.html' }
    });
    const results = await Promise.allSettled(webSubscriptions.map(({ subscription }) =>
      webPush.sendNotification(subscription, payload)
    ));
    const expiredIds = webSubscriptions
      .filter((_, index) => {
        const result = results[index];
        return result.status === 'rejected' && [404, 410].includes(result.reason?.statusCode);
      })
      .map(({ id }) => id);
    if (expiredIds.length) {
      await delivery.pool.query('DELETE FROM app_push_subscriptions WHERE id = ANY($1::uuid[])', [expiredIds]);
    }
    if (results.some(result => result.status === 'rejected' && ![404, 410].includes(result.reason?.statusCode))) {
      throw new Error('Une ou plusieurs notifications Web Push n’ont pas été distribuées.');
    }
  }

  return true;
}

async function deliver(delivery) {
  if (delivery.channel === 'push') {
    return sendPush(delivery);
  }
  if (delivery.channel === 'sms') {
    if (!delivery.sms_enabled || !delivery.phone) return false;
    const client = getTwilioClient();
    await client.messages.create({
      body: safeMessage(delivery.title),
      from: process.env.TWILIO_FROM_NUMBER,
      to: delivery.phone
    });
    return true;
  }
  if (delivery.channel === 'email') {
    if (!delivery.email_enabled || !delivery.email) return false;
    const client = getResendClient();
    const result = await client.emails.send({
      from: process.env.NOTIFICATIONS_FROM_EMAIL,
      to: delivery.email,
      subject: delivery.title,
      text: safeMessage(delivery.title),
      html: `<p>${safeMessage(delivery.title)}</p><p><a href="${process.env.PUBLIC_APP_URL || 'https://generation-liaison.onrender.com'}/app-mobile.html">Ouvrir Génération Liaison</a></p>`
    });
    if (result.error) throw new Error(`Échec d’envoi e-mail Resend : ${result.error.message}`);
    return true;
  }
  throw new Error(`Canal de notification inconnu : ${delivery.channel}`);
}

function retryDelay(attempts) {
  return Math.min(RETRY_DELAY_MS * (2 ** Math.max(0, attempts - 1)), MAX_RETRY_DELAY_MS);
}

async function claimDelivery(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT delivery.id, delivery.notification_id, delivery.user_id,
              delivery.channel, delivery.attempts, notification.title,
              account.email, account.notification_phone, account.email_notifications_enabled,
              account.sms_notifications_enabled
       FROM app_notification_deliveries delivery
       JOIN app_notifications notification ON notification.id = delivery.notification_id
       JOIN app_users account ON account.id = delivery.user_id
       WHERE (delivery.status = 'queued'
              AND delivery.next_attempt_at <= CURRENT_TIMESTAMP)
          OR (delivery.status = 'processing'
              AND delivery.updated_at < CURRENT_TIMESTAMP - INTERVAL '10 minutes')
       ORDER BY delivery.created_at
       LIMIT 1
       FOR UPDATE OF delivery SKIP LOCKED
       `
    );
    const row = rows[0];
    if (!row) {
      await client.query('COMMIT');
      return null;
    }
    await client.query(
      `UPDATE app_notification_deliveries
       SET status = 'processing', attempts = attempts + 1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [row.id]
    );
    await client.query('COMMIT');

    const subscriptions = row.channel === 'push'
      ? (await pool.query(
        `SELECT id, platform, token
         FROM app_push_subscriptions
         WHERE user_id = $1`,
        [row.user_id]
      )).rows
      : [];
    return {
      ...row,
      attempts: row.attempts + 1,
      email_enabled: row.email_notifications_enabled,
      sms_enabled: row.sms_notifications_enabled,
      phone: row.notification_phone,
      subscriptions,
      pool
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function processNextDelivery(pool) {
  const delivery = await claimDelivery(pool);
  if (!delivery) return false;
  try {
    const sent = await deliver(delivery);
    await pool.query(
      `UPDATE app_notification_deliveries
       SET status = $2, last_error = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [delivery.id, sent ? 'sent' : 'skipped']
    );
  } catch (error) {
    console.error(`Échec d’envoi ${delivery.channel} pour ${delivery.notification_id} :`, error);
    await pool.query(
      `UPDATE app_notification_deliveries
       SET status = 'queued', last_error = $2,
           updated_at = CURRENT_TIMESTAMP,
           next_attempt_at = CURRENT_TIMESTAMP + ($3 * INTERVAL '1 millisecond')
       WHERE id = $1`,
      [delivery.id, String(error.message || error).slice(0, 500), retryDelay(delivery.attempts)]
    );
  }
  return true;
}

function startDeliveryWorker(pool) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      for (let count = 0; count < 25; count += 1) {
        if (!await processNextDelivery(pool)) break;
      }
    } catch (error) {
      console.error('Erreur du service de notifications :', error);
    } finally {
      running = false;
    }
  }, 5000);
  timer.unref();
  return timer;
}

module.exports = {
  isConfigured,
  publicConfiguration,
  sendPasswordResetEmail,
  sendSeniorUnlinkCode,
  sendSeniorInvitation,
  startDeliveryWorker
};
