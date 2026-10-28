const { promisify } = require('node:util');
const {
  createHash,
  randomBytes,
  randomUUID,
  scrypt: scryptCallback,
  timingSafeEqual
} = require('node:crypto');

const scrypt = promisify(scryptCallback);
const SESSION_DURATION_DAYS = 30;
const PASSWORD_LENGTH = 64;
const PASSWORD_MIN_LENGTH = 12;
const DUMMY_SALT = Buffer.alloc(16, 1);
const DUMMY_HASH = Buffer.alloc(PASSWORD_LENGTH, 1);
const roles = new Set(['senior', 'aidant', 'pro']);

class AuthError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

async function hashPassword(password, salt = randomBytes(16)) {
  const hash = await scrypt(password, salt, PASSWORD_LENGTH);
  return { salt: salt.toString('hex'), hash: hash.toString('hex') };
}

async function verifyPassword(password, salt, expectedHash) {
  const actualHash = await scrypt(password, Buffer.from(salt, 'hex'), PASSWORD_LENGTH);
  const expected = Buffer.from(expectedHash, 'hex');
  return actualHash.length === expected.length && timingSafeEqual(actualHash, expected);
}

function createAuthService(pool) {
  let schemaInitialization;

  async function ensureSchema() {
    if (!pool) {
      throw new AuthError(503, 'Le service de connexion n’est pas configuré.');
    }

    if (!schemaInitialization) {
      schemaInitialization = pool.query(`
        CREATE TABLE IF NOT EXISTS senior_profiles (
          id UUID PRIMARY KEY,
          name VARCHAR(120) NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS app_users (
          id UUID PRIMARY KEY,
          senior_id UUID NOT NULL UNIQUE REFERENCES senior_profiles(id) ON DELETE CASCADE,
          name VARCHAR(120) NOT NULL,
          email VARCHAR(254) NOT NULL UNIQUE,
          role VARCHAR(16) NOT NULL CHECK (role IN ('senior', 'aidant', 'pro')),
          password_salt CHAR(32) NOT NULL,
          password_hash CHAR(128) NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS app_sessions (
          token_hash CHAR(64) PRIMARY KEY,
          user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          expires_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS app_logs (
          id BIGSERIAL PRIMARY KEY,
          senior_id UUID NOT NULL REFERENCES senior_profiles(id) ON DELETE CASCADE,
          author_id SMALLINT NOT NULL,
          content TEXT NOT NULL,
          log_type VARCHAR(32) NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS app_sessions_expiry_idx ON app_sessions (expires_at);
        CREATE INDEX IF NOT EXISTS app_logs_senior_created_idx ON app_logs (senior_id, created_at DESC);
      `).catch(error => {
        schemaInitialization = undefined;
        throw error;
      });
    }

    await schemaInitialization;
  }

  async function createSession(client, userId) {
    const token = randomBytes(32).toString('hex');
    await client.query(
      `INSERT INTO app_sessions (token_hash, user_id, expires_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP + ($3 * INTERVAL '1 day'))`,
      [hashToken(token), userId, SESSION_DURATION_DAYS]
    );
    return token;
  }

  function publicUser(row) {
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      seniorId: row.senior_id,
      seniorName: row.senior_name
    };
  }

  async function register({ name, email, password, role, seniorName }) {
    await ensureSchema();

    if (typeof name !== 'string' || typeof email !== 'string' ||
        typeof seniorName !== 'string') {
      throw new AuthError(400, 'Complétez tous les champs du formulaire.');
    }

    const normalizedEmail = email.trim().toLowerCase();
    const normalizedName = name.trim();
    const normalizedSeniorName = seniorName.trim();
    if (!normalizedName || normalizedName.length > 120 ||
        !normalizedSeniorName || normalizedSeniorName.length > 120) {
      throw new AuthError(400, 'Vérifiez les noms saisis.');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || normalizedEmail.length > 254) {
      throw new AuthError(400, 'Saisissez une adresse e-mail valide.');
    }
    if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH || password.length > 256) {
      throw new AuthError(400, `Le mot de passe doit contenir au moins ${PASSWORD_MIN_LENGTH} caractères.`);
    }
    if (!roles.has(role)) {
      throw new AuthError(400, 'Sélectionnez un rôle valide.');
    }

    const userId = randomUUID();
    const seniorId = randomUUID();
    const passwordCredentials = await hashPassword(password);
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await client.query(
        'INSERT INTO senior_profiles (id, name) VALUES ($1, $2)',
        [seniorId, normalizedSeniorName]
      );
      const { rows } = await client.query(
        `INSERT INTO app_users (id, senior_id, name, email, role, password_salt, password_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, senior_id, name, email, role`,
        [userId, seniorId, normalizedName, normalizedEmail, role, passwordCredentials.salt, passwordCredentials.hash]
      );
      rows[0].senior_name = normalizedSeniorName;
      const token = await createSession(client, userId);
      await client.query('COMMIT');
      return { token, user: publicUser(rows[0]) };
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.code === '23505') {
        throw new AuthError(409, 'Un compte existe déjà pour cette adresse e-mail.');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async function login({ email, password }) {
    await ensureSchema();
    if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
      throw new AuthError(400, 'Saisissez votre adresse e-mail et votre mot de passe.');
    }

    const normalizedEmail = email.trim().toLowerCase();
    const { rows } = await pool.query(
      `SELECT u.id, u.senior_id, u.name, u.email, u.role, u.password_salt, u.password_hash,
              s.name AS senior_name
       FROM app_users u
       JOIN senior_profiles s ON s.id = u.senior_id
       WHERE u.email = $1`,
      [normalizedEmail]
    );
    const row = rows[0];
    const matches = row
      ? await verifyPassword(password, row.password_salt, row.password_hash)
      : await verifyPassword(password, DUMMY_SALT.toString('hex'), DUMMY_HASH.toString('hex'));

    if (!row || !matches) {
      throw new AuthError(401, 'Adresse e-mail ou mot de passe incorrect.');
    }

    const client = await pool.connect();
    try {
      const token = await createSession(client, row.id);
      return { token, user: publicUser(row) };
    } finally {
      client.release();
    }
  }

  async function authenticate(token) {
    await ensureSchema();
    const { rows } = await pool.query(
      `SELECT u.id, u.senior_id, u.name, u.email, u.role, s.name AS senior_name
       FROM app_sessions session
       JOIN app_users u ON u.id = session.user_id
       JOIN senior_profiles s ON s.id = u.senior_id
       WHERE session.token_hash = $1 AND session.expires_at > CURRENT_TIMESTAMP`,
      [hashToken(token)]
    );
    return rows[0] ? publicUser(rows[0]) : null;
  }

  async function logout(token) {
    await ensureSchema();
    await pool.query('DELETE FROM app_sessions WHERE token_hash = $1', [hashToken(token)]);
  }

  return { authenticate, ensureSchema, login, logout, register };
}

module.exports = {
  AuthError,
  PASSWORD_MIN_LENGTH,
  createAuthService,
  hashPassword,
  verifyPassword
};
