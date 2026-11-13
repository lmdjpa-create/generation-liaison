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
const TERMS_VERSION = '2026-11-03.1';
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
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          verification_status VARCHAR(16) NOT NULL DEFAULT 'approved'
            CHECK (verification_status IN ('pending', 'approved', 'rejected')),
          verification_reviewed_at TIMESTAMPTZ,
          verification_reviewed_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
          verification_rejection_reason VARCHAR(500),
          home_latitude DOUBLE PRECISION,
          home_longitude DOUBLE PRECISION,
          service_radius_km SMALLINT NOT NULL DEFAULT 30 CHECK (service_radius_km BETWEEN 1 AND 500),
          premium_status VARCHAR(16) NOT NULL DEFAULT 'inactive'
            CHECK (premium_status IN ('inactive', 'active', 'trial', 'expired')),
          premium_until TIMESTAMPTZ,
          password_salt CHAR(32) NOT NULL,
          password_hash CHAR(128) NOT NULL,
          terms_accepted_at TIMESTAMPTZ,
          terms_version VARCHAR(32),
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        ALTER TABLE app_users
          ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS terms_version VARCHAR(32);
        ALTER TABLE app_users
          ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
        ALTER TABLE app_users
          ADD COLUMN IF NOT EXISTS verification_status VARCHAR(16) NOT NULL DEFAULT 'approved',
          ADD COLUMN IF NOT EXISTS verification_reviewed_at TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS verification_reviewed_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
          ADD COLUMN IF NOT EXISTS verification_rejection_reason VARCHAR(500);
        ALTER TABLE app_users
          ADD COLUMN IF NOT EXISTS is_legal_guardian BOOLEAN NOT NULL DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS guardian_verification_status VARCHAR(16) NOT NULL DEFAULT 'not_required'
            CHECK (guardian_verification_status IN ('not_required', 'pending', 'approved', 'rejected')),
          ADD COLUMN IF NOT EXISTS guardian_reviewed_at TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS guardian_reviewed_by UUID REFERENCES app_users(id) ON DELETE SET NULL;
        ALTER TABLE app_users
          ADD COLUMN IF NOT EXISTS home_latitude DOUBLE PRECISION,
          ADD COLUMN IF NOT EXISTS home_longitude DOUBLE PRECISION,
          ADD COLUMN IF NOT EXISTS service_radius_km SMALLINT NOT NULL DEFAULT 30;
        ALTER TABLE app_users
          ADD COLUMN IF NOT EXISTS notification_phone VARCHAR(16),
          ADD COLUMN IF NOT EXISTS email_notifications_enabled BOOLEAN NOT NULL DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS sms_notifications_enabled BOOLEAN NOT NULL DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS email_notifications_consent_at TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS sms_notifications_consent_at TIMESTAMPTZ;
        ALTER TABLE app_users
          ADD COLUMN IF NOT EXISTS planning_google_sync_enabled BOOLEAN NOT NULL DEFAULT FALSE;
        ALTER TABLE app_users
          ADD COLUMN IF NOT EXISTS premium_status VARCHAR(16) NOT NULL DEFAULT 'inactive'
          CHECK (premium_status IN ('inactive', 'active', 'trial', 'expired')),
          ADD COLUMN IF NOT EXISTS premium_until TIMESTAMPTZ;
        ALTER TABLE app_users
          ADD COLUMN IF NOT EXISTS directory_listed BOOLEAN NOT NULL DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS directory_activity VARCHAR(160),
          ADD COLUMN IF NOT EXISTS directory_description VARCHAR(500),
          ADD COLUMN IF NOT EXISTS profile_photo_url TEXT,
          ADD COLUMN IF NOT EXISTS profile_photo BYTEA,
          ADD COLUMN IF NOT EXISTS profile_photo_content_type VARCHAR(64),
          ADD COLUMN IF NOT EXISTS profile_photo_updated_at TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS appointment_duration_minutes SMALLINT NOT NULL DEFAULT 60,
          ADD COLUMN IF NOT EXISTS appointment_timezone VARCHAR(64) NOT NULL DEFAULT 'Europe/Paris',
          ADD COLUMN IF NOT EXISTS appointment_weekly_hours JSONB NOT NULL DEFAULT '[]'::jsonb,
          ADD COLUMN IF NOT EXISTS google_calendar_refresh_token TEXT,
          ADD COLUMN IF NOT EXISTS google_calendar_connected_at TIMESTAMPTZ;
        UPDATE app_users
        SET verification_status = 'pending'
        WHERE role = 'pro'
          AND verification_status = 'approved'
          AND verification_reviewed_at IS NULL;
        CREATE TABLE IF NOT EXISTS app_professional_verification_documents (
          id UUID PRIMARY KEY,
          user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          document_type VARCHAR(24) NOT NULL CHECK (document_type IN ('identity', 'kbis')),
          content_type VARCHAR(64) NOT NULL CHECK (content_type IN ('application/pdf', 'image/jpeg', 'image/png')),
          file_data BYTEA NOT NULL,
          uploaded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (user_id, document_type)
        );
        CREATE TABLE IF NOT EXISTS app_legal_guardian_verification_documents (
          id UUID PRIMARY KEY,
          user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          document_type VARCHAR(24) NOT NULL CHECK (document_type IN ('identity', 'guardianship')),
          content_type VARCHAR(64) NOT NULL CHECK (content_type IN ('application/pdf', 'image/jpeg', 'image/png')),
          file_data BYTEA NOT NULL,
          uploaded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (user_id, document_type)
        );
        CREATE TABLE IF NOT EXISTS app_aidant_senior_links (
          aidant_user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          senior_profile_id UUID NOT NULL REFERENCES senior_profiles(id) ON DELETE CASCADE,
          linked_by UUID NOT NULL REFERENCES app_users(id),
          linked_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (aidant_user_id, senior_profile_id)
        );
        ALTER TABLE app_aidant_senior_links
          ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ;
        CREATE INDEX IF NOT EXISTS app_aidant_senior_links_profile_idx
          ON app_aidant_senior_links (senior_profile_id, aidant_user_id);
        CREATE TABLE IF NOT EXISTS app_aidant_link_requests (
          id UUID PRIMARY KEY,
          aidant_user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          senior_user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          status VARCHAR(16) NOT NULL DEFAULT 'pending'
            CHECK (status IN ('pending', 'accepted', 'declined')),
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          resolved_at TIMESTAMPTZ
        );
        CREATE UNIQUE INDEX IF NOT EXISTS app_aidant_link_requests_pending_idx
          ON app_aidant_link_requests (aidant_user_id, senior_user_id)
          WHERE status = 'pending';
        CREATE TABLE IF NOT EXISTS app_aidant_unlink_requests (
          id UUID PRIMARY KEY,
          aidant_user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          senior_user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          requested_by VARCHAR(16) NOT NULL CHECK (requested_by IN ('aidant', 'senior')),
          status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
          code_hash CHAR(64),
          code_expires_at TIMESTAMPTZ,
          code_sent_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          resolved_at TIMESTAMPTZ
        );
        CREATE UNIQUE INDEX IF NOT EXISTS app_aidant_unlink_requests_pending_idx
          ON app_aidant_unlink_requests (aidant_user_id, senior_user_id)
          WHERE status = 'pending';
        CREATE TABLE IF NOT EXISTS app_notifications (
          id UUID PRIMARY KEY,
          user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          notification_type VARCHAR(32) NOT NULL,
          title VARCHAR(160) NOT NULL,
          message VARCHAR(500) NOT NULL,
          entity_type VARCHAR(24),
          entity_id UUID,
          read_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS app_google_calendar_oauth_states (
          state_hash CHAR(64) PRIMARY KEY,
          user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          expires_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS app_user_contacts (
          id UUID PRIMARY KEY,
          user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          contact_user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          nickname VARCHAR(80),
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (user_id, contact_user_id),
          CHECK (user_id <> contact_user_id)
        );
        CREATE TABLE IF NOT EXISTS app_wellbeing_checkins (
          id UUID PRIMARY KEY,
          user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          checkin_date DATE NOT NULL,
          response VARCHAR(1200) NOT NULL,
          assistant_reply VARCHAR(800) NOT NULL,
          safety_concern BOOLEAN NOT NULL DEFAULT FALSE,
          safety_check_status VARCHAR(24) NOT NULL DEFAULT 'not_needed'
            CHECK (safety_check_status IN
              ('not_needed', 'awaiting_response', 'safe', 'needs_help', 'no_response', 'emergency_confirmed')),
          safety_notified_aidants INTEGER NOT NULL DEFAULT 0,
          emergency_number VARCHAR(3) CHECK (emergency_number IN ('18', '112')),
          expires_at TIMESTAMPTZ NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '30 days'),
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (user_id, checkin_date)
        );
        ALTER TABLE app_wellbeing_checkins
          ADD COLUMN IF NOT EXISTS safety_concern BOOLEAN NOT NULL DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS safety_check_status VARCHAR(24) NOT NULL DEFAULT 'not_needed'
            CHECK (safety_check_status IN
              ('not_needed', 'awaiting_response', 'safe', 'needs_help', 'no_response', 'emergency_confirmed')),
          ADD COLUMN IF NOT EXISTS safety_notified_aidants INTEGER NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS emergency_number VARCHAR(3)
            CHECK (emergency_number IN ('18', '112'));
        CREATE TABLE IF NOT EXISTS app_wellbeing_checkin_shares (
          checkin_id UUID NOT NULL REFERENCES app_wellbeing_checkins(id) ON DELETE CASCADE,
          recipient_user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          consented_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (checkin_id, recipient_user_id)
        );
        CREATE INDEX IF NOT EXISTS app_wellbeing_checkins_expiry_idx
          ON app_wellbeing_checkins (expires_at);
        CREATE INDEX IF NOT EXISTS app_wellbeing_shares_recipient_idx
          ON app_wellbeing_checkin_shares (recipient_user_id, consented_at DESC);
        CREATE TABLE IF NOT EXISTS app_video_calls (
          id UUID PRIMARY KEY,
          caller_user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          callee_user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          room_name VARCHAR(160) NOT NULL,
          room_url TEXT,
          status VARCHAR(16) NOT NULL DEFAULT 'created'
            CHECK (status IN ('created', 'ringing', 'connected', 'ended')),
          started_at TIMESTAMPTZ,
          ended_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS app_directory_bookings (
          id UUID PRIMARY KEY,
          requester_user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          professional_user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          scheduled_at TIMESTAMPTZ NOT NULL,
          duration_minutes SMALLINT NOT NULL CHECK (duration_minutes BETWEEN 15 AND 240),
          google_event_id VARCHAR(256) NOT NULL,
          status VARCHAR(16) NOT NULL DEFAULT 'pending'
            CHECK (status IN ('pending', 'confirmed', 'declined', 'expired')),
          hold_expires_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CHECK ((status = 'pending' AND hold_expires_at IS NOT NULL) OR
                 (status != 'pending' AND hold_expires_at IS NULL))
        );
        ALTER TABLE app_directory_bookings
          ADD COLUMN IF NOT EXISTS senior_profile_id UUID REFERENCES senior_profiles(id) ON DELETE SET NULL;
        UPDATE app_directory_bookings booking
        SET senior_profile_id = requester.senior_id
        FROM app_users requester
        WHERE booking.requester_user_id = requester.id AND requester.role = 'senior'
          AND booking.senior_profile_id IS NULL AND requester.senior_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS app_notifications_user_date_idx
          ON app_notifications (user_id, created_at DESC);
        CREATE TABLE IF NOT EXISTS app_push_subscriptions (
          id UUID PRIMARY KEY,
          user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          platform VARCHAR(16) NOT NULL CHECK (platform IN ('android', 'ios', 'web')),
          token TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (platform, token)
        );
        CREATE TABLE IF NOT EXISTS app_notification_deliveries (
          id UUID PRIMARY KEY,
          notification_id UUID NOT NULL REFERENCES app_notifications(id) ON DELETE CASCADE,
          user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          channel VARCHAR(16) NOT NULL CHECK (channel IN ('push', 'sms', 'email')),
          status VARCHAR(16) NOT NULL DEFAULT 'queued'
            CHECK (status IN ('queued', 'processing', 'sent', 'skipped')),
          attempts SMALLINT NOT NULL DEFAULT 0,
          last_error VARCHAR(500),
          next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (notification_id, user_id, channel)
        );
        CREATE INDEX IF NOT EXISTS app_notification_deliveries_queue_idx
          ON app_notification_deliveries (next_attempt_at, created_at)
          WHERE status IN ('queued', 'processing');
        CREATE TABLE IF NOT EXISTS app_sessions (
          token_hash CHAR(64) PRIMARY KEY,
          user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          expires_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS app_password_resets (
          user_id UUID PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
          token_hash CHAR(64) NOT NULL UNIQUE,
          expires_at TIMESTAMPTZ NOT NULL,
          requested_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS app_account_closure_requests (
          id UUID PRIMARY KEY,
          user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          status VARCHAR(16) NOT NULL DEFAULT 'pending'
            CHECK (status IN ('pending', 'processing', 'completed')),
          requested_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          handled_at TIMESTAMPTZ,
          handled_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
          resolution_note VARCHAR(1000)
        );
        ALTER TABLE app_account_closure_requests
          ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          ADD COLUMN IF NOT EXISTS handled_at TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS handled_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
          ADD COLUMN IF NOT EXISTS resolution_note VARCHAR(1000),
          ADD COLUMN IF NOT EXISTS ai_reviewed_at TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS ai_review_summary JSONB,
          ADD COLUMN IF NOT EXISTS ai_review_inventory JSONB;
        CREATE UNIQUE INDEX IF NOT EXISTS app_account_closure_requests_open_user_idx
          ON app_account_closure_requests (user_id)
          WHERE status IN ('pending', 'processing');
        CREATE INDEX IF NOT EXISTS app_account_closure_requests_status_date_idx
          ON app_account_closure_requests (status, requested_at);
        CREATE TABLE IF NOT EXISTS app_ai_conversations (
          id UUID PRIMARY KEY,
          user_id UUID NOT NULL UNIQUE REFERENCES app_users(id) ON DELETE CASCADE,
          status VARCHAR(24) NOT NULL DEFAULT 'open'
            CHECK (status IN ('open', 'human_requested')),
          human_requested_at TIMESTAMPTZ,
          expires_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS app_ai_messages (
          id BIGSERIAL PRIMARY KEY,
          conversation_id UUID NOT NULL REFERENCES app_ai_conversations(id) ON DELETE CASCADE,
          role VARCHAR(16) NOT NULL CHECK (role IN ('user', 'assistant', 'admin')),
          content VARCHAR(1200) NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS app_ai_messages_conversation_idx
          ON app_ai_messages (conversation_id, created_at DESC);
        CREATE TABLE IF NOT EXISTS app_ai_settings (
          id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
          enabled BOOLEAN NOT NULL DEFAULT TRUE,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO app_ai_settings (id, enabled)
        VALUES (1, TRUE)
        ON CONFLICT (id) DO NOTHING;
        CREATE TABLE IF NOT EXISTS app_logs (
          id BIGSERIAL PRIMARY KEY,
          senior_id UUID NOT NULL REFERENCES senior_profiles(id) ON DELETE CASCADE,
          author_id SMALLINT NOT NULL,
          content TEXT NOT NULL,
          log_type VARCHAR(32) NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS planning_organizations (
          id UUID PRIMARY KEY,
          name VARCHAR(160) NOT NULL,
          coordinator_user_id UUID NOT NULL UNIQUE REFERENCES app_users(id) ON DELETE CASCADE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS planning_org_members (
          organization_id UUID NOT NULL REFERENCES planning_organizations(id) ON DELETE CASCADE,
          user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          role VARCHAR(20) NOT NULL CHECK (role IN ('coordinator', 'professional')),
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (organization_id, user_id)
        );
        CREATE TABLE IF NOT EXISTS planning_recipients (
          id UUID PRIMARY KEY,
          organization_id UUID NOT NULL REFERENCES planning_organizations(id) ON DELETE CASCADE,
          senior_id UUID NOT NULL REFERENCES senior_profiles(id) ON DELETE CASCADE,
          name VARCHAR(120) NOT NULL,
          phone VARCHAR(40),
          address VARCHAR(500),
          latitude DOUBLE PRECISION,
          longitude DOUBLE PRECISION,
          position_consented_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
          position_consent_at TIMESTAMPTZ,
          emergency_contact_name VARCHAR(120),
          emergency_contact_phone VARCHAR(40),
          access_instructions VARCHAR(500),
          consented_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
          consent_at TIMESTAMPTZ,
          consent_revoked_at TIMESTAMPTZ,
          created_by UUID NOT NULL REFERENCES app_users(id),
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (organization_id, senior_id)
        );
        ALTER TABLE planning_recipients
          ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION,
          ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION,
          ADD COLUMN IF NOT EXISTS position_consented_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
          ADD COLUMN IF NOT EXISTS position_consent_at TIMESTAMPTZ;
        CREATE TABLE IF NOT EXISTS planning_visits (
          id UUID PRIMARY KEY,
          organization_id UUID NOT NULL REFERENCES planning_organizations(id) ON DELETE CASCADE,
          recipient_id UUID NOT NULL REFERENCES planning_recipients(id) ON DELETE CASCADE,
          assigned_user_id UUID NOT NULL REFERENCES app_users(id),
          scheduled_at TIMESTAMPTZ NOT NULL,
          duration_minutes SMALLINT NOT NULL CHECK (duration_minutes BETWEEN 15 AND 480),
          visit_type VARCHAR(120) NOT NULL,
          status VARCHAR(16) NOT NULL DEFAULT 'scheduled'
            CHECK (status IN ('scheduled', 'completed')),
          acceptance_status VARCHAR(16) NOT NULL DEFAULT 'accepted'
            CHECK (acceptance_status IN ('pending', 'accepted', 'declined', 'cancelled')),
          completed_at TIMESTAMPTZ,
          created_by UUID NOT NULL REFERENCES app_users(id),
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CHECK ((status = 'scheduled' AND completed_at IS NULL) OR
                 (status = 'completed' AND completed_at IS NOT NULL))
        );
        ALTER TABLE planning_visits
          ADD COLUMN IF NOT EXISTS acceptance_status VARCHAR(16) NOT NULL DEFAULT 'accepted'
          CHECK (acceptance_status IN ('pending', 'accepted', 'declined'));
        ALTER TABLE planning_visits
          DROP CONSTRAINT IF EXISTS planning_visits_acceptance_status_check;
        ALTER TABLE planning_visits
          ADD CONSTRAINT planning_visits_acceptance_status_check
          CHECK (acceptance_status IN ('pending', 'accepted', 'declined', 'cancelled'));
        CREATE TABLE IF NOT EXISTS planning_service_partners (
          id UUID PRIMARY KEY,
          organization_id UUID NOT NULL REFERENCES planning_organizations(id) ON DELETE CASCADE,
          user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          service_type VARCHAR(32) NOT NULL
            CHECK (service_type IN ('meal_delivery', 'hairdresser', 'housekeeping')),
          display_name VARCHAR(160) NOT NULL,
          service_area VARCHAR(160),
          billing_model VARCHAR(24) NOT NULL DEFAULT 'per_completed_booking'
            CHECK (billing_model IN ('subscription', 'per_completed_booking')),
          active BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (organization_id, user_id, service_type)
        );
        ALTER TABLE planning_service_partners
          ADD COLUMN IF NOT EXISTS billing_model VARCHAR(24) NOT NULL DEFAULT 'per_completed_booking'
          CHECK (billing_model IN ('subscription', 'per_completed_booking'));
        CREATE TABLE IF NOT EXISTS planning_service_bookings (
          id UUID PRIMARY KEY,
          organization_id UUID NOT NULL REFERENCES planning_organizations(id) ON DELETE CASCADE,
          recipient_id UUID NOT NULL REFERENCES planning_recipients(id) ON DELETE CASCADE,
          partner_id UUID NOT NULL REFERENCES planning_service_partners(id) ON DELETE CASCADE,
          created_by UUID NOT NULL REFERENCES app_users(id),
          requested_at TIMESTAMPTZ NOT NULL,
          status VARCHAR(16) NOT NULL DEFAULT 'requested'
            CHECK (status IN ('requested', 'confirmed', 'completed', 'cancelled')),
          request_note VARCHAR(500),
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS planning_google_events (
          id UUID PRIMARY KEY,
          professional_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          senior_id UUID,
          entity_kind VARCHAR(16) NOT NULL CHECK (entity_kind IN ('visit', 'service')),
          entity_id UUID NOT NULL,
          google_event_id VARCHAR(256) NOT NULL,
          connection_key CHAR(64) NOT NULL,
          snapshot_start TIMESTAMPTZ NOT NULL,
          snapshot_duration SMALLINT NOT NULL,
          state VARCHAR(16) NOT NULL DEFAULT 'new'
            CHECK (state IN ('new', 'active', 'restore', 'retired')),
          proposal JSONB,
          last_error TEXT,
          last_checked_at TIMESTAMPTZ,
          UNIQUE (professional_id, entity_kind, entity_id),
          UNIQUE (professional_id, google_event_id)
        );
        ALTER TABLE planning_google_events ADD COLUMN IF NOT EXISTS connection_key CHAR(64);
        ALTER TABLE planning_google_events ALTER COLUMN senior_id DROP NOT NULL;
        CREATE INDEX IF NOT EXISTS planning_google_events_due_idx
          ON planning_google_events (professional_id, last_checked_at);
        CREATE TABLE IF NOT EXISTS planning_visit_events (
          id UUID PRIMARY KEY,
          visit_id UUID NOT NULL REFERENCES planning_visits(id) ON DELETE CASCADE,
          organization_id UUID NOT NULL REFERENCES planning_organizations(id) ON DELETE CASCADE,
          recipient_id UUID NOT NULL REFERENCES planning_recipients(id) ON DELETE CASCADE,
          user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          event_type VARCHAR(16) NOT NULL
            CHECK (event_type IN ('arrived', 'started', 'completed')),
          practical_note VARCHAR(500),
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (visit_id, event_type)
        );
        CREATE TABLE IF NOT EXISTS planning_visit_evaluations (
          id UUID PRIMARY KEY,
          visit_id UUID NOT NULL REFERENCES planning_visits(id) ON DELETE CASCADE,
          organization_id UUID NOT NULL REFERENCES planning_organizations(id) ON DELETE CASCADE,
          recipient_id UUID NOT NULL REFERENCES planning_recipients(id) ON DELETE CASCADE,
          rated_by UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          rating VARCHAR(8) NOT NULL CHECK (rating IN ('green', 'orange', 'red')),
          comment VARCHAR(1500),
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (visit_id, rated_by),
          CHECK (rating != 'red' OR (comment IS NOT NULL AND length(trim(comment)) > 0))
        );
        CREATE TABLE IF NOT EXISTS planning_recipient_notes (
          id UUID PRIMARY KEY,
          organization_id UUID NOT NULL REFERENCES planning_organizations(id) ON DELETE CASCADE,
          recipient_id UUID NOT NULL REFERENCES planning_recipients(id) ON DELETE CASCADE,
          author_user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          note_type VARCHAR(32) NOT NULL
            CHECK (note_type IN ('person_note', 'colleague_note', 'doctor_recommendation')),
          importance VARCHAR(16) NOT NULL DEFAULT 'information'
            CHECK (importance IN ('information', 'follow_up', 'priority')),
          source_name VARCHAR(120),
          source_date DATE,
          content VARCHAR(1500) NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CHECK (
            (note_type = 'doctor_recommendation' AND source_name IS NOT NULL AND source_date IS NOT NULL) OR
            (note_type != 'doctor_recommendation' AND source_name IS NULL AND source_date IS NULL)
          )
        );
        ALTER TABLE planning_recipient_notes
          ADD COLUMN IF NOT EXISTS importance VARCHAR(16) NOT NULL DEFAULT 'information'
          CHECK (importance IN ('information', 'follow_up', 'priority'));
        CREATE TABLE IF NOT EXISTS planning_access_audit (
          id BIGSERIAL PRIMARY KEY,
          organization_id UUID NOT NULL REFERENCES planning_organizations(id) ON DELETE CASCADE,
          recipient_id UUID NOT NULL REFERENCES planning_recipients(id) ON DELETE CASCADE,
          user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          action VARCHAR(32) NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS app_sessions_expiry_idx ON app_sessions (expires_at);
        CREATE INDEX IF NOT EXISTS app_logs_senior_created_idx ON app_logs (senior_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS planning_visits_assigned_date_idx
          ON planning_visits (assigned_user_id, scheduled_at);
        CREATE INDEX IF NOT EXISTS planning_visits_org_date_idx
          ON planning_visits (organization_id, scheduled_at);
        CREATE INDEX IF NOT EXISTS planning_service_partners_directory_idx
          ON planning_service_partners (organization_id, service_type, active);
        CREATE INDEX IF NOT EXISTS planning_service_bookings_partner_date_idx
          ON planning_service_bookings (partner_id, requested_at);
        CREATE INDEX IF NOT EXISTS planning_service_bookings_recipient_date_idx
          ON planning_service_bookings (recipient_id, requested_at);
        CREATE INDEX IF NOT EXISTS planning_recipients_consent_idx
          ON planning_recipients (senior_id, consent_revoked_at);
        CREATE INDEX IF NOT EXISTS planning_access_audit_user_date_idx
          ON planning_access_audit (user_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS planning_visit_events_visit_date_idx
          ON planning_visit_events (visit_id, created_at);
        CREATE INDEX IF NOT EXISTS planning_visit_evaluations_rating_date_idx
          ON planning_visit_evaluations (rating, created_at DESC);
        CREATE INDEX IF NOT EXISTS app_directory_bookings_professional_slot_idx
          ON app_directory_bookings (professional_user_id, scheduled_at)
          WHERE status IN ('pending', 'confirmed');
        CREATE INDEX IF NOT EXISTS app_directory_bookings_expiry_idx
          ON app_directory_bookings (hold_expires_at)
          WHERE status = 'pending';
        CREATE INDEX IF NOT EXISTS app_users_directory_idx
          ON app_users (verification_status, directory_listed, created_at DESC)
          WHERE role = 'pro' AND is_active = TRUE;
        CREATE INDEX IF NOT EXISTS planning_recipient_notes_recipient_date_idx
          ON planning_recipient_notes (recipient_id, created_at DESC);
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
      isActive: row.is_active !== false,
      verificationStatus: row.verification_status || 'approved',
      isLegalGuardian: row.is_legal_guardian === true,
      guardianVerificationStatus: row.guardian_verification_status || 'not_required',
      seniorId: row.senior_id,
      seniorName: row.role === 'senior'
        ? row.senior_name || row.name
        : row.senior_name && row.senior_name !== row.name ? row.senior_name : null,
      serviceRadiusKm: row.service_radius_km ?? null,
      premiumStatus: row.premium_status || 'inactive',
      premiumUntil: row.premium_until || null,
      isPremium: (() => {
        const status = (row.premium_status || 'inactive').toLowerCase();
        if (status === 'active') {
          if (!row.premium_until) return true;
          const expiry = new Date(row.premium_until).getTime();
          return Number.isFinite(expiry) ? expiry > Date.now() : true;
        }
        return false;
      })(),
      photoUrl: row.profile_photo_url || null,
      hasHomeLocation: row.home_latitude !== null && row.home_latitude !== undefined &&
        row.home_longitude !== null && row.home_longitude !== undefined
    };
  }

  async function register({
    name,
    email,
    password,
    role,
    seniorName,
    isLegalGuardian = false,
    homeLatitude,
    homeLongitude,
    serviceRadiusKm,
    notificationPhone,
    emailNotificationsEnabled = false,
    smsNotificationsEnabled = false,
    acceptedTerms,
    acceptedTermsVersion
  }) {
    await ensureSchema();

    if (acceptedTerms !== true || acceptedTermsVersion !== TERMS_VERSION) {
      throw new AuthError(400, 'Vous devez accepter les conditions générales d’utilisation en vigueur.');
    }

    if (typeof name !== 'string' || typeof email !== 'string' ||
        (seniorName !== undefined && seniorName !== null && typeof seniorName !== 'string')) {
      throw new AuthError(400, 'Complétez tous les champs du formulaire.');
    }

    const normalizedEmail = email.trim().toLowerCase();
    const normalizedName = name.trim();
    if (!normalizedName || normalizedName.length > 120) {
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
    if (typeof isLegalGuardian !== 'boolean' || (isLegalGuardian && role !== 'aidant')) {
      throw new AuthError(400, 'Le statut de tuteur légal est réservé aux comptes aidants.');
    }
    const normalizedSeniorName = role === 'senior'
      ? normalizedName
      : typeof seniorName === 'string' ? seniorName.trim() : '';
    if (normalizedSeniorName.length > 120) {
      throw new AuthError(400, 'Vérifiez les noms saisis.');
    }
    if (typeof emailNotificationsEnabled !== 'boolean' || typeof smsNotificationsEnabled !== 'boolean' ||
        (notificationPhone !== undefined && notificationPhone !== null && typeof notificationPhone !== 'string')) {
      throw new AuthError(400, 'Vérifiez vos choix de notification.');
    }
    const normalizedPhone = typeof notificationPhone === 'string' ? notificationPhone.trim() : '';
    if (smsNotificationsEnabled && !/^\+[1-9]\d{7,14}$/.test(normalizedPhone)) {
      throw new AuthError(400, 'Pour recevoir les SMS, saisissez un numéro au format international, par exemple +33612345678.');
    }
    if (role === 'pro' &&
        (typeof homeLatitude !== 'number' || !Number.isFinite(homeLatitude) ||
         homeLatitude < -90 || homeLatitude > 90 ||
         typeof homeLongitude !== 'number' || !Number.isFinite(homeLongitude) ||
         homeLongitude < -180 || homeLongitude > 180 ||
         !Number.isInteger(serviceRadiusKm) || serviceRadiusKm < 1 || serviceRadiusKm > 500)) {
      throw new AuthError(400, 'Pour un compte intervenant, enregistrez une position au domicile et un rayon de 1 à 500 km.');
    }

    const userId = randomUUID();
    const seniorId = randomUUID();
    const storedHomeLatitude = role === 'pro' ? homeLatitude : null;
    const storedHomeLongitude = role === 'pro' ? homeLongitude : null;
    const storedServiceRadius = role === 'pro' ? serviceRadiusKm : 30;
    const passwordCredentials = await hashPassword(password);
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await client.query(
        'INSERT INTO senior_profiles (id, name) VALUES ($1, $2)',
        [seniorId, normalizedSeniorName || normalizedName]
      );
      const { rows } = await client.query(
        `INSERT INTO app_users
           (id, senior_id, name, email, role, home_latitude, home_longitude, service_radius_km,
            password_salt, password_hash, verification_status, notification_phone,
            email_notifications_enabled, sms_notifications_enabled, is_legal_guardian,
            guardian_verification_status,
            email_notifications_consent_at, sms_notifications_consent_at, terms_accepted_at, terms_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
                 CASE WHEN $15 THEN 'pending' ELSE 'not_required' END,
                 CASE WHEN $13 THEN CURRENT_TIMESTAMP ELSE NULL END,
                 CASE WHEN $14 THEN CURRENT_TIMESTAMP ELSE NULL END,
                 CURRENT_TIMESTAMP, $16)
         RETURNING id, senior_id, name, email, role, verification_status,
                   home_latitude, home_longitude, service_radius_km,
                   is_legal_guardian, guardian_verification_status`,
        [
          userId,
          seniorId,
          normalizedName,
          normalizedEmail,
          role,
          storedHomeLatitude,
          storedHomeLongitude,
          storedServiceRadius,
          passwordCredentials.salt,
          passwordCredentials.hash,
          role === 'pro' ? 'pending' : 'approved',
          smsNotificationsEnabled ? normalizedPhone : null,
          emailNotificationsEnabled,
          smsNotificationsEnabled,
          isLegalGuardian,
          TERMS_VERSION
        ]
      );
      rows[0].senior_name = normalizedSeniorName || null;
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

  async function createPasswordReset(email) {
    if (typeof email !== 'string' || email.length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      throw new AuthError(400, 'Saisissez une adresse e-mail valide.');
    }
    await ensureSchema();
    const token = randomBytes(32).toString('hex');
    const { rows } = await pool.query(
      `INSERT INTO app_password_resets (user_id, token_hash, expires_at)
       SELECT id, $2, CURRENT_TIMESTAMP + INTERVAL '15 minutes'
       FROM app_users WHERE email = $1 AND is_active = TRUE
       ON CONFLICT (user_id) DO UPDATE
       SET token_hash = EXCLUDED.token_hash, expires_at = EXCLUDED.expires_at,
           requested_at = CURRENT_TIMESTAMP
       WHERE app_password_resets.requested_at <= CURRENT_TIMESTAMP - INTERVAL '1 minute'
       RETURNING user_id`,
      [email.trim().toLowerCase(), hashToken(token)]
    );
    return rows.length ? token : null;
  }

  async function resetPassword(token, password) {
    if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) {
      throw new AuthError(400, 'Ce lien est invalide ou a expiré. Demandez un nouveau lien.');
    }
    if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH || password.length > 256) {
      throw new AuthError(400, `Le mot de passe doit contenir au moins ${PASSWORD_MIN_LENGTH} caractères.`);
    }
    await ensureSchema();
    const credentials = await hashPassword(password);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `DELETE FROM app_password_resets
         WHERE token_hash = $1 AND expires_at > CURRENT_TIMESTAMP
         RETURNING user_id`,
        [hashToken(token)]
      );
      if (!rows.length) {
        throw new AuthError(400, 'Ce lien est invalide ou a expiré. Demandez un nouveau lien.');
      }
      const updated = await client.query(
        `UPDATE app_users SET password_salt = $2, password_hash = $3
         WHERE id = $1 AND is_active = TRUE RETURNING id`,
        [rows[0].user_id, credentials.salt, credentials.hash]
      );
      if (!updated.rows.length) {
        throw new AuthError(400, 'Ce lien est invalide ou a expiré. Demandez un nouveau lien.');
      }
      await client.query('DELETE FROM app_sessions WHERE user_id = $1', [rows[0].user_id]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
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
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT u.id, u.senior_id, u.name, u.email, u.role, u.is_active,
              u.verification_status,
              u.is_legal_guardian, u.guardian_verification_status,
              u.home_latitude, u.home_longitude, u.service_radius_km,
              u.premium_status, u.premium_until,
              u.profile_photo_url, u.password_salt, u.password_hash,
              s.name AS senior_name
         FROM app_users u
         JOIN senior_profiles s ON s.id = u.senior_id
         WHERE u.email = $1 FOR UPDATE OF u`,
        [normalizedEmail]
      );
      const row = rows[0];
      const matches = row
        ? await verifyPassword(password, row.password_salt, row.password_hash)
        : await verifyPassword(password, DUMMY_SALT.toString('hex'), DUMMY_HASH.toString('hex'));

      if (!row || !row.is_active || !matches) {
        throw new AuthError(401, 'Adresse e-mail ou mot de passe incorrect.');
      }
      const token = await createSession(client, row.id);
      await client.query('COMMIT');
      return { token, user: publicUser(row) };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async function authenticate(token) {
    await ensureSchema();
    const { rows } = await pool.query(
      `SELECT u.id, u.senior_id, u.name, u.email, u.role, u.is_active,
              u.verification_status,
              u.is_legal_guardian, u.guardian_verification_status,
              u.home_latitude, u.home_longitude, u.service_radius_km,
              u.premium_status, u.premium_until,
              u.profile_photo_url, s.name AS senior_name
       FROM app_sessions session
       JOIN app_users u ON u.id = session.user_id
       JOIN senior_profiles s ON s.id = u.senior_id
       WHERE session.token_hash = $1 AND session.expires_at > CURRENT_TIMESTAMP
         AND u.is_active = TRUE`,
      [hashToken(token)]
    );
    return rows[0] ? publicUser(rows[0]) : null;
  }

  async function logout(token) {
    await ensureSchema();
    await pool.query('DELETE FROM app_sessions WHERE token_hash = $1', [hashToken(token)]);
  }

  async function requestAccountClosure(userId, password) {
    await ensureSchema();
    if (typeof password !== 'string' || !password) {
      throw new AuthError(400, 'Saisissez votre mot de passe pour confirmer la clôture du compte.');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT id, is_active, password_salt, password_hash
         FROM app_users
         WHERE id = $1
         FOR UPDATE`,
        [userId]
      );
      const account = rows[0];
      if (!account || !account.is_active) {
        throw new AuthError(409, 'Ce compte est déjà clôturé ou indisponible.');
      }
      if (!await verifyPassword(password, account.password_salt, account.password_hash)) {
        throw new AuthError(401, 'Le mot de passe est incorrect. La demande n’a pas été enregistrée.');
      }

      const requestId = randomUUID();
      const { rows: requestRows } = await client.query(
        `INSERT INTO app_account_closure_requests (id, user_id)
         VALUES ($1, $2)
         RETURNING id, requested_at`,
        [requestId, userId]
      );
      await client.query(
        `UPDATE app_users
         SET is_active = FALSE,
             directory_listed = FALSE,
             directory_activity = NULL,
             directory_description = NULL,
             profile_photo_url = NULL,
             profile_photo = NULL,
             profile_photo_content_type = NULL,
             home_latitude = NULL,
             home_longitude = NULL,
             google_calendar_refresh_token = NULL,
             google_calendar_connected_at = NULL,
             notification_phone = NULL,
             email_notifications_enabled = FALSE,
             sms_notifications_enabled = FALSE,
             email_notifications_consent_at = NULL,
             sms_notifications_consent_at = NULL
         WHERE id = $1`,
        [userId]
      );
      await client.query('DELETE FROM app_sessions WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM app_push_subscriptions WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM app_google_calendar_oauth_states WHERE user_id = $1', [userId]);
      await client.query(
        `DELETE FROM app_user_contacts
         WHERE user_id = $1 OR contact_user_id = $1`,
        [userId]
      );
      await client.query('COMMIT');
      return {
        requestId: requestRows[0].id,
        requestedAt: requestRows[0].requested_at
      };
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.code === '23505') {
        throw new AuthError(409, 'Une demande de clôture est déjà en cours pour ce compte.');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  return { authenticate, createPasswordReset, ensureSchema, login, logout, register, requestAccountClosure, resetPassword };
}

module.exports = {
  AuthError,
  PASSWORD_MIN_LENGTH,
  TERMS_VERSION,
  createAuthService,
  hashPassword,
  verifyPassword
};
