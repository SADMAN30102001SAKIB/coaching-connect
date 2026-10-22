# Coaching Connect

Multi-center coaching results and personalized SMS, built as one Cloudflare Worker with Static Assets, D1 and Queues. React runs on the client; all credentials, permissions and paid SMS operations stay on the server.

## Included

- Separate centers, platform-owner provisioning, one center owner, staff invitations and editable permission-based roles.
- Phone/password sign-in, one-use setup links, recovery codes, password changes and verified-by-operator assisted recovery. No authentication SMS. A phone login is an identifier, not proof that the number was verified.
- Dynamic classes, sessions, subjects, batches and exam series; student profiles and reusable guardian/student contacts. Siblings may share a number.
- Exams with editable subject maxima/pass marks, participant snapshots, exact decimal marks, absent/pending/exempt states and concurrent-edit protection.
- Editable templates, subject results, combined exam summaries and announcements. Send to a student, selected batches or all eligible students.
- Real personalized previews, exclusion reasons, immediate or scheduled approval, cancellation, cached per-center balance, message history and known-ID delivery checks.
- Durable background work, duplicate suppression, permission/consent checks before sending and safe pauses when source data or provider credentials change. Refresh only unsent recipients without replaying submitted ones.
- Responsive English/Bangla interface, installable PWA manifest/icons, keyboard-accessible dialogs and an offline page. Private records are **not** cached for offline use.

No import, OCR, grading engine, weighted totals, public signup or authentication SMS is included, as agreed.

## Local setup

Use Node 24 and the pnpm version pinned in `package.json`. In PowerShell:

```powershell
pnpm install --frozen-lockfile
Copy-Item .dev.vars.example .dev.vars
pnpm db:local
pnpm dev
```

Replace the example setup key in `.dev.vars` with a random value of at least 32 characters. Keep `SMS_MODE="mock"` locally. Open the address printed by Vite, choose **Set up platform**, and create the platform owner with that key. Save the recovery codes immediately.

The platform owner creates a center and privately shares its one-use invitation link with its admin. The admin creates subjects/batches, students/contacts, exams and participants, enters marks, and prepares a message preview. Configure an account in **Settings → SMS account** before approving a campaign. In mock mode any clearly fake test key works and no SMS provider request is made.

Never copy a real provider key into test files. `APIDocs.txt` is intentionally ignored because it contains an apparent credential. If genuine, rotate that credential. The original document has not been modified or published.

## Checks and production preview

```powershell
pnpm check
pnpm test:browser
```

`check` runs formatting, strict zero-warning lint, strict TypeScript, Worker/D1 integration tests and the production build. Browser tests automatically migrate their separate database and start the built Worker on port 4173, with test-only mock settings. They use `.wrangler/browser-state`, not your normal development database. Local browser tests use installed Google Chrome; CI installs Playwright Chromium. The tests create **local test records**, not production data.

`pnpm preview` opens the built application without HMR. `pnpm build` is required first. Local CLI commands use the same `.wrangler/state` directory. `pnpm types` regenerates binding/runtime types after configuration changes.

The GitHub `Quality` workflow runs these checks, including desktop/mobile browser journeys and an automated home-screen accessibility check. It does not deploy. Make the check required on `main` before enabling production builds. This workflow has been authored locally; a GitHub-hosted run is not yet verified.

## GitHub → Cloudflare deployment

There is no local production-deploy script. Do not upload `dist`, `.wrangler`, `.dev.vars`, test results or the original API documentation. Publishing this repository does not itself deploy the application; configure the Git-connected Cloudflare build below.

1. In the intended Cloudflare account, create a D1 database named `coaching-connect`. Add its actual `database_id` to the `DB` entry in `wrangler.jsonc`. This is account configuration, not a placeholder application implementation.
2. Create queues named `coaching-sms` and `coaching-sms-failed`. The Worker consumes the first; the second holds exhausted queue deliveries. Keep the names aligned with `wrangler.jsonc` if changing them.
3. Commit the reviewed source to your intended GitHub repository. Connect that repository to **Workers Builds**, not Pages. Use the repository root and production branch `main`.
4. Use Node 24 and pnpm 12.14.0 in the build environment. Set `NODE_VERSION=24.18.0` and `PNPM_VERSION=12.14.0` if the build image does not select them from the manifest. The essential blocking **build command** is `pnpm install --frozen-lockfile && pnpm check`.
5. The Cloudflare-side **deploy command** is `pnpm db:remote && pnpm exec wrangler deploy --config dist/coaching_connect/wrangler.json`. This applies reviewed migrations first, then deploys the built Worker and assets. It runs in Cloudflare's Git-connected build, **not on your local computer**. The build token needs D1 edit access as well as Worker/Queues deployment access. Do not use a default token that lacks the required permissions.
6. Use a Workers plan that supports the configured 3,000 ms CPU limit. Password hashing is intentionally expensive; do not weaken it to fit a tiny CPU budget. The same Worker serves all centers; no Worker/database is provisioned per center.
7. Add the runtime secret `BOOTSTRAP_TOKEN` under the Worker's **Variables & Secrets**. Use a newly generated random secret, never the local/browser-test key. Build-only variables are not runtime secrets. On the first deployment, create the platform owner through **Set up platform**, save recovery codes, then remove the bootstrap secret. Subsequent bootstrap attempts are also rejected by the database's one-platform-owner constraint.
8. Add your domain through the Worker's custom-domain settings. HTTPS is required for secure production cookies and normal PWA installation.
9. Initially leave the source configuration `SMS_MODE="disabled"`. Create records and inspect previews. Enter each center's own approved API key/sender IDs in that center's settings. Account replacement/ownership transfer requires a login within the last ten minutes; sign out/in if prompted.
10. Only for an approved sending pilot, change `SMS_MODE` to `live` in the source configuration and let the GitHub-connected build release it. Confirm a small send to consenting test recipients, the provider message IDs, received Bangla/long-message content, actual charges and delivery reports before large sends.

