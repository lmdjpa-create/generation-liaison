const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const { createAuthService } = require('../auth');
const { createPlanningGoogleSync } = require('../planning-google-sync');

async function fixture(t, kind = 'visit') {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE TABLE app_users (
      id uuid PRIMARY KEY, senior_id uuid, role text, is_active boolean,
      verification_status text, google_calendar_refresh_token text, planning_google_sync_enabled boolean,
      is_legal_guardian boolean NOT NULL DEFAULT false, guardian_verification_status text
    );
    CREATE TABLE app_aidant_senior_links (
      aidant_user_id uuid, senior_profile_id uuid, suspended_at timestamptz
    );
    CREATE TABLE planning_recipients (
      id uuid PRIMARY KEY, organization_id uuid, senior_id uuid,
      consent_at timestamptz, consent_revoked_at timestamptz
    );
    CREATE TABLE planning_org_members (organization_id uuid, user_id uuid, role text);
    CREATE TABLE planning_visits (
      id uuid PRIMARY KEY, organization_id uuid, recipient_id uuid, assigned_user_id uuid,
      scheduled_at timestamptz, duration_minutes smallint, status text, acceptance_status text
    );
    CREATE TABLE planning_service_partners (
      id uuid PRIMARY KEY, organization_id uuid, user_id uuid
    );
    CREATE TABLE planning_service_bookings (
      id uuid PRIMARY KEY, organization_id uuid, recipient_id uuid, partner_id uuid,
      requested_at timestamptz, status text, updated_at timestamptz
    );
    CREATE TABLE app_directory_bookings (
      id uuid PRIMARY KEY, requester_user_id uuid, professional_user_id uuid,
      scheduled_at timestamptz, duration_minutes smallint, status text, hold_expires_at timestamptz,
      senior_profile_id uuid
    );
    CREATE TABLE planning_google_events (
      id uuid PRIMARY KEY, professional_id uuid, senior_id uuid, entity_kind text, entity_id uuid,
      google_event_id text, connection_key char(64), snapshot_start timestamptz,
      snapshot_duration smallint, state text DEFAULT 'new', proposal jsonb, last_error text,
      last_checked_at timestamptz,
      UNIQUE (professional_id, entity_kind, entity_id), UNIQUE (professional_id, google_event_id)
    );
  `);
  const query = (sql, params) => db.query(sql, params);
  const pool = { query, async connect() { return { query, release() {} }; } };
  const ids = {
    pro: randomUUID(), family: randomUUID(), senior: randomUUID(),
    recipient: randomUUID(), organization: randomUUID(), entity: randomUUID(), partner: randomUUID()
  };
  const original = new Date(Date.now() + 5 * 86400000);
  original.setUTCSeconds(0, 0);
  await query(
    `INSERT INTO app_users
      (id, senior_id, role, is_active, verification_status, google_calendar_refresh_token, planning_google_sync_enabled) VALUES
      ($1, $2, 'pro', true, 'approved', 'encrypted-token', true),
      ($3, $4, 'senior', true, 'approved', NULL, false)`,
    [ids.pro, randomUUID(), ids.family, ids.senior]
  );
  await query(
    `INSERT INTO planning_recipients VALUES ($1, $2, $3, CURRENT_TIMESTAMP, NULL)`,
    [ids.recipient, ids.organization, ids.senior]
  );
  await query(`INSERT INTO planning_org_members VALUES ($1, $2, 'professional')`,
    [ids.organization, ids.pro]);
  if (kind === 'visit') {
    await query(
      `INSERT INTO planning_visits VALUES ($1, $2, $3, $4, $5, 60, 'scheduled', 'accepted')`,
      [ids.entity, ids.organization, ids.recipient, ids.pro, original]
    );
  } else {
    await query(`INSERT INTO planning_service_partners VALUES ($1, $2, $3)`,
      [ids.partner, ids.organization, ids.pro]);
    await query(
      `INSERT INTO planning_service_bookings VALUES ($1, $2, $3, $4, $5, 'confirmed', CURRENT_TIMESTAMP)`,
      [ids.entity, ids.organization, ids.recipient, ids.partner, original]
    );
  }
  const events = new Map();
  let version = 0;
  const calendar = {
    async getPlanningEvent(token, id) { return events.get(id) || null; },
    async hasOtherBusyEvents(token, start, end, excludedId) {
      return [...events.values()].some(event => event.id !== excludedId &&
        event.status !== 'cancelled' && event.transparency !== 'transparent' &&
        new Date(event.start.dateTime) < end && new Date(event.end.dateTime) > start);
    },
    async createPlanningEvent(token, { eventId, syncId, start, end }) {
      if (events.has(eventId)) { const error = new Error('conflict'); error.status = 409; throw error; }
      const event = {
        id: eventId, etag: `"${++version}"`, status: 'confirmed',
        start: { dateTime: start.toISOString() }, end: { dateTime: end.toISOString() },
        extendedProperties: { private: { generationLiaisonSyncId: syncId } }
      };
      events.set(eventId, event);
      return event;
    },
    async updatePlanningEvent(token, id, etag, { start, end }) {
      const current = events.get(id);
      if (!current || current.etag !== etag) { const error = new Error('precondition'); error.status = 412; throw error; }
      const event = { ...current, etag: `"${++version}"`, status: 'confirmed',
        start: { dateTime: start.toISOString() }, end: { dateTime: end.toISOString() } };
      events.set(id, event);
      return event;
    },
    async deletePlanningEvent(token, id, etag) {
      if (events.get(id)?.etag !== etag) { const error = new Error('precondition'); error.status = 412; throw error; }
      events.delete(id);
    }
  };
  const notices = [];
  const sync = createPlanningGoogleSync({
    pool, calendar, getAccessToken: async () => 'token',
    notify: async (client, userId, type, title) => notices.push({ userId, title })
  });
  const professional = { id: ids.pro, role: 'pro', seniorId: randomUUID() };
  const family = { id: ids.family, role: 'senior', seniorId: ids.senior };
  await sync.run();
  const getMapping = async () => (await query(`SELECT * FROM planning_google_events`)).rows[0];
  const moveRemote = async (minutes, duration = kind === 'visit' ? 60 : 30) => {
    const mapping = await getMapping();
    const current = events.get(mapping.google_event_id);
    const start = new Date(original.getTime() + minutes * 60000);
    return calendar.updatePlanningEvent('token', mapping.google_event_id, current.etag, {
      start, end: new Date(start.getTime() + duration * 60000)
    });
  };
  return { db, query, sync, ids, original, professional, family, events, notices, getMapping, moveRemote };
}

test('the synchronization schema migration can run repeatedly', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  const pool = { query: sql => db.exec(sql) };
  await createAuthService(pool).ensureSchema();
  await createAuthService(pool).ensureSchema();
});

test('a Google move changes the shared visit only after both participants approve', async t => {
  const f = await fixture(t);
  const mapping = await f.getMapping();
  await f.moveRemote(120);
  await f.sync.processOne(mapping.id);
  assert.equal((await f.sync.list(f.professional)).length, 1);
  assert.equal((await f.sync.list(f.family)).length, 1);
  assert.equal(f.notices.length, 2);
  await assert.rejects(f.sync.respond({ id: randomUUID(), role: 'pro' }, mapping.id, 'approve'),
    error => error.status === 404);
  assert.equal((await f.sync.respond(f.professional, mapping.id, 'approve')).status, 'waiting');
  let visit = (await f.query('SELECT * FROM planning_visits')).rows[0];
  assert.equal(visit.scheduled_at.toISOString(), f.original.toISOString());
  assert.equal((await f.sync.respond(f.family, mapping.id, 'approve')).status, 'applied');
  visit = (await f.query('SELECT * FROM planning_visits')).rows[0];
  assert.equal(visit.scheduled_at.toISOString(), new Date(f.original.getTime() + 120 * 60000).toISOString());
  assert.equal((await f.getMapping()).proposal, null);
});

test('Google proposals use current selected links and exclude suspended or unapproved guardians', async t => {
  const f = await fixture(t);
  const aidant = randomUUID();
  const suspended = randomUUID();
  const guardian = randomUUID();
  const otherSenior = randomUUID();
  await f.query(
    `INSERT INTO app_users (id, role, is_active, is_legal_guardian, guardian_verification_status) VALUES
      ($1, 'aidant', true, false, 'not_required'),
      ($2, 'aidant', true, false, 'not_required'),
      ($3, 'aidant', true, true, 'pending')`,
    [aidant, suspended, guardian]
  );
  await f.query(
    `INSERT INTO app_aidant_senior_links VALUES
      ($1, $4, NULL), ($1, $5, NULL),
      ($2, $4, CURRENT_TIMESTAMP), ($3, $4, NULL)`,
    [aidant, suspended, guardian, f.ids.senior, otherSenior]
  );
  const mapping = await f.getMapping();
  await f.moveRemote(120);
  await f.sync.processOne(mapping.id);
  const active = { id: aidant, role: 'aidant', seniorId: f.ids.senior };
  assert.equal((await f.sync.list(active)).length, 1);
  assert.equal((await f.sync.list({ ...active, seniorId: otherSenior })).length, 0);
  assert.equal((await f.sync.list({ ...active, id: suspended })).length, 0);
  assert.equal((await f.sync.list({ ...active, id: guardian })).length, 0);
  assert.deepEqual(new Set(f.notices.map(notice => notice.userId)), new Set([f.ids.pro, f.ids.family, aidant]));
  await f.query(`UPDATE app_aidant_senior_links SET suspended_at = CURRENT_TIMESTAMP
    WHERE aidant_user_id = $1 AND senior_profile_id = $2`, [aidant, f.ids.senior]);
  assert.equal((await f.sync.list(active)).length, 0);
  await assert.rejects(f.sync.respond(active, mapping.id, 'approve'), error => error.status === 404);
});

test('revoking an aidant link invalidates their earlier Google approval before professional approval', async t => {
  const f = await fixture(t);
  const aidant = randomUUID();
  await f.query(`INSERT INTO app_users (id, role, is_active, is_legal_guardian, guardian_verification_status)
    VALUES ($1, 'aidant', true, false, 'not_required')`, [aidant]);
  await f.query('INSERT INTO app_aidant_senior_links VALUES ($1, $2, NULL)', [aidant, f.ids.senior]);
  const caregiver = { id: aidant, role: 'aidant', seniorId: f.ids.senior };
  const mapping = await f.getMapping();
  await f.moveRemote(120);
  await f.sync.processOne(mapping.id);
  assert.equal((await f.sync.respond(caregiver, mapping.id, 'approve')).status, 'waiting');
  assert.equal((await f.sync.list(f.professional))[0].proposal.familyApprovedBy, undefined);
  await f.query(`UPDATE app_aidant_senior_links SET suspended_at = CURRENT_TIMESTAMP
    WHERE aidant_user_id = $1 AND senior_profile_id = $2`, [aidant, f.ids.senior]);
  assert.equal((await f.sync.respond(f.professional, mapping.id, 'approve')).status, 'waiting');
  assert.equal((await f.getMapping()).proposal.familyApproved, false);
  assert.equal((await f.query('SELECT scheduled_at FROM planning_visits')).rows[0].scheduled_at.toISOString(),
    f.original.toISOString());
  assert.equal((await f.sync.respond(f.family, mapping.id, 'approve')).status, 'applied');
});

test('a different busy Google event blocks the second approval without changing either event', async t => {
  const f = await fixture(t);
  const mapping = await f.getMapping();
  await f.moveRemote(120);
  await f.sync.processOne(mapping.id);
  const moved = new Date(f.original.getTime() + 120 * 60000);
  const other = { id: 'existing', status: 'confirmed', etag: '"other"',
    start: { dateTime: moved.toISOString() }, end: { dateTime: new Date(moved.getTime() + 3600000).toISOString() } };
  f.events.set(other.id, other);
  const movedBefore = structuredClone(f.events.get(mapping.google_event_id));
  await f.sync.respond(f.professional, mapping.id, 'approve');
  await assert.rejects(f.sync.respond(f.family, mapping.id, 'approve'), error => error.status === 409);
  assert.deepEqual(f.events.get('existing'), other);
  assert.deepEqual(f.events.get(mapping.google_event_id), movedBefore);
  assert.equal((await f.query('SELECT scheduled_at FROM planning_visits')).rows[0].scheduled_at.toISOString(), f.original.toISOString());
  f.events.delete('existing');
  assert.equal((await f.sync.respond(f.family, mapping.id, 'approve')).status, 'applied');
});

test('an overlapping confirmed appointment prevents the second approval', async t => {
  const f = await fixture(t);
  const mapping = await f.getMapping();
  await f.moveRemote(120);
  await f.sync.processOne(mapping.id);
  await f.query(
    `INSERT INTO planning_visits VALUES ($1, $2, $3, $4, $5, 60, 'scheduled', 'accepted')`,
    [randomUUID(), f.ids.organization, f.ids.recipient, f.ids.pro, new Date(f.original.getTime() + 120 * 60000)]
  );
  await f.sync.respond(f.professional, mapping.id, 'approve');
  await assert.rejects(f.sync.respond(f.family, mapping.id, 'approve'), error => error.status === 409);
  const visit = (await f.query('SELECT * FROM planning_visits WHERE id = $1', [f.ids.entity])).rows[0];
  assert.equal(visit.scheduled_at.toISOString(), f.original.toISOString());
  assert.equal((await f.getMapping()).proposal.familyApproved, false);
});

test('new Google edits invalidate earlier approval', async t => {
  const f = await fixture(t);
  const mapping = await f.getMapping();
  await f.moveRemote(120);
  await f.sync.processOne(mapping.id);
  await f.sync.respond(f.professional, mapping.id, 'approve');
  await f.moveRemote(180);
  await assert.rejects(f.sync.respond(f.family, mapping.id, 'approve'), error => error.status === 409);
  await f.sync.processOne(mapping.id);
  const proposal = (await f.getMapping()).proposal;
  assert.equal(proposal.professionalApproved, false);
  assert.equal(proposal.familyApproved, false);
  assert.equal(proposal.start, new Date(f.original.getTime() + 180 * 60000).toISOString());
});

test('rejecting a Google deletion restores a private event without changing the service', async t => {
  const f = await fixture(t, 'service');
  const mapping = await f.getMapping();
  f.events.delete(mapping.google_event_id);
  await f.sync.processOne(mapping.id);
  assert.equal((await f.getMapping()).proposal.action, 'cancel');
  assert.equal((await f.sync.respond(f.family, mapping.id, 'reject')).status, 'restoring');
  await f.sync.processOne(mapping.id);
  await f.sync.processOne(mapping.id);
  const updated = await f.getMapping();
  assert.equal(updated.state, 'active');
  assert.notEqual(updated.google_event_id, mapping.google_event_id);
  assert.equal(f.events.get(updated.google_event_id).start.dateTime, f.original.toISOString());
  assert.equal((await f.query('SELECT status FROM planning_service_bookings')).rows[0].status, 'confirmed');
});

test('a Google cancellation requires both approvals', async t => {
  const f = await fixture(t, 'service');
  const mapping = await f.getMapping();
  f.events.delete(mapping.google_event_id);
  await f.sync.processOne(mapping.id);
  await f.sync.respond(f.family, mapping.id, 'approve');
  assert.equal((await f.query('SELECT status FROM planning_service_bookings')).rows[0].status, 'confirmed');
  await f.sync.respond(f.professional, mapping.id, 'approve');
  assert.equal((await f.query('SELECT status FROM planning_service_bookings')).rows[0].status, 'cancelled');
});

test('a visit is cancelled only after both participants approve a Google deletion', async t => {
  const f = await fixture(t);
  const mapping = await f.getMapping();
  f.events.delete(mapping.google_event_id);
  await f.sync.processOne(mapping.id);
  await f.sync.respond(f.professional, mapping.id, 'approve');
  assert.equal((await f.query('SELECT acceptance_status FROM planning_visits')).rows[0].acceptance_status, 'accepted');
  await f.sync.respond(f.family, mapping.id, 'approve');
  assert.equal((await f.query('SELECT acceptance_status FROM planning_visits')).rows[0].acceptance_status, 'cancelled');
});

test('withdrawn consent prevents approval of an old Google request', async t => {
  const f = await fixture(t);
  const mapping = await f.getMapping();
  await f.moveRemote(120);
  await f.sync.processOne(mapping.id);
  await f.query('UPDATE planning_recipients SET consent_revoked_at = CURRENT_TIMESTAMP');
  assert.equal((await f.sync.list(f.family)).length, 0);
  await assert.rejects(f.sync.respond(f.family, mapping.id, 'approve'), error => error.status === 409);
});

test('a change made in the application updates an unchanged Google event', async t => {
  const f = await fixture(t);
  const mapping = await f.getMapping();
  const start = new Date(f.original.getTime() + 180 * 60000);
  await f.query('UPDATE planning_visits SET scheduled_at = $1 WHERE id = $2', [start, f.ids.entity]);
  await f.sync.processOne(mapping.id);
  assert.equal(f.events.get(mapping.google_event_id).start.dateTime, start.toISOString());
  assert.equal((await f.getMapping()).proposal, null);
});

test('simultaneous application and Google edits are reported without overwriting either', async t => {
  const f = await fixture(t);
  const mapping = await f.getMapping();
  await f.moveRemote(180);
  const appTime = new Date(f.original.getTime() + 120 * 60000);
  await f.query('UPDATE planning_visits SET scheduled_at = $1 WHERE id = $2', [appTime, f.ids.entity]);
  await f.sync.processOne(mapping.id);
  assert.equal((await f.query('SELECT scheduled_at FROM planning_visits')).rows[0].scheduled_at.toISOString(), appTime.toISOString());
  assert.equal(f.events.get(mapping.google_event_id).start.dateTime, new Date(f.original.getTime() + 180 * 60000).toISOString());
  assert.match((await f.getMapping()).last_error, /changé dans les deux agendas/);
});

test('rejecting a Google move restores the application time', async t => {
  const f = await fixture(t);
  const mapping = await f.getMapping();
  await f.moveRemote(120);
  await f.sync.processOne(mapping.id);
  await f.sync.respond(f.professional, mapping.id, 'reject');
  await f.sync.processOne(mapping.id);
  assert.equal(f.events.get(mapping.google_event_id).start.dateTime, f.original.toISOString());
  assert.equal((await f.getMapping()).proposal, null);
});

test('paused synchronization does not apply or import changes', async t => {
  const f = await fixture(t);
  const mapping = await f.getMapping();
  await f.moveRemote(120);
  await f.sync.processOne(mapping.id);
  await f.query('UPDATE app_users SET planning_google_sync_enabled = false WHERE id = $1', [f.ids.pro]);
  assert.equal((await f.sync.list(f.family))[0].paused, true);
  await assert.rejects(f.sync.respond(f.family, mapping.id, 'approve'), error => error.status === 409);
  await f.moveRemote(180);
  await f.sync.processOne(mapping.id);
  assert.equal((await f.getMapping()).proposal.start, new Date(f.original.getTime() + 120 * 60000).toISOString());
});

test('a changed Google connection must be explicitly confirmed before synchronizing', async t => {
  const f = await fixture(t);
  const mapping = await f.getMapping();
  await f.query(`UPDATE app_users SET google_calendar_refresh_token = 'new-token' WHERE id = $1`, [f.ids.pro]);
  await f.sync.processOne(mapping.id);
  assert.equal((await f.sync.list(f.professional))[0].needsReconnect, true);
  await assert.rejects(f.sync.confirmReconnect(f.family), error => error.status === 403);
  await f.sync.setEnabled(f.professional, false);
  assert.equal((await f.sync.getSettings(f.professional)).needsReconnect, true);
  await assert.rejects(f.sync.setEnabled(f.professional, true), error => error.status === 409);
  await f.sync.confirmReconnect(f.professional);
  await f.sync.setEnabled(f.professional, true);
  await f.sync.processOne(mapping.id);
  assert.equal((await f.sync.list(f.professional)).length, 0);
});

test('switching Google calendars abandons pending proposals without changing the appointment', async t => {
  const f = await fixture(t);
  const mapping = await f.getMapping();
  await f.moveRemote(120);
  await f.sync.processOne(mapping.id);
  await f.sync.respond(f.family, mapping.id, 'approve');
  await f.sync.setEnabled(f.professional, false);
  await f.query(`UPDATE app_users SET google_calendar_refresh_token = 'new-token' WHERE id = $1`, [f.ids.pro]);
  await f.sync.changeCalendar(f.professional);
  assert.equal((await f.query('SELECT COUNT(*)::int AS count FROM planning_google_events')).rows[0].count, 0);
  assert.equal((await f.query('SELECT scheduled_at FROM planning_visits')).rows[0].scheduled_at.toISOString(), f.original.toISOString());
  assert.equal(f.notices.filter(notice => notice.title === 'Demande Google abandonnée').length, 2);
  await f.sync.setEnabled(f.professional, true);
  await f.sync.run();
  assert.notEqual((await f.getMapping()).google_event_id, mapping.google_event_id);
});

test('a removed appointment deletes its unchanged Google copy and synchronization record', async t => {
  const f = await fixture(t);
  const mapping = await f.getMapping();
  await f.query('DELETE FROM planning_visits WHERE id = $1', [f.ids.entity]);
  await f.sync.processOne(mapping.id);
  assert.equal(f.events.has(mapping.google_event_id), false);
  assert.equal((await f.query('SELECT COUNT(*)::int AS count FROM planning_google_events')).rows[0].count, 0);
});

test('removing the professional from the team stops synchronization and removes its unchanged copy', async t => {
  const f = await fixture(t);
  const mapping = await f.getMapping();
  await f.query('DELETE FROM planning_org_members WHERE user_id = $1', [f.ids.pro]);
  await f.sync.processOne(mapping.id);
  assert.equal(f.events.has(mapping.google_event_id), false);
  assert.equal((await f.query('SELECT COUNT(*)::int AS count FROM planning_google_events')).rows[0].count, 0);
});

test('an elapsed appointment is no longer monitored and its Google event remains as history', async t => {
  const f = await fixture(t);
  const mapping = await f.getMapping();
  await f.query(`UPDATE planning_visits SET status = 'completed' WHERE id = $1`, [f.ids.entity]);
  await f.sync.processOne(mapping.id);
  assert.equal(f.events.has(mapping.google_event_id), true);
  assert.equal((await f.query('SELECT COUNT(*)::int AS count FROM planning_google_events')).rows[0].count, 0);
});
