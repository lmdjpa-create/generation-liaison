const express = require('express');
const cors = require('cors');
const path = require('path');
const { createHash, randomBytes, randomUUID, timingSafeEqual } = require('node:crypto');
const { Pool } = require('pg');
const { AuthError, createAuthService, TERMS_VERSION } = require('./auth');
const { reviewAccountClosure } = require('./account-closure-review');
const { getServiceDistance } = require('./distance');
const notificationDelivery = require('./notification-delivery');
const { isAllowedWebPushSubscription } = require('./push-subscriptions');
const googleCalendar = require('./google-calendar');
const { generateReply, generateWellbeingAssessment } = require('./ai-assistant');
const {
  availableSlots,
  dateInTimeZone,
  getDailyRange,
  isValidIsoDate,
  isValidTimeZone,
  normalizeWeeklyAvailability
} = require('./directory');

require('dotenv').config();

const app = express();
const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : null;
const authService = createAuthService(pool);
const coordinatorEmails = new Set(
  (process.env.PLANNING_COORDINATOR_EMAILS || '')
    .split(',')
    .map(email => email.trim().toLowerCase())
    .filter(Boolean)
);
const adminEmails = new Set(
  (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map(email => email.trim().toLowerCase())
    .filter(Boolean)
);
const adminAccessCode = process.env.ADMIN_ACCESS_CODE || '';
const adminAccessCodeHash = adminAccessCode.length >= 32
  ? createHash('sha256').update(adminAccessCode).digest()
  : null;
const assistantMessageTimes = new Map();
const seniorLinkRequestTimes = new Map();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'dist')));

function sendApiError(res, error, fallbackMessage) {
  if (error instanceof AuthError) {
    return res.status(error.status).json({ error: error.message });
  }

  console.error(error);
  return res.status(500).json({ error: fallbackMessage });
}

function canAccessAccountSettings(req) {
  return (req.method === 'GET' && req.path === '/api/notifications/config') ||
    (['GET', 'PUT'].includes(req.method) && req.path === '/api/notifications/preferences') ||
    (['POST', 'DELETE'].includes(req.method) && req.path === '/api/notifications/push-subscriptions') ||
    (req.method === 'POST' && req.path === '/api/account/closure-request');
}

function canPendingProfessionalAccess(req) {
  return req.path === '/api/auth/me' ||
    req.path === '/api/auth/logout' ||
    req.path === '/api/notifications' ||
    canAccessAccountSettings(req) ||
    req.path.startsWith('/api/professional-verification/documents');
}

function matchesDocumentSignature(buffer, contentType) {
  if (!Buffer.isBuffer(buffer)) return false;
  if (contentType === 'application/pdf') return buffer.subarray(0, 5).toString() === '%PDF-';
  if (contentType === 'image/jpeg') return buffer.length >= 3 &&
    buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (contentType === 'image/png') {
    return buffer.length >= 8 &&
      buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  return false;
}

function hashOAuthState(state) {
  return createHash('sha256').update(state).digest('hex');
}

function isValidUuid(value) {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function hasValidCoordinates(latitude, longitude) {
  return typeof latitude === 'number' && Number.isFinite(latitude) &&
    latitude >= -90 && latitude <= 90 &&
    typeof longitude === 'number' && Number.isFinite(longitude) &&
    longitude >= -180 && longitude <= 180;
}

async function getCalendarAccessToken(encryptedRefreshToken) {
  return googleCalendar.getAccessToken(googleCalendar.decryptRefreshToken(encryptedRefreshToken));
}

async function getProfessionalBusyIntervals(client, professionalId, start, end, accessToken) {
  const { rows } = await client.query(
    `SELECT scheduled_at AS start_at,
            scheduled_at + duration_minutes * INTERVAL '1 minute' AS end_at
     FROM app_directory_bookings
     WHERE professional_user_id = $1
       AND (status = 'confirmed' OR (status = 'pending' AND hold_expires_at > CURRENT_TIMESTAMP))
       AND scheduled_at < $3
       AND scheduled_at + duration_minutes * INTERVAL '1 minute' > $2
     UNION ALL
     SELECT scheduled_at,
            scheduled_at + duration_minutes * INTERVAL '1 minute'
     FROM planning_visits
     WHERE assigned_user_id = $1 AND status = 'scheduled'
       AND acceptance_status = 'accepted'
       AND scheduled_at < $3
       AND scheduled_at + duration_minutes * INTERVAL '1 minute' > $2
     UNION ALL
     SELECT booking.requested_at,
            booking.requested_at + INTERVAL '60 minutes'
     FROM planning_service_bookings booking
     JOIN planning_service_partners partner ON partner.id = booking.partner_id
     WHERE partner.user_id = $1 AND booking.status IN ('requested', 'confirmed')
       AND booking.requested_at < $3
       AND booking.requested_at + INTERVAL '60 minutes' > $2`,
    [professionalId, start, end]
  );
  const externalBusy = await googleCalendar.getBusyIntervals(accessToken, start, end);
  return [
    ...externalBusy,
    ...rows.map(row => ({ start: new Date(row.start_at), end: new Date(row.end_at) }))
  ];
}

function redirectCalendarResult(res, status) {
  const appUrl = process.env.PUBLIC_APP_URL || 'https://generation-liaison.onrender.com';
  const target = new URL('/app-mobile.html', appUrl);
  target.searchParams.set('calendar', status);
  return res.redirect(target.toString());
}

function canPendingLegalGuardianAccess(req) {
  return (['/api/auth/me', '/api/auth/logout'].includes(req.path)) ||
    canAccessAccountSettings(req) ||
    (req.method === 'GET' && req.path === '/api/legal-guardian/documents') ||
    (req.method === 'PUT' && /^\/api\/legal-guardian\/documents\/(identity|guardianship)$/.test(req.path));
}

function requireAuth(req, res, next) {
  const authorization = req.get('authorization') || '';
  const match = authorization.match(/^Bearer ([a-f0-9]{64})$/i);
  if (!match) {
    return res.status(401).json({ error: 'Veuillez vous connecter pour continuer.' });
  }

  authService.authenticate(match[1])
    .then(user => {
      if (!user) {
        return res.status(401).json({ error: 'Votre session a expiré. Reconnectez-vous.' });
      }

      req.authUser = {
        ...user,
        isCoordinator: user.role === 'pro' && coordinatorEmails.has(user.email.toLowerCase()),
        isAdmin: adminEmails.has(user.email.toLowerCase())
      };
      req.authToken = match[1];
      if (user.role === 'aidant' && user.isLegalGuardian &&
          user.guardianVerificationStatus !== 'approved' && !canPendingLegalGuardianAccess(req)) {
        return res.status(403).json({
          error: user.guardianVerificationStatus === 'rejected'
            ? 'Votre justificatif de tutelle doit être complété avant l’accès aux profils.'
            : 'Votre tutelle doit être vérifiée par l’administration avant l’accès aux profils.'
        });
      }
      if (user.role === 'pro' && user.verificationStatus !== 'approved' && !canPendingProfessionalAccess(req)) {
        return res.status(403).json({
          error: user.verificationStatus === 'rejected'
            ? 'Votre dossier doit être complété avant l’accès à l’espace intervenant.'
            : 'Votre dossier est en cours de vérification. L’accès intervenant sera ouvert après validation.'
        });
      }
      if (user.role !== 'aidant') return next();
      const selectedSeniorId = req.get('x-senior-profile-id');
      if (!selectedSeniorId) {
        req.authUser.seniorId = null;
        return next();
      }
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(selectedSeniorId)) {
        return res.status(400).json({ error: 'Profil senior sélectionné invalide.' });
      }
      pool.query(
        `SELECT link.senior_profile_id
         FROM app_aidant_senior_links link
         JOIN app_users senior ON senior.senior_id = link.senior_profile_id
         WHERE link.aidant_user_id = $1
           AND link.senior_profile_id = $2
           AND link.suspended_at IS NULL
           AND senior.role = 'senior'
           AND senior.is_active = TRUE`,
        [user.id, selectedSeniorId]
      ).then(({ rows }) => {
        if (!rows[0]) {
          return res.status(403).json({ error: 'Ce profil senior n’est pas associé à votre compte.' });
        }
        req.authUser.seniorId = rows[0].senior_profile_id;
        return next();
      }).catch(error => sendApiError(res, error, 'Impossible de vérifier l’accès au profil senior.'));
    })
    .catch(error => sendApiError(res, error, 'Impossible de vérifier la session.'));
}

function requireAidantSeniorContext(req, res, next) {
  if (req.authUser.role === 'aidant' && !req.authUser.seniorId) {
    return res.status(409).json({ error: 'Aucun senior associé ou sélectionné pour cette action.' });
  }
  return next();
}

function addUserAccessFlags(user) {
  return {
    ...user,
    isCoordinator: user.role === 'pro' && coordinatorEmails.has(user.email.toLowerCase()),
    isAdmin: adminEmails.has(user.email.toLowerCase())
  };
}

function requireAdmin(req, res, next) {
  if (!req.authUser.isAdmin) {
    return res.status(403).json({ error: 'Cette page est réservée aux administrateurs autorisés.' });
  }
  if (!adminAccessCodeHash) {
    return res.status(503).json({ error: 'Le code de sécurité administrateur n’est pas configuré.' });
  }
  const providedCode = req.get('x-admin-access-code') || '';
  const providedHash = createHash('sha256').update(providedCode).digest();
  if (!timingSafeEqual(adminAccessCodeHash, providedHash)) {
    return res.status(403).json({ error: 'Code de sécurité administrateur incorrect.' });
  }
  return next();
}

function validateAssistantMessage(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 1200) {
    return null;
  }
  return value.trim();
}

app.post('/api/emergency-alert', requireAuth, async (req, res) => {
  if (req.authUser.role !== 'senior') {
    return res.status(403).json({ error: 'Cette alerte est réservée au compte senior.' });
  }
  const { number, confirmationMethod, confirmed, voiceConfirmationPhrase } = req.body || {};
  if (!['15', '112'].includes(number)) {
    return res.status(400).json({ error: 'Choisissez le 15 ou le 112.' });
  }
  if (confirmationMethod === 'click' && confirmed !== true) {
    return res.status(400).json({ error: 'Confirmez une deuxième fois avant de continuer.' });
  }
  if (confirmationMethod === 'voice' &&
      voiceConfirmationPhrase !== 'Je confirme l’appel d’urgence') {
    return res.status(400).json({ error: 'La confirmation vocale n’a pas été reconnue.' });
  }
  if (!['click', 'voice'].includes(confirmationMethod)) {
    return res.status(400).json({ error: 'Confirmez l’action par un bouton ou par la phrase demandée.' });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const { rows: aidants } = await client.query(
      `SELECT contact.contact_user_id
       FROM app_user_contacts contact
       JOIN app_users aidant ON aidant.id = contact.contact_user_id
       WHERE contact.user_id = $1
         AND aidant.role = 'aidant'
         AND aidant.is_active = TRUE
       FOR SHARE OF contact, aidant`,
      [req.authUser.id]
    );
    const alertId = randomUUID();
    const time = new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
    const seniorName = (req.authUser.name || req.authUser.seniorName || 'Le senior')
      .trim().split(/\s+/)[0];
    for (const aidant of aidants) {
      await insertAppNotification(
        client,
        aidant.contact_user_id,
        'emergency_alert',
        `Alerte d’urgence : appel au ${number} demandé`,
        `${seniorName} a confirmé une demande d’appel au ${number} à ${time}. L’application ne peut pas vérifier que l’appel a été passé ou abouti.`,
        'emergency_alert',
        alertId
      );
    }
    await client.query('COMMIT');
    res.set('Cache-Control', 'private, no-store');
    res.status(201).json({ notificationsQueued: aidants.length });
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    sendApiError(res, error, 'Impossible de préparer les notifications aux aidants.');
  } finally {
    client?.release();
  }
});

app.get('/api/wellbeing/check-in', requireAuth, async (req, res) => {
  if (req.authUser.role !== 'senior') {
    return res.status(403).json({ error: 'Le check-in de bien-être est réservé au compte senior.' });
  }
  try {
    const today = dateInTimeZone(new Date(), 'Europe/Paris');
    const { rows } = await pool.query(
      `SELECT id, response, assistant_reply, safety_concern, safety_check_status,
              safety_notified_aidants, emergency_number, created_at, expires_at
       FROM app_wellbeing_checkins
       WHERE user_id = $1 AND checkin_date = $2::date
         AND expires_at > CURRENT_TIMESTAMP`,
      [req.authUser.id, today]
    );
    res.set('Cache-Control', 'private, no-store');
    res.json({
      checkin: rows[0] ? {
        id: rows[0].id,
        response: rows[0].response,
        assistantReply: rows[0].assistant_reply,
        safetyConcern: rows[0].safety_concern,
        safetyCheckStatus: rows[0].safety_check_status,
        safetyNotifiedAidants: rows[0].safety_notified_aidants,
        emergencyNumber: rows[0].emergency_number,
        createdAt: rows[0].created_at,
        expiresAt: rows[0].expires_at
      } : null
    });
  } catch (error) {
    sendApiError(res, error, 'Impossible de charger votre check-in de bien-être.');
  }
});

app.post('/api/wellbeing/check-in', requireAuth, async (req, res) => {
  if (req.authUser.role !== 'senior') {
    return res.status(403).json({ error: 'Le check-in de bien-être est réservé au compte senior.' });
  }
  const response = validateAssistantMessage(req.body?.message);
  if (!response) {
    return res.status(400).json({ error: 'Écrivez une réponse de 1 à 1 200 caractères.' });
  }

  const recipientUserIds = req.body?.recipientUserIds;
  if (!Array.isArray(recipientUserIds) || recipientUserIds.length > 10 ||
      recipientUserIds.some(id => !isValidUuid(id)) ||
      new Set(recipientUserIds).size !== recipientUserIds.length) {
    return res.status(400).json({ error: 'Vérifiez les aidants sélectionnés.' });
  }
  if (recipientUserIds.length && req.body?.shareConfirmed !== true) {
    return res.status(400).json({ error: 'Confirmez le partage avec les aidants sélectionnés.' });
  }
  if (!recipientUserIds.length && req.body?.shareConfirmed === true) {
    return res.status(400).json({ error: 'Sélectionnez au moins un aidant avant de confirmer le partage.' });
  }

  const checkinDate = dateInTimeZone(new Date(), 'Europe/Paris');
  let client;
  try {
    const { rows: existing } = await pool.query(
      `SELECT id FROM app_wellbeing_checkins
       WHERE user_id = $1 AND checkin_date = $2::date
         AND expires_at > CURRENT_TIMESTAMP`,
      [req.authUser.id, checkinDate]
    );
    if (existing[0]) {
      return res.status(409).json({ error: 'Votre check-in du jour est déjà enregistré.' });
    }

    if (recipientUserIds.length) {
      const { rows: contacts } = await pool.query(
        `SELECT contact.contact_user_id
         FROM app_user_contacts contact
         JOIN app_users aidant ON aidant.id = contact.contact_user_id
         WHERE contact.user_id = $1
           AND contact.contact_user_id = ANY($2::uuid[])
           AND aidant.role = 'aidant'
           AND aidant.is_active = TRUE`,
        [req.authUser.id, recipientUserIds]
      );
      if (contacts.length !== recipientUserIds.length) {
        return res.status(400).json({ error: 'Un aidant sélectionné n’est plus un contact actif autorisé.' });
      }
    }

    const { rows: settings } = await pool.query('SELECT enabled FROM app_ai_settings WHERE id = 1');
    if (settings[0]?.enabled !== true) {
      return res.status(503).json({ error: 'La réponse IA de bien-être est actuellement désactivée par l’équipe.' });
    }
    const assessment = await generateWellbeingAssessment({
      message: response,
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL || 'gpt-4.1-mini'
    });
    const safetyCheckStatus = assessment.safetyConcern ? 'awaiting_response' : 'not_needed';

    client = await pool.connect();
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM app_notifications
       WHERE entity_type = 'wellbeing_checkin'
         AND entity_id IN (
           SELECT id
           FROM app_wellbeing_checkins
           WHERE user_id = $1 AND checkin_date = $2::date
             AND expires_at <= CURRENT_TIMESTAMP
         )`,
      [req.authUser.id, checkinDate]
    );
    await client.query(
      `DELETE FROM app_wellbeing_checkins
       WHERE user_id = $1 AND checkin_date = $2::date
         AND expires_at <= CURRENT_TIMESTAMP`,
      [req.authUser.id, checkinDate]
    );
    const checkinId = randomUUID();
    const { rows } = await client.query(
      `INSERT INTO app_wellbeing_checkins
         (id, user_id, checkin_date, response, assistant_reply,
          safety_concern, safety_check_status)
       VALUES ($1, $2, $3::date, $4, $5, $6, $7)
       ON CONFLICT (user_id, checkin_date) DO NOTHING
       RETURNING id, response, assistant_reply, safety_concern,
                 safety_check_status, safety_notified_aidants,
                 emergency_number, created_at, expires_at`,
      [
        checkinId,
        req.authUser.id,
        checkinDate,
        response,
        assessment.reply,
        assessment.safetyConcern,
        safetyCheckStatus
      ]
    );
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Votre check-in du jour est déjà enregistré.' });
    }

    if (recipientUserIds.length) {
      const { rows: shares } = await client.query(
        `INSERT INTO app_wellbeing_checkin_shares
           (checkin_id, recipient_user_id, consented_at)
         SELECT $1, contact.contact_user_id, CURRENT_TIMESTAMP
         FROM app_user_contacts contact
         JOIN app_users aidant ON aidant.id = contact.contact_user_id
         WHERE contact.user_id = $2
           AND contact.contact_user_id = ANY($3::uuid[])
           AND aidant.role = 'aidant'
           AND aidant.is_active = TRUE
         RETURNING recipient_user_id`,
        [checkinId, req.authUser.id, recipientUserIds]
      );
      if (shares.length !== recipientUserIds.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'La liste des aidants a changé. Rechargez-la puis réessayez.' });
      }
      for (const share of shares) {
        await insertAppNotification(
          client,
          share.recipient_user_id,
          'wellbeing_checkin',
          'Nouveau check-in de bien-être',
          'Un nouveau message est disponible dans l’application.',
          'wellbeing_checkin',
          checkinId
        );
      }
    }

    await client.query('COMMIT');
    res.set('Cache-Control', 'private, no-store');
    res.status(201).json({
      checkin: {
        id: rows[0].id,
        response: rows[0].response,
        assistantReply: rows[0].assistant_reply,
        safetyConcern: rows[0].safety_concern,
        safetyCheckStatus: rows[0].safety_check_status,
        safetyNotifiedAidants: rows[0].safety_notified_aidants,
        emergencyNumber: rows[0].emergency_number,
        createdAt: rows[0].created_at,
        expiresAt: rows[0].expires_at
      },
      sharedWithCount: recipientUserIds.length
    });
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    if (error.status) return res.status(error.status).json({ error: error.message });
    sendApiError(res, error, 'Impossible d’enregistrer votre check-in de bien-être.');
  } finally {
    client?.release();
  }
});

app.post('/api/wellbeing/check-in/:checkinId/safety-response', requireAuth, async (req, res) => {
  if (req.authUser.role !== 'senior') {
    return res.status(403).json({ error: 'Cette vérification est réservée au compte senior.' });
  }
  if (!isValidUuid(req.params.checkinId) ||
      !['safe', 'needs_help', 'no_response'].includes(req.body?.response)) {
    return res.status(400).json({ error: 'La réponse de sécurité est invalide.' });
  }

  const { response } = req.body;
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id, safety_check_status
       FROM app_wellbeing_checkins
       WHERE id = $1 AND user_id = $2 AND safety_concern = TRUE
         AND expires_at > CURRENT_TIMESTAMP
       FOR UPDATE`,
      [req.params.checkinId, req.authUser.id]
    );
    const checkin = rows[0];
    if (!checkin) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Vérification de sécurité introuvable.' });
    }
    if (checkin.safety_check_status !== 'awaiting_response') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Cette vérification de sécurité a déjà été traitée.' });
    }

    let notifiedAidants = 0;
    if (response === 'no_response') {
      notifiedAidants = await notifyEmergencyAidants(client, req.authUser, {
        type: 'wellbeing_safety_check',
        title: 'Vérification de sécurité sans réponse',
        message: 'Le senior n’a pas répondu à la question de sécurité après son check-in. Veuillez essayer de le joindre. L’application n’a pas appelé les secours et ne peut pas vérifier son état.',
        checkinId: checkin.id
      });
    }
    await client.query(
      `UPDATE app_wellbeing_checkins
       SET safety_check_status = $2,
           safety_notified_aidants = $3
       WHERE id = $1`,
      [checkin.id, response, notifiedAidants]
    );
    await client.query('COMMIT');
    res.set('Cache-Control', 'private, no-store');
    res.json({ safetyCheckStatus: response, notifiedAidants });
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    sendApiError(res, error, 'Impossible d’enregistrer la réponse de sécurité.');
  } finally {
    client?.release();
  }
});

app.post('/api/wellbeing/check-in/:checkinId/emergency-alert', requireAuth, async (req, res) => {
  if (req.authUser.role !== 'senior') {
    return res.status(403).json({ error: 'Cette alerte est réservée au compte senior.' });
  }
  if (!isValidUuid(req.params.checkinId) || !['18', '112'].includes(req.body?.number)) {
    return res.status(400).json({ error: 'Choisissez le 18 ou le 112.' });
  }
  const { number, confirmationMethod, confirmed, voiceConfirmationPhrase } = req.body;
  if (confirmationMethod === 'click' && confirmed !== true) {
    return res.status(400).json({ error: 'Confirmez une deuxième fois avant de continuer.' });
  }
  if (confirmationMethod === 'voice' &&
      voiceConfirmationPhrase !== 'Je confirme l’appel d’urgence') {
    return res.status(400).json({ error: 'La confirmation vocale n’a pas été reconnue.' });
  }
  if (!['click', 'voice'].includes(confirmationMethod)) {
    return res.status(400).json({ error: 'Confirmez l’action par un bouton ou par la phrase demandée.' });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id, safety_check_status
       FROM app_wellbeing_checkins
       WHERE id = $1 AND user_id = $2 AND safety_concern = TRUE
         AND expires_at > CURRENT_TIMESTAMP
       FOR UPDATE`,
      [req.params.checkinId, req.authUser.id]
    );
    const checkin = rows[0];
    if (!checkin || checkin.safety_check_status !== 'needs_help') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Confirmez d’abord que vous avez besoin d’aide.' });
    }

    const time = new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
    const seniorName = (req.authUser.name || req.authUser.seniorName || 'Le senior')
      .trim().split(/\s+/)[0];
    const notifiedAidants = await notifyEmergencyAidants(client, req.authUser, {
      type: 'emergency_alert',
      title: `Alerte d’urgence : appel au ${number} demandé`,
      message: `${seniorName} a confirmé une demande d’appel au ${number} à ${time}. L’application ne peut pas vérifier que l’appel a été passé ou abouti.`,
      checkinId: checkin.id
    });
    await client.query(
      `UPDATE app_wellbeing_checkins
       SET safety_check_status = 'emergency_confirmed',
           emergency_number = $2,
           safety_notified_aidants = $3
       WHERE id = $1`,
      [checkin.id, number, notifiedAidants]
    );
    await client.query('COMMIT');
    res.set('Cache-Control', 'private, no-store');
    res.status(201).json({ notificationsQueued: notifiedAidants });
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    sendApiError(res, error, 'Impossible de préparer les notifications aux aidants.');
  } finally {
    client?.release();
  }
});

app.get('/api/wellbeing/shared-check-ins', requireAuth, requireAidantSeniorContext, async (req, res) => {
  if (req.authUser.role !== 'aidant') {
    return res.status(403).json({ error: 'Ces check-ins partagés sont réservés au compte aidant.' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT checkin.id, checkin.response, checkin.created_at,
              owner.name AS senior_name
       FROM app_wellbeing_checkins checkin
       LEFT JOIN app_wellbeing_checkin_shares share
         ON share.checkin_id = checkin.id AND share.recipient_user_id = $1
       JOIN app_users owner ON owner.id = checkin.user_id
       WHERE owner.senior_id = $2
         AND checkin.expires_at > CURRENT_TIMESTAMP
         AND owner.is_active = TRUE
         AND (
           (share.checkin_id IS NOT NULL AND EXISTS (
             SELECT 1
             FROM app_user_contacts contact
             WHERE contact.user_id = owner.id
               AND contact.contact_user_id = $1
           ))
           OR EXISTS (
             SELECT 1
             FROM app_aidant_senior_links link
             JOIN app_users guardian ON guardian.id = link.aidant_user_id
             WHERE link.aidant_user_id = $1
               AND link.senior_profile_id = owner.senior_id
               AND link.suspended_at IS NULL
               AND guardian.is_legal_guardian = TRUE
               AND guardian.guardian_verification_status = 'approved'
           )
         )
       ORDER BY checkin.created_at DESC
       LIMIT 30`,
      [req.authUser.id, req.authUser.seniorId]
    );
    res.set('Cache-Control', 'private, no-store');
    res.json({
      checkins: rows.map(row => ({
        id: row.id,
        seniorName: row.senior_name,
        response: row.response,
        createdAt: row.created_at
      }))
    });
  } catch (error) {
    sendApiError(res, error, 'Impossible de charger les check-ins partagés.');
  }
});

function limitAssistantMessages(userId) {
  const now = Date.now();
  const recent = (assistantMessageTimes.get(userId) || []).filter(time => now - time < 60_000);
  if (recent.length >= 8) {
    assistantMessageTimes.set(userId, recent);
    return false;
  }
  recent.push(now);
  assistantMessageTimes.set(userId, recent);
  return true;
}

