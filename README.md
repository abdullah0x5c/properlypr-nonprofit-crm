# ProperlyPR Nonprofit CRM

A small-team nonprofit outreach CRM built from [hunzaarshadkhan/properlypr-nonprofit-crm](https://github.com/hunzaarshadkhan/properlypr-nonprofit-crm), revision `52b19d7f4b804c34ac1ee99d9392b93c2ee9d676`. Organizations keep their identity as outcomes move them between first calls, cold calls, email follow-ups, callbacks, meetings, review, and nurture.

This release adds the meeting's immediate requirements: CSV downloads, CSV uploads with automatic/editable field mapping, and direct **Update status** actions. It also adds a Railway production server with authentication and a persistent SQLite database. Email and SMS sending are not included; reps send externally and record the actual outcome.

## Run locally

Use Node.js 24 or newer. Application runtime, build, and API tests require no external packages.

```sh
node build.mjs
node dev/server.mjs
```

Open **http://127.0.0.1:8787**. Development binds to loopback, supplies a demo identity, and loads three fictional organizations into `.local/crm.sqlite`. It must never be exposed as the production server. The production server starts empty and never loads examples.

```sh
npm test
```

Tests cover workflow timing, notes, revisions and retries, CSV parsing/mapping/validation, duplicate handling, imports, formula-safe exports, HTTP authentication, identity spoofing, CSRF, login throttling, password rotation, and persisted organizations and notes across server restart.

## Daily work and status updates

Open a queue or search Organizations, then choose **Update status**. The form offers outcomes valid for the current stage, including Not connected, email requested, callback requested, meeting booked, not interested, wrong number, dial failed, and do not contact. Saving records an attributed activity and changes the next action together. Stale concurrent changes are rejected. Stopped records have no outreach actions.

Email completion advances the seven-touch sequence using business-day offsets **0, 2, 4, 7, 10, 14, 21**, anchored to the first recorded send. Existing terminal-sequence review rules are retained. The application does not send an email or text when an outcome is saved. Times and scheduling use America/New_York and skip weekends; no holiday calendar is configured.

Profile editing includes assigned rep, contact details, email permission (Yes / No / Unknown), and permission evidence. Published email candidates remain separate from working addresses. People remains a minimal filing-based board/officer list; this release retains one primary outreach contact and one active workflow per organization.

## CSV upload and download

**Organizations → Upload CSV**:

1. Download the column template if needed. Upload a UTF-8, comma-separated CSV with one header row, at most 1,000 records, 60 columns, and 1.5 MB. Quoted commas, embedded newlines, escaped quotes, CRLF, and a UTF-8 BOM are supported.
2. Review automatic column matches and edit them. Organization name and nine-digit EIN are required. Ambiguous column matches are left for review. Preserve leading-zero EINs as text when exporting from Excel.
3. Choose Available, First call, Contact review, Review, Nurture, or Do not contact as the new records' destination. Nurture imports are due for review today; no historical pause date is invented.
4. Choose **Validate & preview**. Correct invalid rows in the source file, or adjust mappings. Validation does not write data. Every invalid row must be fixed before the file can be imported.
5. Choose **Import new records**. Existing EINs and repeated EINs in the upload are skipped. No existing profiles, outcomes, notes, or suppression states are overwritten. Repeated submissions do not create duplicate organizations. Valid inserts are committed in one transaction.

Each record retains its filename, source row, original cell values, import batch, and import timestamp. An import entry is marked `csv-import` and has no outreach occurrence date. Unmapped historical status/date columns remain evidence; they do not silently create meetings, callback appointments, past outreach, or sequence enrollments. Use Record outcome for new work. A complete workbook migration, including related people and historical date precision, requires a separate reconciliation once the actual file is supplied.

**Download CSV** is available in Organizations, Calls due, Emails due, First calls, Cold calls, Callbacks, Meetings, Nurture, Review, and Review and nurture. It exports the current search/work-tab/exception filters, including person name, domain, phone, working email, permission, owner, and workflow fields. Formula-like text is prefixed with an apostrophe for spreadsheet safety; some downstream tools may display this prefix. CSV exports are operational lists, not full database backups.

## Railway deployment

Railway builds the included `Dockerfile` using Node 24, listens on `0.0.0.0:$PORT`, and checks `/healthz`. The runtime has no third-party dependencies. SQL migrations run transactionally at startup, after the volume is mounted. The existing SQLite schema is retained, with foreign keys, WAL, full synchronous writes, and a busy timeout.

1. Create a Railway project and empty `crm` service. Attach a persistent **volume at `/data`**. Use one replica. Database storage must not live in the container's ephemeral filesystem.
2. Generate the initial account locally:

   ```sh
   node scripts/create-user.mjs admin
   ```

   This creates `.local/admin-credentials.json` with a random password, a scrypt hash configuration, and a session secret. The file is mode 0600 and excluded from Git and container uploads. Read it privately; do not commit it or paste its contents into tickets.

3. Generate a Railway public domain targeting port 8080. Configure these private service variables:

   | Variable | Value |
   | --- | --- |
   | `APP_ORIGIN` | Exact public HTTPS origin, without a trailing slash |
   | `CRM_DATABASE_PATH` | `/data/crm.sqlite` |
   | `CRM_USERS_JSON` | Value generated in the credential file (JSON array of usernames and password hashes) |
   | `SESSION_SECRET` | Random secret generated in the credential file, at least 32 characters |
   | `NODE_ENV` | `production` |
   | `PORT` | `8080` |

4. Deploy this checkout with `railway up` or connect the service to the branch containing these changes. `railway.json` configures the Dockerfile, healthcheck, and restart behavior. A missing volume, invalid login configuration, or missing HTTPS origin fails startup rather than exposing an unsecured or nonpersistent workspace.
5. Visit the HTTPS origin, sign in, and check `/healthz`. A production database starts empty. Import real records only after their mapping and provenance have been reviewed.

The Railway server discards caller-supplied identity and privileged-import headers. It assigns the verified username to notes and activities. Passwords are stored as scrypt hashes; session cookies are signed, Secure on HTTPS, HttpOnly, SameSite=Strict, and expire after eight hours. Mutation requests must come from `APP_ORIGIN`. Login attempts are rate-limited in memory. There is no public signup or password-reset flow.

Generate a separate credential file for each rep using `node scripts/create-user.mjs rep-name`, append only that generated user object to the existing `CRM_USERS_JSON` array, and retain the existing session secret. Changing a user's hash invalidates that user's sessions; removing the user disables their access. All configured users currently share CRM editing privileges. Roles and self-service account administration are future work.

A volume-backed service has brief downtime on redeployment and cannot scale horizontally. See [Railway volumes](https://docs.railway.com/volumes) and [healthchecks](https://docs.railway.com/deployments/healthchecks). Move to a server database such as PostgreSQL if multiple application replicas become necessary.

### Backups and recovery

Enable automatic volume backups in Railway. The included command also creates a consistent SQLite backup using SQLite's online backup API:

```sh
CRM_DATABASE_PATH=/data/crm.sqlite node scripts/backup.mjs /data/crm-backup.sqlite
```

Copy backups to separate storage. A backup stored only on the source volume is not protection against losing that volume. To restore a manual SQLite backup, stop the application, replace the database with the backup, remove obsolete `-wal`/`-shm` files, and restart. Restore to a separate test database first and verify organization and note counts. Production restore has not been exercised by the automated tests. Never copy only a live SQLite main file while ignoring its WAL.

## Data handoff and recommended next features

The actual Excel workbook is not included in this checkout. The supplied analysis and meeting notes informed the requirements; the reported 502 organizations, 2,974 board entries, 885 activities, and queue counts have not been independently verified here. No real prospects or synthetic examples are seeded in production.

Recommended order after the first import:

1. **Import reconciliation:** migrate all workbook sheets with stable relationships, unknown historical dates, import batches, and a review report. Preserve suppression. Distinguish imports from rep activity before adding productivity reports.
2. **Rep ownership and readiness filters:** owner/unassigned views, missing working emails, unverified candidates, missing meeting/callback times, and correction work. Owner editing and the original basic blocker views are already available.
3. **Shared mailbox integration:** manual compose/send and response capture with recipient, sender, permission evidence, delivery state, retries, and idempotency. Only advance a sequence after a confirmed send, not merely after pressing Send.
4. **Meeting/calendar integration:** attendees, meeting link, duration, rescheduling, and cancellation of obsolete reminders.
5. **Twilio SMS:** manual messaging first, then automation after account access, sender configuration, consent, opt-outs, and delivery handling are defined.
6. **Multiple contacts, opportunities, and roles:** separate contacts and tasks as needed; proposal value and decision date; manager/reviewer roles. Nonprofit reported revenue must stay separate from opportunity value.

## Source layout

| File | Purpose |
| --- | --- |
| `index.html` | Dashboard, queues, directory, organization forms, CSV mapping/preview |
| `worker.js` | API validation, revisions, notes, outcomes, privileged legacy import |
| `csv.js`, `csv-api.js` | Shared CSV codec/mapping and transactional API import/export |
| `workflow.js`, `cadence.js` | State transitions and Eastern business-day scheduling |
| `server/` | Railway HTTP server, verified identities, login and signed sessions |
| `schema.ts`, `drizzle/` | SQLite schema and versioned migrations |
| `dev/` | Loopback demo server, SQLite adapter and fictional data |
| `scripts/` | Local account bootstrap and consistent SQLite backup |
| `Dockerfile`, `railway.json` | Production container and Railway deployment configuration |

For schema changes, install development dependencies using `pnpm install --frozen-lockfile`, edit `schema.ts`, run `pnpm run db:generate`, and commit migrations and metadata. The original Cloudflare Worker build remains supported; a host using it directly must provide its own trusted identity gateway. Railway uses `server/server.mjs` instead. Original privileged JSON import remains inaccessible through the Railway gateway; team users use the validated CSV flow.
