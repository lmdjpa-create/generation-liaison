const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { test } = require('node:test');
const { PGlite } = require('@electric-sql/pglite');
const { createAuthService } = require('../auth');
const { createPlanningGoogleSync } = require('../planning-google-sync');

test('authenticated participants approve a Google move through the API', async t => {
  const db = new PGlite();
  const query = async (sql, params) => {
    if (!params && sql.includes(';')) {
      const results = await db.exec(sql);
      return results[results.length - 1];
    }
    return db.query(sql, params);
  };
  const pool = { query, async connect() { return { query, release() {} }; } };
  const pg = require('pg');
  const originalPool = pg.Pool;
  const originalFetch = global.fetch;
  const keys = ['DATABASE_URL', 'GOOGLE_CALENDAR_CLIENT_ID', 'GOOGLE_CALENDAR_CLIENT_SECRET',
    'GOOGLE_CALENDAR_REDIRECT_URI', 'CALENDAR_TOKEN_ENCRYPTION_KEY'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, {
    DATABASE_URL: 'postgresql://test.invalid/test',
    GOOGLE_CALENDAR_CLIENT_ID: 'test-client',
    GOOGLE_CALENDAR_CLIENT_SECRET: 'test-secret',
    GOOGLE_CALENDAR_REDIRECT_URI: 'https://example.test/callback',
    CALENDAR_TOKEN_ENCRYPTION_KEY: 'a'.repeat(64)
  });
  pg.Pool = class { constructor() { return pool; } };
  const calendar = require('../google-calendar');
  const app = require('../server');
  let server;
  t.after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    global.fetch = originalFetch;
    pg.Pool = originalPool;
    keys.forEach(key => {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    });
    await db.close();
  });

  await createAuthService(pool).ensureSchema();
  const pro = randomUUID();
  const family = randomUUID();
  const proProfile = randomUUID();
  const senior = randomUUID();
  const organization = randomUUID();
  const recipient = randomUUID();
  const visit = randomUUID();
  const proToken = 'a'.repeat(64);
  const familyToken = 'b'.repeat(64);
  const start = new Date(Date.now() + 5 * 86400000);
  start.setUTCSeconds(0, 0);
  await query(`INSERT INTO senior_profiles (id, name) VALUES ($1, 'Pro'), ($2, 'Senior')`, [proProfile, senior]);
  await query(
    `INSERT INTO app_users
       (id, senior_id, name, email, role, verification_status, password_salt, password_hash,
        google_calendar_refresh_token, google_calendar_connected_at, planning_google_sync_enabled)
     VALUES ($1, $2, 'Pro', 'pro@example.test', 'pro', 'approved', $5, $6, $7, CURRENT_TIMESTAMP, TRUE),
            ($3, $4, 'Senior', 'senior@example.test', 'senior', 'approved', $5, $6, NULL, NULL, FALSE)`,
    [pro, proProfile, family, senior, '0'.repeat(32), '0'.repeat(128), calendar.encryptRefreshToken('refresh')]
  );
  await query('UPDATE app_users SET verification_reviewed_at = CURRENT_TIMESTAMP WHERE id = $1', [pro]);
  await query(
    `INSERT INTO app_sessions (token_hash, user_id, expires_at) VALUES
      ($1, $2, CURRENT_TIMESTAMP + INTERVAL '1 day'), ($3, $4, CURRENT_TIMESTAMP + INTERVAL '1 day')`,
    [createHash('sha256').update(proToken).digest('hex'), pro,
      createHash('sha256').update(familyToken).digest('hex'), family]
  );
  await query(`INSERT INTO planning_organizations (id, name, coordinator_user_id) VALUES ($1, 'Equipe', $2)`,
    [organization, pro]);
  await query(`INSERT INTO planning_org_members (organization_id, user_id, role) VALUES ($1, $2, 'professional')`,
    [organization, pro]);
  await query(
    `INSERT INTO planning_recipients (id, organization_id, senior_id, name, consent_at, created_by)
     VALUES ($1, $2, $3, 'Personne', CURRENT_TIMESTAMP, $4)`,
    [recipient, organization, senior, pro]
  );
  await query(
    `INSERT INTO planning_visits
       (id, organization_id, recipient_id, assigned_user_id, scheduled_at, duration_minutes, visit_type, created_by, acceptance_status)
     VALUES ($1, $2, $3, $4, $5, 60, 'Visite', $4, 'accepted')`,
    [visit, organization, recipient, pro, start]
  );

  const googleEvents = new Map();
  let version = 0;
  let failList = false;
  global.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.startsWith('http://127.0.0.1:')) return originalFetch(url, options);
    if (target === 'https://oauth2.googleapis.com/token') {
      return Response.json({ access_token: 'access' });
    }
    if (!target.startsWith('https://www.googleapis.com/calendar/v3/')) throw new Error('Unexpected request');
    const parsed = new URL(target);
    const id = parsed.pathname.split('/').pop();
    if (parsed.pathname.endsWith('/events') && (!options.method || options.method === 'GET')) {
      if (failList) return new Response(null, { status: 503 });
      return Response.json({ items: [...googleEvents.values()] });
    }
    if (options.method === 'POST') {
      const event = { ...JSON.parse(options.body), status: 'confirmed', etag: `"${++version}"` };
      googleEvents.set(event.id, event);
      return Response.json(event);
    }
    const event = googleEvents.get(id);
    if (!event) return new Response(null, { status: 404 });
    if (options.method === 'PATCH') {
      if (options.headers['If-Match'] !== event.etag) return new Response(null, { status: 412 });
      const updated = { ...event, ...JSON.parse(options.body), etag: `"${++version}"` };
      googleEvents.set(id, updated);
      return Response.json(updated);
    }
    if (options.method === 'DELETE') {
      if (options.headers['If-Match'] !== event.etag) return new Response(null, { status: 412 });
      googleEvents.delete(id);
      return new Response(null, { status: 204 });
    }
    return Response.json(event);
  };
  const worker = createPlanningGoogleSync({
    pool, calendar,
    getAccessToken: token => calendar.getAccessToken(calendar.decryptRefreshToken(token)),
    notify: async () => {}
  });
  await worker.run();
  const mapping = (await query('SELECT * FROM planning_google_events')).rows[0];
  const event = googleEvents.get(mapping.google_event_id);
  const moved = new Date(start.getTime() + 120 * 60000);
  googleEvents.set(mapping.google_event_id, {
    ...event, etag: '"edited"',
    start: { dateTime: moved.toISOString() },
    end: { dateTime: new Date(moved.getTime() + 3600000).toISOString() }
  });
  await worker.processOne(mapping.id);
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, token, body) => originalFetch(`${base}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const requests = await call('/api/calendar/planning/requests', familyToken);
  assert.equal(requests.status, 200);
  assert.equal((await requests.json()).requests.length, 1);
  assert.equal((await call('/api/calendar/planning/status', proToken, { enabled: false })).status, 200);
  assert.equal((await call(`/api/calendar/planning/requests/${mapping.id}`, familyToken, { decision: 'approve' })).status, 409);
  assert.equal((await call('/api/calendar/planning/status', proToken, { enabled: true })).status, 200);
  const first = await call(`/api/calendar/planning/requests/${mapping.id}`, proToken, { decision: 'approve' });
  assert.deepEqual(await first.json(), { status: 'waiting' });
  assert.equal((await query('SELECT scheduled_at FROM planning_visits WHERE id = $1', [visit])).rows[0].scheduled_at.toISOString(), start.toISOString());
  const beforeFailedCheck = structuredClone(googleEvents.get(mapping.google_event_id));
  failList = true;
  assert.equal((await call(`/api/calendar/planning/requests/${mapping.id}`, familyToken, { decision: 'approve' })).status, 500);
  assert.equal((await query('SELECT scheduled_at FROM planning_visits WHERE id = $1', [visit])).rows[0].scheduled_at.toISOString(), start.toISOString());
  assert.deepEqual(googleEvents.get(mapping.google_event_id), beforeFailedCheck);
  failList = false;
  const unrelated = { id: 'existing-event', status: 'confirmed', etag: '"other"',
    start: { dateTime: moved.toISOString() },
    end: { dateTime: new Date(moved.getTime() + 3600000).toISOString() } };
  googleEvents.set(unrelated.id, unrelated);
  const movedCopy = structuredClone(googleEvents.get(mapping.google_event_id));
  assert.equal((await call(`/api/calendar/planning/requests/${mapping.id}`, familyToken, { decision: 'approve' })).status, 409);
  assert.deepEqual(googleEvents.get(unrelated.id), unrelated);
  assert.deepEqual(googleEvents.get(mapping.google_event_id), movedCopy);
  assert.equal((await query('SELECT scheduled_at FROM planning_visits WHERE id = $1', [visit])).rows[0].scheduled_at.toISOString(), start.toISOString());
  googleEvents.delete(unrelated.id);
  const second = await call(`/api/calendar/planning/requests/${mapping.id}`, familyToken, { decision: 'approve' });
  assert.deepEqual(await second.json(), { status: 'applied' });
  assert.equal((await query('SELECT scheduled_at FROM planning_visits WHERE id = $1', [visit])).rows[0].scheduled_at.toISOString(), moved.toISOString());
  const revoke = await call(`/api/planning/consents/${recipient}`, familyToken, { consented: false });
  assert.equal(revoke.status, 200);
  const remaining = (await query('SELECT senior_id, proposal FROM planning_google_events WHERE id = $1', [mapping.id])).rows[0];
  assert.equal(remaining.senior_id, null);
  assert.equal(remaining.proposal, null);
  assert.equal((await query(`SELECT COUNT(*)::int AS count FROM app_notifications
    WHERE entity_type = 'google_schedule_change' AND entity_id = $1`, [mapping.id])).rows[0].count, 0);
  await worker.processOne(mapping.id);
  assert.equal(googleEvents.has(mapping.google_event_id), false);
  assert.equal((await query('SELECT COUNT(*)::int AS count FROM planning_google_events')).rows[0].count, 0);
});
