# Table Config Remediation — Final Standalone Execution Plan

**Status:** READY TO EXECUTE FROM THIS FILE, subject to the data preflights explicitly called out below  
**Plan date:** 2026-08-15  
**Scope:** `/config`, CS Tasks, ACA Enrollment, Medicare Enrollment, and their shared table-config consumers  
**Document rule:** This file is authoritative and self-contained. An implementer does not need an older draft or another plan.

> [[codex]] This document is a plan only. It does not claim that the application or schema changes below have already been implemented. Execute in stage order, verify each task, update the Execution Log, and create one focused commit per listed commit boundary.

---

## 1. Context: what is being audited and why

`/config` is the control plane for three live work surfaces:

- Health Customer Service (`/tasks`);
- ACA Enrollment (`/enrollment?program=aca`);
- Medicare Enrollment (`/enrollment?program=medicare`).

It controls table columns, Required behavior, custom dropdown values, enrollment option sets, colors, stage rules, assistant membership, SLA rules, reminder settings, and saved layouts. A config screen is not correct merely because it saves a value. The value must be accepted consistently by every write API, displayed consistently in Create/List/Detail, and remain safe under concurrent updates.

The audit was triggered by concrete product defects and inconsistencies already observed:

- terminal and QC controls appeared for value sets where those rules have no meaning;
- the ACA dashboard terminal flag was visible outside ACA Stage configuration and its label did not explain that it means the final dashboard stage;
- saved option colors did not reliably match colors in CS/Enrollment lists and details;
- color recommendation existed, but selection/edit behavior and validation were inconsistent;
- custom Person and dropdown values were not enforced consistently at API boundaries;
- Enrollment Create could not satisfy Required custom fields that Config allowed an admin to create;
- config refreshes and secondary layout resets could fail while the UI still looked successful;
- column reorder, SLA updates, reminder updates and restore/archive flows had stale-write or partial-success risks;
- a proposed validation design would have added up to five database round-trips to a hot inline-edit path.

The objective is to close those gaps with small, testable changes. This is not an architecture rewrite.

---

## 2. Verified current-code facts that constrain implementation

These facts were checked against the repository and must not be reinterpreted during execution:

1. `src/lib/tasks/transitions.ts` already owns cleaning of `custom_values` inside `resolveTaskPatch`.
2. `src/lib/tasks/transitions.test.ts` already contains `manager` and `assigned` fixtures and a passing test named `accepts a custom-values-only edit`.
3. Do not introduce `validatedCustomValues` into `resolveTaskPatch`, do not invent a `baseTask()` fixture, and do not remove the existing cleaner.
4. `ToastTone` is shared in `src/app/(authed)/_shared/Toast.tsx` and supports `info | success | error`. This plan does not extend that global union.
5. `src/app/api/enrollment/route.ts` has no local `isPlainRecord`; routes must import the specifically named helper created by this plan.
6. `fetchTaskAssignees()` is an enriched UI loader with multiple sequential database reads. It must never be used for custom-value write validation.
7. `fetchEnrollmentPeople()` represents the active-account roster currently shown by Enrollment Person pickers. Server validation must use the same eligibility predicate.
8. `findMissingRequiredFields()` currently causes a table-column read in each of the four Task/Enrollment create/update routes. The new validation context must replace that read, not run beside it.
9. `fetchTableColumnsWithOptions()` performs column and option reads sequentially and is too broad for inline mutation validation.
10. `fetchTableColumnOptionsForColumns()` returns only active options. Silently archiving a referenced duplicate can therefore make a stored value lose its label.
11. `taskCategoryBadgePalette()` and `enrollmentIdentityBadgeStyle()` already derive pastel/readable badges. Config preview and all consumers must converge on that behavior rather than render raw saturated hex as the chip background.
12. Initial `/config` already loads multiple independent sections. Do not add an eager full-table custom-option usage scan or a schema-probe request.

---

## 3. Goals and non-goals

### Goals

- Enforce Table Config rules at trusted server/database boundaries.
- Keep Config, CS, ACA and Medicare behavior aligned.
- Preserve user-entered data and return truthful errors.
- Prevent stale writers from silently overwriting newer order/SLA state.
- Make partial success visible without leaking database internals.
- Ensure configured colors render with one shared pastel/readable contract.
- Keep inline-edit and initial-page latency at or below the current baseline.
- Add regression tests around pure logic and database contracts.

### Non-goals

- No broad component or state-management rewrite.
- No new design system.
- No full roster loader in mutation routes.
- No auto-merging or auto-archiving duplicate production data.
- No virtualization until measured list size/render cost proves it is needed.
- No global Toast API change.
- No push/deploy unless separately authorized.

---

## 4. Global contracts

### 4.1 One-request write-validation context

Create a service-role-only SQL function `table_config_write_context` and a TypeScript loader in `src/lib/table-config/write-context.ts`.

Inputs:

- `scope`: `cs | aca | medicare`;
- mode: `create | patch`;
- touched system keys;
- submitted custom-value object.

The function returns only:

- active candidate columns needed by the request;
- active options belonging to candidate dropdown columns;
- submitted Person emails that matched the correct scope roster.

Rules:

- PATCH returns only touched keys.
- CREATE returns touched keys plus all active Required columns.
- Unknown custom keys are detected by comparing requested keys with returned columns.
- Person eligibility runs only when a submitted, non-null value resolves to a Person column.
- CS uses the assignee picker's eligibility predicate but returns matches for submitted emails only.
- ACA/Medicare use the active-account predicate used by Enrollment Person pickers.
- Never return the whole roster, names, roles, memberships, colors, layouts or unrelated options.
- The function is `stable security definer set search_path = public`; revoke public/anon/authenticated execution and grant service_role only.
- Missing config schema is a 503. Mutation paths never validate against synthetic `system-*` fallback rows.

The returned object feeds two pure functions:

- `validateCustomValues(context, submittedValues)`;
- `findMissingRequiredFieldsFromContext(context, fieldValues, customValues, options)`.

The four hot routes must not call `findMissingRequiredFields()` again after loading the context.

### 4.2 Custom-value contract

- Request value must be a plain JSON object when `custom_values` is present.
- Unknown or archived column: 400.
- Wrong scalar type: 400.
- Dropdown value must reference an active option owned by that column: 400.
- Person value must match the correct scope roster: 400.
- Explicit `null` clears an optional value.
- Required values use the same `isRequiredValueFilled` semantics already used by the application, including `false` being a valid checkbox answer.
- PATCH merges the validated delta over stored values exactly once.
- CREATE validates all Required columns.

### 4.3 Color contract