app.get('/api/assistant/conversation', requireAuth, async (req, res) => {
  if (req.authUser.role !== 'senior') {
    return res.status(403).json({ error: 'Cette conversation est réservée au compte senior.' });
  }
  try {
    await pool.query(`DELETE FROM app_ai_conversations WHERE expires_at <= CURRENT_TIMESTAMP`);
    const [{ rows }, settings] = await Promise.all([
      pool.query(
        `SELECT conversation.id, conversation.status, conversation.expires_at,
                message.role, message.content, message.created_at
         FROM app_ai_conversations conversation
         LEFT JOIN LATERAL (
           SELECT role, content, created_at
           FROM app_ai_messages
           WHERE conversation_id = conversation.id
           ORDER BY created_at DESC
           LIMIT 100
         ) message ON TRUE
         WHERE conversation.user_id = $1 AND conversation.expires_at > CURRENT_TIMESTAMP
         ORDER BY message.created_at ASC`,
        [req.authUser.id]
      ),
      pool.query(`SELECT enabled FROM app_ai_settings WHERE id = 1`)
    ]);
    const conversation = rows[0];
    res.json({
      assistantEnabled: settings.rows[0]?.enabled === true,
      assistantConfigured: Boolean(process.env.OPENAI_API_KEY),
      status: conversation?.status || null,
      expiresAt: conversation?.expires_at || null,
      messages: rows.filter(row => row.role).map(row => ({
        role: row.role === 'admin' ? 'team' : row.role,
        content: row.content,
        createdAt: row.created_at
      }))
    });
  } catch (error) {
    sendApiError(res, error, 'Impossible de charger la conversation.');
  }
});

app.post('/api/assistant/message', requireAuth, async (req, res) => {
  if (req.authUser.role !== 'senior') {
    return res.status(403).json({ error: 'Cette conversation est réservée au compte senior.' });
  }
  const content = validateAssistantMessage(req.body?.message);
  if (!content) {
    return res.status(400).json({ error: 'Écrivez un message de 1 à 1 200 caractères.' });
  }
  if (!limitAssistantMessages(req.authUser.id)) {
    return res.status(429).json({ error: 'Vous avez envoyé plusieurs messages. Réessayez dans une minute.' });
  }

  let client;
  try {
    const { rows: settings } = await pool.query(`SELECT enabled FROM app_ai_settings WHERE id = 1`);
    if (settings[0]?.enabled !== true) {
      return res.status(503).json({ error: 'L’assistant IA est actuellement désactivé par l’équipe.' });
    }
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query(`DELETE FROM app_ai_conversations WHERE expires_at <= CURRENT_TIMESTAMP`);
    await client.query(
      `INSERT INTO app_ai_conversations (id, user_id, expires_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP + INTERVAL '30 days')
       ON CONFLICT (user_id) DO NOTHING`,
      [randomUUID(), req.authUser.id]
    );
    const { rows } = await client.query(
      `SELECT id, status FROM app_ai_conversations WHERE user_id = $1 FOR UPDATE`,
      [req.authUser.id]
    );
    const conversation = rows[0];
    if (conversation.status === 'human_requested') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Votre demande a été transmise à l’équipe. Vous pouvez lui répondre dans cette conversation.' });
    }

    const historyResult = await client.query(
      `SELECT role, content FROM app_ai_messages
       WHERE conversation_id = $1
       ORDER BY created_at DESC LIMIT 10`,
      [conversation.id]
    );
    const messages = historyResult.rows.reverse().map(row => ({
      role: row.role === 'user' ? 'user' : 'assistant',
      content: row.content
    }));
    messages.push({ role: 'user', content });

    const reply = await generateReply({
      name: (req.authUser.seniorName || req.authUser.name).trim().split(/\s+/)[0],
      messages,
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL || 'gpt-4.1-mini'
    });

    await client.query(
      `INSERT INTO app_ai_messages (conversation_id, role, content)
       VALUES ($1, 'user', $2), ($1, 'assistant', $3)`,
      [conversation.id, content, reply]
    );
    await client.query(
      `UPDATE app_ai_conversations
       SET expires_at = CURRENT_TIMESTAMP + INTERVAL '30 days',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [conversation.id]
    );
    await client.query('COMMIT');
    res.json({ reply, expiresInDays: 30 });
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    if (error.status) return res.status(error.status).json({ error: error.message });
    sendApiError(res, error, 'Impossible d’envoyer votre message.');
  } finally {
    client?.release();
  }
});

app.post('/api/assistant/handoff', requireAuth, async (req, res) => {
  if (req.authUser.role !== 'senior') {
    return res.status(403).json({ error: 'Cette conversation est réservée au compte senior.' });
  }
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query(`DELETE FROM app_ai_conversations WHERE expires_at <= CURRENT_TIMESTAMP`);
    const { rows } = await client.query(
      `INSERT INTO app_ai_conversations
         (id, user_id, status, human_requested_at, expires_at)
       VALUES ($1, $2, 'human_requested', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '30 days')
       ON CONFLICT (user_id) DO UPDATE
       SET status = 'human_requested',
           human_requested_at = CURRENT_TIMESTAMP,
           expires_at = CURRENT_TIMESTAMP + INTERVAL '30 days',
           updated_at = CURRENT_TIMESTAMP
       WHERE app_ai_conversations.status <> 'human_requested'
       RETURNING id`,
      [randomUUID(), req.authUser.id]
    );
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Votre demande a déjà été transmise à l’équipe.' });
    }
    await client.query(
      `INSERT INTO app_ai_messages (conversation_id, role, content)
       VALUES ($1, 'user', 'Je souhaite parler à une personne de l’équipe.')`,
      [rows[0].id]
    );
    await client.query('COMMIT');
    res.json({ status: 'human_requested' });
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    sendApiError(res, error, 'Impossible de transmettre votre demande à l’équipe.');
  } finally {
    client?.release();
  }
});

app.get('/api/admin/assistant/settings', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT enabled FROM app_ai_settings WHERE id = 1`);
    res.json({
      enabled: rows[0]?.enabled === true,
      configured: Boolean(process.env.OPENAI_API_KEY)
    });
  } catch (error) {
    sendApiError(res, error, 'Impossible de charger le réglage de l’assistant.');
  }
});

app.patch('/api/admin/assistant/settings', requireAuth, requireAdmin, async (req, res) => {
  if (typeof req.body?.enabled !== 'boolean') {
    return res.status(400).json({ error: 'Indiquez si l’assistant doit être activé ou désactivé.' });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE app_ai_settings
       SET enabled = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = 1
       RETURNING enabled`,
      [req.body.enabled]
    );
    res.json({ enabled: rows[0].enabled });
  } catch (error) {
    sendApiError(res, error, 'Impossible de modifier le réglage de l’assistant.');
  }
});

app.get('/api/admin/assistant/handoffs', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query(`DELETE FROM app_ai_conversations WHERE expires_at <= CURRENT_TIMESTAMP`);
    const { rows } = await pool.query(
      `SELECT conversation.id, account.name, conversation.updated_at,
              message.role, message.content, message.created_at
       FROM app_ai_conversations conversation
       JOIN app_users account ON account.id = conversation.user_id AND account.role = 'senior'
       LEFT JOIN LATERAL (
         SELECT role, content, created_at
         FROM app_ai_messages
         WHERE conversation_id = conversation.id
         ORDER BY created_at DESC
         LIMIT 40
       ) message ON TRUE
       WHERE conversation.status = 'human_requested'
         AND conversation.expires_at > CURRENT_TIMESTAMP
       ORDER BY conversation.updated_at ASC, message.created_at ASC`
    );
    const handoffs = new Map();
    for (const row of rows) {
      if (!handoffs.has(row.id)) {
        handoffs.set(row.id, {
          id: row.id,
          seniorName: row.name,
          updatedAt: row.updated_at,
          messages: []
        });
      }
      if (row.role) {
        handoffs.get(row.id).messages.push({
          role: row.role,
          content: row.content,
          createdAt: row.created_at
        });
      }
    }
    res.json({ handoffs: [...handoffs.values()] });
  } catch (error) {
    sendApiError(res, error, 'Impossible de charger les demandes de contact.');
  }
});

app.post('/api/admin/assistant/handoffs/:conversationId/reply', requireAuth, requireAdmin, async (req, res) => {
  const content = validateAssistantMessage(req.body?.message);
  if (!content) {
    return res.status(400).json({ error: 'Écrivez une réponse de 1 à 1 200 caractères.' });
  }
  if (!isValidUuid(req.params.conversationId)) {
    return res.status(400).json({ error: 'Identifiant de conversation invalide.' });
  }
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT id FROM app_ai_conversations
         WHERE id = $1 AND status = 'human_requested'
           AND expires_at > CURRENT_TIMESTAMP
         FOR UPDATE`,
        [req.params.conversationId]
      );
      if (!rows[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Cette demande n’existe plus ou a expiré.' });
      }
      await client.query(
        `INSERT INTO app_ai_messages (conversation_id, role, content)
         VALUES ($1, 'admin', $2)`,
        [req.params.conversationId, content]
      );
      await client.query(
        `UPDATE app_ai_conversations
         SET status = 'open', updated_at = CURRENT_TIMESTAMP,
             expires_at = CURRENT_TIMESTAMP + INTERVAL '30 days'
         WHERE id = $1`,
        [req.params.conversationId]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    res.json({ status: 'open' });
  } catch (error) {
    sendApiError(res, error, 'Impossible d’envoyer la réponse.');
  }
});

async function ensureCoordinatorOrganization(user) {
  const organizationId = randomUUID();
  await pool.query(
    `INSERT INTO planning_organizations (id, name, coordinator_user_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (coordinator_user_id) DO NOTHING`,
    [organizationId, `Équipe de ${user.name}`, user.id]
  );
  const { rows } = await pool.query(
    `SELECT id FROM planning_organizations WHERE coordinator_user_id = $1`,
    [user.id]
  );
  const organization = rows[0];
  if (!organization) {
    throw new Error('Impossible de charger l’équipe de coordination.');
  }
  await pool.query(
    `INSERT INTO planning_org_members (organization_id, user_id, role)
     VALUES ($1, $2, 'coordinator')
     ON CONFLICT (organization_id, user_id) DO UPDATE SET role = 'coordinator'`,
    [organization.id, user.id]
  );
  return organization.id;
}

function requireCoordinator(req, res, next) {
  if (!req.authUser.isCoordinator) {
    return res.status(403).json({ error: 'Cette action est réservée au coordinateur autorisé.' });
  }

  ensureCoordinatorOrganization(req.authUser)
    .then(organizationId => {
      req.planningOrganizationId = organizationId;
      next();
    })
    .catch(error => sendApiError(res, error, 'Impossible de charger l’équipe de coordination.'));
}

function requiredText(value, maxLength, label) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
    throw new AuthError(400, `Vérifiez le champ « ${label} » (maximum ${maxLength} caractères).`);
  }
  return value.trim();
}

function optionalText(value, maxLength, label) {
  if (typeof value !== 'string' || value.trim().length > maxLength) {
    throw new AuthError(400, `Vérifiez le champ « ${label} » (maximum ${maxLength} caractères).`);
  }
  return value.trim() || null;
}

function normalizeProfilePhotoUrl(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') {
    throw new AuthError(400, 'Le lien de la photo doit être une URL valide.');
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > 2000) {
    throw new AuthError(400, 'Le lien de la photo est trop long.');
  }
  try {
    const parsedUrl = new URL(trimmed);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new Error('Protocol unsupported');
    }
  } catch {
    throw new AuthError(400, 'Le lien de la photo doit commencer par http:// ou https://.');
  }
  return trimmed;
}

function hasActivePremium(user) {
  const status = String(user?.premiumStatus || user?.premium_status || 'inactive').toLowerCase();
  if (status === 'active' || status === 'trial') {
    const expiry = user?.premiumUntil ?? user?.premium_until;
    if (!expiry) return true;
    const time = new Date(expiry).getTime();
    return Number.isFinite(time) ? time > Date.now() : true;
  }
  return false;
}

async function createDailyRoom(roomName) {
  const apiKey = process.env.DAILY_API_KEY;
  if (!apiKey) {
    throw new Error('Configurez DAILY_API_KEY pour activer la visio premium.');
  }

  const response = await fetch('https://api.daily.co/v1/rooms', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: roomName,
      properties: {
        start_video_off: false,
        start_audio_off: false,
        enable_chat: true,
        enable_recording: false
      }
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error || payload?.message || 'Impossible de créer la salle Daily.';
    throw new Error(message);
  }

  return {
    roomName,
    roomUrl: payload.url || payload.room_url || `https://${(process.env.DAILY_DOMAIN || 'example.daily.co').replace(/^https?:\/\//, '').replace(/\/$/, '')}/${roomName}`,
    room: payload
  };
}

async function createDailyToken(roomName, userName, isOwner = false) {
  const apiKey = process.env.DAILY_API_KEY;
  if (!apiKey) {
    throw new Error('Configurez DAILY_API_KEY pour activer la visio premium.');
  }

  const response = await fetch('https://api.daily.co/v1/meeting-tokens', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      properties: {
        room_name: roomName,
        user_name: userName,
        is_owner: isOwner,
        exp: Math.floor((Date.now() + 60 * 60 * 1000) / 1000)
      }
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error || payload?.message || 'Impossible de générer le jeton de visio.';
    throw new Error(message);
  }

  return payload.token || payload.meeting_token || null;
}

async function insertAppNotification(client, userId, type, title, message, entityType, entityId) {
  if (!userId) return;
  const notificationId = randomUUID();
  await client.query(
    `INSERT INTO app_notifications
       (id, user_id, notification_type, title, message, entity_type, entity_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [notificationId, userId, type, title, message, entityType, entityId]
  );
  for (const channel of ['push', 'sms', 'email']) {
    await client.query(
      `INSERT INTO app_notification_deliveries
         (id, notification_id, user_id, channel)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (notification_id, user_id, channel) DO NOTHING`,
      [randomUUID(), notificationId, userId, channel]
    );
  }
}

async function notifyEmergencyAidants(client, senior, { type, title, message, checkinId }) {
  const { rows } = await client.query(
    `SELECT contact.contact_user_id
     FROM app_user_contacts contact
     JOIN app_users aidant ON aidant.id = contact.contact_user_id
     WHERE contact.user_id = $1
       AND aidant.role = 'aidant'
       AND aidant.is_active = TRUE
     FOR SHARE OF contact, aidant`,
    [senior.id]
  );
  for (const aidant of rows) {
    await insertAppNotification(
      client,
      aidant.contact_user_id,
      type,
      title,
      message,
      checkinId ? 'wellbeing_checkin' : 'emergency_alert',
      checkinId || randomUUID()
    );
  }
  return rows.length;
}

app.get('/api/contacts', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.contact_user_id, c.nickname,
              u.name, u.email, u.role, u.notification_phone AS phone,
              u.profile_photo_url AS photo_url,
              u.premium_status, u.premium_until
       FROM app_user_contacts c
       JOIN app_users u ON u.id = c.contact_user_id
       WHERE c.user_id = $1
       ORDER BY u.name ASC` ,
      [req.authUser.id]
    );
    res.json({
      contacts: rows.map(row => ({
        id: row.contact_user_id,
        contactId: row.contact_user_id,
        name: row.nickname || row.name,
        role: row.role,
        phone: row.phone || null,
        photoUrl: row.photo_url || null,
        premium: hasActivePremium(row)
      }))
    });
  } catch (error) {
    sendApiError(res, error, 'Impossible de charger vos contacts.');
  }
});

app.post('/api/contacts', requireAuth, async (req, res) => {
  const contactUserId = req.body?.contactUserId || req.body?.id || req.body?.contactId;
  if (!isValidUuid(String(contactUserId || ''))) {
    return res.status(400).json({ error: 'Choisissez un contact valide.' });
  }

  try {
    const { rows } = await pool.query(
      `WITH target AS (
         SELECT id, name, notification_phone, profile_photo_url, role
         FROM app_users
         WHERE id = $1 AND is_active = TRUE
       )
       INSERT INTO app_user_contacts (id, user_id, contact_user_id, nickname)
       SELECT $2, $3, target.id, target.name
       FROM target
       WHERE target.id <> $3
       ON CONFLICT (user_id, contact_user_id) DO UPDATE SET nickname = EXCLUDED.nickname
       RETURNING id, contact_user_id, nickname` ,
      [contactUserId, randomUUID(), req.authUser.id]
    );

    if (!rows[0]) {
      return res.status(404).json({ error: 'Ce contact n’existe pas ou ne peut pas être ajouté.' });
    }

    res.status(201).json({
      id: rows[0].contact_user_id,
      contactId: rows[0].contact_user_id,
      name: rows[0].nickname || 'Contact'
    });
  } catch (error) {
    sendApiError(res, error, 'Impossible d’ajouter ce contact.');
  }
});

app.post('/api/video/token', requireAuth, async (req, res) => {
  try {
    if (!hasActivePremium(req.authUser)) {
      return res.status(403).json({ error: 'L’accès à la visio est réservé à un abonnement premium actif.' });
    }

    const contactId = req.body?.contactId || req.body?.contactUserId || req.body?.id;
    if (!isValidUuid(String(contactId || ''))) {
      return res.status(400).json({ error: 'Sélectionnez un contact valide pour l’appel.' });
    }

    const { rows } = await pool.query(
      `SELECT u.id, u.name, u.premium_status, u.premium_until
       FROM app_user_contacts c
       JOIN app_users u ON u.id = c.contact_user_id
       WHERE c.user_id = $1 AND c.contact_user_id = $2 AND u.is_active = TRUE`,
      [req.authUser.id, contactId]
    );

    if (!rows[0]) {
      return res.status(403).json({ error: 'Vous devez enregistrer ce contact avant de l’appeler.' });
    }

    const contact = rows[0];
    if (!hasActivePremium(contact)) {
      return res.status(403).json({ error: 'Le contact doit aussi disposer d’un abonnement premium actif.' });
    }

    const roomName = `generation-liaison-${randomUUID().replace(/-/g, '')}`;
    const room = await createDailyRoom(roomName);
    const token = await createDailyToken(roomName, req.authUser.name, true);

    const callId = randomUUID();
    await pool.query(
      `INSERT INTO app_video_calls (id, caller_user_id, callee_user_id, room_name, room_url, status, started_at)
       VALUES ($1, $2, $3, $4, $5, 'created', CURRENT_TIMESTAMP)`,
      [callId, req.authUser.id, contactId, roomName, room.roomUrl]
    );

    res.json({
      callId,
      roomName,
      roomUrl: room.roomUrl,
      token,
      contactName: contact.name
    });
  } catch (error) {
    sendApiError(res, error, 'Impossible de lancer l’appel vidéo premium.');
  }
});

app.get('/api/status', (req, res) => {
  res.json({
    status: 'En ligne',
    message: 'Le serveur de Génération Liaison fonctionne parfaitement !'
  });
});

app.get('/api/admin/overview', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [
      summaryResult,
      usersResult,
      partnersResult,
      bookingsResult,
      visitsResult,
      recipientsResult,
      professionalsResult,
      redEvaluationsResult
    ] = await Promise.all([
      pool.query(
        `SELECT
           (SELECT COUNT(*)::int FROM app_users) AS account_count,
           (SELECT COUNT(*)::int FROM planning_organizations) AS organization_count,
           (SELECT COUNT(*)::int FROM planning_recipients
            WHERE consent_at IS NOT NULL AND consent_revoked_at IS NULL) AS shared_profiles,
           (SELECT COUNT(*)::int FROM planning_visits
            WHERE scheduled_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'
              AND scheduled_at < CURRENT_TIMESTAMP + INTERVAL '90 days') AS care_visits,
           (SELECT COUNT(*)::int FROM planning_service_partners WHERE active = TRUE) AS active_partners,
           (SELECT COUNT(*)::int FROM planning_service_bookings booking
            JOIN planning_recipients recipient ON recipient.id = booking.recipient_id
            WHERE booking.status = 'requested'
              AND recipient.consent_at IS NOT NULL
              AND recipient.consent_revoked_at IS NULL) AS pending_bookings`
      ),
      pool.query(
        `SELECT user_account.id, user_account.name, user_account.email, user_account.role,
                user_account.is_active, user_account.verification_status,
                user_account.senior_id, user_account.is_legal_guardian,
                user_account.guardian_verification_status,
                (SELECT COUNT(*)::int
                 FROM app_professional_verification_documents document
                 WHERE document.user_id = user_account.id
                   AND document.document_type = 'identity') AS has_identity_document,
                (SELECT COUNT(*)::int
                 FROM app_professional_verification_documents document
                 WHERE document.user_id = user_account.id
                   AND document.document_type = 'kbis') AS has_kbis_document,
                (SELECT COUNT(*)::int
                 FROM app_legal_guardian_verification_documents document
                 WHERE document.user_id = user_account.id
                   AND document.document_type = 'identity') AS has_guardian_identity_document,
                (SELECT COUNT(*)::int
                 FROM app_legal_guardian_verification_documents document
                 WHERE document.user_id = user_account.id
                   AND document.document_type = 'guardianship') AS has_guardianship_document,
                (SELECT COALESCE(json_agg(json_build_object(
                   'id', profile.id, 'name', profile.name
                 ) ORDER BY profile.name), '[]'::json)
                 FROM app_aidant_senior_links link
                 JOIN senior_profiles profile ON profile.id = link.senior_profile_id
                 WHERE link.aidant_user_id = user_account.id) AS linked_seniors,
                user_account.created_at, senior.name AS profile_name,
                COUNT(DISTINCT member.organization_id)::int AS team_count
         FROM app_users user_account
         JOIN senior_profiles senior ON senior.id = user_account.senior_id
         LEFT JOIN planning_org_members member ON member.user_id = user_account.id
         GROUP BY user_account.id, senior.name
         ORDER BY user_account.created_at DESC
         LIMIT 500`
      ),
      pool.query(
        `SELECT partner.id, partner.display_name, partner.service_type, partner.service_area,
                partner.billing_model, partner.active, account.name AS account_name,
                account.email, organization.name AS organization_name,
                COUNT(booking.id)::int AS booking_count
         FROM planning_service_partners partner
         JOIN app_users account ON account.id = partner.user_id
         JOIN planning_organizations organization ON organization.id = partner.organization_id
         LEFT JOIN planning_service_bookings booking ON booking.partner_id = partner.id
         GROUP BY partner.id, account.id, organization.id
         ORDER BY partner.active DESC, partner.display_name
         LIMIT 500`
      ),
      pool.query(
        `SELECT booking.id, booking.requested_at, booking.status,
                partner.display_name AS partner_name, partner.service_type,
                recipient.name AS recipient_name, organization.name AS organization_name
         FROM planning_service_bookings booking
         JOIN planning_service_partners partner
           ON partner.id = booking.partner_id AND partner.organization_id = booking.organization_id
         JOIN planning_recipients recipient
           ON recipient.id = booking.recipient_id AND recipient.organization_id = booking.organization_id
         JOIN planning_organizations organization ON organization.id = booking.organization_id
         WHERE recipient.consent_at IS NOT NULL AND recipient.consent_revoked_at IS NULL
           AND booking.requested_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'
           AND booking.requested_at < CURRENT_TIMESTAMP + INTERVAL '90 days'
         ORDER BY booking.requested_at DESC
         LIMIT 500`
      ),
      pool.query(
        `SELECT visit.id, visit.organization_id, visit.scheduled_at, visit.visit_type, visit.status,
                visit.acceptance_status,
                visit.assigned_user_id, visit.recipient_id,
                recipient.name AS recipient_name, account.name AS professional_name,
                organization.name AS organization_name,
                COALESCE((
                  SELECT json_agg(json_build_object(
                    'id', member.user_id,
                    'name', member_account.name,
                    'email', member_account.email
                  ) ORDER BY member_account.name)
                  FROM planning_org_members member
                  JOIN app_users member_account ON member_account.id = member.user_id
                  WHERE member.organization_id = visit.organization_id
                    AND member.role = 'professional'
                    AND member_account.is_active = TRUE
                    AND member_account.verification_status = 'approved'
                ), '[]'::json) AS professionals
         FROM planning_visits visit
         JOIN planning_recipients recipient
           ON recipient.id = visit.recipient_id AND recipient.organization_id = visit.organization_id
         JOIN app_users account ON account.id = visit.assigned_user_id
         JOIN planning_organizations organization ON organization.id = visit.organization_id
         WHERE recipient.consent_at IS NOT NULL
           AND recipient.consent_revoked_at IS NULL
           AND visit.scheduled_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'
           AND visit.scheduled_at < CURRENT_TIMESTAMP + INTERVAL '90 days'
         ORDER BY visit.scheduled_at DESC
         LIMIT 500`
      ),
      pool.query(
        `SELECT recipient.id, recipient.name, recipient.organization_id,
                organization.name AS organization_name
         FROM planning_recipients recipient
         JOIN planning_organizations organization ON organization.id = recipient.organization_id
         WHERE recipient.consent_at IS NOT NULL AND recipient.consent_revoked_at IS NULL
         ORDER BY organization.name, recipient.name
         LIMIT 1000`
      ),
      pool.query(
        `SELECT member.organization_id, member.user_id, account.name, account.email,
                organization.name AS organization_name
         FROM planning_org_members member
         JOIN app_users account ON account.id = member.user_id
           AND account.is_active = TRUE AND account.verification_status = 'approved'
         JOIN planning_organizations organization ON organization.id = member.organization_id
         WHERE member.role = 'professional'
         ORDER BY organization.name, account.name
         LIMIT 1000`
      ),
      pool.query(
        `SELECT evaluation.id, evaluation.comment, evaluation.created_at,
                visit.scheduled_at, visit.visit_type,
                recipient.name AS recipient_name,
                professional.name AS professional_name,
                author.name AS author_name, author.role AS author_role
         FROM planning_visit_evaluations evaluation
         JOIN planning_visits visit ON visit.id = evaluation.visit_id
         JOIN planning_recipients recipient
           ON recipient.id = evaluation.recipient_id
          AND recipient.organization_id = evaluation.organization_id
         JOIN app_users professional ON professional.id = visit.assigned_user_id
         JOIN app_users author ON author.id = evaluation.rated_by
         WHERE evaluation.rating = 'red'
         ORDER BY evaluation.created_at DESC
         LIMIT 100`
      )
    ]);

    for (const visit of visitsResult.rows) {
      await pool.query(
        `INSERT INTO planning_access_audit (organization_id, recipient_id, user_id, action)
         SELECT $1, $2, $3, 'admin_schedule_view'
         WHERE NOT EXISTS (
           SELECT 1 FROM planning_access_audit
           WHERE recipient_id = $2 AND user_id = $3 AND action = 'admin_schedule_view'
             AND created_at > CURRENT_TIMESTAMP - INTERVAL '5 minutes'
         )`,
        [visit.organization_id, visit.recipient_id, req.authUser.id]
      );
    }

    const summary = summaryResult.rows[0];
    res.json({
      summary: {
        accounts: summary.account_count,
        organizations: summary.organization_count,
        sharedProfiles: summary.shared_profiles,
        careVisits: summary.care_visits,
        activePartners: summary.active_partners,
        pendingBookings: summary.pending_bookings
      },
      accounts: usersResult.rows.map(row => ({
        id: row.id,
        name: row.name,
        email: row.email,
        role: row.role,
        active: row.is_active,
        verificationStatus: row.verification_status,
        verificationDocuments: {
          identity: row.has_identity_document > 0,
          kbis: row.has_kbis_document > 0
        },
        isLegalGuardian: row.is_legal_guardian,
        guardianVerificationStatus: row.guardian_verification_status,
        guardianVerificationDocuments: {
          identity: row.has_guardian_identity_document > 0,
          guardianship: row.has_guardianship_document > 0
        },
        seniorProfileId: row.senior_id,
        linkedSeniors: row.linked_seniors || [],
        administrator: adminEmails.has(row.email.toLowerCase()),
        profileName: row.profile_name,
        teamCount: row.team_count,
        createdAt: row.created_at
      })),
      partners: partnersResult.rows.map(row => ({
        id: row.id,
        displayName: row.display_name,
        serviceType: row.service_type,
        serviceArea: row.service_area,
        billingModel: row.billing_model,
        active: row.active,
        accountName: row.account_name,
        email: row.email,
        organizationName: row.organization_name,
        bookingCount: row.booking_count
      })),
      bookings: bookingsResult.rows.map(row => ({
        id: row.id,
        scheduledAt: row.requested_at,
        status: row.status,
        partnerName: row.partner_name,
        serviceType: row.service_type,
        recipientName: row.recipient_name,
        organizationName: row.organization_name
      })),
      careVisits: visitsResult.rows.map(row => ({
        id: row.id,
        scheduledAt: row.scheduled_at,
        visitType: row.visit_type,
        status: row.status,
        acceptanceStatus: row.acceptance_status,
        assignedUserId: row.assigned_user_id,
        recipientName: row.recipient_name,
        professionalName: row.professional_name,
        organizationName: row.organization_name,
        professionals: row.professionals
      })),
      careRecipients: recipientsResult.rows.map(row => ({
        id: row.id,
        name: row.name,
        organizationId: row.organization_id,
        organizationName: row.organization_name
      })),
      careProfessionals: professionalsResult.rows.map(row => ({
        organizationId: row.organization_id,
        userId: row.user_id,
        name: row.name,
        email: row.email,
        organizationName: row.organization_name
      })),
      redEvaluations: redEvaluationsResult.rows.map(row => ({
        id: row.id,
        comment: row.comment,
        createdAt: row.created_at,
        scheduledAt: row.scheduled_at,
        visitType: row.visit_type,
        recipientName: row.recipient_name,
        professionalName: row.professional_name,
        authorName: row.author_name,
        authorRole: row.author_role
      })),
      limits: { accounts: 500, partners: 500, bookings: 500, careVisits: 500 }
    });
  } catch (error) {
    sendApiError(res, error, 'Impossible de charger le tableau de bord administrateur.');
  }
});

