# Planning and implementation status

Updated: 2026-10-22 (Asia/Dhaka). The user authorized implementation after this investigation; application source, SQL migrations, strict checks, a production build and local browser tests now exist. See the [project README](../../README.md) for the actual implementation and deployment steps.

These documents preserve the original requirements and design investigation. Statements about “no implementation in this investigation” describe the earlier planning stage, not the current repository.

## Read in this order

1. [Requirements and business rules](requirements.md)
2. [System, data, and security design](system-design.md)
3. [UI design system and screen specification](ui-design.md)
4. [SMS provider investigation and support questions](sms-provider.md)
5. [Quality, efficiency, deployment, and recovery](delivery-and-verification.md)

## Confirmed decisions

- Multiple independent coaching centers; one admin teacher per center and multiple staff.
- Phone-number/password login. Platform owner creates or approves centers.
- No authentication SMS. Recovery codes and platform-assisted recovery instead.
- Center-owned SMS API keys, balance, sender settings, records, campaigns, and history.
- Store API keys in D1 without an additional application-level encryption layer, at the user's explicit request. Keep them server-only and redact them everywhere else.
- Editable center roles with feature/action permissions, not per-group staff assignments.
- Bangla and English interface/message support. Manual entry only; no import.
- Marks and combined summaries first; no grading or weighted-total engine.
- Immediate and scheduled sending; large campaigns processed in bounded chunks.
- Cloudflare Workers Static Assets, D1, Queues, and GitHub-connected Cloudflare builds. No manual local production deployment.
- Mobile-first, fast UI; no decorative shadows or slow animation. Purposeful micro-interactions are allowed.

## What the investigation established

- The workspace initially contained only APIDocs.txt; no existing application, package manifest, Git configuration, or project instruction file was observed in the inspected paths.
- Workers can combine HTTP and queue handlers. One modular deployable Worker is the revised recommendation, rather than two independently released backend Workers.
- D1 exposes scanned/written-row metadata; indexes and query plans must be measured, not assumed efficient.
- Queue delivery can repeat. Application-level duplicate suppression cannot make a provider without idempotency guarantee exactly-once SMS delivery.
- The provider documents personalized bulk sends, balance estimates, and lookup by known message ID; it does not document complete bulk response semantics or an account-wide history listing.
- A credential-free GET to the documented API base returned HTTP 404. That does not establish whether individual API routes work. The web reader could not access that base. No send or sandbox route was probed.
- The provider's public marketing page advertises Bangla support and two-way SMS, but supplies no usable inbound-message contract in the supplied documentation. Its pricing sections are inconsistent; do not derive billing rules from them.
- npm metadata was queried without installing packages. The latest TypeScript 7.0.2 is outside typescript-eslint 8.72.0's declared TypeScript range (>=4.8.4, <6.1.0). Proposed compiler: 6.0.3, not an unsupported latest combination.
- Better Auth 1.7.12 package source was inspected in an OS temporary directory without installing project dependencies. It confirms phone/password without mandatory OTP, but setup/recovery requires explicit application integration; global-admin password changes do not automatically revoke sessions. See system-design.md for the source-qualified constraints.
- Proposed UI text/background pairs were checked mathematically; ratios range from 5.91:1 to 17.06:1. This is not a rendered accessibility audit.

## Current readiness

- [x] Implementation authorized by the user; coding is no longer blocked on provider replies.
- [x] Compatible dependencies installed, strict formatting/lint/type checks and production build exercised locally.
- [x] Local Worker/D1 tests cover tenant isolation, permissions, account setup/recovery, optimistic marks, source changes, unknown submissions, large preparation, repeated sending chunks and indexed row reads.
- [x] Desktop/mobile browser journeys cover setup, marks, personalized preview and mock submission. Additional checks cover home accessibility, responsive widths, persisted Bangla selection and offline PWA navigation.
- [x] Local deployment dry run succeeds. This is not an actual release.
- [ ] Configure the intended Cloudflare database/queues/runtime secrets, GitHub repository/build and domain.
- [ ] Run the GitHub-hosted quality workflow and Cloudflare-connected release.
- [ ] Conduct an expressly authorized small live SMS pilot; confirm one-recipient bulk submission, actual acknowledgement shape, delivery, multipart charges and account limits.
- [ ] Verify installation/usability on the intended physical phones and rehearse restoration with dispatch disabled.
- [ ] Rotate the apparent documentation credential if genuine. The original file remains ignored and unchanged.

Implementation adjustments: native Worker-supported scrypt and database-backed sessions replaced the proposed Better Auth dependency. One-use database claims protect setup/recovery, including concurrent activation of the same global identity. The runtime is pinned to the tested workerd compatibility date, 2026-10-19. ESLint 9 and TypeScript 6 are intentionally compatible with the installed strict tooling; an unsupported “latest everything” combination is not used.

Provider uncertainties are handled with conservative pacing and explicit unknown/paused states, not fabricated success. Mock tests do not prove billing, live delivery, zero bugs or unlimited capacity.
