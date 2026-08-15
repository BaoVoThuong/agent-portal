# Table Config — End-to-End Production Review

## Review metadata

- Review date: 2026-08-15
- Repository: agent-portal
- Branch: main
- Scope: /config Table Columns, Dropdown Values, Assistant Membership, SLA Times, and downstream Task/Enrollment consumers.
- Review type: Production correctness, data integrity, state consistency, UI/accessibility, concurrency, and operational safety.
- Change policy: Review only. No application code, database data, migrations, or configuration were changed during this audit.
- Overall verdict: REQUEST CHANGES before calling Table Config production-ready.
- Severity summary: No confirmed P0/P1 was found in the reviewed paths. Multiple P2 issues can cause incorrect configuration, stale UI, failed writes, or an unavailable configuration page.

## Architecture and data flow

    /config
      ↓
    ConfigPage (server data loader)
      ↓
    ConfigClient (tabs, local edits, optimistic UI, realtime refresh)
      ↓
    Config APIs
      ├─ /api/config/columns
      ├─ /api/config/columns/:id/options
      ├─ /api/config/categories
      ├─ /api/config/assistants
      ├─ /api/admin/task-sla-rules
      ├─ /api/admin/task-reminder-settings
      └─ /api/enrollment/option-sets
      ↓
    Supabase tables, RPCs, constraints, and realtime events
      ↓
    Tasks and Enrollment list/detail/create/edit flows

The configuration screen is a high-blast-radius dependency. A value or flag saved here is consumed by task creation/editing, task list rendering, enrollment creation/editing, filters, exports, SLA calculations, and the ACA overview dashboard.

## Verification performed

- npm run typecheck — PASS.
- Scoped tests for table-config, SLA, and task transitions — PASS: 13 files, 135 tests.
- Scoped ESLint for the reviewed config/API/table-config paths — PASS.
- git diff --check — PASS.
- Full npm run lint — FAIL only because of an unrelated pre-existing unstaged change in src/app/(authed)/enrollment/_components/AcaOverviewDashboard.tsx (two errors and warnings in that file/related overview files). No Table Config lint error was observed.

The worktree already contained an unrelated unstaged modification in AcaOverviewDashboard.tsx; it was not touched by this review.

---

# Context for future maintainers

## What is being audited

This document audits the Health Table Configuration page at `/config` end to end. The page is not an isolated admin screen. It is the control plane for the shared data model used by:

- Health Customer Service Tasks (CS Task Board).
- ACA Enrollment records and ACA Overview.
- Medicare Enrollment records.
- Task/enrollment create dialogs, detail dialogs, list tables, filters, exports, and inline editors.
- Assistant Membership and task-assignment eligibility.
- SLA rules, reminders, countdowns, overdue state, and time-progress displays.

The review covers both sides of the system:

1. **Configuration UI:** what an administrator can see, edit, archive, restore, and save.
2. **Server/data behavior:** what the APIs, validation, database constraints, realtime refresh, and downstream consumers actually accept and render.

The goal is to verify that a setting shown as authoritative in `/config` has one predictable meaning everywhere it is consumed.

## Why this matters

Table Config is a high-blast-radius dependency. A seemingly small change to a label, color, option, required flag, terminal flag, or person field can change what users are allowed to select, what records can be created, how records are filtered, and what the dashboards report. A UI-only restriction is not sufficient: direct requests, stale browser tabs, imports/exports, and concurrent administrators can bypass the UI unless the API and database enforce the same rule.

The system also has one shared product experience. CS, ACA, and Medicare should use the same visual and interaction contract for equivalent data types. The CS Task Board is the reference behavior for shared person displays, colored values, assignment controls, loading/error states, and list interactions; program-specific business rules may remain different.

## Product/UI issues that motivated this audit

The following observations were raised during product review and are included as explicit audit context. They are not merely cosmetic requests because several can expose inconsistent state or cause users to choose the wrong value:

