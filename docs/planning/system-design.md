# System, data, and security design

Implementation note (2026-10-22): the application now exists. The original Better Auth proposal below was superseded by native scrypt, opaque database-backed sessions and atomic one-use account claims; see apps/worker/src/security.ts and auth.ts. There are no OTP/email dependencies. The root README is authoritative for implemented setup and runtime behavior.

Original design proposal: This narrows the earlier two-Worker suggestion to one modular deployable Worker to simplify releases. Multi-tenancy does not require a Worker or database per center initially.

## Runtime and repository boundaries

```text
Browser / installed PWA
         |
         v
One Cloudflare Worker + Static Assets
  HTTP: auth, scoped API, static app
  Queue: bounded campaign preparation/submission jobs
  Scheduled: due jobs, outbox recovery, delivery reconciliation
         |                         |
         v                         v
       D1                      Queue + DLQ
         |
         v
  Center-specific provider credentials -> SMS provider
```

- Separate modules for HTTP, job processing, auth/authorization, academic rules, and the provider adapter; not one monolithic handler.
- Same-origin /api routes. API routing runs before SPA fallback; a missing API route returns structured JSON, not index.html. Every sensitive response is private/no-store.
- The job Worker does not depend on an open browser, long HTTP request, or waitUntil as a durable queue substitute.
- No R2, KV, Durable Objects, Workflows, Redis, websocket service, paid UI service, or task orchestration framework initially. Add only after measured need.
- One D1 database with explicit tenant boundaries initially. Reassess throughput/storage with measured multi-center volume; do not promise infinite scale. D1 executes work per database serially; keep transactions and jobs bounded.
- Native resource bindings, not Cloudflare REST calls from normal application code.

Proposed pnpm workspace:

```text
apps/web/                 React SPA and reusable UI components
apps/worker/              HTTP, queue, scheduled handlers; serves web build
packages/contracts/       Runtime request/response schemas and error contracts
packages/domain/          Pure result, template, selection and state rules
packages/db/              Drizzle schema, focused queries, migrations
tooling/                  Shared lint/type/format settings
docs/planning/            This specification
```

There is one web app, so reusable UI initially stays in that app. No generic repository layer, plugin framework, or duplicate frontend/backend domain rules.

## Logical data model

All tenant-owned records include center_id. IDs are stable, opaque identifiers; names, rolls, and phone numbers are not primary keys.

- Identity: users, credential accounts, sessions, hashed recovery/setup tokens. A normalized login phone is globally unique under the proposed shared-identity model.
- Centers: name, timezone, locale preferences, status, owner_user_id, configuration revision. A single owner reference enforces the one-admin invariant; staff roles cannot manufacture ownership.
- Memberships: center + user + active status + authorization revision. Unique per center/user.
- Roles: center-owned names/status; role_permissions maps roles to trusted permission identifiers; membership_roles maps memberships to roles.
- Academic configuration: classes, academic_sessions, subjects, groups. Group references class/session where applicable; names are editable and stable IDs preserve links.
- Students: center, institutional identifier, display name, active/archive status, revision. Optional roll uniqueness is scoped to the chosen class/session rule, not globally assumed.
- Contacts: center, normalized destination, display label, suppression state, revision. student_contacts links students to contacts with relationship and recipient permissions.
- Group memberships: center, group, student, joined/left dates. Historical and active membership queries are distinct.
- Exams: center, name, date-only exam date, lifecycle/revision. Papers link subjects to exams with fixed-point maximum/pass marks and display order.
- Exam participants: center, exam, student. Paper participation can mark a student not applicable; different subject combinations do not require duplicate student records.
- Results: center, paper, participant, status, nullable fixed-point score, revision, editor. Unique per paper/participant. State/score checks are database constraints where possible.
- Exam series: center-owned series and ordered exam links, used to select multiple exams for combined summaries; no weighting engine.
- Templates: center, scope, editable text, revision. Campaigns retain the exact approved text/version rather than requiring every keystroke to create a permanent version.
- Provider configuration revisions: center, API key, approved sender IDs, route/cost settings with validation, active/retired state. No arbitrary teacher-supplied outbound URL.
- Balance cache: center + credential revision, value, provider estimate, fetched_at, refresh state. Never one global balance.
- Campaigns: center, creator, authorizer, immutable selection/approval revision, state, UTC schedule/timezone, counters, credential revision, preparation cursor.
- Campaign messages: center, campaign, student reference if applicable, destination/text snapshot, state, provider ID, next check time, exclusion reason. Unique logical recipient key within campaign.
- Attempts: center, message or submission chunk, unique claim token, started/completed timestamps, normalized outcome, masked diagnostic references. Avoid storing full provider responses by default.
- Outbox/jobs: center, campaign/chunk, stage, cursor, available_at, lease/retry/exhaustion metadata. Unique job identity prevents duplicate dispatch doing duplicate work.
- Audit events: center, actor, action, target IDs, timestamp, safe change metadata. No passwords, keys, recovery codes, or full SMS body in audit events.

