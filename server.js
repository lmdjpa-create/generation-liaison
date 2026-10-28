const express = require('express');
const cors = require('cors');
const path = require('path');
const { randomBytes } = require('node:crypto');
const { Pool } = require('pg');
const { AuthError, createAuthService } = require('./auth');

require('dotenv').config();

const app = express();
const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : null;
const authService = createAuthService(pool);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'dist')));

function sendApiError(res, error, fallbackMessage) {
  if (error instanceof AuthError) {
    return res.status(error.status).json({ error: error.message });
  }

  console.error(error);
  return res.status(500).json({ error: fallbackMessage });
}

function requireAuth(req, res, next) {
  const authorization = req.get('authorization') || '';
  const match = authorization.match(/^Bearer ([a-f0-9]{64})$/i);
  if (!match) {
    return res.status(401).json({ error: 'Veuillez vous connecter pour continuer.' });
  }

  authService.authenticate(match[1])
    .then(user => {
      if (!user) {
        return res.status(401).json({ error: 'Votre session a expiré. Reconnectez-vous.' });
      }

      req.authUser = user;
      req.authToken = match[1];
      return next();
    })
    .catch(error => sendApiError(res, error, 'Impossible de vérifier la session.'));
}

app.get('/api/status', (req, res) => {
  res.json({
    status: 'En ligne',
    message: 'Le serveur de Génération Liaison fonctionne parfaitement !'
  });
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const result = await authService.register(req.body || {});
    res.status(201).json(result);
  } catch (error) {
    sendApiError(res, error, 'Impossible de créer le compte.');
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const result = await authService.login(req.body || {});
    res.json(result);
  } catch (error) {
    sendApiError(res, error, 'Impossible de se connecter.');
  }
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.authUser });
});

app.post('/api/auth/logout', requireAuth, async (req, res) => {
  try {
    await authService.logout(req.authToken);
    res.status(204).end();
  } catch (error) {
    sendApiError(res, error, 'Impossible de fermer la session.');
  }
});

app.post('/api/logs', requireAuth, async (req, res) => {
  const { content, log_type: logType } = req.body || {};
  const authorIds = { senior: 1, aidant: 2, pro: 3 };
  const allowedTypes = {
    senior: new Set(['meal_delivery', 'family_note']),
    aidant: new Set(['family_note', 'meal_delivery']),
    pro: new Set(['medical_report'])
  };

  if (typeof content !== 'string' || !content.trim() || content.length > 2000 ||
      !allowedTypes[req.authUser.role].has(logType)) {
    return res.status(400).json({ error: 'Vérifiez le contenu et le type de note.' });
  }

  try {
    await authService.ensureSchema();
    const { rows } = await pool.query(
      `INSERT INTO app_logs (senior_id, author_id, content, log_type)
       VALUES ($1, $2, $3, $4)
       RETURNING id, senior_id, author_id, content, log_type, created_at`,
      [req.authUser.seniorId, authorIds[req.authUser.role], content.trim(), logType]
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    sendApiError(res, error, 'Erreur lors de l’enregistrement.');
  }
});

app.get('/api/meals/today', (req, res) => {
  res.json([
    {
      id: 101,
      title: 'Filet de colin sauce citronnée, purée de carottes douce',
      type: 'Médicalisé',
      tags: ['Sans sel ajouté'],
      price: 8.9
    },
    {
      id: 102,
      title: 'Rôti de veau au jus, petits pois et pommes grenailles',
      type: 'Traditionnel',
      tags: ['Diabétique compatible'],
      price: 10.5
    },
    {
      id: 103,
      title: 'Velouté de potimarron aux châtaignes',
      type: 'Plaisir',
      tags: ['Végétarien'],
      price: 7.5
    }
  ]);
});

app.get('/api/logs/all', requireAuth, async (req, res) => {
  try {
    await authService.ensureSchema();
    const { rows } = await pool.query(
      `SELECT id, senior_id, author_id, content, log_type, created_at
       FROM app_logs
       WHERE senior_id = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [req.authUser.seniorId]
    );
    res.json(rows);
  } catch (error) {
    sendApiError(res, error, 'Impossible de charger le carnet.');
  }
});

app.post('/api/video/urgency', requireAuth, async (req, res) => {
  const videoUrl = `https://meet.jit.si/GenerationLiaison_Urgence_${randomBytes(12).toString('hex')}`;
  const authorId = { senior: 1, aidant: 2, pro: 3 }[req.authUser.role];

  try {
    await authService.ensureSchema();
    await pool.query(
      `INSERT INTO app_logs (senior_id, author_id, content, log_type)
       VALUES ($1, $2, $3, 'medical_report')`,
      [req.authUser.seniorId, authorId, `Demande d’appel vidéo urgent : ${videoUrl}`]
    );
    res.status(201).json({ url: videoUrl });
  } catch (error) {
    sendApiError(res, error, 'Impossible de créer l’appel vidéo.');
  }
});

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🚀 Serveur démarré sur : http://localhost:${PORT}`);
  });
}

module.exports = app;
