const { createCipheriv, createDecipheriv, randomBytes } = require('node:crypto');

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const GOOGLE_CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.freebusy'
];

function configuration() {
  const { GOOGLE_CALENDAR_CLIENT_ID, GOOGLE_CALENDAR_CLIENT_SECRET, GOOGLE_CALENDAR_REDIRECT_URI,
    CALENDAR_TOKEN_ENCRYPTION_KEY } = process.env;
  const keyIsValid = typeof CALENDAR_TOKEN_ENCRYPTION_KEY === 'string' &&
    /^[a-f0-9]{64}$/i.test(CALENDAR_TOKEN_ENCRYPTION_KEY);
  return {
    clientId: GOOGLE_CALENDAR_CLIENT_ID || '',
    clientSecret: GOOGLE_CALENDAR_CLIENT_SECRET || '',
    redirectUri: GOOGLE_CALENDAR_REDIRECT_URI || '',
    encryptionKey: keyIsValid ? Buffer.from(CALENDAR_TOKEN_ENCRYPTION_KEY, 'hex') : null
  };
}

function isConfigured() {
  const config = configuration();
  return Boolean(config.clientId && config.clientSecret && config.redirectUri && config.encryptionKey);
}

function assertConfigured() {
  if (!isConfigured()) {
    throw new Error('La connexion Google Calendar n’est pas encore configurée par l’administrateur.');
  }
}

function authorizationUrl(state) {
  assertConfigured();
  const config = configuration();
  const url = new URL(GOOGLE_AUTH_URL);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: GOOGLE_CALENDAR_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state
  });
  return url.toString();
}

async function postToken(parameters) {
  const config = configuration();
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(10000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      ...parameters
    })
  });
  const result = await response.json();
  if (!response.ok || result.error) {
    throw new Error('Google Calendar n’a pas autorisé cette opération. Vérifiez la connexion et les paramètres OAuth.');
  }
  return result;
}

async function exchangeAuthorizationCode(code) {
  assertConfigured();
  const config = configuration();
  const result = await postToken({
    code,
    redirect_uri: config.redirectUri,
    grant_type: 'authorization_code'
  });
  if (typeof result.refresh_token !== 'string' || !result.refresh_token) {
    throw new Error('Google n’a pas fourni de jeton de renouvellement. Reconnectez l’agenda en autorisant l’accès demandé.');
  }
  return result.refresh_token;
}

async function getAccessToken(refreshToken) {
  assertConfigured();
  const result = await postToken({
    refresh_token: refreshToken,
    grant_type: 'refresh_token'
  });
  if (typeof result.access_token !== 'string' || !result.access_token) {
    throw new Error('Google Calendar n’a pas fourni de jeton d’accès.');
  }
  return result.access_token;
}

function encryptRefreshToken(refreshToken) {
  assertConfigured();
  const { encryptionKey } = configuration();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(refreshToken, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    encrypted.toString('base64url')
  ].join('.');
}

function decryptRefreshToken(encryptedToken) {
  assertConfigured();
  const parts = encryptedToken.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('Le jeton Google Calendar enregistré est invalide.');
  }
  const { encryptionKey } = configuration();
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(parts[1], 'base64url'));
  decipher.setAuthTag(Buffer.from(parts[2], 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(parts[3], 'base64url')),
    decipher.final()
  ]).toString('utf8');
}

async function calendarRequest(path, accessToken, options = {}) {
  const response = await fetch(`${GOOGLE_CALENDAR_API}${path}`, {
    ...options,
    signal: options.signal || AbortSignal.timeout(10000),
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers
    }
  });
  if (!response.ok) {
    if ([404, 410].includes(response.status) && options.allowMissing) return null;
    const error = new Error(`Google Calendar a refusé la requête (HTTP ${response.status}).`);
    error.status = response.status;
    throw error;
  }
  if (response.status === 204) return null;
  return response.json();
}

async function getBusyIntervals(accessToken, start, end) {
  const result = await calendarRequest('/freeBusy', accessToken, {
    method: 'POST',
    body: JSON.stringify({
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      items: [{ id: 'primary' }]
    })
  });
  const errors = result.calendars?.primary?.errors;
  if (errors?.length || !result.calendars?.primary) {
    throw new Error('Impossible de lire les disponibilités de l’agenda Google principal.');
  }
  return result.calendars.primary.busy.map(interval => ({
    start: new Date(interval.start),
    end: new Date(interval.end)
  }));
}