Use separate D1 databases, queues, runtime secrets and domains for staging. Never point a preview branch at production bindings or use version uploads as if they isolate production data. Disable non-production branch deployments until a separate staging setup is configured. Serialize production migrations/releases and cancel superseded builds; never run schema migrations from both a GitHub deploy workflow and Workers Builds.

Cloudflare's documented [build configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/) distinguishes build, deploy, preview and runtime settings. The Vite build writes the deployable config to `dist/coaching_connect/wrangler.json`; deploying only `dist/client` would omit the API and job handlers.

## SMS safety and provider limits

- `disabled`: no provider access or send approval. `mock`: fake balance, submission IDs and delivery, with no provider network calls. `live`: real provider operations and real charges.
- The adapter implements the documented bulk POST, balance GET and known-message status POST. Individual messages use a one-recipient bulk request; there is no separate credential-bearing send URL in the browser. This one-item bulk behavior still needs the live pilot to confirm.
- Default batch size is **one**, not an invented provider capacity. Admins can change batch size/pacing within bounded request limits after confirming their provider's limits. Large audiences are processed in bounded chunks, not one huge HTTP request. Capacity is finite and sending speed depends on queue/provider/account limits.
- An ID-confirmed submission is **accepted**, not necessarily delivered. A completed campaign has finished submission work; delivery checks can continue afterward. Automatic known-ID checks back off and stop after 24 hours; the user can check a known unresolved message manually afterward, at most once a minute.
- Timeout, malformed responses and unmapped acknowledgements become **unknown** and pause the campaign. Never silently resend them. An explicit risk-confirmed retry creates a new review campaign and may still charge/deliver twice if the original actually succeeded.
- The provider does not document idempotency or a searchable client reference, so nobody can honestly promise exactly-once carrier delivery. A queue cannot fix that external limitation.
- The provider has no documented account-wide history endpoint. The app shows its own full paginated campaign history; messages sent outside this app must be checked in the provider dashboard. The claimed sandbox is not called because its non-billing/non-delivery behavior is unproven. No inbound SMS or billing tariff is invented.
- Segment counts are standard GSM-7/Unicode estimates, not account-specific pricing. Bangla, emoji and long messages can consume multiple paid segments. The provider determines actual cost.

## Security, efficiency and operations

Every center request and background batch rechecks membership/permissions. Platform-owner status does not bypass center permissions. Composite tenant foreign keys, prepared SQL, one-use claim guards, exact fixed-point marks and conditional state transitions enforce data boundaries. Sessions/recovery/setup tokens are hashed; native scrypt hashes passwords with random salts. Mutations require same-origin JSON; API responses are no-store.

As explicitly requested, per-center provider keys are stored in D1 without additional application encryption. API responses show only the configured status/suffix; logs and queue bodies omit keys and SMS text. Historical credential revisions remain in D1 for older-message lookups. Protect database access, backups and exports accordingly; revoke compromised credentials with the provider. There is no automatic retention purge that might delete necessary sending evidence.

Indexed cursor pagination avoids offset scans. Home counts are maintained on writes instead of counting every student/exam on each visit. Balance calls are cached for a minute and concurrent refreshes share a lease. Message checks back off; polling stops on terminal campaigns. A runtime test verifies an indexed prefix search over 1,000 students reads fewer than 40 rows for 10 matches. This is evidence for that query, **not** an unmeasured promise about all production workloads. Measure D1 rows read/written and Worker CPU in your account as real usage grows.

If sending must stop, set `DISPATCH_ENABLED="false"` in the source and release it through the connected build; optionally pause the queue consumer in Cloudflare for immediate incident response. Existing provider requests cannot be recalled. Center suspension stops further authorized batches. Inspect paused campaigns, unknown submissions, the oldest outstanding job and the failed queue. Resolve a cause before approving **Refresh unsent messages** or explicitly resending uncertain messages. Do not simply replay failed queue entries as fresh SMS sends.

Before D1 restoration, stop dispatch and queue consumption, preserve current provider IDs and a recovery checkpoint, and record the affected time window. After restoring, reconcile recent sends against provider records and invalidate affected sessions/setup/recovery credentials. **Never restart a restored outbox blindly**: the external SMS cannot be rolled back with the database. Worker rollback does not undo migrations or messages. Use additive, backward-compatible migrations.

## Repository map

- `apps/web`: React UI, design tokens, translated interface, PWA assets.
- `apps/worker`: authentication, scoped API, provider adapter and durable job handlers.
- `packages/domain`: shared schemas, permissions, templates, marks and schedule/segment calculations.
- `packages/db/migrations`: ordered SQL schema changes; apply with Wrangler, not manual edits to deployed tables.
- `tests`: Worker/D1 integration and desktop/mobile browser tests.
- `docs/planning`: original requirements/design investigation; this README describes the implemented configuration and operational steps.

Local automated checks and mock journeys do not prove real provider billing/carrier delivery, a live Cloudflare release, a real-device PWA installation or limitless scale. Those account/device/provider checks remain release verification, not hidden unfinished application code.