- Stored color is either `null` or lowercase six-digit hex matching `^#[0-9a-f]{6}$`.
- Absent field means “do not change.”
- Explicit `null` means “clear color.”
- Invalid non-null input returns 400; it is never silently converted to null.
- List, Detail, picker and Config preview derive the same pastel background/readable foreground from the stored source color.
- Stage keeps its workflow-state styling where intentionally different.
- Missing historical color uses one stable neutral fallback.

### 4.4 Stage-rule contract

- Workflow terminal and QC apply only to the Stage option set.
- Dashboard terminal applies only to ACA Stage.
- UI hides inapplicable controls; API rejects inapplicable true values instead of silently coercing them.
- Use the UI label `Final stage on ACA dashboard` with help text explaining that these stages are excluded from active ACA dashboard pipeline metrics. Do not show this control in CS Category, custom dropdowns, Medicare sets or non-Stage ACA sets.

### 4.5 No-latency-regression contract

| Path | Network database budget after remediation |
|---|---|
| Task/Enrollment write without custom values | No more calls than baseline |
| Custom text/number/date/link/checkbox/dropdown write | One context RPC replacing the current Required-column read |
| Custom Person write | The same one context RPC; Person matching happens inside PostgreSQL |
| Category create/update | No pre-read; validate UUID syntax in memory and map the write error |
| Initial `/config` | No schema probe and no custom-option usage request |
| Custom option archive | One intentional, on-demand usage request after user intent |

Before and after each hot-route task:

1. Record route-local Supabase calls.
2. Use the same local DB snapshot and request fixture.
3. Warm with at least 20 requests.
4. Measure 100 sequential requests, repeated three times.
5. Record median and p95 route duration and database duration where available.
6. After median/p95 must not exceed baseline beyond baseline run-to-run spread.
7. Any repeatable regression blocks the task; optimize or redesign rather than accepting it.
8. Remove temporary instrumentation before commit.

Do not publish made-up production p50/p95/p99 numbers.

### 4.6 Commit and safety contract

- One listed commit boundary per commit; never combine unrelated bugs.
- Update `changelog.md` in the same commit as the behavior change.
- Do not modify unrelated dirty work, especially `AcaOverviewDashboard.tsx` unless a task explicitly needs it.
- Apply schema changes to a scratch database first.
- Run data preflights before constraints that can fail on existing rows.
- Do not push until explicitly authorized.

---

## 5. Execution stages

| Stage | Tasks | Exit gate |
|---|---|---|
| 0 | Baseline and data preflight | Query/latency baselines recorded; duplicate report produced |
| 1 | 1–3 | Task and Enrollment custom writes enforced with no hot-path regression |
| 2 | 4–8 | Config mutations truthful, stage-only, duplicate-safe, restore-safe and concurrency-safe |
| 3 | 9–11 | SLA/reminder writes concurrency-safe and open boards refresh |
| 4 | 12–14 | Partial failures and section refreshes are honest and recoverable |
| 5 | 15–16C | Color and Config interaction UI standardized |
| 6 | 17–19 | Membership/category invariants and indexed usage confirmation complete |
| 7 | 20 | Full verification and handoff complete |

Do not start the next stage until the current stage's checks and commits are complete.

---

## Stage 0 — Baseline and preflight

### Task 0 — Record reality before editing

**Purpose:** Prevent guessed test totals, guessed latency claims and destructive duplicate cleanup.

**Steps:**

- [ ] Record branch, HEAD, dirty files and current date in the Execution Log.
- [ ] Run `npx vitest run`, `npm run typecheck`, the repository lint command, and `git diff --check`; record actual results.
- [ ] Count Supabase calls for Task create/PATCH and Enrollment create/PATCH with no custom value, dropdown custom value and Person custom value.
- [ ] Capture the latency baseline described in §4.5.
- [ ] Query active `table_column_option` rows grouped by `column_id, lower(btrim(label))` and report duplicate ids, labels, timestamps and live references.
- [ ] Compare CS custom-Person API eligibility with the Assignee picker roster.
- [ ] Compare ACA/Medicare custom-Person API eligibility with `fetchEnrollmentPeople()`.
- [ ] Stop and document if roster predicates disagree.

**No application commit.** Add only measured evidence to the Execution Log when Stage 1 starts.

---

## Stage 1 — Trusted custom-value writes

### Task 1 — Add the targeted write context and pure validator

**Files:**

- Create `src/lib/table-config/custom-values.ts`
- Create `src/lib/table-config/custom-values.test.ts`
- Create `src/lib/table-config/write-context.ts`
- Create `src/lib/table-config/write-context.test.ts`
- Modify `src/lib/table-config/required.ts`
- Modify `src/lib/table-config/required.test.ts`
- Modify `supabase/schema.sql`

**Implementation:**

- [ ] Export `isCustomValueRecord`, `validateCustomValues`, typed issue/result models and safe message formatting.
- [ ] Pre-index columns and options once per validation; do not rebuild sets in each field iteration.
- [ ] Export `findMissingRequiredFieldsFromContext`; retain the async wrapper for untouched callers.
- [ ] Add `table_config_write_context` exactly as specified in §4.1.
- [ ] Bound input size and reject invalid scope/mode inside the function.
- [ ] Ensure the roster CTE is not executed for non-Person input.
- [ ] Map schema-missing errors to a typed availability error.

**Tests:**

- [ ] Valid scalar values and explicit null.
- [ ] Non-object `custom_values` rejection.
- [ ] Unknown/archived column.
- [ ] Archived option and option from another column.
- [ ] Invalid Person and normalized valid Person.
- [ ] Required checkbox false is filled.
- [ ] `supabase.rpc` called exactly once with bounded inputs.
- [ ] Scratch-DB test proves CS and Enrollment predicates and non-Person roster short-circuit.

**Performance gate:** One context RPC total for both Person and non-Person cases.

**Commit:** `feat(table-config): add one-request write validation context`

### Task 2 — Enforce custom values on Task create and update

**Files:**

- Modify `src/app/api/tasks/route.ts`
- Modify `src/app/api/tasks/[id]/route.ts`
- Modify `src/lib/tasks/transitions.test.ts` only for additive regression assertions

**Create flow:**

- [ ] If `custom_values` exists, require `isCustomValueRecord`.
- [ ] Load one create-mode context for submitted custom keys plus Required columns.
- [ ] Validate/coerce values from returned columns/options/Person matches.
- [ ] Run Required validation from the same context.
- [ ] Insert validated values.

**PATCH flow:**

- [ ] Determine touched keys before transition resolution.
- [ ] Load one patch-mode context.
- [ ] Replace raw custom values in a copied request body with the validated delta.
- [ ] Pass the copied body to existing `resolveTaskPatch`.
- [ ] Keep the existing cleaner and custom-values-only transition behavior.
- [ ] Merge the validated delta over stored values exactly once.
- [ ] Run partial Required validation from the same context.

