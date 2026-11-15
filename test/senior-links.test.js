const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const { PGlite } = require('@electric-sql/pglite');
const pg = require('pg');
const delivery = require('../notification-delivery');
const { TERMS_VERSION, createAuthService } = require('../auth');
const { assertScheduleAvailable, lockScheduleParticipants } = require('../schedule-conflicts');
const { randomUUID } = require('node:crypto');
const { createDueTaskReminder } = require('../task-reminders');

const adminCode = 'test-administrator-code-at-least-32-characters';
let db;
let server;
let baseUrl;
let sentCode;
let failEmail = false;
let emailConfigured = true;
let failInvitation = false;
const sentInvitations = [];

before(async () => {
  db = new PGlite();
  await db.waitReady;
  pg.Pool = class {
    async query(sql, values) {
      if (sql.includes('CREATE TABLE IF NOT EXISTS senior_profiles')) {
        await db.exec(sql);
        return { rows: [] };
      }
      const result = await db.query(sql, values);
      return { ...result, rowCount: result.affectedRows };
    }
    async connect() { return { query: this.query.bind(this), release() {} }; }
  };
  process.env.DATABASE_URL = 'postgresql://isolated-test';
  process.env.ADMIN_EMAILS = 'admin@example.test,photo-admin@example.test';
  process.env.ADMIN_ACCESS_CODE = adminCode;
  delivery.isConfigured = () => ({ email: emailConfigured });
  delivery.sendSeniorUnlinkCode = async (email, code) => {
    if (failEmail) throw new Error('test delivery failure');
    sentCode = { email, code };
  };
  delivery.sendSeniorInvitation = async (email, url) => {
    if (failInvitation) throw new Error('test invitation delivery failure');
    sentInvitations.push({ email, url });
  };
  const app = require('../server');
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (db) await db.close();
});

async function request(path, { user, body, method = body === undefined ? 'GET' : 'POST', seniorId, admin } = {}) {
  const headers = {};
  if (user) headers.Authorization = `Bearer ${user.token}`;
  if (seniorId) headers['X-Senior-Profile-Id'] = seniorId;
  if (admin) headers['X-Admin-Access-Code'] = adminCode;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${baseUrl}${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: response.status, data: await response.json() };
}

async function register(email, role, isLegalGuardian = false) {
  const result = await request('/api/auth/register', {
    body: {
      name: email, email, password: 'a-test-password-123', role, isLegalGuardian,
      ...(role === 'pro' ? { homeLatitude: 48.8566, homeLongitude: 2.3522, serviceRadiusKm: 30 } : {}),
      acceptedTerms: true, acceptedTermsVersion: TERMS_VERSION
    }
  });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  return result.data;
}

test('civility and private profile photos are saved, isolated and removed on account closure', async () => {
  const senior = await register('profile-senior@example.test', 'senior');
  const other = await register('profile-other@example.test', 'senior');
  const path = '/api/account/profile-photo';
  const headers = { Authorization: `Bearer ${senior.token}` };
  assert.equal(senior.user.civility, 'unspecified');
  assert.equal(senior.user.hasAccountPhoto, false);
  assert.equal((await request('/api/account/profile', { user: senior, method: 'PUT', body: { civility: 'invalid' } })).status, 400);
  assert.equal((await request('/api/account/profile', { user: senior, method: 'PUT', body: { civility: 'mrs' } })).status, 200);
  assert.equal((await request('/api/auth/me', { user: senior })).data.user.civility, 'mrs');
  const login = await request('/api/auth/login', { body: { email: 'profile-senior@example.test', password: 'a-test-password-123' } });
  assert.equal(login.data.user.civility, 'mrs');
  assert.equal((await fetch(`${baseUrl}${path}`)).status, 401);
  assert.equal((await fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${other.token}` } })).status, 404);
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lX4AAAAASUVORK5CYII=', 'base64');
  const upload = (body, contentType) => fetch(`${baseUrl}${path}`, {
    method: 'PUT', headers: { ...headers, 'Content-Type': contentType }, body
  });
  assert.equal((await upload(Buffer.from('not a photo'), 'image/png')).status, 400);
  assert.equal((await upload(image, 'image/svg+xml')).status, 400);
  assert.equal((await upload(Buffer.alloc(2 * 1024 * 1024 + 1), 'image/png')).status, 413);
  assert.equal((await upload(image, 'image/png')).status, 200);
  assert.equal((await request('/api/auth/me', { user: senior })).data.user.hasAccountPhoto, true);
  const photo = await fetch(`${baseUrl}${path}`, { headers });
  assert.equal(photo.headers.get('cache-control'), 'private, no-store');
  assert.equal(photo.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(Buffer.from(await photo.arrayBuffer()), image);
  assert.equal((await fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${other.token}` } })).status, 404);
  assert.equal((await fetch(`${baseUrl}${path}`, { method: 'DELETE', headers })).status, 200);
  assert.equal((await request('/api/auth/me', { user: senior })).data.user.hasAccountPhoto, false);
  assert.equal((await upload(image, 'image/png')).status, 200);
  assert.equal((await request('/api/account/closure-request', {
    user: senior, body: { password: 'a-test-password-123' }
  })).status, 200);
  const stored = await db.query('SELECT account_photo, account_photo_content_type, civility FROM app_users WHERE id = $1', [senior.user.id]);
  assert.deepEqual(stored.rows[0], { account_photo: null, account_photo_content_type: null, civility: 'unspecified' });
});

