const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const { PGlite } = require('@electric-sql/pglite');
const pg = require('pg');
const delivery = require('../notification-delivery');
const { TERMS_VERSION, createAuthService } = require('../auth');
const { assertScheduleAvailable, lockScheduleParticipants } = require('../schedule-conflicts');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createDueTaskReminder } = require('../task-reminders');
const { createDueBirthdayReminder } = require('../birthday-reminders');
const { createSiteMonitor } = require('../site-monitor');
const { createSiteAlerts } = require('../site-monitor-alerts');

const adminCode = 'test-administrator-code-at-least-32-characters';
let db;
let server;
let baseUrl;
let sentCode;
let failEmail = false;
let emailConfigured = true;
let failInvitation = false;
let failRegistrationInvitation = false;
let failAdministrativeActivation = false;
const sentInvitations = [];
const sentRegistrationInvitations = [];
const sentAdministrativeActivations = [];

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
  process.env.ADMIN_EMAILS = 'admin@example.test,photo-admin@example.test,monitor-admin@example.test,establishment-admin@example.test,establishment-admin-2@example.test,care-admin@example.test,closure-admin@example.test,access-admin@example.test,provision-admin@example.test,overview-admin@example.test';
  process.env.ADMIN_ACCESS_CODE = adminCode;
  process.env.VISUAL_CROSSING_API_KEY = '';
  delivery.isConfigured = () => ({ email: emailConfigured });
  delivery.sendSeniorUnlinkCode = async (email, code) => {
    if (failEmail) throw new Error('test delivery failure');
    sentCode = { email, code };
  };
  delivery.sendSeniorInvitation = async (email, url) => {
    if (failInvitation) throw new Error('test invitation delivery failure');
    sentInvitations.push({ email, url });
  };
  delivery.sendRegistrationInvitation = async (email, url, role) => {
    if (failRegistrationInvitation) throw new Error('test registration invitation failure');
    sentRegistrationInvitations.push({ email, url, role });
  };
  delivery.sendAdministrativeActivation = async (email, url) => {
    if (failAdministrativeActivation) throw new Error('test activation delivery failure');
    sentAdministrativeActivations.push({ email, url });
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
      ...(role !== 'pro' ? { accountCommune: { name: 'Paris', code: '75056', latitude: 48.86, longitude: 2.35 } } : {}),
      acceptedTerms: true, acceptedTermsVersion: TERMS_VERSION
    }
  });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  return result.data;
}

test('administrators provision all email account roles without accepting terms or granting private access', async () => {
  const admin = await register('provision-admin@example.test', 'aidant');
  const other = await register('provision-other@example.test', 'aidant');
  const create = '/api/admin/accounts';
  const fields = { firstName: 'Camille', lastName: 'Exemple', email: 'new-provision@example.test',
    role: 'senior', confirmed: true };
  assert.equal((await request(create, { user: other, admin: true, body: fields })).status, 403);
  assert.equal((await request(create, { user: admin, body: fields })).status, 403);
  assert.equal((await request(create, { user: admin, admin: true, body: { ...fields, confirmed: false } })).status, 400);
  assert.equal((await request(create, { user: admin, admin: true, body: { ...fields, role: 'staff' } })).status, 400);
  emailConfigured = false;
  assert.equal((await request(create, { user: admin, admin: true, body: fields })).status, 503);
  emailConfigured = true;

  for (const role of ['senior', 'aidant', 'pro', 'establishment']) {
    const email = `admin-provision-${role}@example.test`;
    const created = await request(create, { user: admin, admin: true, body: { ...fields, email, role } });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    assert.equal(created.data.activationEmailSent, true);
    assert.equal(sentAdministrativeActivations.at(-1).email, email);
    const token = new URL(sentAdministrativeActivations.at(-1).url).hash.slice(1);
    const row = (await db.query('SELECT terms_accepted_at, created_by_admin, verification_status FROM app_users WHERE id = $1', [created.data.id])).rows[0];
    assert.equal(row.terms_accepted_at, null);
    assert.equal(row.created_by_admin, admin.user.id);
    assert.equal(row.verification_status, role === 'pro' ? 'pending' : 'approved');
    assert.equal((await request(create, { user: admin, admin: true, body: { ...fields, email, role } })).status, 409);

    assert.equal((await request('/api/auth/login', { body: { email, password: 'mot-personnel-456' } })).status, 401);
    const activate = '/api/auth/password-reset/confirm';
    const body = { token, password: 'mot-personnel-456', acceptedTerms: true, acceptedTermsVersion: TERMS_VERSION };
    assert.equal((await request(activate, { body: { ...body, acceptedTerms: false } })).status, 400);
    assert.equal((await request(activate, { body: { ...body, acceptedTermsVersion: 'obsolete' } })).status, 400);
    assert.equal((await request(activate, { body })).status, 200);
    assert.equal((await request(activate, { body })).status, 400);
    const login = await request('/api/auth/login', { body: { email, password: body.password } });
    assert.equal(login.status, 200);
    assert.equal(login.data.user.passwordChangeRequired, false);
    const accepted = (await db.query('SELECT terms_accepted_at FROM app_users WHERE id = $1', [created.data.id])).rows[0];
    assert.ok(accepted.terms_accepted_at);
  }
  failAdministrativeActivation = true;
  const failedDelivery = await request(create, { user: admin, admin: true, body: { ...fields, email: 'delivery-failure@example.test' } });
  failAdministrativeActivation = false;
  assert.equal(failedDelivery.status, 201);
  assert.equal(failedDelivery.data.activationEmailSent, false);
});

test('administrators can manage accounts beyond the former 500-account limit', async () => {
  const admin = await register('overview-admin@example.test', 'aidant');
  const prefix = randomUUID();
  const { rows } = await db.query(
    `WITH profiles AS (
       INSERT INTO senior_profiles (id, name)
       SELECT gen_random_uuid(), $1 || '-' || number FROM generate_series(1, 501) number
       RETURNING id, name
     )
     INSERT INTO app_users (id, senior_id, name, email, role, password_salt, password_hash, created_at)
     SELECT gen_random_uuid(), profiles.id, profiles.name, profiles.name || '@example.test', 'senior',
            admin.password_salt, admin.password_hash, CURRENT_TIMESTAMP
     FROM profiles CROSS JOIN app_users admin WHERE admin.id = $2
     RETURNING id, senior_id`,
    [prefix, admin.user.id]
  );
  try {
    const result = await request('/api/admin/overview', { user: admin, admin: true });
    assert.equal(result.status, 200);
    const listed = new Set(result.data.accounts.map(account => account.id));
    assert.ok(rows.every(row => listed.has(row.id)));
    assert.ok(listed.has(admin.user.id));
  } finally {
    await db.query('DELETE FROM app_users WHERE id = ANY($1::uuid[])', [rows.map(row => row.id)]);
    await db.query('DELETE FROM senior_profiles WHERE id = ANY($1::uuid[])', [rows.map(row => row.senior_id)]);
  }
});

test('administrators invite registration and initiate a traceable closure without accessing private data', async () => {
  const admin = await register('closure-admin@example.test', 'senior');
  const target = await register('admin-closure-target@example.test', 'senior');
  const other = await register('admin-closure-other@example.test', 'aidant');
  const invite = '/api/admin/account-invitations';
  assert.equal((await request(invite, { user: other, admin: true, body: { email: 'new@example.test' } })).status, 403);
  assert.equal((await request(invite, { user: admin, body: { email: 'new@example.test' } })).status, 403);
  assert.equal((await request(invite, { user: admin, admin: true, body: { email: 'bad' } })).status, 400);
  emailConfigured = false;
  assert.equal((await request(invite, { user: admin, admin: true, body: { email: 'new@example.test' } })).status, 503);
  emailConfigured = true;
  failRegistrationInvitation = true;
  assert.equal((await request(invite, { user: admin, admin: true, body: { email: 'new@example.test' } })).status, 500);
  failRegistrationInvitation = false;
  assert.equal((await request(invite, { user: admin, admin: true, body: { email: 'new@example.test' } })).status, 202);
  assert.equal(sentRegistrationInvitations.at(-1).email, 'new@example.test');
  assert.equal((await db.query("SELECT id FROM app_users WHERE email = 'new@example.test'")).rows.length, 0);

  const path = `/api/admin/accounts/${target.user.id}/closure`;
  const body = { confirmed: true, reason: 'Traitement administratif documenté' };
  assert.equal((await request(path, { user: other, admin: true, body })).status, 403);
  assert.equal((await request(path, { user: admin, admin: true, body: { ...body, confirmed: false } })).status, 400);
  assert.equal((await request(`/api/admin/accounts/${admin.user.id}/closure`, { user: admin, admin: true, body })).status, 409);
  assert.equal((await request(path, { user: admin, admin: true, body })).status, 201);
  assert.equal((await request('/api/auth/me', { user: target })).status, 401);
  const row = (await db.query('SELECT initiated_by, initiation_reason FROM app_account_closure_requests WHERE user_id = $1', [target.user.id])).rows[0];
  assert.equal(row.initiated_by, admin.user.id);
  assert.equal(row.initiation_reason, body.reason);
  assert.equal((await request(path, { user: admin, admin: true, body })).status, 409);
  assert.equal((await request(`/api/admin/accounts/${target.user.id}`, { user: admin, admin: true, method: 'PATCH', body: { active: true } })).status, 409);
});