**Do not:** modify `resolveTaskPatch` ownership, add `validatedCustomValues`, use `fetchTaskAssignees`, or call `fetchTableColumnsWithOptions`.

**Tests/acceptance:**

- [ ] Existing `accepts a custom-values-only edit` test remains unchanged and passing with `manager`/`assigned`.
- [ ] Add unknown key, wrong option, archived option, null clear and invalid Person coverage.
- [ ] Inline dropdown/text PATCH has no more DB network calls and no measured regression from baseline.

**Commit:** `fix(tasks): enforce custom values without hot-path query growth`

### Task 3 — Enforce Enrollment update and wire Required fields into Create

**Files:**

- Modify `src/app/api/enrollment/route.ts`
- Modify `src/app/api/enrollment/[id]/route.ts`
- Modify `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`
- Create or extend a controlled shared custom-field form component under `src/app/(authed)/_shared/`

**Server:**

- [ ] Reject present non-object `custom_values` with 400.
- [ ] Use one context RPC for validation and Required checks in create/update.
- [ ] Use the Enrollment active-account Person predicate inside that RPC.
- [ ] Remove `checkCustom: false` behavior once Create can render those fields.
- [ ] Merge PATCH delta once; never replace unrelated stored custom values.

**Create UI:**

- [ ] Pass active custom columns, options-by-column and existing Enrollment Person choices explicitly into `NewEnrollmentDialog`.
- [ ] Render controlled custom fields; do not reuse table-cell blur/edit lifecycle unchanged.
- [ ] Include custom keys in missing-required calculation, invalid styling, first-invalid focus and error labels.
- [ ] Submit only intended custom values.
- [ ] Keep ACA/Medicare program-specific system fields separate while sharing data-type rendering.

**Tests/acceptance:**

- [ ] Required text/dropdown/Person fields appear and block missing ACA/Medicare Create.
- [ ] UI-listed Person is accepted by the API.
- [ ] Malformed object, archived option and cross-column option are rejected.
- [ ] Non-Person and Person writes each use one context network request and meet latency baseline.

**Commit:** `fix(enrollment): enforce custom values in create and update`

---

## Stage 2 — Safe Config mutations

### Task 4 — Make inactive config rows immutable with truthful errors

**Files:**

- Modify `src/app/api/config/columns/[id]/route.ts`
- Modify `src/app/api/config/columns/[id]/options/[optionId]/route.ts`
- Modify `src/app/api/enrollment/option-sets/[id]/route.ts`
- Modify `src/app/api/tasks/categories/[id]/route.ts`
- Add pure error-mapping tests under `src/lib/table-config/`

**Implementation:**

- [ ] Normal PATCH/DELETE includes active-row predicates and validates parent ownership.
- [ ] A zero-row result returns stable 409 `CONFIG_VALUE_INACTIVE_OR_MISSING`; do not falsely claim it was already archived.
- [ ] If product needs distinct missing vs archived copy, perform one admin-only all-row lookup only on the exceptional zero-row path, never the normal path.
- [ ] Remove response branches made unreachable by helpers that already hide archived rows.
- [ ] Do not expose raw database messages.

**Acceptance:** Archived/missing/wrong-parent ids cannot mutate; successful paths add no query.

**Commit:** `fix(config): reject writes to inactive config rows`

### Task 5 — Enforce and render stage-only flags

**Files:**

- Modify `src/app/api/enrollment/option-sets/route.ts`
- Modify `src/app/api/enrollment/option-sets/[id]/route.ts`
- Modify `src/app/(authed)/config/_components/ConfigClient.tsx`
- Add/extend pure tests in `src/lib/table-config/values.test.ts`

**Implementation:**

- [ ] Centralize rule eligibility from scope and option-set key.
- [ ] Reject terminal/QC true for non-Stage sets.
- [ ] Reject dashboard-terminal true unless the set is ACA Stage.
- [ ] Never silently coerce an invalid true value to false while returning success.
- [ ] In Config, render Workflow terminal and QC only for Stage.
- [ ] Render `Final stage on ACA dashboard` only for ACA Stage, with explanatory help text.
- [ ] Existing records with invalid legacy flags are reported by a diagnostic and corrected only through an explicit data action.

**Acceptance:** Category, Carrier, Payment, Platform, custom dropdown and Medicare non-Stage screens show no meaningless rule controls.

**Commit:** `fix(config): enforce stage-only option rules`

### Task 6 — Prevent duplicate active option labels without data loss

**Files:**

- Modify `supabase/schema.sql`
- Modify custom option POST/PATCH routes under `src/app/api/config/columns/`
- Add normalization/error-mapping tests under `src/lib/table-config/`

**Preflight gate:**

- [ ] Use one defined identity: `lower(btrim(label))` within a column.
- [ ] If duplicate groups exist, record survivors/candidates/reference counts and stop this task pending admin choice.
- [ ] Never auto-archive or auto-remap production values.

**Implementation after clean preflight:**

- [ ] Add a partial unique index for active normalized labels per column.
- [ ] Production rollout uses a non-blocking index procedure appropriate to the database; canonical fresh-schema definition remains in `schema.sql`.
- [ ] Map 23505 to typed 409 for create and rename.
- [ ] Keep current active-option readers unchanged.

**Acceptance:** Concurrent duplicate create/rename produces one success and one 409; no stored reference loses its label.

**Commit:** `fix(config): reject duplicate active option labels`

### Task 7 — Require explicit confirmation to restore an archived column

**Files:**

- Modify `src/app/api/config/columns/route.ts`
- Modify `src/app/(authed)/config/_components/ConfigClient.tsx`
- Add a reusable confirmation dialog only if no suitable shared dialog exists

**Implementation:**

- [ ] A create collision with an archived column returns typed 409 containing safe archived id/label/type.
- [ ] UI explains that restoring brings back the old type, options and settings.
- [ ] Restore is a separate request carrying `restore: true`; never run automatically in a catch handler.
- [ ] Reject type mismatch.
- [ ] Reconcile/reset saved layouts after restore and surface partial failure.
- [ ] Success copy says `Column restored`, not `Column added`.

**Accessibility:** Focus trap, Escape close, backdrop/inert behavior, initial safe focus and opener-focus restoration.

**Commit:** `fix(config): confirm archived column restoration`

### Task 8 — Make column reorder atomic and stale-writer-safe

**Files:**

- Modify `src/app/api/config/columns/reorder/route.ts`
- Modify `src/app/(authed)/config/_components/ConfigClient.tsx`
- Modify `supabase/schema.sql`
- Add pure request/result tests under `src/lib/table-config/`

**Wire contract:** Client sends `scope`, `expected_column_keys` in originally loaded order, and desired `column_keys`.