test('contact photos require sharing and a saved contact, and respect revocation', async () => {
  const owner = await register('photo-owner@example.test', 'aidant');
  const viewer = await register('photo-viewer@example.test', 'senior');
  const stranger = await register('photo-stranger@example.test', 'senior');
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lX4AAAAASUVORK5CYII=', 'base64');
  const path = `/api/contacts/${owner.user.id}/photo`;
  const get = user => fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${user.token}` } });
  assert.equal(owner.user.shareAccountPhoto, true);
  assert.equal((await request('/api/auth/me', { user: owner })).data.user.shareAccountPhoto, true);
  assert.equal((await fetch(`${baseUrl}/api/account/profile-photo`, {
    method: 'PUT', headers: { Authorization: `Bearer ${owner.token}`, 'Content-Type': 'image/png' }, body: image
  })).status, 200);
  assert.equal((await request('/api/contacts', { user: viewer, body: { contactUserId: owner.user.id } })).status, 201);
  assert.equal((await request('/api/contacts', { user: viewer })).data.contacts[0].hasSharedPhoto, true);
  const response = await get(viewer);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), image);
  assert.equal((await get(stranger)).status, 404);
  assert.equal((await request('/api/account/profile', {
    user: owner, method: 'PUT', body: { civility: 'mr', shareAccountPhoto: false }
  })).status, 200);
  assert.equal((await get(viewer)).status, 404);
  await createAuthService(new pg.Pool()).ensureSchema();
  assert.equal((await request('/api/auth/me', { user: owner })).data.user.shareAccountPhoto, false);
  const login = await request('/api/auth/login', { body: { email: 'photo-owner@example.test', password: 'a-test-password-123' } });
  assert.equal(login.data.user.shareAccountPhoto, false);
});

test('a professional photo is required for approval and is visible only to saved contacts', async () => {
  const admin = await register('photo-admin@example.test', 'senior');
  const professional = await register('photo-pro@example.test', 'pro');
  const senior = await register('photo-pro-viewer@example.test', 'senior');
  const stranger = await register('photo-pro-stranger@example.test', 'senior');
  const decision = () => request(`/api/admin/accounts/${professional.user.id}/verification`, {
    user: admin, admin: true, method: 'PATCH', body: { verificationStatus: 'approved' }
  });
  assert.equal((await decision()).status, 409);
  for (const type of ['identity', 'kbis']) {
    await db.query(
      `INSERT INTO app_professional_verification_documents (id, user_id, document_type, content_type, file_data)
       VALUES ($1, $2, $3, 'application/pdf', $4)`,
      [randomUUID(), professional.user.id, type, Buffer.from('%PDF-test')]
    );
  }
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lX4AAAAASUVORK5CYII=', 'base64');
  const headers = { Authorization: `Bearer ${professional.token}` };
  assert.equal((await fetch(`${baseUrl}/api/account/profile-photo`, {
    method: 'PUT', headers: { ...headers, 'Content-Type': 'image/png' }, body: image
  })).status, 200);
  assert.equal((await decision()).status, 200);
  assert.equal((await fetch(`${baseUrl}/api/account/profile-photo`, { method: 'DELETE', headers })).status, 403);
  assert.equal((await request('/api/contacts', { user: senior, body: { contactUserId: professional.user.id } })).status, 201);
  const photoPath = `${baseUrl}/api/contacts/${professional.user.id}/photo`;
  assert.equal((await fetch(photoPath, { headers: { Authorization: `Bearer ${senior.token}` } })).status, 200);
  assert.equal((await fetch(photoPath, { headers: { Authorization: `Bearer ${stranger.token}` } })).status, 404);
});

test('task reminders are opt-in, due in Paris, deduplicated and limited to active associations', async () => {
  const senior = await register('reminder-senior@example.test', 'senior');
  const aidant = await register('reminder-aidant@example.test', 'aidant');
  const other = await register('reminder-other@example.test', 'aidant');
  await db.query(`INSERT INTO app_aidant_senior_links (aidant_user_id, senior_profile_id, linked_by)
    VALUES ($1, $2, $1), ($3, $2, $3)`, [aidant.user.id, senior.user.seniorId, other.user.id]);
  const path = '/api/account/task-reminders';
  assert.equal((await request(path, { user: aidant })).data.enabled, false);
  assert.equal((await request(path, { user: senior })).status, 403);
  assert.equal((await request(path, { user: aidant, method: 'PUT', body: { enabled: 'yes' } })).status, 400);
  assert.equal((await request(path, { user: aidant, method: 'PUT', body: { enabled: true } })).status, 200);
  const task = await request('/api/shared-tasks', {
    user: senior, body: { title: 'Courses', dueDate: '2028-02-29' }
  });
  const pool = new pg.Pool();
  const sent = [];
  const notify = async (client, userId, type, title, message, entityType, entityId) =>
    sent.push({ userId, type, title, message, entityType, entityId });
  assert.equal(await createDueTaskReminder(pool, notify, new Date('2028-02-29T07:59:00Z')), false);
  await assert.rejects(createDueTaskReminder(pool, async () => { throw new Error('insertion failed'); },
    new Date('2028-02-29T08:00:00Z')), /insertion failed/);
  assert.equal(await createDueTaskReminder(pool, notify, new Date('2028-02-29T08:00:00Z')), true);
  assert.equal(await createDueTaskReminder(pool, notify, new Date('2028-02-29T08:01:00Z')), false);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].userId, aidant.user.id);
  assert.equal(sent[0].entityId, task.data.id);
  assert.doesNotMatch(sent[0].message, /Courses/);
  await request(path, { user: other, method: 'PUT', body: { enabled: true } });
  await db.query(`UPDATE app_aidant_senior_links SET suspended_at = CURRENT_TIMESTAMP
    WHERE aidant_user_id = $1 AND senior_profile_id = $2`, [other.user.id, senior.user.seniorId]);
  assert.equal(await createDueTaskReminder(pool, notify, new Date('2028-02-29T10:00:00Z')), false);
  await db.query(`UPDATE app_aidant_senior_links SET suspended_at = NULL
    WHERE aidant_user_id = $1 AND senior_profile_id = $2`, [other.user.id, senior.user.seniorId]);
  await request(`/api/shared-tasks/${task.data.id}/claim`, {
    user: aidant, seniorId: senior.user.seniorId, method: 'POST'
  });
  assert.equal(await createDueTaskReminder(pool, notify, new Date('2028-02-29T10:00:00Z')), false);
  await request(`/api/shared-tasks/${task.data.id}`, { user: senior, method: 'PATCH', body: { completed: true } });
  assert.equal(await createDueTaskReminder(pool, notify, new Date('2028-02-29T10:00:00Z')), false);
});

test('unread message counts exclude inaccessible contacts and other accounts', async () => {
  const senior = await register('summary-senior@example.test', 'senior');
  const aidant = await register('summary-aidant@example.test', 'aidant');
  const other = await register('summary-other@example.test', 'aidant');
  await db.query(`INSERT INTO app_aidant_senior_links (aidant_user_id, senior_profile_id, linked_by)
    VALUES ($1, $2, $1)`, [aidant.user.id, senior.user.seniorId]);
  await db.query(`INSERT INTO app_private_messages (id, sender_id, recipient_id, body)
    VALUES ($1, $2, $3, 'test'), ($4, $5, $3, 'inaccessible')`,
  [randomUUID(), senior.user.id, aidant.user.id, randomUUID(), other.user.id]);
  const path = '/api/messages/unread-count';
  assert.equal((await request(path)).status, 401);
  assert.equal((await request(path, { user: aidant })).data.count, 1);
  assert.equal((await request(path, { user: senior })).data.count, 0);
  await db.query(`UPDATE app_aidant_senior_links SET suspended_at = CURRENT_TIMESTAMP
    WHERE aidant_user_id = $1 AND senior_profile_id = $2`, [aidant.user.id, senior.user.seniorId]);
  assert.equal((await request(path, { user: aidant })).data.count, 0);
});

test('shared tasks are isolated by senior and require an active association', async () => {
  const senior = await register('task-senior@example.test', 'senior');
  const other = await register('task-other@example.test', 'senior');
  const aidant = await register('task-aidant@example.test', 'aidant');
  const stranger = await register('task-stranger@example.test', 'aidant');
  const guardian = await register('task-guardian@example.test', 'aidant', true);
  const options = { user: aidant, seniorId: senior.user.seniorId };
  assert.equal((await request('/api/shared-tasks')).status, 401);
  assert.equal((await request('/api/shared-tasks', { user: aidant })).status, 409);
  assert.equal((await request('/api/shared-tasks', options)).status, 403);
  await db.query(`INSERT INTO app_aidant_senior_links (aidant_user_id, senior_profile_id, linked_by)
    VALUES ($1, $2, $1), ($1, $3, $1), ($4, $2, $4)`,
  [aidant.user.id, senior.user.seniorId, other.user.seniorId, guardian.user.id]);
  assert.equal((await request('/api/shared-tasks', { user: guardian, seniorId: senior.user.seniorId })).status, 403);
  assert.equal((await request('/api/shared-tasks', { user: senior, body: { title: '  ' } })).status, 400);
  assert.equal((await request('/api/shared-tasks', { user: senior, body: { title: 'x'.repeat(121) } })).status, 400);
  const created = await request('/api/shared-tasks', { user: senior, body: { title: '  Acheter du pain  ' } });
  assert.equal(created.status, 201);
  const id = created.data.id;
  assert.deepEqual((await request('/api/shared-tasks', options)).data.tasks,
    [{ id, title: 'Acheter du pain', completed: false, dueDate: null,
      assigned: false, assignedToMe: false, assigneeName: null }]);
  const aidantCreated = await request('/api/shared-tasks', { ...options, body: { title: 'Appeler le voisin' } });
  assert.equal(aidantCreated.status, 201);
  assert.equal((await request('/api/shared-tasks', { user: senior })).data.tasks.length, 2);
  assert.equal((await request(`/api/shared-tasks/${aidantCreated.data.id}`, { ...options, method: 'DELETE' })).status, 200);
  assert.deepEqual((await request('/api/shared-tasks', { user: aidant, seniorId: other.user.seniorId })).data.tasks, []);
  assert.equal((await request(`/api/shared-tasks/${id}`, {
    user: aidant, seniorId: other.user.seniorId, method: 'PATCH', body: { completed: true }
  })).status, 404);
  assert.equal((await request(`/api/shared-tasks/${id}`, {
    ...options, method: 'PATCH', body: { completed: 'true' }
  })).status, 400);
  assert.equal((await request(`/api/shared-tasks/${id}`, {
    ...options, method: 'PATCH', body: { completed: true }
  })).status, 200);
  assert.equal((await request('/api/shared-tasks', { user: senior })).data.tasks[0].completed, true);
  assert.equal((await request('/api/shared-tasks', { user: stranger, seniorId: senior.user.seniorId })).status, 403);
  await db.query("UPDATE app_sessions SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE user_id = $1", [stranger.user.id]);
  assert.equal((await request('/api/shared-tasks', { user: stranger })).status, 401);
  await db.query('UPDATE app_users SET is_active = FALSE WHERE id = $1', [senior.user.id]);
  assert.equal((await request('/api/shared-tasks', options)).status, 403);
  await db.query('UPDATE app_users SET is_active = TRUE WHERE id = $1', [senior.user.id]);
  await db.query(`UPDATE app_aidant_senior_links SET suspended_at = CURRENT_TIMESTAMP
    WHERE aidant_user_id = $1 AND senior_profile_id = $2`, [aidant.user.id, senior.user.seniorId]);
  assert.equal((await request('/api/shared-tasks', options)).status, 403);
  assert.equal((await request(`/api/shared-tasks/${id}`, { ...options, method: 'DELETE' })).status, 403);
  assert.equal((await request(`/api/shared-tasks/${id}`, { user: senior, method: 'DELETE' })).status, 200);
  assert.equal((await request('/api/shared-tasks', { user: senior })).data.tasks.length, 0);
});

test('shared tasks can be claimed voluntarily without overwriting another person', async () => {
  const senior = await register('task-claim-senior@example.test', 'senior');
  const other = await register('task-claim-other@example.test', 'senior');
  const aidant = await register('task-claim-aidant@example.test', 'aidant');
  const second = await register('task-claim-second@example.test', 'aidant');
  for (const user of [aidant, second]) {
    await db.query(`INSERT INTO app_aidant_senior_links (aidant_user_id, senior_profile_id, linked_by)
      VALUES ($1, $2, $1), ($1, $3, $1)`, [user.user.id, senior.user.seniorId, other.user.seniorId]);
  }
  const firstOpts = { user: aidant, seniorId: senior.user.seniorId };
  const secondOpts = { user: second, seniorId: senior.user.seniorId };
  const id = (await request('/api/shared-tasks', { user: senior, body: { title: 'Faire les courses' } })).data.id;
  const claimPath = `/api/shared-tasks/${id}/claim`;
  assert.equal((await request(claimPath, { ...firstOpts, method: 'POST' })).status, 200);
  let task = (await request('/api/shared-tasks', firstOpts)).data.tasks[0];
  assert.equal(task.assigned, true);
  assert.equal(task.assignedToMe, true);
  assert.equal(task.assigneeName, aidant.user.name);
  task = (await request('/api/shared-tasks', secondOpts)).data.tasks[0];
  assert.equal(task.assignedToMe, false);
  assert.equal((await request(claimPath, { ...secondOpts, method: 'POST' })).status, 409);
  assert.equal((await request(claimPath, { ...secondOpts, method: 'DELETE' })).status, 409);
  assert.equal((await request(claimPath, { user: second, seniorId: other.user.seniorId, method: 'DELETE' })).status, 409);
  assert.equal((await request(claimPath, { ...firstOpts, method: 'DELETE' })).status, 200);
  assert.equal((await request(claimPath, { ...secondOpts, method: 'POST' })).status, 200);
  await db.query(`UPDATE app_aidant_senior_links SET suspended_at = CURRENT_TIMESTAMP
    WHERE aidant_user_id = $1 AND senior_profile_id = $2`, [second.user.id, senior.user.seniorId]);
  task = (await request('/api/shared-tasks', { user: senior })).data.tasks[0];
  assert.equal(task.assigned, true);
  assert.equal(task.assigneeName, null);
  assert.equal((await request(claimPath, { ...secondOpts, method: 'DELETE' })).status, 403);
  assert.equal((await request(claimPath, { user: senior, method: 'DELETE' })).status, 200);
  assert.equal((await request(claimPath, { user: senior, method: 'POST' })).status, 200);
  assert.equal((await request(`/api/shared-tasks/${id}`, {
    user: senior, method: 'PATCH', body: { completed: true }
  })).status, 200);
  assert.equal((await request(claimPath, { user: senior, method: 'DELETE' })).status, 200);
  assert.equal((await request(claimPath, { ...firstOpts, method: 'POST' })).status, 409);
});

test('shared task dates are optional, validated, editable and ordered by urgency', async () => {
  const senior = await register('task-date-senior@example.test', 'senior');
  const other = await register('task-date-other@example.test', 'senior');
  const aidant = await register('task-date-aidant@example.test', 'aidant');
  await db.query(`INSERT INTO app_aidant_senior_links (aidant_user_id, senior_profile_id, linked_by)
    VALUES ($1, $2, $1), ($1, $3, $1)`, [aidant.user.id, senior.user.seniorId, other.user.seniorId]);
  const opts = { user: aidant, seniorId: senior.user.seniorId };
  for (const dueDate of ['2025-02-29', '0000-01-01', '', 10]) {
    assert.equal((await request('/api/shared-tasks', { ...opts, body: { title: 'Tâche', dueDate } })).status, 400);
  }
  const makeTask = async (title, dueDate) =>
    (await request('/api/shared-tasks', { ...opts, body: { title, dueDate } })).data.id;
  const undated = await makeTask('Sans date', null);
  const later = await makeTask('Plus tard', '2028-03-01');
  const earlier = await makeTask('D’abord', '2028-02-29');
  let tasks = (await request('/api/shared-tasks', opts)).data.tasks;
  assert.deepEqual(tasks.map(task => [task.id, task.dueDate]),
    [[earlier, '2028-02-29'], [later, '2028-03-01'], [undated, null]]);
  const patch = (id, body, selected = opts) => request(`/api/shared-tasks/${id}`, {
    ...selected, method: 'PATCH', body
  });
  assert.equal((await patch(earlier, { dueDate: '2027-02-29' })).status, 400);
  assert.equal((await patch(earlier, { dueDate: '2027-01-01' },
    { user: aidant, seniorId: other.user.seniorId })).status, 404);
  assert.equal((await patch(earlier, { completed: true })).status, 200);
  assert.equal((await patch(later, { dueDate: null })).status, 200);
  assert.equal((await patch(undated, { dueDate: '2026-01-15' })).status, 200);
  tasks = (await request('/api/shared-tasks', { user: senior })).data.tasks;
  assert.deepEqual(tasks.map(task => [task.id, task.dueDate, task.completed]),
    [[undated, '2026-01-15', false], [later, null, false], [earlier, '2028-02-29', true]]);
});

test('all account roles store separate names without altering legacy accounts', async () => {
  for (const role of ['senior', 'aidant', 'pro']) {
    const email = `separate-name-${role}@example.test`;
    const body = {
      firstName: ' Marie Claire ', lastName: ' Dupont Martin ', email,
      password: 'a-test-password-123', role, acceptedTerms: true,
      acceptedTermsVersion: TERMS_VERSION
    };
    if (role === 'pro') Object.assign(body, { homeLatitude: 43.7, homeLongitude: 0.1, serviceRadiusKm: 30 });
    const created = await request('/api/auth/register', { body });
    assert.equal(created.status, 201);
    assert.equal(created.data.user.name, 'Marie Claire Dupont Martin');
    assert.equal(created.data.user.firstName, 'Marie Claire');
    assert.equal(created.data.user.lastName, 'Dupont Martin');
    const authenticated = await request('/api/auth/me', { user: created.data });
    assert.equal(authenticated.data.user.firstName, 'Marie Claire');
    assert.equal(authenticated.data.user.lastName, 'Dupont Martin');
    const loggedIn = await request('/api/auth/login', { body: { email, password: body.password } });
    assert.equal(loggedIn.data.user.firstName, 'Marie Claire');
    assert.equal(loggedIn.data.user.lastName, 'Dupont Martin');
  }
  const legacy = await register('legacy-name@example.test', 'senior');
  assert.equal(legacy.user.name, 'legacy-name@example.test');
  assert.equal(legacy.user.firstName, null);
  assert.equal(legacy.user.lastName, null);
  for (const names of [{ firstName: 'Marie' }, { firstName: 'Marie', lastName: '  ' }]) {
    const result = await request('/api/auth/register', {
      body: { name: 'Ignored', ...names, email: 'invalid-name@example.test', password: 'a-test-password-123',
        role: 'senior', acceptedTerms: true, acceptedTermsVersion: TERMS_VERSION }
    });
    assert.equal(result.status, 400);
  }
});

test('invites seniors by email without granting access and reports delivery problems', async () => {
  const aidant = await register('invite-aidant@example.test', 'aidant');
  const existing = await register('invite-senior@example.test', 'senior');
  const path = '/api/senior-links/requests';
  const invite = email => request(path, { user: aidant, body: { email } });

  const missing = await invite('invite-new@example.test');
  const registered = await invite('invite-senior@example.test');
  assert.equal(missing.status, 202);
  assert.deepEqual(missing.data, registered.data);
  assert.deepEqual(sentInvitations.slice(-2), [
    { email: 'invite-new@example.test', url: 'https://generation-liaison.onrender.com/' },
    { email: 'invite-senior@example.test', url: 'https://generation-liaison.onrender.com/' }
  ]);
  assert.equal((await request('/api/senior-links', { user: existing })).data.requests.length, 1);
  assert.equal((await request('/api/logs/all', { user: aidant, seniorId: existing.user.seniorId })).status, 403);

  const count = sentInvitations.length;
  assert.match((await invite('invite-new@example.test')).data.message, /déjà été demandée récemment/);
  assert.equal(sentInvitations.length, count);

  emailConfigured = false;
  assert.match((await invite('invite-unconfigured@example.test')).data.message, /n’a pas été envoyé.*pas configuré/);
  emailConfigured = true;
  failInvitation = true;
  assert.match((await invite('invite-failure@example.test')).data.message, /n’a pas pu être envoyé/);
  failInvitation = false;
  const anotherAidant = await register('invite-retry-aidant@example.test', 'aidant');
  const retry = await request(path, { user: anotherAidant, body: { email: 'invite-failure@example.test' } });
  assert.match(retry.data.message, /transmis au service d’envoi/);

  const newSenior = await register('invite-new@example.test', 'senior');
  assert.equal((await request('/api/senior-links', { user: newSenior })).data.requests.length, 0);
  await request(path, { user: anotherAidant, body: { email: 'invite-new@example.test' } });
  assert.equal((await request('/api/senior-links', { user: newSenior })).data.requests.length, 1);
  assert.equal((await request('/api/logs/all', { user: anotherAidant, seniorId: newSenior.user.seniorId })).status, 403);
});

test('private messages require an active senior link and confirm reading only to the sender', async () => {
  const senior = await register('message-senior@example.test', 'senior');
  const aidant = await register('message-aidant@example.test', 'aidant');
  const stranger = await register('message-stranger@example.test', 'aidant');
  const messages = `/api/messages/${senior.user.id}`;
  assert.equal((await request(messages, { user: aidant, body: { message: 'Bonjour' } })).status, 403);
  await db.query(`INSERT INTO app_aidant_senior_links (aidant_user_id, senior_profile_id, linked_by)
    VALUES ($1, $2, $1)`, [aidant.user.id, senior.user.seniorId]);
  const contact = (await request('/api/messages/contacts', { user: senior })).data.contacts[0];
  assert.equal(contact.id, aidant.user.id);
  assert.equal(contact.canSend, true);
  assert.equal((await request(messages, { user: aidant, body: { message: '  ' } })).status, 400);
  assert.equal((await request(messages, { user: aidant, body: { message: 'x'.repeat(2001) } })).status, 400);
  const sent = await request(messages, { user: aidant, body: { message: ' Bonjour ! ' } });
  assert.equal(sent.status, 201);
  const own = (await request(messages, { user: aidant })).data.messages[0];
  assert.equal(own.body, 'Bonjour !');
  assert.equal(own.readAt, null);
  const inbox = await request('/api/notifications', { user: senior });
  const notification = inbox.data.notifications.find(item => item.entityId === sent.data.id);
  assert.equal(notification.senderUserId, aidant.user.id);
  assert.equal(notification.read, false);
  assert.equal((await request(`/api/notifications/open/${notification.id}`, { user: stranger })).status, 404);
  assert.equal((await request(`/api/notifications/open/${notification.id}`, { user: senior })).data.entityId, sent.data.id);
  const deliveries = await db.query('SELECT channel FROM app_notification_deliveries WHERE notification_id = $1', [notification.id]);
  assert.deepEqual(new Set(deliveries.rows.map(row => row.channel)), new Set(['push', 'sms', 'email']));
  assert.equal((await request(`/api/messages/${aidant.user.id}`, { user: stranger })).status, 403);
  assert.equal((await request(`/api/messages/${aidant.user.id}`, { user: senior })).data.messages[0].readAt, null);
  await db.query(`UPDATE app_private_messages SET created_at = CURRENT_TIMESTAMP - INTERVAL '1 day' WHERE id = $1`, [sent.data.id]);
  await db.query(`INSERT INTO app_private_messages (id, sender_id, recipient_id, body)
    SELECT gen_random_uuid(), $1, $2, 'nouveau' FROM generate_series(1, 100)`,
  [aidant.user.id, senior.user.id]);
  const focused = await request(`/api/messages/${aidant.user.id}?focus=${sent.data.id}`, { user: senior });
  assert.equal(focused.data.messages.length, 100);
  assert.ok(focused.data.messages.some(message => message.id === sent.data.id));
  assert.equal((await request(`/api/messages/${senior.user.id}/read`, {
    user: aidant, method: 'PATCH', body: { ids: [sent.data.id] }
  })).status, 200);
  assert.equal((await request(`${messages}?focus=${sent.data.id}`, { user: aidant })).data.messages.find(message => message.id === sent.data.id).readAt, null);
  assert.equal((await request(`/api/messages/${aidant.user.id}/read`, {
    user: senior, method: 'PATCH', body: { ids: [sent.data.id] }
  })).status, 200);
  assert.ok((await request(`${messages}?focus=${sent.data.id}`, { user: aidant })).data.messages.find(message => message.id === sent.data.id).readAt);
  assert.equal((await request('/api/notifications', { user: senior })).data.notifications.find(item => item.id === notification.id).read, true);
  await db.query(`UPDATE app_users SET premium_status = 'active', premium_until = CURRENT_TIMESTAMP - INTERVAL '1 day' WHERE id = $1`, [senior.user.id]);
  assert.equal((await request(messages, { user: aidant, body: { message: 'Premium expiré' } })).status, 201);
  assert.equal((await request(`${messages}?focus=${sent.data.id}`, { user: aidant })).status, 200);
  await db.query(`UPDATE app_users SET premium_until = NULL WHERE id = $1`, [senior.user.id]);
  const reply = await request(`/api/messages/${aidant.user.id}`, { user: senior, body: { message: 'À bientôt' } });
  assert.equal(reply.status, 201);
  await db.query('UPDATE app_aidant_senior_links SET suspended_at = CURRENT_TIMESTAMP WHERE aidant_user_id = $1 AND senior_profile_id = $2',
    [aidant.user.id, senior.user.seniorId]);
  assert.deepEqual((await request('/api/messages/contacts', { user: senior })).data.contacts, []);
  assert.equal((await request(messages, { user: aidant })).status, 403);
  assert.equal((await request(messages, { user: aidant, body: { message: 'Après retrait' } })).status, 403);
  assert.equal((await request(`/api/messages/${senior.user.id}/read`, {
    user: aidant, method: 'PATCH', body: { ids: [reply.data.id] }
  })).status, 403);
});

test('all associated aidants exchange freely even as mutual contacts, without bypassing restrictions', async () => {
  const senior = await register('free-message-senior@example.test', 'senior');
  const aidant = await register('free-message-aidant@example.test', 'aidant');
  const second = await register('free-message-second@example.test', 'aidant');
  const guardian = await register('free-message-guardian@example.test', 'aidant', true);
  for (const person of [aidant, second, guardian]) {
    await db.query(`INSERT INTO app_aidant_senior_links (aidant_user_id, senior_profile_id, linked_by)
      VALUES ($1, $2, $1)`, [person.user.id, senior.user.seniorId]);
  }
  for (const [user, other] of [[senior, aidant], [aidant, senior]]) {
    await db.query('INSERT INTO app_user_contacts (id, user_id, contact_user_id) VALUES ($1, $2, $3)',
      [randomUUID(), user.user.id, other.user.id]);
  }
  const contacts = (await request('/api/messages/contacts', { user: senior })).data.contacts;
  assert.deepEqual(new Set(contacts.map(item => item.id)), new Set([aidant.user.id, second.user.id]));
  assert.ok(contacts.every(item => item.canSend));
  for (const person of [aidant, second]) {
    assert.equal((await request(`/api/messages/${person.user.id}`, {
      user: senior, body: { message: 'Bonjour' }
    })).status, 201);
    assert.equal((await request(`/api/messages/${senior.user.id}`, {
      user: person, body: { message: 'Bonjour' }
    })).status, 201);
  }
  assert.equal((await request(`/api/messages/${senior.user.id}`, {
    user: guardian, body: { message: 'Bonjour' }
  })).status, 403);
  assert.equal((await request(`/api/messages/${guardian.user.id}`, {
    user: senior, body: { message: 'Bonjour' }
  })).status, 403);
  await db.query('UPDATE app_aidant_senior_links SET suspended_at = CURRENT_TIMESTAMP WHERE aidant_user_id = $1', [aidant.user.id]);
  const suspendedContact = (await request('/api/messages/contacts', { user: senior })).data.contacts.find(item => item.id === aidant.user.id);
  assert.equal(suspendedContact.canSend, false);
  assert.equal((await request(`/api/messages/${aidant.user.id}`, {
    user: senior, body: { message: 'Lien suspendu' }
  })).status, 403);
  await db.query('UPDATE app_users SET is_active = FALSE WHERE id = $1', [second.user.id]);
  assert.equal((await request(`/api/messages/${second.user.id}`, { user: senior })).status, 403);
  assert.equal((await request(`/api/messages/${senior.user.id}`, {
    user: second, body: { message: 'Compte désactivé' }
  })).status, 401);
});

test('all contact roles can exchange premium messages only after mutually adding each other', async () => {
  const senior = await register('message-contact-senior@example.test', 'senior');
  const professional = await register('message-contact-pro@example.test', 'senior');
  const stranger = await register('message-contact-outsider@example.test', 'senior');
  await db.query(`UPDATE app_users SET role = 'pro', verification_status = 'approved'
    WHERE id = $1`, [professional.user.id]);
  assert.equal((await request('/api/contacts', {
    user: senior, body: { email: ' MESSAGE-CONTACT-PRO@EXAMPLE.TEST ' }
  })).status, 201);
  assert.equal((await request(`/api/messages/${professional.user.id}`, {
    user: senior, body: { message: 'Bonjour' }
  })).status, 403);
  assert.equal((await request('/api/contacts', {
    user: professional, body: { email: 'message-contact-senior@example.test' }
  })).status, 201);
  assert.equal((await request('/api/messages/contacts', { user: professional })).data.contacts[0].canSend, false);
  assert.equal((await request(`/api/messages/${professional.user.id}`, { user: senior, body: { message: 'Bonjour' } })).status, 403);
  await db.query(`UPDATE app_users SET premium_status = 'active' WHERE id = $1`, [professional.user.id]);
  assert.equal((await request('/api/messages/contacts', { user: professional })).data.contacts[0].canSend, false);
  assert.equal((await request(`/api/messages/${professional.user.id}`, { user: senior, body: { message: 'Bonjour' } })).status, 403);
  await db.query(`UPDATE app_users SET premium_status = 'active' WHERE id = $1`, [senior.user.id]);
  assert.equal((await request('/api/messages/contacts', { user: professional })).data.contacts[0].canSend, true);
  const sent = await request(`/api/messages/${professional.user.id}`, { user: senior, body: { message: 'Bonjour' } });
  assert.equal(sent.status, 201);
  assert.equal((await request(`/api/messages/${senior.user.id}`, { user: professional, body: { message: 'Bonjour également' } })).status, 201);
  await db.query(`UPDATE app_users SET premium_until = CURRENT_TIMESTAMP - INTERVAL '1 day' WHERE id = $1`, [senior.user.id]);
  assert.equal((await request('/api/messages/contacts', { user: professional })).data.contacts[0].canSend, false);
  assert.equal((await request(`/api/messages/${senior.user.id}`, { user: professional, body: { message: 'Premium expiré' } })).status, 403);
  assert.equal((await request(`/api/messages/${senior.user.id}`, { user: stranger })).status, 403);
  assert.equal((await request(`/api/contacts/${professional.user.id}`, { user: senior, method: 'DELETE' })).status, 200);
  assert.equal((await request(`/api/messages/${professional.user.id}`, { user: senior })).status, 403);
});

test('next senior appointment uses confirmed own events without a 42-day limit', async () => {
  const senior = await register('next-senior@example.test', 'senior');
  const other = await register('next-other@example.test', 'senior');
  const aidant = await register('next-aidant@example.test', 'aidant');
  const pro = await register('next-pro@example.test', 'senior');
  await db.query(`UPDATE app_users SET role = 'pro', verification_status = 'approved'
    WHERE id = $1`, [pro.user.id]);
  const path = '/api/planning/calendar?next=1';
  assert.equal((await request(path)).status, 401);
  assert.equal((await request(path, { user: aidant })).status, 403);
  assert.deepEqual((await request(path, { user: senior })).data.events, []);
  const when = days => new Date(Date.now() + days * 86400000);
  const addEvent = (user, title, days) => db.query(
    `INSERT INTO app_personal_events (id, owner_user_id, title, starts_at, duration_minutes)
     VALUES ($1, $2, $3, $4, 30)`, [randomUUID(), user.user.id, title, when(days)]
  );
  await addEvent(senior, 'Passé', -1);
  await addEvent(other, 'Privé', 1);
  await addEvent(senior, 'Dans deux mois', 70);
  assert.equal((await request(path, { user: senior })).data.events[0].title, 'Dans deux mois');

  const pendingId = randomUUID();
  const confirmedId = randomUUID();
  await db.query(`INSERT INTO app_directory_bookings
    (id, requester_user_id, professional_user_id, senior_profile_id, scheduled_at, duration_minutes, status, hold_expires_at)
    VALUES ($1, $3, $4, $5, $6, 30, 'pending', CURRENT_TIMESTAMP + INTERVAL '1 day'),
           ($2, $3, $4, $5, $7, 30, 'confirmed', NULL)`,
    [pendingId, confirmedId, senior.user.id, pro.user.id, senior.user.seniorId, when(2), when(3)]);
  let result = await request(path, { user: senior });
  assert.equal(result.status, 200);
  assert.equal(result.data.events.length, 1);
  assert.equal(result.data.events[0].id, confirmedId);
  await addEvent(senior, 'Plus tôt', 1);
  result = await request(path, { user: senior });
  assert.equal(result.data.events[0].title, 'Plus tôt');
  assert.deepEqual((await request(path, { user: other })).data.events.map(event => event.title), ['Privé']);

  const organization = randomUUID();
  const recipient = randomUUID();
  const partner = randomUUID();
  const visit = randomUUID();
  const service = randomUUID();
  await db.query(`INSERT INTO planning_organizations (id, name, coordinator_user_id) VALUES ($1, 'Equipe', $2)`,
    [organization, pro.user.id]);
  await db.query(`INSERT INTO planning_org_members (organization_id, user_id, role) VALUES ($1, $2, 'professional')`,
    [organization, pro.user.id]);
  await db.query(`INSERT INTO planning_recipients (id, organization_id, senior_id, name, consent_at, created_by)
    VALUES ($1, $2, $3, 'Personne', CURRENT_TIMESTAMP, $4)`,
    [recipient, organization, senior.user.seniorId, pro.user.id]);
  await db.query(`INSERT INTO planning_visits
    (id, organization_id, recipient_id, assigned_user_id, scheduled_at, duration_minutes, visit_type, created_by, acceptance_status)
    VALUES ($1, $2, $3, $4, $5, 30, 'Visite prévue', $4, 'accepted')`,
    [visit, organization, recipient, pro.user.id, when(0.5)]);
  assert.equal((await request(path, { user: senior })).data.events[0].id, visit);
  await db.query(`INSERT INTO planning_service_partners
    (id, organization_id, user_id, service_type, display_name) VALUES ($1, $2, $3, 'hairdresser', 'Coiffure')`,
    [partner, organization, pro.user.id]);
  await db.query(`INSERT INTO planning_service_bookings
    (id, organization_id, recipient_id, partner_id, created_by, requested_at, status)
    VALUES ($1, $2, $3, $4, $5, $6, 'confirmed')`,
    [service, organization, recipient, partner, pro.user.id, when(0.25)]);
  assert.equal((await request(path, { user: senior })).data.events[0].id, service);
  await db.query('UPDATE planning_recipients SET consent_revoked_at = CURRENT_TIMESTAMP WHERE id = $1', [recipient]);
  assert.equal((await request(path, { user: senior })).data.events[0].title, 'Plus tôt');
});

test('personal agenda events can be compared only after the linked owner accepts', async () => {
  const senior = await register('agenda-senior@example.test', 'senior');
  const aidant = await register('agenda-aidant@example.test', 'aidant');
  const stranger = await register('agenda-stranger@example.test', 'aidant');
  await db.query(`INSERT INTO app_aidant_senior_links (aidant_user_id, senior_profile_id, linked_by)
    VALUES ($1, $2, $1)`, [aidant.user.id, senior.user.seniorId]);
  const day = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const path = `/api/planning/calendar?start=${day}&end=${new Date(Date.parse(day) + 2 * 86400000).toISOString().slice(0, 10)}`;
  const at = hour => `${day}T${hour}:00:00.000Z`;
  const own = { title: 'Mon rendez-vous', start: at('10'), durationMinutes: 60 };
  assert.equal((await request('/api/agenda/events', { user: aidant, body: { ...own, title: ' ' } })).status, 400);
  assert.equal((await request('/api/agenda/events', { user: aidant, body: own })).status, 201);
  const seniorEvent = await request('/api/agenda/events', {
    user: senior, body: { title: 'Médecin', start: at('10'), durationMinutes: 30 }
  });
  assert.equal(seniorEvent.status, 201);

  const before = await request(path, { user: aidant });
  assert.deepEqual(before.data.events.map(event => event.kind), ['personal']);

  assert.equal((await request('/api/agenda/shares', { user: stranger, body: { ownerUserId: senior.user.id } })).status, 403);
  const shareRequest = await request('/api/agenda/shares', { user: aidant, body: { ownerUserId: senior.user.id } });
  assert.equal(shareRequest.status, 201);
  assert.equal((await request('/api/agenda/shares', { user: aidant, body: { ownerUserId: senior.user.id } })).status, 409);
  assert.equal((await request(path, { user: aidant })).data.events.length, 1);
  const shareId = shareRequest.data.id;
  assert.equal((await request(`/api/agenda/shares/${shareId}`, { user: aidant, body: { decision: 'accept' } })).status, 404);
  assert.equal((await request(`/api/agenda/shares/${shareId}`, { user: senior, body: { decision: 'accept' } })).status, 200);

  const compared = await request(path, { user: aidant });
  assert.deepEqual(compared.data.events.map(event => [event.kind, event.conflict]).sort(), [['personal', true], ['shared', true]]);
  assert.deepEqual((await request(path, { user: senior })).data.events.map(event => event.kind), ['personal']);

  assert.equal((await request(`/api/agenda/shares/${shareId}`, { user: aidant, body: { decision: 'revoke' } })).status, 200);
  assert.equal((await request(path, { user: aidant })).data.events.length, 1);
  const mine = compared.data.events.find(event => event.kind === 'personal');
  assert.equal((await request(`/api/agenda/events/${mine.id}`, { user: stranger, method: 'DELETE' })).status, 404);
  assert.equal((await request(`/api/agenda/events/${mine.id}`, { user: aidant, method: 'DELETE' })).status, 200);
});

test('free accounts keep one contact per role until premium', async () => {
  const senior = await register('contacts-senior@example.test', 'senior');
  const first = await register('contacts-aidant-1@example.test', 'aidant');
  const second = await register('contacts-aidant-2@example.test', 'aidant');
  const add = user => request('/api/contacts', { user: senior, body: { contactUserId: user.user.id } });
  assert.equal((await add(first)).status, 201);
  assert.equal((await add(first)).status, 201);
  assert.equal((await add(second)).status, 402);
  await db.query(`UPDATE app_users SET premium_status = 'active' WHERE id = $1`, [senior.user.id]);
  assert.equal((await add(second)).status, 201);
});

test('calendar and conflicts isolate identified bookings and conservatively cover legacy multi-profile bookings', async () => {
      const first = await register('calendar-first@example.test', 'senior');
      const second = await register('calendar-second@example.test', 'senior');
      const outsider = await register('calendar-outsider@example.test', 'senior');
      const aidant = await register('calendar-aidant@example.test', 'aidant');
      const pro = await register('calendar-pro@example.test', 'senior');
      await db.query(`UPDATE app_users SET role = 'pro', verification_status = 'approved', verification_reviewed_at = CURRENT_TIMESTAMP
        WHERE id = $1`, [pro.user.id]);
      await db.query(`INSERT INTO app_aidant_senior_links (aidant_user_id, senior_profile_id, linked_by)
        VALUES ($1, $2, $1), ($1, $3, $1)`, [aidant.user.id, first.user.seniorId, second.user.seniorId]);
      const start = new Date(Date.now() + 5 * 86400000);
      start.setUTCHours(10, 0, 0, 0);
      const firstTime = new Date(start.getTime() + 2 * 3600000);
      const secondTime = new Date(start.getTime() + 4 * 3600000);
      const legacy = randomUUID();
      const booking1 = randomUUID();
      const booking2 = randomUUID();
      await db.query(`INSERT INTO app_directory_bookings
        (id, requester_user_id, professional_user_id, senior_profile_id, scheduled_at, duration_minutes, google_event_id, status)
        VALUES ($1, $4, $5, NULL, $6, 60, 'legacy', 'confirmed'),
               ($2, $4, $5, $7, $8, 60, 'first', 'confirmed'),
               ($3, $4, $5, $9, $10, 60, 'second', 'confirmed')`,
        [legacy, booking1, booking2, aidant.user.id, pro.user.id, start, first.user.seniorId,
          firstTime, second.user.seniorId, secondTime]);
      const from = new Date(start.getTime() - 86400000).toISOString().slice(0, 10);
      const to = new Date(start.getTime() + 2 * 86400000).toISOString().slice(0, 10);
      const path = `/api/planning/calendar?start=${from}&end=${to}`;
      const firstView = await request(path, { user: aidant, seniorId: first.user.seniorId });
      const secondView = await request(path, { user: aidant, seniorId: second.user.seniorId });
      assert.equal(firstView.status, 200);
      assert.deepEqual(firstView.data.events.map(event => event.id), [null, booking1]);
      assert.deepEqual(secondView.data.events.map(event => event.id), [null, booking2]);
      assert.match(firstView.data.events[0].title, /personne non identifiée/);
      const directory = await request('/api/directory/bookings', { user: aidant, seniorId: first.user.seniorId });
      assert.deepEqual(new Set(directory.data.bookings.map(booking => booking.id)), new Set([null, booking1]));
      assert.equal(directory.data.bookings.find(booking => booking.id === null).professionalId, null);
      assert.equal((await request(path, { user: aidant, seniorId: outsider.user.seniorId })).status, 403);
      const withoutSenior = await request(path, { user: aidant });
      assert.equal(withoutSenior.status, 200);
      assert.deepEqual(withoutSenior.data.events, []);
      assert.deepEqual((await request('/api/calendar/planning/requests', { user: aidant })).data.requests, []);
      assert.deepEqual((await request(path, { user: outsider })).data.events, []);
      const client = { query: (sql, params) => db.query(sql, params) };
      for (const seniorId of [first.user.seniorId, second.user.seniorId]) {
        await assert.rejects(assertScheduleAvailable(client, {
          professionalId: randomUUID(), seniorId, start, durationMinutes: 30
        }), error => error.status === 409);
      }
      await assertScheduleAvailable(client, {
        professionalId: randomUUID(), seniorId: outsider.user.seniorId, start, durationMinutes: 30
      });
      await assertScheduleAvailable(client, {
        professionalId: randomUUID(), seniorId: second.user.seniorId, start: firstTime, durationMinutes: 30
      });
      const calendar = require('../google-calendar');
      const methods = ['decryptRefreshToken', 'getAccessToken', 'getBusyIntervals', 'createHoldEvent'];
      const originals = Object.fromEntries(methods.map(name => [name, calendar[name]]));
      Object.assign(calendar, {
        decryptRefreshToken: () => 'token',
        getAccessToken: async () => 'access',
        getBusyIntervals: async () => [],
        createHoldEvent: async () => randomUUID()
      });
      try {
        const weekly = Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, startTime: '08:00', endTime: '20:00' }));
        await db.query(`UPDATE app_users SET directory_listed = TRUE, home_latitude = 48,
          home_longitude = 2, google_calendar_refresh_token = 'token', appointment_timezone = 'UTC',
          appointment_weekly_hours = $2::jsonb, appointment_duration_minutes = 60 WHERE id = $1`,
          [pro.user.id, JSON.stringify(weekly)]);
        const newTime = new Date(start.getTime() + 6 * 3600000);
        const route = `/api/directory/${pro.user.id}/bookings`;
        assert.equal((await request(route, { user: aidant, body: { start: newTime.toISOString() } })).status, 409);
        assert.equal((await request(route, { user: aidant, seniorId: outsider.user.seniorId,
          body: { start: newTime.toISOString() } })).status, 403);
        const created = await request(route, { user: aidant, seniorId: second.user.seniorId,
          body: { start: newTime.toISOString() } });
        assert.equal(created.status, 201, JSON.stringify(created.data));
        const saved = await db.query('SELECT senior_profile_id FROM app_directory_bookings WHERE id = $1', [created.data.id]);
        assert.equal(saved.rows[0].senior_profile_id, second.user.seniorId);
      } finally {
        Object.assign(calendar, originals);
      }
      const locks = new Map();
      const makeClient = () => {
        const held = [];
        return {
          async query(sql, params) {
            if (!sql.includes('pg_advisory_xact_lock')) return db.query(sql, params);
            const key = params[0];
            const previous = locks.get(key) || Promise.resolve();
            let release;
            const own = new Promise(resolve => { release = resolve; });
            locks.set(key, own);
            await previous;
            held.push(release);
            return { rows: [] };
          },
          release() { held.reverse().forEach(release => release()); }
        };
      };
      let firstLocked;
      const locked = new Promise(resolve => { firstLocked = resolve; });
      let finishFirst;
      const pause = new Promise(resolve => { finishFirst = resolve; });
      const raceTime = new Date(start.getTime() + 9 * 3600000);
      const createConcurrent = async (professionalId, wait) => {
        const tx = makeClient();
        try {
          await lockScheduleParticipants(tx, professionalId, first.user.seniorId);
          if (wait) { firstLocked(); await pause; }
          await assertScheduleAvailable(tx, { professionalId, seniorId: first.user.seniorId,
            start: raceTime, durationMinutes: 60 });
          await db.query(`INSERT INTO app_directory_bookings
            (id, requester_user_id, professional_user_id, senior_profile_id, scheduled_at,
             duration_minutes, google_event_id, status)
            VALUES ($1, $2, $3, $4, $5, 60, $6, 'confirmed')`,
            [randomUUID(), aidant.user.id, pro.user.id, first.user.seniorId, raceTime, randomUUID()]);
        } finally {
          tx.release();
        }
      };
      const competingA = createConcurrent(randomUUID(), true);
      await locked;
      const competingB = createConcurrent(randomUUID(), false);
      finishFirst();
      const outcomes = await Promise.allSettled([competingA, competingB]);
      assert.equal(outcomes.filter(outcome => outcome.status === 'fulfilled').length, 1,
        outcomes.map(outcome => outcome.reason?.message).join('; '));
      assert.equal(outcomes.find(outcome => outcome.status === 'rejected').reason.status, 409);
});

test('consent, suspension, administrator email and confirmation protect senior data', async () => {
  const senior = await register('senior@example.test', 'senior');
  const other = await register('other@example.test', 'senior');
  const aidant = await register('aidant@example.test', 'aidant');
  const admin = await register('admin@example.test', 'senior');
  const guardian = await register('guardian@example.test', 'aidant', true);
  const seniorId = senior.user.seniorId;
  const seniorUserId = senior.user.id;
  const aidantUserId = aidant.user.id;

  const guardianLink = `/api/admin/accounts/${guardian.user.id}/senior-links`;
  assert.equal((await request('/api/notifications/config', { user: guardian })).status, 200);
  assert.equal((await request('/api/notifications/preferences', { user: guardian })).status, 200);
  assert.equal((await request('/api/aidant/seniors', { user: guardian })).status, 403);
  assert.equal((await request(guardianLink, {
    user: admin, admin: true, body: { seniorUserId }
  })).status, 409);
  assert.equal((await request(`/api/admin/accounts/${aidantUserId}/senior-links`, {
    user: admin, admin: true, body: { seniorUserId }
  })).status, 409);
  await db.query("UPDATE app_users SET guardian_verification_status = 'approved' WHERE id = $1", [guardian.user.id]);
  assert.equal((await request('/api/senior-links/requests', {
    user: guardian, body: { email: 'senior@example.test' }
  })).status, 403);
  assert.equal((await request(guardianLink, {
    user: admin, admin: true, body: { seniorUserId }
  })).status, 201);
  assert.equal((await request('/api/logs/all', { user: guardian, seniorId })).status, 200);

  assert.equal((await request('/api/logs/all', { user: aidant, seniorId })).status, 403);
  const missing = await request('/api/senior-links/requests', {
    user: aidant, body: { email: 'unknown@example.test' }
  });

  const submitted = await request('/api/senior-links/requests', {
    user: aidant, body: { email: 'senior@example.test' }
  });
  assert.equal(submitted.status, 202);
  assert.deepEqual(submitted.data, missing.data);
  const inbox = await request('/api/senior-links', { user: senior });
  assert.equal(inbox.data.requests.length, 1);
  const requestId = inbox.data.requests[0].id;
  const decisionPath = `/api/senior-links/requests/${requestId}/decision`;
  assert.equal((await request(decisionPath, { user: other, body: { decision: 'accept' } })).status, 404);
  assert.equal((await request(decisionPath, { user: senior, body: { decision: 'decline' } })).status, 200);
  assert.equal((await request('/api/logs/all', { user: aidant, seniorId })).status, 403);
  assert.equal((await request(decisionPath, { user: senior, body: { decision: 'accept' } })).status, 404);
  await request('/api/senior-links/requests', { user: aidant, body: { email: 'senior@example.test' } });
  const acceptedId = (await request('/api/senior-links', { user: senior })).data.requests[0].id;
  assert.equal((await request(`/api/senior-links/requests/${acceptedId}/decision`, {
    user: senior, body: { decision: 'accept' }
  })).status, 200);
  assert.equal((await request('/api/auth/me', { user: senior })).status, 200);
  assert.equal((await request('/api/auth/me', { user: aidant })).status, 200);
  assert.equal((await request('/api/logs/all', { user: aidant, seniorId })).status, 200);

  assert.equal((await request('/api/senior-links/removals', {
    user: aidant, body: { otherUserId: seniorUserId }
  })).status, 202);
  assert.equal((await request('/api/logs/all', { user: aidant, seniorId })).status, 200);
  const adminList = await request('/api/admin/senior-link-removals', { user: admin, admin: true });
  assert.equal(adminList.data.requests.length, 1);
  const adminDelete = `/api/admin/accounts/${aidantUserId}/senior-links/${seniorId}`;
  assert.equal((await request(adminDelete, { user: admin, admin: true, method: 'DELETE' })).status, 200);
  assert.equal((await request('/api/logs/all', { user: aidant, seniorId })).status, 403);

  await request('/api/senior-links/requests', { user: aidant, body: { email: 'senior@example.test' } });
  const secondRequest = (await request('/api/senior-links', { user: senior })).data.requests[0].id;
  await request(`/api/senior-links/requests/${secondRequest}/decision`, {
    user: senior, body: { decision: 'accept' }
  });
  assert.equal((await request('/api/senior-links/removals', {
    user: senior, body: { otherUserId: aidantUserId }
  })).data.suspended, true);
  assert.equal((await request('/api/logs/all', { user: aidant, seniorId })).status, 403);
  assert.equal((await request(adminDelete, { user: admin, admin: true, method: 'DELETE' })).status, 409);

  const removal = (await request('/api/admin/senior-link-removals', { user: admin, admin: true })).data.requests[0];
  const send = `/api/admin/senior-link-removals/${removal.id}/send-code`;
  assert.equal((await request(send, { user: other, body: {} })).status, 403);
  failEmail = true;
  assert.equal((await request(send, { user: admin, admin: true, body: {} })).status, 500);
  failEmail = false;
  assert.equal((await request(send, { user: admin, admin: true, body: {} })).status, 200);
  assert.equal(sentCode.email, 'senior@example.test');
  const confirm = `/api/senior-links/removals/${removal.id}/confirm`;
  assert.equal((await request(send, { user: admin, admin: true, body: {} })).status, 429);
  assert.equal((await request(confirm, { user: senior, body: { code: '0'.repeat(32) } })).status, 400);
  assert.equal((await request(confirm, { user: other, body: { code: sentCode.code } })).status, 400);
  const expiredCode = sentCode.code;
  await db.query(
    "UPDATE app_aidant_unlink_requests SET code_sent_at = CURRENT_TIMESTAMP - INTERVAL '31 minutes', code_expires_at = CURRENT_TIMESTAMP - INTERVAL '1 minute' WHERE id = $1",
    [removal.id]
  );
  assert.equal((await request(confirm, { user: senior, body: { code: expiredCode } })).status, 400);
  assert.equal((await request(send, { user: admin, admin: true, body: {} })).status, 200);
  assert.notEqual(sentCode.code, expiredCode);
  assert.equal((await request(confirm, { user: senior, body: { code: expiredCode } })).status, 400);
  assert.equal((await request(confirm, { user: senior, body: { code: sentCode.code } })).status, 200);
  assert.equal((await request(confirm, { user: senior, body: { code: sentCode.code } })).status, 400);
  assert.equal((await request('/api/logs/all', { user: aidant, seniorId })).status, 403);
});

test('association refuses an existing conflict with an unidentified legacy booking and removal releases it', async () => {
  const senior = await register('link-conflict-senior@example.test', 'senior');
  const aidant = await register('link-conflict-aidant@example.test', 'aidant');
  const firstPro = await register('link-conflict-pro1@example.test', 'senior');
  const secondPro = await register('link-conflict-pro2@example.test', 'senior');
  const legacyId = randomUUID();
  const occupiedId = randomUUID();
  const start = new Date(Date.now() + 6 * 86400000);
  await db.query(`INSERT INTO app_directory_bookings
    (id, requester_user_id, professional_user_id, senior_profile_id, scheduled_at,
     duration_minutes, google_event_id, status)
    VALUES ($1, $3, $5, NULL, $7, 60, 'legacy-link', 'confirmed'),
           ($2, $4, $6, $8, $7, 60, 'known-link', 'confirmed')`,
    [legacyId, occupiedId, aidant.user.id, senior.user.id, firstPro.user.id,
      secondPro.user.id, start, senior.user.seniorId]);
  assert.equal((await request('/api/senior-links/requests', {
    user: aidant, body: { email: 'link-conflict-senior@example.test' }
  })).status, 202);
  const requestId = (await request('/api/senior-links', { user: senior })).data.requests[0].id;
  const decision = `/api/senior-links/requests/${requestId}/decision`;
  const refused = await request(decision, { user: senior, body: { decision: 'accept' } });
  assert.equal(refused.status, 409);
  assert.match(refused.data.error, /ancienne réservation/);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM app_aidant_senior_links WHERE aidant_user_id = $1',
    [aidant.user.id])).rows[0].n, 0);
  await db.query("UPDATE app_directory_bookings SET status = 'declined' WHERE id = $1", [occupiedId]);
  const secondLegacy = randomUUID();
  await db.query(`INSERT INTO app_directory_bookings
    (id, requester_user_id, professional_user_id, scheduled_at, duration_minutes, google_event_id, status)
    VALUES ($1, $2, $3, $4, 60, 'legacy-link-2', 'confirmed')`,
    [secondLegacy, aidant.user.id, secondPro.user.id, start]);
  const overlappingLegacy = await request(decision, { user: senior, body: { decision: 'accept' } });
  assert.equal(overlappingLegacy.status, 409);
  assert.match(overlappingLegacy.data.error, /réservations de cet aidant se chevauchent/);
  await db.query('DELETE FROM app_directory_bookings WHERE id = $1', [secondLegacy]);
  assert.equal((await request(decision, { user: senior, body: { decision: 'accept' } })).status, 200);
  const client = { query: (sql, params) => db.query(sql, params) };
  const check = () => assertScheduleAvailable(client, {
    professionalId: randomUUID(), seniorId: senior.user.seniorId, start, durationMinutes: 30
  });
  await assert.rejects(check(), error => error.status === 409);
  const admin = await request('/api/auth/login', {
    body: { email: 'admin@example.test', password: 'a-test-password-123' }
  });
  assert.equal(admin.status, 200);
  assert.equal((await request(`/api/admin/accounts/${aidant.user.id}/senior-links/${senior.user.seniorId}`,
    { user: admin.data, admin: true, method: 'DELETE' })).status, 200);
  await check();
});

test('visit decisions notify the profile owner, or nobody when the profile has no account', async () => {
  const senior = await register('visit-notification-senior@example.test', 'senior');
  const pro = await register('visit-notification-pro@example.test', 'senior');
  await db.query(`UPDATE app_users SET role = 'pro', verification_status = 'approved',
    verification_reviewed_at = CURRENT_TIMESTAMP WHERE id = $1`, [pro.user.id]);
  const organization = randomUUID();
  const unowned = randomUUID();
  await db.query('INSERT INTO senior_profiles (id, name) VALUES ($1, $2)', [unowned, 'Sans compte']);
  await db.query(`INSERT INTO planning_organizations (id, name, coordinator_user_id)
    VALUES ($1, 'Equipe', $2)`, [organization, pro.user.id]);
  await db.query(`INSERT INTO planning_org_members (organization_id, user_id, role)
    VALUES ($1, $2, 'professional')`, [organization, pro.user.id]);
  for (const seniorId of [senior.user.seniorId, unowned]) {
    const recipient = randomUUID();
    const visit = randomUUID();
    await db.query(`INSERT INTO planning_recipients (id, organization_id, senior_id, name, consent_at, created_by)
      VALUES ($1, $2, $3, 'Personne', CURRENT_TIMESTAMP, $4)`, [recipient, organization, seniorId, pro.user.id]);
    await db.query(`INSERT INTO planning_visits
      (id, organization_id, recipient_id, assigned_user_id, scheduled_at, duration_minutes,
       visit_type, created_by, acceptance_status)
      VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP + INTERVAL '5 days', 60, 'Visite', $4, 'pending')`,
    [visit, organization, recipient, pro.user.id]);
    const result = await request(`/api/planning/visits/${visit}/response`,
      { user: pro, body: { acceptanceStatus: 'declined' } });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    const { rows } = await db.query('SELECT user_id FROM app_notifications WHERE entity_id = $1', [visit]);
    assert.deepEqual(rows.map(row => row.user_id), seniorId === unowned ? [] : [senior.user.id]);
  }
});

test('directory radius filters exact distances before pagination', async () => {
  const searcher = await register('directory-searcher@example.test', 'senior');
  for (const [email, longitude] of [
    ['near@example.test', 0.04],
    ['inside@example.test', 0.089],
    ['outside@example.test', 0.092]
  ]) {
    const account = await register(email, 'aidant');
    await db.query(
      `UPDATE app_users SET role = 'pro', verification_status = 'approved',
         directory_listed = TRUE, directory_activity = 'Service test',
         google_calendar_refresh_token = 'test', home_latitude = 0, home_longitude = $2
       WHERE id = $1`,
      [account.user.id, longitude]
    );
  }
  const body = { q: 'Service test', latitude: 0, longitude: 0, radiusKm: 10, limit: 1 };
  const first = await request('/api/directory/search', { user: searcher, body });
  assert.equal(first.status, 200);
  assert.equal(first.data.professionals[0].name, 'near@example.test');
  assert.equal(first.data.hasMore, true);
  const second = await request('/api/directory/search', {
    user: searcher, body: { ...body, offset: first.data.nextOffset }
  });
  assert.equal(second.data.professionals[0].name, 'inside@example.test');
  assert.equal(second.data.hasMore, false);
  const all = await request('/api/directory/search', { user: searcher, body: { q: 'Service test' } });
  assert.equal(all.data.professionals.length, 3);
  for (const invalid of [{ radiusKm: 10 }, { ...body, radiusKm: 0 }, { ...body, radiusKm: 501 }]) {
    assert.equal((await request('/api/directory/search', { user: searcher, body: invalid })).status, 400);
  }
});

test('directory reports public service failures separately from searches not attempted', async () => {
  const searcher = await register('directory-status@example.test', 'senior');
  const originalFetch = global.fetch;
  const id = randomUUID();
  await db.query(`INSERT INTO app_external_professionals (id, name, activity, city, postal_code)
    VALUES ($1, 'Extérieur', 'Testrecherche', 'Autre ville du département', '69999')`, [id]);
  try {
    let responseKind = 'success';
    global.fetch = async (url, options) => {
      if (String(url).startsWith(baseUrl)) return originalFetch(url, options);
      if (String(url).startsWith('https://geo.api.gouv.fr/')) {
        if (responseKind === 'geo-error') throw new Error('network');
        if (responseKind === 'geo-empty') return new Response('[]');
        if (responseKind === 'geo-http-error') return new Response('', { status: 503 });
        if (responseKind === 'geo-bad-json') return new Response('{');
        return new Response(JSON.stringify([{ nom: 'Lyon', code: '69123', codesPostaux: ['69000'] }]));
      }
      if (responseKind === 'http-error') return new Response('', { status: 503 });
      if (responseKind === 'bad-json') return new Response('{');
      if (responseKind === 'bad-shape') return new Response('{}');
      if (responseKind === 'network-error') throw new Error('network');
      return new Response(JSON.stringify({ results: [{ nom_complet: 'Entreprise', siren: '123',
        matching_etablissements: [{ etat_administratif: 'A', siret: '123456' }] }] }));
    };
    const body = { q: 'Testrecherche', latitude: 45.75, longitude: 4.85, radiusKm: 1 };
    const success = await request('/api/directory/search', { user: searcher, body });
    assert.equal(success.data.localityStatus, 'available');
    assert.equal(success.data.publicDirectoryStatus, 'available');
    assert.ok(success.data.professionals.some(p => p.id === id && p.external && p.distanceKm === null));
    assert.ok(success.data.professionals.some(p => p.id === 'sirene-123456'));
    for (responseKind of ['http-error', 'bad-json', 'bad-shape', 'network-error']) {
      const failed = await request('/api/directory/search', { user: searcher, body });
      assert.equal(failed.status, 200);
      assert.equal(failed.data.publicDirectoryStatus, 'unavailable');
      assert.ok(failed.data.professionals.some(p => p.id === id));
    }
    for (responseKind of ['geo-error', 'geo-empty', 'geo-http-error', 'geo-bad-json']) {
      const failed = await request('/api/directory/search', { user: searcher, body });
      assert.equal(failed.data.localityStatus, 'unavailable');
      assert.equal(failed.data.publicDirectoryStatus, 'not_requested');
      assert.ok(!failed.data.professionals.some(p => p.id === id));
    }
    responseKind = 'success';
    const skipped = await request('/api/directory/search', { user: searcher, body: { q: '' } });
    assert.equal(skipped.data.publicDirectoryStatus, 'not_requested');
    const later = await request('/api/directory/search', { user: searcher, body: { ...body, offset: 1 } });
    assert.equal(later.data.localityStatus, 'not_requested');
    assert.equal(later.data.publicDirectoryStatus, 'not_requested');
    assert.ok(!later.data.professionals.some(p => p.external));
  } finally {
    global.fetch = originalFetch;
  }
});

test('shared directory is scoped to an active senior association and published verified professionals', async () => {
  const senior = await register('directory-shared-senior@example.test', 'senior');
  const other = await register('directory-shared-other@example.test', 'senior');
  const aidant = await register('directory-shared-aidant@example.test', 'aidant');
  const stranger = await register('directory-shared-stranger@example.test', 'aidant');
  const pro = await register('directory-shared-pro@example.test', 'aidant');
  const options = { user: aidant, seniorId: senior.user.seniorId };
  await db.query(`UPDATE app_users SET role = 'pro', verification_status = 'approved',
    directory_listed = TRUE, directory_activity = 'Professionnel test',
    home_latitude = 0, home_longitude = 0 WHERE id = $1`, [pro.user.id]);
  await db.query(`INSERT INTO app_aidant_senior_links (aidant_user_id, senior_profile_id, linked_by)
    VALUES ($1, $2, $1), ($1, $3, $1)`, [aidant.user.id, senior.user.seniorId, other.user.seniorId]);
  const path = `/api/shared-directory/${pro.user.id}`;
  assert.equal((await request('/api/shared-directory')).status, 401);
  assert.equal((await request('/api/shared-directory', { user: aidant })).status, 409);
  assert.equal((await request(path, { user: stranger, seniorId: senior.user.seniorId, method: 'POST' })).status, 403);
  assert.equal((await request(`/api/shared-directory/${stranger.user.id}`, { user: senior, method: 'POST' })).status, 404);
  assert.equal((await request(path, { user: senior, method: 'POST' })).status, 200);
  assert.equal((await request(path, { ...options, method: 'POST' })).status, 200);
  assert.equal((await request('/api/shared-directory', options)).data.professionals.length, 1);
  assert.deepEqual((await request('/api/shared-directory', { user: aidant, seniorId: other.user.seniorId })).data.professionals, []);
  assert.equal((await request(path, { user: aidant, seniorId: other.user.seniorId, method: 'DELETE' })).status, 404);
  await db.query("UPDATE app_users SET directory_listed = FALSE WHERE id = $1", [pro.user.id]);
  const hidden = (await request('/api/shared-directory', options)).data.professionals[0];
  assert.equal(hidden.name, null);
  assert.equal((await request(path, { ...options, method: 'POST' })).status, 404);
  assert.equal((await request(path, { ...options, method: 'DELETE' })).status, 200);
  await db.query(`UPDATE app_aidant_senior_links SET suspended_at = CURRENT_TIMESTAMP
    WHERE aidant_user_id = $1 AND senior_profile_id = $2`, [aidant.user.id, senior.user.seniorId]);
  assert.equal((await request('/api/shared-directory', options)).status, 403);
  assert.equal((await request(path, { ...options, method: 'POST' })).status, 403);
});
