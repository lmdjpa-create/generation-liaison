const assert = require('node:assert/strict');
const { test } = require('node:test');
const googleCalendar = require('../google-calendar');

test('lists all overlapping Google event pages and excludes only the moved or transparent events', async () => {
  const previousFetch = global.fetch;
  const urls = [];
  global.fetch = async url => {
    urls.push(new URL(url));
    return Response.json(urls.length === 1
      ? { items: [{ id: 'moved', status: 'confirmed' }, { id: 'free', transparency: 'transparent' }], nextPageToken: 'next' }
      : { items: [{ id: 'other', status: 'confirmed' }] });
  };
  try {
    const start = new Date('2030-01-01T10:00:00Z');
    const end = new Date('2030-01-01T11:00:00Z');
    assert.equal(await googleCalendar.hasOtherBusyEvents('token', start, end, 'moved'), true);
    assert.equal(urls.length, 2);
    assert.equal(urls[0].searchParams.get('singleEvents'), 'true');
    assert.equal(urls[0].searchParams.get('timeMin'), start.toISOString());
    assert.equal(urls[0].searchParams.get('timeMax'), end.toISOString());
    assert.equal(urls[1].searchParams.get('pageToken'), 'next');
    global.fetch = async () => Response.json({ items: [
      { id: 'moved', status: 'confirmed' }, { id: 'free', transparency: 'transparent' },
      { id: 'deleted', status: 'cancelled' }
    ] });
    assert.equal(await googleCalendar.hasOtherBusyEvents('token', start, end, 'moved'), false);
    global.fetch = async () => Response.json({});
    await assert.rejects(googleCalendar.hasOtherBusyEvents('token', start, end, 'moved'));
  } finally {
    global.fetch = previousFetch;
  }
});

test('requests Calendar event and free/busy scopes and encrypts refresh tokens', () => {
  const keys = [
    'GOOGLE_CALENDAR_CLIENT_ID',
    'GOOGLE_CALENDAR_CLIENT_SECRET',
    'GOOGLE_CALENDAR_REDIRECT_URI',
    'CALENDAR_TOKEN_ENCRYPTION_KEY'
  ];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, {
    GOOGLE_CALENDAR_CLIENT_ID: 'test-client-id',
    GOOGLE_CALENDAR_CLIENT_SECRET: 'test-client-secret',
    GOOGLE_CALENDAR_REDIRECT_URI: 'https://example.test/api/calendar/google/callback',
    CALENDAR_TOKEN_ENCRYPTION_KEY: 'a'.repeat(64)
  });

  test('planning events are private and Google updates use an etag precondition', async () => {
    const previousFetch = global.fetch;
    const requests = [];
    global.fetch = async (url, options) => {
      requests.push({ url, options });
      return { ok: true, status: 200, json: async () => ({ id: 'gl12345', etag: '"v1"' }) };
    };
    try {
      const start = new Date('2030-01-01T10:00:00Z');
      const end = new Date('2030-01-01T10:30:00Z');
      await googleCalendar.createPlanningEvent('token', { eventId: 'gl12345', syncId: 'reference', start, end });
      const payload = JSON.parse(requests[0].options.body);
      assert.equal(payload.visibility, 'private');
      assert.equal(payload.summary, 'Rendez-vous — Génération Liaison');
      assert.equal(payload.extendedProperties.private.generationLiaisonSyncId, 'reference');
      assert.equal(payload.description, undefined);
      assert.equal(payload.attendees, undefined);
      await googleCalendar.updatePlanningEvent('token', 'gl12345', '"v1"', { start, end });
      assert.equal(requests[1].options.headers['If-Match'], '"v1"');
    } finally {
      global.fetch = previousFetch;
    }
  });

  test('Google precondition failures are exposed to the synchronization worker', async () => {
    const previousFetch = global.fetch;
    global.fetch = async () => ({ ok: false, status: 412 });
    try {
      await assert.rejects(googleCalendar.updatePlanningEvent('token', 'gl12345', '"v1"', {
        start: new Date('2030-01-01T10:00:00Z'), end: new Date('2030-01-01T10:30:00Z')
      }), error => error.status === 412);
    } finally {
      global.fetch = previousFetch;
    }
  });
  try {
    const authorization = new URL(googleCalendar.authorizationUrl('one-time-state'));
    assert.deepEqual(authorization.searchParams.get('scope').split(' '), [
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/calendar.freebusy'
    ]);

    const encrypted = googleCalendar.encryptRefreshToken('example-refresh-token');
    assert.notEqual(encrypted, 'example-refresh-token');
    assert.equal(googleCalendar.decryptRefreshToken(encrypted), 'example-refresh-token');
    const tampered = encrypted.split('.');
    tampered[2] = `${tampered[2][0] === 'A' ? 'B' : 'A'}${tampered[2].slice(1)}`;
    assert.throws(
      () => googleCalendar.decryptRefreshToken(tampered.join('.')),
      /Unsupported state|unable to authenticate/i
    );
  } finally {
    keys.forEach(key => {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    });
  }
});
