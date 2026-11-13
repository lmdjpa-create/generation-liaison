# Authentication setup

The mobile app now uses server-side accounts. The API stores users, individual senior profiles, sessions, and activity logs in PostgreSQL. Database tables are created automatically when an authentication endpoint is first used.

## Configure the server

1. Provision a PostgreSQL database for the service.
2. Set `DATABASE_URL` in the server environment to the database connection string. In Render, use the database's internal connection string where available.
3. Deploy or restart the web service. Without `DATABASE_URL`, sign-in and registration return an explicit configuration error.
4. Open `/app-mobile.html` to register or sign in. Each account owns a separate senior profile and can only read or write that profile's activity log.

Registration currently supports senior, family caregiver, and professional roles. Passwords must be at least 12 characters. Sessions expire after 30 days and are revoked when the user signs out.

## Password recovery

The sign-in and administrator pages link to `/reset-password.html`. Configure `RESEND_API_KEY`, `NOTIFICATIONS_FROM_EMAIL` (a sender on a verified Resend domain), and the public HTTPS `PUBLIC_APP_URL` before using recovery. Requests return the same message for active and unknown accounts; delivery failures are logged on the server. A new request for the same account is limited to one per minute. Recovery e-mails are transactional and do not require optional notification consent. Links expire after 15 minutes, can be used once, and reset all existing sessions. Closed or suspended accounts cannot be reset. The page never asks for the administrator access code.

## Professional account verification

New professional accounts remain pending and cannot access the professional workspace until an administrator approves them. Registration requires an identity document and a Kbis. PDF, JPEG, and PNG files up to 10 MB each are accepted; the server also checks file signatures. While the application is pending, documents are stored as private PostgreSQL data and are available only through authenticated administrator endpoints. They are deleted in the same transaction as the approval or rejection decision. After a rejection, the applicant must upload both required documents again. Do not store or serve these files from the public `dist` directory.

The administrator reviews the documents in the account table and approves or rejects the application. Applicants can replace their documents after a rejection; uploading replacements returns the application to pending. Approval and rejection create a notification in the existing delivery queue. E-mail and SMS notices are sent only when the applicant opted in at registration; that consent also covers appointment notifications after approval. SMS requires a valid international-format number. Configure Resend and Twilio as described below. An unconfigured channel cannot be selected at registration, and failed deliveries are retried by the notification worker.

Before collecting real identity documents, confirm the database provider's encryption-at-rest, backup retention, access logging, privacy notice, and legal basis for processing. A decision deletes documents from the live database, but database backups follow the provider's retention policy.

After an accepted visit is marked complete, the senior or aidant on the consented profile can rate it green (satisfactory), orange (needs improvement), or red (problem). A red rating requires a comment and creates an alert for configured administrator accounts in the notification queue; opted-in e-mail/SMS delivery follows the existing provider setup. Red ratings and comments are also listed in the protected administrator dashboard. The shared follow-up shows completed visits from the previous 30 days so users have time to submit an evaluation.

## Shared intervention planning

Set `PLANNING_COORDINATOR_EMAILS` on the server to a comma-separated list of existing professional account e-mail addresses that may coordinate a team. Each coordinator can add existing professional accounts, request a person's consent, store contact details only after consent, and propose visits to team members. The assigned professional receives an in-app notification and must accept or refuse. Only accepted care visits and daily-service bookings appear as scheduled appointments; the person, requester, and coordinator receive in-app status notifications.

Appointment notifications can also be sent as operating-system/browser push, SMS, or e-mail. The provider configuration is optional until the corresponding credentials are added. Notification delivery uses a PostgreSQL outbox and retries provider failures. Push is enabled by each user and device; SMS and e-mail are off by default and require explicit opt-in in the account's notification preferences. SMS numbers must use E.164 format. Disabling SMS clears the stored number; disabling e-mail or push stops future deliveries to that channel/device. Messages sent by external providers contain only the notification title and a link to sign in, not appointment names, addresses, or care details.

Configure these server environment variables (see `.env.example`):