- **Dropdown value colors were inconsistent.** Colors configured in `/config` did not always match the colors shown in CS lists, Enrollment lists, detail dialogs, or dashboards. The audit therefore checks the color source of truth, normalization, fallback palettes, and whether every consumer uses the same resolver.
- **Color selection needed a safe default.** Administrators should receive a recommended/automatic color instead of having to invent a color manually. The recommendation must not silently diverge from the color rendered elsewhere.
- **Terminal and QC flags are stage semantics.** Terminal/QC controls should be available only for Stage options. Category, Carrier, Payment Status, and other option sets do not represent workflow stages and should not receive those controls. ACA dashboard terminal behavior is an ACA-specific stage rule, not a global flag for CS or every enrollment option.
- **Person fields must have one shared display.** Agent, Assignee, Caller, Responsible Enroll, and custom columns of type Person should use the same avatar/name treatment as CS. Empty values should consistently display an Unassigned state with the person icon; they should not alternate between Select, No agent, No caller, or blank. Names should be shown to users, not raw email addresses.
- **Equivalent create/detail/list controls should look and behave alike.** The enrollment dialogs were visibly different from CS dialogs for assignment controls, colored values, and field placeholders. The audit checks whether the underlying configuration/data contract makes those surfaces consistent rather than relying on one-off UI patches.
- **Large option sets need searchable selection.** Some dropdowns can contain 100 or more values. A scroll-only list is not an adequate production interaction; search, keyboard navigation, disabled/archived handling, and selected-value preservation need to be considered.
- **Archived values must not re-enter active flows.** Archiving is used to retire a value without rewriting historical records. Active lists should hide archived values, while normal mutation APIs must reject stale updates to archived rows. Recreating a label after archive must also have a deliberate restore/key policy.
- **Required settings must match actual create behavior.** If an administrator marks an Enrollment custom field Required, the create API and UI must enforce it. A setting that is visible but intentionally skipped creates incomplete records and is worse than a clearly unsupported setting.
- **Client/list interactions are part of the contract.** Client name navigation, sticky identity columns, horizontal scrolling, avatar sizing, row height, and time-progress fields need to remain aligned between CS and Enrollment. This review treats Config as the source of the data/type rules that make those displays possible, while noting downstream UI regressions when the config contract is not honored.

## Data/logic questions this review must answer

For every configurable field or option, an intern should be able to answer:

- What is the source of truth: table column, option set, category, SLA rule, or derived consumer value?
- Which scopes can use it: CS, ACA, Medicare, or shared?
- Is the value active, archived, required, hidden, pinned, terminal, QC-enabled, or ACA-dashboard-terminal?
- Which API validates the value on create/update, and which database constraint backs that rule?
- What happens when two admins edit it concurrently?
- What happens when a browser is stale, the schema is not migrated yet, or a downstream refresh fails?
- How does the value render in list, detail, create, filter, export, and dashboard views?

The findings below are written against those questions. A finding is included only when there is a reachable code path and a concrete production consequence; speculative cleanup and broad refactors are intentionally excluded.

## Severity guide for this document

- **P2:** A realistic production issue that can create invalid configuration/data, stale user-visible behavior, failed administration, or an important inconsistency. It should be fixed before relying on Table Config for go-live operations.
- **P3:** A medium-risk UX, accessibility, maintainability, or hardening gap. It may follow the P2 fixes but must have an owner and validation plan.

---

# Findings

## [P2] One transient loader failure takes down the entire Config page

Location: src/app/(authed)/config/page.tsx:24-77
Affected area: All Config tabs
Status: Open

### Problem

ConfigPage loads columns, dropdown options, agents, candidates, assignees, memberships, categories, SLA rules, enrollment option sets, and usage in one Promise.all. Any rejection rejects the whole page, including failures in a lower-priority section such as SLA usage or assistant membership.

### Production scenario

A transient categories/SLA query error or a single schema-dependent query failure causes /config to render an error instead of allowing an administrator to edit unaffected columns or options.

### Impact

- Availability: Config becomes unavailable for all sections.
- Reliability: A single dependency has page-wide blast radius.
- Correctness: No data corruption, but administrators cannot make required changes.