**RPC behavior:**

- [ ] Validate arrays contain exactly the active key membership with no duplicates.
- [ ] Lock active rows in deterministic id order.
- [ ] Compare current ordered keys with `expected_column_keys` after locking.
- [ ] On mismatch return `COLUMN_ORDER_STALE` mapped to 409.
- [ ] Update all positions atomically in one statement.
- [ ] Return canonical new order.
- [ ] Reset saved layouts after commit; failure is a structured warning, not a rollback claim.

**Concurrency test:** Two writers start with the same expected order and choose different orders; first succeeds, second receives 409.

**Performance:** Replace current N row updates; do not add another normal-path request.

**Commit:** `fix(config): make column reorder atomic and version-aware`

---

## Stage 3 — SLA, reminders and live invalidation

### Task 9 — Add optimistic concurrency to SLA rules

**Files:**

- Modify `src/app/api/admin/task-sla-rules/route.ts`
- Modify `src/app/(authed)/config/_components/ConfigSlaSection.tsx`
- Modify `src/lib/tasks/types.ts`
- Modify `supabase/schema.sql`
- Extend `src/lib/tasks/sla-config.test.ts`

**Implementation:**

- [ ] GET includes `updated_at`.
- [ ] Existing-rule save/delete sends `expected_updated_at`.
- [ ] A single RPC locks, compares token, updates/deletes and returns the row; no read-then-write route sequence.
- [ ] Stale token maps to 409 and UI reloads/offers retry.
- [ ] Concurrent insert relies on the existing functional uniqueness constraint; map 23505 to conflict instead of 500 or overwrite.
- [ ] Validate category UUID syntax before calling a UUID-typed function.
- [ ] Never use last-write-wins upsert for existing rules.

**Acceptance:** Stale editor cannot overwrite or delete a newer rule; normal save uses one DB write request.

**Commit:** `fix(sla): add versioned rule mutations`

### Task 10 — Make reminder updates partial, integer-safe and ordered

**Files:**

- Modify `src/app/api/admin/task-reminder-settings/route.ts`
- Modify `src/app/(authed)/config/_components/ConfigSlaSection.tsx`
- Modify `src/lib/tasks/reminder-settings.ts`
- Extend `src/lib/tasks/reminder-settings.test.ts`

**Implementation:**

- [ ] Reject non-finite, non-integer and out-of-bounds raw values before conversion; do not round `1.5` into acceptance.
- [ ] PATCH one whitelisted key/value at a time so unrelated fields cannot be overwritten by stale form state.
- [ ] Update that DB column atomically and return the full canonical settings object.
- [ ] Serialize requests per key or disable that editor while saving; a newer same-key edit must be sent after the earlier request completes.
- [ ] Merge canonical response without replacing newer local edits for other keys.
- [ ] Failed initial GET keeps editors read-only and shows retry; never render editable defaults as if loaded.

**Acceptance:** Concurrent edits to different keys survive; rapid same-key edits finish with the last user value.

**Commit:** `fix(sla): make reminder updates partial and ordered`

### Task 11 — Refresh open Task Boards after SLA changes

**Files:**

- Modify `src/lib/table-config/realtime-topics.ts`
- Modify `src/lib/table-config/realtime.ts`
- Modify `src/app/(authed)/config/_components/ConfigSlaSection.tsx`
- Modify `src/app/(authed)/tasks/_components/TaskBoardClient.tsx`

**Implementation:**

- [ ] Add one documented SLA invalidation topic/payload.
- [ ] Config broadcasts from the client only after a confirmed save/delete, so API response latency is not extended.
- [ ] Task Board subscribes and refetches SLA rules without resetting task list state.
- [ ] Refetch again when channel reaches SUBSCRIBED after reconnect and on normal focus/revalidation boundary.
- [ ] Deduplicate bursts with one in-flight/latest refresh guard; do not debounce user mutations.
- [ ] SLA refresh failure is separate from general table data failure.

**Acceptance:** Two-tab test shows changed SLA without page reload; reconnect heals a missed event.

**Commit:** `fix(sla): invalidate open boards after policy changes`

---

## Stage 4 — Honest failure and recovery UI

### Task 12 — Surface partial success without changing shared Toast

**Files:**

- Modify `src/app/api/config/columns/[id]/route.ts`
- Modify `src/app/api/config/columns/reorder/route.ts`
- Modify `src/app/(authed)/config/_components/ConfigClient.tsx`
- Add pure warning/result helpers and tests under `src/lib/table-config/`

**Contract:** `{ ok: true, warning?: { code: string; message: string } }` for a primary mutation that committed while secondary layout reset failed.

**Implementation:**

- [ ] Server logs detailed cause with operation/scope/id, but returns stable safe warning copy.
- [ ] Client shows existing `info` tone with explicit text: primary change saved; layout reset did not complete.
- [ ] Never show the ordinary full-success toast for partial success.
- [ ] Do not modify `src/app/(authed)/_shared/Toast.tsx` or add global warning tone.

**Commit:** `fix(config): report layout reset partial failures`

### Task 13 — Isolate Config section failures with zero extra load query

**Files:**

- Modify `src/app/(authed)/config/page.tsx`
- Modify `src/app/(authed)/config/_components/ConfigClient.tsx`
- Add `src/app/(authed)/config/error.tsx`
- Modify direct Config mutation routes only for shared schema-error mapping

**Implementation:**

- [ ] Classify columns as load-bearing; categories/options/agents/memberships/SLA/reminders as independently recoverable where safe.
- [ ] Use settled typed loader results for optional sections; one rejected promise must not reject the entire page.
- [ ] Infer config schema readiness from already-loaded column ids: synthetic ids start with `system-`.
- [ ] Do not call a separate schema probe.
- [ ] Pass per-section `available/error` state and disable mutations in failed sections.
- [ ] Distinguish known missing-schema fallback from permission/network failures; the latter must remain errors.
- [ ] Direct mutations reject synthetic ids and map missing table/schema to 503.
- [ ] Implement Next 16 `error.tsx` using the repository's installed docs and actual retry prop.

**Acceptance:** Optional-section failure leaves other sections usable but cannot overwrite unavailable data; initial query count does not increase.

**Commit:** `fix(config): isolate section failures without extra probes`

### Task 14 — Make refresh functions status-aware and latest-request-wins

**Files:**

- Modify `src/app/(authed)/config/_components/ConfigClient.tsx`
- Add pure response/sequence helpers and tests under `src/lib/table-config/` if needed

**Implementation:**

