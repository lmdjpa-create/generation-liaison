const assert = require('node:assert/strict');
const { createHash, randomBytes, randomUUID } = require('node:crypto');
const { before, after, test } = require('node:test');

const connectionString = process.env.AGENDA_PG_TEST_URL;

if (!connectionString) {
  test('PostgreSQL concurrency tests require an isolated test database', { skip: true }, () => {});
} else {
  const parsed = new URL(connectionString);
  if (!['localhost', '127.0.0.1'].includes(parsed.hostname) ||
      parsed.pathname !== '/agenda_isolated' || parsed.username !== 'agenda_test') {
    throw new Error('AGENDA_PG_TEST_URL must identify the isolated local agenda_isolated database');
  }

  const pg = require('pg');
  const { createAuthService } = require('../auth');
  const pool = new pg.Pool({ connectionString, max: 12, application_name: 'agenda-concurrency-test' });
  const adminCode = 'isolated-test-administrator-code-at-least-32-characters';
  let baseUrl;
  let server;
  let admin;
  let calendarConfirmations = 0;

  before(async () => {
    await createAuthService(pool).ensureSchema();
    process.env.DATABASE_URL = connectionString;
    process.env.ADMIN_EMAILS = 'admin@example.test';
    process.env.ADMIN_ACCESS_CODE = adminCode;
    pg.Pool = class { constructor() { return pool; } };
    const calendar = require('../google-calendar');
    calendar.decryptRefreshToken = () => 'refresh';
    calendar.getAccessToken = async () => 'access';
    calendar.confirmHoldEvent = async () => { calendarConfirmations++; };
    calendar.getBusyIntervals = async () => [];
    calendar.createHoldEvent = async () => randomUUID();
    const app = require('../server');
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    admin = await person('senior', 'admin@example.test');
  });

  after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    await pool.end();
  });

  async function person(role, email = `${randomUUID()}@example.test`) {
    const id = randomUUID();
    const seniorId = randomUUID();
    const token = randomBytes(32).toString('hex');
    await pool.query('INSERT INTO senior_profiles (id, name) VALUES ($1, $2)', [seniorId, email]);
    await pool.query(`INSERT INTO app_users
      (id, senior_id, name, email, role, verification_status, verification_reviewed_at,
       password_salt, password_hash, google_calendar_refresh_token)
      VALUES ($1, $2, $3, $3, $4, 'approved', CURRENT_TIMESTAMP, $5, $6, 'test')`,
    [id, seniorId, email, role, '0'.repeat(32), '0'.repeat(128)]);
    await pool.query(`INSERT INTO app_sessions (token_hash, user_id, expires_at)
      VALUES ($1, $2, CURRENT_TIMESTAMP + INTERVAL '1 day')`,
    [createHash('sha256').update(token).digest('hex'), id]);
    return { id, seniorId, token };
  }

  async function request(path, user, method, body, admin = false, seniorId = null) {
    const headers = { Authorization: `Bearer ${user.token}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (admin) headers['X-Admin-Access-Code'] = adminCode;
    if (seniorId) headers['X-Senior-Profile-Id'] = seniorId;
    const response = await fetch(`${baseUrl}${path}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, data: await response.json() };
  }

  async function waitForAdvisoryWaiters(count, result) {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const { rows } = await pool.query(`SELECT count(*)::int AS count
        FROM pg_locks lock JOIN pg_stat_activity activity ON activity.pid = lock.pid
        WHERE lock.locktype = 'advisory' AND NOT lock.granted
          AND activity.application_name = 'agenda-concurrency-test'`);
      if (rows[0].count >= count) return;
      if (result()) throw new Error(`Request finished before reaching the lock: ${JSON.stringify(result())}`);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error(`Timed out waiting for ${count} PostgreSQL advisory lock waiters`);
  }

  async function raceOn(key, first, second) {
    const gate = await pool.connect();
    let firstRequest;
    let secondRequest;
    let firstResult;
    let secondResult;
    try {
      await gate.query('BEGIN');
      await gate.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
      firstRequest = first();
      firstRequest.then(result => { firstResult = result; });
      await waitForAdvisoryWaiters(1, () => firstResult);
      secondRequest = second();
      secondRequest.then(result => { secondResult = result; });
      await waitForAdvisoryWaiters(2, () => secondResult);
      await gate.query('COMMIT');
      return await Promise.all([firstRequest, secondRequest]);
    } finally {
      await gate.query('ROLLBACK');
      gate.release();
      await Promise.allSettled([firstRequest, secondRequest].filter(Boolean));
    }
  }

  async function fixture({ linked = false, legacyStatus = 'confirmed' } = {}) {
    const senior = await person('senior');
    const otherSenior = await person('senior');
    const aidant = await person('aidant');
    const legacyPro = await person('pro');
    const visitPro = await person('pro');
    const organization = randomUUID();
    const recipient = randomUUID();
    const visit = randomUUID();
    const legacy = randomUUID();
    const linkRequest = randomUUID();
    const start = new Date(Date.now() + 5 * 86400000);
    start.setUTCHours(10, 0, 0, 0);
    await pool.query(`INSERT INTO app_aidant_senior_links (aidant_user_id, senior_profile_id, linked_by)
      VALUES ($1, $2, $1)`, [aidant.id, otherSenior.seniorId]);
    if (linked) {
      await pool.query(`INSERT INTO app_aidant_senior_links (aidant_user_id, senior_profile_id, linked_by)
        VALUES ($1, $2, $1)`, [aidant.id, senior.seniorId]);
    } else {
      await pool.query(`INSERT INTO app_aidant_link_requests (id, aidant_user_id, senior_user_id)
        VALUES ($1, $2, $3)`, [linkRequest, aidant.id, senior.id]);
    }
    await pool.query(`INSERT INTO app_directory_bookings
      (id, requester_user_id, professional_user_id, scheduled_at, duration_minutes,
       google_event_id, status, hold_expires_at)
      VALUES ($1, $2, $3, $4, 60, 'legacy-test', $5::varchar,
              CASE WHEN $5::varchar = 'pending' THEN CURRENT_TIMESTAMP + INTERVAL '1 hour' ELSE NULL END)`,
    [legacy, aidant.id, legacyPro.id, start, legacyStatus]);
    await pool.query(`INSERT INTO planning_organizations (id, name, coordinator_user_id)
      VALUES ($1, 'Test', $2)`, [organization, visitPro.id]);
    await pool.query(`INSERT INTO planning_org_members (organization_id, user_id, role)
      VALUES ($1, $2, 'professional')`, [organization, visitPro.id]);
    await pool.query(`INSERT INTO planning_recipients (id, organization_id, senior_id, name, consent_at, created_by)
      VALUES ($1, $2, $3, 'Test', CURRENT_TIMESTAMP, $4)`, [recipient, organization, senior.seniorId, visitPro.id]);
    await pool.query(`INSERT INTO planning_visits
      (id, organization_id, recipient_id, assigned_user_id, scheduled_at, duration_minutes,
       visit_type, created_by, acceptance_status)
      VALUES ($1, $2, $3, $4, $5, 60, 'Test', $4, 'pending')`,
    [visit, organization, recipient, visitPro.id, start]);
    return { senior, otherSenior, aidant, legacyPro, visitPro, organization, recipient,
      visit, legacy, linkRequest, start };
  }

  const acceptLink = f => request(`/api/senior-links/requests/${f.linkRequest}/decision`,
    f.senior, 'POST', { decision: 'accept' });
  const acceptVisit = f => request(`/api/planning/visits/${f.visit}/response`,
    f.visitPro, 'POST', { acceptanceStatus: 'accepted' });
  const confirmLegacy = f => request(`/api/directory/bookings/${f.legacy}`,
    f.legacyPro, 'PATCH', { decision: 'confirmed' });

  async function enableDirectory(f) {
    const hours = [{ dayOfWeek: f.start.getUTCDay(), startTime: '00:00', endTime: '23:00' }];
    await pool.query(`UPDATE app_users SET directory_listed = TRUE, home_latitude = 0, home_longitude = 0,
      appointment_timezone = 'UTC', appointment_weekly_hours = $2::jsonb,
      appointment_duration_minutes = 60 WHERE id = $1`, [f.visitPro.id, JSON.stringify(hours)]);
  }

  for (const linkFirst of [true, false]) {
    test(`real PostgreSQL serializes link addition and a new overlapping directory hold (${linkFirst ? 'link' : 'hold'} first)`, async () => {
      const f = await fixture();
      await enableDirectory(f);
      const book = () => request(`/api/directory/${f.visitPro.id}/bookings`, f.senior,
        'POST', { start: f.start.toISOString() });
      const results = await raceOn(`senior:${f.senior.seniorId}`,
        linkFirst ? () => acceptLink(f) : book, linkFirst ? book : () => acceptLink(f));
      assert.deepEqual(results.map(result => result.status), [linkFirst ? 200 : 201, 409],
        JSON.stringify(results));
      const { rows } = await pool.query(`SELECT
        EXISTS(SELECT 1 FROM app_aidant_senior_links WHERE aidant_user_id = $1 AND senior_profile_id = $2) AS linked,
        (SELECT count(*)::int FROM app_directory_bookings
         WHERE requester_user_id = $3 AND senior_profile_id = $2 AND status = 'pending') AS holds`,
      [f.aidant.id, f.senior.seniorId, f.senior.id]);
      assert.deepEqual(rows[0], { linked: linkFirst, holds: linkFirst ? 0 : 1 });
    });
  }

  for (const removeFirst of [true, false]) {
    test(`real PostgreSQL revalidates caregiver permissions for a new hold (${removeFirst ? 'removal' : 'hold'} first)`, async () => {
      const f = await fixture({ linked: true });
      await enableDirectory(f);
      const start = new Date(f.start.getTime() + 4 * 3600000);
      const book = () => request(`/api/directory/${f.visitPro.id}/bookings`, f.aidant,
        'POST', { start: start.toISOString() }, false, f.senior.seniorId);
      const remove = () => request(`/api/admin/accounts/${f.aidant.id}/senior-links/${f.senior.seniorId}`,
        admin, 'DELETE', undefined, true);
      const results = await raceOn(`senior:${f.senior.seniorId}`,
        removeFirst ? remove : book, removeFirst ? book : remove);
      assert.deepEqual(results.map(result => result.status), removeFirst ? [200, 403] : [201, 200],
        JSON.stringify(results));
      const { rows } = await pool.query(`SELECT count(*)::int AS count FROM app_directory_bookings
        WHERE requester_user_id = $1 AND senior_profile_id = $2 AND status = 'pending'`,
      [f.aidant.id, f.senior.seniorId]);
      assert.equal(rows[0].count, removeFirst ? 0 : 1);
    });
  }

  for (const linkFirst of [true, false]) {
    test(`real PostgreSQL serializes link addition and overlapping visit (${linkFirst ? 'link' : 'visit'} first)`, async () => {
      const f = await fixture();
      const first = linkFirst ? () => acceptLink(f) : () => acceptVisit(f);
      const second = linkFirst ? () => acceptVisit(f) : () => acceptLink(f);
      const results = await raceOn(`senior:${f.senior.seniorId}`, first, second);
      assert.deepEqual(results.map(result => result.status), [200, 409], JSON.stringify(results));
      const { rows } = await pool.query(`SELECT
        EXISTS(SELECT 1 FROM app_aidant_senior_links WHERE aidant_user_id = $1 AND senior_profile_id = $2) AS linked,
        (SELECT acceptance_status FROM planning_visits WHERE id = $3) AS visit_status`,
      [f.aidant.id, f.senior.seniorId, f.visit]);
      assert.deepEqual(rows[0], { linked: linkFirst, visit_status: linkFirst ? 'pending' : 'accepted' });
      if (!linkFirst) {
        const notification = await pool.query(`SELECT count(*)::int AS count FROM app_notifications
          WHERE user_id = $1 AND entity_id = $2`, [f.senior.id, f.visit]);
        assert.equal(notification.rows[0].count, 1);
      }
    });
  }

  for (const removeFirst of [true, false]) {
    test(`real PostgreSQL serializes removal and overlapping visit (${removeFirst ? 'removal' : 'visit'} first)`, async () => {
      const f = await fixture({ linked: true });
      const remove = () => request(`/api/admin/accounts/${f.aidant.id}/senior-links/${f.senior.seniorId}`,
        admin, 'DELETE', undefined, true);
      const results = await raceOn(`senior:${f.senior.seniorId}`,
        removeFirst ? remove : () => acceptVisit(f), removeFirst ? () => acceptVisit(f) : remove);
      assert.deepEqual(results.map(result => result.status), removeFirst ? [200, 200] : [409, 200],
        JSON.stringify(results));
      const { rows } = await pool.query(`SELECT
        count(*) FILTER (WHERE senior_profile_id = $2)::int AS removed,
        count(*) FILTER (WHERE senior_profile_id = $3)::int AS remaining
        FROM app_aidant_senior_links WHERE aidant_user_id = $1`,
      [f.aidant.id, f.senior.seniorId, f.otherSenior.seniorId]);
      assert.deepEqual(rows[0], { removed: 0, remaining: 1 });
    });
  }

  test('real PostgreSQL detects a link added while legacy confirmation waits', async () => {
    const f = await fixture({ legacyStatus: 'pending' });
    const gate = await pool.connect();
    let confirmation;
    try {
      await gate.query('BEGIN');
      await gate.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`professional:${f.legacyPro.id}`]);
      let result;
      confirmation = confirmLegacy(f);
      confirmation.then(value => { result = value; });
      await waitForAdvisoryWaiters(1, () => result);
      const linked = await acceptLink(f);
      assert.equal(linked.status, 200, JSON.stringify(linked));
      const before = calendarConfirmations;
      await gate.query('COMMIT');
      const confirmed = await confirmation;
      assert.equal(confirmed.status, 409, JSON.stringify(confirmed));
      assert.equal(calendarConfirmations, before);
      const { rows } = await pool.query('SELECT status FROM app_directory_bookings WHERE id = $1', [f.legacy]);
      assert.equal(rows[0].status, 'pending');
    } finally {
      await gate.query('ROLLBACK');
      gate.release();
      if (confirmation) await Promise.allSettled([confirmation]);
    }
  });

  test('real PostgreSQL preserves a legacy booking when confirmation precedes a waiting link', async () => {
    const f = await fixture({ legacyStatus: 'pending' });
    const gate = await pool.connect();
    let link;
    try {
      await gate.query('BEGIN');
      await gate.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`senior:${f.senior.seniorId}`]);
      let result;
      link = acceptLink(f);
      link.then(value => { result = value; });
      await waitForAdvisoryWaiters(1, () => result);
      const confirmed = await confirmLegacy(f);
      assert.equal(confirmed.status, 200, JSON.stringify(confirmed));
      await gate.query('COMMIT');
      const linked = await link;
      assert.equal(linked.status, 200, JSON.stringify(linked));
      const { assertScheduleAvailable } = require('../schedule-conflicts');
      for (const seniorId of [f.senior.seniorId, f.otherSenior.seniorId]) {
        await assert.rejects(assertScheduleAvailable(pool, {
          professionalId: randomUUID(), seniorId, start: f.start, durationMinutes: 30
        }), error => error.status === 409);
      }
    } finally {
      await gate.query('ROLLBACK');
      gate.release();
      if (link) await Promise.allSettled([link]);
    }
  });

  for (const shared of ['senior', 'professional']) {
    test(`real PostgreSQL prevents overlapping visits for the same ${shared}`, async () => {
      const f = await fixture();
      const secondPro = shared === 'professional' ? f.visitPro : await person('pro');
      const secondSenior = shared === 'senior' ? f.senior : await person('senior');
      const secondOrganization = shared === 'senior' ? randomUUID() : f.organization;
      const secondRecipient = randomUUID();
      const secondVisit = randomUUID();
      if (shared === 'senior') {
        await pool.query(`INSERT INTO planning_organizations (id, name, coordinator_user_id)
          VALUES ($1, 'Test', $2)`, [secondOrganization, secondPro.id]);
        await pool.query(`INSERT INTO planning_org_members (organization_id, user_id, role)
          VALUES ($1, $2, 'professional')`, [secondOrganization, secondPro.id]);
      }
      await pool.query(`INSERT INTO planning_recipients
        (id, organization_id, senior_id, name, consent_at, created_by)
        VALUES ($1, $2, $3, 'Test', CURRENT_TIMESTAMP, $4)`,
      [secondRecipient, secondOrganization, secondSenior.seniorId, secondPro.id]);
      await pool.query(`INSERT INTO planning_visits
        (id, organization_id, recipient_id, assigned_user_id, scheduled_at, duration_minutes,
         visit_type, created_by, acceptance_status)
        VALUES ($1, $2, $3, $4, $5, 60, 'Test', $6, 'pending')`,
      [secondVisit, secondOrganization, secondRecipient, secondPro.id, f.start, f.visitPro.id]);
      const second = () => request(`/api/planning/visits/${secondVisit}/response`,
        secondPro, 'POST', { acceptanceStatus: 'accepted' });
      const key = shared === 'senior' ? `senior:${f.senior.seniorId}` : `professional:${f.visitPro.id}`;
      const results = await raceOn(key, () => acceptVisit(f), second);
      assert.deepEqual(results.map(result => result.status), [200, 409], JSON.stringify(results));
      const { rows } = await pool.query(`SELECT count(*)::int AS count FROM planning_visits
        WHERE id = ANY($1::uuid[]) AND acceptance_status = 'accepted'`, [[f.visit, secondVisit]]);
      assert.equal(rows[0].count, 1);
    });
  }

  for (const removeFirst of [true, false]) {
    test(`real PostgreSQL revalidates links during legacy confirmation (${removeFirst ? 'removal' : 'confirmation'} first)`, async () => {
      const f = await fixture({ linked: true, legacyStatus: 'pending' });
      const remove = () => request(`/api/admin/accounts/${f.aidant.id}/senior-links/${f.senior.seniorId}`,
        admin, 'DELETE', undefined, true);
      const confirmationsBefore = calendarConfirmations;
      const results = await raceOn(`senior:${f.senior.seniorId}`,
        removeFirst ? remove : () => confirmLegacy(f), removeFirst ? () => confirmLegacy(f) : remove);
      assert.deepEqual(results.map(result => result.status), removeFirst ? [200, 409] : [200, 200],
        JSON.stringify(results));
      assert.equal(calendarConfirmations - confirmationsBefore, removeFirst ? 0 : 1);
      const { rows } = await pool.query('SELECT status FROM app_directory_bookings WHERE id = $1', [f.legacy]);
      assert.equal(rows[0].status, removeFirst ? 'pending' : 'confirmed');
    });
  }
}
