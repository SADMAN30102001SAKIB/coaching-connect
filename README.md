# Coaching Connect

A mobile-friendly app for coaching centers to manage students, enter marks, and send personalized SMS. Teachers write a message once; the app fills in each student's name and results.

Each center has separate records, staff permissions, and its own SMS account. The interface supports English/Bangla and Light/Dark/System themes. You can install it on a phone, but viewing records and saving changes still need an internet connection.

## Who does what?

- **Platform owner:** creates centers, suspends/restores them, and helps users recover accounts after verifying their identity. This does not automatically grant access to every center's records.
- **Center admin:** manages their center, invites staff, creates roles, and adds their SMS API key.
- **Staff/teachers:** use the features their assigned roles allow.
- **Students/parents:** receive messages; they do not log in.

Login uses a Bangladesh mobile number and password. No authentication or invitation SMS is sent. Share setup links privately. Recovery codes are one-use backup keys for forgotten passwords—save them somewhere safe. Phone numbers are not verified by SMS.

## How a teacher uses it

1. Create classes, sessions, subjects, and batches with your own names.
2. Add students and student/guardian contacts. Students can join multiple batches; siblings can share a number.
3. Create an exam, choose subjects and maximum marks, add participants, and enter results.
4. Choose a subject result, combined results from several exams, or an announcement. Reuse a template or edit the message.
5. Select recipients, review personalized previews and exclusions, then send now or schedule.
6. Check message history, delivery status, and the center's SMS balance.

Zero marks, absent, pending, and exempt are different results. Missing/pending results and contacts without SMS permission are excluded from result messages. Announcements do not need marks. Overlapping selections are deduplicated; siblings still get separate results.

This is not a full school management system. It does not include imports, fees, attendance, student portals, online exams, grading formulas, weighted totals, or rankings. Combined summaries list results rather than calculate a new grade.

## Run locally

Use **Node 24** and **pnpm 12.15.0**, matching `package.json`. From the repository root in PowerShell:

```powershell
pnpm install --frozen-lockfile
Copy-Item .dev.vars.example .dev.vars
```

Do not overwrite an existing `.dev.vars`. Edit it before continuing:

- Set `BOOTSTRAP_TOKEN` to a random secret of at least 32 characters. This is your first-account setup key, not your SMS API key.
- Keep `SMS_MODE="mock"` locally. Mock mode never contacts the SMS provider.

```powershell
pnpm db:local
pnpm dev
```

Open the terminal's address. Choose **Set up platform**, enter your setup key, create your owner account, and save the recovery codes. Create a center and privately share its setup link with the admin.

A clearly fake provider key works for local mock tests. Never put real keys in tests. `.dev.vars` and `APIDocs.txt` are excluded from Git. The API document contains an apparent credential; replace it with the provider if genuine.

## Code checks

```powershell
pnpm typecheck       # TypeScript
pnpm lint            # ESLint; warnings also fail
pnpm format:check    # Check formatting
pnpm format          # Apply formatting
pnpm check           # Formatting, lint, types, integration tests, production build
pnpm test:browser    # Run after pnpm check builds the app
pnpm dlx fallow@3.34.1 dead-code
```

Browser tests use a separate local database, mock SMS, and port 4173—not production records. They use installed Chrome locally and Playwright Chromium in CI, covering desktop/mobile workflows, themes, and accessibility.

`pnpm preview` runs the latest build locally; build first. `pnpm types` regenerates Cloudflare binding types.

GitHub's **Quality** workflow runs Fallow, `pnpm check`, and browser tests. Fallow/browser tests are separate from `pnpm check`. GitHub CI does not deploy or automatically block Cloudflare's independent builds. Require checks before merging to `main`; direct pushes can still trigger deployment.

## Deploy through GitHub → Cloudflare

The frontend and backend deploy together as **one Worker with Static Assets**, plus D1 and Queues. Use **Workers Builds, not Pages**.

**Current source settings:** domain `coaching.autonovaq.com`, SMS mode **live**, dispatch enabled, and **100% log sampling**. Worker/preview URLs are disabled. Approved sends can spend a center's SMS balance after deployment. For a fresh environment, start with SMS disabled until ready for a small paid test.

### One-time Cloudflare setup

1. Use Workers Paid for the configured 3,000 ms CPU allowance. Do not weaken password hashing to fit the Free plan's CPU budget.
2. Create D1 database `coaching-connect` and set its ID in `wrangler.jsonc`. The current account's ID is already configured; replace it for another account. Do not manually create tables.
3. Create queue `coaching-sms`. Cloudflare creates its configured dead-letter queue `coaching-sms-failed` if missing.
4. Connect the repository to Workers Builds: Worker `coaching-connect`, branch `main`, root directory `/`.
5. Set build variables `NODE_VERSION=24.18.0` and `PNPM_VERSION=12.15.0`. The build token needs Workers Scripts, D1, and Queues **Edit** permissions for this account; update the generated token if needed.
6. Keep branch preview builds off until staging has separate databases, queues, secrets, and domains. Never use production records for preview testing.