### Recommendation

Load independent sections independently. Render section-level loading/error states with retry actions. Treat optional analytics/usage data as non-blocking.

---

## [P2] Column reorder is non-atomic and has no concurrency/version guard

Location: src/app/api/config/columns/reorder/route.ts:39-65
Affected area: Table Columns ordering
Status: Open

### Problem

The reorder endpoint updates every column with independent statements inside Promise.all. If one update fails, earlier updates remain committed and the table is left with a partially applied order. Two administrators reordering at the same time can overwrite each other with last-write-wins behavior.

### Production scenario

An intermittent database/network error occurs on the fourth update of a ten-column reorder. The first three positions are saved and the remaining positions are old. A second admin then saves another order over the mixed state.

### Impact

- Data integrity: Mixed positions and inconsistent ordering.
- Concurrency: Lost updates between administrators.
- UX: A success response may not represent a complete reorder.

### Recommendation

Move reorder to one transactional RPC/server transaction, validate the full set, apply positions atomically, and use an expected revision or advisory lock. Return a conflict when the revision is stale.

---

## [P2] Layout-reset failures are returned as warnings but shown as success

Locations:

- src/app/api/config/columns/[id]/route.ts:103-126
- src/app/api/config/columns/reorder/route.ts:54-65
- src/app/(authed)/config/ConfigClient.tsx:504-508, 550-573

Affected area: Column visibility/order/pin changes and saved table layouts
Status: Open

### Problem

The API can return warnings when resetTableLayoutsForScope fails. The client callers discard the returned response payload and run() still displays a successful mutation toast. The administrator is told that the change was applied for everyone even when existing user layouts were not reset.

### Production scenario

An admin hides a column and expects all users to receive the new default. The layout reset RPC times out, but the config mutation succeeds and the UI shows success. Existing users keep stale layouts indefinitely.

### Impact

- State consistency: Config and per-user layout state diverge.
- UX: False success and difficult troubleshooting.
- Operations: No reliable indication of which users need a reset.

### Recommendation

Surface warnings in the mutation result and toast, provide retry/reconciliation, and make config/layout reset one transaction where possible. Never report full success while the requested reset failed.

---

## [P2] Custom values are accepted without validation against live table configuration

Locations:

- src/app/api/tasks/route.ts:50-64
- src/lib/tasks/transitions.ts:143-150
- src/app/api/enrollment/[id]/route.ts:628-642

Affected area: Task and Enrollment custom fields
Status: Open

### Problem

cleanCustomValues validates shape/scalar values but does not validate that a key is configured in the correct scope, that its type is compatible, or that a dropdown value is active and belongs to the selected option set. Archived, deleted, or fabricated option identifiers can be persisted through direct requests or stale clients.

### Production scenario

A stale browser submits an option that an administrator archived. The record stores the old value. List/detail rendering may show a blank/raw identifier, filtering and export no longer match configured choices.

### Impact

- Data integrity: Invalid configuration references persist.
- UI/reporting: Blank labels, raw IDs, inconsistent filters/exports.
- Boundary enforcement: The server trusts client-provided configuration keys.

### Recommendation

Add one shared server-side validator used by task and enrollment create/update paths. Validate scope, column existence, active status, data type, option-set ownership, archived status, and scalar shape. Return a clear 400/409.

---

## [P2] Required custom Enrollment fields are bypassed during record creation

Locations:

- src/app/api/enrollment/route.ts:201-227
- src/lib/table-config/required.ts:34-37

Affected area: Enrollment custom columns
Status: Open

### Problem

Enrollment creation calls findMissingRequiredFields with checkCustom: false. The Config UI allows administrators to mark custom columns Required, but the current create surface does not render those inputs and the API intentionally skips enforcement.

### Production scenario

An administrator marks a custom enrollment field required. A new ACA or Medicare enrollment is created without the field and is accepted as complete.

### Impact

