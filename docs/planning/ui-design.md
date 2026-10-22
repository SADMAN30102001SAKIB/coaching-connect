# UI design system and screen specification

Status: proposed visual/interaction specification, not rendered screens or an approved prototype. Business configuration is dynamic; spacing/color tokens and component behavior are intentionally consistent.

## Experience principles

- Primary daily path: exam -> marks -> review -> send/schedule -> outcomes.
- Keep academic work separate from delivery troubleshooting and account administration.
- One clear primary action per step. Never hide paid-send confirmation inside an unlabeled icon or an auto-save action.
- Show the current center consistently; switching center clears selections/drafts from the previous context. Never carry student names or balance across centers in cached UI.
- Render only permitted features/actions, but still enforce all permissions on the server. Explain permission loss on an already-open screen.
- Bangla and English labels use translation keys, not duplicated screen implementations. Interface locale and outgoing message language are separate choices.

## Proposed design tokens

- Background: #F8FAFC; surface: #FFFFFF; primary text: #0F172A; secondary text: #475569.
- Primary action/focus accent: #4338CA; on-primary: #FFFFFF.
- Success text/surface: #166534 / #F0FDF4; warning: #92400E / #FFFBEB; danger: #B91C1C / #FEF2F2.
- Interactive control boundary: #64748B; decorative dividers can use #CBD5E1. A faint divider must not be the only way to identify an input.
- Calculated contrast: primary 7.90:1; body/background 17.06:1; secondary/white 7.58:1; success 6.81:1; warning 6.84:1; danger 5.91:1; control boundary/white 4.76:1. Recalculate for hover/disabled/focus combinations during implementation.
- Spacing scale: 4, 8, 12, 16, 24, 32, 48 px. Input/button minimum height: 48 px. Use actual shared tokens, not repeated magic values.
- Type: 16 px body/input, 14 px secondary label, 20/24/28 px headings with comfortable Bangla line heights. Proposed fonts: system Latin stack and a self-hosted Bangla font if a suitable licensed asset is approved. Do not rely on external font requests for usability.
- Radius: 8 px controls, 12 px panels/sheets. No shadows, gradients, decorative glass effects, or gratuitous dashboard charts.
- Motion: 120 ms color/opacity feedback, up to 160 ms sheet transition; no animation that delays saving or navigation. Respect prefers-reduced-motion. No infinite decorative motion or animated count-up balances.
- Status text/icons accompany colors. Focus indicators remain visible and distinct; do not remove outlines for aesthetics.

## Responsive layout

- Under 640 px: one column, bottom navigation, full-page long forms, safe-area-aware sticky actions. Marks use a subject selector and student rows rather than a squeezed spreadsheet.
- 640-1023 px: wider rows/panels where useful; same task order and component behavior.
- 1024 px and above: sidebar, main content, optional contextual preview panel. Marks can use a semantic grid with a usable mobile alternative.
- Validate at 320, 360, 390, 768, 1024 and 1440 px plus text zoom and landscape. These are test targets, not device-specific hardcoded layouts.
- Long Bangla names wrap, phone/marks columns remain readable, and the software keyboard must not hide the active score or Save action.
- No page-wide horizontal scrolling. A genuinely tabular desktop view may have a clearly scoped accessible scroll region, never the only mobile marks-entry path.

## Navigation and screen inventory

Five mobile destinations: Home, Students, Exams, Messages, More. More contains templates, academic setup, staff/roles, settings and account security according to permission. Desktop sidebar exposes the same destinations.

Screen types and key actions:

1. Login: phone/password, show password, sign in, recovery link, language switch. No public signup or OTP button.
2. Account activation: invitation validation, name/password setup, accept terms of access, then recovery-code handoff. Existing users sign in before accepting a membership.
3. Recovery/security: recovery-code redemption, platform-help instructions, password change, regenerate codes, session sign-out. Codes shown only once and never included in analytics.
4. Center chooser: permitted memberships only; choose center. Skip automatically when exactly one active membership exists.
5. Home: next task, due/paused campaigns, recent activity, cached balance with last-checked time. Primary: continue the most relevant permitted task; never auto-send.
6. Student list: search, bounded filters, add student, select eligible students, archive through a contextual action.
7. Student profile/editor: names/identifiers, contacts/recipient rules, group memberships, academic history; save, add contact, archive. Distinguish student contact information from staff login identities.
8. Groups: group list/detail, student membership, add/remove members and archive. No staff-assignment panel.
9. Academic setup: class/session/subject management with a consistent small-record editor. Referenced records archive rather than vanish.
10. Exam list: search/filter, create exam, resume marks, open results. Display draft/ready states and incomplete marks clearly.
11. Exam detail/editor: papers, maximum marks, participant snapshot, date, series association; save, enter marks, review results. Subject ordering is editable.
12. Marks entry: choose paper, student search, score/status fields, changed-row count, save changed marks, next paper. Read-only states explain permissions/finalization.
13. Exam series/combined selection: choose/order exams and applicable subjects; preview summary scope; no grade or weight settings.
14. Campaign wizard: scope -> recipients -> template/message -> review -> send or schedule. Steps preserve unsent edits during navigation; final approval is a separate server operation.
15. Campaign history: center-local date/status filters and cursor pagination; open details. No account-wide provider-history claims.
16. Campaign detail: frozen message scope, progress, timestamp/timezone, outcome counts, bounded recipient list; cancel/pause/resume/retry only when permitted and meaningful.
17. Recipient detail: masked destination by default, permitted rendered content, attempt timeline, provider status/last check, safe refresh and explicit resend warning.
18. Templates: library/editor, typed variable picker, actual student preview, missing-field feedback, save, duplicate, archive.
19. Staff and roles: memberships/invitation setup; role list/editor with feature rows and distinct action grants. Explain grants before save; no group ACLs or platform privilege checkbox.
20. Center/SMS settings: identity/timezone/locales, write-only key replacement, sender list, masked config, balance/refresh, schedule policy. Key replacement warns about paused pending campaigns.
21. Platform operations (operator-only): provision/suspend centers, manage initial admin setup, recorded assisted recovery; do not expose student/message data as a default dashboard.