- [ ] For scope, category, enrollment-option, agent and assistant refreshes, check `response.ok` before consuming success payload.
- [ ] Parse error bodies defensively and show safe endpoint-specific errors.
- [ ] Maintain a request sequence per refresh family; a late older response cannot replace newer state.
- [ ] Keep last good data visible on refresh failure and mark that section stale/read-only where mutation safety requires it.
- [ ] Do not add retries or extra requests automatically.

**Acceptance:** Forced 500/invalid JSON/slow-old-response scenarios display truthfully and preserve latest good state.

**Commit:** `fix(config): make refresh failures and races visible`

---

## Stage 5 — Colors and Config interaction consistency

### Task 15 — Enforce one color format and one pastel rendering contract

**Files:**

- Modify `src/lib/table-config/value-colors.ts` and tests
- Modify `src/lib/tasks/category-colors.ts` and tests
- Modify `src/lib/enrollment/option-badge.ts` and tests
- Modify Category, custom-option and enrollment-option POST/PATCH routes
- Modify `src/app/(authed)/config/_components/ConfigClient.tsx`
- Modify shared custom-value rendering in `src/app/(authed)/_shared/EditableCustomCell.tsx`
- Modify CS/Enrollment list/detail/picker consumers only where they bypass shared palette helpers

**Implementation:**

- [ ] Centralize normalized color parsing; distinguish absent, null and invalid.
- [ ] Apply validation to create and update for all three value families.
- [ ] Keep stored color as source color; derive pastel/readable palette through shared helpers.
- [ ] Config displays editable raw swatch plus the exact derived preview users see.
- [ ] Recommended color is selected automatically for a new value, can be cycled/changed before Add, and the final choice is persisted.
- [ ] Existing saved colors render identically in CS/ACA/Medicare List, Detail and selectors for the same data type.
- [ ] Do not change Stage styling where workflow semantics intentionally differ.

**Tests:** invalid non-null, uppercase normalization, explicit clear, readable foreground, Config/CS/Enrollment palette equality and neutral fallback.

**Commits:**

1. `fix(config): validate canonical option colors`
2. `fix(table-config): share pastel value palettes across consumers`

### Task 16A — Reuse the accessible searchable listbox in Config

**Files:**

- Modify `src/app/(authed)/config/_components/ConfigClient.tsx`
- Reuse `src/app/(authed)/_shared/SearchableListboxPanel.tsx`
- Reuse the existing anchored-menu hook; move it to `_shared` only if both modules need a neutral import location
- Extend pure option-search tests if filtering logic changes

**Implementation:**

- [ ] Replace Config's private `DropdownSelect` where long option lists are possible.
- [ ] Preserve button sizing, selected-value preview and disabled behavior.
- [ ] Search is case-insensitive and uses the repository's existing accent/`đ` normalization; do not create a third normalization variant.
- [ ] Arrow keys skip disabled choices; Enter cannot choose disabled; Escape closes once and restores opener focus.
- [ ] Portal Tab handling returns focus to trigger before normal navigation so focus does not jump to end of document.
- [ ] Root owns `flex flex-col overflow-hidden`; result list owns `flex-1 min-h-0 overflow-auto`; remove nested competing max-height scroll containers.
- [ ] `role=listbox` belongs on the option container, never around the combobox input.

**Commit:** `fix(config): reuse searchable listbox controls`

### Task 16B — Keep wide Config grids inside their cards

**Files:** `src/app/(authed)/config/_components/ConfigClient.tsx`

- [ ] Put wide tables inside an internal horizontal scroller.
- [ ] Preserve rounded outer card border and header alignment.
- [ ] Keep action column reachable by horizontal scroll; do not force page-level overflow.
- [ ] Verify at desktop and narrow widths with long labels.

**Commit:** `fix(config): contain wide configuration grids`

### Task 16C — Make confirmation dialogs fully modal and accessible

**Files:** Config client and an existing shared dialog, or a new shared dialog only if none exists.

- [ ] Trap focus, set initial safe focus, close on Escape, restore opener focus and prevent background interaction.
- [ ] Use `aria-labelledby`/`aria-describedby` and `aria-modal=true`.
- [ ] Archive/restore copy includes exact affected label and consequence.
- [ ] Loading state prevents double submit; closing never fires the destructive action.

**Commit:** `fix(config): harden confirmation dialog accessibility`

---

## Stage 6 — Membership, categories and usage safety

### Task 17 — Enforce assistant membership invariants transactionally

**Files:**

- Modify `src/app/api/config/assistants/route.ts`
- Modify `src/app/(authed)/config/_components/ConfigClient.tsx`
- Modify `src/lib/tasks/membership.ts` and tests
- Modify `supabase/schema.sql`

**Chosen policy:** Reject cycles. Do not allow A→B when B already reaches A through assistant relationships.

**Implementation:**

- [ ] Reject self-membership.
- [ ] Reject duplicate active relation with 409.
- [ ] Confirm both accounts remain eligible/active at write time.
- [ ] Perform cycle detection and insert in one service-role RPC/transaction.
- [ ] Preserve one-hop/explicit scope behavior used by Task queries; no recursive privilege expansion.
- [ ] UI candidates use the same eligibility rules and remove impossible self/duplicate choices.

**Tests:** self, duplicate, inactive account, two-node cycle, longer cycle, valid membership and unchanged worker visibility.

**Commit:** `fix(config): enforce assistant membership invariants`

### Task 18 — Validate active category references without a route pre-read

**Files:**

- Modify `src/app/api/tasks/route.ts`
- Modify `src/app/api/tasks/[id]/route.ts`
- Add a shared category error mapper and tests under `src/lib/tasks/`
- Modify `supabase/schema.sql`

**Implementation:**

- [ ] Validate UUID syntax in memory for create/update.
- [ ] Do not SELECT category existence before the write.
- [ ] Add a narrow database invariant/trigger that checks non-null changed `category_id` points to an active category inside the same write transaction.
- [ ] Map missing/inactive FK-style failure to typed 409 `TASK_CATEGORY_INACTIVE`; do not leak raw error.
- [ ] Trigger executes only on insert with category or update where category changes.

**Performance:** No added network round-trip. Benchmark DB statement duration; a repeatable regression beyond baseline spread blocks release.

**Commit:** `fix(tasks): reject inactive category references atomically`

### Task 19 — Load indexed custom-option usage only when Archive is requested

**Files:**

- Modify `supabase/schema.sql`
- Add `src/app/api/config/columns/[id]/options/[optionId]/usage/route.ts`
- Modify `src/app/(authed)/config/_components/ConfigClient.tsx`
- Ensure `src/app/(authed)/config/page.tsx` does not load custom-option usage

**Schema/query:**