- Business correctness: Required configuration is not enforced.
- Data quality: New enrollments can be incomplete.
- Expectation mismatch: The setting appears authoritative but has no effect on create.

### Recommendation

Render and validate custom enrollment inputs, or prevent the Required toggle for unsupported custom Enrollment columns. Do not silently bypass a setting presented as authoritative.

---

## [P2] Archived custom and enrollment options remain mutable through API routes

Locations:

- src/app/api/config/columns/[id]/options/[optionId]/route.ts:47-55, 79-87
- src/app/api/enrollment/option-sets/[id]/route.ts:84-89

Affected area: Dropdown Values archive/update/delete behavior
Status: Open

### Problem

Mutation queries update/delete by ID but do not consistently add archived_at IS NULL. A stale client or direct request can update or re-delete a value that is already archived.

### Production scenario

An option is archived in one browser. Another open browser still has its ID and submits an update. The archived row is changed after it was removed from active lists.

### Impact

- Data integrity: Archive is not an immutable historical boundary.
- Recovery: Restoring or auditing values becomes ambiguous.
- Consistency: UI and API disagree about what is mutable.

### Recommendation

Use an active-row predicate for all normal mutations and return 404/409 for archived values. If editing history is deliberate, expose a separate restore/edit endpoint with audit logging.

---

## [P2] Recreating an archived custom column can fail with a unique-key 500

Locations:

- src/app/api/config/columns/route.ts:61-94
- supabase/schema.sql:3350-3368

Affected area: Add custom column after archive
Status: Open

### Problem

The create route calculates a unique key from active columns. The database uniqueness constraint covers archived rows too. After archiving a column such as PCP, creating a new PCP can pass the application check and then fail at the database constraint, returning a generic 500.

### Production scenario

An admin archives a custom column and later decides to recreate it. The Add action fails even though the UI no longer displays the archived column as active.

### Impact

- Correctness: A valid administrative action fails.
- UX: Generic server error instead of a conflict or restore choice.
- Operations: Archived history blocks future configuration.

### Recommendation

Choose an explicit policy: restore the archived column, generate a new key, or use a partial unique index over active rows. Detect the archived collision and return a typed 409.

---

## [P2] Active custom dropdown options can have duplicate labels

Locations:

- supabase/schema.sql:3370-3379, 3381-3430
- src/app/api/config/columns/[id]/options/route.ts:61-70

Affected area: Custom dropdown option management
Status: Open

### Problem

There is no active unique constraint or server-side conflict check for duplicate labels within the same custom option set. Two options with the same visible label can have different IDs and colors.

### Production scenario

A user sees two Pending choices in a combobox. The list stores only the ID, while exports and filters usually display the label, so users cannot reliably distinguish the selected value.

### Impact

- Data interpretation: Same display text represents different IDs.
- Filtering/export: Results are ambiguous.
- UX: Users cannot make an informed selection.

### Recommendation

Add a partial unique index on (column_id, lower(trim(label))) for active options, or reject duplicates with a 409. Decide explicitly whether case/whitespace normalization defines label identity.

---

## [P2] SLA rule save has a read-then-write race

Locations:

- src/app/(authed)/config/_components/ConfigSlaSection.tsx:117-156
- src/app/api/admin/task-sla-rules/route.ts:62-99

Affected area: SLA Times editor
Status: Open

### Problem

The API selects a rule and then decides whether to update or insert. Concurrent saves for the same priority/category can both observe “missing,” race to insert, or overwrite each other with stale values.

### Production scenario

Two administrators edit the same SLA rule within milliseconds. One request receives a unique violation or the later response silently replaces the first administrator’s intended values.

### Impact

- Data integrity: Lost or failed rule updates.
- Operational behavior: Task due/overdue calculations change unpredictably.
- Reliability: Race is timing-dependent and hard to reproduce.

### Recommendation

Use one database upsert/RPC keyed by the natural rule key, with optimistic version checking if edits must not overwrite one another. Return 409 on stale versions and test concurrent saves.

---

## [P2] Reminder settings can overwrite each other and can leave unsafe defaults enabled