app.get('/api/admin/accounts/:accountId/verification-documents', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT document.document_type, document.content_type, document.uploaded_at
       FROM app_professional_verification_documents document
       JOIN app_users account ON account.id = document.user_id
       WHERE account.id = $1 AND account.role = 'pro'
       ORDER BY document.document_type`,
      [req.params.accountId]
    );
    res.set('Cache-Control', 'private, no-store');
    res.json({
      documents: rows.map(row => ({
        type: row.document_type,
        contentType: row.content_type,
        uploadedAt: row.uploaded_at
      }))
    });
  } catch (error) {
    sendApiError(res, error, 'Impossible de charger les justificatifs.');
  }
});

app.get('/api/admin/accounts/:accountId/verification-documents/:documentType', requireAuth, requireAdmin, async (req, res) => {
  if (!['identity', 'kbis'].includes(req.params.documentType)) {
    return res.status(400).json({ error: 'Type de justificatif invalide.' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT document.content_type, document.file_data
       FROM app_professional_verification_documents document
       JOIN app_users account ON account.id = document.user_id
       WHERE account.id = $1 AND account.role = 'pro' AND document.document_type = $2`,
      [req.params.accountId, req.params.documentType]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Justificatif introuvable.' });
    const extension = rows[0].content_type === 'application/pdf'
      ? 'pdf'
      : rows[0].content_type === 'image/png' ? 'png' : 'jpg';
    res.set({
      'Cache-Control': 'private, no-store',
      'Content-Disposition': `attachment; filename="${req.params.documentType}.${extension}"`,
      'X-Content-Type-Options': 'nosniff'
    });
    res.type(rows[0].content_type).send(rows[0].file_data);
  } catch (error) {
    sendApiError(res, error, 'Impossible de télécharger le justificatif.');
  }
});

app.get('/api/admin/accounts/:accountId/guardian-documents/:documentType', requireAuth, requireAdmin, async (req, res) => {
  if (!['identity', 'guardianship'].includes(req.params.documentType)) {
    return res.status(400).json({ error: 'Type de justificatif invalide.' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT document.content_type, document.file_data
       FROM app_legal_guardian_verification_documents document
       JOIN app_users account ON account.id = document.user_id
       WHERE account.id = $1 AND account.role = 'aidant'
         AND account.is_legal_guardian = TRUE
         AND document.document_type = $2`,
      [req.params.accountId, req.params.documentType]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Justificatif introuvable.' });
    const extension = rows[0].content_type === 'application/pdf'
      ? 'pdf'
      : rows[0].content_type === 'image/png' ? 'png' : 'jpg';
    res.set({
      'Cache-Control': 'private, no-store',
      'Content-Disposition': `attachment; filename="${req.params.documentType}.${extension}"`,
      'X-Content-Type-Options': 'nosniff'
    });
    res.type(rows[0].content_type).send(rows[0].file_data);
  } catch (error) {
    sendApiError(res, error, 'Impossible de télécharger le justificatif de tutelle.');
  }
});

app.patch('/api/admin/accounts/:accountId/guardian-verification', requireAuth, requireAdmin, async (req, res) => {
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const { verificationStatus } = req.body || {};
  if (!uuidPattern.test(req.params.accountId) ||
      !['approved', 'rejected'].includes(verificationStatus)) {
    return res.status(400).json({ error: 'Décision de vérification invalide.' });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const { rows: targetRows } = await client.query(
      `SELECT id, name, guardian_verification_status
       FROM app_users
       WHERE id = $1 AND role = 'aidant' AND is_legal_guardian = TRUE
       FOR UPDATE`,
      [req.params.accountId]
    );
    if (!targetRows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Compte tuteur légal introuvable.' });
    }
    if (targetRows[0].guardian_verification_status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Seuls les dossiers de tutelle en attente peuvent être examinés.' });
    }
    if (verificationStatus === 'approved') {
      const { rows: documents } = await client.query(
        `SELECT COUNT(DISTINCT document_type)::int AS count
         FROM app_legal_guardian_verification_documents
         WHERE user_id = $1 AND document_type IN ('identity', 'guardianship')`,
        [req.params.accountId]
      );
      if (documents[0].count !== 2) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'La pièce d’identité et le justificatif de tutelle sont requis.' });
      }
    }
    const { rows } = await client.query(
      `UPDATE app_users
       SET guardian_verification_status = $2,
           guardian_reviewed_at = CURRENT_TIMESTAMP,
           guardian_reviewed_by = $3
       WHERE id = $1
       RETURNING id, guardian_verification_status`,
      [req.params.accountId, verificationStatus, req.authUser.id]
    );
    const approved = verificationStatus === 'approved';
    await insertAppNotification(
      client,
      rows[0].id,
      approved ? 'guardian_verification_approved' : 'guardian_verification_rejected',
      approved ? 'Tutelle légale vérifiée' : 'Justificatifs de tutelle à compléter',
      approved
        ? 'Vos justificatifs ont été vérifiés. L’administration peut maintenant associer des profils seniors à votre compte.'
        : 'Vos justificatifs de tutelle n’ont pas été validés. Veuillez contacter l’administration pour les compléter.',
      'guardian_verification',
      null
    );
    if (approved) {
      await client.query(
        'DELETE FROM app_legal_guardian_verification_documents WHERE user_id = $1',
        [rows[0].id]
      );
    }
    await client.query('COMMIT');
    res.json({ accountId: rows[0].id, verificationStatus: rows[0].guardian_verification_status });
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    sendApiError(res, error, 'Impossible d’enregistrer la décision sur la tutelle.');
  } finally {
    if (client) client.release();
  }
});

app.post('/api/admin/accounts/:accountId/senior-links', requireAuth, requireAdmin, async (req, res) => {
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const seniorUserId = req.body?.seniorUserId;
  if (!uuidPattern.test(req.params.accountId) || typeof seniorUserId !== 'string' || !uuidPattern.test(seniorUserId)) {
    return res.status(400).json({ error: 'Compte aidant ou compte senior invalide.' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO app_aidant_senior_links (aidant_user_id, senior_profile_id, linked_by)
       SELECT aidant.id, senior.senior_id, $3
       FROM app_users aidant
       JOIN app_users senior ON senior.id = $2 AND senior.role = 'senior' AND senior.is_active = TRUE
       WHERE aidant.id = $1
         AND aidant.role = 'aidant'
         AND aidant.is_active = TRUE
         AND aidant.is_legal_guardian = TRUE
         AND aidant.guardian_verification_status = 'approved'
       ON CONFLICT (aidant_user_id, senior_profile_id) DO NOTHING
       RETURNING senior_profile_id`,
      [req.params.accountId, seniorUserId, req.authUser.id]
    );
    if (!rows[0]) {
      return res.status(409).json({ error: 'Seuls les tuteurs légaux vérifiés peuvent être associés par l’administration ; les autres aidants doivent obtenir l’accord du senior.' });
    }
    res.status(201).json({ seniorProfileId: rows[0].senior_profile_id });
  } catch (error) {
    sendApiError(res, error, 'Impossible d’associer ce profil senior.');
  }
});

app.delete('/api/admin/accounts/:accountId/senior-links/:seniorProfileId', requireAuth, requireAdmin, async (req, res) => {
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(req.params.accountId) || !uuidPattern.test(req.params.seniorProfileId)) {
    return res.status(400).json({ error: 'Compte aidant ou profil senior invalide.' });
  }
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const { rowCount } = await client.query(
      `DELETE FROM app_aidant_senior_links
       WHERE aidant_user_id = $1 AND senior_profile_id = $2 AND suspended_at IS NULL`,
      [req.params.accountId, req.params.seniorProfileId]
    );
    if (!rowCount) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Association introuvable ou suspendue en attente de confirmation du senior.' });
    }
    await client.query(
      `UPDATE app_aidant_unlink_requests request
       SET status = 'completed', resolved_at = CURRENT_TIMESTAMP
       FROM app_users senior
       WHERE request.aidant_user_id = $1 AND request.senior_user_id = senior.id
         AND senior.senior_id = $2 AND request.status = 'pending'
         AND request.requested_by = 'aidant'`,
      [req.params.accountId, req.params.seniorProfileId]
    );
    await client.query('COMMIT');
    res.json({ removed: true });
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    sendApiError(res, error, 'Impossible de retirer cette association.');
  } finally {
    if (client) client.release();
  }
});

app.patch('/api/admin/accounts/:accountId/verification', requireAuth, requireAdmin, async (req, res) => {
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const { verificationStatus } = req.body || {};
  if (!uuidPattern.test(req.params.accountId) ||
      !['approved', 'rejected'].includes(verificationStatus)) {
    return res.status(400).json({ error: 'Décision de vérification invalide.' });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const { rows: targetRows } = await client.query(
      `SELECT id, name, role, verification_status
       FROM app_users WHERE id = $1 FOR UPDATE`,
      [req.params.accountId]
    );
    if (!targetRows[0] || targetRows[0].role !== 'pro') {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Compte intervenant introuvable.' });
    }
    if (targetRows[0].verification_status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Seuls les dossiers en attente peuvent être examinés.' });
    }
    if (verificationStatus === 'approved') {
      const { rows: documents } = await client.query(
        `SELECT COUNT(DISTINCT document_type)::int AS count
         FROM app_professional_verification_documents
         WHERE user_id = $1 AND document_type IN ('identity', 'kbis')`,
        [req.params.accountId]
      );
      if (documents[0].count !== 2) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'La pièce d’identité et le Kbis sont requis avant validation.' });
      }
    }
    const { rows } = await client.query(
      `UPDATE app_users
       SET verification_status = $2,
           verification_reviewed_at = CURRENT_TIMESTAMP,
           verification_reviewed_by = $3,
           verification_rejection_reason = NULL
       WHERE id = $1
       RETURNING id, verification_status`,
      [req.params.accountId, verificationStatus, req.authUser.id]
    );
    const approved = verificationStatus === 'approved';
    await insertAppNotification(
      client,
      rows[0].id,
      approved ? 'professional_verification_approved' : 'professional_verification_rejected',
      approved ? 'Dossier intervenant validé' : 'Dossier intervenant à compléter',
      approved
        ? 'Votre dossier a été validé. Vous pouvez maintenant accéder à votre espace intervenant.'
        : 'Votre dossier n’a pas été validé. Veuillez vous reconnecter et compléter vos justificatifs.',
      'professional_verification',
      null
    );
    await client.query(
      'DELETE FROM app_professional_verification_documents WHERE user_id = $1',
      [rows[0].id]
    );
    await client.query('COMMIT');
    res.json({ accountId: rows[0].id, verificationStatus: rows[0].verification_status });
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    sendApiError(res, error, 'Impossible d’enregistrer la décision de vérification.');
  } finally {
    if (client) client.release();
  }
});

app.patch('/api/admin/accounts/:accountId', requireAuth, requireAdmin, async (req, res) => {
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(req.params.accountId)) {
    return res.status(400).json({ error: 'Identifiant de compte invalide.' });
  }
  if (typeof req.body?.active !== 'boolean') {
    return res.status(400).json({ error: 'Indiquez si le compte doit être actif.' });
  }
  if (!req.body.active && req.params.accountId === req.authUser.id) {
    return res.status(409).json({ error: 'Vous ne pouvez pas suspendre votre propre compte.' });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    if (req.body.active) {
      const { rows: closureRequests } = await client.query(
        `SELECT id
         FROM app_account_closure_requests
         WHERE user_id = $1
         LIMIT 1`,
        [req.params.accountId]
      );
      if (closureRequests.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'Ce compte a demandé sa clôture et ne peut pas être réactivé depuis cet écran.'
        });
      }
    }
    if (!req.body.active) {
      const { rows: targetAccounts } = await client.query(
        `SELECT email FROM app_users WHERE id = $1 FOR UPDATE`,
        [req.params.accountId]
      );
      if (targetAccounts[0] && adminEmails.has(targetAccounts[0].email.toLowerCase())) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Un compte administrateur ne peut pas être suspendu depuis cet écran.' });
      }
    }
    const { rows } = await client.query(
      `UPDATE app_users
       SET is_active = $2
       WHERE id = $1
       RETURNING id, is_active`,
      [req.params.accountId, req.body.active]
    );
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Compte introuvable.' });
    }
    if (!rows[0].is_active) {
      await client.query('DELETE FROM app_sessions WHERE user_id = $1', [rows[0].id]);
    }
    await client.query('COMMIT');
    res.json({ accountId: rows[0].id, active: rows[0].is_active });
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    sendApiError(res, error, 'Impossible de modifier ce compte.');
  } finally {
    if (client) client.release();
  }
});