## Tenant and permission enforcement

- Derive account identity from the secure session; derive active center only after validating membership. Never trust a request body center_id as authorization.
- Use center_id in every tenant query and in composite foreign keys/unique constraints so cross-center references cannot be created accidentally.
- Queue payloads contain scoped opaque IDs and a job schema version, not API keys or a browser's asserted permissions. Resolve tenant and current authorization from D1 before paid work.
- Cache keys include center and relevant revision. Client query caches clear/isolate on center switch and logout, including persisted state if later introduced.
- Do not cache positive authorization for paid/mutating actions beyond a revocation-safe boundary. Fetch current membership/authorization revision and grants in a bounded indexed query.
- Dynamic permissions select from a stable catalog such as students.read/create/update/archive, results.update, messages.send/schedule/cancel/retry/read_content, balance.read/refresh, templates.manage, provider.manage. Catalog entries are code-defined capabilities, not academic hardcoding.
- Admin-only role/staff management prevents privilege escalation. A stale session, modified button, guessed object ID, or forged queue message cannot bypass these checks.

## Campaign lifecycle and atomicity

1. Select exam(s), groups/students, recipient type, and compatible template; selection is server-resolved.
2. Create a draft/preparing campaign with an idempotency token. Prepare a bounded snapshot in resumable chunks. Record the source versions used.
3. Verify relevant revisions before declaring the preview ready. Conflicting edits invalidate preparation; never send a mixed-version partial result set.
4. Approval atomically records the frozen snapshot/revision, authorizer, job/outbox, and state. D1 batch can roll back failed statements; do not invent interactive database transactions spanning provider calls.
5. Approved immediate work becomes ready. Scheduled work remains in D1 until due; do not depend on a queue delay longer than its supported retention.
6. Dispatcher enqueues opaque job/chunk IDs from the durable outbox. Crash after enqueue but before marking published can duplicate a queue event; that is expected and handled by claims.
7. Consumer atomically claims eligible messages and records a submission attempt before any provider call. Concurrent consumers and repeated events cannot claim the same work twice.
8. Recheck cancellation, center status, authorizer permission, contact eligibility, relevant revisions, provider revision and budget controls at the dispatch boundary. A single check cannot recall work that crosses the boundary concurrently; disclose best-effort cancellation.
9. Submit a provider-limited chunk. Persist per-recipient acceptance IDs only when documented response mapping proves them. Never infer acceptance from array order unless guaranteed.
10. Acknowledge queue work only after the durable state transition. Maintain counters from guarded transitions, not from the number of times an event arrived.

Campaign states: draft, preparing, ready_for_review, scheduled, queued, processing, paused, needs_review, completed, cancelled. Completion has outcome counts; it does not imply every SMS delivered.

Message states: pending, submitting, accepted, delivered, failed, unknown, skipped, cancelled. Attempt/reconciliation metadata distinguishes submission uncertainty from unresolved delivery.

- Explicit rejection known not to have accepted can be eligible for bounded retry; rate-limit responses require documented non-acceptance semantics before safe resubmission.
- Timeout, malformed success, uncertain partial bulk response, crash during submission, or accepted response followed by failed DB persistence is unknown. A stale submitting claim must not automatically return to pending.
- A provider ID permits delivery checks, not another send. No ID plus no provider idempotency/search contract means automatic exactly-once recovery is impossible.
- DLQ/exhausted jobs become operator-visible. Outbox recovery respects exhaustion/retry budgets and cannot reset them endlessly.
- Queue retention expiry is not business-record expiry. Recover only work proven never submitted; ambiguous work stays for review. Fair bounded selection across centers prevents one huge campaign starving others.

## Credentials and account security