Locations:

- src/app/(authed)/config/_components/ConfigSlaSection.tsx:77-107, 183-215
- src/app/api/admin/task-reminder-settings/route.ts:21-25, 93-123

Affected area: SLA reminder settings
Status: Open

### Problem

On load failure, the component stops loading while leaving DEFAULT_REMINDER_SETTINGS editable, so an admin can unknowingly save defaults over real production values. Each field save sends the entire settings object from a local snapshot; rapid edits can cause one request to overwrite another field with an older value. The API accepts positive integers without an upper bound.

### Production scenario

The GET request fails temporarily. The UI displays defaults, the admin changes one field and saves, and real settings are replaced. Alternatively, two quick field edits issue full-object PUTs and the slower request restores the first snapshot.

### Impact

- Data integrity: Lost settings or unintended reminder cadence.
- Reliability: Behavior depends on request ordering.
- Operations: Reminder noise or missed reminders.

### Recommendation

Render a hard error/read-only state after load failure. Replace whole-row PUT with field-level PATCH or a serialized/versioned update. Validate practical minimum and maximum bounds server-side.

---

## [P2] Task Board can keep stale SLA data after configuration changes

Locations:

- src/app/(authed)/tasks/_components/TaskBoardClient.tsx:574-584, 601-609
- src/app/api/admin/task-sla-rules/route.ts

Affected area: Task SLA countdown, overdue state, and board display
Status: Open

### Problem

The task board listens for table-config changes and marks config stale, but SLA rules are fetched only at mount. The SLA API does not publish a matching invalidation event. A changed SLA therefore does not affect an already-open board until reload.

### Production scenario

An admin changes the Urgent SLA from 24 to 8 hours. A worker with the board open continues seeing old countdown/overdue values and may prioritize work incorrectly until refresh.

### Impact

- Correctness: Visible due/overdue state is stale.
- Operations: Users make decisions from obsolete policy.
- Consistency: Config page and task board disagree.

### Recommendation

Publish an SLA-config invalidation event or shared revision and refetch the SLA snapshot when it changes. Preserve cancellation/latest-request-wins behavior.

---

## [P2] Assistant membership API does not enforce the UI roster contract

Locations:

- src/app/(authed)/config/ConfigClient.tsx:1698-1740
- src/app/api/config/assistants/route.ts:47-98

Affected area: Assistant Membership
Status: Open

### Problem

The UI offers the assignees roster, but the API checks only that the target is an active portal account/task agent. It does not enforce isEligibleTaskAssigneeEmail or equivalent roster rules. A direct request can add an active account that is not eligible for task assignment. The route also needs explicit self-membership and cycle prevention rules.

### Production scenario

A user calls the endpoint directly with an active admin/service account that is not on the assignment roster. The membership row is created, but the account cannot access or work the expected task queue.

### Impact

- Authorization/behavior: Membership implies capability the account may not have.
- Operations: Invalid routing and confusing assignment options.
- Data integrity: Membership diverges from the source roster.

### Recommendation

Enforce the same eligibility predicate server-side, reject self/cycles according to the membership policy, and return typed 400/409 errors.

---

## [P2] Synthetic fallback columns expose an unusable mutation path when schema is missing

Locations:

- src/lib/table-config/queries.ts:266-285
- src/app/api/config/columns/[id]/route.ts:163-177

Affected area: Schema-not-ready and migration safety
Status: Open

### Problem

When the table_column schema is missing, query code returns synthetic default columns. The update route can then return a synthetic system-* row, but a subsequent update attempts to write that non-UUID synthetic ID to the database and fails with a 500.

### Production scenario

Application code is deployed before the schema migration. The page appears to have default columns, an admin toggles one, and the mutation fails. Synthetic state looks valid enough to invite repeated writes.

### Impact

- Deployment safety: Code-before-schema rollout is not fail-safe.
- Reliability: Mutations fail with a generic error.
- Operator experience: Schema drift is hidden behind synthetic data.

### Recommendation

