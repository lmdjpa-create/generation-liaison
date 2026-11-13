const { createHash, randomUUID } = require('node:crypto');
const { AuthError } = require('./auth');
const { assertScheduleAvailable, lockScheduleParticipants } = require('./schedule-conflicts');

function googleEventId() {
  return `gl${randomUUID().replace(/-/g, '')}`;
}

function connectionKey(encryptedToken) {
  return createHash('sha256').update(encryptedToken).digest('hex');
}

const RECONNECTED_MESSAGE = 'La connexion Google a changé. Confirmez que vous avez reconnecté le même agenda avant de reprendre la synchronisation.';

function eventTimes(event) {
  if (!event || event.status === 'cancelled') return { action: 'cancel', etag: event?.etag || null };
  if (!event.etag || !event.start?.dateTime || !event.end?.dateTime) {
    throw new AuthError(409, 'L’événement Google doit avoir une heure de début et de fin.');
  }
  const start = new Date(event.start.dateTime);
  const end = new Date(event.end.dateTime);
  const duration = (end - start) / 60000;
  if (!Number.isFinite(start.getTime()) || !Number.isInteger(duration)) {
    throw new AuthError(409, 'La date ou la durée de l’événement Google est invalide.');
  }
  return { action: 'move', etag: event.etag, start: start.toISOString(), duration };
}

function sameTimes(change, start, duration) {
  return change.action === 'move' &&
    change.start === new Date(start).toISOString() && change.duration === duration;
}

function sameChange(left, right) {
  return left && right && left.action === right.action && left.etag === right.etag &&
    left.start === right.start && left.duration === right.duration;
}

function ensureOwnedEvent(event, syncId) {
  if (event && event.status !== 'cancelled' &&
      event.extendedProperties?.private?.generationLiaisonSyncId !== syncId) {
    throw new AuthError(409, 'Cet événement Google ne correspond plus au rendez-vous synchronisé.');
  }
}

async function getCurrentAppointment(client, sync) {
  const { rows } = await client.query(sync.entity_kind === 'visit'
    ? `SELECT visit.scheduled_at, visit.duration_minutes, visit.status, recipient.senior_id
       FROM planning_visits visit
       JOIN planning_recipients recipient ON recipient.id = visit.recipient_id
         AND recipient.organization_id = visit.organization_id
       WHERE visit.id = $1 AND visit.assigned_user_id = $2
         AND visit.acceptance_status = 'accepted'
         AND EXISTS (SELECT 1 FROM planning_org_members member
           WHERE member.organization_id = visit.organization_id
             AND member.user_id = visit.assigned_user_id AND member.role = 'professional')
         AND recipient.consent_at IS NOT NULL AND recipient.consent_revoked_at IS NULL`
    : `SELECT booking.requested_at AS scheduled_at, 30 AS duration_minutes,
              booking.status, recipient.senior_id
       FROM planning_service_bookings booking
       JOIN planning_service_partners partner ON partner.id = booking.partner_id
         AND partner.organization_id = booking.organization_id
       JOIN planning_recipients recipient ON recipient.id = booking.recipient_id
         AND recipient.organization_id = booking.organization_id
       WHERE booking.id = $1 AND partner.user_id = $2
         AND booking.status IN ('confirmed', 'completed')
         AND EXISTS (SELECT 1 FROM planning_org_members member
           WHERE member.organization_id = booking.organization_id
             AND member.user_id = partner.user_id AND member.role = 'professional')
         AND recipient.consent_at IS NOT NULL AND recipient.consent_revoked_at IS NULL`,
    [sync.entity_id, sync.professional_id]
  );
  return rows[0] || null;
}

function validateChange(change, sync) {
  if (change.action === 'cancel') return;
  if (Date.parse(change.start) <= Date.now() ||
      change.duration < 15 || change.duration > 480 ||
      (sync.entity_kind === 'service' && change.duration !== 30)) {
    throw new AuthError(409, sync.entity_kind === 'service'
      ? 'Le service Google doit être futur et durer 30 minutes.'
      : 'La visite Google doit être future et durer de 15 à 480 minutes.');
  }
}