app.get('/api/admin/account-closure-requests', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT request.id, request.status, request.requested_at,
              request.requested_at + INTERVAL '30 days' AS due_at,
              request.updated_at, request.ai_reviewed_at,
              request.ai_review_summary, request.ai_review_inventory,
              account.name, account.email, account.role, account.premium_status
       FROM app_account_closure_requests request
       JOIN app_users account ON account.id = request.user_id
       WHERE request.status IN ('pending', 'processing')
       ORDER BY request.requested_at ASC
       LIMIT 200`
    );
    res.json({
      requests: rows.map(row => ({
        id: row.id,
        status: row.status,
        requestedAt: row.requested_at,
        dueAt: row.due_at,
        updatedAt: row.updated_at,
        aiReviewedAt: row.ai_reviewed_at,
        aiReviewSummary: row.ai_review_summary,
        aiReviewInventory: row.ai_review_inventory,
        name: row.name,
        email: row.email,
        role: row.role,
        premiumStatus: row.premium_status
      }))
    });
  } catch (error) {
    sendApiError(res, error, 'Impossible de charger les demandes de clôture.');
  }
});

app.post('/api/admin/account-closure-requests/:requestId/ai-review', requireAuth, requireAdmin, async (req, res) => {
  if (!isValidUuid(req.params.requestId)) {
    return res.status(400).json({ error: 'Identifiant de demande invalide.' });
  }
  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({
      error: 'L’analyse IA des demandes de clôture n’est pas configurée par l’équipe.'
    });
  }

  try {
    await authService.ensureSchema();
    const { rows } = await pool.query(
      `WITH target AS (
         SELECT request.id, request.status, account.id AS user_id, account.senior_id,
                account.role, account.premium_status, account.premium_until, account.terms_accepted_at
         FROM app_account_closure_requests request
         JOIN app_users account ON account.id = request.user_id
         WHERE request.id = $1
       ),
       recipient_scope AS (
         SELECT recipient.id, recipient.organization_id
         FROM planning_recipients recipient
         JOIN target ON recipient.senior_id = target.senior_id OR recipient.created_by = target.user_id
       ),
       organization_scope AS (
         SELECT organization.id
         FROM planning_organizations organization
         JOIN target ON organization.coordinator_user_id = target.user_id
         UNION
         SELECT membership.organization_id
         FROM planning_org_members membership
         JOIN target ON membership.user_id = target.user_id
         UNION
         SELECT organization_id FROM recipient_scope
       ),
       related_recipient_scope AS (
         SELECT id, organization_id FROM recipient_scope
         UNION
         SELECT recipient.id, recipient.organization_id
         FROM planning_recipients recipient
         JOIN organization_scope ON organization_scope.id = recipient.organization_id
       ),
       partner_scope AS (
         SELECT partner.id
         FROM planning_service_partners partner
         JOIN target ON partner.user_id = target.user_id
         UNION
         SELECT partner.id
         FROM planning_service_partners partner
         JOIN organization_scope ON organization_scope.id = partner.organization_id
       ),
       visit_scope AS (
         SELECT visit.id, visit.recipient_id, visit.organization_id
         FROM planning_visits visit
         JOIN target ON visit.assigned_user_id = target.user_id OR visit.created_by = target.user_id
         UNION
         SELECT visit.id, visit.recipient_id, visit.organization_id
         FROM planning_visits visit
         JOIN related_recipient_scope ON related_recipient_scope.id = visit.recipient_id
         UNION
         SELECT visit.id, visit.recipient_id, visit.organization_id
         FROM planning_visits visit
         JOIN organization_scope ON organization_scope.id = visit.organization_id
       )
       SELECT target.status, target.role, target.premium_status, target.premium_until,
         CASE WHEN target.terms_accepted_at IS NULL THEN 0 ELSE 1 END AS account_compliance_records,
         (SELECT count(*) FROM app_professional_verification_documents item
          WHERE item.user_id = target.user_id) AS professional_documents,
         (SELECT count(*) FROM app_notifications item
          WHERE item.user_id = target.user_id) AS notifications,
         (SELECT count(*) FROM app_notification_deliveries item
          WHERE item.user_id = target.user_id) AS notification_deliveries,
         (SELECT count(*) FROM app_push_subscriptions item
          WHERE item.user_id = target.user_id) AS push_subscriptions,
         (SELECT count(*) FROM app_directory_bookings item
          WHERE item.requester_user_id = target.user_id OR item.professional_user_id = target.user_id) AS directory_bookings,
         (SELECT count(*) FROM planning_organizations item
          WHERE item.id IN (SELECT id FROM organization_scope)) AS organizations,
         (SELECT count(*) FROM planning_org_members item
          WHERE item.user_id = target.user_id OR item.organization_id IN (SELECT id FROM organization_scope)) AS team_memberships,
         (SELECT count(*) FROM partner_scope) AS service_partners,
         (SELECT count(*) FROM app_logs item
          WHERE item.senior_id = target.senior_id) AS liaison_logs,
         (SELECT count(*) FROM related_recipient_scope) AS planning_recipients,
         (SELECT count(*) FROM planning_recipient_notes item
          WHERE item.recipient_id IN (SELECT id FROM related_recipient_scope)) AS shared_notes,
         (SELECT count(*) FROM visit_scope) AS care_visits,
         (SELECT count(*) FROM planning_service_bookings item
          WHERE item.created_by = target.user_id OR item.recipient_id IN (SELECT id FROM related_recipient_scope)
             OR item.partner_id IN (SELECT id FROM partner_scope)
             OR item.organization_id IN (SELECT id FROM organization_scope)) AS service_bookings,
         (SELECT count(*) FROM planning_visit_events item
          WHERE item.user_id = target.user_id OR item.visit_id IN (SELECT id FROM visit_scope)
             OR item.recipient_id IN (SELECT id FROM related_recipient_scope)
             OR item.organization_id IN (SELECT id FROM organization_scope)) AS visit_events,
         (SELECT count(*) FROM planning_visit_evaluations item
          WHERE item.rated_by = target.user_id OR item.recipient_id IN (SELECT id FROM related_recipient_scope)) AS visit_evaluations,
         (SELECT count(*) FROM planning_access_audit item
          WHERE item.user_id = target.user_id OR item.recipient_id IN (SELECT id FROM related_recipient_scope)
             OR item.organization_id IN (SELECT id FROM organization_scope)) AS planning_access_audits,
         (SELECT count(*) FROM app_ai_conversations conversation
          JOIN app_ai_messages message ON message.conversation_id = conversation.id
          WHERE conversation.user_id = target.user_id) AS ai_messages,
         (SELECT count(*) FROM app_wellbeing_checkins item
          WHERE item.user_id = target.user_id) AS wellbeing_checkins,
         (SELECT count(*) FROM app_wellbeing_checkin_shares share
          JOIN app_wellbeing_checkins checkin ON checkin.id = share.checkin_id
          WHERE share.recipient_user_id = target.user_id
             OR checkin.user_id = target.user_id) AS wellbeing_checkin_shares
       FROM target`,
      [req.params.requestId]
    );
    const account = rows[0];
    if (!account) {
      return res.status(404).json({ error: 'Demande de clôture introuvable.' });
    }
    if (!['pending', 'processing'].includes(account.status)) {
      return res.status(409).json({ error: 'Cette demande n’est plus en cours de traitement.' });
    }

    const inventory = Object.fromEntries([
      ['professionalDocuments', account.professional_documents],
      ['notifications', account.notifications],
      ['notificationDeliveries', account.notification_deliveries],
      ['pushSubscriptions', account.push_subscriptions],
      ['directoryBookings', account.directory_bookings],
      ['accountComplianceRecords', account.account_compliance_records],
      ['organizations', account.organizations],
      ['teamMemberships', account.team_memberships],
      ['servicePartners', account.service_partners],
      ['liaisonLogs', account.liaison_logs],
      ['planningRecipients', account.planning_recipients],
      ['sharedNotes', account.shared_notes],
      ['careVisits', account.care_visits],
      ['serviceBookings', account.service_bookings],
      ['visitEvents', account.visit_events],
      ['visitEvaluations', account.visit_evaluations],
      ['planningAccessAudits', account.planning_access_audits],
      ['aiMessages', account.ai_messages],
      ['wellbeingCheckins', account.wellbeing_checkins],
      ['wellbeingCheckinShares', account.wellbeing_checkin_shares]
    ].map(([key, value]) => [key, Number(value)]));
    const premiumUntil = account.premium_until ? new Date(account.premium_until) : null;
    const accountTier = ['active', 'trial'].includes(account.premium_status) &&
      (!premiumUntil || premiumUntil.getTime() > Date.now())
      ? 'premium_or_trial'
      : 'free_or_inactive';
    const summary = await reviewAccountClosure({
      accountRole: account.role,
      accountTier,
      inventory,
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL || 'gpt-4.1-mini'
    });

    const { rows: updated } = await pool.query(
      `UPDATE app_account_closure_requests
       SET ai_reviewed_at = CURRENT_TIMESTAMP,
           ai_review_summary = $2::jsonb,
           ai_review_inventory = $3::jsonb,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND status IN ('pending', 'processing')
       RETURNING ai_reviewed_at`,
      [req.params.requestId, JSON.stringify(summary), JSON.stringify(inventory)]
    );
    if (!updated[0]) {
      return res.status(409).json({
        error: 'La demande a changé de statut pendant l’analyse. Actualisez la liste avant de continuer.'
      });
    }
    res.json({
      reviewedAt: updated[0].ai_reviewed_at,
      summary,
      inventory,
      accountTier
    });
  } catch (error) {
    sendApiError(res, error, 'Impossible de préparer l’analyse IA de cette demande.');
  }
});

app.patch('/api/admin/account-closure-requests/:requestId', requireAuth, requireAdmin, async (req, res) => {
  if (!isValidUuid(req.params.requestId)) {
    return res.status(400).json({ error: 'Identifiant de demande invalide.' });
  }
  const { status, resolutionNote } = req.body || {};
  if (!['processing', 'completed'].includes(status)) {
    return res.status(400).json({ error: 'Statut de traitement invalide.' });
  }
  if (status === 'completed' &&
      (typeof resolutionNote !== 'string' || resolutionNote.trim().length < 20 ||
       resolutionNote.trim().length > 1000)) {
    return res.status(400).json({
      error: 'Décrivez le traitement et les éventuelles données conservées (20 à 1000 caractères).'
    });
  }

  try {
    const previousStatus = status === 'processing' ? 'pending' : 'processing';
    const { rows } = await pool.query(
      `UPDATE app_account_closure_requests
       SET status = $2,
           updated_at = CURRENT_TIMESTAMP,
           handled_at = CASE WHEN $2 = 'completed' THEN CURRENT_TIMESTAMP ELSE NULL END,
           handled_by = CASE WHEN $2 = 'completed' THEN $3 ELSE NULL END,
           resolution_note = CASE WHEN $2 = 'completed' THEN $4 ELSE NULL END
       WHERE id = $1 AND status = $5
         AND ($2 != 'completed' OR ai_reviewed_at IS NOT NULL)
       RETURNING id, status`,
      [
        req.params.requestId,
        status,
        req.authUser.id,
        status === 'completed' ? resolutionNote.trim() : null,
        previousStatus
      ]
    );
    if (!rows[0]) {
      const { rows: closureRequests } = await pool.query(
        `SELECT status, ai_reviewed_at
         FROM app_account_closure_requests
         WHERE id = $1`,
        [req.params.requestId]
      );
      if (status === 'completed' && closureRequests[0] &&
          closureRequests[0].status === 'processing' && !closureRequests[0].ai_reviewed_at) {
        return res.status(409).json({
          error: 'L’analyse IA doit être effectuée et examinée par un administrateur avant de clôturer la demande.'
        });
      }
      return res.status(409).json({
        error: 'La demande a déjà changé de statut. Actualisez la liste avant de réessayer.'
      });
    }
    res.json({ requestId: rows[0].id, status: rows[0].status });
  } catch (error) {
    sendApiError(res, error, 'Impossible de mettre à jour la demande de clôture.');
  }
});

app.post('/api/admin/care-visits', requireAuth, requireAdmin, async (req, res) => {
  const { recipientId, organizationId, assignedUserId, scheduledAt, durationMinutes, visitType } = req.body || {};
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (typeof recipientId !== 'string' || !uuidPattern.test(recipientId) ||
      typeof organizationId !== 'string' || !uuidPattern.test(organizationId) ||
      typeof assignedUserId !== 'string' || !uuidPattern.test(assignedUserId)) {
    return res.status(400).json({ error: 'Sélectionnez une personne et un intervenant valides.' });
  }
  if (typeof scheduledAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(scheduledAt) ||
      !Number.isFinite(Date.parse(scheduledAt)) || Date.parse(scheduledAt) <= Date.now()) {
    return res.status(400).json({ error: 'Choisissez une date future avec son fuseau horaire.' });
  }
  if (!Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 480) {
    return res.status(400).json({ error: 'La durée doit être comprise entre 15 minutes et 8 heures.' });
  }

  let client;
  try {
    const type = requiredText(visitType, 120, 'type de rendez-vous');
    client = await pool.connect();
    await client.query('BEGIN');
    const { rows } = await client.query(
      `WITH inserted AS (
         INSERT INTO planning_visits
           (id, organization_id, recipient_id, assigned_user_id, scheduled_at,
            duration_minutes, visit_type, created_by, acceptance_status)
         SELECT $1, recipient.organization_id, recipient.id, member.user_id, $5,
                $6, $7, $8, 'pending'
         FROM planning_recipients recipient
         JOIN planning_org_members member
           ON member.organization_id = recipient.organization_id
          AND member.user_id = $4
          AND member.role = 'professional'
         JOIN app_users account
           ON account.id = member.user_id
          AND account.is_active = TRUE AND account.verification_status = 'approved'
         WHERE recipient.id = $2
           AND recipient.organization_id = $3
           AND recipient.consent_at IS NOT NULL
           AND recipient.consent_revoked_at IS NULL
         RETURNING id, recipient_id, assigned_user_id
       )
       SELECT inserted.id, inserted.assigned_user_id, recipient.name AS recipient_name
       FROM inserted
       JOIN planning_recipients recipient ON recipient.id = inserted.recipient_id`,
      [
        randomUUID(),
        recipientId,
        organizationId,
        assignedUserId,
        scheduledAt,
        durationMinutes,
        type,
        req.authUser.id
      ]
    );
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Vérifiez que la personne a autorisé le partage et que l’intervenant appartient à son équipe.' });
    }
    await insertAppNotification(
      client,
      rows[0].assigned_user_id,
      'care_visit_invite',
      'Demande de rendez-vous à accepter',
      `Une visite « ${type} » pour ${rows[0].recipient_name} est proposée le ${new Date(scheduledAt).toLocaleString('fr-FR')}. Acceptez-la pour l’ajouter aux agendas.`,
      'care_visit',
      rows[0].id
    );
    await client.query('COMMIT');
    res.status(201).json({ visitId: rows[0].id, acceptanceStatus: 'pending' });
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    sendApiError(res, error, 'Impossible de planifier ce rendez-vous.');
  } finally {
    if (client) client.release();
  }
});

app.patch('/api/admin/care-visits/:visitId', requireAuth, requireAdmin, async (req, res) => {
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(req.params.visitId)) {
    return res.status(400).json({ error: 'Identifiant de rendez-vous invalide.' });
  }
  const { scheduledAt, assignedUserId } = req.body || {};
  if (scheduledAt === undefined && assignedUserId === undefined) {
    return res.status(400).json({ error: 'Indiquez le nouvel horaire ou l’intervenant.' });
  }
  if (scheduledAt !== undefined &&
      (typeof scheduledAt !== 'string' ||
       !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(scheduledAt) ||
       !Number.isFinite(Date.parse(scheduledAt)) || Date.parse(scheduledAt) <= Date.now())) {
    return res.status(400).json({ error: 'Choisissez une date future avec son fuseau horaire.' });
  }
  if (assignedUserId !== undefined &&
      (typeof assignedUserId !== 'string' || !uuidPattern.test(assignedUserId))) {
    return res.status(400).json({ error: 'Sélectionnez un intervenant valide.' });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const { rows: currentRows } = await client.query(
      `SELECT visit.id, visit.organization_id, visit.recipient_id, visit.assigned_user_id,
              visit.visit_type, recipient.name AS recipient_name, recipient.senior_id,
              organization.coordinator_user_id
       FROM planning_visits visit
       JOIN planning_recipients recipient
         ON recipient.id = visit.recipient_id
        AND recipient.organization_id = visit.organization_id
       JOIN planning_organizations organization ON organization.id = visit.organization_id
       WHERE visit.id = $1
         AND recipient.consent_at IS NOT NULL
         AND recipient.consent_revoked_at IS NULL
         AND visit.status = 'scheduled'
       FOR UPDATE OF visit, recipient`,
      [req.params.visitId]
    );
    const currentVisit = currentRows[0];
    if (!currentVisit) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Rendez-vous introuvable, terminé ou non modifiable.' });
    }
    const targetUserId = assignedUserId ?? currentVisit.assigned_user_id;
    const { rows: members } = await client.query(
      `SELECT user_account.id
       FROM planning_org_members member
       JOIN app_users user_account ON user_account.id = member.user_id
       WHERE member.organization_id = $1
         AND member.user_id = $2
         AND member.role = 'professional'
         AND user_account.is_active = TRUE
         AND user_account.verification_status = 'approved'`,
      [currentVisit.organization_id, targetUserId]
    );
    if (!members[0]) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'L’intervenant doit être actif et membre de la même équipe.' });
    }
    await client.query(
      `UPDATE planning_visits
       SET scheduled_at = COALESCE($2::timestamptz, scheduled_at),
           assigned_user_id = $3,
           acceptance_status = 'pending'
       WHERE id = $1`,
      [currentVisit.id, scheduledAt ?? null, targetUserId]
    );
    await client.query(
      `DELETE FROM app_notifications
       WHERE entity_type = 'care_visit'
         AND entity_id = $1
         AND notification_type = 'care_visit_invite'`,
      [currentVisit.id]
    );
    await insertAppNotification(
      client,
      targetUserId,
      'care_visit_invite',
      'Demande de rendez-vous à accepter',
      `Une visite « ${currentVisit.visit_type} » pour ${currentVisit.recipient_name} est proposée le ${new Date(scheduledAt || currentVisit.scheduled_at).toLocaleString('fr-FR')}. Acceptez-la pour l’ajouter aux agendas.`,
      'care_visit',
      currentVisit.id
    );
    const notificationTargets = new Set([currentVisit.senior_id, currentVisit.coordinator_user_id]);
    notificationTargets.delete(targetUserId);
    for (const userId of notificationTargets) {
      await insertAppNotification(
        client,
        userId,
        'care_visit_changed',
        'Rendez-vous modifié, en attente d’acceptation',
        `La visite « ${currentVisit.visit_type} » pour ${currentVisit.recipient_name} a été modifiée et attend l’accord de l’intervenant.`,
        'care_visit',
        currentVisit.id
      );
    }
    await client.query('COMMIT');
    res.json({ visitId: currentVisit.id, updated: true, acceptanceStatus: 'pending' });
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    sendApiError(res, error, 'Impossible de modifier ce rendez-vous.');
  } finally {
    if (client) client.release();
  }
});

app.patch('/api/admin/service-partners/:partnerId', requireAuth, requireAdmin, async (req, res) => {
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(req.params.partnerId)) {
    return res.status(400).json({ error: 'Identifiant partenaire invalide.' });
  }
  const { active, billingModel } = req.body || {};
  if (active !== undefined && typeof active !== 'boolean') {
    return res.status(400).json({ error: 'Le statut actif doit être vrai ou faux.' });
  }
  if (billingModel !== undefined && !['subscription', 'per_completed_booking'].includes(billingModel)) {
    return res.status(400).json({ error: 'Choisissez un mode de rémunération valide.' });
  }
  if (active === undefined && billingModel === undefined) {
    return res.status(400).json({ error: 'Indiquez le statut ou le mode de rémunération à modifier.' });
  }

  try {
    const { rows } = await pool.query(
      `UPDATE planning_service_partners
       SET active = COALESCE($2, active),
           billing_model = COALESCE($3, billing_model)
       WHERE id = $1
       RETURNING id, active, billing_model`,
      [req.params.partnerId, active ?? null, billingModel ?? null]
    );
    if (!rows[0]) {
      return res.status(404).json({ error: 'Partenaire introuvable.' });
    }
    res.json({ partnerId: rows[0].id, active: rows[0].active, billingModel: rows[0].billing_model });
  } catch (error) {
    sendApiError(res, error, 'Impossible de modifier ce partenaire.');
  }
});

app.patch('/api/admin/service-bookings/:bookingId', requireAuth, requireAdmin, async (req, res) => {
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(req.params.bookingId)) {
    return res.status(400).json({ error: 'Identifiant de rendez-vous invalide.' });
  }
  const { status } = req.body || {};
  if (!['confirmed', 'completed', 'cancelled'].includes(status)) {
    return res.status(400).json({ error: 'Choisissez un statut de rendez-vous valide.' });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT booking.id, booking.status, booking.organization_id, booking.recipient_id,
              booking.created_by, partner.user_id, partner.display_name,
              recipient.senior_id, recipient.name AS recipient_name,
              organization.coordinator_user_id
       FROM planning_service_bookings booking
       JOIN planning_service_partners partner
         ON partner.id = booking.partner_id
        AND partner.organization_id = booking.organization_id
       JOIN planning_recipients recipient
         ON recipient.id = booking.recipient_id
        AND recipient.organization_id = booking.organization_id
       JOIN planning_organizations organization ON organization.id = booking.organization_id
       WHERE booking.id = $1
         AND recipient.consent_at IS NOT NULL
         AND recipient.consent_revoked_at IS NULL
       FOR UPDATE OF booking`,
      [req.params.bookingId]
    );
    const booking = rows[0];
    if (!booking) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Rendez-vous introuvable.' });
    }
    const allowed =
      (status === 'confirmed' && booking.status === 'requested') ||
      (status === 'completed' && booking.status === 'confirmed') ||
      (status === 'cancelled' && ['requested', 'confirmed'].includes(booking.status));
    if (!allowed) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Ce changement n’est pas possible pour le statut actuel ou le consentement est retiré.' });
    }
    await client.query(
      `UPDATE planning_service_bookings
       SET status = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [booking.id, status]
    );
    if (status === 'confirmed' || status === 'cancelled') {
      const notificationTargets = new Set([
        booking.senior_id,
        booking.created_by,
        booking.coordinator_user_id,
        booking.user_id
      ]);
      notificationTargets.delete(req.authUser.id);
      const declined = status === 'cancelled' && booking.status === 'requested';
      for (const userId of notificationTargets) {
        await insertAppNotification(
          client,
          userId,
          declined ? 'service_booking_declined' : status === 'cancelled'
            ? 'service_booking_cancelled'
            : 'service_booking_confirmed',
          declined ? 'Demande de rendez-vous refusée' : status === 'cancelled'
            ? 'Rendez-vous annulé'
            : 'Rendez-vous accepté',
          declined
            ? `La demande de rendez-vous « ${booking.display_name} » pour ${booking.recipient_name} a été refusée par l’administration.`
            : status === 'cancelled'
              ? `Le rendez-vous « ${booking.display_name} » pour ${booking.recipient_name} a été annulé par l’administration.`
              : `Le rendez-vous « ${booking.display_name} » pour ${booking.recipient_name} est accepté et ajouté à l’agenda.`,
          'service_booking',
          booking.id
        );
      }
    }
    await client.query('COMMIT');
    res.json({ bookingId: booking.id, status });
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    sendApiError(res, error, 'Impossible de modifier ce rendez-vous.');
  } finally {
    if (client) client.release();
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const registration = req.body || {};
    if (registration.acceptedTerms !== true || registration.acceptedTermsVersion !== TERMS_VERSION) {
      return res.status(400).json({
        error: 'Vous devez accepter les conditions générales d’utilisation en vigueur.'
      });
    }
    const channels = notificationDelivery.isConfigured();
    if (registration.emailNotificationsEnabled === true && !channels.email) {
      return res.status(503).json({ error: 'Les notifications e-mail ne sont pas encore configurées par l’administrateur.' });
    }
    if (registration.smsNotificationsEnabled === true && !channels.sms) {
      return res.status(503).json({ error: 'Les notifications SMS ne sont pas encore configurées par l’administrateur.' });
    }
    const result = await authService.register(registration);
    res.status(201).json({ ...result, user: addUserAccessFlags(result.user) });
  } catch (error) {
    sendApiError(res, error, 'Impossible de créer le compte.');
  }
});

app.post('/api/account/closure-request', requireAuth, async (req, res) => {
  if (req.authUser.isAdmin) {
    return res.status(409).json({
      error: 'Pour clôturer un compte administrateur, contactez un autre administrateur ou le support.'
    });
  }
  try {
    const result = await authService.requestAccountClosure(req.authUser.id, req.body?.password);
    res.json({
      requested: true,
      ...result,
      message: 'Votre compte est désactivé et votre demande d’effacement a été transmise à l’équipe.'
    });
  } catch (error) {
    sendApiError(res, error, 'Impossible d’enregistrer la demande de clôture.');
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const result = await authService.login(req.body || {});
    res.json({ ...result, user: addUserAccessFlags(result.user) });
  } catch (error) {
    sendApiError(res, error, 'Impossible de se connecter.');
  }
});

app.post('/api/auth/password-reset/request', async (req, res) => {
  if (!notificationDelivery.isConfigured().email) {
    return res.status(503).json({ error: 'La récupération par e-mail n’est pas encore configurée.' });
  }
  try {
    const appUrl = new URL(process.env.PUBLIC_APP_URL || 'https://generation-liaison.onrender.com');
    if (appUrl.protocol !== 'https:' || appUrl.username || appUrl.password) {
      throw new Error('PUBLIC_APP_URL doit être une URL HTTPS valide.');
    }
    const email = req.body?.email;
    const token = await authService.createPasswordReset(email);
    if (token) {
      const link = new URL('/reset-password.html', appUrl);
      link.hash = token;
      notificationDelivery.sendPasswordResetEmail(email.trim().toLowerCase(), link.toString()).catch(error => {
        console.error('Échec de l’envoi du lien de réinitialisation :', error.message);
      });
    }
    return res.json({ message: 'Si un compte actif correspond à cette adresse, un e-mail sera envoyé.' });
  } catch (error) {
    return sendApiError(res, error, 'Impossible de demander la réinitialisation.');
  }
});

app.post('/api/auth/password-reset/confirm', async (req, res) => {
  try {
    await authService.resetPassword(req.body?.token, req.body?.password);
    return res.json({ message: 'Votre mot de passe a été modifié. Vous pouvez vous connecter.' });
  } catch (error) {
    return sendApiError(res, error, 'Impossible de modifier le mot de passe.');
  }
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.authUser });
});

app.get('/api/calendar/google/callback', async (req, res) => {
  const { code, state, error: authorizationError } = req.query;
  if (typeof state !== 'string' || state.length > 256) {
    return redirectCalendarResult(res, 'error');
  }
  try {
    await authService.ensureSchema();
    const { rows } = await pool.query(
      `DELETE FROM app_google_calendar_oauth_states
       WHERE state_hash = $1 AND expires_at > CURRENT_TIMESTAMP
       RETURNING user_id`,
      [hashOAuthState(state)]
    );
    if (!rows[0]) return redirectCalendarResult(res, 'error');
    if (authorizationError || typeof code !== 'string' || !code) {
      return redirectCalendarResult(res, 'denied');
    }

    const refreshToken = await googleCalendar.exchangeAuthorizationCode(code);
    const { rows: updated } = await pool.query(
      `UPDATE app_users
       SET google_calendar_refresh_token = $2,
           google_calendar_connected_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND role = 'pro'
         AND verification_status = 'approved' AND is_active = TRUE
       RETURNING id`,
      [rows[0].user_id, googleCalendar.encryptRefreshToken(refreshToken)]
    );
    return redirectCalendarResult(res, updated[0] ? 'connected' : 'error');
  } catch (callbackError) {
    console.error('Connexion Google Calendar impossible :', callbackError);
    return redirectCalendarResult(res, 'error');
  }
});

app.get('/api/calendar/google/status', requireAuth, async (req, res) => {
  if (req.authUser.role !== 'pro') {
    return res.status(403).json({ error: 'La connexion Google Calendar est réservée aux intervenants.' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT google_calendar_connected_at
       FROM app_users WHERE id = $1`,
      [req.authUser.id]
    );
    res.json({
      configured: googleCalendar.isConfigured(),
      connected: Boolean(rows[0]?.google_calendar_connected_at),
      connectedAt: rows[0]?.google_calendar_connected_at || null
    });
  } catch (error) {
    sendApiError(res, error, 'Impossible de vérifier la connexion Google Calendar.');
  }
});

app.post('/api/calendar/google/connect', requireAuth, async (req, res) => {
  if (req.authUser.role !== 'pro') {
    return res.status(403).json({ error: 'La connexion Google Calendar est réservée aux intervenants.' });
  }
  if (!googleCalendar.isConfigured()) {
    return res.status(503).json({ error: 'Google Calendar n’est pas encore configuré par l’administrateur.' });
  }
  const state = randomBytes(32).toString('base64url');
  try {
    await pool.query(
      `DELETE FROM app_google_calendar_oauth_states
       WHERE user_id = $1 OR expires_at <= CURRENT_TIMESTAMP`,
      [req.authUser.id]
    );
    await pool.query(
      `INSERT INTO app_google_calendar_oauth_states (state_hash, user_id, expires_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP + INTERVAL '10 minutes')`,
      [hashOAuthState(state), req.authUser.id]
    );
    res.json({ authorizationUrl: googleCalendar.authorizationUrl(state) });
  } catch (error) {
    sendApiError(res, error, 'Impossible de démarrer la connexion Google Calendar.');
  }
});