Return an explicit CONFIG_SCHEMA_NOT_READY response, render a read-only migration-required state, and do not expose synthetic IDs through mutation-capable UI.

---

# P3 and hardening findings

## Dropdown keyboard and accessibility behavior is incomplete

Location: src/app/(authed)/config/ConfigClient.tsx:324-439
Status: Open

The custom dropdown does not provide a complete keyboard contract: ArrowUp/ArrowDown active-option movement, Home/End, typeahead, and aria-activedescendant/active styling are not consistently implemented. The absolutely positioned list can also be clipped by an ancestor with overflow-hidden. This is especially costly for option sets with 100+ values.

Recommendation: Use a shared accessible combobox/listbox primitive with search, active index, disabled-option skipping, Enter/Escape, focus restoration, and a portal/scroll container that cannot be clipped.

## Confirm dialogs lack a complete modal accessibility contract

Location: src/app/(authed)/config/ConfigClient.tsx:1640-1677
Status: Open

The confirm dialog does not clearly declare role=dialog, aria-modal, labelled-by/described-by relationships, focus trapping, or Escape handling. Keyboard and screen-reader users can lose context or interact with the page behind the dialog.

## Config grids can clip on narrow screens

Location: src/app/(authed)/config/ConfigClient.tsx:591-643
Status: Open

Minimum-width grid content is inside an overflow-hidden layout without a deliberate horizontal-scroll wrapper. Columns and action controls can become inaccessible on smaller screens or browser zoom levels.

## Category colors can diverge between configuration and consumers

Locations:

- src/app/api/tasks/categories/route.ts:47-58
- src/app/api/tasks/categories/[id]/route.ts:27-43
- src/lib/tasks/category-colors.ts:16-55, 68-78

The category API accepts arbitrary color strings. Task consumers apply a fallback palette/normalization when a configured value is missing or invalid. A user can see one color in Config and a different effective color in a list/detail view. Validate a supported color format and use one shared resolver everywhere.

## Non-stage enrollment option flags are accepted by PATCH

Location: src/app/api/enrollment/option-sets/[id]/route.ts:65-82
Status: Open

The UI hides Terminal/QC controls outside Stage and the create route guards them, but PATCH can still set is_terminal or triggers_qc for non-stage options. Enforce the stage-only invariant in every mutation route, not only in the UI.

## Category refresh can report success while keeping stale data

Location: src/app/(authed)/config/ConfigClient.tsx:1226-1229
Status: Open

The refresh path updates local categories only when response.ok, while the surrounding action can still resolve as successful. A failed refresh can leave a stale category list without an error or retry affordance.

## Refresh JSON parsing can mask non-JSON failures

Location: src/app/(authed)/config/ConfigClient.tsx:150-160
Status: Open

The client parses JSON before checking response status. An HTML/proxy error page or empty 500 response can produce a parsing error that hides the real API status and makes the displayed failure less actionable.

## No restore workflow for archived configuration

Archived columns/options/categories are hidden from active views, but there is no clear restore UI. This turns an accidental archive into a support/database operation and increases the chance that users recreate near-duplicate values.

## Large roster/option lists have no search or pagination

Assistant and dropdown editors render complete lists. With 100+ values, scrolling and scanning become slow and error-prone. Searchable comboboxes should be used before adding virtualization; measure first and keep selected/archived behavior explicit.

## Numeric input bounds are inconsistent

Some column/option position patches accept negative or non-integer values, and reminder settings accept any positive integer without a practical upper bound. Normalize and validate bounds at the API boundary, then add database checks where appropriate.

## Task category IDs fail late

src/app/api/tasks/route.ts:126-131 checks only that category_id is a non-empty string. Malformed UUIDs or nonexistent categories can reach the database and return a generic 500 instead of a clean 400/409. Validate format and active existence before insert.

---

# Verified strengths

The following paths were checked and did not produce a finding:

