const assert = require('node:assert/strict');
const { test } = require('node:test');
const googleCalendar = require('../google-calendar');

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
