# Delivery, efficiency, verification, and operations

Status: proposed controls and acceptance tests. No application benchmark, installed-dependency compatibility test, browser test, deployment, or provider pilot has run.

## Dependency investigation

npm view was used read-only on 2026-10-22; no dependencies were installed. Local tools observed: Node 24.18.0, npm 11.16.0. Proposed build runtime: pinned supported Node 24 release, kept consistent locally and in Cloudflare Builds.

Additional source review: the published better-auth 1.7.12 tarball was obtained with npm pack --ignore-scripts and inspected outside the workspace. Relevant files: dist/plugins/phone-number/routes.mjs and types.d.mts, dist/plugins/admin/routes.mjs, dist/api/routes/password.mjs, dist/utils/password.mjs and dist/api/index.mjs. This established default/endpoint behavior, not runnable integration or password-hashing performance.

Registry latest versions observed:

- React/react-dom 19.3.1; Vite 8.3.5; @vitejs/plugin-react 6.1.2.
- @cloudflare/vite-plugin 1.64.0; Wrangler 4.151.3; @cloudflare/workers-types 5.20261022.1.
- TypeScript 7.0.2; supported alternative queried: TypeScript 6.0.3.
- Hono 4.13.13; Zod 4.6.7; Drizzle ORM 0.45.4; drizzle-kit 0.31.11; Tailwind CSS 4.3.3.
- React Router 8.5.0; TanStack Query 5.104.5; Better Auth 1.7.12.
- ESLint 10.13.0; typescript-eslint 8.72.0; Prettier 3.9.10.
- Vitest 5.0.5; @cloudflare/vitest-plugin 1.4.6; Playwright 1.64.1; pnpm 12.14.0.

Compatibility findings:

- typescript-eslint declares TypeScript >=4.8.4 and <6.1.0. Select TypeScript 6.0.3 pending actual toolchain checks; do not disable unsupported-version warnings to claim strict linting with 7.0.2.
- Cloudflare Vite plugin accepts Vite 8 and requires Wrangler ^4.151.0; the observed versions satisfy those declared ranges.
- Cloudflare Vitest plugin accepts Vitest ^4.1.0 or ^5.0.0; observed Vitest satisfies that declaration.
- React Router requires Node >=22.22.0 and React >=19.2.7; observed Node 24.18.0 and React 19.3.1 satisfy them.
- Peer/engine metadata is not a successful install, build or runtime test. Recheck releases/security notices and resolve the complete tree at implementation time with strict peer checks and a frozen lockfile.
- Prefer maintained accessible primitives for complex dialogs/selects after checking their actual compatibility. Do not build keyboard/focus behavior from scratch or install an entire component suite without need.

## Query and resource design

### Access-path inventory

- Login: unique normalized phone; sessions by token; membership by center/user; roles by membership with center-scoped foreign keys.
- Student list: center + archive state + chosen stable sort + ID cursor. Exact identifier/phone and indexed prefix search initially; do not promise unindexed arbitrary substring search is cheap.
- Group members: center/group/active membership/student; reverse student/group path only if actually needed.
- Exam/marks: center/exam/paper and center/paper/participant uniqueness; fetch one bounded participant page and applicable results with set-based joins, not one query per student.
- Campaign list: center + created_at + ID. Recipient list: center/campaign + ID, with a status index only for frequent status filtering.
- Scheduler/outbox: runnable state + due timestamp + ID; cap scanned/claimed work per invocation and distribute progress across centers.
- Delivery checks: unresolved state + next_check_at + ID. Never rescan all delivered history looking for outstanding work.

Validate compound-index order against actual predicates and EXPLAIN QUERY PLAN. LIMIT bounds output, not necessarily scanned rows; explicitly test optional filters and search paths. Each new index must justify its read benefit against write/storage overhead.

### Efficiency acceptance rules

- No query-per-row marks page or campaign preview. Bounded set-based reads and cursor pagination; no deep OFFSET over growing history.
- No unbounded SELECT *, full-history bootstrap or giant client selection array. Narrow columns reduce bytes, not D1's per-row billing metric.
- Batch changed marks with validation/version checks. No write on every keystroke or unchanged provider status response.
- Maintain campaign outcome counters through guarded state transitions; don't COUNT all recipient rows for every progress refresh. Test counter reconciliation after failure.
- Debounce search, scope client query caches by center, avoid focus-triggered storms, and stop progress polling on hidden tabs or terminal campaigns. Reopening a page fetches current state.
- Balance refresh coalesces concurrent calls and uses an explicit freshness window; proposal 60 seconds for display, fresher check before dispatch when needed. Do not poll balance per message.
- Delivery check cadence proposal: increasing delays with a configurable bounded window, initially up to 24 hours subject to provider guarantees; unresolved messages remain reviewable after automatic checks stop. Avoid eagerly queuing a separate check for every message before it is due.
- Queue jobs contain small IDs/cursors, not copies of entire recipient lists or keys. Evaluate provider-aligned chunk jobs to reduce queue events without losing per-recipient state. Consumer batching alone does not reduce per-message operation billing.
- Submit only verified provider batch sizes. Limit concurrency to protect the provider, and apply per-center pacing/quotas so one center cannot exhaust shared capacity. These operator safety limits are configurable, not a hardcoded class/student limit.
- Retry budgets, campaign caps for abuse protection, scheduler lateness policy and usage alerts prevent runaway costs. Alerts/CPU limits are not a guarantee of a total hard monetary spending cap.