These are screen types, not 21 separate implementations: shared editors, list shells and detail layouts reduce duplication. The number of visible buttons varies legitimately with permissions and state; a single fixed button count would be misleading.

## Three key mobile wireframes

Home:

```text
[Center name v]                       [Account]
Good morning
[Continue: October exam marks]        primary
Next scheduled send: date/time + timezone
Needs attention: 1 paused campaign -> details
Balance: last fetched value [Refresh]
Recent sends: name / outcome / time
[Home] [Students] [Exams] [Messages] [More]
```

Marks:

```text
[Back] October exam / Evening batch
[Physics v] Maximum: configured value
[Search student]
Student name / identifier
[Score input] [Scored / Absent / Pending / Exempt]
Student name / identifier
[Score input] [Status]
...bounded page...
Unsaved changes: 7                    [Save marks]
```

Final review:

```text
[Back] Review result messages
Center / sender / recipient type
Eligible messages / excluded / duplicate selections removed
[View exclusions] [Browse actual message previews]
Estimated segments and cost; clearly labeled uncertainty
[Send now] or [Date] [Time] [Timezone]
Frozen results and cancellation limitation notice
[Confirm sending] OR [Confirm schedule]       one primary
```

## Reusable components and overlay policy

- Foundations: typography, tokens, icons with accessible labels, button/link variants, focus treatment.
- Forms: Field, TextInput, PasswordInput, PhoneInput, ScoreInput, Select, Checkbox, DateTimeField, inline validation summary.
- Feedback: Alert (persistent actionable), Toast (noncritical transient), SaveStatus, ProgressSummary, StatusBadge, EmptyState, LoadingState, ErrorState, PermissionState.
- Structure: AppShell, PageHeader, ListToolbar, CursorPagination, mobile row/desktop table variants, DetailSection, FilterSheet.
- Domain: StudentPicker, RecipientSummary, MarksEditor, TemplateEditor, MessagePreview, PermissionMatrix, masked ProviderSettings.
- Shared overlays: ConfirmDialog, UnsavedChangesDialog, FinalSendDialog, FilterSheet, small-record editor sheet, RecoveryCodesDialog. Complex role editing, marks and campaign setup remain pages.
- Do not stack dialogs. Focus returns to the trigger; Escape/back behavior is deliberate. Destructive confirmations name the affected record/count. Paid-send confirmation shows the actual scope.

## State and error behavior

- Every data screen specifies loading, empty, populated, filtered-empty, failed, expired-session and denied states.
- Every mutation specifies idle, validating, submitting, succeeded, conflicted and failed. Disable repeated taps locally; server idempotency still provides the real protection.
- Marks: explicit bounded Save, not a request per keystroke. Show pending changes immediately and announce successful persistence only after acknowledgement. Keep edits in memory on recoverable failures; warn before navigation. Initial release does not persist sensitive marks drafts to device storage.
- Examples: MARK_EXCEEDS_MAX -> inline maximum; RESULT_CONFLICT -> compare/reload; CONTACT_MISSING -> affected students + fix link; BALANCE_LOW -> pause + refresh; SUBMISSION_UNKNOWN -> check status, not automatic retry.
- Authentication intentionally uses a non-enumerating phone/password error. A universal demand for detailed errors must not disclose whether an account exists.
- Unexpected failures show a safe description, recovery action where safe and reference ID; never raw stack traces or provider requests.

## PWA and accessibility

- Manifest, approved icons, HTTPS and platform-specific install guidance. Site remains usable if installation is unsupported.
- Service worker caches versioned public shell assets only. No API, SMS content, student records, keys, credentials or recovery-code caching. Never background-sync paid SMS sends.
- Offline: show a clear offline screen/banner; no false Saved or Scheduled status. A new worker update prompts a safe reload when no unsaved form would be lost.
- Target WCAG 2.2 AA: semantic labels, keyboard paths, focus management, announced errors/progress, zoom/reflow, contrast and touch usability. Automated checks supplement real-device/screen-reader testing.
- Verify on actual Android Chrome and iPhone Safari/Home Screen if these are used; installability and offline behavior vary by browser.

References: [WCAG 2.2](https://www.w3.org/TR/WCAG22/), [PWA installation](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable), [service-worker lifecycle](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers).