- Center API keys are stored in D1 as requested, with no extra application encryption. D1 platform encryption is not protection from a database export, SQL compromise, or privileged account access. This residual risk is explicit.
- Read credentials server-side only for authorized provider operations; settings shows configured/last-updated and a masked suffix, never the original. Reject key fields in logs/error traces/client state/queue messages.
- Approved outbound provider hosts are operator configuration; center admins cannot turn provider settings into SSRF. GET query credentials must be redacted from HTTP diagnostics and proxy logs under our control.
- Replacing a key invalidates its balance cache and pauses unsent campaigns tied to the previous revision for review. Retain restricted old revision access only while necessary to reconcile accepted messages; define expiry/removal deliberately.
- Better Auth phone/password is the proposed auth foundation. Public phone sign-up, OTP endpoints, and phone changes requiring OTP must not remain exposed accidentally when SMS auth is disabled. Confirm the exact supported activation/recovery extension in an implementation spike; do not fake success callbacks.
- Documentation-fit findings: the phone plugin supports password sign-in against a credential account, and enabling requireVerification can trigger OTP delivery. Keep that requirement disabled for this product and do not mount OTP/recovery-by-SMS routes. The username plugin could instead use normalized phone identifiers, but its base signup still requires an email field; switching plugins alone does not solve no-email provisioning. The chosen adapter must explicitly account for the library's internal user schema without introducing a user-facing email requirement. Do not install competing auth approaches before this is reviewed.
- Source qualification: better-auth 1.7.12 was downloaded with npm pack --ignore-scripts to an OS temporary review directory, not installed in the project. Its phone route/types confirm requireVerification defaults false, phone lookup precedes password verification, and sendOTP remains a required callback type. The proposed phone-plugin configuration therefore disables verification, rejects any accidental OTP callback rather than pretending delivery, and blocks OTP HTTP paths. Existing-account versus missing-account timing needs a library-hash-based dummy-verification mitigation plus throttling, not just identical error wording.
- The inspected global admin setUserPassword route writes the credential but does not revoke sessions itself. The password-reset helper does support revocation when configured and uses an adapter transaction abstraction. D1 batch atomicity is not evidence that an ORM's interactive transaction callback works. Account setup/recovery must explicitly prove single-use claims, password changes and revocation on D1, including adapter failures; do not approve recovery by inspecting only the happy-path endpoint. These are implementation qualification tests, not tests claimed to have run during planning.
- Library admin account/password operations are global, not center-role operations. A center admin cannot receive the library's platform-admin role to make staff invitations work. Any library global-admin endpoint exposed to the browser must be restricted to the platform operator; staff account activation/recovery wrappers must be narrowly scoped and tested.
- Use the library's password/session machinery, current password-hashing guidance, secure HttpOnly same-site cookies, origin/CSRF protections, session rotation/revocation, and trusted Cloudflare client-IP handling. Benchmark hash cost on the intended Worker plan; do not weaken hashing to fit Free CPU limits.
- Recovery codes and invitation tokens use cryptographic randomness, one-way storage, expiry/usage limits, and atomic consumption. Operator-assisted reset requires recorded identity checks, not a caller's claimed center role. Regenerating recovery codes invalidates the previous set.
- Assisted-recovery procedure: accept an existing authenticated account or a valid recovery code through the normal secure path first. Otherwise, the platform operator checks independently established onboarding/contact evidence out of band, records the requester/evidence/approval without copying sensitive documents into logs, and issues an expiring one-use setup path through the established channel. A center admin's request alone cannot reset a global staff identity. If evidence is insufficient, refuse reset rather than guess; resolving lost identity is an explicit support boundary. Consume/reset/revoke operations must fail closed and cannot make a used code reusable after an intermediate failure.
- Role/membership edits, password recovery, provider replacement and ownership transfer produce safe audit events. Sensitive account actions require recent authentication.
- Browser responses use a reviewed CSP, frame restrictions, referrer policy and private caching. SMS/template content is plain text and rendered safely; do not use raw HTML insertion.

## API contract boundaries

- Auth/session/recovery endpoints: library-backed plus minimal reviewed account-activation/recovery extensions; no custom password crypto implementation.
- Center context: list memberships, switch context, retrieve current permitted navigation.
- Resources: bounded list/detail/create/update/archive routes for academic records, roles and memberships. Versioned mutations return conflict rather than overwrite newer edits.
- Results: bounded read by exam/paper and batch save of changed rows; reject the entire small save transaction on validation/conflict, while larger work uses explicit chunk outcomes.
- Campaigns: prepare, preview-page, approve/send, schedule, cancel, resume, correction/resend, list/detail/messages. Every paid/mutating action has a scoped idempotency policy.
- Provider settings: masked read, write-only replace, sender configuration, balance read/refresh, and refresh a known local message's provider status. No arbitrary-provider URL proxy or arbitrary message-ID lookup across tenants.
- Errors carry stable code, safe localized message key, field details where safe, retryability and request ID. Expected status families: 400/422 invalid data, 401 session expired, 403 denied, 404 scoped not found, 409 conflict, 429 throttled, 502/503 provider/dependency unavailable.

## Evidence

- [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)
- [Same-project queue producer and consumer](https://developers.cloudflare.com/queues/get-started/)
- [D1 transactional batches](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- [D1 limits and database serialization](https://developers.cloudflare.com/d1/platform/limits/)
- [D1 data security](https://developers.cloudflare.com/d1/reference/data-security/)
- [Better Auth phone/password capability](https://better-auth.com/docs/plugins/phone-number)
- [Username plugin and provisioning constraints](https://better-auth.com/docs/plugins/username)
- [Global administrator operations](https://better-auth.com/docs/plugins/admin)
- [Better Auth security](https://better-auth.com/docs/reference/security)
- [OWASP authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