## Cost model and capacity evidence

Do not quote a monthly total until student/message volume and provider tariff are known. The user's request for any number of recipients is a large-campaign requirement, not a numerical traffic estimate.

- Provider cost: sum billable segments per rendered recipient times the account tariff, plus verified fees. Message length differs by student/summary; recipients are not equivalent to segments.
- D1 read/write budget: sum observed rows_read/rows_written for actual actions and background transitions, including indexes. Record metadata from staging and compare plans before/after optimization.
- Queue budget: for small messages, normal enqueue/read/delete is roughly three operations per event, plus retries, DLQ and additional stages. Distinguish per-provider-recipient work from queue-job count.
- Worker budget: dynamic requests, CPU, scheduled/queue executions and observability. Add build minutes, retained logs, storage and other account-wide usage to the estimate.
- Workers Paid currently starts at USD 5/month per account, not per center, with usage subject to its allowances. This is a recommendation to evaluate for production, not approval to upgrade. Free CPU/quota failures must be tested; do not weaken password hashing to stay free.
- Queues currently includes 10,000 operations/day on Free with 24-hour retention. Paid includes 1 million operations/month and charges USD 0.40/million beyond that; retention differs. These are dated planning inputs, not a fixed bill promise.
- Suggested synthetic test sizes: 100, 1,000 and 10,000 students/messages across several centers. They are benchmark cases, not product limits or fabricated observed capacity. Agree larger tests once expected deployment volume is known.

Proposed performance targets, not measurements: usable mobile form without a horizontal page scroll; local input feedback within 100 ms; initial route JS budget 200 KiB gzip excluding deferred screens and optional font assets; LCP <=2.5 s, INP <=200 ms and CLS <=0.1 under an agreed representative mobile/network test. Auth hashing latency is measured separately from dashboard loading. Adjust targets with evidence, not silent regressions.

## Strict quality gates

- TypeScript strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes, noImplicitOverride, useUnknownInCatchVariables and exhaustive state handling.
- Type-aware ESLint: floating/misused promises, unsafe assignments/calls, explicit any, non-null assertion misuse, React hooks and accessibility checks. No blanket disables or unsafe casts to make checks green.
- Prettier check separate from semantic lint. Fail CI on warnings intended to be errors; shared configs apply to all workspaces.
- Generate binding types from actual Worker configuration; do not hand-maintain inaccurate Env types. Use a tested compatibility date at setup and review updates intentionally.
- Zod contracts validate HTTP input and provider response boundaries. DB constraints and authorization are still required; shared TypeScript types alone do not validate runtime input.
- Unit tests for pure domain rules; Vitest/Workers runtime integration for D1/queues/scheduling; Playwright for workflows, responsive behavior and authorization UX.
- Test fresh migrations and upgrade from the previous production schema. Inspect generated SQL before applying. Test rollback-compatible application releases instead of assuming destructive down-migrations are safe.

## Critical acceptance-test matrix

1. Tenant isolation: center A cannot read/mutate center B via guessed IDs, joins, role grants, preview cursors, cache reuse, message-ID refresh or forged jobs. Every tenant feature participates.
2. Permissions: every resource/action pair has allow/deny tests; revoke while form/campaign is open; staff cannot grant owner/platform roles; archived roles grant nothing.
3. Ownership: concurrent transfers/removals retain exactly one admin. Center suspension blocks dispatch. Existing global accounts cannot be hijacked by invitation or center-admin reset.
4. Authentication/recovery: login throttling and enumeration resistance; setup expiry/replay; wrong/used recovery codes; concurrent redemption; password/session revocation; operator recovery audit. No reachable public signup/OTP bypass.
5. Records: duplicate names, siblings/shared phones, overlapping groups, class transfer, archive/history, invalid references and cross-center foreign keys.
6. Marks: scored zero, decimals, boundary maximum, pending/absent/exempt, subject not applicable, maximum reduction and two-editor conflict. Failed small batches do not partly save unnoticed.
7. Templates: wrong scope, unsupported/missing variable, long names, Bangla, line breaks, extension characters/emoji, empty body and provider maximum length. No XSS in previews.
8. Resolution: overlapping groups produce one student/content/destination; siblings remain separate; same student phone through two recipient roles deduplicates; missing/suppressed contacts are visible.
9. Approval: changed results/contact/template/permission between preview and confirmation; double click; request timeout/client retry; incomplete snapshot cannot send.
10. Schedule: UTC/local conversion, invalid/past dates, timezone ambiguities, overdue threshold, edited source, rotated key, removed authorizer, cancelled work and duplicate cron events.
11. Provider: documented acceptance/rejection, low balance, 429 semantics, partial bulk success, unexpected status, missing IDs, malformed JSON, huge body, connection reset and timeout.
12. Crash injection: before claim, after claim/before request, after provider acceptance/before persistence, after persistence/before queue acknowledgement, after enqueue/before outbox publication.
13. Recovery: expired queue work, DLQ, exhausted retry budget, counter reconciliation and fair progress across centers. Unknown submissions never turn into blind retries.
14. Credentials: no raw key in browser/network responses, application logs, queue, audit, Git files or error monitoring. Center-specific balance and message lookup always use that center's correct credential revision.
15. UI/PWA: all screen states, 320-1440 px targets, keyboard, text zoom, screen-reader labels/focus, software keyboard, reduced motion, offline failure, update with unsaved marks, logout/center-switch cache isolation.
16. Restore: restored campaign jobs do not resend already submitted SMS; scheduler remains stopped until reconciliation; recovery-code and password state restoration is reviewed for rollback-induced reuse risk.