async function createHoldEvent(accessToken, { start, end, bookingId }) {
  const result = await calendarRequest('/calendars/primary/events?sendUpdates=none', accessToken, {
    method: 'POST',
    body: JSON.stringify({
      summary: 'Demande de rendez-vous — Génération Liaison (en attente)',
      description: `Créneau temporairement réservé dans Génération Liaison. Référence : ${bookingId}.`,
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
      transparency: 'opaque',
      extendedProperties: { private: { generationLiaisonBookingId: bookingId } }
    })
  });
  if (!result.id) throw new Error('Google Calendar n’a pas confirmé le blocage temporaire du créneau.');
  return result.id;
}

async function confirmHoldEvent(accessToken, eventId, requesterEmail) {
  await calendarRequest(`/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=all`, accessToken, {
    method: 'PATCH',
    body: JSON.stringify({
      summary: 'Rendez-vous — Génération Liaison',
      description: 'Rendez-vous confirmé depuis Génération Liaison.',
      attendees: [{ email: requesterEmail }]
    })
  });
}

async function deleteHoldEvent(accessToken, eventId) {
  return calendarRequest(
    `/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=none`,
    accessToken,
    { method: 'DELETE', allowMissing: true }
  );
}

async function getPlanningEvent(accessToken, eventId) {
  return calendarRequest(`/calendars/primary/events/${encodeURIComponent(eventId)}`, accessToken, {
    allowMissing: true
  });
}

async function hasOtherBusyEvents(accessToken, start, end, excludedEventId) {
  const seenTokens = new Set();
  let pageToken;
  for (let page = 0; page < 100; page++) {
    const params = new URLSearchParams({
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: 'true',
      showDeleted: 'false',
      showHiddenInvitations: 'true',
      maxResults: '2500',
      fields: 'nextPageToken,items(id,status,transparency)'
    });
    if (pageToken) params.set('pageToken', pageToken);
    const result = await calendarRequest(`/calendars/primary/events?${params}`, accessToken);
    if (!Array.isArray(result?.items)) {
      throw new Error('Impossible de vérifier les événements de l’agenda Google principal.');
    }
    for (const event of result.items) {
      if (!event?.id) throw new Error('Événement Google incomplet : vérification impossible.');
      if (event.id !== excludedEventId && event.status !== 'cancelled' && event.transparency !== 'transparent') {
        return true;
      }
    }
    pageToken = result.nextPageToken;
    if (!pageToken) return false;
    if (typeof pageToken !== 'string' || seenTokens.has(pageToken)) {
      throw new Error('Pagination Google Calendar invalide.');
    }
    seenTokens.add(pageToken);
  }
  throw new Error('Trop d’événements Google pour vérifier le créneau.');
}

async function createPlanningEvent(accessToken, { eventId, syncId, start, end }) {
  return calendarRequest('/calendars/primary/events?sendUpdates=none', accessToken, {
    method: 'POST',
    body: JSON.stringify({
      id: eventId,
      summary: 'Rendez-vous — Génération Liaison',
      visibility: 'private',
      transparency: 'opaque',
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
      extendedProperties: { private: { generationLiaisonSyncId: syncId } }
    })
  });
}

async function updatePlanningEvent(accessToken, eventId, etag, { start, end }) {
  if (!etag) throw new Error('La version de l’événement Google est absente.');
  return calendarRequest(`/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=none`, accessToken, {
    method: 'PATCH',
    headers: { 'If-Match': etag },
    body: JSON.stringify({
      status: 'confirmed',
      visibility: 'private',
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() }
    })
  });
}

async function deletePlanningEvent(accessToken, eventId, etag) {
  if (!etag) throw new Error('La version de l’événement Google est absente.');
  return calendarRequest(`/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=none`, accessToken, {
    method: 'DELETE',
    headers: { 'If-Match': etag },
    allowMissing: true
  });
}

module.exports = {
  authorizationUrl,
  confirmHoldEvent,
  createHoldEvent,
  createPlanningEvent,
  decryptRefreshToken,
  deleteHoldEvent,
  deletePlanningEvent,
  encryptRefreshToken,
  exchangeAuthorizationCode,
  getAccessToken,
  getBusyIntervals,
  hasOtherBusyEvents,
  getPlanningEvent,
  updatePlanningEvent,
  isConfigured
};