**Build command:**

```sh
pnpm install --frozen-lockfile && pnpm check
```

**Deploy command:**

```sh
pnpm db:remote && pnpm exec wrangler deploy --config dist/coaching_connect/wrangler.json
```

These run in Cloudflare after a GitHub push. The deploy command applies SQL migrations before publishing. Do not deploy only `dist/client`; that omits the backend. Do not upload local secrets or generated build/test output. Avoid overlapping releases, and do not run production migrations from a second deployment workflow too.

The domain is declared in `wrangler.jsonc`; its zone must be in the same Cloudflare account. Keep runtime/domain settings in Git rather than making conflicting dashboard edits. See Cloudflare's [build settings](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/) and [custom domain guide](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).

### First account and first real SMS

1. Add runtime **Secret** `BOOTSTRAP_TOKEN` under **Worker → Settings → Variables & Secrets**. Use a new random value of at least 32 characters, not the local key. Runtime secrets are separate from build variables.
2. Open the app, choose **Set up platform**, and enter that key. Save recovery codes, then remove the secret. Setup only allows one platform owner.
3. Create a center. Its admin completes setup and enters their API key and approved sender IDs in the app's SMS settings—not Cloudflare variables.
4. Add a few records and review previews. If SMS is disabled, change `SMS_MODE` to `live` through Git when ready.
5. Send to consenting test recipients. Verify receipt, Bangla/long messages, actual charges, delivery checks, and scheduled sending before sending to a whole class.

Replacing provider credentials or transferring ownership requires a recent login. Sign out/in if prompted.

## Important SMS rules

- **Modes:** `disabled` blocks provider access/send approval; `mock` simulates it without provider calls; `live` makes real requests. Local `.dev.vars` can override the source mode locally.
- **Charges:** Bangla, emoji, and long messages may use several paid segments. Displayed counts are estimates; the provider sets the actual charge.
- **Capacity:** sends run in chunks, starting at one recipient per provider request. Only increase batch size after confirming provider limits. Capacity is not unlimited.
- **Delivery:** accepted does not mean delivered. A completed campaign has finished submission, not necessarily delivery. Automatic delivery checks stop after 24 hours; unresolved known messages can still be checked manually.
- **Unknown sends:** a timeout can happen after an SMS was accepted. The app pauses uncertain sends instead of blindly retrying. Check the provider dashboard first; a resend can deliver and charge twice.
- **Changed records:** edits to results, contacts, permissions, or credentials can require another review. **Refresh unsent messages** does not replay already-submitted ones.
- **History:** the app records its own sends. The documented provider API checks a known message ID, not the whole account's history. Check messages sent elsewhere in the provider dashboard.
- **Testing:** provider sandbox safety is unconfirmed, so local mock mode is used. Automated tests do not prove real delivery, billing, or production capacity.

## When something goes wrong

Audit history keeps the last seven days. The existing every-minute background task deletes older entries in batches of up to 1,000, even when SMS dispatch is disabled. This includes recovery/security audit notes, not student records, results, or SMS history. A backlog may take several runs to clear.

**Stop sending:** pause the queue consumer in Cloudflare for immediate intervention. Set `DISPATCH_ENABLED="false"` in the source and release through Git to stop background dispatch. Set `SMS_MODE="disabled"` too to block provider access/new send approvals. Suspending a center blocks its access and further authorized batches. Already-submitted SMS cannot be recalled.

**Resume carefully:** investigate paused campaigns, unknown sends, and the failed queue. Do not blindly replay failed queue messages.

**Restore D1 carefully:** stop dispatch and queue consumption first. Preserve recent provider IDs and note the affected time window. After restoration, compare recent sends with provider records and invalidate affected login/setup/recovery credentials before restarting. Restoring data does not undo SMS; restored pending work could send duplicates. Worker rollbacks do not undo migrations. Add new migrations rather than rewriting applied ones.

**Protect credentials:** provider keys are stored in D1 without extra application-level encryption, as requested. Older versions remain for checking older messages. Protect database access, backups, and exports. Passwords/account tokens are hashed; application logs omit API keys and SMS text. With 100% log sampling, monitor logging usage/costs.

## Code layout

- `apps/web`: React pages, shared UI, themes, translations, and PWA assets.
- `apps/worker`: login, permissions, APIs, provider calls, and background sending.
- `packages/domain`: shared validation, templates, marks, and schedule calculations.
- `packages/db/migrations`: database schema changes in SQL; no Drizzle schema.
- `tests`: Worker/database integration and browser tests.

Queries use indexed pagination, cached balance checks, and stored dashboard counts to reduce unnecessary reads. Monitor real Worker CPU, D1 usage, and provider charges as usage grows.