- [ ] Add partial GIN indexes for active `tasks.custom_values` and `enrollment_records.custom_values`, using the operator class proven by the actual containment query.
- [ ] Add a service-role-only function taking column id and option id.
- [ ] Resolve scope/key inside the function.
- [ ] Count CS only in tasks; ACA/Medicare only in enrollment records filtered by program.
- [ ] Use JSONB containment for exactly `{ column_key: option_id }`; do not expand every key with `jsonb_each_text`.

**UI/API:**

- [ ] On Archive click, fetch one count and show loading before opening confirmation.
- [ ] Failed count blocks archive and offers retry; never show zero on failure.
- [ ] Cache only while that confirmation is open; refetch on the next attempt.
- [ ] Confirmation reports the live count and consequence.

**Verification:**

- [ ] `EXPLAIN (ANALYZE, BUFFERS)` on realistic data uses the intended index.
- [ ] Opening `/config` makes no custom usage request.
- [ ] One Archive attempt makes exactly one usage request.

**Commit:** `fix(config): query indexed option usage on archive intent`

---

## Stage 7 — Final verification and handoff

### Task 20 — Full regression, deployment and documentation pass

**Automated:**

- [ ] `npx vitest run`
- [ ] `npm run typecheck`
- [ ] Repository lint command
- [ ] `git diff --check`
- [ ] Record actual totals; never reuse an older guessed count.

**Manual matrix:**

- [ ] CS/ACA/Medicare Create, inline edit and Detail for every custom data type.
- [ ] Required system/custom fields, including Person and checkbox false.
- [ ] Config stage-rule visibility by scope/set.
- [ ] Color create/edit/clear/recommended and identical consumer preview.
- [ ] Archived/missing/wrong-parent option/column/category writes.
- [ ] Duplicate-label conflict.
- [ ] Restore confirmation and partial layout-reset warning.
- [ ] Concurrent reorder and concurrent SLA editors.
- [ ] Rapid reminder edits.
- [ ] SLA event, reconnect and missed-event recovery.
- [ ] Optional Config loader failure and refresh race.
- [ ] Searchable dropdown keyboard/focus behavior.
- [ ] Assistant self/duplicate/cycle cases.
- [ ] Indexed usage count and archive confirmation.

**Latency:**

- [ ] Repeat Stage 0 measurements.
- [ ] Attach before/after call counts, median and p95 to Execution Log.
- [ ] Confirm initial `/config` and all inline writes meet §4.5.
- [ ] Do not approve a repeatable regression.

**Deployment order:**

1. Run duplicate and roster preflights in the target environment.
2. Apply additive functions/triggers/indexes to a scratch DB and then target DB.
3. Deploy application code only after required RPCs exist.
4. Verify mixed state: old code with new schema remains functional.
5. Canary Config mutation plus Task/Enrollment inline edit.
6. Observe API error rate, DB duration and Config load/refresh failures.
7. Roll back application code first if needed; leave backward-compatible functions/indexes until safely cleaned later.

**Final documentation:** Ensure every behavior commit already contains its `changelog.md` bullet. Add only a final aggregate verification note if it contains new evidence.

**Commit:** `docs(table-config): record final remediation verification` only if the Execution Log/final evidence changed after the last behavior commit.

---

## 6. Regression matrix

| Area | Before risk | Required after state |
|---|---|---|
| Custom writes | UI-only/inconsistent validation | One trusted context; same rules across CS/ACA/Medicare |
| Required fields | Enrollment Create could not satisfy custom Required | UI and server both enforce satisfiable fields |
| Person values | UI/API roster mismatch; expensive validation proposal | Same predicate, submitted-email matching, one network request |
| Inactive config | Ambiguous/no-op mutation outcomes | Stable conflict; no archived mutation |
| Stage flags | Meaningless controls outside Stage | Stage-only; dashboard final flag ACA-only |
| Duplicates | Potential lost label after auto-archive | Preflight + unique active identity; no automatic data mutation |
| Restore | Hidden automatic restore | Explicit confirmation and truthful copy |
| Reorder | N writes/stale overwrite | One atomic version-aware RPC |
| SLA | Read-then-write/last-write-wins | Token-checked atomic mutation |
| Reminder | Whole-object stale overwrite/rounding | Partial integer-safe ordered update |
| Realtime | Open board may retain old SLA | Event + reconnect/focus recovery |
| Partial success | Success toast after layout reset failure | Structured info notice |
| Config load | One optional failure can blank page | Per-section availability; no extra probe |
| Refresh | Failed/late response can lie | Status-aware latest-request-wins |
| Colors | Config and consumers drift | Canonical storage + shared pastel preview |
| Long dropdown | Scroll-only/private selector | Shared searchable accessible listbox |
| Membership | Self/duplicate/cycle ambiguity | Transactional invariant enforcement |
| Category | Invalid/inactive reference may fail generically | Atomic active check + typed 409 |
| Usage count | Eager scan or false zero | Indexed on-demand count |

---

## 7. Known boundaries and follow-ups

- This plan does not automatically rewrite existing duplicate option data. That requires an admin-approved survivor/remap decision.
- This plan does not add virtualization. Measure after searchable controls ship.
- This plan does not add restore for every archived value family; it fixes the broken archived-column collision flow and keeps other archive writes truthful.
- This plan does not change business-specific ACA/Medicare option sets beyond enforcing where shared Stage flags are legal.
- Route-level validation and a later config archive are separate transactions. Archive confirmation reduces unsafe removal, and consumers must preserve a readable fallback for historical archived selections. A future fully transactional write/config-lock protocol should be considered only if real race evidence appears; do not add that architecture preemptively.

---

## 8. Execution Log

Update this immediately after each task. Do not pre-fill commit ids or claim tests that were not run.

| Date/time | Stage/Task | Result | Tests/measurement | Commit | Remaining risk |
|---|---|---|---|---|---|
| 2026-08-15 | Stage 0 / Task 0 | Baseline captured; implementation may proceed | Vitest 87 files / 609 tests pass; typecheck pass; lint baseline fails in dirty `AcaOverviewDashboard.tsx` with 2 `set-state-in-effect` errors plus 5 warnings | — | Duplicate and roster preflight still required before constraint/Person rollout |
| 2026-08-15 | Stage 1 / Task 1 | Added one-request write-validation context, pure custom-value validator, context-based Required helper and service-role-only SQL RPC | Targeted Vitest: 3 files / 10 tests pass; typecheck pass; SQL is committed but not applied to a scratch/target DB yet | `ae2ca0d` | Route integration (Tasks/Enrollment), scratch-DB RPC contract and production schema application remain |

