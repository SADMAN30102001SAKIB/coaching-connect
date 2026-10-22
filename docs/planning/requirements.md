# Requirements and business rules

Status: confirmed scope plus proposed rules for approval. Requirements use IDs so tests can trace back to them.

## Actors and tenancy

- R01: A platform operator provisions/approves centers and their first admin. Public registration, subscription billing, and a public marketing website are outside the first release.
- R02: Each center has exactly one active owner/admin teacher and any practical number of staff within measured service capacity. Ownership transfer is atomic; the last admin cannot leave or be removed without a successor.
- R03: A personal account uses a normalized phone number and password. Recommended: one identity can hold memberships in several centers, avoiding different passwords for the same person. A center switch changes the authorized context, not the identity.
- R04: Every center's students, academic configuration, staff memberships, roles, SMS configuration, balance cache, and history are isolated. Platform operational access must be explicit and audited, not automatic unrestricted browsing in the normal UI.
- R05: Phone numbers are login identifiers, not proof of number ownership: no OTP verification is available in this scope. Operator-controlled onboarding and guarded account activation are required; the UI must not claim a number is SMS-verified.

## Roles and permissions

- R06: The admin can create, rename, edit, assign, and archive center roles. Staff can have one or more roles; effective access is the union of explicit allowed actions. No deny rules, inheritance trees, or per-group access rules in release one.
- R07: The application publishes a trusted feature/action catalog; the admin configures grants. A teacher cannot invent executable permissions or grant platform-operator privileges.
- R08: Separate read, create, update, and archive/delete actions where meaningful. Sensitive actions are separate: send SMS, schedule, cancel, retry, read balance, refresh balance, read message content, manage templates, manage credentials, manage roles/staff, and transfer ownership.
- R09: Role administration and ownership remain admin-only in the first release. Possessing student-edit permission does not imply permission to send, view credentials, or grant roles.
- R10: No permission is inferred from the frontend. Server checks include current membership and permissions. Revocation invalidates privileged actions promptly; scheduled campaigns lose authorization if their authorizer is removed or loses the needed permission, until reauthorized.
- R11: Historical campaign viewing uses read permissions, not the current ability to send. Raw API keys are never returned, even to an authorized settings viewer; replacement is write-only.

## Academic configuration and records

- R12: The teacher manages classes, academic sessions, batches/groups, subjects, student identifiers, exam names, paper maximum/pass marks, contacts, and templates. None are hardcoded to one institution or a fixed 100-mark scale.
- R13: A group can belong to a class/session; students can join multiple groups. Keep membership dates/history. Student names and phone numbers are not unique student identifiers.
- R14: Contacts may be shared by siblings. Student-contact links carry relationship labels and recipient preference/permission. Normalize phone representations; retain an appropriate display format. Proposed initial destination region is Bangladesh, based on the provider documentation, not a claim of international support.
- R15: Freeze exam participants from selected groups; later group transfers do not silently change past participants. Explicitly adding a participant is permitted before finalization and tracked.
- R16: Exams contain one or more subject papers, each with its own limits. A result is either scored, absent, pending, or exempt. Scored zero is valid; non-scored statuses do not carry numeric marks.
- R17: Use bounded fixed-point marks, not binary-floating arithmetic for stored comparisons/totals. Proposed supported precision: two decimal places. Decimal precision is a product rule for approval, not teacher-written executable math.
- R18: Reject negative marks and marks above the paper maximum. Lowering the maximum below existing marks is blocked until those results are resolved. No invented grades, ranks, or weighted percentages.
- R19: Combined summaries list selected papers/exams in configured order. Optional totals sum only applicable scored results; pending/absent/exempt cases are labeled, never silently treated as zero. Default summaries show individual marks without an ambiguous cross-exam percentage.
- R20: Archive used records instead of breaking history through cascading deletes. Personal-data removal requires an authorized retention/deletion procedure, not an assumption that historical SMS bodies can be retained forever.

## Templates and recipient resolution