function createPlanningGoogleSync({ pool, calendar, getAccessToken, notify }) {
  let workerError = null;
  async function familyHasAccess(client, user, seniorId) {
    if (!user || user.seniorId !== seniorId) return false;
    if (user.role === 'senior') {
      const { rows } = await client.query(
        `SELECT id FROM app_users WHERE id = $1 AND role = 'senior'
         AND senior_id = $2 AND is_active = TRUE FOR SHARE`,
        [user.id, seniorId]
      );
      return Boolean(rows[0]);
    }
    if (user.role !== 'aidant') return false;
    const { rows } = await client.query(
      `SELECT link.senior_profile_id FROM app_aidant_senior_links link
       JOIN app_users aidant ON aidant.id = link.aidant_user_id
       JOIN app_users senior ON senior.senior_id = link.senior_profile_id
         AND senior.role = 'senior' AND senior.is_active = TRUE
       WHERE link.aidant_user_id = $1 AND link.senior_profile_id = $2
         AND link.suspended_at IS NULL AND aidant.is_active = TRUE
         AND (aidant.is_legal_guardian = FALSE OR aidant.guardian_verification_status = 'approved')
       FOR SHARE OF link, aidant, senior`,
      [user.id, seniorId]
    );
    return Boolean(rows[0]);
  }
  async function notifyParticipants(client, sync, title, message) {
    const { rows } = await client.query(
      `SELECT account.id FROM app_users account
       WHERE account.is_active = TRUE AND (
         account.id = $1 OR (account.role = 'senior' AND account.senior_id = $2)
         OR (account.role = 'aidant'
           AND (account.is_legal_guardian = FALSE OR account.guardian_verification_status = 'approved')
           AND EXISTS (
             SELECT 1 FROM app_aidant_senior_links link
             JOIN app_users senior ON senior.senior_id = link.senior_profile_id
               AND senior.role = 'senior' AND senior.is_active = TRUE
             WHERE link.aidant_user_id = account.id AND link.senior_profile_id = $2
               AND link.suspended_at IS NULL)))`,
      [sync.professional_id, sync.senior_id]
    );
    for (const row of rows) {
      await notify(client, row.id, 'google_schedule_change', title, message, 'google_schedule_change', sync.id);
    }
  }

  async function seed() {
    const { rows } = await pool.query(
      `SELECT 'visit' AS entity_kind, visit.id AS entity_id, visit.assigned_user_id AS professional_id,
              recipient.senior_id, visit.scheduled_at, visit.duration_minutes,
              professional.google_calendar_refresh_token
       FROM planning_visits visit
       JOIN planning_recipients recipient ON recipient.id = visit.recipient_id
         AND recipient.organization_id = visit.organization_id
       JOIN app_users professional ON professional.id = visit.assigned_user_id
       WHERE visit.acceptance_status = 'accepted' AND visit.status = 'scheduled'
         AND visit.scheduled_at > CURRENT_TIMESTAMP
         AND EXISTS (SELECT 1 FROM planning_org_members member
           WHERE member.organization_id = visit.organization_id
             AND member.user_id = visit.assigned_user_id AND member.role = 'professional')
         AND recipient.consent_at IS NOT NULL AND recipient.consent_revoked_at IS NULL
         AND professional.is_active = TRUE AND professional.verification_status = 'approved'
         AND professional.planning_google_sync_enabled = TRUE
         AND professional.google_calendar_refresh_token IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM planning_google_events sync
           WHERE sync.professional_id = professional.id AND sync.entity_kind = 'visit'
             AND sync.entity_id = visit.id AND sync.state <> 'retired')
       UNION ALL
       SELECT 'service', booking.id, partner.user_id, recipient.senior_id, booking.requested_at, 30,
              professional.google_calendar_refresh_token
       FROM planning_service_bookings booking
       JOIN planning_service_partners partner ON partner.id = booking.partner_id
         AND partner.organization_id = booking.organization_id
       JOIN planning_recipients recipient ON recipient.id = booking.recipient_id
         AND recipient.organization_id = booking.organization_id
       JOIN app_users professional ON professional.id = partner.user_id
       WHERE booking.status = 'confirmed' AND booking.requested_at > CURRENT_TIMESTAMP
         AND EXISTS (SELECT 1 FROM planning_org_members member
           WHERE member.organization_id = booking.organization_id
             AND member.user_id = partner.user_id AND member.role = 'professional')
         AND recipient.consent_at IS NOT NULL AND recipient.consent_revoked_at IS NULL
         AND professional.is_active = TRUE AND professional.verification_status = 'approved'
         AND professional.planning_google_sync_enabled = TRUE
         AND professional.google_calendar_refresh_token IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM planning_google_events sync
           WHERE sync.professional_id = professional.id AND sync.entity_kind = 'service'
             AND sync.entity_id = booking.id AND sync.state <> 'retired')
       LIMIT 100`
    );
    for (const row of rows) {
      await pool.query(
        `INSERT INTO planning_google_events
           (id, professional_id, senior_id, entity_kind, entity_id, google_event_id, snapshot_start, snapshot_duration, connection_key)
         SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9
         FROM app_users professional
         WHERE professional.id = $2 AND professional.is_active = TRUE
           AND professional.verification_status = 'approved'
           AND professional.planning_google_sync_enabled = TRUE
           AND professional.google_calendar_refresh_token = $10
         ON CONFLICT (professional_id, entity_kind, entity_id) DO UPDATE
           SET google_event_id = EXCLUDED.google_event_id,
               senior_id = EXCLUDED.senior_id, snapshot_start = EXCLUDED.snapshot_start,
               snapshot_duration = EXCLUDED.snapshot_duration, connection_key = EXCLUDED.connection_key,
               state = 'new', proposal = NULL, last_error = NULL, last_checked_at = NULL
         WHERE planning_google_events.state = 'retired'`,
        [randomUUID(), row.professional_id, row.senior_id, row.entity_kind, row.entity_id,
          googleEventId(), row.scheduled_at, row.duration_minutes,
          connectionKey(row.google_calendar_refresh_token), row.google_calendar_refresh_token]
      );
    }
  }

  async function processOne(id) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT sync.*, professional.google_calendar_refresh_token
         FROM planning_google_events sync
         JOIN app_users professional ON professional.id = sync.professional_id
         WHERE sync.id = $1 AND sync.state <> 'retired'
           AND professional.is_active = TRUE AND professional.verification_status = 'approved'
           AND professional.planning_google_sync_enabled = TRUE
           AND professional.google_calendar_refresh_token IS NOT NULL
         FOR UPDATE OF sync SKIP LOCKED`,
        [id]
      );
      const sync = rows[0];
      if (!sync) {
        await client.query('ROLLBACK');
        return;
      }
      const { rows: owners } = await client.query(
        `SELECT google_calendar_refresh_token, planning_google_sync_enabled, is_active, verification_status
         FROM app_users WHERE id = $1 FOR SHARE`,
        [sync.professional_id]
      );
      const owner = owners[0];
      if (!owner || !owner.is_active || owner.verification_status !== 'approved' ||
          !owner.planning_google_sync_enabled || !owner.google_calendar_refresh_token) {
        await client.query('ROLLBACK');
        return;
      }
      sync.google_calendar_refresh_token = owner.google_calendar_refresh_token;
      if (sync.connection_key !== connectionKey(sync.google_calendar_refresh_token)) {
        throw new AuthError(409, RECONNECTED_MESSAGE);
      }
      const appointment = await getCurrentAppointment(client, sync);
      if (appointment && (appointment.status === 'completed' ||
          new Date(appointment.scheduled_at).getTime() + appointment.duration_minutes * 60000 <= Date.now())) {
        if (sync.proposal) {
          await notifyParticipants(client, sync, 'Modification Google expirée',
            'Le rendez-vous est terminé. La modification Google n’a pas été appliquée.');
        }
        await client.query('DELETE FROM planning_google_events WHERE id = $1', [id]);
        await client.query('COMMIT');
        return;
      }
      const token = await getAccessToken(sync.google_calendar_refresh_token);
      let remote = await calendar.getPlanningEvent(token, sync.google_event_id);
      ensureOwnedEvent(remote, sync.id);

      if (!appointment) {
        if (remote && remote.status !== 'cancelled') {
          const remoteChange = eventTimes(remote);
          if (!sameTimes(remoteChange, sync.snapshot_start, sync.snapshot_duration)) {
            throw new AuthError(409, 'Le rendez-vous a changé dans les deux agendas. Vérifiez manuellement l’événement Google.');
          }
          await calendar.deletePlanningEvent(token, sync.google_event_id, remote.etag);
        }
        await client.query('DELETE FROM planning_google_events WHERE id = $1', [id]);
      } else if (sync.state === 'new') {
        if (!remote) {
          const start = new Date(appointment.scheduled_at);
          const end = new Date(start.getTime() + appointment.duration_minutes * 60000);
          try {
            remote = await calendar.createPlanningEvent(token, {
              eventId: sync.google_event_id, syncId: sync.id, start, end
            });
          } catch (error) {
            if (error.status !== 409) throw error;
            remote = await calendar.getPlanningEvent(token, sync.google_event_id);
          }
        }
        ensureOwnedEvent(remote, sync.id);
        if (!remote || !sameTimes(eventTimes(remote), appointment.scheduled_at, appointment.duration_minutes)) {
          throw new AuthError(409, 'Impossible de confirmer la création de l’événement Google.');
        }
        await client.query(
          `UPDATE planning_google_events SET state = 'active', snapshot_start = $2,
           snapshot_duration = $3, last_error = NULL, last_checked_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [id, appointment.scheduled_at, appointment.duration_minutes]
        );
      } else {
        const change = eventTimes(remote);
        const appUnchanged = new Date(sync.snapshot_start).getTime() === new Date(appointment.scheduled_at).getTime() &&
          sync.snapshot_duration === appointment.duration_minutes;
        if (sync.state === 'restore') {
          if (!sameChange(change, sync.proposal)) {
            await notifyParticipants(client, sync, 'Événement Google modifié à nouveau',
              'L’événement a changé pendant la restauration. Le planning reste inchangé et une nouvelle vérification est nécessaire.');
            await client.query(
              `UPDATE planning_google_events SET state = 'active', proposal = NULL,
               last_error = NULL, last_checked_at = NULL WHERE id = $1`, [id]
            );
          } else if (!remote) {
            await client.query(
              `UPDATE planning_google_events SET state = 'new', google_event_id = $2,
               proposal = NULL, last_error = NULL, last_checked_at = NULL WHERE id = $1`,
              [id, googleEventId()]
            );
          } else {
            const start = new Date(appointment.scheduled_at);
            await calendar.updatePlanningEvent(token, sync.google_event_id, remote.etag, {
              start, end: new Date(start.getTime() + appointment.duration_minutes * 60000)
            });
            await client.query(
              `UPDATE planning_google_events SET state = 'active', proposal = NULL,
               snapshot_start = $2, snapshot_duration = $3, last_error = NULL,
               last_checked_at = CURRENT_TIMESTAMP WHERE id = $1`,
              [id, appointment.scheduled_at, appointment.duration_minutes]
            );
          }
        } else if (!appUnchanged) {
          if (!sameTimes(change, sync.snapshot_start, sync.snapshot_duration)) {
            throw new AuthError(409, 'Le rendez-vous a changé dans les deux agendas. Vérifiez manuellement l’événement Google.');
          }
          const start = new Date(appointment.scheduled_at);
          await calendar.updatePlanningEvent(token, sync.google_event_id, remote.etag, {
            start, end: new Date(start.getTime() + appointment.duration_minutes * 60000)
          });
          await client.query(
            `UPDATE planning_google_events SET snapshot_start = $2, snapshot_duration = $3,
             proposal = NULL, last_error = NULL, last_checked_at = CURRENT_TIMESTAMP WHERE id = $1`,
            [id, appointment.scheduled_at, appointment.duration_minutes]
          );
        } else if (sameTimes(change, sync.snapshot_start, sync.snapshot_duration)) {
          if (sync.proposal) {
            await notifyParticipants(client, sync, 'Demande Google retirée',
              'L’événement Google est revenu à l’horaire du planning. Aucune modification du rendez-vous n’a été appliquée.');
          }
          await client.query(
            `UPDATE planning_google_events SET proposal = NULL, last_error = NULL,
             last_checked_at = CURRENT_TIMESTAMP WHERE id = $1`, [id]
          );
        } else {
          validateChange(change, sync);
          const proposal = sameChange(change, sync.proposal)
            ? sync.proposal : { ...change, professionalApproved: false, familyApproved: false };
          await client.query(
            `UPDATE planning_google_events SET proposal = $2::jsonb, last_error = NULL,
             last_checked_at = CURRENT_TIMESTAMP WHERE id = $1`, [id, JSON.stringify(proposal)]
          );
          if (!sameChange(change, sync.proposal)) {
            await notifyParticipants(client, sync, 'Modification Google à valider',
              'Une modification de rendez-vous attend l’accord de l’intervenant et de la personne accompagnée dans l’Agenda.');
          }
        }
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Synchronisation du rendez-vous Google impossible :', error);
      await pool.query(
        `UPDATE planning_google_events SET last_error = $2, last_checked_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [id, error instanceof AuthError ? error.message : 'Synchronisation Google impossible. Vérifiez la connexion puis réessayez.']
      );
    } finally {
      client.release();
    }
  }

  async function run() {
    try {
      await seed();
      const { rows } = await pool.query(
        `SELECT sync.id FROM planning_google_events sync
         JOIN app_users professional ON professional.id = sync.professional_id
         WHERE sync.state <> 'retired' AND professional.is_active = TRUE
           AND professional.verification_status = 'approved'
           AND professional.planning_google_sync_enabled = TRUE
           AND professional.google_calendar_refresh_token IS NOT NULL
         ORDER BY sync.last_checked_at ASC NULLS FIRST, sync.id LIMIT 50`
      );
      for (const row of rows) await processOne(row.id);
      workerError = null;
    } catch (error) {
      workerError = 'Le service de synchronisation du planning est indisponible. Réessayez plus tard.';
      throw error;
    }
  }

  async function list(user) {
    const { rows } = await pool.query(
      `SELECT sync.id, sync.entity_kind, sync.snapshot_start, sync.snapshot_duration,
              sync.proposal, sync.state, sync.last_error, professional.planning_google_sync_enabled
       FROM planning_google_events sync
       JOIN app_users professional ON professional.id = sync.professional_id
       WHERE sync.state <> 'retired'
         AND (($1 = 'pro' AND sync.professional_id = $2)
           OR ($1 IN ('senior', 'aidant') AND sync.senior_id = $3
             AND (($1 = 'senior' AND EXISTS (
               SELECT 1 FROM app_users senior WHERE senior.id = $2 AND senior.role = 'senior'
                 AND senior.is_active = TRUE AND senior.senior_id = $3))
              OR ($1 = 'aidant' AND EXISTS (
               SELECT 1 FROM app_aidant_senior_links link
               JOIN app_users aidant ON aidant.id = link.aidant_user_id
               JOIN app_users senior ON senior.senior_id = link.senior_profile_id
                 AND senior.role = 'senior' AND senior.is_active = TRUE
               WHERE link.aidant_user_id = $2 AND link.senior_profile_id = $3
                 AND link.suspended_at IS NULL AND aidant.is_active = TRUE
                 AND (aidant.is_legal_guardian = FALSE OR aidant.guardian_verification_status = 'approved'))))
             AND EXISTS (
               SELECT 1 FROM planning_visits visit
               JOIN planning_recipients recipient ON recipient.id = visit.recipient_id
                 AND recipient.organization_id = visit.organization_id
               WHERE sync.entity_kind = 'visit' AND visit.id = sync.entity_id
                 AND visit.assigned_user_id = sync.professional_id AND visit.acceptance_status = 'accepted'
                 AND EXISTS (SELECT 1 FROM planning_org_members member
                   WHERE member.organization_id = visit.organization_id
                     AND member.user_id = visit.assigned_user_id AND member.role = 'professional')
                 AND recipient.consent_at IS NOT NULL AND recipient.consent_revoked_at IS NULL
               UNION ALL
               SELECT 1 FROM planning_service_bookings booking
               JOIN planning_recipients recipient ON recipient.id = booking.recipient_id
                 AND recipient.organization_id = booking.organization_id
               JOIN planning_service_partners partner ON partner.id = booking.partner_id
                 AND partner.organization_id = booking.organization_id
               WHERE sync.entity_kind = 'service' AND booking.id = sync.entity_id
                 AND partner.user_id = sync.professional_id AND booking.status = 'confirmed'
                 AND EXISTS (SELECT 1 FROM planning_org_members member
                   WHERE member.organization_id = booking.organization_id
                     AND member.user_id = partner.user_id AND member.role = 'professional')
                 AND recipient.consent_at IS NOT NULL AND recipient.consent_revoked_at IS NULL
             )))
         AND (sync.proposal IS NOT NULL OR sync.last_error IS NOT NULL)
       ORDER BY sync.snapshot_start`,
      [user.role, user.id, user.seniorId]
    );
    return rows.map(row => ({
      id: row.id, kind: row.entity_kind, scheduledAt: row.snapshot_start,
      durationMinutes: row.snapshot_duration, state: row.state,
      proposal: row.proposal ? (({ familyApprovedBy, ...publicProposal }) => publicProposal)(row.proposal) : null,
      error: user.role === 'pro' ? row.last_error
        : row.last_error ? 'La synchronisation Google est interrompue. L’intervenant doit vérifier son agenda.' : null,
      paused: !row.planning_google_sync_enabled,
      needsReconnect: user.role === 'pro' && row.last_error === RECONNECTED_MESSAGE
    }));
  }

  async function respond(user, id, decision) {
    if (!['approve', 'reject'].includes(decision)) {
      throw new AuthError(400, 'Choisissez si vous acceptez ou refusez la modification.');
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT sync.*, professional.google_calendar_refresh_token, professional.planning_google_sync_enabled
         FROM planning_google_events sync
         JOIN app_users professional ON professional.id = sync.professional_id
         WHERE sync.id = $1 AND sync.state = 'active' AND sync.proposal IS NOT NULL
           AND professional.is_active = TRUE AND professional.verification_status = 'approved'
           AND professional.google_calendar_refresh_token IS NOT NULL
         FOR UPDATE OF sync`,
        [id]
      );
      const sync = rows[0];
      if (sync) await lockScheduleParticipants(client, sync.professional_id, sync.senior_id);
      const isProfessional = user.role === 'pro' && sync?.professional_id === user.id;
      const isFamily = sync && await familyHasAccess(client, user, sync.senior_id);
      if (!sync || (!isProfessional && !isFamily)) {
        throw new AuthError(404, 'Demande de modification introuvable ou non autorisée.');
      }
      const approvalKey = isProfessional ? 'professionalApproved' : 'familyApproved';
      const { rows: owners } = await client.query(
        `SELECT google_calendar_refresh_token, planning_google_sync_enabled, is_active, verification_status
         FROM app_users WHERE id = $1 FOR SHARE`,
        [sync.professional_id]
      );
      const owner = owners[0];
      if (!owner?.is_active || owner.verification_status !== 'approved' ||
          !owner.google_calendar_refresh_token) {
        throw new AuthError(409, 'L’intervenant ou sa connexion Google n’est plus disponible.');
      }
      sync.google_calendar_refresh_token = owner.google_calendar_refresh_token;
      if (!owner.planning_google_sync_enabled) {
        throw new AuthError(409, 'L’intervenant a mis la synchronisation Google en pause.');
      }
      if (sync.connection_key !== connectionKey(sync.google_calendar_refresh_token)) {
        throw new AuthError(409, RECONNECTED_MESSAGE);
      }
      const appointment = await getCurrentAppointment(client, sync);
      if (!appointment || appointment.senior_id !== sync.senior_id ||
          appointment.status === 'completed' || new Date(appointment.scheduled_at) <= new Date() ||
          new Date(appointment.scheduled_at).getTime() !== new Date(sync.snapshot_start).getTime() ||
          appointment.duration_minutes !== sync.snapshot_duration) {
        throw new AuthError(409, 'Le rendez-vous a changé dans l’application. Actualisez l’agenda.');
      }
      const token = await getAccessToken(sync.google_calendar_refresh_token);
      const remote = await calendar.getPlanningEvent(token, sync.google_event_id);
      ensureOwnedEvent(remote, sync.id);
      const change = eventTimes(remote);
      if (!sameChange(change, sync.proposal)) {
        throw new AuthError(409, 'L’événement Google a changé depuis cette demande. Actualisez l’agenda.');
      }
      if (decision === 'reject') {
        await client.query(
          `UPDATE planning_google_events SET state = 'restore', last_error = NULL,
           last_checked_at = NULL WHERE id = $1`, [id]
        );
        await notifyParticipants(client, sync, 'Modification Google refusée',
          'Le rendez-vous reste inchangé. La restauration de l’événement Google est en attente.');
        await client.query('COMMIT');
        return { status: 'restoring' };
      }
      validateChange(change, sync);
      const proposal = { ...sync.proposal };
      if (isProfessional && proposal.familyApproved &&
          !await familyHasAccess(client, proposal.familyApprovedBy, sync.senior_id)) {
        proposal.familyApproved = false;
        delete proposal.familyApprovedBy;
      }
      if (proposal[approvalKey]) {
        throw new AuthError(409, 'Vous avez déjà validé cette modification.');
      }
      proposal[approvalKey] = true;
      if (isFamily) proposal.familyApprovedBy = { id: user.id, role: user.role, seniorId: sync.senior_id };
      if (!proposal.professionalApproved || !proposal.familyApproved) {
        await client.query(
          `UPDATE planning_google_events SET proposal = $2::jsonb WHERE id = $1`,
          [id, JSON.stringify(proposal)]
        );
        await client.query('COMMIT');
        return { status: 'waiting' };
      }

      if (change.action === 'move') {
        await assertScheduleAvailable(client, {
          professionalId: sync.professional_id, seniorId: sync.senior_id,
          start: change.start, durationMinutes: change.duration,
          excludeKind: sync.entity_kind, excludeId: sync.entity_id
        });
        const start = new Date(change.start);
        const end = new Date(start.getTime() + change.duration * 60000);
        if (await calendar.hasOtherBusyEvents(token, start, end, sync.google_event_id)) {
          throw new AuthError(409, 'Ce créneau chevauche un autre événement occupé dans Google Calendar.');
        }
        await calendar.updatePlanningEvent(token, sync.google_event_id, change.etag, {
          start, end
        });
      } else if (remote && remote.status !== 'cancelled') {
        await calendar.deletePlanningEvent(token, sync.google_event_id, remote.etag);
      }
      const { rows: updated } = await client.query(sync.entity_kind === 'visit'
        ? `UPDATE planning_visits visit
           SET scheduled_at = CASE WHEN $5 = 'move' THEN $6::timestamptz ELSE visit.scheduled_at END,
               duration_minutes = CASE WHEN $5 = 'move' THEN $7::smallint ELSE visit.duration_minutes END,
               acceptance_status = CASE WHEN $5 = 'cancel' THEN 'cancelled' ELSE visit.acceptance_status END
           FROM planning_recipients recipient
           WHERE visit.id = $1 AND visit.assigned_user_id = $2 AND visit.scheduled_at = $3
             AND visit.duration_minutes = $4 AND visit.status = 'scheduled'
             AND visit.acceptance_status = 'accepted'
             AND EXISTS (SELECT 1 FROM planning_org_members member
               WHERE member.organization_id = visit.organization_id
                 AND member.user_id = visit.assigned_user_id AND member.role = 'professional')
             AND recipient.id = visit.recipient_id AND recipient.organization_id = visit.organization_id
             AND recipient.senior_id = $8 AND recipient.consent_at IS NOT NULL
             AND recipient.consent_revoked_at IS NULL
           RETURNING visit.id`
        : `UPDATE planning_service_bookings booking
           SET requested_at = CASE WHEN $5 = 'move' THEN $6::timestamptz ELSE booking.requested_at END,
               status = CASE WHEN $5 = 'cancel' THEN 'cancelled' ELSE booking.status END,
               updated_at = CURRENT_TIMESTAMP
           FROM planning_service_partners partner, planning_recipients recipient
           WHERE booking.id = $1 AND partner.id = booking.partner_id
             AND partner.organization_id = booking.organization_id AND partner.user_id = $2
             AND booking.requested_at = $3 AND booking.status = 'confirmed' AND $4::smallint = 30
             AND EXISTS (SELECT 1 FROM planning_org_members member
               WHERE member.organization_id = booking.organization_id
                 AND member.user_id = partner.user_id AND member.role = 'professional')
             AND recipient.id = booking.recipient_id AND recipient.organization_id = booking.organization_id
             AND recipient.senior_id = $8 AND recipient.consent_at IS NOT NULL
             AND recipient.consent_revoked_at IS NULL
             AND ($5 <> 'move' OR $7::smallint = 30)
           RETURNING booking.id`,
        [sync.entity_id, sync.professional_id, sync.snapshot_start, sync.snapshot_duration,
          change.action, change.start || null, change.duration || null, sync.senior_id]
      );
      if (!updated[0]) {
        throw new AuthError(409, 'Le rendez-vous a changé dans l’application. Actualisez l’agenda.');
      }
      await client.query(
        `UPDATE planning_google_events SET proposal = NULL, last_error = NULL,
         snapshot_start = COALESCE($2::timestamptz, snapshot_start),
         snapshot_duration = COALESCE($3::smallint, snapshot_duration),
         last_checked_at = NULL WHERE id = $1`,
        [id, change.start || null, change.duration || null]
      );
      await notifyParticipants(client, sync,
        change.action === 'cancel' ? 'Rendez-vous annulé' : 'Rendez-vous déplacé',
        'La modification Google a été validée par l’intervenant et la personne accompagnée.');
      await client.query('COMMIT');
      return { status: 'applied' };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async function confirmReconnect(user) {
    if (user.role !== 'pro') {
      throw new AuthError(403, 'Seul l’intervenant peut confirmer sa connexion Google.');
    }
    const { rows } = await pool.query(
      `SELECT google_calendar_refresh_token, planning_google_sync_enabled FROM app_users
       WHERE id = $1 AND is_active = TRUE AND verification_status = 'approved'
         AND google_calendar_refresh_token IS NOT NULL`,
      [user.id]
    );
    if (!rows[0]) throw new AuthError(409, 'Connectez d’abord votre agenda Google.');
    if (rows[0].planning_google_sync_enabled) {
      throw new AuthError(409, 'Mettez d’abord la synchronisation en pause.');
    }
    await pool.query(
      `UPDATE planning_google_events sync SET connection_key = $2, last_error = NULL, last_checked_at = NULL
       FROM app_users professional
       WHERE sync.professional_id = $1 AND sync.state <> 'retired'
         AND professional.id = sync.professional_id
         AND professional.planning_google_sync_enabled = FALSE
         AND professional.google_calendar_refresh_token = $3`,
      [user.id, connectionKey(rows[0].google_calendar_refresh_token), rows[0].google_calendar_refresh_token]
    );
    if ((await getSettings(user)).needsReconnect) {
      throw new AuthError(409, 'La connexion a changé pendant la confirmation. Réessayez.');
    }
  }

  async function getSettings(user) {
    if (user.role !== 'pro') throw new AuthError(403, 'Cette synchronisation est réservée aux intervenants.');
    const { rows } = await pool.query(
      `SELECT planning_google_sync_enabled, google_calendar_refresh_token
       FROM app_users WHERE id = $1 AND role = 'pro'`,
      [user.id]
    );
    if (!rows[0]) throw new AuthError(404, 'Compte intervenant introuvable.');
    const token = rows[0].google_calendar_refresh_token;
    let needsReconnect = false;
    if (token) {
      const { rows: mismatches } = await pool.query(
        `SELECT 1 FROM planning_google_events
         WHERE professional_id = $1 AND state <> 'retired' AND connection_key IS DISTINCT FROM $2
         LIMIT 1`,
        [user.id, connectionKey(token)]
      );
      needsReconnect = mismatches.length > 0;
    }
    return { enabled: rows[0].planning_google_sync_enabled, connected: Boolean(token), needsReconnect, workerError };
  }

  async function setEnabled(user, enabled) {
    if (user.role !== 'pro') throw new AuthError(403, 'Cette synchronisation est réservée aux intervenants.');
    if (typeof enabled !== 'boolean') throw new AuthError(400, 'Indiquez si la synchronisation doit être activée.');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT google_calendar_refresh_token FROM app_users WHERE id = $1 AND role = 'pro' FOR UPDATE`,
        [user.id]
      );
      if (!rows[0]) throw new AuthError(404, 'Compte intervenant introuvable.');
      const token = rows[0].google_calendar_refresh_token;
      if (enabled && !token) throw new AuthError(409, 'Connectez d’abord votre agenda Google.');
      if (enabled) {
        const { rows: mismatches } = await client.query(
          `SELECT 1 FROM planning_google_events
           WHERE professional_id = $1 AND state <> 'retired' AND connection_key IS DISTINCT FROM $2 LIMIT 1`,
          [user.id, connectionKey(token)]
        );
        if (mismatches.length) throw new AuthError(409, RECONNECTED_MESSAGE);
      }
      await client.query('UPDATE app_users SET planning_google_sync_enabled = $2 WHERE id = $1',
        [user.id, enabled]);
      await client.query('COMMIT');
      return { enabled };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async function changeCalendar(user) {
    if (user.role !== 'pro') throw new AuthError(403, 'Seul l’intervenant peut changer d’agenda Google.');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: mappings } = await client.query(
        `SELECT * FROM planning_google_events WHERE professional_id = $1 FOR UPDATE`, [user.id]
      );
      const { rows: owners } = await client.query(
        `SELECT planning_google_sync_enabled, google_calendar_refresh_token
         FROM app_users WHERE id = $1 AND role = 'pro' FOR UPDATE`, [user.id]
      );
      if (!owners[0]?.google_calendar_refresh_token) throw new AuthError(409, 'Connectez d’abord votre nouvel agenda Google.');
      if (owners[0].planning_google_sync_enabled) throw new AuthError(409, 'Mettez d’abord la synchronisation en pause.');
      for (const sync of mappings) {
        if (sync.proposal && await getCurrentAppointment(client, sync)) {
          await notifyParticipants(client, sync, 'Demande Google abandonnée',
            'L’intervenant a changé d’agenda Google. Le rendez-vous dans l’application reste inchangé.');
        }
      }
      await client.query('DELETE FROM planning_google_events WHERE professional_id = $1', [user.id]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  return { changeCalendar, confirmReconnect, getSettings, list, processOne, respond, run, setEnabled };
}

module.exports = { createPlanningGoogleSync, eventTimes, sameChange, sameTimes, validateChange };
