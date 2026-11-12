const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const { PGlite } = require('@electric-sql/pglite');
const pg = require('pg');
const delivery = require('../notification-delivery');
const { TERMS_VERSION } = require('../auth');

const adminCode = 'test-administrator-code-at-least-32-characters';
let db;
let server;
let baseUrl;
let sentCode;
let failEmail = false;

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
  process.env.ADMIN_EMAILS = 'admin@example.test';
  process.env.ADMIN_ACCESS_CODE = adminCode;
  delivery.isConfigured = () => ({ email: true });
  delivery.sendSeniorUnlinkCode = async (email, code) => {
    if (failEmail) throw new Error('test delivery failure');
    sentCode = { email, code };
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
      acceptedTerms: true, acceptedTermsVersion: TERMS_VERSION
    }
  });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  return result.data;
}

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