- R21: Typed templates: subject result, combined results, general announcement. Allowlisted variables are inserted with labeled controls. No arbitrary code, SQL, HTML, or user-authored loops.
- R22: Subject templates accept student/exam/subject/marks/maximum/status fields. Combined templates use a generated results_summary. Missing required values or incompatible template scope block approval.
- R23: Result campaigns deduplicate overlapping selections by student + destination + selected content scope. Different siblings on the same phone remain separate result messages. Announcements normally deduplicate by destination.
- R24: Choosing both student and guardian must not duplicate an identical student/message/destination. Show exclusions and the deduplication result before sending.
- R25: No opt-in/permission means no send. Archiving, suppression, removed permission, or a changed destination discovered before submission blocks/skips the affected unsent message; never silently substitute a new number after approval.
- R26: Show actual rendered messages, invalid/missing contacts, applicable statuses, estimated segments, and recipients. Segment/cost estimates stay explicitly approximate until provider encoding/rates are verified. Do not silently strip Bangla, punctuation, or emoji to lower price.

## Campaigns and schedules

- R27: Approval creates an immutable message snapshot plus a server idempotency key. Double tap, refresh, or client retry returns the same campaign for the same confirmed operation.
- R28: Large selections use server-side filters and bounded pages/chunks, not one giant browser array or SQL IN list. A campaign has no artificial small recipient cap, but storage, queue, provider, and fair-use limits remain real. Show progress and resumable preparation.
- R29: Relevant source versions are checked throughout preparation and at approval. A changed result, contact, template, selection membership, or permission requires refreshed preview; a partially prepared snapshot cannot be sent.
- R30: Immediate sends run on the server after confirmation and survive the browser closing. A successful HTTP response means the campaign was recorded, not that phones received messages.
- R31: Scheduling stores a UTC instant, the selected timezone, and frozen approved content. Display the timezone and exact date/time at confirmation. Recommend Asia/Dhaka as the initial center default; allow changing it.
- R32: One-time scheduling only initially. Reject past/invalid local times and explicitly disambiguate timezone daylight-saving gaps/overlaps where applicable. No recurring schedule builder.
- R33: At due time, recheck center/membership/send permission, suppression/contact eligibility, relevant source versions, and provider configuration revision. Changed relevant data puts the campaign in needs_review; do not silently recompute and send different results.
- R34: Scheduling is best-effort dispatch, not a promise of exact-second delivery. Proposed late-start policy: pause for review if more than 15 minutes late, configurable by the admin within an operator safety ceiling. This value requires product approval.
- R35: Cancel stops only work not yet claimed for submission. A request already in flight or accepted cannot be recalled. UI wording must state this limitation.
- R36: Low balance pauses unsent work. Resuming requires a balance refresh and authorized confirmation; do not loop failed charge attempts. Balance checks are not reservations and cannot guarantee a concurrent campaign will leave enough funds.
- R37: A correction or intentional resend is a new, explicitly labeled operation linked to the original. Repeated uncertain submissions require a duplicate-charge warning and additional confirmation.

## Identity and recovery

- R38: Normal login is phone/password, with account and trusted-IP throttling and enumeration-safe errors. No authentication SMS, email dependency, or secret security questions.
- R39: New-account activation uses an expiring, single-use invitation/setup token delivered through an approved out-of-band channel. Existing users authenticate to accept a membership; a center admin cannot reset an existing global password.
- R40: Issue single-use recovery codes at setup, show them once, store only hashes, and require secure storage confirmation. Atomic redemption resets credentials/revokes sessions. Codes and passwords are never visible to center admins.
- R41: Platform-assisted recovery uses a documented manual identity check, recorded approval, and a one-use setup path. Knowing a phone number or being a center admin is insufficient to take over a global identity.
- R42: Center deactivation blocks new sends and unsent scheduled work, revokes center access, and preserves authorized historical records subject to retention policy.

## Explicit exclusions and remaining approvals

- No OCR, imports, fees/accounting, attendance, parent portal, inbound SMS UI, grading engine, weighted totals, automatic ranking, public signup, or subscription payments.
- No per-group staff assignment and no authentication SMS.
- Approve the proposed multi-center identity, role-union, precision, late-start, retention, and UI rules before implementation.
- Suggested retention proposal: no routine raw provider payload storage; restricted rendered-message history 12 months; audit metadata 24 months; academic records until admin archive/deletion under an agreed policy. These are product proposals, not legal requirements. Confirm with the center/operator before enabling automatic purges.
- User declined import explicitly; do not add upload parsers or spreadsheet dependencies speculatively.