app.get('/api/directory/profile', requireAuth, async (req, res) => {
  if (req.authUser.role !== 'pro') {
    return res.status(403).json({ error: 'Le profil annuaire est réservé aux intervenants.' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT directory_listed, directory_activity, directory_description,
              profile_photo_url,
              appointment_duration_minutes, appointment_timezone, appointment_weekly_hours,
              google_calendar_connected_at, home_latitude, home_longitude, service_radius_km
       FROM app_users WHERE id = $1`,
      [req.authUser.id]
    );
    const profile = rows[0];
    if (!profile) return res.status(404).json({ error: 'Compte intervenant introuvable.' });
    res.set('Cache-Control', 'private, no-store');
    res.json({
      listed: profile.directory_listed,
      activity: profile.directory_activity || '',
      description: profile.directory_description || '',
      photoUrl: profile.profile_photo_url || null,
      durationMinutes: profile.appointment_duration_minutes,
      timeZone: profile.appointment_timezone,
      weeklyAvailability: profile.appointment_weekly_hours,
      calendarConnected: Boolean(profile.google_calendar_connected_at),
      hasHomeLocation: profile.home_latitude !== null && profile.home_longitude !== null,
      serviceRadiusKm: profile.service_radius_km
    });
  } catch (error) {
    sendApiError(res, error, 'Impossible de charger votre profil annuaire.');
  }
});

app.put('/api/directory/profile', requireAuth, async (req, res) => {
  if (req.authUser.role !== 'pro') {
    return res.status(403).json({ error: 'Le profil annuaire est réservé aux intervenants.' });
  }
  const { listed, activity, description, photoUrl, durationMinutes, timeZone, weeklyAvailability } = req.body || {};
  if (typeof listed !== 'boolean' || !Number.isInteger(durationMinutes) ||
      durationMinutes < 15 || durationMinutes > 240 || durationMinutes % 15 !== 0 ||
      !isValidTimeZone(timeZone)) {
    return res.status(400).json({ error: 'Vérifiez votre choix d’affichage, la durée et le fuseau horaire.' });
  }
  let normalizedActivity = null;
  let normalizedDescription = null;
  let normalizedPhotoUrl = null;
  let normalizedHours;
  try {
    if (typeof activity !== 'string' || activity.trim().length > 160 ||
        typeof description !== 'string' || description.trim().length > 500) {
      throw new AuthError(400, 'L’activité est limitée à 160 caractères et la présentation à 500 caractères.');
    }
    normalizedActivity = activity.trim() || null;
    normalizedDescription = description.trim() || null;
    normalizedPhotoUrl = normalizeProfilePhotoUrl(photoUrl);
    normalizedHours = normalizeWeeklyAvailability(weeklyAvailability);
  } catch (error) {
    return sendApiError(res, error, 'Vérifiez votre activité, votre photo et vos horaires.');
  }

  if (listed && (!normalizedActivity || normalizedHours.length === 0)) {
    return res.status(400).json({ error: 'Pour publier votre profil, indiquez une activité et au moins un horaire de rendez-vous.' });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE app_users
       SET directory_listed = $2,
           directory_activity = $3,
           directory_description = $4,
           profile_photo_url = $5,
           appointment_duration_minutes = $6,
           appointment_timezone = $7,
           appointment_weekly_hours = $8::jsonb
       WHERE id = $1 AND role = 'pro'
         AND ($2 = FALSE OR (
           verification_status = 'approved'
           AND is_active = TRUE
           AND home_latitude IS NOT NULL
           AND home_longitude IS NOT NULL
           AND google_calendar_refresh_token IS NOT NULL
         ))
       RETURNING directory_listed` ,
      [
        req.authUser.id,
        listed,
        normalizedActivity,
        normalizedDescription,
        normalizedPhotoUrl,
        durationMinutes,
        timeZone,
        JSON.stringify(normalizedHours)
      ]
    );
    if (!rows[0]) {
      return res.status(409).json({
        error: 'Pour publier l’annuaire, votre dossier doit être validé, votre domicile enregistré et votre agenda Google connecté.'
      });
    }
    res.json({ listed: rows[0].directory_listed });
  } catch (error) {
    sendApiError(res, error, 'Impossible d’enregistrer votre profil annuaire.');
  }
});

app.post('/api/directory/search', requireAuth, async (req, res) => {
  if (!['senior', 'aidant'].includes(req.authUser.role)) {
    return res.status(403).json({ error: 'L’annuaire est réservé aux seniors et aux aidants.' });
  }
  const query = typeof req.body?.q === 'string' ? req.body.q.trim() : '';
  const latitude = req.body?.latitude === undefined || req.body.latitude === null
    ? null
    : Number(req.body.latitude);
  const longitude = req.body?.longitude === undefined || req.body.longitude === null
    ? null
    : Number(req.body.longitude);
  const limit = Math.min(30, Math.max(1, Number.parseInt(req.body?.limit, 10) || 20));
  const offset = Math.max(0, Number.parseInt(req.body?.offset, 10) || 0);
  if (query.length > 120 || offset > 10000 ||
      ((latitude === null) !== (longitude === null)) ||
      (latitude !== null && !hasValidCoordinates(latitude, longitude))) {
    return res.status(400).json({ error: 'Vérifiez le filtre ou la position de recherche.' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT id, name, directory_activity, directory_description, profile_photo_url, service_radius_km,
              CASE WHEN $2::double precision IS NULL THEN NULL ELSE
                round((6371 * 2 * asin(sqrt(LEAST(1,
                  power(sin(radians(home_latitude - $2) / 2), 2) +
                  cos(radians($2)) * cos(radians(home_latitude)) *
                  power(sin(radians(home_longitude - $3) / 2), 2)
                ))))::numeric)::integer
              END AS distance_km
       FROM app_users
       WHERE role = 'pro'
         AND is_active = TRUE
         AND verification_status = 'approved'
         AND directory_listed = TRUE
         AND google_calendar_refresh_token IS NOT NULL
         AND home_latitude IS NOT NULL AND home_longitude IS NOT NULL
         AND ($1 = '' OR name ILIKE '%' || $1 || '%'
              OR directory_activity ILIKE '%' || $1 || '%'
              OR directory_description ILIKE '%' || $1 || '%')
       ORDER BY CASE WHEN verification_status = 'approved' THEN 0 ELSE 1 END,
                distance_km ASC NULLS LAST, created_at DESC
       LIMIT $4 OFFSET $5`,
      [query, latitude, longitude, limit + 1, offset]
    );
    const hasMore = rows.length > limit;
    res.set('Cache-Control', 'private, no-store');
    res.json({
      professionals: rows.slice(0, limit).map(row => ({
        id: row.id,
        name: row.name,
        activity: row.directory_activity,
        description: row.directory_description,
        photoUrl: row.profile_photo_url || null,
        serviceRadiusKm: row.service_radius_km,
        verified: true,
        distanceKm: row.distance_km
      })),
      hasMore,
      nextOffset: hasMore ? offset + limit : null
    });
  } catch (error) {
    sendApiError(res, error, 'Impossible de charger l’annuaire des professionnels.');
  }
});

app.get('/api/directory/:professionalId/availability', requireAuth, async (req, res) => {
  if (!['senior', 'aidant'].includes(req.authUser.role)) {
    return res.status(403).json({ error: 'Les disponibilités sont réservées aux seniors et aux aidants.' });
  }
  const date = req.query.date;
  if (!isValidUuid(req.params.professionalId) || !isValidIsoDate(date)) {
    return res.status(400).json({ error: 'Choisissez un intervenant et une date valides.' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT appointment_timezone, appointment_weekly_hours, appointment_duration_minutes,
              google_calendar_refresh_token
       FROM app_users
       WHERE id = $1 AND role = 'pro' AND is_active = TRUE
         AND verification_status = 'approved' AND directory_listed = TRUE`,
      [req.params.professionalId]
    );
    const professional = rows[0];
    if (!professional?.google_calendar_refresh_token) {
      return res.status(404).json({ error: 'Cet intervenant n’est plus disponible dans l’annuaire.' });
    }
    const range = getDailyRange(date, professional.appointment_timezone);
    const now = new Date();
    const maximumDate = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
    if (!range.start || !range.end || range.end <= now || range.start > maximumDate) {
      return res.status(400).json({ error: 'Choisissez une date entre aujourd’hui et dans 60 jours.' });
    }
    const accessToken = await getCalendarAccessToken(professional.google_calendar_refresh_token);
    const busyIntervals = await getProfessionalBusyIntervals(
      pool,
      req.params.professionalId,
      range.start,
      range.end,
      accessToken
    );
    res.set('Cache-Control', 'private, no-store');
    res.json({
      date,
      timeZone: professional.appointment_timezone,
      durationMinutes: professional.appointment_duration_minutes,
      slots: availableSlots({
        date,
        timeZone: professional.appointment_timezone,
        weeklyAvailability: normalizeWeeklyAvailability(professional.appointment_weekly_hours),
        durationMinutes: professional.appointment_duration_minutes,
        busyIntervals
      }).filter(slot => new Date(slot.start) <= maximumDate)
    });
  } catch (error) {
    sendApiError(res, error, 'Impossible de vérifier les disponibilités Google Calendar.');
  }
});

app.post('/api/directory/:professionalId/bookings', requireAuth, async (req, res) => {
  if (!['senior', 'aidant'].includes(req.authUser.role)) {
    return res.status(403).json({ error: 'La réservation est réservée aux seniors et aux aidants.' });
  }
  if (!isValidUuid(req.params.professionalId) ||
      typeof req.body?.start !== 'string' ||
      !Number.isFinite(Date.parse(req.body.start)) ||
      new Date(req.body.start).toISOString() !== req.body.start) {
    return res.status(400).json({ error: 'Choisissez un créneau valide dans l’annuaire.' });
  }

  let client;
  let accessToken;
  let createdEventId;
  let bookingId;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id, appointment_timezone, appointment_weekly_hours,
              appointment_duration_minutes, google_calendar_refresh_token
       FROM app_users
       WHERE id = $1 AND role = 'pro' AND is_active = TRUE
         AND verification_status = 'approved' AND directory_listed = TRUE
         AND home_latitude IS NOT NULL AND home_longitude IS NOT NULL
       FOR UPDATE`,
      [req.params.professionalId]
    );
    const professional = rows[0];
    if (!professional?.google_calendar_refresh_token) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Cet intervenant n’est plus disponible dans l’annuaire.' });
    }

    const start = new Date(req.body.start);
    const appointmentDate = dateInTimeZone(start, professional.appointment_timezone);
    const range = getDailyRange(appointmentDate, professional.appointment_timezone);
    const maximumDate = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
    if (!range.start || !range.end || start <= new Date() || start >= range.end ||
        range.end <= new Date() || start > maximumDate ||
        range.start > maximumDate) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Choisissez un créneau futur, dans les 60 prochains jours.' });
    }

    accessToken = await getCalendarAccessToken(professional.google_calendar_refresh_token);
    const busyIntervals = await getProfessionalBusyIntervals(
      client,
      professional.id,
      range.start,
      range.end,
      accessToken
    );
    const requestedSlots = availableSlots({
      date: appointmentDate,
      timeZone: professional.appointment_timezone,
      weeklyAvailability: normalizeWeeklyAvailability(professional.appointment_weekly_hours),
      durationMinutes: professional.appointment_duration_minutes,
      busyIntervals
    });
    const selectedSlot = requestedSlots.find(slot => slot.start === req.body.start);
    if (!selectedSlot) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Ce créneau vient d’être pris ou n’est plus disponible.' });
    }

    bookingId = randomUUID();
    createdEventId = await googleCalendar.createHoldEvent(accessToken, {
      start: new Date(selectedSlot.start),
      end: new Date(selectedSlot.end),
      bookingId
    });
    await client.query(
      `INSERT INTO app_directory_bookings
         (id, requester_user_id, professional_user_id, scheduled_at,
          duration_minutes, google_event_id, hold_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP + INTERVAL '15 minutes')`,
      [
        bookingId,
        req.authUser.id,
        professional.id,
        selectedSlot.start,
        professional.appointment_duration_minutes,
        createdEventId
      ]
    );
    await insertAppNotification(
      client,
      professional.id,
      'directory_booking',
      'Nouvelle demande de rendez-vous',
      'Une nouvelle demande de rendez-vous attend votre réponse dans l’application.',
      'directory_booking',
      bookingId
    );
    await insertAppNotification(
      client,
      req.authUser.id,
      'directory_booking',
      'Demande de rendez-vous envoyée',
      'Votre créneau est réservé provisoirement pendant 15 minutes, dans l’attente de la réponse du professionnel.',
      'directory_booking',
      bookingId
    );
    await client.query('COMMIT');
    return res.status(201).json({
      id: bookingId,
      status: 'pending',
      holdExpiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString()
    });
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    if (createdEventId && accessToken) {
      try {
        await googleCalendar.deleteHoldEvent(accessToken, createdEventId);
      } catch (cleanupError) {
        console.error('Suppression du blocage Google Calendar impossible :', cleanupError);
      }
    }
    return sendApiError(res, error, 'Impossible de réserver ce créneau.');
  } finally {
    if (client) client.release();
  }
});

app.get('/api/directory/bookings', requireAuth, async (req, res) => {
  if (!['senior', 'aidant', 'pro'].includes(req.authUser.role)) {
    return res.status(403).json({ error: 'Accès aux demandes de rendez-vous refusé.' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT booking.id, booking.requester_user_id, booking.professional_user_id,
              booking.scheduled_at, booking.duration_minutes, booking.status,
              booking.hold_expires_at, booking.created_at,
              requester.name AS requester_name, professional.name AS professional_name,
              professional.appointment_timezone
       FROM app_directory_bookings booking
       JOIN app_users requester ON requester.id = booking.requester_user_id
       JOIN app_users professional ON professional.id = booking.professional_user_id
       WHERE ($1 = 'pro' AND booking.professional_user_id = $2)
          OR ($1 IN ('senior', 'aidant') AND booking.requester_user_id = $2)
       ORDER BY booking.scheduled_at DESC
       LIMIT 100`,
      [req.authUser.role, req.authUser.id]
    );
    res.set('Cache-Control', 'private, no-store');
    res.json({
      bookings: rows.map(row => ({
        id: row.id,
        professionalId: row.professional_user_id,
        requesterId: row.requester_user_id,
        professionalName: row.professional_name,
        requesterName: row.requester_name,
        timeZone: row.appointment_timezone,
        scheduledAt: row.scheduled_at,
        durationMinutes: row.duration_minutes,
        status: row.status,
        holdExpiresAt: row.hold_expires_at,
        createdAt: row.created_at
      }))
    });
  } catch (error) {
    sendApiError(res, error, 'Impossible de charger les demandes de rendez-vous.');
  }
});

app.patch('/api/directory/bookings/:bookingId', requireAuth, async (req, res) => {
  if (req.authUser.role !== 'pro') {
    return res.status(403).json({ error: 'Seul le professionnel peut répondre à cette demande.' });
  }
  if (!isValidUuid(req.params.bookingId) ||
      !['confirmed', 'declined'].includes(req.body?.decision)) {
    return res.status(400).json({ error: 'Décision ou demande invalide.' });
  }

  let client;
  let accessToken;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT booking.id, booking.requester_user_id, booking.professional_user_id,
              booking.scheduled_at, booking.google_event_id, booking.status,
              booking.hold_expires_at, professional.google_calendar_refresh_token,
              requester.email AS requester_email
       FROM app_directory_bookings booking
       JOIN app_users professional ON professional.id = booking.professional_user_id
       JOIN app_users requester ON requester.id = booking.requester_user_id
       WHERE booking.id = $1 AND booking.professional_user_id = $2
       FOR UPDATE OF booking`,
      [req.params.bookingId, req.authUser.id]
    );
    const booking = rows[0];
    if (!booking || booking.status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Demande introuvable ou déjà traitée.' });
    }
    if (new Date(booking.hold_expires_at) <= new Date()) {
      await client.query(
        `UPDATE app_directory_bookings
         SET status = 'expired', hold_expires_at = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [booking.id]
      );
      await insertAppNotification(
        client,
        booking.requester_user_id,
        'directory_booking',
        'Réservation provisoire expirée',
        'Le délai de réponse de 15 minutes est dépassé. Choisissez un autre créneau si besoin.',
        'directory_booking',
        booking.id
      );
      await client.query('COMMIT');
      try {
        accessToken = await getCalendarAccessToken(booking.google_calendar_refresh_token);
        await googleCalendar.deleteHoldEvent(accessToken, booking.google_event_id);
      } catch (cleanupError) {
        console.error(`Suppression du blocage expiré ${booking.id} impossible :`, cleanupError);
      }
      return res.status(409).json({ error: 'La réservation provisoire a expiré. Le créneau doit être réservé à nouveau.' });
    }

    accessToken = await getCalendarAccessToken(booking.google_calendar_refresh_token);
    if (req.body.decision === 'confirmed') {
      await googleCalendar.confirmHoldEvent(accessToken, booking.google_event_id, booking.requester_email);
    } else {
      await googleCalendar.deleteHoldEvent(accessToken, booking.google_event_id);
    }
    await client.query(
      `UPDATE app_directory_bookings
       SET status = $2, hold_expires_at = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [booking.id, req.body.decision]
    );
    const notification = req.body.decision === 'confirmed'
      ? ['Rendez-vous confirmé', 'Le professionnel a confirmé votre demande de rendez-vous.']
      : ['Demande refusée', 'Le professionnel ne peut pas accepter ce créneau. Vous pouvez en choisir un autre.'];
    await insertAppNotification(
      client,
      booking.requester_user_id,
      'directory_booking',
      notification[0],
      notification[1],
      'directory_booking',
      booking.id
    );
    await client.query('COMMIT');
    return res.json({ id: booking.id, status: req.body.decision });
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    return sendApiError(res, error, 'Impossible de traiter cette demande de rendez-vous.');
  } finally {
    if (client) client.release();
  }
});

app.get('/api/professional-verification/documents', requireAuth, async (req, res) => {
  if (req.authUser.role !== 'pro') {
    return res.status(403).json({ error: 'Cette vérification est réservée aux comptes intervenants.' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT document_type, content_type, uploaded_at
       FROM app_professional_verification_documents
       WHERE user_id = $1
       ORDER BY document_type`,
      [req.authUser.id]
    );
    res.set('Cache-Control', 'private, no-store');
    res.json({
      verificationStatus: req.authUser.verificationStatus,
      requiredDocuments: ['identity', 'kbis'],
      documents: rows.map(row => ({
        type: row.document_type,
        contentType: row.content_type,
        uploadedAt: row.uploaded_at
      }))
    });
  } catch (error) {
    sendApiError(res, error, 'Impossible de charger l’état de vos justificatifs.');
  }
});

app.put(
  '/api/professional-verification/documents/:documentType',
  requireAuth,
  express.raw({ type: ['application/pdf', 'image/jpeg', 'image/png'], limit: '10mb' }),
  async (req, res) => {
    if (req.authUser.role !== 'pro') {
      return res.status(403).json({ error: 'Cette vérification est réservée aux comptes intervenants.' });
    }
    if (!['identity', 'kbis'].includes(req.params.documentType)) {
      return res.status(400).json({ error: 'Type de justificatif invalide.' });
    }
    if (req.authUser.verificationStatus === 'approved') {
      return res.status(409).json({ error: 'Votre dossier est déjà validé.' });
    }
    const contentType = req.get('content-type')?.split(';')[0].trim().toLowerCase();
    if (!matchesDocumentSignature(req.body, contentType)) {
      return res.status(400).json({ error: 'Utilisez un fichier PDF, JPEG ou PNG valide (10 Mo maximum).' });
    }

    let client;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO app_professional_verification_documents
           (id, user_id, document_type, content_type, file_data)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id, document_type) DO UPDATE
         SET content_type = EXCLUDED.content_type,
             file_data = EXCLUDED.file_data,
             uploaded_at = CURRENT_TIMESTAMP`,
        [randomUUID(), req.authUser.id, req.params.documentType, contentType, req.body]
      );
      await client.query(
        `UPDATE app_users
         SET verification_status = 'pending',
             verification_reviewed_at = NULL,
             verification_reviewed_by = NULL,
             verification_rejection_reason = NULL
         WHERE id = $1 AND verification_status = 'rejected'`,
        [req.authUser.id]
      );
      await client.query('COMMIT');
      res.json({ documentType: req.params.documentType, uploaded: true });
    } catch (error) {
      if (client) await client.query('ROLLBACK');
      sendApiError(res, error, 'Impossible d’enregistrer ce justificatif.');
    } finally {
      if (client) client.release();
    }
  }
);

app.get('/api/legal-guardian/documents', requireAuth, async (req, res) => {
  if (req.authUser.role !== 'aidant' || !req.authUser.isLegalGuardian) {
    return res.status(403).json({ error: 'Cette vérification est réservée aux tuteurs légaux.' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT document_type, content_type, uploaded_at
       FROM app_legal_guardian_verification_documents
       WHERE user_id = $1
       ORDER BY document_type`,
      [req.authUser.id]
    );
    res.set('Cache-Control', 'private, no-store');
    res.json({
      verificationStatus: req.authUser.guardianVerificationStatus,
      requiredDocuments: ['identity', 'guardianship'],
      documents: rows.map(row => ({
        type: row.document_type,
        contentType: row.content_type,
        uploadedAt: row.uploaded_at
      }))
    });
  } catch (error) {
    sendApiError(res, error, 'Impossible de charger l’état de vos justificatifs de tutelle.');
  }
});

app.put(
  '/api/legal-guardian/documents/:documentType',
  requireAuth,
  express.raw({ type: ['application/pdf', 'image/jpeg', 'image/png'], limit: '10mb' }),
  async (req, res) => {
    if (req.authUser.role !== 'aidant' || !req.authUser.isLegalGuardian) {
      return res.status(403).json({ error: 'Cette vérification est réservée aux tuteurs légaux.' });
    }
    if (!['identity', 'guardianship'].includes(req.params.documentType)) {
      return res.status(400).json({ error: 'Type de justificatif invalide.' });
    }
    if (req.authUser.guardianVerificationStatus === 'approved') {
      return res.status(409).json({ error: 'Votre tutelle est déjà vérifiée.' });
    }
    const contentType = req.get('content-type')?.split(';')[0].trim().toLowerCase();
    if (!matchesDocumentSignature(req.body, contentType)) {
      return res.status(400).json({ error: 'Utilisez un fichier PDF, JPEG ou PNG valide (10 Mo maximum).' });
    }

    let client;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO app_legal_guardian_verification_documents
           (id, user_id, document_type, content_type, file_data)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id, document_type) DO UPDATE
         SET content_type = EXCLUDED.content_type,
             file_data = EXCLUDED.file_data,
             uploaded_at = CURRENT_TIMESTAMP`,
        [randomUUID(), req.authUser.id, req.params.documentType, contentType, req.body]
      );
      await client.query(
        `UPDATE app_users
         SET guardian_verification_status = 'pending',
             guardian_reviewed_at = NULL,
             guardian_reviewed_by = NULL
         WHERE id = $1 AND guardian_verification_status = 'rejected'`,
        [req.authUser.id]
      );
      await client.query('COMMIT');
      res.json({ documentType: req.params.documentType, uploaded: true });
    } catch (error) {
      if (client) await client.query('ROLLBACK');
      sendApiError(res, error, 'Impossible d’enregistrer ce justificatif de tutelle.');
    } finally {
      if (client) client.release();
    }
  }
);

app.get('/api/aidant/seniors', requireAuth, async (req, res) => {
  if (req.authUser.role !== 'aidant') {
    return res.status(403).json({ error: 'Cette liste est réservée aux comptes aidants.' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT profile.id, profile.name
       FROM app_aidant_senior_links link
       JOIN app_users senior
         ON senior.senior_id = link.senior_profile_id
        AND senior.role = 'senior'
        AND senior.is_active = TRUE
       JOIN senior_profiles profile ON profile.id = link.senior_profile_id
       WHERE link.aidant_user_id = $1
         AND link.suspended_at IS NULL
       ORDER BY profile.name`,
      [req.authUser.id]
    );
    res.set('Cache-Control', 'private, no-store');
    res.json({ seniors: rows.map(row => ({ id: row.id, name: row.name })) });
  } catch (error) {
    sendApiError(res, error, 'Impossible de charger les profils seniors associés.');
  }
});

app.get('/api/senior-links', requireAuth, async (req, res) => {
  const { id, role } = req.authUser;
  if (!['aidant', 'senior'].includes(role)) {
    return res.status(403).json({ error: 'Cette fonction est réservée aux seniors et aux aidants.' });
  }
  try {
    const [links, requests] = await Promise.all([
      pool.query(
        `SELECT link.senior_profile_id, link.aidant_user_id, senior.id AS senior_user_id, senior.name AS senior_name,
                aidant.name AS aidant_name, link.suspended_at,
                removal.id AS removal_id, removal.requested_by, removal.code_sent_at
         FROM app_aidant_senior_links link
         JOIN app_users senior ON senior.senior_id = link.senior_profile_id AND senior.role = 'senior'
         JOIN app_users aidant ON aidant.id = link.aidant_user_id
         LEFT JOIN app_aidant_unlink_requests removal
           ON removal.aidant_user_id = aidant.id AND removal.senior_user_id = senior.id
          AND removal.status = 'pending'
         WHERE ($2 = 'senior' AND senior.id = $1) OR ($2 = 'aidant' AND aidant.id = $1)
         ORDER BY senior.name, aidant.name`,
        [id, role]
      ),
      pool.query(
        `SELECT request.id, aidant.name AS aidant_name, aidant.email AS aidant_email,
                request.created_at
         FROM app_aidant_link_requests request
         JOIN app_users aidant ON aidant.id = request.aidant_user_id
         WHERE request.senior_user_id = $1 AND request.status = 'pending'
           AND aidant.is_active = TRUE AND aidant.is_legal_guardian = FALSE
         ORDER BY request.created_at`,
        [id]
      )
    ]);
    res.set('Cache-Control', 'private, no-store');
    res.json({ links: links.rows, requests: role === 'senior' ? requests.rows : [] });
  } catch (error) {
    sendApiError(res, error, 'Impossible de charger les associations.');
  }
});

app.post('/api/senior-links/requests', requireAuth, async (req, res) => {
  if (req.authUser.role !== 'aidant' || req.authUser.isLegalGuardian) {
    return res.status(403).json({ error: 'Les tuteurs légaux doivent contacter l’administration pour associer un profil.' });
  }
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Saisissez une adresse e-mail valide.' });
  }
  const now = Date.now();
  const recent = (seniorLinkRequestTimes.get(req.authUser.id) || []).filter(time => now - time < 60_000);
  if (recent.length >= 5) return res.status(429).json({ error: 'Trop de demandes. Réessayez dans une minute.' });
  recent.push(now);
  seniorLinkRequestTimes.set(req.authUser.id, recent);
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO app_aidant_link_requests (id, aidant_user_id, senior_user_id)
       SELECT $1, $2, senior.id FROM app_users senior
       WHERE lower(senior.email) = $3 AND senior.role = 'senior' AND senior.is_active = TRUE
         AND NOT EXISTS (
           SELECT 1 FROM app_aidant_senior_links link
           WHERE link.aidant_user_id = $2 AND link.senior_profile_id = senior.senior_id
         )
       ON CONFLICT (aidant_user_id, senior_user_id) WHERE status = 'pending' DO NOTHING
       RETURNING id, senior_user_id`,
      [randomUUID(), req.authUser.id, email]
    );
    if (rows[0]) {
      await insertAppNotification(client, rows[0].senior_user_id, 'senior_link_request',
        'Demande de partage', 'Une demande d’accès à votre profil vous attend dans votre espace senior.',
        'senior_link', rows[0].id);
    }
    await client.query('COMMIT');
    res.status(202).json({ message: 'Si ce compte senior existe et peut recevoir la demande, elle lui sera présentée dans son espace.' });
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    sendApiError(res, error, 'Impossible d’envoyer la demande.');
  } finally {
    if (client) client.release();
  }
});

app.post('/api/senior-links/requests/:id/decision', requireAuth, async (req, res) => {
  if (req.authUser.role !== 'senior') return res.status(403).json({ error: 'Action réservée au senior concerné.' });
  if (!isValidUuid(req.params.id) || !['accept', 'decline'].includes(req.body?.decision)) {
    return res.status(400).json({ error: 'Demande ou décision invalide.' });
  }
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT request.id, request.aidant_user_id FROM app_aidant_link_requests request
       JOIN app_users aidant ON aidant.id = request.aidant_user_id
       WHERE request.id = $1 AND request.senior_user_id = $2 AND request.status = 'pending'
         AND aidant.is_active = TRUE AND aidant.is_legal_guardian = FALSE
       FOR UPDATE OF request`,
      [req.params.id, req.authUser.id]
    );
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Demande introuvable ou déjà traitée.' });
    }
    if (req.body.decision === 'accept') {
      const link = await client.query(
        `INSERT INTO app_aidant_senior_links (aidant_user_id, senior_profile_id, linked_by)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING senior_profile_id`,
        [rows[0].aidant_user_id, req.authUser.seniorId, req.authUser.id]
      );
      if (!link.rowCount) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Une association existe déjà ou est suspendue.' });
      }
    }
    await client.query(
      `UPDATE app_aidant_link_requests SET status = $2, resolved_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [req.params.id, req.body.decision === 'accept' ? 'accepted' : 'declined']
    );
    await insertAppNotification(client, rows[0].aidant_user_id, 'senior_link_decision',
      'Réponse à votre demande', 'La personne a répondu à votre demande d’accès. Consultez votre espace.',
      'senior_link', req.params.id);
    await client.query('COMMIT');
    res.json({ accepted: req.body.decision === 'accept' });
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    sendApiError(res, error, 'Impossible de traiter la demande.');
  } finally {
    if (client) client.release();
  }
});

app.post('/api/senior-links/removals', requireAuth, async (req, res) => {
  const otherId = req.body?.otherUserId;
  if (!['senior', 'aidant'].includes(req.authUser.role) || !isValidUuid(otherId)) {
    return res.status(400).json({ error: 'Association invalide.' });
  }
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const seniorId = req.authUser.role === 'senior' ? req.authUser.id : otherId;
    const aidantId = req.authUser.role === 'aidant' ? req.authUser.id : otherId;
    const { rows } = await client.query(
      `SELECT link.senior_profile_id FROM app_aidant_senior_links link
       JOIN app_users senior ON senior.senior_id = link.senior_profile_id AND senior.role = 'senior'
       WHERE senior.id = $1 AND link.aidant_user_id = $2 FOR UPDATE OF link`,
      [seniorId, aidantId]
    );
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Association introuvable.' });
    }
    if (req.authUser.role === 'senior') {
      await client.query(
        `UPDATE app_aidant_senior_links SET suspended_at = COALESCE(suspended_at, CURRENT_TIMESTAMP)
         WHERE aidant_user_id = $1 AND senior_profile_id = $2`,
        [aidantId, rows[0].senior_profile_id]
      );
    }
    await client.query(
      `INSERT INTO app_aidant_unlink_requests (id, aidant_user_id, senior_user_id, requested_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (aidant_user_id, senior_user_id) WHERE status = 'pending'
       DO UPDATE SET requested_by = CASE WHEN EXCLUDED.requested_by = 'senior' THEN 'senior'
                                        ELSE app_aidant_unlink_requests.requested_by END`,
      [randomUUID(), aidantId, seniorId, req.authUser.role]
    );
    await client.query('COMMIT');
    res.status(202).json({ suspended: req.authUser.role === 'senior' });
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    sendApiError(res, error, 'Impossible de demander le retrait.');
  } finally {
    if (client) client.release();
  }
});

app.get('/api/admin/senior-link-removals', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT request.id, request.requested_by, request.created_at, request.code_sent_at,
              aidant.name AS aidant_name, senior.name AS senior_name,
              aidant.id AS aidant_id, senior.senior_id
       FROM app_aidant_unlink_requests request
       JOIN app_users aidant ON aidant.id = request.aidant_user_id
       JOIN app_users senior ON senior.id = request.senior_user_id
       WHERE request.status = 'pending' ORDER BY request.created_at`
    );
    res.set('Cache-Control', 'private, no-store');
    res.json({ requests: rows });
  } catch (error) {
    sendApiError(res, error, 'Impossible de charger les demandes de retrait.');
  }
});

