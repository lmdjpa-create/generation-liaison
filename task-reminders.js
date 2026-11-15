async function createDueTaskReminder(pool, insertNotification, now = new Date()) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT task.id AS task_id, task.due_date, aidant.id AS user_id
       FROM app_shared_tasks task
       JOIN app_aidant_senior_links link ON link.senior_profile_id = task.senior_id
         AND link.suspended_at IS NULL
       JOIN app_users aidant ON aidant.id = link.aidant_user_id AND aidant.role = 'aidant'
         AND aidant.is_active = TRUE AND aidant.task_reminders_enabled = TRUE
         AND (NOT aidant.is_legal_guardian OR aidant.guardian_verification_status = 'approved')
       JOIN app_users senior ON senior.senior_id = task.senior_id
         AND senior.role = 'senior' AND senior.is_active = TRUE
       WHERE NOT task.completed
         AND (task.assignee_user_id IS NULL OR task.assignee_user_id = aidant.id)
         AND task.due_date = ($1::timestamptz AT TIME ZONE 'Europe/Paris')::date
         AND ($1::timestamptz AT TIME ZONE 'Europe/Paris')::time >= TIME '09:00'
         AND NOT EXISTS (
           SELECT 1 FROM app_task_reminders reminder
           WHERE reminder.task_id = task.id AND reminder.user_id = aidant.id
             AND reminder.due_date = task.due_date
         )
       ORDER BY task.due_date, task.id, aidant.id
       LIMIT 1
       FOR UPDATE OF task SKIP LOCKED
       FOR SHARE OF link, aidant, senior`,
      [now]
    );
    if (!rows.length) {
      await client.query('COMMIT');
      return false;
    }
    const reminder = rows[0];
    await client.query(
      `INSERT INTO app_task_reminders (task_id, user_id, due_date) VALUES ($1, $2, $3)`,
      [reminder.task_id, reminder.user_id, reminder.due_date]
    );
    await insertNotification(client, reminder.user_id, 'task_reminder', 'Rappel de tâche',
      'Une tâche du quotidien est prévue aujourd’hui. Consultez vos tâches dans l’application.',
      'shared_task', reminder.task_id);
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function startTaskReminderWorker(pool, insertNotification) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      for (let count = 0; count < 100; count++) {
        if (!await createDueTaskReminder(pool, insertNotification)) break;
      }
    } catch (error) {
      console.error('Envoi des rappels de tâches impossible :', error);
    } finally {
      running = false;
    }
  };
  void run();
  const timer = setInterval(run, 60 * 1000);
  timer.unref();
  return timer;
}

module.exports = { createDueTaskReminder, startTaskReminderWorker };
