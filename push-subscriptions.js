const allowedPushHosts = new Set([
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'web.push.apple.com'
]);

function isAllowedWebPushSubscription(token) {
  if (typeof token !== 'string' || token.length > 8192) return false;

  let subscription;
  try {
    subscription = JSON.parse(token);
  } catch {
    return false;
  }
  if (typeof subscription.endpoint !== 'string' ||
      typeof subscription.keys?.p256dh !== 'string' ||
      typeof subscription.keys?.auth !== 'string') {
    return false;
  }

  let endpoint;
  try {
    endpoint = new URL(subscription.endpoint);
  } catch {
    return false;
  }
  return endpoint.protocol === 'https:' &&
    !endpoint.username &&
    !endpoint.password &&
    !endpoint.port &&
    allowedPushHosts.has(endpoint.hostname);
}

module.exports = { isAllowedWebPushSubscription };