| 2026-08-15 | Stage 1 / Task 2 | Task create/PATCH now validate custom values and Required fields from the one write context; existing transition cleaner and custom-values-only behavior preserved | Targeted Vitest: 4 files / 44 tests pass; typecheck pass; route latency benchmark and scratch-DB RPC execution still required | `c1b84d1` | Enrollment routes remain; schema RPC must be applied before deployment |
| 2026-08-15 | Stage 1 / Task 3 | Enrollment Create/PATCH now reject malformed/stale custom values, preserve unrelated PATCH values, validate Required fields from the same context, and render controlled custom fields in Create for ACA/Medicare | Targeted Vitest: 5 files / 18 tests pass; typecheck pass; targeted ESLint pass; route latency benchmark and scratch-DB RPC execution still required | `4719b37` | Stage 1 exit still requires the Enrollment route benchmark, scratch-DB RPC contract check, and final commit |
| 2026-08-15 | Stage 2 / Task 4 | Active predicates now guard Config columns/options, enrollment options and task categories; inactive/missing/wrong-parent mutations return stable 409 conflicts without raw DB messages | Targeted Vitest: 3 files / 10 tests pass; typecheck pass; targeted ESLint pass | `89e34b6` | Stage 2 still needs stage-only rule enforcement, duplicate preflight/index, restore safety and reorder RPC |
| 2026-08-15 | Stage 2 / Task 5 | Enrollment option-rule writes reject terminal/QC outside Stage and ACA dashboard-terminal outside ACA Stage; Config renders only eligible rule controls and GET reports legacy invalid-rule ids | Targeted Vitest: 2 files / 10 tests pass; typecheck pass; targeted ESLint pass | `3730703` | Stage 2 still needs duplicate preflight/index, restore safety and reorder RPC |
| 2026-08-15 | Stage 2 / Task 6 | Added a normalized partial unique index for active custom option labels, mapped unique conflicts to a stable 409 response, and added a `CONCURRENTLY` rollout script. No option rows were auto-archived or rewritten. | Targeted Vitest: 2 files / 11 tests pass; typecheck pass; targeted ESLint pass; preflight found 0 duplicate normalized-label groups. Rollout/index has not been applied to a target DB here. | `7850ef6` | Restore confirmation and atomic reorder remain; production must run the duplicate preflight before the concurrent index rollout |
| 2026-08-15 | Stage 2 / Task 7 | Archived label/key collisions now return safe typed 409 metadata; restoring is an explicit second request that preserves the old column/options/settings, resets saved layouts, and reports partial reset warnings. Shared confirm dialog now traps focus, closes on Escape/backdrop, locks scroll and restores opener focus. | Targeted Vitest: 1 file / 4 tests pass; typecheck pass; targeted ESLint pass; no target DB restore/layout-failure simulation available | `845f6d2` | Atomic reorder and production validation remain; restore behavior still needs a target DB/browser acceptance pass |
| 2026-08-15 | Stage 2 / Task 8 | Reorder now uses one version-aware RPC: active rows are locked deterministically, expected membership/order is checked after locking, stale writers receive 409, positions update atomically, and optimistic UI always reconciles after success or failure. | Targeted Vitest: 2 files / 7 tests pass; typecheck pass; targeted ESLint pass; SQL/RPC and two-writer concurrency were not executable without a target/scratch DB | `46cff66` | Stage 2 exit requires applying/contract-testing both rollouts and manually testing stale reorder/layout warning |
| 2026-08-15 | Stage 3 / Task 9 | SLA GET now exposes `updated_at`; save/delete use one lock-compare-write/delete RPC with required expected tokens, UUID validation and stable stale/unique conflict responses. Config reloads rules after a stale conflict instead of allowing last-write-wins. | Targeted Vitest: 2 files / 14 tests pass; typecheck pass; targeted ESLint pass; RPC/concurrent editor test not executable without a target/scratch DB | `b27a304` | Reminder partial writes and SLA board invalidation remain; apply SLA rollout before deploying route |
| 2026-08-15 | Stage 3 / Task 10 | Reminder settings now use one-key PATCH + atomic RPC, strict integer/range validation, per-key request queues and canonical merges that preserve other pending edits. Failed initial loads leave controls read-only with Retry. | Targeted Vitest: 2 files / 15 tests pass; typecheck pass; targeted ESLint pass; concurrent-key and failed-GET browser checks not executable here | `a2b6971` | SLA board invalidation remains; apply reminder RPC before deploying route |
| 2026-08-15 | Stage 3 / Task 11 | Added a separate empty-payload SLA invalidation topic. Confirmed rule/reminder mutations notify open boards without awaiting broadcast; Task Board refetches SLA rules on events, reconnect, focus and visibility, with an in-flight/latest guard and a separate recovery banner that leaves task rows untouched. | Full Vitest: 91 files / 626 tests pass; typecheck pass; targeted ESLint pass; two-tab, reconnect and browser focus acceptance not executable here | `8918b93` | Apply SLA/reminder RPC rollouts and run two-tab/reconnect acceptance against target Supabase; broadcast remains best-effort |
| 2026-08-15 | Stage 4 / Task 12 | Column PATCH, restore and reorder now return a typed safe `LAYOUT_RESET_FAILED` warning when the primary commit succeeds but saved-layout reset fails. Config renders partial success as an info notice and still supports older safe string warnings; detailed reset errors remain server logs only. | Targeted Vitest: 1 file / 2 tests pass; typecheck pass; targeted ESLint pass; failure injection/browser notice acceptance not executable here | `adc00f4` | Need section-isolated refresh/error handling and latest-request-wins refresh guards; layout reset warning still needs target DB failure simulation |
| 2026-08-15 | Stage 4 / Task 13 | Config now treats Table Columns as load-bearing and loads optional sections through settled typed results. Categories, options, assistants, SLA and enrollment option sets expose independent availability/error state, preserve safe fallback data and disable writes when unavailable. Schema readiness is inferred from already-loaded `system-*` column ids; no schema-probe query was added. Added a load-bearing Config error boundary with safe Retry. | Full Vitest: 92 files / 628 tests pass; typecheck pass; targeted ESLint pass; `git diff --check` pass; failure-injection/permission/browser recovery acceptance not executable here | `bda96cd` | Refresh functions still need defensive response parsing, per-family latest-request-wins and stale/read-only state on failed refresh (Task 14); target DB/schema and browser acceptance remain required |
| 2026-08-15 | Stage 4 / Task 14 | Scope columns/options, categories, ACA/Medicare option sets, agents and assistant memberships now parse responses defensively, validate minimum payload shape, suppress stale responses/errors with per-family request sequences, retain last-good state and disable the affected mutation surface after the newest refresh fails. Added pure refresh helpers/tests; no automatic retry or extra request was introduced. | Full Vitest: 93 files / 632 tests pass; typecheck pass; targeted ESLint pass; `git diff --check` pass; forced 500/invalid-JSON/slow-response browser scenarios not executable here | `2d05c27` | Stage 4 still needs colors/interaction consistency; target DB and browser recovery/concurrency acceptance remain |
| 2026-08-15 | Stage 5 / Task 15 — commit 1 | Category, custom-column option and Enrollment option create/update routes now share canonical color parsing: trim/lowercase six-digit hex values, allow explicit clear, and reject malformed non-empty input with a stable 400 instead of silently clearing it. Added pure parser/normalization tests; no Stage semantics changed. | Targeted Vitest: 1 file / 11 tests pass; typecheck pass; targeted ESLint pass; `git diff --check` pass; API integration against target DB not executable here | `7943d3b` | Consumer palette alignment is the remaining Task 15 boundary; legacy malformed rows still need neutral/fallback rendering validation |
| 2026-08-15 | Stage 5 / Task 15 — commit 2 | Config previews and shared CS/Enrollment custom dropdown cells now use one deterministic pastel/readable badge palette, including picker choices and legacy missing/invalid-color fallback. Enrollment identity options use the same pastel identity treatment in list/detail/form selectors; Stage continues using its existing tinted workflow-state styling. | Targeted Vitest: 3 files / 29 tests pass; typecheck pass; targeted ESLint pass; `git diff --check` pass; browser visual parity and target DB invalid-row acceptance not executable here | `3f836cb` | Stage 5 searchable Config controls and wide-grid/dialog work remain; full browser visual check still required |
| 2026-08-15 | Stage 5 / Task 16A | Replaced Config's private scroll-only dropdown with the shared portalled searchable listbox. Existing sizing/selection/disabled behavior remains, search uses the repository option-search normalization, disabled choices are skipped/rejected by the shared keyboard logic, and Escape/Tab focus behavior is centralized in the anchored-menu hook. | Targeted option-search Vitest: 2 files / 21 tests pass; typecheck pass; targeted ESLint pass (0 errors); `git diff --check` pass; browser focus/keyboard acceptance not executable here | `8217b30` | Wide Config grids and confirmation dialog hardening remain; browser accessibility pass still required |
| 2026-08-15 | Stage 5 / Task 16B | Config Table Columns and Dropdown Values now keep their wide grids inside card-local horizontal scrollers with explicit minimum widths, so long labels and the action column remain reachable without page-level overflow or clipping by the outer card. | Typecheck pass; targeted ESLint pass; `git diff --check` pass; narrow viewport/browser visual acceptance not executable here | `cecf234` | Confirmation dialog hardening remains; browser responsive acceptance still required |
| 2026-08-15 | Stage 5 / Task 16C | Config archive/restore confirmations now use stable labelled modal semantics, focus trap/initial focus, Escape and opener restoration, scroll lock, guarded backdrop close, and a submitting/disabled state that prevents duplicate destructive actions. Copy retains the exact affected item and consequence. | Typecheck pass; targeted ESLint pass; `git diff --check` pass; browser screen-reader/focus acceptance not executable here | `6b737a5` | Stage 6 membership/category/usage safety remains; browser accessibility acceptance still required |
| 2026-08-15 | Stage 6 / Task 17 | Assistant membership creation now uses a service-role transaction/RPC with one mutation lock, active/eligible account checks, self/duplicate/two-node/longer-cycle rejection and safe typed API errors. Legacy non-assistant rows are promoted in place; UI excludes self and existing assistant choices while preserving one-hop authorization scope. | Targeted Vitest: 2 files / 3 tests pass; typecheck pass; targeted ESLint pass; `git diff --check` pass; RPC/transaction/cycle tests not executable without scratch/target DB | `6a78bb0` | Rollout must be applied before API deployment; category atomic guard and indexed usage remain |
| 2026-08-15 | Stage 6 / Task 18 | Task create/update now reject malformed category identifiers in memory and map inactive/missing category constraint failures to safe typed 409 `TASK_CATEGORY_INACTIVE`. A narrow DB trigger enforces that newly written non-null category references are active in the same transaction; historical references remain readable and no route pre-read/round-trip was added. | Targeted Vitest: 1 file / 2 tests pass; typecheck pass; targeted ESLint pass; `git diff --check` pass; trigger/RPC and concurrent archive/write acceptance not executable without scratch/target DB | `8ee9b40` + changelog `fc99e0d` | Apply the category-guard rollout before deploying routes; indexed option usage remains |
| 2026-08-15 | Stage 6 / Task 19 | Removed the eager enrollment usage scan from `/config`. Custom dropdown archive intent now calls one service-role usage endpoint backed by active-row partial GIN containment indexes; Enrollment option archive intent uses one scoped on-demand count endpoint. A failed count prevents confirmation/archive and never becomes a false zero. | Targeted Vitest: 4 files / 21 tests pass; typecheck pass; targeted ESLint pass; `git diff --check` pass; EXPLAIN/index usage and browser request-count acceptance not executable without scratch/target DB | `a2d5404` | Apply the index/RPC rollout before deploying; run EXPLAIN and verify exactly one usage request per archive intent in target environment |
| 2026-08-15 | Stage 7 / Task 20 | Completed repository regression verification and recorded deployment/acceptance boundaries. No additional behavior change was needed after Tasks 1–19. | Full Vitest: 95 files / 642 tests pass; `npm run typecheck` pass; `git diff --check` pass; full `npm run lint` remains blocked by 2 pre-existing `react-hooks/set-state-in-effect` errors plus 5 warnings in dirty `src/app/(authed)/enrollment/_components/AcaOverviewDashboard.tsx` (not changed by this remediation) | — | Target/scratch DB rollouts, duplicate/roster preflights, EXPLAIN plans, browser concurrency/accessibility and latency comparison remain required before production approval |

### Final status template

```text
Status: READY WITH RISKS
Schema applied: Not verified here; apply all Stage 1–6 additive RPC/trigger/index rollouts in order.
Duplicate preflight: 0 duplicate normalized-label groups observed during Task 6; rerun in target before index rollout.
Roster parity: Not verified against target DB; Task 1/3/17 contracts still require scratch/target checks.
Tests: 95 files / 642 tests passed.
Typecheck: Passed.
Lint: Blocked by 2 baseline errors and 5 warnings in the pre-existing dirty `AcaOverviewDashboard.tsx`.
Latency comparison: Not measured; no eager usage query remains, but Stage 0 vs Stage 7 request/DB timing must be captured in target.
Outstanding P0/P1: None identified by repository/static/pure-test review.
Outstanding P2: Target schema/rollout application, DB trigger/RPC/index validation, browser acceptance, latency comparison, and baseline lint cleanup.
Go-live recommendation: Do not declare production-ready until the target rollout, EXPLAIN, concurrency/accessibility, and latency gates pass; code is READY WITH RISKS for that validation stage.
```