- ACA dashboard terminal classification is correctly restricted to ACA stage options.
- Workflow terminal/QC controls are restricted to Stage in the Config UI.
- Enrollment readers filter archived options from active choices.
- Active enrollment option labels have a uniqueness constraint.
- Column PATCH queueing and scope/option request sequencing reduce stale UI overwrites.
- Required/Pinned/Hidden invariants are shared between server and client validation.
- The reviewed scoped tests and lint pass.

These positives do not remove the API and concurrency gaps listed above; UI restrictions must be duplicated at the server boundary.

---

# Regression matrix

| Area | Before/expected contract | Current observed risk | Priority |
|---|---|---|---|
| Config availability | One failed optional section should not block unrelated edits | Promise.all fails the whole page | P2 |
| Column order | A reorder is all-or-nothing | Independent updates can partially commit | P2 |
| User layouts | A successful reset means affected layouts are reconciled | Reset warning is discarded and success is shown | P2 |
| Custom fields | Saved values reference active configured fields/options | Arbitrary keys and archived options can persist | P2 |
| Required Enrollment fields | Required setting is enforced on create | Custom required fields are skipped | P2 |
| Archived options | Archived rows are immutable in normal flows | Mutation routes lack active-row predicates | P2 |
| Dropdown labels | Visible labels uniquely identify choices | Duplicate active labels are allowed | P2 |
| SLA rules | Concurrent saves preserve intended state | Read-then-write race | P2 |
| Reminder settings | Field edits merge predictably | Whole-row stale snapshots can overwrite fields | P2 |
| Task SLA display | Open boards reflect latest SLA config | SLA changes require reload | P2 |
| Assistant roster | API and UI expose same eligible users | API accepts users outside UI roster | P2 |
| Migration rollout | Code-before-schema fails clearly and read-only | Synthetic IDs reach mutation paths | P2 |
| Accessibility | Dropdowns/dialogs are keyboard and SR usable | Incomplete combobox/dialog semantics | P3 |
| Responsive UI | All config controls remain reachable at zoom/mobile widths | Grid content can be clipped | P3 |
| Category colors | Config and consumers use one color contract | Consumer fallback can differ from saved color | P3 |

---

# Recommended execution order

1. P2 data/contract guards: shared custom-field validator; archived-row mutation guards; non-stage enrollment flag guard; duplicate-label conflict; category ID/color validation.
2. P2 atomicity/concurrency: transactional reorder; SLA upsert/versioning; reminder PATCH/versioning; layout-reset reconciliation.
3. P2 consistency/availability: section-level Config loading/error states; explicit schema-not-ready read-only mode; SLA invalidation to open Task Board; assistant roster authorization.
4. P3 UI hardening: accessible searchable dropdown primitive; modal focus/Escape behavior; responsive horizontal scroll; restore workflows; bounded inputs.
5. Add regression tests for each production scenario before changing behavior in production.

## Required regression tests

- Reorder failure midway leaves the original order unchanged.
- Two concurrent reorders produce a conflict or one complete, versioned result—not a mixed order.
- Layout-reset failure is visible and retryable; no false-success toast.
- Task/enrollment create/update rejects unknown, archived, wrong-scope, and wrong-type custom values.
- Required custom Enrollment configuration is either enforced or cannot be enabled.
- Archived option mutation returns 404/409.
- Duplicate active option label returns 409 after case/whitespace normalization.
- Concurrent SLA/reminder edits do not lose fields.
- Open Task Board refetches SLA after an SLA revision event.
- Assistant API rejects non-eligible users, self-membership, and cycles according to membership policy.
- Code-before-schema /config is read-only with a clear migration message.
- Dropdown keyboard navigation, disabled options, search, portal overflow, focus restore, and Escape are covered.

# Final assessment

**Status: NOT READY to declare Table Config production-ready without remediation.**

There is no confirmed P0/P1 in the inspected implementation, and existing invariants/tests cover several important paths. However, the P2 issues are real production risks because they affect configuration availability, atomicity, data validity, stale UI behavior, and enforcement of settings that administrators believe are authoritative. Address the P2 items above, add the listed regression tests, and repeat the end-to-end review before go-live.