test('administrators invite establishments and create new associated accounts without granting journal access', async () => {
  const admin = await register('access-admin@example.test', 'senior');
  const owner = await register('access-company@example.test', 'establishment');
  const outsider = await register('access-outsider@example.test', 'aidant');
  const invite = '/api/admin/account-invitations';
  assert.equal((await request(invite, { user: admin, admin: true, body: { email: 'business@example.test', role: 'senior' } })).status, 400);
  assert.equal((await request(invite, { user: admin, admin: true, body: { email: 'business@example.test', role: 'establishment' } })).status, 202);
  assert.equal(sentRegistrationInvitations.at(-1).role, 'establishment');
  assert.match(sentRegistrationInvitations.at(-1).url, /\/app-mobile\.html#inscription$/);
  const path = `/api/admin/establishments/${owner.user.id}/accounts`;
  const body = { role: 'senior', confirmed: true, firstName: 'Camille', lastName: 'Test',
    birthDate: '1940-05-01', password: 'mot-provisoire-123' };
  assert.equal((await request(path, { user: outsider, admin: true, body })).status, 403);
  assert.equal((await request(path, { user: admin, body })).status, 403);
  assert.equal((await request(path, { user: admin, admin: true, body: { ...body, confirmed: false } })).status, 400);
  assert.equal((await request(path, { user: admin, admin: true, body: { ...body, role: 'aidant' } })).status, 400);
  assert.equal((await request(path, { user: admin, admin: true, body })).status, 403);
  assert.equal((await request(`/api/admin/establishments/${owner.user.id}/subscription`, {
    user: admin, admin: true, method: 'PATCH', body: { active: true }
  })).status, 200);
  const resident = await request(path, { user: admin, admin: true, body });
  assert.equal(resident.status, 201);
  assert.match(resident.data.identifier, /^[0-9a-f]{24}$/);
  const staff = await request(path, { user: admin, admin: true, body: { ...body, role: 'staff' } });
  assert.equal(staff.status, 201);
  assert.equal((await db.query('SELECT * FROM establishment_care_consent WHERE resident_user_id = $1', [resident.data.id])).rows.length, 0);
  assert.equal((await request('/api/establishment/residents', { user: owner })).data.residents[0].id, resident.data.id);
  assert.equal((await request('/api/establishment/staff', { user: owner })).data.staff[0].id, staff.data.id);
  const login = await request('/api/auth/resident-login', { body: { ...body, identifier: resident.data.identifier } });
  assert.equal(login.status, 200);
  assert.equal(login.data.user.passwordChangeRequired, true);
  assert.equal((await request('/api/care/entries', { user: login.data })).status, 403);
});

test('establishment profiles stay private and require manual subscription activation to edit', async () => {
  const admin = await register('establishment-admin@example.test', 'senior');
  const establishment = await register('establishment@example.test', 'establishment');
  const other = await register('other-establishment@example.test', 'establishment');
  const senior = await register('private-profile-senior@example.test', 'senior');
  const profile = {
    name: 'Résidence des Lilas', description: 'Présentation', address: '1 rue du Parc',
    phone: '0123456789', email: 'contact@example.test', tablet_interest: 'rental', tablet_quantity: 2
  };
  assert.equal((await request('/api/establishment', { user: establishment })).data.active, false);
  assert.equal((await request('/api/establishment', { user: establishment, method: 'PUT', body: profile })).status, 403);
  const person = { category: 'resident', name: 'Personne test', phone: '0123456789', email: 'personne@example.test' };
  assert.equal((await request('/api/establishment/contacts', { user: establishment, body: person })).status, 403);
  assert.equal((await request('/api/admin/establishments', { user: senior, admin: true })).status, 403);
  assert.equal((await request('/api/admin/establishments', { user: admin })).status, 403);
  assert.equal((await request('/api/notifications', { user: establishment })).status, 403);
  assert.equal((await request('/api/contacts', { user: senior, body: { email: 'establishment@example.test' } })).status, 404);
  assert.equal((await request('/api/contacts', { user: senior, body: { contactUserId: establishment.user.id } })).status, 404);
  const endpoint = `/api/admin/establishments/${establishment.user.id}`;
  assert.equal((await request(`${endpoint}/users`, { user: admin, admin: true, method: 'PATCH', body: { count: 25 } })).status, 200);
  assert.equal((await request(`${endpoint}/users`, { user: admin, admin: true, method: 'PATCH', body: { count: 0 } })).status, 400);
  assert.equal((await request(`${endpoint}/subscription`, { user: admin, admin: true, method: 'PATCH', body: { active: true } })).status, 200);
  assert.equal((await request('/api/establishment', { user: establishment, method: 'PUT', body: profile })).status, 200);
  const created = await request('/api/establishment/contacts', { user: establishment, body: person });
  assert.equal(created.status, 201);
  const contactPath = `/api/establishment/contacts/${created.data.id}`;
  assert.equal((await request(`/api/admin/establishments/${other.user.id}/subscription`, {
    user: admin, admin: true, method: 'PATCH', body: { active: true }
  })).status, 200);
  assert.equal((await request('/api/establishment/contacts', { user: other })).data.contacts.length, 0);
  assert.equal((await request('/api/establishment/contacts', { user: senior })).status, 403);
  assert.equal((await request(contactPath, { user: other, method: 'PUT', body: person })).status, 404);
  assert.equal((await request(contactPath, { user: establishment, method: 'PUT', body: { ...person, category: 'caregiver' } })).status, 200);
  assert.equal((await request('/api/establishment/contacts', { user: establishment })).data.contacts[0].category, 'caregiver');
  const worker = await request('/api/establishment/contacts', {
    user: establishment, body: { category: 'intervenant', name: 'Visiteur', phone: '', email: '' }
  });
  assert.equal(worker.status, 201);
  assert.equal((await request('/api/establishment/contacts', { user: establishment })).data.contacts.some(contact => contact.category === 'intervenant'), true);
  assert.equal((await request('/api/establishment', { user: other })).data.profile, null);
  assert.deepEqual((await request('/api/establishment', { user: establishment })).data.profile, profile);
  assert.equal((await request('/api/admin/establishments', { user: admin, admin: true })).data.establishments
    .find(item => item.id === establishment.user.id).user_count, 25);
  assert.equal((await request(`${endpoint}/subscription`, { user: admin, admin: true, method: 'PATCH', body: { active: false } })).status, 200);
  assert.equal((await request('/api/establishment', { user: establishment })).data.profile.name, profile.name);
  assert.equal((await request('/api/establishment', { user: establishment, method: 'PUT', body: profile })).status, 403);
  assert.equal((await request('/api/establishment/contacts', { user: establishment })).data.contacts.length, 2);
  assert.equal((await request(contactPath, { user: establishment, method: 'DELETE' })).status, 404);
  const closed = await request('/api/account/closure-request', {
    user: establishment, body: { password: 'a-test-password-123' }
  });
  assert.equal(closed.status, 200);
  assert.equal((await request('/api/establishment', { user: establishment })).status, 401);
  assert.equal((await db.query('SELECT * FROM establishment_profiles WHERE user_id = $1', [establishment.user.id])).rows.length, 0);
  assert.equal((await db.query('SELECT * FROM establishment_contacts WHERE user_id = $1', [establishment.user.id])).rows.length, 0);
});

test('director-created resident signs in without email and must change the temporary password', async () => {
  const admin = await register('establishment-admin-2@example.test', 'senior');
  const director = await register('resident-owner@example.test', 'establishment');
  const other = await register('resident-other@example.test', 'establishment');
  for (const owner of [director, other]) {
    assert.equal((await request(`/api/admin/establishments/${owner.user.id}/subscription`, {
      user: admin, admin: true, method: 'PATCH', body: { active: true }
    })).status, 200);
  }
  const details = { firstName: 'Camille', lastName: 'Exemple', birthDate: '1940-05-01', password: 'mot-provisoire-123' };
  const created = await request('/api/establishment/residents', { user: director, body: details });
  assert.equal(created.status, 201);
  assert.match(created.data.identifier, /^[0-9a-f]{24}$/);
  assert.equal((await request('/api/establishment/residents', { user: other })).data.residents.length, 0);
  const reset = `/api/establishment/residents/${created.data.id}/reset-password`;
  assert.equal((await request(reset, { user: other, body: { password: 'autre-provisoire-123' } })).status, 404);
  const credentials = { ...details, identifier: created.data.identifier };
  assert.equal((await request('/api/auth/resident-login', { body: { ...credentials, birthDate: '1941-05-01' } })).status, 401);
  const login = await request('/api/auth/resident-login', { body: credentials });
  assert.equal(login.status, 200);
  assert.equal(login.data.user.email, null);
  assert.equal(login.data.user.passwordChangeRequired, true);
  const resident = login.data;
  assert.equal((await request('/api/logs/all', { user: resident })).status, 403);
  assert.equal((await request('/api/auth/change-resident-password', {
    user: resident, body: { currentPassword: details.password, newPassword: 'nouveau-mot-de-passe-123' }
  })).status, 400);
  const changed = await request('/api/auth/change-resident-password', {
    user: resident, body: { currentPassword: details.password, newPassword: 'nouveau-mot-de-passe-123',
      acceptedTerms: true, acceptedTermsVersion: TERMS_VERSION }
  });
  assert.equal(changed.status, 200);
  assert.equal(changed.data.user.passwordChangeRequired, false);
  assert.equal((await request('/api/auth/me', { user: resident })).status, 401);
  assert.equal((await request('/api/auth/me', { user: changed.data })).status, 200);
  assert.equal((await request(reset, { user: director, body: { password: 'second-provisoire-123' } })).status, 200);
  assert.equal((await request('/api/auth/me', { user: changed.data })).status, 401);
  const relogin = await request('/api/auth/resident-login', { body: { ...credentials, password: 'second-provisoire-123' } });
  assert.equal(relogin.status, 200);
  assert.equal(relogin.data.user.passwordChangeRequired, true);
  for (let attempt = 0; attempt < 5; attempt++) {
    assert.equal((await request('/api/auth/resident-login', { body: { ...credentials, password: 'incorrect-password' } })).status, 401);
  }
  assert.equal((await request('/api/auth/resident-login', { body: { ...credentials, password: 'second-provisoire-123' } })).status, 401);
  await db.query("UPDATE establishment_resident_accounts SET locked_until = CURRENT_TIMESTAMP - INTERVAL '1 minute' WHERE resident_user_id = $1", [created.data.id]);
  assert.equal((await request('/api/auth/resident-login', { body: { ...credentials, password: 'second-provisoire-123' } })).status, 200);
});

test('establishment care requires consent and isolates staff, family messages and private notes', async () => {
  const adminLogin = await register('care-admin@example.test', 'senior');
  const owner = await register('care-owner@example.test', 'establishment');
  const outsider = await register('care-other-owner@example.test', 'establishment');
  for (const establishment of [owner, outsider]) {
    assert.equal((await request(`/api/admin/establishments/${establishment.user.id}/subscription`, {
      user: adminLogin, admin: true, method: 'PATCH', body: { active: true }
    })).status, 200);
  }
  const residentDetails = { firstName: 'Resident', lastName: 'Test', birthDate: '1945-01-02', password: 'temporary-password-123' };
  const staffDetails = { firstName: 'Staff', lastName: 'Test', birthDate: '1980-03-04', password: 'temporary-password-456' };
  const residentCreated = await request('/api/establishment/residents', { user: owner, body: residentDetails });
  const staffCreated = await request('/api/establishment/staff', { user: owner, body: staffDetails });
  const otherCreated = await request('/api/establishment/staff', { user: outsider, body: staffDetails });
  assert.equal(staffCreated.status, 201);
  async function activate(details, created) {
    const login = await request('/api/auth/resident-login', { body: { ...details, identifier: created.data.identifier } });
    assert.equal(login.status, 200);
    const changed = await request('/api/auth/change-resident-password', { user: login.data, body: {
      currentPassword: details.password, newPassword: 'a-different-password-456', acceptedTerms: true, acceptedTermsVersion: TERMS_VERSION
    } });
    assert.equal(changed.status, 200);
    return changed.data;
  }
  const resident = await activate(residentDetails, residentCreated);
  const staff = await activate(staffDetails, staffCreated);
  const otherStaff = await activate(staffDetails, otherCreated);
  const aidant = await register('care-family@example.test', 'aidant');
  const guardian = await register('care-guardian@example.test', 'aidant', true);
  await db.query("UPDATE app_users SET guardian_verification_status = 'approved' WHERE id = $1", [guardian.user.id]);
  assert.equal((await request(`/api/admin/accounts/${guardian.user.id}/senior-links`, {
    user: adminLogin, admin: true, body: { seniorUserId: resident.user.id }
  })).status, 201);
  await db.query(
    'INSERT INTO app_aidant_senior_links (aidant_user_id, senior_profile_id, linked_by) VALUES ($1, $2, $3)',
    [aidant.user.id, resident.user.seniorId, resident.user.id]
  );
  const residentId = resident.user.id;
  assert.equal((await request('/api/care/residents', { user: staff })).data.residents.length, 0);
  assert.equal((await request(`/api/care/entries?residentId=${residentId}`, { user: staff })).status, 403);
  assert.equal((await request('/api/care/consent', { user: aidant, seniorId: resident.user.seniorId, body: { consented: true } })).status, 403);
  assert.equal((await request('/api/care/consent', { user: resident })).data.establishment.decided, false);
  assert.equal((await request('/api/care/consent', { user: guardian, seniorId: resident.user.seniorId, body: { consented: true } })).status, 200);
  assert.equal((await request('/api/care/consent', { user: guardian, seniorId: resident.user.seniorId, body: { consented: false } })).status, 200);
  assert.equal((await request('/api/care/consent', { user: resident })).data.establishment.decided, true);
  assert.equal((await request('/api/care/consent', { user: resident, body: { consented: true } })).status, 200);
  assert.equal((await request('/api/care/residents', { user: staff })).data.residents.length, 1);
  assert.equal((await request(`/api/care/entries?residentId=${residentId}`, { user: otherStaff })).status, 403);
  assert.equal((await request('/api/care/entries', { user: staff, body: { residentId, kind: 'transmission', content: 'Transmission' } })).status, 400);
  assert.equal((await request('/api/care/entries', { user: staff, body: { residentId, kind: 'transmission', content: 'Transmission', nonMedical: true } })).status, 201);
  assert.equal((await request('/api/care/entries', { user: aidant, seniorId: resident.user.seniorId, body: { kind: 'message', content: 'Message privé', nonMedical: true } })).status, 201);
  assert.equal((await request('/api/care/entries', { user: staff, body: { residentId, kind: 'message', content: 'Réponse', nonMedical: true } })).status, 201);
  assert.equal((await request('/api/care/entries', { user: resident, body: { kind: 'message', content: 'Interdit', nonMedical: true } })).status, 400);
  assert.equal((await request('/api/care/entries', { user: aidant, seniorId: resident.user.seniorId, body: { kind: 'transmission', content: 'Interdit', nonMedical: true } })).status, 400);
  const residentEntries = await request('/api/care/entries', { user: resident });
  assert.deepEqual(residentEntries.data.entries.map(entry => entry.content), ['Transmission']);
  const familyEntries = await request('/api/care/entries', { user: aidant, seniorId: resident.user.seniorId });
  assert.equal(familyEntries.data.entries.length, 3);
  assert.equal((await request('/api/logs/all', { user: staff })).status, 403);
  assert.equal((await request('/api/care/entries', { user: adminLogin })).status, 403);
  assert.equal((await request(`/api/admin/establishments/${owner.user.id}/subscription`, {
    user: adminLogin, admin: true, method: 'PATCH', body: { active: false }
  })).status, 200);
  assert.equal((await request(`/api/care/entries?residentId=${residentId}`, { user: staff })).status, 403);
  assert.equal((await request(`/api/admin/establishments/${owner.user.id}/subscription`, {
    user: adminLogin, admin: true, method: 'PATCH', body: { active: true }
  })).status, 200);
  await db.query('UPDATE app_aidant_senior_links SET suspended_at = CURRENT_TIMESTAMP WHERE aidant_user_id = $1 AND senior_profile_id = $2',
    [aidant.user.id, resident.user.seniorId]);
  assert.equal((await request('/api/care/entries', { user: aidant, seniorId: resident.user.seniorId })).status, 403);
  assert.equal((await request('/api/care/consent', { user: resident, body: { consented: false } })).status, 200);
  assert.equal((await request(`/api/care/entries?residentId=${residentId}`, { user: staff })).status, 403);
  assert.equal((await request('/api/care/consent', { user: resident, body: { consented: true } })).status, 200);
  assert.equal((await request(`/api/establishment/staff/${staff.user.id}/disable`, { user: owner, body: {} })).status, 200);
  assert.equal((await request('/api/auth/me', { user: staff })).status, 401);
  assert.equal((await request('/api/account/closure-request', {
    user: resident, body: { password: 'a-different-password-456' }
  })).status, 200);
  assert.equal((await db.query('SELECT id FROM establishment_care_entries WHERE resident_user_id = $1', [residentId])).rows.length, 0);
  assert.equal((await db.query('SELECT id FROM establishment_care_audit WHERE resident_user_id = $1', [residentId])).rows.length, 0);
});

test('doctor recommendations cannot be added to liaison updates', async () => {
  const professional = await register('liaison-pro@example.test', 'pro');
  await db.query("UPDATE app_users SET verification_status = 'approved' WHERE id = $1", [professional.user.id]);
  const result = await request(`/api/planning/visits/${randomUUID()}/notes`, {
    user: professional,
    body: { type: 'doctor_recommendation', importance: 'information', content: 'Test' }
  });
  assert.equal(result.status, 400);
  assert.match(result.data.error, /nouvelles de liaison/);
});

test('iOS native push registration is rejected but existing registrations can be removed', async () => {
  const user = await register('ios-push-test@example.test', 'senior');
  const previous = delivery.isConfigured;
  delivery.isConfigured = () => ({ email: true, nativePush: true, webPush: true });
  try {
    const ios = await request('/api/notifications/push-subscriptions', {
      user, body: { platform: 'ios', token: 'apns-token' }
    });
    assert.equal(ios.status, 503);
    assert.match(ios.data.error, /iPhone.*pas encore disponibles/);
    const android = await request('/api/notifications/push-subscriptions', {
      user, body: { platform: 'android', token: 'fcm-token' }
    });
    assert.equal(android.status, 201);
    await db.query('INSERT INTO app_push_subscriptions (id, user_id, platform, token) VALUES ($1, $2, $3, $4)',
      [randomUUID(), user.user.id, 'ios', 'legacy-apns-token']);
    const removed = await request('/api/notifications/push-subscriptions', {
      user, method: 'DELETE', body: { platform: 'ios', token: 'legacy-apns-token' }
    });
    assert.equal(removed.status, 200);
    assert.equal(removed.data.registered, false);
  } finally {
    delivery.isConfigured = previous;
  }
});

test('visit comments stay private from seniors and are shared with authorized colleagues only by choice', async () => {
  const senior = await register('team-progress-senior@example.test', 'senior');
  const otherSenior = await register('team-progress-other-senior@example.test', 'senior');
  const aidant = await register('team-progress-aidant@example.test', 'aidant');
  const unrelatedAidant = await register('team-progress-unrelated-aidant@example.test', 'aidant');
  const own = await register('team-progress-own@example.test', 'pro');
  const colleague = await register('team-progress-colleague@example.test', 'pro');
  const stranger = await register('team-progress-stranger@example.test', 'pro');
  await db.query("UPDATE app_users SET verification_status = 'approved' WHERE id = ANY($1::uuid[])",
    [[own.user.id, colleague.user.id, stranger.user.id]]);
  const organization = randomUUID();
  const otherOrganization = randomUUID();
  const recipient = randomUUID();
  const otherRecipient = randomUUID();
  const otherOrganizationRecipient = randomUUID();
  await db.query(`INSERT INTO app_aidant_senior_links (aidant_user_id, senior_profile_id, linked_by)
    VALUES ($1, $2, $1)`, [aidant.user.id, senior.user.seniorId]);
  await db.query('INSERT INTO planning_organizations (id, name, coordinator_user_id) VALUES ($1, $2, $3)',
    [organization, 'Équipe fictive', own.user.id]);
  await db.query('INSERT INTO planning_organizations (id, name, coordinator_user_id) VALUES ($1, $2, $3)',
    [otherOrganization, 'Autre équipe fictive', colleague.user.id]);
  await db.query("INSERT INTO planning_org_members (organization_id, user_id, role) VALUES ($1, $2, 'professional')",
    [otherOrganization, colleague.user.id]);
  await db.query(`INSERT INTO planning_recipients (id, organization_id, senior_id, name, consent_at, created_by)
    VALUES ($1, $2, $3, 'Personne fictive', CURRENT_TIMESTAMP, $4)`,
  [otherOrganizationRecipient, otherOrganization, senior.user.seniorId, colleague.user.id]);
  for (const professional of [own, colleague, stranger]) {
    await db.query("INSERT INTO planning_org_members (organization_id, user_id, role) VALUES ($1, $2, 'professional')",
      [organization, professional.user.id]);
  }
  for (const [id, person] of [[recipient, senior], [otherRecipient, otherSenior]]) {
    await db.query(`INSERT INTO planning_recipients (id, organization_id, senior_id, name, consent_at, created_by)
      VALUES ($1, $2, $3, 'Personne fictive', CURRENT_TIMESTAMP, $4)`,
    [id, organization, person.user.seniorId, own.user.id]);
  }
  const ownVisit = randomUUID();
  const colleagueVisit = randomUUID();
  const otherVisit = randomUUID();
  const pendingVisit = randomUUID();
  const plannedVisit = randomUUID();
  const finishedVisit = randomUUID();
  const otherOrganizationVisit = randomUUID();
  await db.query(`INSERT INTO planning_visits
    (id, organization_id, recipient_id, assigned_user_id, scheduled_at, duration_minutes, visit_type, created_by, acceptance_status)
    VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, 30, 'Visite', $4, 'accepted')`,
  [otherOrganizationVisit, otherOrganization, otherOrganizationRecipient, colleague.user.id]);
  await db.query(`INSERT INTO planning_visit_events
    (id, visit_id, organization_id, recipient_id, user_id, event_type, practical_note, share_with_team)
    VALUES ($1, $2, $3, $4, $5, 'arrived', 'Autre équipe', TRUE)`,
  [randomUUID(), otherOrganizationVisit, otherOrganization, otherOrganizationRecipient, colleague.user.id]);
  for (const [id, personId, professional, status] of [
    [ownVisit, recipient, own, 'accepted'],
    [colleagueVisit, recipient, colleague, 'accepted'],
    [otherVisit, otherRecipient, colleague, 'accepted'],
    [pendingVisit, recipient, colleague, 'pending'],
    [plannedVisit, recipient, colleague, 'accepted'],
    [finishedVisit, recipient, colleague, 'accepted']
  ]) {
    await db.query(`INSERT INTO planning_visits
      (id, organization_id, recipient_id, assigned_user_id, scheduled_at, duration_minutes, visit_type, created_by, acceptance_status)
      VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, 30, 'Visite', $4, $5)`,
    [id, organization, personId, professional.user.id, status]);
  }
  await db.query("UPDATE planning_visits SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = $1", [finishedVisit]);
  for (const [visitId, personId, type, note] of [
    [colleagueVisit, recipient, 'arrived', 'Note privée'],
    [otherVisit, otherRecipient, 'started', 'Autre personne'],
    [pendingVisit, recipient, 'completed', 'Visite non acceptée'],
    [finishedVisit, recipient, 'completed', 'Note confidentielle']
  ]) {
    await db.query(`INSERT INTO planning_visit_events
      (id, visit_id, organization_id, recipient_id, user_id, event_type, practical_note)
      VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [randomUUID(), visitId, organization, personId, colleague.user.id, type, note]);
  }
  const progressPath = `/api/planning/visits/${colleagueVisit}/progress`;
  assert.equal((await request(progressPath, { user: colleague, body: {
    stage: 'started', note: 'Commentaire partagé', shareWithTeam: 'true'
  } })).status, 400);
  assert.equal((await request(progressPath, { user: colleague, body: {
    stage: 'started', note: 'Commentaire partagé', shareWithTeam: true
  } })).status, 200);
  const path = '/api/planning/today';
  assert.equal((await request(path)).status, 401);
  assert.equal((await request(path, { user: senior })).status, 403);
  assert.deepEqual((await request(path, { user: stranger })).data.visits, []);
  let response = await request(path, { user: own });
  assert.equal(response.status, 200);
  assert.equal(response.data.visits.length, 1);
  const shared = response.data.visits[0].teamProgress;
  assert.equal(shared.length, 3);
  assert.deepEqual(new Set(shared.map(item => item.type)), new Set(['arrived', 'started', 'completed']));
  assert.deepEqual(Object.keys(shared[0]).sort(), ['createdAt', 'note', 'type']);
  assert.equal(shared.find(item => item.type === 'arrived').note, null);
  assert.equal(shared.find(item => item.type === 'started').note, 'Commentaire partagé');
  assert.doesNotMatch(JSON.stringify(shared), /Note privée|Autre personne|Visite non acceptée|Note confidentielle|Autre équipe/);
  const seniorFollowing = await request('/api/planning/following', { user: senior });
  const aidantFollowing = await request('/api/planning/following', { user: aidant, seniorId: senior.user.seniorId });
  assert.equal((await request('/api/planning/following', { user: unrelatedAidant, seniorId: senior.user.seniorId })).status, 403);
  const seniorProgress = seniorFollowing.data.visits.find(item => item.id === colleagueVisit).progress;
  const aidantProgress = aidantFollowing.data.visits.find(item => item.id === colleagueVisit).progress;
  assert.ok(seniorProgress.every(item => item.note === null));
  assert.equal(aidantProgress.find(item => item.type === 'arrived').note, 'Note privée');
  assert.equal(aidantProgress.find(item => item.type === 'started').note, 'Commentaire partagé');
  const visits = response.data.visits[0].teamVisits;
  assert.equal(visits.length, 3);
  assert.deepEqual(new Set(visits.map(item => item.status)), new Set(['planned', 'in_progress', 'completed']));
  assert.deepEqual(Object.keys(visits[0]).sort(), ['scheduledAt', 'status']);
  await db.query('DELETE FROM planning_org_members WHERE organization_id = $1 AND user_id = $2',
    [organization, colleague.user.id]);
  response = await request(path, { user: own });
  assert.deepEqual(response.data.visits[0].teamProgress, []);
  assert.deepEqual(response.data.visits[0].teamVisits, []);
  await db.query('UPDATE planning_recipients SET consent_revoked_at = CURRENT_TIMESTAMP WHERE id = $1', [recipient]);
  assert.deepEqual((await request(path, { user: own })).data.visits, []);
});

test('weather requires a valid session and valid coordinates and reports missing configuration', async () => {
  const senior = await register('weather-senior@example.test', 'senior');
  const aidant = await register('weather-aidant@example.test', 'aidant');
  const coordinates = { latitude: 48.86, longitude: 2.35 };
  assert.equal((await request('/api/weather', { body: coordinates })).status, 401);
  assert.equal((await request('/api/weather', { user: { token: 'a'.repeat(64) }, body: coordinates })).status, 401);
  assert.equal((await request('/api/weather', { user: senior, body: { latitude: 91, longitude: 2 } })).status, 400);
  for (const user of [senior, aidant]) {
    const response = await request('/api/weather', { user, body: coordinates });
    assert.equal(response.status, 503);
    assert.match(response.data.error, /pas encore configurée/);
  }
});

test('weather location is private, durable, validated, migrates once and is erased on closure', async () => {
  const senior = await register('weather-location@example.test', 'senior');
  const other = await register('weather-location-other@example.test', 'aidant');
  const professional = await register('weather-location-pro@example.test', 'pro');
  const location = { name: 'Lyon', latitude: 45.76, longitude: 4.84 };
  const put = (user, body) => request('/api/weather/location', { user, body, method: 'PUT' });
  assert.equal((await put(null, { location })).status, 401);
  assert.equal((await put({ token: 'a'.repeat(64) }, { location })).status, 401);
  assert.equal((await put(professional, { location })).status, 403);
  assert.equal((await put(senior, { location: { ...location, latitude: 91 } })).status, 400);
  assert.equal((await put(senior, {})).status, 400);
  assert.deepEqual((await put(senior, { location, migrate: true })).data.location, location);
  assert.deepEqual((await request('/api/auth/me', { user: senior })).data.user.weatherCommune, location);
  const login = await request('/api/auth/login', { body: { email: 'weather-location@example.test', password: 'a-test-password-123' } });
  assert.deepEqual(login.data.user.weatherCommune, location);
  assert.equal((await request('/api/auth/me', { user: other })).data.user.weatherCommune, null);
  assert.deepEqual((await put(senior, { location: { ...location, name: 'Paris' }, migrate: true })).data.location, location);
  assert.equal((await put(senior, { location: null })).data.location, null);
  assert.equal((await put(senior, { location, migrate: true })).data.location, null);
  assert.equal((await request('/api/auth/me', { user: senior })).data.user.weatherCommuneConfigured, true);
  await put(senior, { location });
  assert.equal((await request('/api/account/closure-request', { user: senior, body: { password: 'a-test-password-123' } })).status, 200);
  const saved = await db.query('SELECT weather_commune_name, weather_commune_latitude, weather_commune_longitude, weather_commune_updated_at FROM app_users WHERE id = $1', [senior.user.id]);
  assert.ok(Object.values(saved.rows[0]).every(value => value === null));
});

test('account municipality is required, private, validated and cleared on account closure', async () => {
  const accountCommune = { name: 'Lyon', code: '69123', latitude: 45.76, longitude: 4.84 };
  const base = {
    name: 'Compte météo', email: 'account-weather@example.test', password: 'a-test-password-123',
    role: 'senior', acceptedTerms: true, acceptedTermsVersion: TERMS_VERSION, requireAccountCommune: true
  };
  const invalid = await request('/api/auth/register', {
    body: { ...base, email: 'invalid-weather@example.test', accountCommune: { ...accountCommune, latitude: 91 } }
  });
  assert.equal(invalid.status, 400);
  assert.equal((await request('/api/auth/register', { body: base })).status, 400);
  const created = await request('/api/auth/register', { body: { ...base, accountCommune } });
  assert.equal(created.status, 201);
  assert.deepEqual(created.data.user.accountCommune, accountCommune);
  const user = created.data;
  assert.deepEqual((await request('/api/auth/me', { user })).data.user.accountCommune, accountCommune);
  const login = await request('/api/auth/login', { body: { email: base.email, password: base.password } });
  assert.equal(login.status, 200);
  assert.deepEqual(login.data.user.accountCommune, accountCommune);
  const other = await register('other-weather@example.test', 'aidant');
  assert.equal((await request('/api/auth/me', { user: other })).data.user.accountCommune.name, 'Paris');
  assert.equal((await request('/api/account/closure-request', { user, body: { password: base.password } })).status, 200);
  const saved = await db.query(
    'SELECT account_commune_name, account_commune_code, account_commune_latitude, account_commune_longitude FROM app_users WHERE id = $1',
    [user.user.id]
  );
  assert.ok(Object.values(saved.rows[0]).every(value => value === null));
  const legacy = await request('/api/auth/register', {
    body: { ...base, email: 'legacy-weather@example.test', requireAccountCommune: undefined }
  });
  assert.equal(legacy.status, 201);
  assert.equal(legacy.data.user.accountCommune, null);
});

test('technical alerts require repeated server errors and deduplicate across processes', async () => {
  const admin = await register('alerts-admin@example.test', 'senior');
  const pool = { async connect() { return { query: db.query.bind(db), release() {} }; } };
  const monitor = createSiteMonitor();
  const sent = [];
  const notify = async (client, id, type, title, message, entityType, entityId) => {
    sent.push({ id, type, title, message, entityType, entityId });
  };
  const emails = new Set(['alerts-admin@example.test']);
  const now = new Date('2026-01-01T10:00:00Z');
  monitor.record(500, 'messagerie');
  monitor.record(503, 'messagerie');
  monitor.record(403, 'messagerie');
  assert.equal(await createSiteAlerts(pool, monitor, emails, notify, now), 0);
  monitor.record(502, 'messagerie');
  assert.equal(await createSiteAlerts(pool, monitor, emails, notify, now), 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].id, admin.user.id);
  assert.equal(sent[0].type, 'site_error_alert');
  assert.match(sent[0].message, /messagerie/);
  assert.doesNotMatch(JSON.stringify(sent), /private|@|\/api\//);
  const secondProcess = createSiteMonitor();
  for (let i = 0; i < 3; i++) secondProcess.record(500, 'messagerie');
  assert.equal(await createSiteAlerts(pool, secondProcess, emails, notify, new Date('2026-01-01T10:29:00Z')), 0);
  assert.equal(await createSiteAlerts(pool, secondProcess, emails, notify, new Date('2026-01-01T10:30:00Z')), 1);
  const failingMonitor = createSiteMonitor();
  for (let i = 0; i < 3; i++) failingMonitor.record(500, 'agenda');
  await assert.rejects(createSiteAlerts(pool, failingMonitor, emails, async () => {
    throw new Error('Insertion impossible');
  }, now), /Insertion impossible/);
  assert.equal((await db.query("SELECT area FROM app_site_alert_state WHERE area = 'agenda'")).rows.length, 0);
  assert.equal(await createSiteAlerts(pool, failingMonitor, emails, notify, now), 1);
  await assert.rejects(createSiteAlerts(pool, secondProcess, new Set(['unknown@example.test']), notify),
    /Aucun compte administrateur actif/);
});

test('site diagnostics are restricted to administrators and share only anonymous counts', async () => {
  const admin = await register('monitor-admin@example.test', 'senior');
  const senior = await register('monitor-senior@example.test', 'senior');
  const path = '/api/admin/site-monitor';
  assert.equal((await request(path)).status, 401);
  assert.equal((await request(path, { user: senior, admin: true })).status, 403);
  assert.equal((await request(path, { user: admin })).status, 403);
  assert.equal((await request('/api/messages/private-identifier')).status, 401);
  const metrics = await request(path, { user: admin, admin: true });
  assert.ok(metrics.data.byArea.messagerie.clientErrors >= 1);
  assert.doesNotMatch(JSON.stringify(metrics.data), /private-identifier/);
  assert.equal((await request(`${path}/review`, { user: admin, admin: true, body: {} })).status, 400);
  const originalFetch = global.fetch;
  const oldKey = process.env.OPENAI_API_KEY;
  let payload;
  global.fetch = async (url, options) => {
    if (url === 'https://api.openai.com/v1/responses') {
      payload = JSON.parse(options.body);
      return new Response(JSON.stringify({ output_text: 'Vérifier les journaux techniques.' }), { status: 200 });
    }
    return originalFetch(url, options);
  };
  process.env.OPENAI_API_KEY = 'test-key';
  try {
    const result = await request(`${path}/review`, {
      user: admin, admin: true, body: { confirmed: true, privateText: 'Ne pas transmettre' }
    });
    assert.equal(result.status, 200);
    assert.equal(result.data.review, 'Vérifier les journaux techniques.');
    assert.equal(payload.store, false);
    assert.deepEqual(JSON.parse(payload.input[0].content), result.data.metrics);
    assert.deepEqual(Object.keys(result.data.metrics).sort(),
      ['byArea', 'clientErrors', 'observedSince', 'requests', 'serverErrors', 'windowMinutes']);
    assert.deepEqual(Object.keys(result.data.metrics.byArea).sort(),
      ['agenda', 'annuaire', 'autres', 'connexion', 'messagerie', 'notifications']);
    assert.doesNotMatch(JSON.stringify(payload), /Ne pas transmettre|monitor-senior/);
  } finally {
    global.fetch = originalFetch;
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldKey;
  }
});

test('message writing assistance requires explicit confirmation and never sends the draft', async () => {
  const senior = await register('rewrite-senior@example.test', 'senior');
  const aidant = await register('rewrite-aidant@example.test', 'aidant');
  const originalFetch = global.fetch;
  const oldKey = process.env.OPENAI_API_KEY;
  let sentPayload;
  global.fetch = async (url, options) => {
    if (url === 'https://api.openai.com/v1/responses') {
      sentPayload = JSON.parse(options.body);
      return new Response(JSON.stringify({ output_text: 'Bonjour, comment allez-vous ?' }), { status: 200 });
    }
    return originalFetch(url, options);
  };
  process.env.OPENAI_API_KEY = 'test-key';
  try {
    const path = '/api/messages/rewrite';
    assert.equal((await request(path, { user: aidant, body: { message: 'Bonjour', confirmed: true } })).status, 403);
    assert.equal((await request(path, { user: senior, body: { message: 'Bonjour' } })).status, 400);
    assert.equal((await request(path, { user: senior, body: { message: 'a'.repeat(2001), confirmed: true } })).status, 400);
    await db.query('UPDATE app_ai_settings SET enabled = FALSE WHERE id = 1');
    assert.equal((await request(path, { user: senior, body: { message: 'Bonjour', confirmed: true } })).status, 503);
    await db.query('UPDATE app_ai_settings SET enabled = TRUE WHERE id = 1');
    const result = await request(path, { user: senior, body: { message: 'Bonjour, ça va ?', confirmed: true } });
    assert.equal(result.status, 200);
    assert.equal(result.data.suggestion, 'Bonjour, comment allez-vous ?');
    assert.equal(sentPayload.store, false);
    assert.deepEqual(sentPayload.input, [{ role: 'user', content: 'Bonjour, ça va ?' }]);
    assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM app_private_messages')).rows[0].count, 0);
  } finally {
    global.fetch = originalFetch;
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldKey;
    await db.query('UPDATE app_ai_settings SET enabled = TRUE WHERE id = 1');
  }
});

test('weekly family notes exclude other records and profiles and report truncation', async () => {
  const senior = await register('weekly-senior@example.test', 'senior');
  const aidant = await register('weekly-aidant@example.test', 'aidant');
  const unlinked = await register('weekly-unlinked@example.test', 'aidant');
  const stranger = await register('weekly-stranger@example.test', 'senior');
  const pro = await register('weekly-pro@example.test', 'pro');
  const seniorId = senior.user.seniorId;
  await db.query(`INSERT INTO app_aidant_senior_links (aidant_user_id, senior_profile_id, linked_by)
    VALUES ($1, $2, $1)`, [aidant.user.id, seniorId]);
  await db.query(`INSERT INTO app_logs (senior_id, author_id, content, log_type, created_at)
    SELECT $1, 2, 'Nouvelle ' || n, 'family_note', CURRENT_TIMESTAMP
    FROM generate_series(1, 105) n`, [seniorId]);
  await db.query(`INSERT INTO app_logs (senior_id, author_id, content, log_type, created_at)
    SELECT $1, 3, 'Transmission', 'medical_report', CURRENT_TIMESTAMP
    FROM generate_series(1, 101)`, [seniorId]);
  await db.query(`INSERT INTO app_logs (senior_id, author_id, content, log_type, created_at)
    VALUES ($1, 2, 'Ancienne', 'family_note', CURRENT_TIMESTAMP - INTERVAL '8 days'),
           ($1, 2, 'Future', 'family_note', CURRENT_TIMESTAMP + INTERVAL '2 days'),
           ($2, 1, 'Autre profil', 'family_note', CURRENT_TIMESTAMP)`, [seniorId, stranger.user.seniorId]);
  await db.query(`INSERT INTO app_logs (senior_id, author_id, content, log_type, created_at)
    VALUES ($1, 2, 'Début semaine', 'family_note',
              (((CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Paris')::date - 6)::timestamp AT TIME ZONE 'Europe/Paris')),
           ($1, 2, 'Avant semaine', 'family_note',
              (((CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Paris')::date - 6)::timestamp AT TIME ZONE 'Europe/Paris') - INTERVAL '1 second')`, [seniorId]);

  assert.equal((await request('/api/logs/weekly-family')).status, 401);
  assert.equal((await request('/api/logs/weekly-family', { user: pro })).status, 403);
  assert.equal((await request('/api/logs/weekly-family', { user: unlinked, seniorId })).status, 403);
  const response = await request('/api/logs/weekly-family', { user: aidant, seniorId });
  assert.equal(response.status, 200);
  assert.equal(response.data.notes.length, 106);
  assert.equal(response.data.truncated, false);
  assert.ok(response.data.notes.some(note => note.content === 'Début semaine'));
  assert.ok(response.data.notes.every(note => note.log_type === 'family_note' && (note.content.startsWith('Nouvelle ') || note.content === 'Début semaine')));
  assert.match(response.data.start, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(response.data.end, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal((Date.parse(response.data.end) - Date.parse(response.data.start)) / 86400000, 6);
  assert.equal((await request('/api/logs/weekly-family', { user: stranger })).data.notes.length, 1);
  await db.query(`INSERT INTO app_logs (senior_id, author_id, content, log_type)
    SELECT $1, 2, 'Nouvelle supplémentaire', 'family_note' FROM generate_series(1, 894)`, [seniorId]);
  assert.equal((await request('/api/logs/weekly-family', { user: senior })).data.truncated, false);
  await db.query(`INSERT INTO app_logs (senior_id, author_id, content, log_type)
    VALUES ($1, 2, 'Dernière nouvelle', 'family_note')`, [seniorId]);
  const truncated = await request('/api/logs/weekly-family', { user: senior });
  assert.equal(truncated.data.notes.length, 1000);
  assert.equal(truncated.data.truncated, true);
  await db.query('UPDATE app_aidant_senior_links SET suspended_at = CURRENT_TIMESTAMP WHERE aidant_user_id = $1 AND senior_profile_id = $2', [aidant.user.id, seniorId]);
  assert.equal((await request('/api/logs/weekly-family', { user: aidant, seniorId })).status, 403);
});

test('journal attributes authenticated authors and pages privately through equal timestamps', async () => {
  const senior = await register('journal-author-senior@example.test', 'senior');
  const other = await register('journal-author-other@example.test', 'senior');
  const aidant = await register('journal-author-aidant@example.test', 'aidant');
  const seniorId = senior.user.seniorId;
  await db.query(`INSERT INTO app_aidant_senior_links (aidant_user_id, senior_profile_id, linked_by)
    VALUES ($1, $2, $1)`, [aidant.user.id, seniorId]);
  await db.query(`INSERT INTO app_logs (senior_id, author_id, content, log_type, created_at)
    SELECT $1, 2, 'Ancienne ' || n, 'family_note', '2020-01-01T10:00:00Z'::timestamptz
    FROM generate_series(1, 101) n`, [seniorId]);
  const foreign = await db.query(`INSERT INTO app_logs (senior_id, author_id, content, log_type)
    VALUES ($1, 1, 'Autre carnet', 'family_note') RETURNING id`, [other.user.seniorId]);
  const created = await request('/api/logs', {
    user: aidant, seniorId, body: { content: 'Nouvelle authentifiée', log_type: 'family_note', author_user_id: other.user.id }
  });
  assert.equal(created.status, 201);
  const first = await request('/api/logs/all', { user: aidant, seniorId });
  assert.equal(first.status, 200);
  assert.equal(first.data.length, 100);
  assert.equal(first.data[0].author_name, aidant.user.name);
  assert.equal(first.data[1].author_name, null);
  assert.equal(first.data[1].author_id, 2);
  const next = await request(`/api/logs/all?before=${first.data[99].id}`, { user: aidant, seniorId });
  assert.equal(next.status, 200);
  assert.equal(next.data.length, 2);
  assert.equal(new Set([...first.data, ...next.data].map(item => String(item.id))).size, 102);
  assert.ok(next.data.every(item => item.author_name === null));
  assert.equal((await request(`/api/logs/all?before=${foreign.rows[0].id}`, { user: aidant, seniorId })).status, 400);
  for (const cursor of ['-1', '0', '1.1', '9223372036854775808', 'abc']) {
    assert.equal((await request(`/api/logs/all?before=${cursor}`, { user: aidant, seniorId })).status, 400);
  }
  const weekly = await request('/api/logs/weekly-family', { user: senior });
  assert.equal(weekly.data.notes.find(note => note.content === 'Nouvelle authentifiée').author_name, aidant.user.name);
  const video = await request('/api/video/urgency', { user: aidant, seniorId, body: {} });
  assert.equal(video.status, 201);
  const videoLog = await db.query('SELECT author_user_id FROM app_logs WHERE senior_id = $1 AND content = $2',
    [seniorId, `Demande d’appel vidéo urgent : ${video.data.url}`]);
  assert.equal(videoLog.rows[0].author_user_id, aidant.user.id);
  await db.query('UPDATE app_aidant_senior_links SET suspended_at = CURRENT_TIMESTAMP WHERE aidant_user_id = $1 AND senior_profile_id = $2', [aidant.user.id, seniorId]);
  assert.equal((await request(`/api/logs/all?before=${first.data[99].id}`, { user: aidant, seniorId })).status, 403);
  assert.equal((await request('/api/account/closure-request', {
    user: aidant, body: { password: 'a-test-password-123' }
  })).status, 200);
  const stored = await db.query('SELECT author_user_id FROM app_logs WHERE id = $1', [created.data.id]);
  assert.equal(stored.rows[0].author_user_id, null);
  const erased = await db.query('SELECT author_user_id FROM app_logs WHERE senior_id = $1 AND content = $2',
    [seniorId, `Demande d’appel vidéo urgent : ${video.data.url}`]);
  assert.equal(erased.rows[0].author_user_id, null);
  const afterClosure = await request('/api/logs/all', { user: senior });
  assert.equal(afterClosure.data.find(note => note.content === 'Nouvelle authentifiée').author_name, null);
});

test('family photos require senior approval, active links and remain private between profiles', async () => {
  const senior = await register('album-senior@example.test', 'senior');
  const aidant = await register('album-aidant@example.test', 'aidant');
  const other = await register('album-other@example.test', 'aidant');
  const stranger = await register('album-stranger@example.test', 'senior');
  const seniorId = senior.user.seniorId;
  await db.query(`INSERT INTO app_aidant_senior_links (aidant_user_id, senior_profile_id, linked_by)
    VALUES ($1, $2, $1), ($3, $2, $3)`, [aidant.user.id, seniorId, other.user.id]);
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lX4AAAAASUVORK5CYII=', 'base64');
  const headers = user => ({
    Authorization: `Bearer ${user.token}`,
    ...(user.user.role === 'aidant' ? { 'X-Senior-Profile-Id': seniorId } : {})
  });
  const upload = (user, body = image) => fetch(`${baseUrl}/api/family-album`, {
    method: 'POST', headers: { ...headers(user), 'Content-Type': 'image/png' }, body
  });
  assert.equal((await upload(aidant, Buffer.from('not an image'))).status, 400);
  assert.equal((await upload(aidant, Buffer.alloc(2 * 1024 * 1024 + 1))).status, 413);
  const response = await upload(aidant);
  assert.equal(response.status, 201);
  const photo = await response.json();
  assert.equal(photo.approved, false);
  const pendingAlbum = await request('/api/family-album', { user: aidant, seniorId });
  assert.equal(pendingAlbum.data.photos[0].authorRole, 'aidant');
  const path = `/api/family-album/${photo.id}/photo`;
  assert.equal((await request('/api/family-album', { user: other, seniorId })).data.photos.length, 0);
  assert.equal((await fetch(`${baseUrl}${path}`, { headers: headers(other) })).status, 404);
  assert.equal((await fetch(`${baseUrl}${path}`, { headers: headers(stranger) })).status, 404);
  assert.equal((await request(`/api/family-album/${photo.id}/approve`, { user: aidant, seniorId, body: {} })).status, 403);
  assert.equal((await request(`/api/family-album/${photo.id}/approve`, { user: senior, body: {} })).status, 200);
  const shared = await fetch(`${baseUrl}${path}`, { headers: headers(other) });
  assert.equal(shared.status, 200);
  assert.equal(shared.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(Buffer.from(await shared.arrayBuffer()), image);
  assert.equal((await request(`/api/family-album/${photo.id}`, { user: other, seniorId, method: 'DELETE' })).status, 404);
  await db.query('UPDATE app_aidant_senior_links SET suspended_at = CURRENT_TIMESTAMP WHERE aidant_user_id = $1 AND senior_profile_id = $2', [other.user.id, seniorId]);
  assert.equal((await fetch(`${baseUrl}${path}`, { headers: headers(other) })).status, 403);
  assert.equal((await request(`/api/family-album/${photo.id}`, { user: senior, method: 'DELETE' })).status, 200);
  assert.equal((await fetch(`${baseUrl}${path}`, { headers: headers(aidant) })).status, 404);
  const next = await (await upload(senior)).json();
  assert.equal(next.approved, true);
  await db.query(
    `INSERT INTO app_family_photos (id, senior_profile_id, author_user_id, content_type, file_data, approved)
     SELECT gen_random_uuid(), $1, $2, 'image/png', $3, TRUE FROM generate_series(1, 49)`,
    [seniorId, senior.user.id, image]
  );
  assert.equal((await upload(senior)).status, 409);
  assert.equal((await request('/api/account/closure-request', {
    user: senior, body: { password: 'a-test-password-123' }
  })).status, 200);
  assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM app_family_photos WHERE senior_profile_id = $1', [seniorId])).rows[0].count, 0);
});

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

test('key contacts are private to the senior and active caregivers, validated and removed on senior closure', async () => {
  const senior = await register('key-senior@example.test', 'senior');
  const other = await register('key-other@example.test', 'senior');
  const aidant = await register('key-aidant@example.test', 'aidant');
  const stranger = await register('key-stranger@example.test', 'aidant');
  const professional = await register('key-pro@example.test', 'pro');
  const options = { user: aidant, seniorId: senior.user.seniorId };
  const body = { name: '  Marie  ', description: '  Voisine ', phone: '+33 1 23-45.67.89' };
  assert.equal((await request('/api/key-contacts')).status, 401);
  assert.equal((await request('/api/key-contacts', { user: professional })).status, 403);
  assert.equal((await request('/api/key-contacts', options)).status, 403);
  await db.query(`INSERT INTO app_aidant_senior_links (aidant_user_id, senior_profile_id, linked_by)
    VALUES ($1, $2, $1), ($1, $3, $1)`, [aidant.user.id, senior.user.seniorId, other.user.seniorId]);
  for (const phone of ['javascript:123', '12', '123#456', '+123+456', '+33 (0)1 23 45 67 89']) {
    assert.equal((await request('/api/key-contacts', { user: senior, body: { ...body, phone } })).status, 400);
  }
  assert.equal((await request('/api/key-contacts', { user: senior, body: { ...body, name: ' ' } })).status, 400);
  const created = await request('/api/key-contacts', { user: senior, body });
  assert.equal(created.status, 201);
  const id = created.data.id;
  assert.deepEqual((await request('/api/key-contacts', options)).data.contacts,
    [{ id, name: 'Marie', description: 'Voisine', phone: '+33123456789' }]);
  assert.deepEqual((await request('/api/key-contacts', { user: aidant, seniorId: other.user.seniorId })).data.contacts, []);
  assert.equal((await request(`/api/key-contacts/${id}`, {
    user: aidant, seniorId: other.user.seniorId, method: 'DELETE'
  })).status, 404);
  assert.equal((await request('/api/key-contacts', { user: stranger, seniorId: senior.user.seniorId })).status, 403);
  const aidantCreated = await request('/api/key-contacts', { ...options, body });
  assert.equal(aidantCreated.status, 201);
  assert.equal((await request(`/api/key-contacts/${aidantCreated.data.id}`, { ...options, method: 'DELETE' })).status, 200);
  await db.query(`UPDATE app_aidant_senior_links SET suspended_at = CURRENT_TIMESTAMP
    WHERE aidant_user_id = $1 AND senior_profile_id = $2`, [aidant.user.id, senior.user.seniorId]);
  assert.equal((await request('/api/key-contacts', options)).status, 403);
  assert.equal((await request(`/api/key-contacts/${id}`, { ...options, method: 'DELETE' })).status, 403);
  assert.equal((await request('/api/account/closure-request', {
    user: senior, body: { password: 'a-test-password-123' }
  })).status, 200);
  const remaining = await db.query('SELECT id FROM app_key_contacts WHERE senior_id = $1', [senior.user.seniorId]);
  assert.equal(remaining.rows.length, 0);
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
      assigned: false, assignedToMe: false, assignedToProfessional: null, assigneeName: null }]);
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

test('shared task assignment only targets active associated accounts and does not overwrite assignments', async () => {
  const senior = await register('assign-senior@example.test', 'senior');
  const other = await register('assign-other@example.test', 'senior');
  const aidant = await register('assign-aidant@example.test', 'aidant');
  const second = await register('assign-second@example.test', 'aidant');
  const stranger = await register('assign-stranger@example.test', 'aidant');
  const guardian = await register('assign-guardian@example.test', 'aidant', true);
  const pro = await register('assign-pro@example.test', 'pro');
  for (const user of [aidant, second, guardian]) {
    await db.query(`INSERT INTO app_aidant_senior_links (aidant_user_id, senior_profile_id, linked_by)
      VALUES ($1, $2, $1)`, [user.user.id, senior.user.seniorId]);
  }
  const opts = { user: aidant, seniorId: senior.user.seniorId };
  const assignees = await request('/api/shared-tasks/assignees', opts);
  assert.equal(assignees.status, 200);
  assert.deepEqual(new Set(assignees.data.assignees.map(person => person.id)),
    new Set([senior.user.id, aidant.user.id, second.user.id]));
  assert.equal((await request('/api/shared-tasks/assignees', { user: stranger, seniorId: senior.user.seniorId })).status, 403);
  const id = (await request('/api/shared-tasks', { user: senior, body: { title: 'Courses' } })).data.id;
  const path = `/api/shared-tasks/${id}/assign`;
  const assign = (user, assigneeId, seniorId = senior.user.seniorId) =>
    request(path, { user, seniorId, body: { assigneeId } });
  assert.equal((await assign(aidant, 'bad-id')).status, 400);
  for (const user of [stranger, guardian, pro, other]) {
    assert.equal((await assign(aidant, user.user.id)).status, 403);
  }
  assert.equal((await assign(stranger, second.user.id)).status, 403);
  assert.equal((await assign(aidant, second.user.id)).status, 200);
  assert.equal((await assign(aidant, aidant.user.id)).status, 409);
  let task = (await request('/api/shared-tasks', { user: second, seniorId: senior.user.seniorId })).data.tasks[0];
  assert.equal(task.assignedToMe, true);
  assert.equal(task.assigneeName, second.user.name);
  assert.equal((await request(`/api/shared-tasks/${id}/claim`, {
    user: second, seniorId: senior.user.seniorId, method: 'DELETE'
  })).status, 200);
  await db.query(`UPDATE app_aidant_senior_links SET suspended_at = CURRENT_TIMESTAMP
    WHERE aidant_user_id = $1 AND senior_profile_id = $2`, [second.user.id, senior.user.seniorId]);
  assert.equal((await assign(aidant, second.user.id)).status, 403);
  assert.equal((await assign(aidant, senior.user.id)).status, 200);
  assert.equal((await request(`/api/shared-tasks/${id}/claim`, { user: senior, method: 'DELETE' })).status, 200);
  assert.equal((await request(`/api/shared-tasks/${id}`, {
    user: senior, method: 'PATCH', body: { completed: true }
  })).status, 200);
  assert.equal((await assign(aidant, aidant.user.id)).status, 409);
  task = (await request('/api/shared-tasks', opts)).data.tasks[0];
  assert.equal(task.assigned, false);
});

test('a senior shopping list remains private until a copy is sent', async () => {
  const senior = await register('shopping-senior@example.test', 'senior');
  const other = await register('shopping-other@example.test', 'senior');
  const aidant = await register('shopping-aidant@example.test', 'aidant');
  await db.query(`INSERT INTO app_aidant_senior_links (aidant_user_id, senior_profile_id, linked_by)
    VALUES ($1, $2, $1)`, [aidant.user.id, senior.user.seniorId]);
  assert.equal((await request('/api/shopping-list')).status, 401);
  assert.equal((await request('/api/shopping-list', { user: aidant, seniorId: senior.user.seniorId })).status, 403);
  assert.equal((await request('/api/shopping-list', { user: senior, method: 'PUT', body: { content: 'x'.repeat(1801) } })).status, 400);
  assert.equal((await request('/api/shopping-list', { user: senior, method: 'PUT', body: { content: 'Pain\nPommes' } })).status, 200);
  assert.equal((await request('/api/shopping-list', { user: senior })).data.content, 'Pain\nPommes');
  assert.equal((await request('/api/shopping-list', { user: other })).data.content, '');
  const sent = await request('/api/messages/multiple', { user: senior, body: {
    recipients: [aidant.user.id], message: 'Liste de courses :\nPain\nPommes'
  } });
  assert.equal(sent.status, 201);
  assert.equal((await request('/api/shopping-list', { user: senior, method: 'PUT', body: { content: 'Lait' } })).status, 200);
  const messages = await request(`/api/messages/${senior.user.id}`, { user: aidant });
  assert.equal(messages.data.messages[0].body, 'Liste de courses :\nPain\nPommes');
  assert.equal((await request('/api/account/closure-request', {
    user: senior, body: { password: 'a-test-password-123' }
  })).status, 200);
  assert.equal((await db.query('SELECT user_id FROM app_shopping_lists WHERE user_id = $1', [senior.user.id])).rows.length, 0);
});

test('only tasks explicitly assigned to an available saved professional are shared', async () => {
  const senior = await register('professional-tasks-senior@example.test', 'senior');
  const other = await register('professional-tasks-other@example.test', 'senior');
  const aidant = await register('professional-tasks-aidant@example.test', 'aidant');
  const pro = await register('professional-tasks-pro@example.test', 'pro');
  const stranger = await register('professional-tasks-stranger@example.test', 'pro');
  await db.query("UPDATE app_users SET verification_status = 'approved', directory_listed = TRUE WHERE id = ANY($1::uuid[])",
    [[pro.user.id, stranger.user.id]]);
  await db.query(`INSERT INTO app_aidant_senior_links (aidant_user_id, senior_profile_id, linked_by)
    VALUES ($1, $2, $1)`, [aidant.user.id, senior.user.seniorId]);
  const opts = { user: aidant, seniorId: senior.user.seniorId };
  const task = await request('/api/shared-tasks', { ...opts, body: { title: 'Laver le sol', dueDate: '2028-03-01' } });
  const privateTask = await request('/api/shared-tasks', { user: senior, body: { title: 'Tâche familiale privée' } });
  const otherTask = await request('/api/shared-tasks', { user: other, body: { title: 'Autre personne' } });
  const assignPath = `/api/shared-tasks/${task.data.id}/assign`;
  assert.equal((await request(assignPath, { ...opts, body: { assigneeId: pro.user.id } })).status, 403);
  const taskNotices = () => db.query(
    `SELECT id, user_id, title, message FROM app_notifications
     WHERE notification_type = 'task_assignment' AND entity_id = $1`, [task.data.id]);
  assert.equal((await taskNotices()).rows.length, 0);
  assert.equal((await request(`/api/shared-directory/${pro.user.id}`, { user: senior, method: 'POST' })).status, 200);
  assert.ok((await request('/api/shared-tasks/assignees', opts)).data.assignees.some(person => person.id === pro.user.id));
  assert.equal((await request(assignPath, { ...opts, body: { assigneeId: pro.user.id } })).status, 200);
  const notices = (await taskNotices()).rows;
  assert.equal(notices.length, 1);
  assert.equal(notices[0].user_id, pro.user.id);
  assert.doesNotMatch(`${notices[0].title} ${notices[0].message}`, /Laver|professional-tasks/);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM app_notification_deliveries WHERE notification_id = $1',
    [notices[0].id])).rows[0].count, 3);
  assert.equal((await request(assignPath, { ...opts, body: { assigneeId: pro.user.id } })).status, 409);
  assert.equal((await taskNotices()).rows.length, 1);
  assert.ok((await request('/api/notifications', { user: pro })).data.notifications.some(item => item.id === notices[0].id));
  assert.ok(!(await request('/api/notifications', { user: stranger })).data.notifications.some(item => item.id === notices[0].id));
  const sent = [];
  const deliveryContext = {
    require: name => name === 'twilio' ? () => ({ messages: { create: async message => sent.push(message) } }) : require(name),
    process: { env: { TWILIO_ACCOUNT_SID: 'test', TWILIO_AUTH_TOKEN: 'test',
      TWILIO_FROM_NUMBER: '+33123456789', PUBLIC_APP_URL: 'https://example.test' } },
    module: { exports: {} }, URL, console
  };
  vm.runInNewContext(`${fs.readFileSync(path.join(__dirname, '..', 'notification-delivery.js'), 'utf8')}
    this.checkDelivery = deliver;`, deliveryContext);
  const checkDelivery = () => deliveryContext.checkDelivery({
    notification_type: 'task_assignment', notification_id: notices[0].id, entity_id: task.data.id,
    user_id: pro.user.id, channel: 'sms', sms_enabled: true, phone: '+33612345678',
    pool: { query: (sql, params) => db.query(sql, params) }
  });
  assert.equal(await checkDelivery(), true);
  assert.doesNotMatch(sent[0].body, /Laver|professional-tasks/);
  assert.equal((await request(`/api/shared-tasks/${task.data.id}/claim`, { user: senior, method: 'DELETE' })).status, 200);
  assert.equal(await checkDelivery(), false);
  assert.equal((await request(assignPath, { ...opts, body: { assigneeId: pro.user.id } })).status, 200);
  assert.equal((await taskNotices()).rows.length, 2);
  await db.query('UPDATE app_users SET is_active = FALSE WHERE id = $1', [pro.user.id]);
  assert.equal(await checkDelivery(), false);
  await db.query('UPDATE app_users SET is_active = TRUE WHERE id = $1', [pro.user.id]);
  assert.equal((await request(`/api/shared-tasks/${privateTask.data.id}/assign`, {
    user: senior, body: { assigneeId: aidant.user.id }
  })).status, 200);
  assert.equal((await db.query(`SELECT count(*)::int AS count FROM app_notifications
    WHERE notification_type = 'task_assignment' AND entity_id = $1`, [privateTask.data.id])).rows[0].count, 0);
  let visible = await request('/api/intervention-tasks', { user: pro });
  assert.equal(visible.status, 200);
  assert.deepEqual(visible.data.tasks.map(item => item.id), [task.data.id]);
  assert.equal(visible.data.tasks[0].seniorName, senior.user.name);
  assert.deepEqual((await request('/api/intervention-tasks', { user: stranger })).data.tasks, []);
  assert.equal((await request('/api/shared-tasks', { user: pro })).status, 403);
  const update = id => request(`/api/intervention-tasks/${id}`, { user: pro, method: 'PATCH', body: { completed: true } });
  assert.equal((await update(privateTask.data.id)).status, 404);
  assert.equal((await update(otherTask.data.id)).status, 404);
  assert.equal((await update(task.data.id)).status, 200);
  assert.equal(await checkDelivery(), false);
  assert.equal((await request('/api/shared-tasks', opts)).data.tasks.find(item => item.id === task.data.id).completed, true);
  assert.equal((await request(`/api/shared-directory/${pro.user.id}`, { user: senior, method: 'DELETE' })).status, 200);
  assert.deepEqual((await request('/api/intervention-tasks', { user: pro })).data.tasks, []);
  assert.equal((await update(task.data.id)).status, 404);
  assert.equal((await request('/api/shared-tasks', opts)).data.tasks.find(item => item.id === task.data.id).assigned, false);
  assert.equal((await request(`/api/shared-directory/${pro.user.id}`, { user: senior, method: 'POST' })).status, 200);
  assert.deepEqual((await request('/api/intervention-tasks', { user: pro })).data.tasks, []);
  assert.equal((await request('/api/intervention-tasks', { user: senior })).status, 403);
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
    else body.accountCommune = { name: 'Paris', code: '75056', latitude: 48.86, longitude: 2.35 };
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
  assert.equal(suspendedContact.canSend, true);
  assert.equal((await request(`/api/messages/${aidant.user.id}`, {
    user: senior, body: { message: 'Lien suspendu' }
  })).status, 201);
  assert.equal((await request(`/api/contacts/${aidant.user.id}`, { user: senior, method: 'DELETE' })).status, 200);
  assert.equal((await request(`/api/messages/${aidant.user.id}`, {
    user: senior, body: { message: 'Contact retiré' }
  })).status, 403);
  await db.query('UPDATE app_users SET is_active = FALSE WHERE id = $1', [second.user.id]);
  assert.equal((await request(`/api/messages/${second.user.id}`, { user: senior })).status, 403);
  assert.equal((await request(`/api/messages/${senior.user.id}`, {
    user: second, body: { message: 'Compte désactivé' }
  })).status, 401);
});

test('contacts can exchange messages for free only after mutually adding each other', async () => {
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
  assert.equal((await request('/api/messages/contacts', { user: professional })).data.contacts[0].canSend, true);
  const sent = await request(`/api/messages/${professional.user.id}`, { user: senior, body: { message: 'Bonjour' } });
  assert.equal(sent.status, 201);
  assert.equal((await request(`/api/messages/${senior.user.id}`, { user: professional, body: { message: 'Bonjour également' } })).status, 201);
  await db.query(`UPDATE app_users SET premium_until = CURRENT_TIMESTAMP - INTERVAL '1 day' WHERE id = $1`, [senior.user.id]);
  assert.equal((await request('/api/messages/contacts', { user: professional })).data.contacts[0].canSend, true);
  assert.equal((await request(`/api/messages/${senior.user.id}`, { user: professional, body: { message: 'Premium expiré' } })).status, 201);
  assert.equal((await request(`/api/messages/${senior.user.id}`, { user: stranger })).status, 403);
  assert.equal((await request(`/api/contacts/${professional.user.id}`, { user: senior, method: 'DELETE' })).status, 200);
  assert.equal((await request(`/api/messages/${professional.user.id}`, { user: senior })).status, 403);
});

test('a senior sends private copies only to explicitly authorized recipients', async () => {
  const senior = await register('group-senior@example.test', 'senior');
  const aidant1 = await register('group-aidant1@example.test', 'aidant');
  const aidant2 = await register('group-aidant2@example.test', 'aidant');
  const contact = await register('group-contact@example.test', 'senior');
  const stranger = await register('group-stranger@example.test', 'senior');
  for (const aidant of [aidant1, aidant2]) {
    await db.query(`INSERT INTO app_aidant_senior_links (aidant_user_id, senior_profile_id, linked_by)
      VALUES ($1, $2, $1)`, [aidant.user.id, senior.user.seniorId]);
  }
  assert.equal((await request('/api/contacts', { user: senior, body: { email: 'group-contact@example.test' } })).status, 201);
  assert.equal((await request('/api/contacts', { user: contact, body: { email: 'group-senior@example.test' } })).status, 201);
  const path = '/api/messages/multiple';
  const send = (user, recipients, message = 'Bonjour à tous') => request(path, { user, body: { recipients, message } });
  assert.equal((await send(aidant1, [senior.user.id])).status, 403);
  assert.equal((await send(senior, [])).status, 400);
  assert.equal((await send(senior, Array(21).fill(aidant1.user.id))).status, 400);
  assert.equal((await send(senior, [aidant1.user.id], ' ')).status, 400);
  assert.equal((await send(senior, [aidant1.user.id, aidant1.user.id])).status, 400);
  assert.equal((await send(senior, [aidant1.user.id, stranger.user.id])).status, 403);
  assert.equal((await send(senior, [aidant1.user.id, contact.user.id, stranger.user.id])).status, 403);
  let rows = await db.query('SELECT id FROM app_private_messages WHERE sender_id = $1', [senior.user.id]);
  assert.equal(rows.rows.length, 0);
  const result = await send(senior, [aidant1.user.id, aidant2.user.id]);
  assert.equal(result.status, 201);
  assert.equal(result.data.sent, 2);
  rows = await db.query('SELECT recipient_id, body FROM app_private_messages WHERE sender_id = $1', [senior.user.id]);
  assert.deepEqual(rows.rows.map(row => row.recipient_id).sort(), [aidant1.user.id, aidant2.user.id].sort());
  assert.ok(rows.rows.every(row => row.body === 'Bonjour à tous'));
  const conversation = await request(`/api/messages/${senior.user.id}`, { user: aidant1 });
  assert.equal(conversation.data.messages.length, 1);
  assert.equal(JSON.stringify(conversation.data).includes(aidant2.user.id), false);
  await db.query(`UPDATE app_users SET premium_status = 'active' WHERE id = ANY($1::uuid[])`,
    [[senior.user.id, contact.user.id]]);
  assert.equal((await send(senior, [aidant1.user.id, contact.user.id], 'Bonjour')).status, 201);
  await db.query(`UPDATE app_users SET premium_until = CURRENT_TIMESTAMP - INTERVAL '1 day' WHERE id = $1`, [contact.user.id]);
  assert.equal((await send(senior, [aidant1.user.id, contact.user.id], 'Accès expiré')).status, 201);
  assert.equal((await db.query("SELECT COUNT(*)::int AS count FROM app_private_messages WHERE body = 'Accès expiré'")).rows[0].count, 2);
  await db.query('UPDATE app_aidant_senior_links SET suspended_at = CURRENT_TIMESTAMP WHERE aidant_user_id = $1', [aidant2.user.id]);
  assert.equal((await send(senior, [aidant1.user.id, aidant2.user.id], 'Refusé')).status, 403);
  assert.equal((await db.query("SELECT COUNT(*)::int AS count FROM app_private_messages WHERE body = 'Refusé'")).rows[0].count, 0);
});

test('birthdays validate dates, recur annually and remind only the owner with their age', async () => {
  const senior = await register('birthday-senior@example.test', 'senior');
  const other = await register('birthday-other@example.test', 'senior');
  const create = body => request('/api/agenda/birthdays', { user: senior, body });
  assert.equal((await create({ name: '', birthDate: '2000-02-29' })).status, 400);
  assert.equal((await create({ name: 'Alice', birthDate: '2001-02-29' })).status, 400);
  assert.equal((await create({ name: 'Alice', birthDate: '9999-01-01' })).status, 400);
  assert.equal((await request('/api/agenda/birthdays', { body: { name: 'Alice', birthDate: '2000-02-29' } })).status, 401);
  const birthday = await create({ name: 'Alice', birthDate: '2000-02-29' });
  assert.equal(birthday.status, 201);
  const calendar = user => request('/api/planning/calendar?start=2025-02-27&end=2025-03-02', { user });
  const events = (await calendar(senior)).data.events;
  assert.equal(events.length, 1);
  assert.equal(events[0].title, 'Anniversaire de Alice');
  assert.equal(events[0].scheduledAt, '2025-02-28T08:00:00.000Z');
  assert.equal(events[0].conflict, false);
  assert.equal('birth_date' in events[0], false);
  assert.deepEqual((await calendar(other)).data.events, []);
  const pool = new pg.Pool();
  const sent = [];
  const notify = async (client, userId, type, title, message, entityType, entityId) => {
    await client.query(`INSERT INTO app_notifications
      (id, user_id, notification_type, title, message, entity_type, entity_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [randomUUID(), userId, type, title, message, entityType, entityId]);
    sent.push({ userId, type, title, message, entityType, entityId });
  };
  assert.equal(await createDueBirthdayReminder(pool, notify, new Date('2025-02-28T07:59:00Z')), false);
  await assert.rejects(createDueBirthdayReminder(pool, async () => { throw new Error('insertion failed'); },
    new Date('2025-02-28T08:00:00Z')), /insertion failed/);
  assert.equal(await createDueBirthdayReminder(pool, notify, new Date('2025-02-28T08:00:00Z')), true);
  assert.equal(await createDueBirthdayReminder(pool, notify, new Date('2025-02-28T09:00:00Z')), false);
  assert.equal(sent[0].userId, senior.user.id);
  assert.equal(sent[0].entityId, birthday.data.id);
  assert.match(sent[0].message, /Alice.*25 ans/);
  assert.match((await request('/api/notifications', { user: senior })).data.notifications[0].message, /Alice.*25 ans/);
  assert.equal((await request('/api/notifications', { user: other })).data.notifications.length, 0);
  assert.equal(await createDueBirthdayReminder(pool, notify, new Date('2028-02-28T09:00:00Z')), false);
  assert.equal(await createDueBirthdayReminder(pool, notify, new Date('2028-02-29T08:00:00Z')), true);
  assert.match(sent[1].message, /28 ans/);
  assert.equal((await request(`/api/agenda/events/${birthday.data.id}`, { user: other, method: 'DELETE' })).status, 404);
  assert.equal((await request(`/api/agenda/events/${birthday.data.id}`, { user: senior, method: 'DELETE' })).status, 200);
  assert.equal((await request('/api/notifications', { user: senior })).data.notifications.length, 0);
  assert.equal(await createDueBirthdayReminder(pool, notify, new Date('2029-02-28T08:00:00Z')), false);
});

test('recurring personal dates preserve Paris time, privacy and series deletion', async () => {
  const senior = await register('recurring-senior@example.test', 'senior');
  const other = await register('recurring-other@example.test', 'senior');
  const create = (title, start, recurrence) => request('/api/agenda/events', {
    user: senior, body: { title, start, durationMinutes: 30, recurrence }
  });
  assert.equal((await create('Invalide', '2024-01-01T10:00:00Z', 'daily')).status, 400);
  assert.equal((await create('Heure inexistante', '2024-03-31T02:30', 'weekly')).status, 400);
  const local = await create('Heure de Paris', '2024-03-25T10:00', 'none');
  assert.equal(local.status, 201);
  const weekly = await create('Rendez-vous régulier', '2024-03-24T09:00:00Z', 'weekly');
  const birthday = await create('Anniversaire', '2024-02-29T09:00:00Z', 'yearly');
  const monthly = await create('Fin du mois', '2024-01-31T09:00:00Z', 'monthly');
  assert.equal(weekly.status, 201);
  assert.equal(birthday.status, 201);
  assert.equal(monthly.status, 201);
  const calendar = (user, start, end) => request(`/api/planning/calendar?start=${start}&end=${end}`, { user });
  let result = await calendar(senior, '2024-03-24', '2024-04-02');
  assert.equal(result.status, 200);
  assert.deepEqual(result.data.events.filter(event => event.id === weekly.data.id).map(event => event.scheduledAt),
    ['2024-03-24T09:00:00.000Z', '2024-03-31T08:00:00.000Z']);
  assert.equal(result.data.events.find(event => event.id === local.data.id).scheduledAt, '2024-03-25T09:00:00.000Z');
  assert.deepEqual((await calendar(other, '2024-03-24', '2024-04-02')).data.events, []);
  result = await calendar(senior, '2025-02-27', '2025-03-02');
  assert.deepEqual(result.data.events.filter(event => event.id === birthday.data.id).map(event => event.scheduledAt),
    ['2025-02-28T09:00:00.000Z']);
  assert.deepEqual(result.data.events.filter(event => event.id === monthly.data.id).map(event => event.scheduledAt),
    ['2025-02-28T09:00:00.000Z']);
  assert.equal((await request(`/api/agenda/events/${weekly.data.id}`, { user: other, method: 'DELETE' })).status, 404);
  assert.equal((await request(`/api/agenda/events/${weekly.data.id}`, { user: senior, method: 'DELETE' })).status, 200);
  assert.equal((await calendar(senior, '2024-03-24', '2024-04-02')).data.events.some(event => event.id === weekly.data.id), false);
  result = await request('/api/planning/calendar?next=1', { user: senior });
  assert.equal(result.status, 200);
  assert.ok(result.data.events[0]);
  assert.ok(new Date(result.data.events[0].scheduledAt) >= new Date());
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
  const series = await request('/api/agenda/events', {
    user: senior, body: { title: 'Régulier', start: at('12'), durationMinutes: 30, recurrence: 'weekly' }
  });
  const nextWeek = new Date(Date.parse(day) + 7 * 86400000).toISOString().slice(0, 10);
  const afterNextWeek = new Date(Date.parse(day) + 8 * 86400000).toISOString().slice(0, 10);
  const weeklyPath = `/api/planning/calendar?start=${nextWeek}&end=${afterNextWeek}`;
  assert.equal((await request(weeklyPath, { user: aidant })).data.events.find(event => event.id === series.data.id).kind, 'shared');

  assert.equal((await request(`/api/agenda/shares/${shareId}`, { user: aidant, body: { decision: 'revoke' } })).status, 200);
  assert.deepEqual((await request(weeklyPath, { user: aidant })).data.events, []);
  assert.equal((await request(path, { user: aidant })).data.events.length, 1);
  const mine = compared.data.events.find(event => event.kind === 'personal');
  assert.equal((await request(`/api/agenda/events/${mine.id}`, { user: stranger, method: 'DELETE' })).status, 404);
  assert.equal((await request(`/api/agenda/events/${mine.id}`, { user: aidant, method: 'DELETE' })).status, 200);
});

test('free accounts can add several contacts of the same role', async () => {
  const senior = await register('contacts-senior@example.test', 'senior');
  const first = await register('contacts-aidant-1@example.test', 'aidant');
  const second = await register('contacts-aidant-2@example.test', 'aidant');
  const add = user => request('/api/contacts', { user: senior, body: { contactUserId: user.user.id } });
  assert.equal((await add(first)).status, 201);
  assert.equal((await add(first)).status, 201);
  assert.equal((await add(second)).status, 201);
  assert.equal((await request('/api/contacts', { user: senior })).data.contacts.length, 2);
});

test('video calls are free for saved contacts but reject unauthorized callers and contacts', async () => {
  const senior = await register('video-free-senior@example.test', 'senior');
  const contact = await register('video-free-contact@example.test', 'aidant');
  const stranger = await register('video-free-stranger@example.test', 'aidant');
  const call = (user, contactId) => request('/api/video/token', { user, body: { contactId } });
  assert.equal((await call(null, contact.user.id)).status, 401);
  assert.equal((await call(senior, stranger.user.id)).status, 403);
  assert.equal((await request('/api/contacts', { user: senior, body: { contactUserId: contact.user.id } })).status, 201);
  const originalFetch = global.fetch;
  const originalKey = process.env.DAILY_API_KEY;
  process.env.DAILY_API_KEY = 'test-key';
  global.fetch = async (url, options) => {
    if (url === 'https://api.daily.co/v1/rooms') {
      return { ok: true, json: async () => ({ url: 'https://example.test/room' }) };
    }
    if (url === 'https://api.daily.co/v1/meeting-tokens') {
      return { ok: true, json: async () => ({ token: 'test-token' }) };
    }
    return originalFetch(url, options);
  };
  try {
    const result = await call(senior, contact.user.id);
    assert.equal(result.status, 200);
    assert.equal(result.data.token, 'test-token');
    assert.equal(result.data.contactName, contact.user.name);
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.DAILY_API_KEY;
    else process.env.DAILY_API_KEY = originalKey;
  }
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
  const verification = `/api/admin/accounts/${guardian.user.id}/guardian-verification`;
  assert.equal((await request(verification, {
    user: admin, admin: true, method: 'PATCH', body: { verificationStatus: 'approved' }
  })).status, 409);
  for (const type of ['identity', 'guardianship']) {
    const upload = await fetch(`${baseUrl}/api/legal-guardian/documents/${type}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${guardian.token}`, 'Content-Type': 'application/pdf' },
      body: Buffer.from('%PDF-1.4\n')
    });
    assert.equal(upload.status, 200);
  }
  assert.equal((await request(verification, {
    user: aidant, method: 'PATCH', body: { verificationStatus: 'approved' }
  })).status, 403);
  assert.equal((await request(verification, {
    user: admin, admin: true, method: 'PATCH', body: { verificationStatus: 'approved' }
  })).status, 200);
  assert.equal((await request('/api/legal-guardian/documents', { user: guardian })).data.documents.length, 0);
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

test('administrator confirms only a pending request after verifying the senior agreement', async () => {
  const senior = await register('admin-consent-senior@example.test', 'senior');
  const aidant = await register('admin-consent-aidant@example.test', 'aidant');
  const admin = (await request('/api/auth/login', { body: { email: 'admin@example.test', password: 'a-test-password-123' } })).data;
  const listPath = '/api/admin/senior-link-requests';
  const body = { confirmed: true, note: 'Accord confirmé directement par téléphone.' };
  assert.equal((await request(listPath, { user: aidant, admin: true })).status, 403);
  assert.equal((await request(listPath, { user: admin })).status, 403);
  assert.equal((await request(`/api/admin/senior-link-requests/${randomUUID()}/confirm`,
    { user: admin, admin: true, body })).status, 404);
  await request('/api/senior-links/requests', { user: aidant, body: { email: 'admin-consent-senior@example.test' } });
  let pending = (await request('/api/senior-links', { user: senior })).data.requests[0];
  const path = `/api/admin/senior-link-requests/${pending.id}/confirm`;
  assert.ok((await request(listPath, { user: admin, admin: true })).data.requests.some(row => row.id === pending.id));
  assert.equal((await request(path, { user: aidant, admin: true, body })).status, 403);
  assert.equal((await request(path, { user: admin, admin: true, body: { ...body, confirmed: false } })).status, 400);
  assert.equal((await request(path, { user: admin, admin: true, body: { ...body, note: 'court' } })).status, 400);
  assert.equal((await request('/api/logs/all', { user: aidant, seniorId: senior.user.seniorId })).status, 403);
  for (const [column, value, restore] of [
    ['is_active', false, true], ['admin_password_change_required', true, false]
  ]) {
    await db.query(`UPDATE app_users SET ${column} = $2 WHERE id = $1`, [senior.user.id, value]);
    assert.equal((await request(path, { user: admin, admin: true, body })).status, 404);
    assert.ok(!(await request(listPath, { user: admin, admin: true })).data.requests.some(row => row.id === pending.id));
    await db.query(`UPDATE app_users SET ${column} = $2 WHERE id = $1`, [senior.user.id, restore]);
  }
  await db.query('UPDATE app_users SET is_active = FALSE WHERE id = $1', [aidant.user.id]);
  assert.equal((await request(path, { user: admin, admin: true, body })).status, 404);
  await db.query('UPDATE app_users SET is_active = TRUE WHERE id = $1', [aidant.user.id]);
  await db.query(`INSERT INTO app_aidant_senior_links (aidant_user_id, senior_profile_id, linked_by, suspended_at)
    VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`, [aidant.user.id, senior.user.seniorId, senior.user.id]);
  assert.equal((await request(path, { user: admin, admin: true, body })).status, 409);
  assert.equal((await request('/api/logs/all', { user: aidant, seniorId: senior.user.seniorId })).status, 403);
  await db.query('DELETE FROM app_aidant_senior_links WHERE aidant_user_id = $1 AND senior_profile_id = $2',
    [aidant.user.id, senior.user.seniorId]);
  assert.equal((await request(`/api/senior-links/requests/${pending.id}/decision`, {
    user: senior, body: { decision: 'decline' }
  })).status, 200);
  assert.equal((await request(path, { user: admin, admin: true, body })).status, 404);
  await request('/api/senior-links/requests', { user: aidant, body: { email: 'admin-consent-senior@example.test' } });
  pending = (await request('/api/senior-links', { user: senior })).data.requests[0];
  const confirm = `/api/admin/senior-link-requests/${pending.id}/confirm`;
  assert.equal((await request(confirm, { user: admin, admin: true, body })).status, 200);
  assert.equal((await request(confirm, { user: admin, admin: true, body })).status, 404);
  const audit = (await db.query('SELECT status, confirmed_by_admin, admin_confirmation_note FROM app_aidant_link_requests WHERE id = $1', [pending.id])).rows[0];
  assert.equal(audit.status, 'accepted');
  assert.equal(audit.confirmed_by_admin, admin.user.id);
  assert.equal(audit.admin_confirmation_note, body.note);
  const notices = (await db.query(`SELECT user_id FROM app_notifications
    WHERE entity_id = $1 AND notification_type = 'senior_link_decision'`, [pending.id])).rows;
  assert.deepEqual(new Set(notices.map(row => row.user_id)), new Set([senior.user.id, aidant.user.id]));
  assert.equal((await request('/api/logs/all', { user: aidant, seniorId: senior.user.seniorId })).status, 200);
  await db.query(`INSERT INTO app_logs (senior_id, author_id, content, log_type)
    VALUES ($1, 1, 'private-admin-consent-test', 'note')`, [senior.user.seniorId]);
  const adminLogs = await request('/api/logs/all', { user: admin, seniorId: senior.user.seniorId });
  assert.equal(adminLogs.status, 200);
  assert.ok(!adminLogs.data.some(log => log.content === 'private-admin-consent-test'));
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
  const conflictAdmin = (await request('/api/auth/login', { body: { email: 'admin@example.test', password: 'a-test-password-123' } })).data;
  const adminRefused = await request(`/api/admin/senior-link-requests/${requestId}/confirm`, {
    user: conflictAdmin, admin: true, body: { confirmed: true, note: 'Accord confirmé directement par téléphone.' }
  });
  assert.equal(adminRefused.status, 409);
  assert.match(adminRefused.data.error, /ancienne réservation/);
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
