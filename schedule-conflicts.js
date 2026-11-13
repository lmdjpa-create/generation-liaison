const { AuthError } = require('./auth');

async function lockScheduleParticipants(client, professionalId, seniorId) {
  const seniorIds = Array.isArray(seniorId) ? seniorId : [seniorId];
  const keys = [...new Set([professionalId && `professional:${professionalId}`,
    ...seniorIds.filter(Boolean).map(id => `senior:${id}`)].filter(Boolean))].sort();
  for (const key of keys) {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
  }
}

async function assertScheduleAvailable(client, {
  professionalId, seniorId, start, durationMinutes, excludeKind = null, excludeId = null
}) {
  const end = new Date(new Date(start).getTime() + durationMinutes * 60000);
  const { rows } = await client.query(
    `SELECT 1
     FROM (
       SELECT 'directory' AS kind, booking.id, booking.scheduled_at AS start_at,
              booking.scheduled_at + booking.duration_minutes * INTERVAL '1 minute' AS end_at,
              booking.professional_user_id, booking.senior_profile_id AS senior_id
       FROM app_directory_bookings booking
       WHERE booking.status = 'confirmed'
          OR (booking.status = 'pending' AND booking.hold_expires_at > CURRENT_TIMESTAMP)
       UNION ALL
       SELECT 'directory', booking.id, booking.scheduled_at,
              booking.scheduled_at + booking.duration_minutes * INTERVAL '1 minute',
              booking.professional_user_id, link.senior_profile_id
       FROM app_directory_bookings booking
       JOIN app_users requester ON requester.id = booking.requester_user_id AND requester.role = 'aidant'
       JOIN app_aidant_senior_links link ON link.aidant_user_id = requester.id
       WHERE booking.senior_profile_id IS NULL
         AND (booking.status = 'confirmed'
           OR (booking.status = 'pending' AND booking.hold_expires_at > CURRENT_TIMESTAMP))
       UNION ALL
       SELECT 'visit', visit.id, visit.scheduled_at,
              visit.scheduled_at + visit.duration_minutes * INTERVAL '1 minute',
              visit.assigned_user_id, recipient.senior_id
       FROM planning_visits visit
       JOIN planning_recipients recipient ON recipient.id = visit.recipient_id
         AND recipient.organization_id = visit.organization_id
       WHERE visit.acceptance_status = 'accepted'
       UNION ALL
       SELECT 'service', booking.id, booking.requested_at,
              booking.requested_at + INTERVAL '30 minutes',
              partner.user_id, recipient.senior_id
       FROM planning_service_bookings booking
       JOIN planning_service_partners partner ON partner.id = booking.partner_id
         AND partner.organization_id = booking.organization_id
       JOIN planning_recipients recipient ON recipient.id = booking.recipient_id
         AND recipient.organization_id = booking.organization_id
       WHERE booking.status IN ('confirmed', 'completed')
     ) existing
     WHERE (existing.professional_user_id = $1 OR existing.senior_id = $2)
       AND existing.start_at < $4 AND existing.end_at > $3
       AND ($6::uuid IS NULL OR existing.kind <> $5 OR existing.id <> $6::uuid)
     LIMIT 1`,
    [professionalId, seniorId, new Date(start), end, excludeKind, excludeId]
  );
  if (rows.length) {
    throw new AuthError(409, 'Ce créneau chevauche un rendez-vous déjà réservé pour l’intervenant ou la personne accompagnée.');
  }
}

async function assertLegacyBookingsSafeForLink(client, aidantId, seniorId) {
  const { rows } = await client.query(
    `SELECT booking.id, booking.scheduled_at, booking.duration_minutes,
            EXISTS (
              SELECT 1 FROM app_directory_bookings other
              WHERE other.requester_user_id = booking.requester_user_id
                AND other.senior_profile_id IS NULL AND other.id <> booking.id
                AND (other.status = 'confirmed'
                  OR (other.status = 'pending' AND other.hold_expires_at > CURRENT_TIMESTAMP))
                AND other.scheduled_at < booking.scheduled_at + booking.duration_minutes * INTERVAL '1 minute'
                AND other.scheduled_at + other.duration_minutes * INTERVAL '1 minute' > booking.scheduled_at
            ) AS has_legacy_overlap
     FROM app_directory_bookings booking
     WHERE booking.requester_user_id = $1 AND booking.senior_profile_id IS NULL
       AND (booking.status = 'confirmed'
         OR (booking.status = 'pending' AND booking.hold_expires_at > CURRENT_TIMESTAMP))
       AND booking.scheduled_at + booking.duration_minutes * INTERVAL '1 minute' > CURRENT_TIMESTAMP`,
    [aidantId]
  );
  for (const booking of rows) {
    if (booking.has_legacy_overlap) {
      throw new AuthError(409, 'Des anciennes réservations de cet aidant se chevauchent ; elles doivent être identifiées avant cette association.');
    }
    try {
      await assertScheduleAvailable(client, {
        professionalId: null, seniorId, start: booking.scheduled_at,
        durationMinutes: booking.duration_minutes, excludeKind: 'directory', excludeId: booking.id
      });
    } catch (error) {
      if (error.status !== 409) throw error;
      throw new AuthError(409, 'Une ancienne réservation de cet aidant chevauche un rendez-vous de cette personne ; identifiez-la avant cette association.');
    }
  }
}

module.exports = { assertLegacyBookingsSafeForLink, assertScheduleAvailable, lockScheduleParticipants };
