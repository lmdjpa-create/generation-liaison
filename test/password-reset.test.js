const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { test } = require('node:test');
const { createAuthService, hashPassword, verifyPassword } = require('../auth');

function fakeDatabase() {
  const state = { reset: null, active: true, sessions: ['session'], password: null };
  const userId = 'user-id';
  const client = {
    async query(sql, params = []) {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('DELETE FROM app_password_resets')) {
        if (!state.reset || state.reset.hash !== params[0] || state.reset.expired) return { rows: [] };
        state.reset = null;
        return { rows: [{ user_id: userId }] };
      }
      if (sql.includes('UPDATE app_users SET password_salt')) {
        if (!state.active) return { rows: [] };
        state.password = { salt: params[1], hash: params[2] };
        return { rows: [{ id: userId }] };
      }
      if (sql.includes('DELETE FROM app_sessions')) {
        state.sessions = [];
        return { rows: [] };
      }
      throw new Error(`Unexpected client query: ${sql}`);
    },
    release() {}
  };
  const pool = {
    async query(sql, params = []) {
      if (sql.includes('CREATE TABLE IF NOT EXISTS senior_profiles')) return { rows: [] };
      if (sql.includes('INSERT INTO app_password_resets')) {
        if (params[0] !== 'person@example.com' || !state.active || state.reset) return { rows: [] };
        state.reset = { hash: params[1], expired: false };
        return { rows: [{ user_id: userId }] };
      }
      throw new Error(`Unexpected pool query: ${sql}`);
    },
    async connect() { return client; }
  };
  return { auth: createAuthService(pool), state };
}

test('reset tokens are random, hashed, throttled and do not reveal unknown accounts', async () => {
  const { auth, state } = fakeDatabase();
  assert.equal(await auth.createPasswordReset('unknown@example.com'), null);
  const token = await auth.createPasswordReset(' Person@Example.com ');
  assert.match(token, /^[0-9a-f]{64}$/);
  assert.equal(state.reset.hash, createHash('sha256').update(token).digest('hex'));
  assert.notEqual(state.reset.hash, token);
  assert.equal(await auth.createPasswordReset('person@example.com'), null);
  await assert.rejects(auth.createPasswordReset('invalid'), /adresse e-mail valide/);
});

test('reset replaces the password, signs out sessions and rejects reuse', async () => {
  const { auth, state } = fakeDatabase();
  const token = await auth.createPasswordReset('person@example.com');
  await assert.rejects(auth.resetPassword(token, 'short'), /12 caractères/);
  assert.ok(state.reset);
  await auth.resetPassword(token, 'a-long-new-password');
  assert.equal(await verifyPassword('a-long-new-password', state.password.salt, state.password.hash), true);
  assert.deepEqual(state.sessions, []);
  await assert.rejects(auth.resetPassword(token, 'another-long-password'), /invalide ou a expiré/);
});

test('expired, malformed and inactive-account reset attempts do not change the password', async () => {
  const { auth, state } = fakeDatabase();
  const token = await auth.createPasswordReset('person@example.com');
  state.reset.expired = true;
  await assert.rejects(auth.resetPassword(token, 'a-long-new-password'), /invalide ou a expiré/);
  await assert.rejects(auth.resetPassword('not-a-token', 'a-long-new-password'), /invalide ou a expiré/);
  state.reset.expired = false;
  state.active = false;
  await assert.rejects(auth.resetPassword(token, 'a-long-new-password'), /invalide ou a expiré/);
  assert.equal(state.password, null);
  assert.deepEqual(state.sessions, ['session']);
});

test('login locks the account until its session is created and still rejects incorrect passwords', async () => {
  const credentials = await hashPassword('a-valid-password');
  const statements = [];
  const client = {
    async query(sql) {
      statements.push(sql);
      if (sql.includes('SELECT u.id')) {
        return { rows: [{
          id: 'user-id', senior_id: 'profile-id', name: 'Person', email: 'person@example.com',
          role: 'senior', is_active: true, password_salt: credentials.salt, password_hash: credentials.hash
        }] };
      }
      return { rows: [] };
    },
    release() {}
  };
  const auth = createAuthService({
    async query() { return { rows: [] }; },
    async connect() { return client; }
  });
  const result = await auth.login({ email: 'PERSON@example.com', password: 'a-valid-password' });
  assert.match(result.token, /^[0-9a-f]{64}$/);
  assert.ok(statements.some(sql => sql.includes('FOR UPDATE OF u')));
  assert.ok(statements.some(sql => sql.includes('INSERT INTO app_sessions')));
  assert.equal(statements.at(-1), 'COMMIT');

  statements.length = 0;
  await assert.rejects(auth.login({ email: 'person@example.com', password: 'incorrect' }), /mot de passe incorrect/);
  assert.equal(statements.at(-1), 'ROLLBACK');
  assert.ok(!statements.some(sql => sql.includes('INSERT INTO app_sessions')));
});