- **Firebase Cloud Messaging (Android/iOS):** set `FIREBASE_SERVICE_ACCOUNT_JSON` to the Firebase service-account JSON as a protected server secret, or set `GOOGLE_APPLICATION_CREDENTIALS` to a mounted credential file. Never put the service-account key in the web build or commit it. Add `google-services.json` for Android at `android/app/google-services.json` (ignored by Git). In Firebase, configure the iOS app and APNs credentials; enable the Push Notifications capability in the iOS signing configuration. Native push cannot deliver until the matching Firebase/APNs project is configured.
- **Browser push:** generate VAPID keys with `node -e "console.log(require('web-push').generateVAPIDKeys())"` and set `WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY`, and `WEB_PUSH_SUBJECT` (for example `mailto:notifications@example.fr`). Keep the private key server-side. The web app must be served over HTTPS. On iOS browsers, web push also requires an installed web app and a supported iOS version.
- **SMS:** set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM_NUMBER` from Twilio. The sender and destination numbers must be enabled for the countries where recipients live; Twilio charges per message.
- **E-mail:** set `RESEND_API_KEY` and `NOTIFICATIONS_FROM_EMAIL`; verify the sender's domain in Resend (including its DNS records). Set `PUBLIC_APP_URL` to the public site URL for the sign-in link.

The push registration screen requests permission only after the user taps the enable button. Users can remove the current device or turn off SMS/e-mail in their preferences. All appointment invitations, acceptances, refusals, changes, and cancellations create delivery jobs; jobs for channels without a subscription or explicit consent are skipped. The in-app inbox continues to refresh while the app is open.

Professional accounts declare a service radius of 1–500 km (30 km by default) and choose either their device's GPS position at home or the approximate centre of a French municipality as their starting point. A coordinator may record a senior's home position only after confirming the senior or authorized caregiver agreed. Coordinates are stored by this application. Assigned care visits and confirmed daily-service bookings show rounded straight-line distances from the recorded starting point; an out-of-radius visit displays a warning but is not blocked. The distance is an estimate, not road mileage. Consent withdrawal also clears the senior's stored position. Existing professionals can update their position using GPS in their settings.

## National professional directory and Google Calendar

The national directory contains only active, approved professional accounts that explicitly opt in by publishing a profile. Professionals set their public activity and description, service radius, appointment duration, time zone, and weekly appointment hours in the app. A starting position and a connected Google Calendar are required before publication. Seniors and caregivers can search within 1–500 km of a French municipality centre or their GPS position, or search nationally without a location. The exact straight-line distance is filtered before pagination; displayed distances are rounded. A city name or postcode is sent directly to the French public service geo.api.gouv.fr to find its centre; the search position is used only for the request and is not stored. Professional starting coordinates, e-mail addresses, and phone numbers are never shown in the public directory.

Each professional must authorize their own Google account. Set `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`, `GOOGLE_CALENDAR_REDIRECT_URI`, and `CALENDAR_TOKEN_ENCRYPTION_KEY` on the server. Register the exact redirect URI in the Google Cloud OAuth client; it must point to `https://<api-host>/api/calendar/google/callback`. Generate a 32-byte encryption key with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Keep all four values server-side, use HTTPS, restrict the OAuth client to the intended deployment, and never commit or share the client secret or encryption key. The app requests the `calendar.events` scope to create and update appointments and the narrower `calendar.freebusy` scope to check availability. The server encrypts the refresh token with AES-256-GCM before storing it.

Search and availability checks use the professional's declared hours, Google Calendar free/busy data, and existing accepted care visits and active service bookings. Creating a request places an opaque Google Calendar hold and a database hold for 15 minutes. The professional must accept or refuse before the hold expires; acceptance confirms the calendar event and notifies the requester, while refusal or expiry removes the hold. A background cleanup runs once per minute. Google Calendar configuration is required for publishing and booking; without it those actions return an explicit error.

Caregivers select and confirm the senior profile when booking; the server verifies the active link and stores that profile on the booking. Older caregiver bookings with no recorded profile conservatively occupy the slot of every currently linked senior, including suspended links, until identified. Their calendar entries reveal only an anonymous occupied interval. Automatically identifying these historical bookings is not possible. New reservations and confirmations reject overlapping application appointments for the professional or affected senior. Creating a link is rejected when an active legacy booking would overlap that senior's existing appointments or another legacy booking; the records require identification before the link can be created. Link creation, removal, and scheduling use transaction-scoped senior locks; suspending a link does not remove its legacy-booking occupancy.

In the Agenda, an approved professional can separately opt in to synchronize future accepted care visits and confirmed daily-service appointments. The worker periodically copies their time and duration to the connected primary calendar as private, generic events without names or care details; services use 30 minutes. Existing future appointments are included. Application-side changes are reflected in Google when the Google copy has not also changed. A Google move or deletion of one of these events creates a request in the Agenda: the assigned professional and the authorized person or caregiver must both approve before the shared appointment changes. Either may refuse, which restores the Google copy. The second approval checks application appointments and other opaque events in the professional's primary Google calendar, excluding the moved event itself; a conflict or inability to read Google prevents the move. Google cannot atomically lock other calendar events, so an external edit after the check can still create an overlap. Simultaneous edits or Google errors are reported in the professional's Agenda. Only events created by this planning synchronization are imported; independent Google events and directory bookings are not imported as planning changes.

