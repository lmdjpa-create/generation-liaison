import { PushNotifications } from '@capacitor/push-notifications';
import { Browser } from '@capacitor/browser';

window.openCalendarAuthorization = async url => Browser.open({ url });

if (window.Capacitor?.isNativePlatform()) {
  PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
    window.pendingPushNotificationId = notification.data?.notificationId;
    window.dispatchEvent(new Event('generation-notification-opened'));
  }).catch(error => console.error('Impossible de suivre l’ouverture des notifications :', error));
}

window.registerNativePush = async (serverUrl, sessionToken) => {
  let permission = await PushNotifications.checkPermissions();
  if (permission.receive !== 'granted') {
    permission = await PushNotifications.requestPermissions();
  }
  if (permission.receive !== 'granted') {
    throw new Error('Autorisez les notifications dans les réglages de votre appareil.');
  }

  return new Promise(async (resolve, reject) => {
    let registrationListener;
    let errorListener;
    const cleanup = async () => {
      clearTimeout(timeout);
      await registrationListener?.remove();
      await errorListener?.remove();
    };
    const timeout = setTimeout(async () => {
      await cleanup();
      reject(new Error('Le service push n’a pas répondu.'));
    }, 20000);
    try {
      registrationListener = await PushNotifications.addListener('registration', async ({ value }) => {
        await cleanup();
        try {
          const response = await fetch(`${serverUrl}/api/notifications/push-subscriptions`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${sessionToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ platform: window.Capacitor.getPlatform(), token: value })
          });
          if (!response.ok) throw new Error('Impossible d’enregistrer cet appareil pour les notifications.');
          resolve({ platform: window.Capacitor.getPlatform(), token: value });
        } catch (error) {
          reject(error);
        }
      });
      errorListener = await PushNotifications.addListener('registrationError', async error => {
        await cleanup();
        reject(new Error(error?.error || 'Échec de l’inscription aux notifications push.'));
      });
      await PushNotifications.register();
    } catch (error) {
      await cleanup();
      reject(error);
    }
  });
};

window.unregisterNativePush = async () => PushNotifications.unregister();