## GitHub and Cloudflare release design

- No Git repository or remote was configured during planning. Before a future push, obtain the intended GitHub repository/visibility and sanitize the original API documentation. Never stage secrets.
- One Worker per environment, not one Worker per tenant; separate production/staging D1, queues, secrets, domains and provider mode.
- Connect GitHub to Cloudflare Workers Builds as requested. Use repository root for the pnpm workspace; build watch paths include apps, shared packages, tooling and lockfile.
- Build sequence: frozen install -> generated-type check -> formatting -> strict lint -> type check -> unit/runtime integration tests -> production build. Browser checks run in GitHub checks if Cloudflare's build image cannot run them.
- Protect production main with required checks before merge. Cloudflare Builds does not automatically wait for unrelated GitHub Actions checks; ensure essential checks are also in the blocking Cloudflare build path and use branch protections for browser checks.
- Deploy through the connected Cloudflare build command, which may invoke the repository-pinned Wrangler internally. No local direct production deploy and no separate competing GitHub deploy workflow.
- Single migration owner in the pipeline: apply reviewed additive migrations before the new application version. Preview builds never target production D1. Serialize production migrations/releases; no two builds racing against the same schema.
- Use expand/contract schema changes and versioned job payloads. Rolling back Worker code does not roll back D1 or revoke an SMS; retain compatibility with queued jobs and the previous schema.
- Configure runtime secrets in Cloudflare settings; do not confuse build secrets with runtime bindings. Per-center provider keys stay in D1 under the requested model.
- After release, compare the deployed Git revision, check authenticated isolation-safe smoke paths, bindings, scheduled trigger and queue consumption in staging. Production paid-send smoke tests need express approval.

## Operational and recovery plan

- Structured redacted logs with request/job IDs and normalized outcomes. Sample ordinary success logs; retain critical failures without collecting raw SMS bodies or credentials.
- Track provider acceptance/unknown/failure rates, oldest pending job, reconciliation lag, DLQ, schedule lateness, D1 rows/latency, Worker CPU/errors and per-center send volume. No promise of proactive alerts until the chosen alert channel is configured/tested.
- Provide center-level pause plus a platform emergency dispatch-disable control that stops unsent work without deleting history. Already-submitted requests cannot be recalled.
- D1 Time Travel currently provides 7-day recovery on Free and 30 days on Paid. Agree backup/recovery objectives with the operator; restoration is a manual exceptional action, not a normal campaign retry tool.
- Before restore: disable dispatch/schedules and queue consumption, record available external/provider message IDs and recent job state, take an approved recovery checkpoint. After restore: reconcile against provider/audit evidence; mark unresolved work unknown; invalidate affected sessions/setup/recovery tokens where rollback could re-enable them; never automatically replay restored outbox rows.
- Provider outage: stop unsafe sends, expose paused/unknown outcomes, allow known-ID status checks within limits and record manual resolutions. Do not silently change provider/sender/recipient/text.
- Retention purge uses reviewed rules and bounded indexed batches. Preserve minimally necessary deduplication/tombstone evidence so deleting a payload cannot accidentally authorize replay.

## Source evidence

- [D1 row billing and metadata](https://developers.cloudflare.com/d1/platform/pricing/)
- [Index/query-plan guidance](https://developers.cloudflare.com/d1/best-practices/use-indexes/)
- [Queues pricing and retention](https://developers.cloudflare.com/queues/platform/pricing/)
- [Queue repeated-delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/)
- [Queue concurrency controls](https://developers.cloudflare.com/queues/configuration/consumer-concurrency/)
- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Git-connected builds](https://developers.cloudflare.com/workers/ci-cd/builds/)
- [Build commands, paths and runtime-secret distinction](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
- [Monorepo build paths](https://developers.cloudflare.com/workers/ci-cd/builds/advanced-setups/)
- [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [Time Travel recovery](https://developers.cloudflare.com/d1/reference/time-travel/)

Package metadata evidence: npm view <package>@latest version engines peerDependencies --json, and npm view typescript@6 version --json. Metadata compatibility is an investigation result, not a claim of successfully executed application checks.