The optional `test/postgres-concurrency.test.js` exercises these locks using separate PostgreSQL connections and real local API requests. It is skipped unless `AGENDA_PG_TEST_URL` is set. Use only a newly created, disposable local database named `agenda_isolated` with user `agenda_test`: the test creates schema and fixtures and must never target a database in use. Run it with `node --test test/postgres-concurrency.test.js`; Google calls are simulated.

Synchronization is off by default and can be paused in the Agenda. Pausing leaves existing Google copies in place. Connecting Google again pauses planning synchronization: the professional must confirm whether it is the same calendar or a different one before reactivating it. Switching calendars abandons pending proposals and leaves copies in the old calendar. Deleted or withdrawn appointments are removed from Google when possible; if the Google event was also changed, it requires manual review rather than being overwritten. Completed or elapsed appointments are left in Google as history and no longer monitored. Background synchronization requires the server worker and configured Google credentials to be running.

## Administrator desktop access

Set `ADMIN_EMAILS` on the server to a comma-separated list of existing account e-mail addresses allowed to open `/admin.html`. Also set `ADMIN_ACCESS_CODE` to a separate, randomly generated secret of at least 32 characters. Register the account first, then add its e-mail address and the access code to the server configuration and restart the service. The administrator signs in with that account's existing password and the separate code; the public registration form cannot grant administrator access.

Aidants without a linked senior can use their account and request access using the senior's email; the senior must accept the request. Administrators link verified legal guardians instead. Aidants can ask administrators to remove a link. Seniors can suspend access immediately and ask for removal; an administrator sends a 30-minute, one-use email code for the senior to confirm it. Email delivery requires the Resend configuration described above. Requests and decisions remain stored pending a defined retention policy.

Suspending or removing profile access does not remove independently registered contacts or stop emergency alerts sent to them. Data already displayed on a device may remain visible until the screen is refreshed.

The desktop console can view accounts and operational appointment schedules, create or reschedule care appointments, suspend/reactivate non-administrator accounts, manage daily-service partners and booking statuses, and choose a partner's billing model. Suspending an account revokes its active sessions. It does not expose care notes, medical transmissions, emergency contacts, or client addresses and phone numbers. Access to administrator API routes is checked on the server for every request; the public link alone grants no permissions.

The live visit follow-up records arrival, start, completion, and an optional practical note. It is not a medical record and must not contain clinical observations, health measurements, or emergency details. The person can authorize or revoke sharing in their account. Status access is limited to the account/profile used when the coordinator created the sharing request.

Each assigned visit has a button to view recommendations and team transmissions from the last 30 days. The person or caregiver account may send information to an active, consented team; an assigned professional or the coordinator may add a colleague transmission or retranscribe a doctor's recommendation with its named source. Notes show their author and timestamp, are available only to the assigned professional or that organization's coordinator, and are deleted when consent is revoked. A doctor's identity or the accuracy/current validity of a retranscribed recommendation is not verified by the application; there is no medical-system import.

Every transmission has an author-selected importance: blue for information, orange for follow-up, and red for priority. Priority is only an organizational signal and must not be interpreted as a medical emergency or replace emergency procedures.

Do not enter real personal or health information until identity verification, account association, hosting, security, and legal requirements have been reviewed.

## Configure the mobile API URL

Set `CAPACITOR_API_URL` in the local `.env` file to the deployed API origin. The web and Android builds then use that API instead of the current page's origin:

```dotenv
CAPACITOR_API_URL=https://generation-liaison.onrender.com
```

Rebuild the web assets and start the local server to test the web app:

```powershell
npm run build:web
npm start
```

## Configure Android

Build and synchronize the Android web assets using the same `.env` setting:

```powershell
npm run android:sync
```

Then build/install the Android app using the project's normal Gradle workflow. The app must be rebuilt and reinstalled after changing the API URL or mobile login code.

After adding `google-services.json`, run `npm run android:sync` and rebuild/reinstall the app. For iOS, synchronize with `npx cap sync ios`, configure the app's Push Notifications capability and APNs credentials in the Apple developer account, then rebuild and sign from Xcode.

## Current limitations

Self-registration does not yet verify email addresses, approve professional credentials, or provide password recovery. Do not use it as a production identity-verification process until those flows are added. Existing demo-only local accounts are not migrated; users must register again.
