async function createDueBirthdayReminder(pool, insertNotification, now = new Date()) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `WITH today AS (
         SELECT ($1::timestamptz AT TIME ZONE 'Europe/Paris')::date AS day,
                ($1::timestamptz AT TIME ZONE 'Europe/Paris')::time AS time
       )
       SELECT event.id, event.owner_user_id, event.title,
              EXTRACT(YEAR FROM today.day)::integer AS reminder_year,
              (EXTRACT(YEAR FROM today.day) - EXTRACT(YEAR FROM event.birth_date))::integer AS age
       FROM app_personal_events event
       JOIN app_users owner ON owner.id = event.owner_user_id AND owner.is_active = TRUE
       CROSS JOIN today
       WHERE event.birth_date IS NOT NULL AND event.birth_date <= today.day
         AND today.time >= TIME '09:00'
         AND EXTRACT(MONTH FROM event.birth_date) = EXTRACT(MONTH FROM today.day)
         AND EXTRACT(DAY FROM today.day) = LEAST(
           EXTRACT(DAY FROM event.birth_date),
           EXTRACT(DAY FROM (date_trunc('month', today.day) + INTERVAL '1 month - 1 day'))
         )
         AND event.birthday_last_reminded_year IS DISTINCT FROM EXTRACT(YEAR FROM today.day)::integer
       ORDER BY event.id
       LIMIT 1
       FOR UPDATE OF event SKIP LOCKED
       FOR SHARE OF owner`,
      [now]
    );
    if (!rows.length) {
      await client.query('COMMIT');
      return false;
    }
    const birthday = rows[0];
    await client.query('UPDATE app_personal_events SET birthday_last_reminded_year = $2 WHERE id = $1',
      [birthday.id, birthday.reminder_year]);
    await insertNotification(client, birthday.owner_user_id, 'birthday_reminder', 'Rappel d’anniversaire',
      `${birthday.title} : ${birthday.age} ans aujourd’hui.`, 'birthday', birthday.id);
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function startBirthdayReminderWorker(pool, insertNotification) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      for (let count = 0; count < 100; count++) {
        if (!await createDueBirthdayReminder(pool, insertNotification)) break;
      }
    } catch (error) {
      console.error('Envoi des rappels d’anniversaire impossible :', error);
    } finally {
      running = false;
    }
  };
  void run();
  const timer = setInterval(run, 60 * 1000);
  timer.unref();
  return timer;
}

module.exports = { createDueBirthdayReminder, startBirthdayReminderWorker };
