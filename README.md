# ProperlyPR Nonprofit CRM

A team workspace for nonprofit outreach. Reps can choose a first-call batch, log outcomes, follow email and cold-call sequences, book meetings, and review organizations for nurture. Each organization has a profile, board and officer records, team notes, and an activity history.

## Run locally

Install Node.js 24 or newer. From a terminal:

```sh
git clone https://github.com/hunzaarshadkhan/properlypr-nonprofit-crm.git
cd properlypr-nonprofit-crm
node build.mjs
node dev/server.mjs
```

Open **http://127.0.0.1:8787**. The local server starts with three fictional nonprofits. To check persistence, open **Organizations → Paper Lantern Demo → Notes**, save a note, and restart the server. Local data lives in `.local/crm.sqlite`, which Git ignores. For UI or Worker changes, stop the server, rebuild, and restart. Running the demo and tests requires only Node.

## Development

| File | Purpose |
| --- | --- |
| `index.html` | Dashboard, queues, search, nonprofit profiles, notes and outcome forms |
| `worker.js` | HTTP endpoints, input validation, record revisions and note storage |
| `workflow.js`, `cadence.js` | Stage changes, Eastern dates and business-day scheduling |
| `schema.ts`, `drizzle/` | Database schema and versioned migrations |
| `dev/` | Loopback-only development server, SQLite adapter and fictional seed data |

Run `npm test` or run `node build.mjs`, `node check-workflow.mjs`, and `node test/check-api.mjs` in order. The tests cover routing, weekend due dates, access checks, retries, stale edits, board entries, and first-call batches.

To change the schema, install the development dependencies using `pnpm install --frozen-lockfile`, edit `schema.ts`, and run `pnpm run db:generate`. Commit the new SQL migration and its metadata. The local server applies pending migrations at startup.

## Hosting a team instance

The build produces a Worker at `dist/server/index.js`. Provision a **separate** D1 database bound as `DB` and apply the SQL migrations in journal order. For a Sites deployment, register your own private site and supply its assigned project ID in `.openai/hosting.json` before building. Production access depends on the hosting platform authenticating visitors and restricting the site's audience to the team. The Worker trusts `oai-authenticated-user-id` and `oai-authenticated-user-email` from that platform. On another host, a trusted authentication gateway must discard incoming identity headers and set verified identity itself. The local development server assigns a demo identity and binds only to loopback.

A fresh team instance starts empty. Add organizations through the UI. If an administrator needs bulk import, configure `CRM_IMPORT_KEY` as a server-side secret and use the authenticated `POST /api/import` endpoint with `X-CRM-Import`. Keep this key private because it grants privileged API access. The public repository includes application code and fictional examples. Production records and the operational Google Sheet are managed separately.

## Contributing

Create a branch, run the tests, and open a pull request. Use fictional organizations and contact details in issues, tests, and screenshots.