app.post('/api/admin/senior-link-removals/:id/send-code', requireAuth, requireAdmin, async (req, res) => {
  if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Demande invalide.' });
  if (!notificationDelivery.isConfigured().email) {
    return res.status(503).json({ error: 'L’envoi d’e-mails n’est pas configuré.' });
  }
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT request.id, request.code_sent_at, senior.email
       FROM app_aidant_unlink_requests request
       JOIN app_users senior ON senior.id = request.senior_user_id
       WHERE request.id = $1 AND request.requested_by = 'senior'
         AND request.status = 'pending' AND senior.is_active = TRUE
       FOR UPDATE OF request`,
      [req.params.id]
    );
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Demande de senior introuvable.' });
    }
    if (rows[0].code_sent_at && Date.now() - new Date(rows[0].code_sent_at).getTime() < 60_000) {
      await client.query('ROLLBACK');
      return res.status(429).json({ error: 'Patientez une minute avant de renvoyer un code.' });
    }
    const code = randomBytes(16).toString('hex');
    await notificationDelivery.sendSeniorUnlinkCode(rows[0].email, code);
    await client.query(
      `UPDATE app_aidant_unlink_requests SET code_hash = $2, code_sent_at = CURRENT_TIMESTAMP,
         code_expires_at = CURRENT_TIMESTAMP + INTERVAL '30 minutes' WHERE id = $1`,
      [req.params.id, createHash('sha256').update(code).digest('hex')]
    );
    await client.query('COMMIT');
    res.json({ sent: true });
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    sendApiError(res, error, 'Impossible d’envoyer le code de confirmation.');
  } finally {
    if (client) client.release();
  }
});

app.post('/api/senior-links/removals/:id/confirm', requireAuth, async (req, res) => {
  if (req.authUser.role !== 'senior') return res.status(403).json({ error: 'Action réservée au senior concerné.' });
  const code = typeof req.body?.code === 'string' ? req.body.code.trim().toLowerCase() : '';
  if (!isValidUuid(req.params.id) || !/^[0-9a-f]{32}$/.test(code)) {
    return res.status(400).json({ error: 'Code de confirmation invalide.' });
  }
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const hash = createHash('sha256').update(code).digest('hex');
    const { rows } = await client.query(
      `UPDATE app_aidant_unlink_requests SET status = 'completed', resolved_at = CURRENT_TIMESTAMP,
         code_hash = NULL, code_expires_at = NULL
       WHERE id = $1 AND senior_user_id = $2 AND requested_by = 'senior' AND status = 'pending'
         AND code_hash = $3 AND code_expires_at > CURRENT_TIMESTAMP
       RETURNING aidant_user_id`,
      [req.params.id, req.authUser.id, hash]
    );
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Code invalide, expiré ou déjà utilisé.' });
    }
    await client.query(
      `DELETE FROM app_aidant_senior_links WHERE aidant_user_id = $1 AND senior_profile_id = $2`,
      [rows[0].aidant_user_id, req.authUser.seniorId]
    );
    await client.query('COMMIT');
    res.json({ removed: true });
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    sendApiError(res, error, 'Impossible de confirmer le retrait.');
  } finally {
    if (client) client.release();
  }
});

app.get('/api/notifications', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT notification.id, notification.notification_type, notification.title,
              notification.message, notification.entity_type, notification.entity_id,
              notification.read_at, notification.created_at,
              CASE
                WHEN notification.entity_type = 'care_visit' THEN (
                  SELECT visit.acceptance_status
                  FROM planning_visits visit
                  WHERE visit.id = notification.entity_id
                )
                WHEN notification.entity_type = 'service_booking' THEN (
                  SELECT booking.status
                  FROM planning_service_bookings booking
                  WHERE booking.id = notification.entity_id
                )
                ELSE NULL
              END AS entity_status
       FROM app_notifications notification
       WHERE notification.user_id = $1
       ORDER BY notification.created_at DESC
       LIMIT 50`,
      [req.authUser.id]
    );
    res.json({
      unreadCount: rows.filter(row => !row.read_at).length,
      notifications: rows.map(row => ({
        id: row.id,
        type: row.notification_type,
        title: row.title,
        message: row.message,
        entityType: row.entity_type,
        entityId: row.entity_id,
        entityStatus: row.entity_status,
        read: Boolean(row.read_at),
        createdAt: row.created_at
      }))
    });
  } catch (error) {
    sendApiError(res, error, 'Impossible de charger vos notifications.');
  }
});

app.post('/api/planning/visits/:visitId/evaluation', requireAuth, requireAidantSeniorContext, async (req, res) => {
  if (!['senior', 'aidant'].includes(req.authUser.role)) {
    return res.status(403).json({ error: 'Seule la personne accompagnée ou son aidant peut évaluer la visite.' });
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.params.visitId)) {
    return res.status(400).json({ error: 'Identifiant de visite invalide.' });
  }
  const { rating, comment } = req.body || {};
  if (!['green', 'orange', 'red'].includes(rating)) {
    return res.status(400).json({ error: 'Choisissez une pastille verte, orange ou rouge.' });
  }
  if (comment !== undefined && (typeof comment !== 'string' || comment.trim().length > 1500)) {
    return res.status(400).json({ error: 'Le commentaire est limité à 1 500 caractères.' });
  }
  const normalizedComment = typeof comment === 'string' ? comment.trim() || null : null;
  if (rating === 'red' && !normalizedComment) {
    return res.status(400).json({ error: 'Expliquez le problème dans un commentaire avant de signaler la visite en rouge.' });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const { rows: visits } = await client.query(
      `SELECT visit.id, visit.organization_id, visit.recipient_id
       FROM planning_visits visit
       JOIN planning_recipients recipient
         ON recipient.id = visit.recipient_id
        AND recipient.organization_id = visit.organization_id
       WHERE visit.id = $1
         AND visit.status = 'completed'
         AND visit.acceptance_status = 'accepted'
         AND recipient.senior_id = $2
         AND recipient.consent_at IS NOT NULL
         AND recipient.consent_revoked_at IS NULL
       FOR UPDATE OF visit, recipient`,
      [req.params.visitId, req.authUser.seniorId]
    );
    if (!visits[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Visite terminée introuvable ou évaluation non autorisée.' });
    }
    const { rows: existing } = await client.query(
      `SELECT rating FROM planning_visit_evaluations
       WHERE visit_id = $1 AND rated_by = $2`,
      [visits[0].id, req.authUser.id]
    );
    const { rows: evaluations } = await client.query(
      `INSERT INTO planning_visit_evaluations
         (id, visit_id, organization_id, recipient_id, rated_by, rating, comment)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (visit_id, rated_by) DO UPDATE
       SET rating = EXCLUDED.rating,
           comment = EXCLUDED.comment,
           updated_at = CURRENT_TIMESTAMP
       RETURNING id, rating, comment`,
      [
        randomUUID(),
        visits[0].id,
        visits[0].organization_id,
        visits[0].recipient_id,
        req.authUser.id,
        rating,
        normalizedComment
      ]
    );

    if (rating === 'red' && existing[0]?.rating !== 'red') {
      const { rows: administrators } = await client.query(
        `SELECT id FROM app_users
         WHERE is_active = TRUE AND lower(email) = ANY($1::text[])`,
        [Array.from(adminEmails)]
      );
      for (const administrator of administrators) {
        await insertAppNotification(
          client,
          administrator.id,
          'visit_evaluation_red',
          'Signalement rouge après une intervention',
          'Une prestation terminée a reçu une évaluation rouge. Consultez le signalement dans l’espace administrateur.',
          'visit_evaluation',
          evaluations[0].id
        );
      }
    }

    await client.query('COMMIT');
    res.json({
      evaluation: {
        rating: evaluations[0].rating,
        comment: evaluations[0].comment
      }
    });
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    sendApiError(res, error, 'Impossible d’enregistrer votre évaluation.');
  } finally {
    if (client) client.release();
  }
});

app.get('/api/notifications/config', requireAuth, (req, res) => {
  res.json(notificationDelivery.publicConfiguration());
});

app.get('/api/notifications/preferences', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT notification_phone, email_notifications_enabled, sms_notifications_enabled
       FROM app_users
       WHERE id = $1`,
      [req.authUser.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Compte introuvable.' });
    res.json({
      phone: rows[0].notification_phone || '',
      emailEnabled: rows[0].email_notifications_enabled,
      smsEnabled: rows[0].sms_notifications_enabled
    });
  } catch (error) {
    sendApiError(res, error, 'Impossible de charger vos préférences de notification.');
  }
});

app.put('/api/notifications/preferences', requireAuth, async (req, res) => {
  const { phone, emailEnabled, smsEnabled } = req.body || {};
  if (typeof emailEnabled !== 'boolean' || typeof smsEnabled !== 'boolean' ||
      (phone !== undefined && phone !== null && typeof phone !== 'string')) {
    return res.status(400).json({ error: 'Vérifiez vos choix de notification.' });
  }
  const normalizedPhone = typeof phone === 'string' ? phone.trim() : '';
  if (smsEnabled && !/^\+[1-9]\d{7,14}$/.test(normalizedPhone)) {
    return res.status(400).json({ error: 'Saisissez un numéro mobile au format international, par exemple +33612345678.' });
  }
  const configuredChannels = notificationDelivery.isConfigured();
  if ((emailEnabled && !configuredChannels.email) || (smsEnabled && !configuredChannels.sms)) {
    return res.status(503).json({ error: 'Le canal demandé n’est pas encore configuré par l’administrateur.' });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE app_users
       SET notification_phone = $2,
           email_notifications_enabled = $3,
           sms_notifications_enabled = $4,
           email_notifications_consent_at = CASE
             WHEN $3 THEN COALESCE(email_notifications_consent_at, CURRENT_TIMESTAMP)
             ELSE NULL
           END,
           sms_notifications_consent_at = CASE
             WHEN $4 THEN COALESCE(sms_notifications_consent_at, CURRENT_TIMESTAMP)
             ELSE NULL
           END
       WHERE id = $1
       RETURNING notification_phone, email_notifications_enabled, sms_notifications_enabled`,
      [req.authUser.id, smsEnabled ? normalizedPhone : null, emailEnabled, smsEnabled]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Compte introuvable.' });
    res.json({
      phone: rows[0].notification_phone || '',
      emailEnabled: rows[0].email_notifications_enabled,
      smsEnabled: rows[0].sms_notifications_enabled
    });
  } catch (error) {
    sendApiError(res, error, 'Impossible d’enregistrer vos préférences de notification.');
  }
});

app.post('/api/notifications/push-subscriptions', requireAuth, async (req, res) => {
  const { platform, token } = req.body || {};
  if (!['android', 'ios', 'web'].includes(platform) ||
      typeof token !== 'string' || !token.trim() || token.length > 8192) {
    return res.status(400).json({ error: 'Inscription push invalide.' });
  }
  const configuredChannels = notificationDelivery.isConfigured();
  if ((platform === 'web' && !configuredChannels.webPush) ||
      (platform !== 'web' && !configuredChannels.nativePush)) {
    return res.status(503).json({ error: 'Les notifications push ne sont pas encore configurées pour cet appareil.' });
  }
  const normalizedToken = token.trim();
  if (platform === 'web' && !isAllowedWebPushSubscription(normalizedToken)) {
    return res.status(400).json({ error: 'Abonnement Web Push invalide ou fournisseur non autorisé.' });
  }
  try {
    await pool.query(
      `INSERT INTO app_push_subscriptions (id, user_id, platform, token)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (platform, token)
       DO UPDATE SET user_id = EXCLUDED.user_id, created_at = CURRENT_TIMESTAMP`,
      [randomUUID(), req.authUser.id, platform, normalizedToken]
    );
    res.status(201).json({ registered: true });
  } catch (error) {
    sendApiError(res, error, 'Impossible d’enregistrer cet appareil pour les notifications.');
  }
});

app.delete('/api/notifications/push-subscriptions', requireAuth, async (req, res) => {
  const { platform, token } = req.body || {};
  if (!['android', 'ios', 'web'].includes(platform) ||
      typeof token !== 'string' || !token.trim() || token.length > 8192) {
    return res.status(400).json({ error: 'Inscription push invalide.' });
  }
  try {
    await pool.query(
      `DELETE FROM app_push_subscriptions
       WHERE user_id = $1 AND platform = $2 AND token = $3`,
      [req.authUser.id, platform, token.trim()]
    );
    res.json({ registered: false });
  } catch (error) {
    sendApiError(res, error, 'Impossible de désactiver les notifications sur cet appareil.');
  }
});

app.patch('/api/notifications/:notificationId', requireAuth, async (req, res) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.params.notificationId)) {
    return res.status(400).json({ error: 'Identifiant de notification invalide.' });
  }
  if (req.body?.read !== true) {
    return res.status(400).json({ error: 'Indiquez que la notification a été lue.' });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE app_notifications
       SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
       WHERE id = $1 AND user_id = $2
       RETURNING id`,
      [req.params.notificationId, req.authUser.id]
    );
    if (!rows[0]) {
      return res.status(404).json({ error: 'Notification introuvable.' });
    }
    res.json({ read: true });
  } catch (error) {
    sendApiError(res, error, 'Impossible de modifier cette notification.');
  }
});

app.put('/api/planning/professional-location', requireAuth, async (req, res) => {
  if (req.authUser.role !== 'pro') {
    return res.status(403).json({ error: 'Le rayon d’intervention est réservé aux comptes professionnels.' });
  }
  const { latitude, longitude, serviceRadiusKm } = req.body || {};
  const hasLatitude = latitude !== undefined && latitude !== null;
  const hasLongitude = longitude !== undefined && longitude !== null;
  if (hasLatitude !== hasLongitude ||
      (hasLatitude &&
        (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
         typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180)) ||
      (!hasLatitude && !req.authUser.hasHomeLocation) ||
      !Number.isInteger(serviceRadiusKm) || serviceRadiusKm < 1 || serviceRadiusKm > 500) {
    return res.status(400).json({ error: 'Enregistrez une position valide et un rayon compris entre 1 et 500 km.' });
  }

  try {
    const { rows } = await pool.query(
      `UPDATE app_users
       SET home_latitude = COALESCE($2, home_latitude),
           home_longitude = COALESCE($3, home_longitude),
           service_radius_km = $4
       WHERE id = $1 AND role = 'pro'
       RETURNING service_radius_km, home_latitude, home_longitude`,
      [req.authUser.id, hasLatitude ? latitude : null, hasLongitude ? longitude : null, serviceRadiusKm]
    );
    if (!rows[0]) {
      return res.status(404).json({ error: 'Compte professionnel introuvable.' });
    }
    res.json({
      serviceRadiusKm: rows[0].service_radius_km,
      hasHomeLocation: rows[0].home_latitude !== null && rows[0].home_longitude !== null
    });
  } catch (error) {
    sendApiError(res, error, 'Impossible d’enregistrer votre zone d’intervention.');
  }
});

app.post('/api/auth/logout', requireAuth, async (req, res) => {
  try {
    await authService.logout(req.authToken);
    res.status(204).end();
  } catch (error) {
    sendApiError(res, error, 'Impossible de fermer la session.');
  }
});

app.get('/api/planning/consents', requireAuth, requireAidantSeniorContext, async (req, res) => {
  if (!['senior', 'aidant'].includes(req.authUser.role)) {
    return res.status(403).json({ error: 'Cette page est réservée à la personne accompagnée et à son aidant.' });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT recipient.id, recipient.name, organization.name AS organization_name,
              recipient.consent_at, recipient.consent_revoked_at
       FROM planning_recipients recipient
       JOIN planning_organizations organization ON organization.id = recipient.organization_id
       WHERE recipient.senior_id = $1
       ORDER BY recipient.created_at DESC`,
      [req.authUser.seniorId]
    );
    res.json(rows.map(row => ({
      id: row.id,
      name: row.name,
      organizationName: row.organization_name,
      consented: Boolean(row.consent_at && !row.consent_revoked_at)
    })));
  } catch (error) {
    sendApiError(res, error, 'Impossible de charger les demandes de partage.');
  }
});

app.post('/api/planning/consents/:recipientId', requireAuth, requireAidantSeniorContext, async (req, res) => {
  if (!['senior', 'aidant'].includes(req.authUser.role)) {
    return res.status(403).json({ error: 'Cette action est réservée à la personne accompagnée et à son aidant.' });
  }
  if (typeof req.body?.consented !== 'boolean') {
    return res.status(400).json({ error: 'Indiquez si vous autorisez ou retirez le partage.' });
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.params.recipientId)) {
    return res.status(400).json({ error: 'Demande de partage invalide.' });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE planning_recipients
       SET consented_by = CASE WHEN $3 THEN $2::uuid ELSE NULL END,
           consent_at = CASE WHEN $3 THEN CURRENT_TIMESTAMP ELSE consent_at END,
           consent_revoked_at = CASE WHEN $3 THEN NULL ELSE CURRENT_TIMESTAMP END,
           phone = CASE WHEN $3 THEN phone ELSE NULL END,
           address = CASE WHEN $3 THEN address ELSE NULL END,
           latitude = CASE WHEN $3 THEN latitude ELSE NULL END,
           longitude = CASE WHEN $3 THEN longitude ELSE NULL END,
           position_consented_by = CASE WHEN $3 THEN position_consented_by ELSE NULL END,
           position_consent_at = CASE WHEN $3 THEN position_consent_at ELSE NULL END,
           emergency_contact_name = CASE WHEN $3 THEN emergency_contact_name ELSE NULL END,
           emergency_contact_phone = CASE WHEN $3 THEN emergency_contact_phone ELSE NULL END,
           access_instructions = CASE WHEN $3 THEN access_instructions ELSE NULL END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND senior_id = $4
       RETURNING id`,
      [req.params.recipientId, req.authUser.id, req.body.consented, req.authUser.seniorId]
    );
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Demande de partage introuvable.' });
    }

    if (!req.body.consented) {
      await client.query(
        `DELETE FROM app_notifications
         WHERE entity_id IN (
           SELECT visit.id FROM planning_visits visit WHERE visit.recipient_id = $1
           UNION
           SELECT booking.id FROM planning_service_bookings booking WHERE booking.recipient_id = $1
         )`,
        [req.params.recipientId]
      );
      await client.query(
        `DELETE FROM planning_visits
         WHERE recipient_id = $1`,
        [req.params.recipientId]
      );
      await client.query(
        `DELETE FROM planning_recipient_notes WHERE recipient_id = $1`,
        [req.params.recipientId]
      );
      await client.query(
        `DELETE FROM planning_service_bookings WHERE recipient_id = $1`,
        [req.params.recipientId]
      );
    }
    await client.query('COMMIT');
    res.json({ consented: req.body.consented });
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    sendApiError(res, error, 'Impossible de modifier l’autorisation de partage.');
  } finally {
    if (client) client.release();
  }
});

app.get('/api/planning/coordinator', requireAuth, requireCoordinator, async (req, res) => {
  try {
    const [membersResult, recipientsResult, visitsResult, servicePartnersResult] = await Promise.all([
      pool.query(
        `SELECT user_account.id, user_account.name, user_account.email
         FROM planning_org_members member
         JOIN app_users user_account ON user_account.id = member.user_id
         WHERE member.organization_id = $1 AND member.role = 'professional'
           AND user_account.is_active = TRUE
           AND user_account.verification_status = 'approved'
         ORDER BY user_account.name`,
        [req.planningOrganizationId]
      ),
      pool.query(
        `SELECT recipient.id, recipient.name,
                (recipient.consent_at IS NOT NULL AND recipient.consent_revoked_at IS NULL) AS consented,
                CASE WHEN recipient.consent_at IS NOT NULL AND recipient.consent_revoked_at IS NULL
                  THEN recipient.phone ELSE NULL END AS phone,
                CASE WHEN recipient.consent_at IS NOT NULL AND recipient.consent_revoked_at IS NULL
                  THEN recipient.address ELSE NULL END AS address,
                CASE WHEN recipient.consent_at IS NOT NULL AND recipient.consent_revoked_at IS NULL
                  THEN recipient.emergency_contact_name ELSE NULL END AS emergency_contact_name,
                CASE WHEN recipient.consent_at IS NOT NULL AND recipient.consent_revoked_at IS NULL
                  THEN recipient.emergency_contact_phone ELSE NULL END AS emergency_contact_phone,
                CASE WHEN recipient.consent_at IS NOT NULL AND recipient.consent_revoked_at IS NULL
                  THEN recipient.access_instructions ELSE NULL END AS access_instructions
         FROM planning_recipients recipient
         WHERE recipient.organization_id = $1
         ORDER BY recipient.name`,
        [req.planningOrganizationId]
      ),
      pool.query(
        `SELECT visit.id, visit.scheduled_at, visit.visit_type,
                recipient.name AS recipient_name, recipient.id AS recipient_id
         FROM planning_visits visit
         JOIN planning_recipients recipient
           ON recipient.id = visit.recipient_id
          AND recipient.organization_id = visit.organization_id
         WHERE visit.organization_id = $1
           AND visit.acceptance_status = 'accepted'
           AND recipient.consent_at IS NOT NULL
           AND recipient.consent_revoked_at IS NULL
           AND visit.scheduled_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'
           AND visit.scheduled_at < CURRENT_TIMESTAMP + INTERVAL '30 days'
         ORDER BY visit.scheduled_at DESC`,
        [req.planningOrganizationId]
      ),
      pool.query(
        `SELECT partner.id, partner.user_id, partner.service_type, partner.display_name,
                partner.service_area, partner.billing_model, user_account.name AS member_name
         FROM planning_service_partners partner
         JOIN app_users user_account ON user_account.id = partner.user_id
         WHERE partner.organization_id = $1 AND partner.active = TRUE
         ORDER BY partner.service_type, partner.display_name`,
        [req.planningOrganizationId]
      )
    ]);
    await pool.query(
      `INSERT INTO planning_access_audit (organization_id, recipient_id, user_id, action)
       SELECT recipient.organization_id, recipient.id, $2, 'contact_view'
       FROM planning_recipients recipient
       WHERE recipient.organization_id = $1
         AND recipient.consent_at IS NOT NULL
         AND recipient.consent_revoked_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM planning_access_audit audit
           WHERE audit.recipient_id = recipient.id AND audit.user_id = $2
             AND audit.action = 'contact_view'
             AND audit.created_at > CURRENT_TIMESTAMP - INTERVAL '5 minutes'
         )`,
      [req.planningOrganizationId, req.authUser.id]
    );
    for (const visit of visitsResult.rows) {
      await pool.query(
        `INSERT INTO planning_access_audit (organization_id, recipient_id, user_id, action)
         SELECT $1, $2, $3, 'coordinator_schedule_view'
         WHERE NOT EXISTS (
           SELECT 1 FROM planning_access_audit
           WHERE recipient_id = $2 AND user_id = $3 AND action = 'coordinator_schedule_view'
             AND created_at > CURRENT_TIMESTAMP - INTERVAL '5 minutes'
         )`,
        [req.planningOrganizationId, visit.recipient_id, req.authUser.id]
      );
    }
    res.json({
      members: membersResult.rows,
      visits: visitsResult.rows.map(row => ({
        id: row.id,
        scheduledAt: row.scheduled_at,
        visitType: row.visit_type,
        recipientName: row.recipient_name
      })),
      servicePartners: servicePartnersResult.rows.map(row => ({
        id: row.id,
        userId: row.user_id,
        serviceType: row.service_type,
        displayName: row.display_name,
        serviceArea: row.service_area,
        billingModel: row.billing_model,
        memberName: row.member_name
      })),
      recipients: recipientsResult.rows.map(row => ({
        id: row.id,
        name: row.name,
        consented: row.consented,
        phone: row.phone,
        address: row.address,
        emergencyContactName: row.emergency_contact_name,
        emergencyContactPhone: row.emergency_contact_phone,
        accessInstructions: row.access_instructions
      }))
    });
  } catch (error) {
    sendApiError(res, error, 'Impossible de charger le planning de l’équipe.');
  }
});

app.post('/api/planning/services/partners', requireAuth, requireCoordinator, async (req, res) => {
  const { memberId, serviceType, billingModel } = req.body || {};
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (typeof memberId !== 'string' || !uuidPattern.test(memberId)) {
    return res.status(400).json({ error: 'Sélectionnez un intervenant valide.' });
  }
  if (!['meal_delivery', 'hairdresser', 'housekeeping'].includes(serviceType)) {
    return res.status(400).json({ error: 'Choisissez un service du quotidien valide.' });
  }
  if (!['subscription', 'per_completed_booking'].includes(billingModel)) {
    return res.status(400).json({ error: 'Choisissez un mode de rémunération valide.' });
  }

  try {
    const displayName = requiredText(req.body?.displayName, 160, 'nom du service');
    const serviceArea = optionalText(req.body?.serviceArea ?? '', 160, 'zone d’intervention');
    const { rows } = await pool.query(
      `INSERT INTO planning_service_partners
         (id, organization_id, user_id, service_type, display_name, service_area, billing_model)
       SELECT $1, $2, member.user_id, $4, $5, $6, $7
       FROM planning_org_members member
       JOIN app_users account
         ON account.id = member.user_id
        AND account.is_active = TRUE
        AND account.verification_status = 'approved'
       WHERE member.organization_id = $2
         AND member.user_id = $3
         AND member.role = 'professional'
       ON CONFLICT (organization_id, user_id, service_type)
       DO UPDATE SET display_name = EXCLUDED.display_name,
                     service_area = EXCLUDED.service_area,
                     billing_model = EXCLUDED.billing_model,
                     active = TRUE
       RETURNING id, display_name, service_type, service_area, billing_model`,
      [randomUUID(), req.planningOrganizationId, memberId, serviceType, displayName, serviceArea, billingModel]
    );
    if (!rows[0]) {
      return res.status(404).json({ error: 'Cet intervenant doit d’abord être ajouté à l’équipe.' });
    }
    res.status(201).json({
      partner: {
        id: rows[0].id,
        displayName: rows[0].display_name,
        serviceType: rows[0].service_type,
        serviceArea: rows[0].service_area,
        billingModel: rows[0].billing_model
      }
    });
  } catch (error) {
    sendApiError(res, error, 'Impossible d’enregistrer ce partenaire.');
  }
});

app.get('/api/planning/services/catalog', requireAuth, requireAidantSeniorContext, async (req, res) => {
  if (!['senior', 'aidant'].includes(req.authUser.role)) {
    return res.status(403).json({ error: 'Le catalogue est réservé à la personne accompagnée et à son aidant.' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT partner.id, partner.display_name, partner.service_type, partner.service_area,
              organization.name AS organization_name,
              recipient.id AS recipient_id, recipient.name AS recipient_name
       FROM planning_service_partners partner
       JOIN planning_organizations organization ON organization.id = partner.organization_id
       JOIN planning_org_members member
         ON member.organization_id = partner.organization_id
        AND member.user_id = partner.user_id
        AND member.role = 'professional'
       JOIN app_users professional
         ON professional.id = member.user_id
        AND professional.is_active = TRUE
        AND professional.verification_status = 'approved'
       JOIN planning_recipients recipient
         ON recipient.organization_id = partner.organization_id
        AND recipient.senior_id = $1
        AND recipient.consent_at IS NOT NULL
        AND recipient.consent_revoked_at IS NULL
       WHERE partner.active = TRUE
       ORDER BY partner.service_type, partner.display_name`,
      [req.authUser.seniorId]
    );
    res.json({
      partners: rows.map(row => ({
        id: row.id,
        displayName: row.display_name,
        serviceType: row.service_type,
        serviceArea: row.service_area,
        organizationName: row.organization_name,
        recipientId: row.recipient_id,
        recipientName: row.recipient_name
      }))
    });
  } catch (error) {
    sendApiError(res, error, 'Impossible de charger les services disponibles.');
  }
});

