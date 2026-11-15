const AREA_LABELS = {
  connexion: 'connexion et comptes',
  messagerie: 'messagerie et assistant',
  agenda: 'agenda et planning',
  notifications: 'notifications',
  annuaire: 'annuaire',
  autres: 'autres fonctions'
};
const ERROR_THRESHOLD = 3;

async function createSiteAlerts(pool, monitor, adminEmails, notify, now = new Date()) {
  const affected = Object.entries(monitor.snapshot().byArea)
    .filter(([area, counts]) => AREA_LABELS[area] && counts.serverErrors >= ERROR_THRESHOLD);
  if (!affected.length) return 0;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: admins } = await client.query(
      'SELECT id FROM app_users WHERE is_active = TRUE AND lower(email) = ANY($1::text[])',
      [Array.from(adminEmails)]
    );
    if (!admins.length) {
      throw new Error('Aucun compte administrateur actif ne peut recevoir les alertes techniques.');
    }
    let sent = 0;
    for (const [area] of affected) {
      const { rows } = await client.query(
        `INSERT INTO app_site_alert_state (area, last_sent_at) VALUES ($1, $2)
         ON CONFLICT (area) DO UPDATE SET last_sent_at = EXCLUDED.last_sent_at
         WHERE app_site_alert_state.last_sent_at <= EXCLUDED.last_sent_at - INTERVAL '30 minutes'
         RETURNING area`,
        [area, now]
      );
      if (!rows.length) continue;
      for (const admin of admins) {
        await notify(client, admin.id, 'site_error_alert', 'Erreurs techniques détectées',
          `Plusieurs erreurs serveur concernent la rubrique ${AREA_LABELS[area]}. Consultez la surveillance technique dans l’espace administrateur.`,
          'site_monitor', null);
      }
      sent++;
    }
    await client.query('COMMIT');
    return sent;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function startSiteAlertWorker(pool, monitor, adminEmails, notify) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await createSiteAlerts(pool, monitor, adminEmails, notify);
    } catch (error) {
      console.error('Alerte technique impossible :', error);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(run, 30 * 1000);
  timer.unref();
  return timer;
}

module.exports = { createSiteAlerts, startSiteAlertWorker };