app.post('/api/planning/services/bookings', requireAuth, requireAidantSeniorContext, async (req, res) => {
  if (!['senior', 'aidant'].includes(req.authUser.role)) {
    return res.status(403).json({ error: 'Seule la personne accompagnée ou son aidant peut demander un service.' });
  }
  const { partnerId, scheduledAt } = req.body || {};
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (typeof partnerId !== 'string' || !uuidPattern.test(partnerId)) {
    return res.status(400).json({ error: 'Sélectionnez un partenaire valide.' });
  }
  if (typeof scheduledAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(scheduledAt) ||
      !Number.isFinite(Date.parse(scheduledAt)) || Date.parse(scheduledAt) <= Date.now()) {
    return res.status(400).json({ error: 'Choisissez une date et une heure futures.' });
  }

  let client;
  try {
    const requestNote = optionalText(req.body?.requestNote ?? '', 500, 'précision pratique');
    client = await pool.connect();
    await client.query('BEGIN');
    const { rows } = await client.query(
      `WITH inserted AS (
         INSERT INTO planning_service_bookings
           (id, organization_id, recipient_id, partner_id, created_by, requested_at, request_note)
         SELECT $1, partner.organization_id, recipient.id, partner.id, $4, $5, $6
         FROM planning_service_partners partner
         JOIN planning_org_members member
           ON member.organization_id = partner.organization_id
          AND member.user_id = partner.user_id
          AND member.role = 'professional'
         JOIN app_users professional
           ON professional.id = member.user_id
          AND professional.is_active = TRUE
          AND professional.verification_status = 'approved'
         JOIN planning_recipients recipient
           ON recipient.organization_id = partner.organization_id
          AND recipient.senior_id = $3
          AND recipient.consent_at IS NOT NULL
          AND recipient.consent_revoked_at IS NULL
         WHERE partner.id = $2 AND partner.active = TRUE
         RETURNING id, recipient_id, partner_id
       )
       SELECT inserted.id, recipient.name AS recipient_name, partner.user_id,
              partner.display_name, organization.coordinator_user_id
       FROM inserted
       JOIN planning_recipients recipient ON recipient.id = inserted.recipient_id
       JOIN planning_service_partners partner ON partner.id = inserted.partner_id
       JOIN planning_organizations organization ON organization.id = partner.organization_id`,
      [randomUUID(), partnerId, req.authUser.seniorId, req.authUser.id, scheduledAt, requestNote]
    );
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Partenaire indisponible ou partage non autorisé.' });
    }
    const booking = rows[0];
    await insertAppNotification(
      client,
      booking.user_id,
      'service_booking_invite',
      'Nouvelle demande de rendez-vous',
      `${booking.recipient_name} demande un rendez-vous « ${booking.display_name} » le ${new Date(scheduledAt).toLocaleString('fr-FR')}.`,
      'service_booking',
      booking.id
    );
    await client.query('COMMIT');
    res.status(201).json({ bookingId: booking.id, status: 'requested' });
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    sendApiError(res, error, 'Impossible d’envoyer la demande de rendez-vous.');
  } finally {
    if (client) client.release();
  }
});

app.get('/api/planning/services/bookings', requireAuth, requireAidantSeniorContext, async (req, res) => {
  if (!['senior', 'aidant', 'pro'].includes(req.authUser.role)) {
    return res.status(403).json({ error: 'Accès au planning des services non autorisé.' });
  }

  let scheduleDate = null;
  if (req.query.date !== undefined) {
    const value = req.query.date;
    const parsedDate = typeof value === 'string' ? new Date(`${value}T00:00:00.000Z`) : null;
    if (typeof value !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        !Number.isFinite(parsedDate?.getTime()) ||
        parsedDate.toISOString().slice(0, 10) !== value) {
      return res.status(400).json({ error: 'Choisissez une date de planning valide.' });
    }
    scheduleDate = value;
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT booking.id, booking.requested_at, booking.status, booking.request_note,
              partner.display_name, partner.service_type, partner.service_area,
              recipient.id AS recipient_id, recipient.name AS recipient_name,
              CASE WHEN booking.status IN ('confirmed', 'completed')
                         AND ((partner.user_id = $3 AND $2 = 'pro') OR $5)
                   THEN recipient.phone ELSE NULL END AS recipient_phone,
              CASE WHEN booking.status IN ('confirmed', 'completed')
                         AND ((partner.user_id = $3 AND $2 = 'pro') OR $5)
                   THEN recipient.address ELSE NULL END AS recipient_address,
              CASE WHEN booking.status IN ('confirmed', 'completed')
                          AND partner.user_id = $3 AND $2 = 'pro'
                   THEN recipient.latitude ELSE NULL END AS recipient_latitude,
              CASE WHEN booking.status IN ('confirmed', 'completed')
                          AND partner.user_id = $3 AND $2 = 'pro'
                   THEN recipient.longitude ELSE NULL END AS recipient_longitude,
              professional.home_latitude, professional.home_longitude, professional.service_radius_km
       FROM planning_service_bookings booking
       JOIN planning_service_partners partner
         ON partner.id = booking.partner_id
        AND partner.organization_id = booking.organization_id
       JOIN planning_recipients recipient
         ON recipient.id = booking.recipient_id
        AND recipient.organization_id = booking.organization_id
       LEFT JOIN app_users professional
         ON professional.id = $3 AND $2 = 'pro'
       WHERE recipient.consent_at IS NOT NULL
         AND recipient.consent_revoked_at IS NULL
         AND (
           ($2 = 'pro' AND partner.user_id = $3 AND EXISTS (
             SELECT 1 FROM planning_org_members member
             WHERE member.organization_id = booking.organization_id
               AND member.user_id = $3 AND member.role = 'professional'
           ))
           OR ($5 AND EXISTS (
             SELECT 1 FROM planning_organizations organization
             WHERE organization.id = booking.organization_id
               AND organization.coordinator_user_id = $3
           ))
           OR ($2 IN ('senior', 'aidant') AND recipient.senior_id = $4)
         )
         AND ($1::date IS NULL OR (
           booking.requested_at >= ($1::date::timestamp AT TIME ZONE 'Europe/Paris')
           AND booking.requested_at < (($1::date + 1)::timestamp AT TIME ZONE 'Europe/Paris')
         ))
         AND ($1::date IS NOT NULL OR (
           booking.requested_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'
           AND booking.requested_at < CURRENT_TIMESTAMP + INTERVAL '90 days'
         ))
         AND ($2 != 'pro' OR booking.status != 'requested')
       ORDER BY booking.requested_at`,
      [scheduleDate, req.authUser.role, req.authUser.id, req.authUser.seniorId, req.authUser.isCoordinator]
    );
    if (req.authUser.role === 'pro') {
      for (const row of rows) {
        if (row.recipient_phone || row.recipient_address) {
          await client.query(
            `INSERT INTO planning_access_audit (organization_id, recipient_id, user_id, action)
             SELECT booking.organization_id, $1, $2, 'service_contact_view'
             FROM planning_service_bookings booking
             WHERE booking.id = $3
               AND NOT EXISTS (
                 SELECT 1 FROM planning_access_audit
                 WHERE recipient_id = $1 AND user_id = $2 AND action = 'service_contact_view'
                   AND created_at > CURRENT_TIMESTAMP - INTERVAL '5 minutes'
               )`,
            [row.recipient_id, req.authUser.id, row.id]
          );
        }
      }
    }
    await client.query('COMMIT');
    res.json({
      bookings: rows.map(row => ({
        id: row.id,
        scheduledAt: row.requested_at,
        status: row.status,
        requestNote: row.request_note,
        serviceType: row.service_type,
        partnerName: row.display_name,
        serviceArea: row.service_area,
        ...getServiceDistance(
          row.home_latitude,
          row.home_longitude,
          row.recipient_latitude,
          row.recipient_longitude,
          row.service_radius_km
        ),
        recipient: {
          name: row.recipient_name,
          phone: row.recipient_phone,
          address: row.recipient_address
        }
      }))
    });
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    sendApiError(res, error, 'Impossible de charger les rendez-vous de services.');
  } finally {
    if (client) client.release();
  }
});

app.patch('/api/planning/services/bookings/:bookingId', requireAuth, requireAidantSeniorContext, async (req, res) => {
  if (!['senior', 'aidant', 'pro'].includes(req.authUser.role)) {
    return res.status(403).json({ error: 'Modification du rendez-vous non autorisée.' });
  }
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(req.params.bookingId)) {
    return res.status(400).json({ error: 'Identifiant de rendez-vous invalide.' });
  }
  const { status } = req.body || {};
  if (!['confirmed', 'completed', 'cancelled'].includes(status)) {
    return res.status(400).json({ error: 'Choisissez un statut de rendez-vous valide.' });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT booking.id, booking.status, booking.organization_id, booking.recipient_id,
              booking.created_by, partner.user_id, partner.display_name,
              recipient.senior_id, recipient.name AS recipient_name,
              organization.coordinator_user_id
       FROM planning_service_bookings booking
       JOIN planning_service_partners partner
         ON partner.id = booking.partner_id
        AND partner.organization_id = booking.organization_id
       JOIN planning_recipients recipient
         ON recipient.id = booking.recipient_id
        AND recipient.organization_id = booking.organization_id
       JOIN planning_organizations organization ON organization.id = booking.organization_id
       WHERE booking.id = $1
         AND recipient.consent_at IS NOT NULL
         AND recipient.consent_revoked_at IS NULL
         AND (
           (partner.user_id = $2 AND $3 = 'pro' AND EXISTS (
             SELECT 1 FROM planning_org_members member
             WHERE member.organization_id = booking.organization_id
               AND member.user_id = $2 AND member.role = 'professional'
           ))
           OR EXISTS (
             SELECT 1 FROM planning_organizations organization
             WHERE organization.id = booking.organization_id
               AND organization.coordinator_user_id = $2
           )
           OR ($3 IN ('senior', 'aidant') AND recipient.senior_id = $4)
         )
       FOR UPDATE OF booking`,
      [req.params.bookingId, req.authUser.id, req.authUser.role, req.authUser.seniorId]
    );
    const booking = rows[0];
    if (!booking) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Rendez-vous introuvable ou accès non autorisé.' });
    }
    const isFamily = ['senior', 'aidant'].includes(req.authUser.role);
    const isAssignedPartner = req.authUser.role === 'pro' && booking.user_id === req.authUser.id;
    const allowed = isFamily
      ? status === 'cancelled' && ['requested', 'confirmed'].includes(booking.status)
      : (status === 'confirmed' && booking.status === 'requested' && isAssignedPartner) ||
        (status === 'completed' && booking.status === 'confirmed' &&
          (isAssignedPartner || req.authUser.isCoordinator)) ||
        (status === 'cancelled' && ['requested', 'confirmed'].includes(booking.status) &&
          (isAssignedPartner || req.authUser.isCoordinator));
    if (!allowed) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Ce changement n’est pas possible pour le statut actuel du rendez-vous.' });
    }
    await client.query(
      `UPDATE planning_service_bookings
       SET status = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [booking.id, status]
    );
    const notificationTargets = new Set([
      booking.senior_id,
      booking.created_by,
      booking.coordinator_user_id,
      booking.user_id
    ]);
    notificationTargets.delete(req.authUser.id);
    const isRefused = status === 'cancelled' && booking.status === 'requested' && isAssignedPartner;
    if (status === 'confirmed' || isRefused) {
      for (const userId of notificationTargets) {
        await insertAppNotification(
          client,
          userId,
          isRefused ? 'service_booking_declined' : 'service_booking_confirmed',
          isRefused ? 'Demande de rendez-vous refusée' : 'Rendez-vous accepté',
          isRefused
            ? `La demande de rendez-vous « ${booking.display_name} » pour ${booking.recipient_name} a été refusée.`
            : `Le rendez-vous « ${booking.display_name} » pour ${booking.recipient_name} est accepté et ajouté à l’agenda.`,
          'service_booking',
          booking.id
        );
      }
    } else if (status === 'cancelled') {
      for (const userId of notificationTargets) {
        await insertAppNotification(
          client,
          userId,
          'service_booking_cancelled',
          'Rendez-vous annulé',
          isFamily
            ? `Le rendez-vous « ${booking.display_name} » pour ${booking.recipient_name} a été annulé par la personne ou son aidant.`
            : `Le rendez-vous « ${booking.display_name} » pour ${booking.recipient_name} a été annulé.`,
          'service_booking',
          booking.id
        );
      }
    }
    await client.query('COMMIT');
    res.json({ bookingId: booking.id, status });
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    sendApiError(res, error, 'Impossible de modifier le rendez-vous.');
  } finally {
    if (client) client.release();
  }
});

app.post('/api/planning/members', requireAuth, requireCoordinator, async (req, res) => {
  let email;
  try {
    email = requiredText(req.body?.email, 254, 'e-mail').toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new AuthError(400, 'Saisissez une adresse e-mail valide.');
    }
    const { rows } = await pool.query(
      `SELECT id, name, email, role, is_active, verification_status
       FROM app_users WHERE email = $1`,
      [email]
    );
    const professional = rows[0];
    if (!professional || professional.role !== 'pro') {
      return res.status(404).json({ error: 'Aucun compte professionnel actif ne correspond à cette adresse.' });
    }
    if (!professional.is_active || professional.verification_status !== 'approved') {
      return res.status(409).json({ error: 'Cet intervenant doit d’abord faire valider son dossier.' });
    }
    if (professional.id === req.authUser.id) {
      return res.status(400).json({ error: 'Le compte coordinateur ne peut pas être ajouté comme intervenant.' });
    }

    await pool.query(
      `INSERT INTO planning_org_members (organization_id, user_id, role)
       VALUES ($1, $2, 'professional')
       ON CONFLICT (organization_id, user_id) DO NOTHING`,
      [req.planningOrganizationId, professional.id]
    );
    res.status(201).json({
      member: { id: professional.id, name: professional.name, email: professional.email }
    });
  } catch (error) {
    sendApiError(res, error, 'Impossible d’ajouter cet intervenant.');
  }
});

app.post('/api/planning/recipients', requireAuth, requireCoordinator, async (req, res) => {
  try {
    const email = requiredText(req.body?.seniorEmail, 254, 'e-mail de la personne').toLowerCase();
    const name = requiredText(req.body?.name, 120, 'nom de la personne');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new AuthError(400, 'Saisissez une adresse e-mail valide pour la personne ou son aidant.');
    }
    const { rows } = await pool.query(
      `SELECT user_account.senior_id
       FROM app_users user_account
       WHERE user_account.email = $1 AND user_account.role IN ('senior', 'aidant')`,
      [email]
    );
    if (!rows[0]) {
      return res.status(404).json({ error: 'Aucun compte senior ou aidant ne correspond à cette adresse.' });
    }

    const { rows: recipients } = await pool.query(
      `INSERT INTO planning_recipients
         (id, organization_id, senior_id, name, created_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (organization_id, senior_id) DO NOTHING
       RETURNING id, name`,
      [randomUUID(), req.planningOrganizationId, rows[0].senior_id, name, req.authUser.id]
    );
    if (!recipients[0]) {
      return res.status(409).json({ error: 'Cette personne figure déjà dans l’équipe.' });
    }
    res.status(201).json({
      recipient: recipients[0],
      consentRequired: true
    });
  } catch (error) {
    sendApiError(res, error, 'Impossible de créer la demande de partage.');
  }
});

app.put('/api/planning/recipients/:recipientId/contact', requireAuth, requireCoordinator, async (req, res) => {
  try {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.params.recipientId)) {
      throw new AuthError(400, 'Identifiant de personne invalide.');
    }
    const phone = requiredText(req.body?.phone, 40, 'téléphone');
    const address = requiredText(req.body?.address, 500, 'adresse');
    const emergencyContactName = requiredText(req.body?.emergencyContactName, 120, 'contact d’urgence');
    const emergencyContactPhone = requiredText(req.body?.emergencyContactPhone, 40, 'téléphone du contact d’urgence');
    const accessInstructions = optionalText(req.body?.accessInstructions ?? '', 500, 'consignes d’accès');
    const hasLatitude = req.body?.latitude !== undefined && req.body.latitude !== null;
    const hasLongitude = req.body?.longitude !== undefined && req.body.longitude !== null;
    if (hasLatitude !== hasLongitude) {
      throw new AuthError(400, 'La position GPS doit comporter latitude et longitude.');
    }
    const latitude = hasLatitude ? req.body.latitude : null;
    const longitude = hasLongitude ? req.body.longitude : null;
    if (hasLatitude &&
        (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
         typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180)) {
      throw new AuthError(400, 'La position GPS du domicile est invalide.');
    }
    if (hasLatitude && req.body?.locationConsent !== true) {
      throw new AuthError(400, 'Confirmez l’accord de la personne avant d’enregistrer sa position GPS.');
    }
    for (const [label, value] of [['téléphone', phone], ['téléphone du contact d’urgence', emergencyContactPhone]]) {
      if (!/^[+0-9().\s-]{6,40}$/.test(value)) {
        throw new AuthError(400, `Vérifiez le champ « ${label} ».`);
      }
    }

    const { rows } = await pool.query(
      `UPDATE planning_recipients
       SET phone = $3, address = $4,
           latitude = COALESCE($8, latitude), longitude = COALESCE($9, longitude),
           position_consented_by = CASE WHEN $10 AND $8 IS NOT NULL THEN $11::uuid ELSE position_consented_by END,
           position_consent_at = CASE WHEN $10 AND $8 IS NOT NULL THEN CURRENT_TIMESTAMP ELSE position_consent_at END,
           emergency_contact_name = $5, emergency_contact_phone = $6,
           access_instructions = $7, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND organization_id = $2
         AND consent_at IS NOT NULL AND consent_revoked_at IS NULL
       RETURNING id`,
      [
        req.params.recipientId,
        req.planningOrganizationId,
        phone,
        address,
        emergencyContactName,
        emergencyContactPhone,
        accessInstructions,
        latitude,
        longitude,
        hasLatitude && req.body.locationConsent === true,
        req.authUser.id
      ]
    );
    if (!rows[0]) {
      return res.status(404).json({ error: 'Personne introuvable ou partage non autorisé.' });
    }
    await pool.query(
      `INSERT INTO planning_access_audit (organization_id, recipient_id, user_id, action)
       VALUES ($1, $2, $3, 'contact_updated')`,
      [req.planningOrganizationId, req.params.recipientId, req.authUser.id]
    );
    res.json({ updated: true });
  } catch (error) {
    sendApiError(res, error, 'Impossible d’enregistrer les coordonnées.');
  }
});

app.post('/api/planning/visits', requireAuth, requireCoordinator, async (req, res) => {
  let client;
  try {
    const { recipientId, assignedUserId, scheduledAt, durationMinutes, visitType } = req.body || {};
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (typeof recipientId !== 'string' || !uuidPattern.test(recipientId) ||
        typeof assignedUserId !== 'string' || !uuidPattern.test(assignedUserId)) {
      throw new AuthError(400, 'Sélectionnez une personne et un intervenant valides.');
    }
    if (typeof scheduledAt !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(scheduledAt) ||
        !Number.isFinite(Date.parse(scheduledAt)) || Date.parse(scheduledAt) <= Date.now()) {
      throw new AuthError(400, 'Choisissez une date future avec son fuseau horaire.');
    }
    if (!Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 480) {
      throw new AuthError(400, 'La durée doit être comprise entre 15 minutes et 8 heures.');
    }
    const type = requiredText(visitType, 120, 'type de visite');

    client = await pool.connect();
    await client.query('BEGIN');
    const { rows } = await client.query(
      `WITH inserted AS (
         INSERT INTO planning_visits
           (id, organization_id, recipient_id, assigned_user_id, scheduled_at,
            duration_minutes, visit_type, created_by, acceptance_status)
         SELECT $1, recipient.organization_id, recipient.id, member.user_id, $5,
                $6, $7, $8, 'pending'
         FROM planning_recipients recipient
         JOIN planning_org_members member
           ON member.organization_id = recipient.organization_id
          AND member.user_id = $4 AND member.role = 'professional'
         JOIN app_users professional
           ON professional.id = member.user_id
          AND professional.is_active = TRUE
          AND professional.verification_status = 'approved'
         WHERE recipient.id = $2 AND recipient.organization_id = $3
           AND recipient.consent_at IS NOT NULL
           AND recipient.consent_revoked_at IS NULL
         RETURNING id, recipient_id, assigned_user_id
       )
       SELECT inserted.id, inserted.assigned_user_id, recipient.name AS recipient_name
       FROM inserted
       JOIN planning_recipients recipient ON recipient.id = inserted.recipient_id`,
      [
        randomUUID(),
        recipientId,
        req.planningOrganizationId,
        assignedUserId,
        scheduledAt,
        durationMinutes,
        type,
        req.authUser.id
      ]
    );
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Vérifiez que la personne a autorisé le partage et que l’intervenant appartient à l’équipe.' });
    }
    await insertAppNotification(
      client,
      rows[0].assigned_user_id,
      'care_visit_invite',
      'Demande de rendez-vous à accepter',
      `Une visite « ${type} » pour ${rows[0].recipient_name} est proposée le ${new Date(scheduledAt).toLocaleString('fr-FR')}. Acceptez-la pour l’ajouter aux agendas.`,
      'care_visit',
      rows[0].id
    );
    await client.query('COMMIT');
    res.status(201).json({ visitId: rows[0].id, acceptanceStatus: 'pending' });
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    sendApiError(res, error, 'Impossible de planifier cette visite.');
  } finally {
    if (client) client.release();
  }
});

app.post('/api/planning/visits/:visitId/response', requireAuth, async (req, res) => {
  if (req.authUser.role !== 'pro') {
    return res.status(403).json({ error: 'Seul l’intervenant concerné peut répondre à cette demande.' });
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.params.visitId)) {
    return res.status(400).json({ error: 'Identifiant de rendez-vous invalide.' });
  }
  const { acceptanceStatus } = req.body || {};
  if (!['accepted', 'declined'].includes(acceptanceStatus)) {
    return res.status(400).json({ error: 'Acceptez ou refusez la demande de rendez-vous.' });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT visit.id, visit.organization_id, visit.recipient_id, visit.created_by,
              visit.scheduled_at, visit.visit_type, recipient.senior_id, recipient.name AS recipient_name,
              organization.coordinator_user_id
       FROM planning_visits visit
       JOIN planning_recipients recipient
         ON recipient.id = visit.recipient_id
        AND recipient.organization_id = visit.organization_id
       JOIN planning_organizations organization ON organization.id = visit.organization_id
       JOIN planning_org_members member
         ON member.organization_id = visit.organization_id
        AND member.user_id = visit.assigned_user_id
        AND member.role = 'professional'
        JOIN app_users professional
         ON professional.id = member.user_id
        AND professional.is_active = TRUE
        AND professional.verification_status = 'approved'
       WHERE visit.id = $1
         AND visit.assigned_user_id = $2
         AND visit.acceptance_status = 'pending'
         AND recipient.consent_at IS NOT NULL
         AND recipient.consent_revoked_at IS NULL
       FOR UPDATE OF visit, recipient`,
      [req.params.visitId, req.authUser.id]
    );
    const visit = rows[0];
    if (!visit) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Demande introuvable, déjà traitée ou non affectée à votre compte.' });
    }

    await client.query(
      `UPDATE planning_visits
       SET acceptance_status = $2
       WHERE id = $1`,
      [visit.id, acceptanceStatus]
    );
    const notificationTargets = new Set([
      visit.senior_id,
      visit.created_by,
      visit.coordinator_user_id
    ]);
    notificationTargets.delete(req.authUser.id);
    for (const userId of notificationTargets) {
      await insertAppNotification(
        client,
        userId,
        acceptanceStatus === 'accepted' ? 'care_visit_accepted' : 'care_visit_declined',
        acceptanceStatus === 'accepted' ? 'Rendez-vous accepté' : 'Rendez-vous refusé',
        acceptanceStatus === 'accepted'
          ? `La visite « ${visit.visit_type} » pour ${visit.recipient_name} est acceptée et ajoutée aux agendas.`
          : `La demande de visite « ${visit.visit_type} » pour ${visit.recipient_name} a été refusée.`,
        'care_visit',
        visit.id
      );
    }
    await client.query('COMMIT');
    res.json({ visitId: visit.id, acceptanceStatus });
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    sendApiError(res, error, 'Impossible d’enregistrer votre réponse au rendez-vous.');
  } finally {
    if (client) client.release();
  }
});

app.get('/api/planning/today', requireAuth, requireAidantSeniorContext, async (req, res) => {
  if (req.authUser.role !== 'pro') {
    return res.status(403).json({ error: 'Le planning est réservé aux comptes professionnels.' });
  }

  let scheduleDate = null;
  if (req.query.date !== undefined) {
    const value = req.query.date;
    const parsedDate = typeof value === 'string' ? new Date(`${value}T00:00:00.000Z`) : null;
    if (typeof value !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        !Number.isFinite(parsedDate?.getTime()) ||
        parsedDate.toISOString().slice(0, 10) !== value) {
      return res.status(400).json({ error: 'Choisissez une date de planning valide.' });
    }
    scheduleDate = value;
  }

  let client;
  try {
    client = await pool.connect();
    const { rows: membership } = await client.query(
      `SELECT 1 FROM planning_org_members
       WHERE user_id = $1 AND role = 'professional'
       LIMIT 1`,
      [req.authUser.id]
    );
    if (!membership[0]) {
      return res.json({ visits: [] });
    }

    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT visit.id, visit.scheduled_at, visit.duration_minutes, visit.visit_type, visit.status,
              recipient.id AS recipient_id, recipient.name, recipient.phone, recipient.address,
              recipient.latitude AS recipient_latitude, recipient.longitude AS recipient_longitude,
              recipient.emergency_contact_name, recipient.emergency_contact_phone,
              professional.home_latitude, professional.home_longitude, professional.service_radius_km,
              recipient.access_instructions,
              COALESCE((
                SELECT json_agg(json_build_object(
                  'type', event.event_type,
                  'note', event.practical_note,
                  'createdAt', event.created_at
                ) ORDER BY event.created_at)
                FROM planning_visit_events event
                WHERE event.visit_id = visit.id
              ), '[]'::json) AS progress
       FROM planning_visits visit
       JOIN planning_recipients recipient
         ON recipient.id = visit.recipient_id
        AND recipient.organization_id = visit.organization_id
       JOIN planning_org_members member
         ON member.organization_id = visit.organization_id
        AND member.user_id = visit.assigned_user_id
        AND member.role = 'professional'
       JOIN app_users professional
         ON professional.id = visit.assigned_user_id
        AND professional.is_active = TRUE
        AND professional.verification_status = 'approved'
       WHERE visit.assigned_user_id = $1
         AND visit.acceptance_status = 'accepted'
         AND recipient.consent_at IS NOT NULL
         AND recipient.consent_revoked_at IS NULL
         AND visit.scheduled_at >= (
           COALESCE($2::date, (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Paris')::date)::timestamp
           AT TIME ZONE 'Europe/Paris'
         )
         AND visit.scheduled_at < (
           (COALESCE($2::date, (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Paris')::date) + 1)::timestamp
           AT TIME ZONE 'Europe/Paris'
         )
       ORDER BY visit.scheduled_at`,
      [req.authUser.id, scheduleDate]
    );
    for (const row of rows) {
      await client.query(
        `INSERT INTO planning_access_audit (organization_id, recipient_id, user_id, action)
         SELECT organization_id, $1, $2, 'schedule_view'
         FROM planning_recipients
         WHERE id = $1
           AND NOT EXISTS (
             SELECT 1 FROM planning_access_audit
             WHERE recipient_id = $1 AND user_id = $2 AND action = 'schedule_view'
               AND created_at > CURRENT_TIMESTAMP - INTERVAL '5 minutes'
           )`,
        [row.recipient_id, req.authUser.id]
      );
    }
    await client.query('COMMIT');
    res.json({
      visits: rows.map(row => ({
        id: row.id,
        scheduledAt: row.scheduled_at,
        durationMinutes: row.duration_minutes,
        visitType: row.visit_type,
        status: row.status,
        progress: row.progress,
        ...getServiceDistance(
          row.home_latitude,
          row.home_longitude,
          row.recipient_latitude,
          row.recipient_longitude,
          row.service_radius_km
        ),
        recipient: {
          name: row.name,
          phone: row.phone,
          address: row.address,
          emergencyContactName: row.emergency_contact_name,
          emergencyContactPhone: row.emergency_contact_phone,
          accessInstructions: row.access_instructions
        }
      }))
    });
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    sendApiError(res, error, 'Impossible de charger votre planning.');
  } finally {
    if (client) client.release();
  }
});

app.get('/api/planning/following', requireAuth, requireAidantSeniorContext, async (req, res) => {
  if (!['senior', 'aidant'].includes(req.authUser.role)) {
    return res.status(403).json({ error: 'Le suivi est réservé à la personne accompagnée et à son aidant.' });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT visit.id, visit.scheduled_at, visit.visit_type, visit.status,
              recipient.id AS recipient_id, recipient.name,
              evaluation.rating AS user_rating,
              evaluation.comment AS user_rating_comment,
              COALESCE((
                SELECT json_agg(json_build_object(
                  'type', event.event_type,
                  'note', event.practical_note,
                  'createdAt', event.created_at
                ) ORDER BY event.created_at)
                FROM planning_visit_events event
                WHERE event.visit_id = visit.id
              ), '[]'::json) AS progress
       FROM planning_recipients recipient
       JOIN planning_visits visit
         ON visit.recipient_id = recipient.id
        AND visit.organization_id = recipient.organization_id
       LEFT JOIN planning_visit_evaluations evaluation
         ON evaluation.visit_id = visit.id AND evaluation.rated_by = $2
       WHERE recipient.senior_id = $1
         AND visit.acceptance_status = 'accepted'
         AND recipient.consent_at IS NOT NULL
         AND recipient.consent_revoked_at IS NULL
         AND visit.scheduled_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'
         AND visit.scheduled_at < CURRENT_TIMESTAMP + INTERVAL '14 days'
       ORDER BY visit.scheduled_at`,
      [req.authUser.seniorId, req.authUser.id]
    );
    const recipientIds = [...new Set(rows.map(row => row.recipient_id))];
    for (const recipientId of recipientIds) {
      await client.query(
        `INSERT INTO planning_access_audit (organization_id, recipient_id, user_id, action)
         SELECT organization_id, id, $2, 'shared_status_view'
         FROM planning_recipients
         WHERE id = $1
           AND NOT EXISTS (
             SELECT 1 FROM planning_access_audit
             WHERE recipient_id = $1 AND user_id = $2 AND action = 'shared_status_view'
               AND created_at > CURRENT_TIMESTAMP - INTERVAL '5 minutes'
           )`,
        [recipientId, req.authUser.id]
      );
    }
    await client.query('COMMIT');
    res.json({
      visits: rows.map(row => ({
        id: row.id,
        scheduledAt: row.scheduled_at,
        visitType: row.visit_type,
        status: row.status,
        evaluation: row.user_rating ? {
          rating: row.user_rating,
          comment: row.user_rating_comment
        } : null,
        progress: row.progress
      }))
    });
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    sendApiError(res, error, 'Impossible de charger le suivi des interventions.');
  } finally {
    if (client) client.release();
  }
});

app.get('/api/planning/visits/:visitId/notes', requireAuth, requireAidantSeniorContext, async (req, res) => {
  if (req.authUser.role !== 'pro') {
    return res.status(403).json({ error: 'Ces transmissions sont réservées à l’équipe professionnelle autorisée.' });
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.params.visitId)) {
    return res.status(400).json({ error: 'Identifiant de visite invalide.' });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const { rows: accessRows } = await client.query(
      `SELECT visit.organization_id, visit.recipient_id
       FROM planning_visits visit
       JOIN planning_recipients recipient
         ON recipient.id = visit.recipient_id
        AND recipient.organization_id = visit.organization_id
       WHERE visit.id = $1
         AND visit.acceptance_status = 'accepted'
         AND recipient.consent_at IS NOT NULL
         AND recipient.consent_revoked_at IS NULL
         AND (
           (visit.assigned_user_id = $2 AND EXISTS (
             SELECT 1 FROM planning_org_members member
             WHERE member.organization_id = visit.organization_id
               AND member.user_id = $2 AND member.role = 'professional'
           ))
           OR EXISTS (
             SELECT 1 FROM planning_organizations organization
             WHERE organization.id = visit.organization_id
               AND organization.coordinator_user_id = $2
           )
         )
       FOR UPDATE OF visit, recipient`,
      [req.params.visitId, req.authUser.id]
    );
    if (!accessRows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Visite introuvable ou accès non autorisé.' });
    }

    const { rows } = await client.query(
      `SELECT note.id, note.note_type, note.importance, note.source_name, note.source_date, note.content, note.created_at,
              author.name AS author_name, author.role AS author_role
       FROM planning_recipient_notes note
       JOIN app_users author ON author.id = note.author_user_id
       WHERE note.recipient_id = $1
         AND note.organization_id = $2
         AND note.created_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'
       ORDER BY note.created_at DESC
       LIMIT 200`,
      [accessRows[0].recipient_id, accessRows[0].organization_id]
    );
    await client.query(
      `INSERT INTO planning_access_audit (organization_id, recipient_id, user_id, action)
       VALUES ($1, $2, $3, 'recommendations_view')`,
      [accessRows[0].organization_id, accessRows[0].recipient_id, req.authUser.id]
    );
    await client.query('COMMIT');
    res.json({
      notes: rows.map(row => ({
        id: row.id,
        type: row.note_type,
        importance: row.importance,
        sourceName: row.source_name,
        sourceDate: row.source_date,
        content: row.content,
        authorName: row.author_name,
        authorRole: row.author_role,
        createdAt: row.created_at
      }))
    });
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    sendApiError(res, error, 'Impossible de charger les recommandations et transmissions.');
  } finally {
    if (client) client.release();
  }
});

app.post('/api/planning/visits/:visitId/notes', requireAuth, requireAidantSeniorContext, async (req, res) => {
  if (req.authUser.role !== 'pro') {
    return res.status(403).json({ error: 'Seuls les comptes professionnels autorisés peuvent ajouter une transmission d’équipe.' });
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.params.visitId)) {
    return res.status(400).json({ error: 'Identifiant de visite invalide.' });
  }

  const { type } = req.body || {};
  if (!['colleague_note', 'doctor_recommendation'].includes(type)) {
    return res.status(400).json({ error: 'Choisissez une transmission d’équipe ou une recommandation du médecin.' });
  }
  const { importance } = req.body || {};
  if (!['information', 'follow_up', 'priority'].includes(importance)) {
    return res.status(400).json({ error: 'Choisissez un niveau d’importance valide.' });
  }

  let content;
  let sourceName = null;
  let sourceDate = null;
  try {
    content = requiredText(req.body?.content, 1500, 'transmission');
    if (type === 'doctor_recommendation') {
      sourceName = requiredText(req.body?.sourceName, 120, 'source médicale');
      sourceDate = requiredText(req.body?.sourceDate, 10, 'date de la recommandation');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(sourceDate) ||
          Number.isNaN(Date.parse(`${sourceDate}T00:00:00Z`)) ||
          new Date(`${sourceDate}T00:00:00Z`).toISOString().slice(0, 10) !== sourceDate) {
        throw new AuthError(400, 'Saisissez une date de recommandation valide.');
      }
    }
  } catch (error) {
    return sendApiError(res, error, 'Vérifiez les champs de la transmission.');
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const { rows } = await client.query(
      `WITH eligible AS (
         SELECT visit.organization_id, recipient.id AS recipient_id
         FROM planning_visits visit
         JOIN planning_recipients recipient
           ON recipient.id = visit.recipient_id
          AND recipient.organization_id = visit.organization_id
         WHERE visit.id = $2
           AND recipient.consent_at IS NOT NULL
           AND recipient.consent_revoked_at IS NULL
           AND (
             (visit.assigned_user_id = $3 AND EXISTS (
               SELECT 1 FROM planning_org_members member
               WHERE member.organization_id = visit.organization_id
                 AND member.user_id = $3 AND member.role = 'professional'
             ))
             OR EXISTS (
               SELECT 1 FROM planning_organizations organization
               WHERE organization.id = visit.organization_id
                 AND organization.coordinator_user_id = $3
             )
           )
         FOR UPDATE OF visit, recipient
       )
       INSERT INTO planning_recipient_notes
         (id, organization_id, recipient_id, author_user_id, note_type, importance, source_name, source_date, content)
       SELECT $1, eligible.organization_id, eligible.recipient_id, $3, $4, $5, $6, $7, $8
       FROM eligible
       RETURNING id, organization_id, recipient_id, created_at`,
      [randomUUID(), req.params.visitId, req.authUser.id, type, importance, sourceName, sourceDate, content]
    );
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Visite introuvable ou accès non autorisé.' });
    }
    await client.query(
      `INSERT INTO planning_access_audit (organization_id, recipient_id, user_id, action)
       VALUES ($1, $2, $3, 'recommendation_added')`,
      [rows[0].organization_id, rows[0].recipient_id, req.authUser.id]
    );
    await client.query('COMMIT');
    res.status(201).json({ id: rows[0].id, createdAt: rows[0].created_at });
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    sendApiError(res, error, 'Impossible d’enregistrer la transmission.');
  } finally {
    if (client) client.release();
  }
});

app.post('/api/planning/recipients/:recipientId/notes', requireAuth, requireAidantSeniorContext, async (req, res) => {
  if (!['senior', 'aidant'].includes(req.authUser.role)) {
    return res.status(403).json({ error: 'Cette transmission est réservée à la personne accompagnée et à son aidant.' });
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.params.recipientId)) {
    return res.status(400).json({ error: 'Identifiant de personne invalide.' });
  }

  let content;
  const { importance } = req.body || {};
  if (!['information', 'follow_up', 'priority'].includes(importance)) {
    return res.status(400).json({ error: 'Choisissez un niveau d’importance valide.' });
  }
  try {
    content = requiredText(req.body?.content, 1500, 'information');
  } catch (error) {
    return sendApiError(res, error, 'Vérifiez le contenu de votre information.');
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const { rows } = await client.query(
      `WITH eligible AS (
         SELECT recipient.organization_id, recipient.id AS recipient_id
         FROM planning_recipients recipient
         WHERE recipient.id = $3
           AND recipient.senior_id = $6
           AND recipient.consent_at IS NOT NULL
           AND recipient.consent_revoked_at IS NULL
         FOR UPDATE
       )
       INSERT INTO planning_recipient_notes
         (id, organization_id, recipient_id, author_user_id, note_type, importance, content)
       SELECT $1, eligible.organization_id, eligible.recipient_id, $2, 'person_note', $4, $5
       FROM eligible
       RETURNING id, organization_id, recipient_id, created_at`,
      [randomUUID(), req.authUser.id, req.params.recipientId, importance, content, req.authUser.seniorId]
    );
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Personne introuvable ou partage non autorisé.' });
    }
    await client.query(
      `INSERT INTO planning_access_audit (organization_id, recipient_id, user_id, action)
       VALUES ($1, $2, $3, 'person_note_added')`,
      [rows[0].organization_id, rows[0].recipient_id, req.authUser.id]
    );
    await client.query('COMMIT');
    res.status(201).json({ id: rows[0].id, createdAt: rows[0].created_at });
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    sendApiError(res, error, 'Impossible d’enregistrer votre information.');
  } finally {
    if (client) client.release();
  }
});

app.post('/api/planning/visits/:visitId/progress', requireAuth, async (req, res) => {
  if (req.authUser.role !== 'pro') {
    return res.status(403).json({ error: 'Cette action est réservée aux comptes professionnels.' });
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.params.visitId)) {
    return res.status(400).json({ error: 'Identifiant de visite invalide.' });
  }

  const { stage } = req.body || {};
  if (!['arrived', 'started', 'completed'].includes(stage)) {
    return res.status(400).json({ error: 'Étape de visite invalide.' });
  }

  let note;
  try {
    note = optionalText(req.body?.note ?? '', 500, 'note pratique');
  } catch (error) {
    return sendApiError(res, error, 'Vérifiez la note pratique.');
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT visit.id, visit.organization_id, visit.recipient_id, visit.status,
              recipient.senior_id
       FROM planning_visits visit
       JOIN planning_recipients recipient
         ON recipient.id = visit.recipient_id
        AND recipient.organization_id = visit.organization_id
       JOIN planning_org_members member
         ON member.organization_id = visit.organization_id
        AND member.user_id = visit.assigned_user_id
        AND member.role = 'professional'
       WHERE visit.id = $1
         AND visit.assigned_user_id = $2
         AND visit.acceptance_status = 'accepted'
         AND recipient.consent_at IS NOT NULL
         AND recipient.consent_revoked_at IS NULL
       FOR UPDATE OF visit, recipient`,
      [req.params.visitId, req.authUser.id]
    );
    const visit = rows[0];
    if (!visit || visit.status === 'completed') {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Visite introuvable, déjà terminée ou non affectée à votre compte.' });
    }

    const { rows: previousEvents } = await client.query(
      `SELECT event_type FROM planning_visit_events WHERE visit_id = $1`,
      [visit.id]
    );
    const completedStages = new Set(previousEvents.map(event => event.event_type));
    const allowedNextStage = completedStages.has('started')
      ? 'completed'
      : completedStages.has('arrived')
        ? 'started'
        : 'arrived';
    if (stage !== allowedNextStage) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Respectez l’ordre des étapes : arrivée, début, puis fin de visite.' });
    }

    await client.query(
      `INSERT INTO planning_visit_events
         (id, visit_id, organization_id, recipient_id, user_id, event_type, practical_note)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [randomUUID(), visit.id, visit.organization_id, visit.recipient_id, req.authUser.id, stage, note]
    );
    if (stage === 'completed') {
      await client.query(
        `UPDATE planning_visits SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [visit.id]
      );
    }
    await client.query(
      `INSERT INTO planning_access_audit (organization_id, recipient_id, user_id, action)
       VALUES ($1, $2, $3, $4)`,
      [visit.organization_id, visit.recipient_id, req.authUser.id, `visit_${stage}`]
    );
    await client.query('COMMIT');
    res.json({ stage, completed: stage === 'completed' });
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    sendApiError(res, error, 'Impossible de terminer la visite.');
  } finally {
    if (client) client.release();
  }
});

app.post('/api/logs', requireAuth, requireAidantSeniorContext, async (req, res) => {
  const { content, log_type: logType } = req.body || {};
  const authorIds = { senior: 1, aidant: 2, pro: 3 };
  const allowedTypes = {
    senior: new Set(['meal_delivery', 'family_note']),
    aidant: new Set(['family_note', 'meal_delivery']),
    pro: new Set(['medical_report'])
  };

  if (typeof content !== 'string' || !content.trim() || content.length > 2000 ||
      !allowedTypes[req.authUser.role].has(logType)) {
    return res.status(400).json({ error: 'Vérifiez le contenu et le type de note.' });
  }

  try {
    await authService.ensureSchema();
    const { rows } = await pool.query(
      `INSERT INTO app_logs (senior_id, author_id, content, log_type)
       VALUES ($1, $2, $3, $4)
       RETURNING id, senior_id, author_id, content, log_type, created_at`,
      [req.authUser.seniorId, authorIds[req.authUser.role], content.trim(), logType]
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    sendApiError(res, error, 'Erreur lors de l’enregistrement.');
  }
});

app.get('/api/meals/today', (req, res) => {
  res.json([
    {
      id: 101,
      title: 'Filet de colin sauce citronnée, purée de carottes douce',
      type: 'Médicalisé',
      tags: ['Sans sel ajouté'],
      price: 8.9
    },
    {
      id: 102,
      title: 'Rôti de veau au jus, petits pois et pommes grenailles',
      type: 'Traditionnel',
      tags: ['Diabétique compatible'],
      price: 10.5
    },
    {
      id: 103,
      title: 'Velouté de potimarron aux châtaignes',
      type: 'Plaisir',
      tags: ['Végétarien'],
      price: 7.5
    }
  ]);
});

app.get('/api/logs/all', requireAuth, requireAidantSeniorContext, async (req, res) => {
  try {
    await authService.ensureSchema();
    const { rows } = await pool.query(
      `SELECT id, senior_id, author_id, content, log_type, created_at
       FROM app_logs
       WHERE senior_id = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [req.authUser.seniorId]
    );
    res.json(rows);
  } catch (error) {
    sendApiError(res, error, 'Impossible de charger le carnet.');
  }
});

app.post('/api/video/urgency', requireAuth, requireAidantSeniorContext, async (req, res) => {
  const videoUrl = `https://meet.jit.si/GenerationLiaison_Urgence_${randomBytes(12).toString('hex')}`;
  const authorId = { senior: 1, aidant: 2, pro: 3 }[req.authUser.role];

  try {
    await authService.ensureSchema();
    await pool.query(
      `INSERT INTO app_logs (senior_id, author_id, content, log_type)
       VALUES ($1, $2, $3, 'medical_report')`,
      [req.authUser.seniorId, authorId, `Demande d’appel vidéo urgent : ${videoUrl}`]
    );
    res.status(201).json({ url: videoUrl });
  } catch (error) {
    sendApiError(res, error, 'Impossible de créer l’appel vidéo.');
  }
});

async function expireDirectoryBookingHolds() {
  const { rows } = await pool.query(
    `UPDATE app_directory_bookings
     SET status = 'expired', hold_expires_at = NULL, updated_at = CURRENT_TIMESTAMP
     WHERE status = 'pending' AND hold_expires_at <= CURRENT_TIMESTAMP
     RETURNING id, requester_user_id, professional_user_id, google_event_id`
  );
  for (const booking of rows) {
    try {
      const { rows: professionals } = await pool.query(
        `SELECT google_calendar_refresh_token FROM app_users WHERE id = $1`,
        [booking.professional_user_id]
      );
      if (professionals[0]?.google_calendar_refresh_token) {
        const accessToken = await getCalendarAccessToken(professionals[0].google_calendar_refresh_token);
        await googleCalendar.deleteHoldEvent(accessToken, booking.google_event_id);
      }
      await insertAppNotification(
        pool,
        booking.requester_user_id,
        'directory_booking',
        'Réservation provisoire expirée',
        'Le professionnel n’a pas répondu dans les 15 minutes. Choisissez un autre créneau si besoin.',
        'directory_booking',
        booking.id
      );
    } catch (error) {
      console.error(`Expiration de la réservation ${booking.id} incomplète :`, error);
    }
  }
}

function startDirectoryBookingCleanup() {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await expireDirectoryBookingHolds();
    } catch (error) {
      console.error('Nettoyage des réservations annuaire impossible :', error);
    } finally {
      running = false;
    }
  }, 60 * 1000);
  timer.unref();
}

function startAssistantConversationCleanup() {
  const cleanExpiredConversations = async () => {
    try {
      await pool.query(`DELETE FROM app_ai_conversations WHERE expires_at <= CURRENT_TIMESTAMP`);
    } catch (error) {
      console.error('Nettoyage des conversations IA expirées impossible :', error);
    }
  };
  cleanExpiredConversations();
  const timer = setInterval(cleanExpiredConversations, 24 * 60 * 60 * 1000);
  timer.unref();
}

function startWellbeingCheckinCleanup() {
  const cleanExpiredCheckins = async () => {
    try {
      await pool.query(
        `DELETE FROM app_notifications
         WHERE entity_type = 'wellbeing_checkin'
           AND entity_id IN (
             SELECT id FROM app_wellbeing_checkins WHERE expires_at <= CURRENT_TIMESTAMP
           )`
      );
      await pool.query(
        `DELETE FROM app_wellbeing_checkins WHERE expires_at <= CURRENT_TIMESTAMP`
      );
    } catch (error) {
      console.error('Nettoyage des check-ins de bien-être expirés impossible :', error);
    }
  };
  cleanExpiredCheckins();
  const timer = setInterval(cleanExpiredCheckins, 60 * 60 * 1000);
  timer.unref();
}

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🚀 Serveur démarré sur : http://localhost:${PORT}`);
  });
  authService.ensureSchema()
    .then(() => {
      notificationDelivery.startDeliveryWorker(pool);
      startDirectoryBookingCleanup();
      startAssistantConversationCleanup();
      startWellbeingCheckinCleanup();
    })
    .catch(error => {
      console.error('Impossible de démarrer le service de notifications :', error);
    });
}

module.exports = app;
