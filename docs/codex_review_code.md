# Go-Live Review — Final Reconciled Audit

## Overall Status

Status: **NOT READY**  
Current Module: **Complete**  
Last Updated: **2026-08-08 20:30 Asia/Ho_Chi_Minh**  
Reviewed source through: **`036984e`** (execution log commits follow)

Audit mode: implementation and verification. This document reconciles the independent Codex audit with `docs/claude_golive-review.md`, records each fix commit, and keeps unverified browser/DB gates explicitly open.

### Final reconciliation decisions

- Claude's Tasks layout-hydration finding is accepted as **T-01 / P0**. The dependency cycle is deterministic for users with a saved CS layout. A real component/browser request-count regression test is still required; the helper-level reproduction proves dependency instability, not the full effect by itself.
- The deterministic root cause of the second task status edit is included in **T-02**: the client writes its own `updated_at`, then reuses that non-canonical value as `expected_updated_at`.
- Claude's DateRangeFilter finding is **closed as a false positive**. `toggleRangePicker()` already rehydrates draft state whenever the picker opens.
- Claude's Medicare/ACA “new Medicare records alone need attention” inference is **closed**. Both programs start without Responsible/Due; ACA's default Caller does not satisfy that rule.
- Severity was recalibrated. Blind import review, Config partial admin operations, custom Enrollment Required semantics, invalid program parsing, native prompt use, and special-action OCC gaps remain real but are not all P1.
- Confirmed additions from Claude are integrated: no-op Enrollment stats, Due-date request behavior, shared Enrollment realtime topic, schema fallbacks, import timeout exposure, missing Config Toast tone, Consent Required mismatch, Tasks realtime subscription churn, scheduler risk, loading skeleton mismatch, and Config dark-mode input contrast.
- Cross-module findings are not counted again when they are only a synthesis of an existing module finding.

### Claude final delta review

Claude's second/final combined pass was read after this document's first reconciliation. It adds no new distinct issue family; its newly verified items map as follows:

| Claude final ID | Final Codex ID | Resolution |
| --- | --- | --- |
| M-34 — read-only controls remain interactive | M-01 | Already P1 and fully specified. |
| M-32 — `pendingRef` is a Set | M-02 | Already P1; final fix must also prevent overlapping whole-row rollback, not merely replace Set with a counter. |
| M-33 — archive has no catch/full-array rollback | M-04 | Already P2. |
| C-15 — custom-value read error becomes `{}` | C-03 | Already P1; fail-closed is the first containment step. |
| C-14 — column PATCH counter is not ordering | C-10 | Already P2. |
| A-03 — new ACA record disappears | A-01 | Already P1. |
| M-24 — silent schema fallback | M-12 | Already a mandatory conditional release gate. |
| T-12 — scheduler ownership | T-14 | Already a pre-Go-Live operational prerequisite. |

The Claude final document is useful evidence but is not internally safe as the sole release gate: its top uses approximate P2/P3 totals, its older Final section still says “1 P0 / 2 P1” and still lists withdrawn T-06/A-02, and its seven-item plan omits T-03/M-03 core partial-commit families. Its “2–3 days” estimate also excludes those high-risk server consistency changes and full regression, so it is not used as a committed delivery estimate here.

Final policy resolution:

- **Owner decision — 2026-08-08:** Remove Import from the product scope completely; keep Export. The removal covers Import UI, review workflow, API routes, application helpers/types/tests, and all submission/approval/retry/resume paths. Existing Import database records are retained read-only for audit/reconciliation during the Go-Live patch; dropping tables/data requires a separate retention-approved migration.
- M-12 schema parity is a **mandatory preflight**, but remains conditional P2 until the production result is known; a missing required object escalates deployment risk to P0.
- C-01/C-02/C-03/C-06 remain open until feature removal is implemented and verified, then close as **removed with the feature**, not as bug fixes. Hiding the tab alone is insufficient. With no other changes, verified removal reduces the open totals from **11→8 P1** and **29→28 P2**; it does not affect the P0 or core Tasks/Enrollment gates.
- C-04/C-05 can leave the reachable release gate only under an enforceable global Config mutation freeze with forced client reload after any exception. “Outside office hours + tell users to press F5” is insufficient by itself.
- T-03/M-03 are core mutation paths and cannot be operationally gated without disabling core Tasks/Enrollment behavior; they remain required before READY.
- M-02 requires per-record serialization/rebase and canonical conflict recovery. Changing Set to a counter fixes only the early-refetch guard, not the stale whole-row rollback.

### Severity totals

Unique issue families, with shared Medicare/ACA code counted once:

| Severity | Count | Release meaning |
| --- | ---: | --- |
| **P0** | **1** | Immediate blocker: production-breaking request/render loop. |
| **P1** | **11** | Core correctness/data/workflow risks; all must be fixed or made unreachable before READY. |
| **P2** | **29** | High risks requiring fix, explicit containment, or documented Go-Live acceptance. |
| **P3** | **17** | Medium UX, hardening, operations, and regression risks. |
| **P4** | **4** | Cosmetic/consistency/technical-debt groups. |

---

# 1. Tasks

## Status

**REVIEWED — NOT GO-LIVE READY.** Tasks contains the only confirmed P0 and two P1 correctness families. Permission primitives, generic PATCH optimistic locking, search cancellation, and realtime cleanup foundations are present, but saved-layout hydration, optimistic version ownership, and multi-write mutation boundaries are unsafe.

## Functional Bugs

### T-01 — Saved Tasks layout creates an infinite hydration request/render loop

Issue: The layout hydration effect writes state that recreates two Set dependencies, causing the same effect to run again indefinitely.  
Severity: **P0 — BLOCKER**  
Location: `TaskBoardClient.tsx:189-206,208-275`; `task-list-columns.ts:113-163`; `api/config/layout/route.ts:33-39`  
Affected Module: Tasks / Config layout  
Trigger: Load `/tasks` as a user with a saved `user_table_layout` for scope `cs`.  
Expected: Exactly one layout GET and one hydration pass.  
Actual: The saved layout produces a new `taskLayoutColumns` array; derived Sets change identity; the effect dependency array changes; another GET starts. The cycle continues while the component remains mounted.  
Root Cause: Exhaustive but unstable effect dependencies are derived from state written by the effect itself.  
Impact: Unbounded `/api/config/layout` traffic and repeated whole-board rendering can saturate client CPU and server/database capacity. Exact requests per second were not measured and are intentionally not claimed here.  
Fix: Use a one-time hydration guard or stable dependencies/ref snapshots, following the existing Enrollment hydration pattern.  
Regression Risk: Low–medium; saved layout, no-layout/localStorage fallback, hidden defaults, archived columns, and post-reload persistence must remain correct.  
Verification: Static cycle trace is deterministic; Claude's helper-level runtime reproduction showed dependencies never stabilize. A component/browser test must assert one GET after hydration.  
Status: **IMPLEMENTED — browser verification pending; release gate remains open**

### T-02 — Status edits create a non-canonical version and later edits can revert confirmed state

Issue: Optimistic status changes stamp client time into `updated_at`; the next PATCH sends that value as `expected_updated_at`. Overlapping failures also restore a whole stale row and mark it as a recent authoritative write.  
Severity: **P1 — CRITICAL**  
Location: `TaskBoardClient.tsx:894-928,975-1015,1665-1691,1693-1747`; `api/tasks/[id]/route.ts:184-200,359-372`  
Affected Module: Tasks  
Trigger: Change one task status, then edit the same task again before canonical refetch/reconciliation; overlapping field edits reach the same rollback path.  
Expected: The canonical server version owns `updated_at`; a stale mutation reconciles to the confirmed server row without reverting unrelated fields.  
Actual: The second request can deterministically 409 against a client-generated token. Its catch restores the whole earlier snapshot; the three-second recent-write guard can suppress the immediate canonical repair with no expiry-triggered retry.  
Root Cause: Optimistic transition logic owns the concurrency token, mutations overlap without a per-task queue, and rollback ownership is whole-row.  
Impact: Ordinary rapid edits can show A → B → A, lose the visible confirmed value, and cause subsequent false “updated by someone else” errors.  
Fix: Never synthesize `updated_at`; serialize/rebase per task; on 409 fetch/accept the canonical row; do not protect failed rollback snapshots as recent writes.  
Regression Risk: High; Kanban drag, inline/drawer edits, QC, reopen, unlock, and realtime anti-flicker behavior share this state machinery.  
Verification: Static one-user status timeline and two-request interleaving confirm both deterministic and race paths. No component regression test exists.  
Status: **IMPLEMENTED — slow-network/two-user verification pending**

### T-03 — Multi-write task mutations can partially commit and then return failure

Issue: Task/assignment state is written before required junction, history, activity, rotation, notification, or last-activity operations complete.  
Severity: **P1 — CRITICAL**  
Location: `api/tasks/[id]/route.ts:359-529`; assignee add/remove, reopen, and overdue-unlock routes  
Affected Module: Tasks  
Trigger: A later database/history/notification write fails after the canonical task or assignee write succeeds.  
Expected: Required state commits atomically, or the response accurately reports committed state and queues repairable side effects.  
Actual: The route can return 500 after the main change commits; the client rolls back and some failure paths never broadcast reconciliation.  
Root Cause: One business transition spans independent Supabase statements without a transaction/RPC boundary or a durable idempotent side-effect policy.  
Impact: UI/server disagreement, assignment drift, missing history/notifications, and confusing retries.  
Fix: Move canonical state plus required audit/junction writes into atomic commands; make non-critical side effects idempotent and non-authoritative for the HTTP result.  
Regression Risk: High; transitions, SLA history, assignment cycles, notifications, and imports depend on these rules.  
Verification: Local PostgreSQL schema replay and RPC commit/rollback smoke checks pass; authenticated staging failure-injection and deployed-schema verification remain.  
Status: **PARTIAL — generic PATCH atomic; special-action/deployment verification pending**

### T-04 — Special actions and archive lack optimistic concurrency

Issue: Reopen, overdue-unlock, assignee add/remove, and archive do read-then-write without `expected_updated_at`.  
Severity: **P2 — HIGH**  
Location: task reopen, overdue-unlock, assignee add/remove, and DELETE routes  
Affected Module: Tasks  
Trigger: A user acts from stale detail/list state while another update commits.  
Expected: Stale intent is rejected and the newest row remains authoritative.  
Actual: Updates predicate by id only; assignment paths also update multiple ownership representations independently.  
Root Cause: OCC exists only in generic PATCH and one overview path.  
Impact: Lost status/assignment intent or stale archive. The interactive reason modal narrows some race windows, so this is P2 rather than P1.  
Fix: Add version tokens to every mutation and enforce them inside the same atomic transition boundary.  
Regression Risk: Medium-high; all clients must handle 409 consistently.  
Verification: Typecheck, targeted ESLint, Tasks tests, PostgreSQL schema replay, and stale-token RPC smoke checks pass; authenticated two-tab action/archive verification remains.  
Status: **IMPLEMENTED — browser concurrency verification pending**

### T-05 — Search scope, candidate limiting, and rendered result types disagree

Issue: Plain CS sees a shared board but receives narrower search visibility; candidates are limited before authorization; attachment file hits returned by the API are ignored by the UI.  
Severity: **P2 — HIGH**  
Location: `src/lib/tasks/queries.ts:35-63`; `src/lib/tasks/search.ts:161-356`; `TaskSearchBox.tsx:102-195`  
Affected Module: Tasks  
Trigger: Search for a teammate-visible task, a common term with more than 40 earlier out-of-scope hits, or an attachment filename only.  
Expected: Search matches the visible board universe and renders every advertised result type.  
Actual: Valid results can be absent and file-only matches show no result.  
Root Cause: Board/search permissions evolved separately, limiting happens before permission resolution, and `results.files` is omitted from UI flattening/rendering.  
Impact: Users cannot reliably find tasks they can already browse.  
Fix: Centralize visibility, filter before limit at the data layer, and render or deliberately remove file hits from the API contract.  
Regression Risk: Medium; permission-sensitive search behavior changes.  
Verification: Typecheck, targeted ESLint, Tasks tests, and search helper tests pass; staged common-query, permission, and file-hit UI verification remains.  
Status: **IMPLEMENTED — search integration verification pending**

### T-06 — Comment and attachment list metadata can remain stale

Issue: The recent-write merge keeps the whole local row for three seconds, including counters/activity fields not updated by the local mutation; attachment room broadcasts do not guarantee a board refetch later.  
Severity: **P2 — HIGH**  
Location: `TaskBoardClient.tsx:1498-1503,1665-1691`; task comment/attachment routes; task list metadata query  
Affected Module: Tasks  
Trigger: Add a comment or file while the Tasks list is open.  
Expected: Comment/file counts and last activity reconcile after confirmation.  
Actual: The immediate fresh row can be rejected in favor of stale local metadata, and no timer repairs it after cooldown.  
Root Cause: Cooldown is whole-entity/time-based instead of field/version-aware; mutation responses/invalidation do not own list metadata coherently.  
Impact: Incorrect counts/activity can persist until an unrelated refresh.  
Fix: Return canonical task-list metadata with detail reloads and propagate it to the board row; keep the existing anti-flicker guard for task-owned fields.  
Regression Risk: Medium; anti-flicker behavior must remain intact.  
Verification: `fetchTaskListMetadata` RPC contract test, Tasks helper suite (21 files / 240 tests), typecheck, and targeted ESLint pass. Authenticated comment/file mutation and slow-refetch browser verification remains.  
Status: **IMPLEMENTED — browser/refetch verification pending**

### T-07 — Failed archive restores the entire task collection

Issue: Archive failure restores a closure snapshot of all tasks rather than only the target.  
Severity: **P2 — HIGH**  
Location: `TaskBoardClient.tsx:1201-1221`  
Affected Module: Tasks  
Trigger: Archive fails while another task changes locally or by realtime.  
Expected: Restore only the removed task and reconcile the target.  
Actual: Unrelated newer rows are replaced with the older array; rollback rows can then be protected by the recent-write map.  
Root Cause: Collection-wide optimistic snapshot rollback.  
Impact: Multi-card visible reversion and stale unrelated state.  
Fix: Restore only the target entity at a deterministic position and refetch on conflict/failure.  
Regression Risk: Low–medium.  
Verification: Direct error-branch trace; no archive concurrency test exists.  
Status: **IMPLEMENTED — two-tab verification pending**

## Performance / Lag

### T-08 — Tasks fetch and render work is unbounded

Issue: Every load/realtime refresh fetches all unarchived tasks, attaches metadata, filters/sorts client-side, and renders every row/card; list derivations and row components lack effective memo boundaries.  
Severity: **P2 — HIGH; volume-dependent Go-Live blocker**  
Location: `src/lib/tasks/queries.ts:17-171`; `TaskListView.tsx:91-207`; `KanbanBoard.tsx:371-571`; `TaskRowItem.tsx`  
Affected Module: Tasks  
Trigger: Growing active/history volume, frequent realtime events, or the 30-second SLA tick.  
Expected: Request payload, derived work, and DOM remain bounded.  
Actual: Query, payload, sorting, metadata, and DOM grow linearly; default date filters discard data only after transfer.  
Root Cause: No server window/pagination and no measured render boundary/windowing strategy.  
Impact: Increasing TTFB, memory, main-thread work, and eventual silent PostgREST truncation risk.  
Fix: Add exact-count truncation detection immediately so the board/export fail closed instead of showing an incomplete dataset. Server-window/pagination and measured render optimization remain follow-up work; do not introduce virtualization blindly before release.  
Regression Risk: Medium-high; permissions, filters, exports, counters, and realtime currently assume the full collection.  
Verification: `assertTaskListComplete` regression tests, Tasks helper suite (21 files / 242 tests), typecheck, and targeted ESLint pass. Production volume benchmark, API/SSR overflow behavior, and server-window/render verification remain.  
Status: **PARTIAL — truncation containment implemented; volume/windowing remains open**

### T-09 — Realtime subscription churn causes extra full refetches

Issue: The Tasks realtime effect depends on `view` and a date-dependent `loadOverview`, so view/date changes unsubscribe/resubscribe and `SUBSCRIBED` triggers another full task fetch.  
Severity: **P2 — HIGH**  
Location: `TaskBoardClient.tsx:423-453,508-533`  
Affected Module: Tasks  
Trigger: Switch List/Board/Overview or change/clear date range.  
Expected: One stable channel subscription for the page lifetime.  
Actual: Channel churn and extra unbounded GETs; a small unsubscribe gap can miss a broadcast until later reconciliation.  
Root Cause: Values read inside handlers are effect dependencies even though channel identity does not depend on them.  
Impact: Avoidable network/database load and connection churn.  
Fix: Keep the Tasks channel mounted for the board lifetime; read the current view, overview loader, and refetch function through refs so date/view changes do not recreate the subscription.  
Regression Risk: Low–medium; two-tab realtime and Overview refresh must be tested.  
Verification: Static dependency trace confirms the channel effect no longer depends on `view` or date-bound `loadOverview`; typecheck, targeted ESLint, and Tasks tests (21 files / 242 tests) pass. Browser WS join/refetch count and Overview realtime behavior remain.  
Status: **IMPLEMENTED — browser realtime verification pending**

## Race Conditions / Async Issues

- T-02, T-04, T-06, T-07, T-09, and shared layout finding X-01 cover confirmed races.
- Search debounce/AbortController and comment-room cleanup are correctly implemented and should not be rewritten.

## State Management Issues

- `tasks.assignee_email`, `task_assignees`, client rows, detail state, realtime snapshots, and mutation snapshots all own overlapping state.
- `recentTaskWritesRef` prevents short flicker but is not version-aware and has no post-expiry repair.

### T-10 — Task drawer text can remain stale after an external update

Issue: Title/description/FUB local state initializes from the task prop but does not safely resync untouched fields when that prop changes.  
Severity: **P3 — MEDIUM**  
Location: `TaskDetailDrawer.tsx:113-115`  
Affected Module: Tasks  
Trigger: Keep a drawer open while another session updates the same task.  
Expected: Untouched fields refresh, while any field actively being edited preserves user input and reports conflict explicitly.  
Actual: Drawer can keep old text; a later blur submits it and receives 409.  
Root Cause: Local draft state has no dirty-aware prop reconciliation.  
Impact: Confusing stale display; server OCC prevents silent data overwrite.  
Fix: Reconcile only pristine/unfocused fields and surface external-change state.  
Regression Risk: Medium; an unconditional sync would overwrite typing.  
Verification: Static prop/state trace; no two-session component test.  
Status: **OPEN — defer until P0/P1 fixes are stable**

## UI/UX Issues

### T-11 — Delete confirmation describes permanent destruction but performs archive

Issue: Confirmation says task/comments/files are permanently deleted while the API sets only `archived_at`.  
Severity: **P3 — MEDIUM**  
Location: `TaskDetailDrawer.tsx:619-651`; task DELETE route  
Affected Module: Tasks  
Trigger: Choose Delete task.  
Expected: Copy accurately states archive/recovery behavior.  
Actual: UI claims irreversible hard deletion.  
Root Cause: Copy and soft-delete implementation diverged.  
Impact: Incorrect operational/audit expectations.  
Fix: Rename to Archive and explain visibility/recovery, or implement a separately authorized hard-delete flow.  
Regression Risk: Low.  
Verification: Direct UI/API comparison.  
Status: **OPEN**

### T-15 — Tasks failure surfaces and language are inconsistent

Issue: Export uses `window.alert`, normal failures use Toast, and Vietnamese/English messages are mixed.  
Severity: **P4 — LOW**  
Location: Tasks export handlers and mutation error strings  
Affected Module: Tasks / cross-module UX  
Trigger: Export or encounter different mutation failures.  
Expected: One accessible error surface and consistent product language.  
Actual: Native alert and Toast behave/look differently; language changes inside one screen.  
Root Cause: Feature-level error handling evolved independently.  
Impact: Cosmetic/interaction inconsistency; no confirmed data loss.  
Fix: Route failures through shared typed Toast and product-approved copy.  
Regression Risk: Low.  
Verification: Static call-site comparison.  
Status: **OPEN — non-blocking**

## UI Consistency

- Tasks and Enrollment share the main shell/table/drawer visual language.
- Board-opened task details remove the deep-link parameter while search-opened details push it; cross-module deep-link consistency is tracked in X-05.

## Duplicate / Overlapping Logic

- Task transition fields are duplicated client/server without a contract test; T-02 demonstrates drift.
- Capabilities and assignment behavior exist in multiple client/routes with different OCC/atomicity guarantees.

## Security / Permission

- No direct Tasks authorization bypass was confirmed.

### T-12 — Permission filter strings interpolate unescaped identity values

Issue: PostgREST `.or()` clauses are assembled by string interpolation from session/DB emails.  
Severity: **P3 — MEDIUM hardening**  
Location: `src/lib/tasks/queries.ts:53-57` and related visibility filters  
Affected Module: Tasks  
Trigger: Identity value contains filter syntax punctuation such as quote/comma.  
Expected: Identity values remain data and cannot alter filter grammar.  
Actual: A malformed value can break or potentially broaden the filter expression.  
Root Cause: Structured values are embedded into a textual PostgREST expression.  
Impact: Current normal email sources limit exploitability, but permission-query correctness depends on undocumented character assumptions.  
Fix: Validate/escape identities or use structured query predicates.  
Regression Risk: Low–medium; verify agent/assistant/plain-CS visibility.  
Verification: Static construction trace; no malicious identity test.  
Status: **OPEN — hardening**

### T-13 — Cron secrets are accepted through query strings

Issue: Cron authorization accepts `?secret=` even though Bearer headers are already supported.  
Severity: **P3 — MEDIUM hardening**  
Location: `api/cron/check-overdue/route.ts` and equivalent cron routes  
Affected Module: Task/Enrollment scheduled jobs  
Trigger: Invoke cron with a URL secret.  
Expected: Secrets travel only in authorization headers.  
Actual: Secret can appear in access/proxy/platform logs and browser history.  
Root Cause: Legacy convenience authentication path.  
Impact: Increased credential exposure surface.  
Fix: Remove query-string secret support after confirming all schedulers use Authorization headers.  
Regression Risk: Low; external callers must be inventoried.  
Verification: Static route/workflow comparison.  
Status: **OPEN — hardening**

## Regression Risks

- T-01 requires saved-layout/no-layout/localStorage/archived-column cases.
- T-02 requires rapid A→B→C, two-user 409, slow network, and canonical version checks.
- T-03's atomic command touches SLA/history/assignment/notifications and needs deployed-schema failure injection after every write.

## Fixes Applied

T-01 layout hydration guard (`cdd06de`), T-02 serialized canonical task PATCH/rebase (`81e8562`), T-03 post-commit warning handling plus atomic canonical/history command (`e219c91`, `4f59280`), T-04 special-action OCC (`16ad882`), T-05 paginated visible search and file rendering (`82885a3`), T-06 canonical detail metadata reconciliation (`ff87eaf`), T-07 row-scoped archive rollback (`f9c1643`), T-08 truncation containment (`a52156e`), T-09 stable realtime lifecycle (`036984e`).

## Verification

- Tasks helper suites previously passed: **21 files / 239 tests**.
- No authenticated component/browser/database failure-injection harness covered T-01/T-02/T-03.

## Remaining Risks

### T-14 — Task overdue/reminder scheduler is an unverified operational dependency

Issue: `check-overdue` is scheduled by GitHub Actions, while `vercel.json` documents other cron jobs and a route comment points to Vercel.  
Severity: **P3 — MEDIUM; operational release prerequisite**  
Location: `.github/workflows/task-reminders.yml`; `vercel.json`; `api/cron/check-overdue/route.ts`  
Affected Module: Tasks SLA/overdue/reminders  
Trigger: Scheduled Actions is delayed, disabled after inactivity, misconfigured, or duplicated with a new scheduler.  
Expected: One monitored scheduler runs at the supported cadence.  
Actual: Ownership/cadence are split and code documentation is inconsistent.  
Root Cause: Infrastructure scheduling evolved outside one declared deployment contract.  
Impact: Overdue flags, KPI counts, and reminders can stop silently or double-run.  
Fix: Confirm hosting plan, choose one scheduler, disable the other, update documentation, and alert on missed runs.  
Regression Risk: Low code risk; operational risk if both schedulers remain active.  
Verification: Static configuration comparison; deployed scheduler/logs not inspected.  
Status: **OPEN — verify before Go-Live**

- Tasks severity: **1 P0, 2 P1, 6 P2, 5 P3, 1 P4**.

---

# 2. Medicare Enrollment

## Status

**REVIEWED — NOT GO-LIVE READY.** Medicare/ACA correctly share one client/API, and Medicare-inapplicable fields are stripped client/server and protected by schema constraints. The shared implementation still has three P1 defects: permission affordances, same-record mutation ownership, and multi-write commit semantics.

## Functional Bugs

### M-01 — Read-only records render editable controls and guarantee A → B → A

Issue: The client computes `canEditRecord` but does not apply it to Stage, Due, Agent/Assignee, Carrier, QC, reopen, and several other controls.  
Severity: **P1 — CRITICAL**  
Location: `EnrollmentClient.tsx:393-409,1613-1817,2494-2957`; `src/lib/enrollment/access.ts:26-33`  
Affected Module: Medicare and ACA  
Trigger: A task worker views a shared record they may read but may not mutate, then uses an unguarded control.  
Expected: Every control is visibly read-only/disabled.  
Actual: UI optimistically shows B; server correctly returns 403; client restores A and shows an error.  
Root Cause: Server authorization and client affordance coverage use the same predicate inconsistently.  
Impact: Normal user action produces guaranteed visible flicker and repeated impossible edits.  
Fix: Give every shared control one explicit `canEdit` contract while keeping New Enrollment controls enabled and retaining server checks.  
Regression Risk: Medium-high; cover managers, creators, Caller/Responsible/Assignee, read-only workers, both programs, and New Enrollment.  
Verification: Static control-by-control permission trace; independently confirmed by Claude. No component authorization test exists.  
Status: **IMPLEMENTED — read-only browser verification pending**

### M-02 — Concurrent edits can erase a confirmed Enrollment value

Issue: `pendingRef` is a Set, not a per-id counter/queue, and each request rolls back a whole record snapshot.  
Severity: **P1 — CRITICAL**  
Location: `EnrollmentClient.tsx:465-477,693-741,805-849`; enrollment PATCH route  
Affected Module: Medicare and ACA  
Trigger: Two rapid edits/QC clicks on one record.  
Expected: Mutations serialize/rebase; rejected stale intent reconciles to canonical state.  
Actual: Both capture V0; one confirms V1; the other 409s and restores V0. The first settle can delete the id from the Set while another request remains in flight.  
Root Cause: Boolean entity pending state, overlapping writes, and whole-row rollback ownership.  
Impact: Confirmed values disappear, concurrency token becomes stale, and A → B → A → B is reachable.  
Fix: Serialize/count per record or journal field mutations; on 409 accept/refetch canonical state.  
Regression Risk: High; all Enrollment fields/programs share this path.  
Verification: Deterministic two-request static interleaving; no component async test exists.  
Status: **IMPLEMENTED — slow-network/two-user verification pending**

### M-03 — Enrollment create/update can commit data and then report failure or omit audit rows

Issue: Canonical create/update, stage history, activity, and notification writes are independent; some Supabase result errors are not inspected.  
Severity: **P1 — CRITICAL**  
Location: `api/enrollment/route.ts:165-256`; `api/enrollment/[id]/route.ts:278-335,464-472`; enrollment notifications  
Affected Module: Medicare and ACA  
Trigger: Notification/history/activity fails after the record commits.  
Expected: Required record/audit state is atomic; non-critical notification failure cannot turn a committed mutation into an apparent failure.  
Actual: Route can return 500 after commit, or 200 with missing audit rows when returned `error` fields are ignored.  
Root Cause: No transaction boundary and incorrect assumption that awaiting every Supabase builder throws on DB error.  
Impact: UI/server disagreement, duplicate create retry, missing history/activity, and missed notifications.  
Fix: Atomic canonical+audit command; explicit result checks; idempotent non-authoritative notifications.  
Regression Risk: High; both programs, stage/QC automation, and notifications depend on this path.  
Verification: Static write/error trace; no route failure injection exists.  
Status: **PARTIAL — P1 OPEN pending transactional/repair design**

### M-04 — Archive failure can hide the target and revert unrelated records

Issue: Network rejection has no catch/rollback; HTTP failure restores the full records array; DELETE lacks a version token.  
Severity: **P2 — HIGH**  
Location: `EnrollmentClient.tsx:881-899`; enrollment DELETE route  
Affected Module: Medicare and ACA  
Trigger: Network/HTTP failure or stale archive while another record changes.  
Expected: Restore only target, report failure, reject stale intent.  
Actual: Target can remain hidden locally or unrelated rows revert.  
Root Cause: Missing catch, collection snapshot rollback, no archive OCC.  
Impact: False archive display and unrelated visible state loss.  
Fix: Row-scoped rollback, catch/reconcile, expected version.  
Regression Risk: Medium.  
Verification: Direct branch/predicate trace.  
Status: **IMPLEMENTED — two-tab verification pending**

### M-05 — Comment response can return an unpersisted parent version

Issue: Parent timestamp/activity update errors are unchecked, but locally generated `parent_updated_at` is always returned.  
Severity: **P2 — HIGH**  
Location: enrollment comments route and `EnrollmentClient.tsx:1024-1031`  
Affected Module: Medicare and ACA  
Trigger: Comment insert succeeds and parent touch/activity fails.  
Expected: Return persisted canonical version or fail/repair coherently.  
Actual: Client adopts a token absent from DB; next edit can 409.  
Root Cause: Unchecked Supabase results and optimistic response contract.  
Impact: A successful comment can block the next legitimate edit and lose audit activity.  
Fix: Atomic comment/parent/activity or explicit result validation plus canonical refetch.  
Regression Risk: Medium.  
Verification: Static failure injection path.  
Status: **OPEN**

### M-06 — Attachment storage, DB metadata, and list counts can diverge

Issue: Upload writes storage before DB; delete removes storage before DB row; detail-room invalidation does not guarantee list-count refresh; delete errors are not consistently surfaced.  
Severity: **P2 — HIGH**  
Location: Enrollment attachment routes; shared `AttachmentPanel`; Enrollment list metadata  
Affected Module: Medicare, ACA, and shared attachment behavior  
Trigger: Failure between storage/DB steps or ordinary standalone attachment mutation.  
Expected: Consistent storage/metadata and refreshed counts.  
Actual: Orphan objects, broken rows, stale list counts, or silent delete failure.  
Root Cause: No compensating workflow and incomplete invalidation/error contract.  
Impact: Storage leakage, broken downloads, and incorrect UI metadata.  
Fix: Compensating cleanup/retry bookkeeping, list invalidation, and surfaced errors.  
Regression Risk: Medium; component is shared with Tasks.  
Verification: Static operation ordering and topic trace.  
Status: **OPEN**

### M-09 — No-op PATCH hardcodes comment/attachment counts to zero

Issue: Empty sanitized patches return a record with both counts hardcoded to zero; option menus can send unchanged ids.  
Severity: **P2 — HIGH**  
Location: `api/enrollment/[id]/route.ts:271-273,472`; client record replacement path  
Affected Module: Medicare and ACA  
Trigger: Re-select the existing Stage/Carrier/Payment value.  
Expected: No-op leaves row metadata unchanged.  
Actual: Comment/file badges become zero until later refetch.  
Root Cause: No-op response bypasses canonical record-with-stats fetch.  
Impact: Visible false counts and wrong sort.  
Fix: Ignore truly empty client patches or return the canonical row/stats.  
Regression Risk: Low.  
Verification: Static response/client replacement trace; independently confirmed.  
Status: **IMPLEMENTED — route-level verification pending**

### M-10 — Due-date input writes immediately without equality or request-order control

Issue: Native date `onChange` PATCHes immediately and resets due-notification markers for every accepted change.  
Severity: **P2 — HIGH**  
Location: `EnrollmentClient.tsx:2732-2739`; enrollment PATCH due normalization  
Affected Module: Medicare and ACA  
Trigger: Rapid date changes; some browsers may also emit intermediate empty values during manual entry.  
Expected: One validated, intentional date write wins.  
Actual: Multiple overlapping PATCHes are possible and can interact with M-02; the exact empty intermediate sequence is browser-dependent and was not reproduced here.  
Root Cause: Network persistence directly on change with no equality guard/serialization.  
Impact: Request noise, potential 400/409 flicker, and unintended reminder-marker reset.  
Fix: Validate/equality-check and save on committed value/blur through the per-record mutation queue.  
Regression Risk: Low–medium; test picker, typing, clearing, Required, and both programs.  
Verification: Code path confirmed; deterministic browser event-count claim remains unverified.  
Status: **OPEN**

## Performance / Lag

### M-07 — Enrollment payload and row rendering are unbounded

Issue: Each load/realtime refresh fetches all unarchived records, all comment bodies for local search, and attachment rows; every visible row renders, with repeated relative-time timers.  
Severity: **P2 — HIGH; volume-dependent Go-Live blocker**  
Location: `src/lib/enrollment/queries.ts:64-128`; `EnrollmentClient.tsx` list/filter/render paths  
Affected Module: Medicare and ACA  
Trigger: Growing record/comment volume and any enrollment broadcast.  
Expected: Bounded list payload/render work.  
Actual: DB rows, comment text, JSON, filter/sort, DOM, and timers grow with the full active corpus.  
Root Cause: No paging/windowing/server search aggregation; comment search text rides every list response.  
Impact: Increasing TTFB, bandwidth, memory, and UI lag.  
Fix: Establish thresholds, detect truncation, paginate/window, move comment search server-side, and consolidate timers where measured.  
Regression Risk: High; filters, export, search, realtime, and deep links assume full data.  
Verification: Static data/render trace; no production-sized benchmark.  
Status: **OPEN**

### M-11 — ACA and Medicare share one global realtime topic

Issue: A change in either program refetches both programs' open tabs.  
Severity: **P2 — HIGH**  
Location: `src/lib/enrollment/realtime-topics.ts`; enrollment broadcasts/subscribers  
Affected Module: Medicare ↔ ACA  
Trigger: Any record mutation in one program.  
Expected: Only the affected program invalidates.  
Actual: The other program reloads its full M-07 payload/options without useful change.  
Root Cause: Topic has no program dimension.  
Impact: Cross-program request amplification.  
Fix: Versioned two-phase migration to program-scoped topics; avoid a mixed old/new deployment losing realtime.  
Regression Risk: Medium.  
Verification: Static topic trace; multi-tab request count not measured.  
Status: **OPEN**

## Race Conditions / Async Issues

### M-08 — Drawer, Overview, and option reloads are not consistently latest-request-wins

Issue: Record list refetch has sequencing, but drawer reload, manual/assignment Overview load, and option reload do not.  
Severity: **P2 — HIGH**  
Location: `EnrollmentClient.tsx` drawer/options loaders; `EnrollmentOverview.tsx:40-52,241-245,399-406`  
Affected Module: Medicare and ACA  
Trigger: Rapid refreshes, broadcasts, assignment reload, or two Config option changes with reordered responses.  
Expected: Only newest response updates state.  
Actual: Older A can render after newer B; Overview also remains stale without manual refresh.  
Root Cause: Response arrival order directly owns state outside the guarded main record refetch.  
Impact: B → A visible rollback in details, metrics, or option config.  
Fix: Request ids/AbortController and explicit refresh policy.  
Regression Risk: Low–medium; active form option reconciliation must preserve user input.  
Verification: Static A-start/B-start/B-finish/A-finish trace.  
Status: **OPEN**

### M-12 — Schema fallbacks can silently discard fields when production DB is behind

Issue: Several missing-column/table errors fall back to legacy reads/writes and still return success.  
Severity: **P2 — HIGH; escalates to P0 if production schema is missing required objects**  
Location: enrollment/task queries and routes; Config layout fallback; `supabase/schema.sql`  
Affected Module: Tasks, Medicare, ACA, Config layout  
Trigger: Deploy code against a database missing newer columns/RPC/table definitions.  
Expected: Deployment fails health checks or writes report unsupported schema.  
Actual: Description/custom values/layout/metadata can be omitted while HTTP responses appear successful.  
Root Cause: Compatibility fallbacks conceal schema drift and the repository has no verified migration chain in this audit.  
Impact: Silent data loss or degraded behavior.  
Fix: Mandatory pre-Go-Live schema/RPC verification; fail closed for writes; add migration/version health check.  
Regression Risk: Low for verification, medium for removing compatibility fallbacks.  
Verification: Fallback branches confirmed statically; production DB state was not available.  
Status: **OPEN — conditional release gate**

## State Management Issues

- Shared `records` is written by optimistic mutations, full refetches, comments, archive snapshots, and create insertion.
- No generic async default/reset overwrite was found in New Enrollment; active-option invalidation is the concrete form risk.
- Medicare field stripping/sanitization/schema protection is currently consistent.

### M-13 — Enrollment writes the hydrated layout even when the user changes nothing

Issue: After hydration unlocks the auto-save effect, the hydrated state can immediately trigger a layout PUT.  
Severity: **P3 — MEDIUM**  
Location: `EnrollmentClient.tsx:541-615`  
Affected Module: Medicare and ACA / shared layout  
Trigger: Open either Enrollment page.  
Expected: Persist layout only after a user change.  
Actual: A load can write the same/default layout and create a customization row for a user who changed nothing.  
Root Cause: Hydration completion and user-dirty state are represented by one enable flag, not a serialized baseline.  
Impact: Unnecessary DB writes and ambiguous “customized” state.  
Fix: Store the hydrated serialized snapshot and skip identical saves.  
Regression Risk: Low; verify real changes still persist.  
Verification: Static effect/state timeline; request count not browser-measured.  
Status: **OPEN**

## UI/UX Issues

### M-14 — Create validation can fail with no visible message

Issue: Missing Required fields only populate `invalidKeys`; no summary/error is set and the field may be outside the visible panel.  
Severity: **P3 — MEDIUM**  
Location: `EnrollmentClient.tsx:3097-3105`  
Affected Module: Medicare and ACA  
Trigger: Submit while an off-screen Config-required field is empty.  
Expected: Focus/scroll to the first error and show a readable validation summary.  
Actual: Dialog appears not to respond; only an off-screen border changes.  
Root Cause: Client validation returns before the normal error-message path.  
Impact: User confusion and repeated clicks; no data corruption.  
Fix: Set a labeled message and focus/scroll the first invalid control.  
Regression Risk: Low.  
Verification: Static branch trace; no component accessibility test.  
Status: **OPEN**

### M-15 — Create and Update parse invalid due dates differently

Issue: Create coerces invalid dates to null, while Update returns 400.  
Severity: **P3 — MEDIUM**  
Location: enrollment create `cleanDate` and update `parseDate` paths  
Affected Module: Medicare and ACA / integrations  
Trigger: Submit a non-ISO date value.  
Expected: One validation contract across create/update.  
Actual: Create can silently lose due date; Update reports an error.  
Root Cause: Duplicated date parsing helpers with different failure semantics.  
Impact: Direct/import clients can observe inconsistent behavior.  
Fix: Share a strict parser and return the same validation error.  
Regression Risk: Low–medium; inventory callers relying on coercion.  
Verification: Static route comparison; no route test.  
Status: **OPEN**

### M-16 — Enrollment reopen uses a native prompt instead of the shared reason modal

Issue: Same reopen-reason interaction uses `window.prompt` in Enrollment and `ReasonModal` in Tasks.  
Severity: **P3 — MEDIUM**  
Location: `EnrollmentClient.tsx:2557-2562`; shared `ReasonModal`  
Affected Module: Medicare and ACA / UI consistency  
Trigger: Reopen a terminal Enrollment record.  
Expected: Accessible, validated, consistently styled reason collection.  
Actual: Native prompt cannot share validation/style/interaction patterns.  
Root Cause: Enrollment implemented the interaction independently.  
Impact: Accessibility and behavior inconsistency. A production iframe/webview blocker was not established, so this remains P3.  
Fix: Reuse `ReasonModal` without changing server business rules.  
Regression Risk: Low; verify reason remains mandatory and New/terminal flows.  
Verification: Static interaction comparison.  
Status: **OPEN**

### M-18 — Enrollment mixes blur-save and immediate-save controls

Issue: Text fields persist on blur while menus/date fields persist immediately.  
Severity: **P4 — LOW**  
Location: Enrollment drawer editable text, Stage/Due/option handlers  
Affected Module: Medicare and ACA  
Trigger: Edit adjacent property types.  
Expected: Save timing is predictable or clearly communicated.  
Actual: Similar-looking fields commit at different interaction points.  
Root Cause: Controls use feature-native persistence patterns.  
Impact: Minor learnability inconsistency; M-10/M-02 capture concrete correctness consequences.  
Fix: Document and gradually standardize after blockers.  
Regression Risk: Medium if behavior is changed broadly; avoid before Go-Live.  
Verification: Static handler comparison.  
Status: **OPEN — non-blocking**

## UI Consistency

- ACA and Medicare are the system's most consistent pair because they share one implementation.
- Custom fields appear in Task Create but not Enrollment Create; Config must not imply identical Required semantics until that gap is closed.

## Duplicate / Overlapping Logic

### M-17 — Medicare-inapplicable field rules are repeated across layers

Issue: Equivalent field exclusion sets/conditions exist in several client/server locations.  
Severity: **P3 — MEDIUM regression debt**  
Location: Enrollment client hidden/render/create/attention rules and `program-fields.ts`  
Affected Module: Medicare / ACA shared implementation  
Trigger: Add or reclassify a program-specific field.  
Expected: One contract prevents cross-program drift.  
Actual: Every copy must be updated manually; current copies were found consistent.  
Root Cause: UI/server representations need different field names but lack a cross-layer contract test.  
Impact: Future regression risk, not a current production mismatch.  
Fix: Add a contract test first; avoid a broad refactor before launch.  
Regression Risk: Low for test-only protection.  
Verification: Existing lists were compared and currently match.  
Status: **OPEN — test debt**

## Security / Permission

- No confirmed server authorization bypass was found; M-01 is a client affordance defect with correct server rejection.
- Company-wide Enrollment read access includes comments/files and needs explicit product/security approval due to sensitive data.

## Regression Risks

- Every shared Enrollment change must be tested on ACA and Medicare.
- Permission changes must cover New Enrollment separately so shared controls do not default disabled.
- Async/config fixes must invalidate only affected selections and preserve unrelated typed input.

## Fixes Applied

M-01 read-only control contract (`d608d9c`), M-02 serialized record PATCH/rebase (`fc00dbe`), M-03 post-commit warning handling (`f95ebbe`, partial), M-04 row-scoped archive rollback (`802493a`), M-09 canonical no-op stats (`373a4dc`).

## Verification

- Enrollment/table-config helper suites previously passed: **12 files / 73 tests**.
- No API failure injection, component permission test, reordered-response harness, or production DB schema check was run.

## Remaining Risks

- Shared Enrollment severity: **3 P1, 9 P2, 5 P3, 1 P4**.
- Medicare cannot be marked ready while M-01/M-02/M-03 remain open or M-12's production schema prerequisite is unknown.

---

# 3. Config

## Status

**REVIEWED — NOT GO-LIVE READY.** Config is correctly admin-restricted, but import integrity, live client/config drift, and workflow-stage invariants can affect all three operational modules. Severity below distinguishes real data/workflow blockers from admin-only UX and design debt.

## Functional Bugs

### C-01 — Import approval can partially commit with no safe resume

Issue: Import request+rows and approval live writes are separate; approval applies rows sequentially without transaction, durable per-row progress, or idempotency. The route permits 5,000 rows and has no explicit long-duration budget.  
Severity: **P1 — CRITICAL when import is enabled for Go-Live**  
Location: Config import POST/PATCH routes; `IMPORT_MAX_ROWS`; sequential `applyImportRow` loop  
Affected Module: Config → Tasks, Medicare, ACA  
Trigger: Staging insert fails, any later row fails, or the server function is terminated during a large import.  
Expected: Complete immutable staging and atomic/resumable approval.  
Actual: Earlier rows remain committed; status can be failed or stuck processing; retry can duplicate adds; clients may receive no broadcast.  
Root Cause: No transaction/job boundary, idempotency key, or durable applied marker. `maxDuration`/row limit only affect timeout probability, not correctness.  
Impact: Partially mutated production data with no safe UI repair path.  
Fix: **Containment:** disable/gate import or lower a measured limit and configure supported duration. **Permanent:** transactional or durable idempotent per-row job with resume/rollback and broadcasts.  
Regression Risk: High for permanent redesign; low for disabling/gating.  
Verification: Static failure boundaries; no large staging import was run.  
Status: **REMOVED WITH IMPORT FEATURE — historical-request reconciliation/evidence pending**

### C-02 — Import bypasses normal domain validation and transition behavior

Issue: Import writes directly to Tasks/Enrollment tables rather than shared domain commands.  
Severity: **P1 — CRITICAL unless product formally defines a separate historical-import contract**  
Location: table-config import mapping/apply functions versus normal task/enrollment routes  
Affected Module: Config → Tasks, Medicare, ACA  
Trigger: Approve rows with Required omissions, status/stage changes, assignments, or unsupported option values.  
Expected: Imported records satisfy declared import rules and preserve required workflow/audit invariants.  
Actual: Required checks, transition timestamps/history, `closed_at`/QC/SLA rules, assignments, notifications, and mapped fields can differ from interactive writes.  
Root Cause: A second incomplete persistence implementation.  
Impact: Wrong workflow state, missing audit/notifications, and misleading “approved” data.  
Fix: Define/sign off historical-import semantics; otherwise route through transaction-safe domain commands with contract tests.  
Regression Risk: High; existing spreadsheet behavior may depend on current coercions.  
Verification: Field-by-field static comparison; no product sign-off was present.  
Status: **REMOVED WITH IMPORT FEATURE — direct-route/export evidence pending**

### C-03 — Import approval can overwrite newer records or wipe custom values

Issue: Staged targets have no version; approval updates by id. A current-custom-values read error is converted to `{}` and then used in a replacement merge.  
Severity: **P1 — CRITICAL**  
Location: Config import staging/apply and `fetchCurrentCustomValues`  
Affected Module: Config → Tasks, Medicare, ACA  
Trigger: User edits after staging, or transient DB read error occurs during approval.  
Expected: Stale targets conflict; failed reads stop without writes.  
Actual: Approval overwrites newer data; read error can erase every existing custom value not present in the spreadsheet.  
Root Cause: No staged `expected_updated_at` and error-as-empty fallback on read-before-replace.  
Impact: Silent lost updates and direct data loss.  
Fix: Fail closed on read error immediately; capture/compare target version; use atomic JSON merge where valid.  
Regression Risk: Medium for fail-closed patch, high for full conflict workflow.  
Verification: Direct static branch confirmed independently by both reviews.  
Status: **REMOVED WITH IMPORT FEATURE — historical-request reconciliation pending**

### C-04 — Open clients receive record pings but not changed column configuration

Issue: Config broadcasts Tasks/Enrollment entity topics; clients refetch rows but immutable RSC `tableColumns`/custom options remain stale.  
Severity: **P1 — CRITICAL if live Config changes are allowed**  
Location: `src/lib/table-config/realtime.ts`; Tasks/Enrollment subscribers and server-prop config sources  
Affected Module: Config → Tasks, Medicare, ACA  
Trigger: Admin adds/archives/renames/requires columns or changes custom options while users are active.  
Expected: Scoped config revision reload or mandatory reload before continued editing.  
Actual: Clients keep stale controls while the server enforces fresh Required/config rules; expensive full-record refetches do not repair config.  
Root Cause: Config invalidation reuses untyped entity topics and clients have no live config state/revision.  
Impact: Valid-looking submit can fail, archived controls remain visible, and every Config click can amplify full-list traffic.  
Fix: **Containment:** formal config freeze plus forced reload/banner. **Permanent:** scoped config revision and latest-wins reconciliation that does not overwrite active input. Fix T-01 first.  
Regression Risk: High for live hydration; low–medium for banner/freeze control.  
Verification: End-to-end static broadcast/subscriber trace; no multi-session browser test.  
Status: **OPEN**

### C-05 — Stage configuration can invalidate Enrollment workflow state

Issue: Admin can archive the last stage or change terminal/QC flags for in-use stages without impact validation or record reconciliation.  
Severity: **P1 — CRITICAL if workflow Config remains mutable at Go-Live**  
Location: enrollment option-set update/archive routes; Config stage controls; enrollment create/update rules  
Affected Module: Config → Medicare, ACA  
Trigger: Archive all active stages or change flags on an in-use stage.  
Expected: Minimum valid stage and in-use workflow invariants are enforced/migrated atomically.  
Actual: New records can have no stage; existing `closed_at`, QC, due, reopen, and Overview state can disagree with the configured stage.  
Root Cause: Critical workflow options are edited as ordinary labels/flags; record invariants only run on normal record transitions.  
Impact: System-wide pipeline state becomes contradictory from an allowed admin action.  
Fix: Enforce cardinality/type; preview impact; block or atomically migrate in-use semantic changes; define explicit initial/reopen stages.  
Regression Risk: High.  
Verification: Static route trace finds no usage/cardinality/migration enforcement.  
Status: **OPEN**

### C-06 — Import approver cannot inspect staged row values/diffs

Issue: APIs expose preview/detail rows but the submit/review UIs show only counts and metadata.  
Severity: **P2 — HIGH**  
Location: `HealthTableImportDialog`; Config import-review cards; import detail API  
Affected Module: Config → all scopes  
Trigger: Second admin approves any pending import.  
Expected: Reviewer sees target, action, values/errors, and old→new diff bound to a staging revision.  
Actual: Approval occurs from a summary-only card.  
Root Cause: Governance UI stopped at status/counts.  
Impact: A mandatory second-admin control cannot catch correctly typed but incorrect mass changes.  
Fix: Paginated staged rows/diffs and revision-bound final confirmation.  
Regression Risk: Medium.  
Verification: Static UI/API usage trace.  
Status: **REMOVED WITH IMPORT FEATURE — direct-route verification pending**

### C-07 — Global Config mutations can partially commit

Issue: Column patch+layout reset, multi-column reorder, and agent membership+delete span multiple writes.  
Severity: **P2 — HIGH**  
Location: Config column PATCH/reorder and agent DELETE routes  
Affected Module: Config → all modules  
Trigger: A later write/layout reset fails.  
Expected: Global change commits or rolls back as one revision.  
Actual: Endpoint can return 500 after partial state and before broadcast.  
Root Cause: Missing transaction/RPC boundary.  
Impact: Mixed order/layout/permission state and UI/DB disagreement. Admin-only/low-frequency exposure keeps this at P2, but impact is global.  
Fix: Atomic server operations and committed revision broadcast.  
Regression Risk: High.  
Verification: Static write-before-error paths.  
Status: **OPEN**

### C-08 — Editable labels act as workflow identity

Issue: Stage order/default/reopen and two notifications depend on label text; Consent's checkbox behavior identifies “Yes” by label.  
Severity: **P2 — HIGH**  
Location: enrollment option helpers; enrollment PATCH notification labels; Consent control  
Affected Module: Config → Medicare, ACA  
Trigger: Rename numbered stages, exact notification stages, or Consent Yes.  
Expected: Display labels are presentation only.  
Actual: Label-only edits change business order/defaults, disable notifications, or change control type.  
Root Cause: Editable text doubles as stable business identity.  
Impact: Silent workflow/notification/UI behavior changes.  
Fix: Stable keys/flags and explicit initial/reopen/notification semantics.  
Regression Risk: High for migration, low for blocking protected label edits temporarily.  
Verification: Static label-consumer trace; independently confirmed exact notification labels.  
Status: **OPEN**

## Performance / Lag

### C-09 — Config initial load scans active Enrollment records for usage counts

Issue: Config transfers every active Enrollment row to count option usage in JavaScript and repeats column queries.  
Severity: **P2 — HIGH; volume-dependent**  
Location: `config/page.tsx:28-100`; table-config query helpers  
Affected Module: Config  
Trigger: Open `/config` as record volume grows.  
Expected: Aggregated/lazy counts and one config snapshot.  
Actual: TTFB and memory grow linearly; counts remain stale after live changes.  
Root Cause: Full-row server-page aggregation and repeated helper queries.  
Impact: Slow production-control page and unnecessary DB traffic.  
Fix: Grouped count RPC/query or lazy per-tab endpoint; reuse one scope snapshot.  
Regression Risk: Low–medium.  
Verification: Static query trace; no large-data benchmark.  
Status: **OPEN**

## Race Conditions / Async Issues

### C-10 — Rapid column PATCHes are not last-intent-wins

Issue: Pending counter delays refresh but does not serialize/version PATCHes; last-settling failure can skip the final canonical refresh.  
Severity: **P2 — HIGH**  
Location: `ConfigClient.tsx:436-520`; Config column PATCH route  
Affected Module: Config → all consumers  
Trigger: Rapid toggles on slow/reordered network.  
Expected: Latest admin intent persists and UI reconciles.  
Actual: Older request can overwrite newer; failure ordering can leave stale UI.  
Root Cause: Request counting is not ordering/OCC.  
Impact: Required/Hidden/Pinned can end opposite the final click.  
Fix: Per-column queue/coalescing, expected revision, always-finally reconciliation.  
Regression Risk: Medium-high.  
Verification: Static A/B completion-order trace.  
Status: **OPEN**

### C-11 — Scope-local drafts and async results can leak across Config scopes

Issue: Dropdown draft state survives scope changes; import/refresh requests lack complete latest-scope guards.  
Severity: **P2 — HIGH**  
Location: `ConfigClient.tsx` scope/draft/import/refresh state  
Affected Module: Config  
Trigger: Type draft then switch scope, or switch scope during slow requests.  
Expected: State is keyed/reset by scope; only latest response renders.  
Actual: Draft can create a value under the wrong group/scope; stale data/error can appear as empty/new scope state.  
Root Cause: Long-lived child state and requests are not scope-versioned.  
Impact: Wrong-scope config creation and approval confusion.  
Fix: Key/reset drafts and use request sequence/AbortController with explicit errors.  
Regression Risk: Low–medium.  
Verification: Static scope-switch/reordered-response trace.  
Status: **OPEN**

### C-12 — Stage rule toggles bypass shared pending/error handling

Issue: Terminal/QC toggles call async mutation directly without busy/disable/catch/version control.  
Severity: **P2 — HIGH**  
Location: `ConfigClient.tsx` Terminal/QC checkbox handlers  
Affected Module: Config → Medicare, ACA  
Trigger: API failure or rapid double toggle.  
Expected: Visible failure and latest intent wins.  
Actual: Unhandled rejection/no Toast; reversed responses can persist the earlier rule.  
Root Cause: High-impact mutation bypasses the page coordinator and has no OCC.  
Impact: Admin unknowingly leaves terminal/QC automation opposite intent.  
Fix: Serialized/versioned action, disable while pending, reconcile, typed feedback.  
Regression Risk: Medium.  
Verification: Direct handler trace.  
Status: **OPEN**

## State Management Issues

- Config has no single revision across columns, options, agents, imports, local optimistic state, and usage counts.
- A single boolean `busy` does not represent overlapping actions reliably.

## UI/UX Issues

### C-14 — Config renders success and failure with the same Toast tone

Issue: `run` stores only a notice string and Toast receives no explicit tone.  
Severity: **P3 — MEDIUM**  
Location: `ConfigClient.tsx` mutation coordinator/Toast; shared Toast defaults  
Affected Module: Config  
Trigger: Any Config mutation succeeds or fails.  
Expected: Success and failure are visually/semantically distinct.  
Actual: Both use neutral/info styling, so a rejected action can look successful when read quickly.  
Root Cause: Feedback state omits result type.  
Impact: Admin can misinterpret whether a global change applied.  
Fix: Store `{message,tone}` and pass error/success tone consistently.  
Regression Risk: Low.  
Verification: Static Tasks/Enrollment/Config Toast comparison.  
Status: **OPEN**

### C-15 — Config overstates Required semantics for custom Enrollment columns

Issue: Admin can mark a custom Enrollment column Required, but Create has no custom inputs and deliberately calls validation with `checkCustom:false`.  
Severity: **P3 — MEDIUM**  
Location: table-config column capability/required helpers; Enrollment Create UI/route  
Affected Module: Config → Medicare, ACA  
Trigger: Enable Required for a custom ACA/Medicare column, then create a record.  
Expected: UI explains whether Required applies at create time or blocks unsupported configuration.  
Actual: Record can be created without it, despite the Config label.  
Root Cause: The skip is an intentional escape from an unsatisfiable form, but the admin-facing contract does not disclose the limitation.  
Impact: Misleading configuration and missing expected business data; not classified P1 because code explicitly chose post-create semantics.  
Fix: Show the limitation or disable the flag until Create renders typed custom inputs.  
Regression Risk: Low for disclosure/disable; medium-high for adding Create inputs.  
Verification: Static Config→Create validation trace and code comment review.  
Status: **OPEN**

## UI Consistency

### C-17 — Config page shell differs slightly from the unified application shell

Issue: Config uses a different height/background wrapper from Tasks/Enrollment.  
Severity: **P4 — LOW**  
Location: Config root client wrapper versus Tasks/Enrollment roots  
Affected Module: Config / cross-module UI  
Trigger: Navigate among the four target areas.  
Expected: Same system shell and background language.  
Actual: Config spacing/background differs slightly.  
Root Cause: Page was styled independently.  
Impact: Cosmetic inconsistency only.  
Fix: Align existing shell classes after functional blockers.  
Regression Risk: Low.  
Verification: Static class comparison.  
Status: **OPEN — non-blocking**

- Four select implementations use different closing/portal behavior; consolidate only after Go-Live unless a measured clipping bug requires it.

## Duplicate / Overlapping Logic

- Import is the dangerous duplicate of normal Tasks/Enrollment persistence.
- Workflow meaning is distributed across flags, labels, record timestamps, notifications, cron, and client sorting.

## Security / Permission

- Config write authorization and second-admin identity separation are enforced.

### C-13 — Column POST does not apply PATCH invariants

Issue: Required/Pinned/Hidden/show-in-detail invariants run on PATCH but not column creation.  
Severity: **P3 — MEDIUM hardening**  
Location: Config columns POST and PATCH routes; `applyColumnPatchInvariants`  
Affected Module: Config → all scopes  
Trigger: Direct caller creates a column with conflicting flags such as Required+Hidden. Current UI sends only basic fields.  
Expected: Same invariants at every write boundary.  
Actual: Direct POST can create an impossible-to-fill hidden required field.  
Root Cause: Creation bypasses the shared invariant helper.  
Impact: API hardening gap; official UI does not currently trigger it.  
Fix: Apply the same invariant function before insert.  
Regression Risk: Low.  
Verification: Static POST/PATCH comparison.  
Status: **OPEN — hardening**

### C-16 — Config columns GET without scope returns all scope definitions

Issue: Omitting scope returns CS, ACA, and Medicare definitions to any actor allowed to read Config metadata.  
Severity: **P3 — MEDIUM hardening**  
Location: `api/config/columns/route.ts`  
Affected Module: Config metadata  
Trigger: Call GET columns without `scope`.  
Expected: Require/authorize explicit scope or deliberately document aggregate access.  
Actual: All table structures are returned.  
Root Cause: Optional scope convenience branch.  
Impact: Structural information exposure, not customer-record disclosure.  
Fix: Require scope or filter scopes by actor permissions.  
Regression Risk: Low–medium; inventory aggregate callers.  
Verification: Static route branch trace.  
Status: **OPEN — hardening**

## Regression Risks

- Live config fixes must run after T-01 and must not reset open forms.
- Stage/label fixes require impact analysis across all existing records.
- Import fixes require all three scopes and comparison with normal domain behavior.

## Fixes Applied

Import code-surface removal and Export helper preservation (`4fdac30`). Config live-mutation freeze/transaction work is not applied; C-04/C-05 remain decision-gated.

## Verification

- Table-config helper suites previously passed: **8 files / 40 tests**.
- No 5,000-row import, database failure injection, multi-admin review, active-form config update, or reordered PATCH browser test was run.

## Remaining Risks

- Config severity: **5 P1, 7 P2, 4 P3, 1 P4**.
- After Import is fully removed and Config is frozen with forced reload, C-01/C-02/C-03/C-06 leave the product surface while C-04/C-05 are operationally contained. The controls must be explicit release policy—not verbal guidance.

---

# 4. ACA Enrollment

## Status

**REVIEWED — NOT GO-LIVE READY.** ACA inherits every shared Enrollment issue above. It adds one P1 default-view correctness defect and five P2 program/search/config/ownership findings. The previous claim that ACA's Caller default makes only Medicare records need attention was rejected.

## Functional Bugs

### A-01 — Newly created ACA record can disappear from the creator's default list

Issue: Non-managers default to `Responsible = current user`; ACA Create defaults Caller to current user but leaves Responsible empty.  
Severity: **P1 — CRITICAL**  
Location: `EnrollmentClient.tsx:455-458,641-648,852-872,3039-3055,3822-3827`; enrollment access helpers  
Affected Module: ACA  
Trigger: Non-manager creates ACA without assigning Responsible, then closes the opened drawer.  
Expected: Successful record stays in the creator's default working view or the ownership field used by that view is required/set.  
Actual: POST succeeds and the record exists, but `visibleRecords` filters it out.  
Root Cause: Default-list ownership recognizes Responsible only, while creation/authorization recognizes creator/Caller/Responsible.  
Impact: Core create looks lost; users can retry and create duplicates.  
Fix: Define one product-approved “My records” predicate or intentionally require/assign Responsible.  
Regression Risk: Medium-high; test manager/global views, Caller, creator, Responsible, Medicare terminology, and cleared filters.  
Verification: Deterministic client-state trace; independently confirmed.  
Status: **IMPLEMENTED — create/list verification pending**

### A-02 — Invalid or missing program values silently become ACA

Issue: `toEnrollmentProgram` coerces every non-exact value to `aca` and is reused at API boundaries.  
Severity: **P2 — HIGH**  
Location: `src/lib/enrollment/types.ts:1-15`; enrollment list/create/export/options/overview routes and page  
Affected Module: ACA / Medicare / integrations  
Trigger: Missing, typo, whitespace, or case-variant program.  
Expected: APIs return 400; navigation default is explicit and separate.  
Actual: Reads open ACA, and a malformed direct API client can write ACA. Official in-repo Create currently sends a normalized valid program, so P1 was not retained.  
Root Cause: UI convenience coercion doubles as boundary validation.  
Impact: Wrong program view/export and unsafe integration semantics.  
Fix: Strict API parser; deliberate page redirect/default for bare navigation.  
Regression Risk: Medium for legacy bare links.  
Verification: Static parser/caller trace; no invalid-program route test.  
Status: **OPEN**

### A-03 — Enrollment search advertises FUB lookup but omits `fub_link`

Issue: Placeholder promises client/FUB/comments; haystack contains only name, description, comments.  
Severity: **P2 — HIGH**  
Location: Enrollment toolbar and `filterRecords`  
Affected Module: ACA and shared search UI  
Trigger: Search a value present only in FUB link.  
Expected: Matching record appears.  
Actual: It is absent.  
Root Cause: UI copy and search fields diverged.  
Impact: Records cannot be found by an advertised identifier.  
Fix: Include normalized FUB value and tests.  
Regression Risk: Low.  
Verification: Direct placeholder/haystack comparison.  
Status: **OPEN**

### A-04 — Archived option leaves an invisible stale value in an open form

Issue: Option reload removes the selected option object but does not reconcile stored form id.  
Severity: **P2 — HIGH**  
Location: Enrollment Create form state/options/reload and create route option validation  
Affected Module: ACA primarily; shared option behavior affects Medicare stage/carrier  
Trigger: User selects option; admin archives it; form remains open; user submits.  
Expected: Selection is visibly invalidated with explanation while unrelated input remains.  
Actual: Control appears empty but hidden id remains; client Required may pass and server rejects archived id.  
Root Cause: Live options and form ids are independent sources of truth.  
Impact: Background Config change makes a valid-looking form fail.  
Fix: Mark removed selection invalid and require explicit replacement without resetting other fields.  
Regression Risk: Medium-high.  
Verification: Static Config-delete → broadcast → reload → form-submit trace.  
Status: **OPEN**

### A-05 — Server accepts arbitrary owner/agent emails

Issue: API persists cleaned text for Agent/Caller/Responsible without validating active account/agent eligibility shown by pickers.  
Severity: **P2 — HIGH**  
Location: enrollment create/update routes, people/agent queries, schema  
Affected Module: ACA and Medicare ownership  
Trigger: Stale/custom/direct client submits nonexistent/inactive email.  
Expected: Server enforces picker eligibility or explicit historical override policy.  
Actual: Ghost owner/agent can become authorization stakeholder/notification recipient.  
Root Cause: Eligibility is presentation-only; schema uses free text.  
Impact: Work assigned to nobody, broken filters/notifications, hard-to-repair ownership.  
Fix: Validate normalized identities with historical inactive-owner handling.  
Regression Risk: Medium.  
Verification: Static request trace finds no lookup/foreign key.  
Status: **OPEN**

### A-06 — ACA Consent Required is enforced differently by client and server

Issue: Consent is typed as checkbox but stored as nullable option id; server treats every checkbox as filled while client checks the id.  
Severity: **P2 — HIGH**  
Location: default ACA columns; `REQUIRED_CAPABLE_SYSTEM_KEYS`; `required.ts`; Consent UI and enrollment routes  
Affected Module: ACA / Config  
Trigger: Admin enables Required for Consent.  
Expected: One consistent create/update invariant.  
Actual: UI can block while direct API/update accepts null; the Required flag is misleading.  
Root Cause: Display type is reused as storage/validation semantics.  
Impact: Required data can be absent despite admin configuration.  
Fix: Safest pre-launch option is disallow Consent Required and audit existing flag; later model it as the correct value type.  
Regression Risk: Low for disabling the flag, higher for type migration.  
Verification: Static client/server validator trace; no route test.  
Status: **OPEN**

## Performance / Lag

- Shared M-07/M-11 apply; ACA's wider default column/option set increases rendering and active-config exposure.

## Race Conditions / Async Issues

- Shared M-02/M-04/M-08 and A-04 apply. Option response ordering is counted in M-08, not duplicated as an ACA-only issue.

## State Management Issues

- Optimistic records, local Create state, server versions, realtime snapshots, and live options independently influence the same record/form.
- No generic default-after-typing reset effect was confirmed.

## UI/UX Issues

- A-01 makes success look like data loss; A-03 promises unavailable search; A-04 displays a hidden invalid value as empty.

## UI Consistency

- ACA and Medicare share the same core UX; business-specific fields are legitimately separate.
- Consent's label-sensitive checkbox versus stable dropdown behavior is not a legitimate business difference and is covered by A-06/C-08.

## Duplicate / Overlapping Logic

- No old/new ACA clients were found running simultaneously.
- Import remains the dangerous duplicate of ACA create/update logic.

## Security / Permission

- No server authorization bypass confirmed; A-05 is ownership integrity, not direct privilege escalation.
- Formal approval of company-wide sensitive Enrollment read access remains required.

## Regression Risks

- Fix A-01 from an explicit product ownership definition, not an ad hoc OR condition.
- Strict parsing affects page links and all API callers.
- Option reconciliation must preserve unrelated form input.

## Fixes Applied

A-01 stakeholder-based default “mine” predicate (`2c7b96e`).

## Verification

- Shared helper baseline passed; no authenticated ACA browser scenario or invalid-program route test ran.

## Remaining Risks

- ACA-specific severity: **1 P1, 5 P2**; shared Enrollment findings are not recounted.

---

# Cross-Module Findings

## Shared Components

- Positive: ACA/Medicare share one client; Tasks/Enrollment share comments, attachments, people UI, menus, confirmation, and Toast foundations.
- Shared attachment fixes must cover Tasks and both Enrollment programs.
- Confirmation/modal accessibility and error-surface differences remain P3/P4 consistency debt.

## Shared Logic

### X-01 — Layout persistence is unversioned across all three scopes

Issue: Tasks sends immediate whole-layout PUTs; Enrollment sends debounced but already-started PUTs; Config reset can be overwritten by stale open tabs.  
Severity: **P2 — HIGH**  
Location: Tasks/Enrollment layout save effects; Config layout endpoint/reset logic  
Affected Module: Tasks, Config, Medicare, ACA  
Trigger: Rapid visibility/order changes, reordered network responses, or a user save after admin reset.  
Expected: Latest user intent and newer admin config revision win predictably.  
Actual: Older request/tab snapshot can finish last and overwrite newer layout/reset.  
Root Cause: Whole-state unconditional upsert with no queue or config/layout revision.  
Impact: Preferences/admin defaults revert after reload and archived/hidden intent can be resurrected.  
Fix: Coalesce/serialize writes and enforce monotonic config/layout revision.  
Regression Risk: Medium-high; all scopes share endpoint semantics.  
Verification: Static A/B request and admin-reset interleavings.  
Status: **OPEN**

### X-02 — Invalid Config scopes silently target CS

Issue: `toTableScope` coerces invalid/missing values to `cs`; reads and DELETE layout use it while PUT is strict.  
Severity: **P2 — HIGH**  
Location: table-config types; columns/imports/layout routes  
Affected Module: Config / Tasks layout / integrations  
Trigger: Missing/mistyped scope, especially DELETE layout.  
Expected: 400 with no read/write.  
Actual: CS definitions are returned or the user's CS layout is deleted.  
Root Cause: UI default coercion is reused as API validation, the same class as A-02.  
Impact: Wrong schema consumption and silent preference deletion.  
Fix: Strict boundary parser; keep UI defaults outside APIs.  
Regression Risk: Low–medium.  
Verification: Direct helper/route trace.  
Status: **OPEN**

## Shared Async / Invalidation

- C-04's untyped Config broadcast both causes a record-refetch storm and fails to deliver the changed configuration. It is one root issue and counted once as C-04.
- Tasks and Enrollment each implement custom optimistic/refetch guards; all three Config/Tasks/Enrollment variants have concrete ordering bugs, so a shared library rewrite is not required before fixing local invariants.

## Duplicate Implementations

- Highest risk: Config import versus normal domain mutations.
- Task assignment and workflow stage meaning have multiple paths with different consistency guarantees.
- Medicare/ACA sharing is a positive exception; do not split it.

### X-06 — Shared components are owned by the Tasks feature directory

Issue: Multiple components consumed by Enrollment live under `tasks/_components`.  
Severity: **P4 — LOW**  
Location: shared comments/attachments/people/menu/modal imports  
Affected Module: Tasks, Medicare, ACA  
Trigger: Maintain or relocate a component assumed to be Tasks-only.  
Expected: Ownership/location reflects real consumer scope.  
Actual: Files are shared by import but organized as feature-private.  
Root Cause: Components became shared incrementally.  
Impact: Discoverability/coupling debt; no current behavior bug.  
Fix: Move after Go-Live with import-only regression checks, unless ownership blocks a required fix.  
Regression Risk: Low–medium due to many import paths.  
Verification: Import search across Tasks/Enrollment.  
Status: **OPEN — non-blocking**

## Medicare vs ACA

- Same client/API/layout/permissions/comments/files/Overview.
- Program-specific visibility/sanitization is centralized enough and currently consistent.
- ACA has more live option sets and Caller/Responsible differences, increasing A-01/A-04/A-06 exposure.
- Caller default does **not** make Medicare uniquely “needs attention”; that earlier inference is closed.

## Tasks ↔ Config

- T-01 originates in saved Config layout data.
- C-04 causes full task refetch without column refresh.
- C-01/C-02 import can create task state that normal Tasks routes would reject or augment.
- X-01/X-02 define shared layout consistency and scope-boundary risks.

## Enrollment ↔ Config

- C-04/A-04/M-08: Config changes can invalidate an active form or restore stale options.
- C-05/C-08/A-06: stage/label/Consent semantics are not stable domain identity.
- C-01/C-02/C-03/C-06: import can partially apply, overwrite, bypass rules, and be approved blind.
- C-15: Config Required semantics for custom Enrollment fields are intentionally limited but not disclosed.

## Cross-Module Performance

- T-08 and M-07 are unbounded; C-09 adds full Config usage scans.
- C-04 multiplies full-corpus refreshes across sessions without delivering fresh config.
- No production-sized data/session benchmark or enforced safe bound was found.

## Cross-Module UI Consistency

- Core shell, drawers, table style, buttons, empty states, and primary Toasts are largely coherent.

### X-03 — Shared loading skeleton does not match the target table layouts

Issue: `(authed)/loading.tsx` renders dashboard-like cards for Tasks, Enrollment, and Config.  
Severity: **P3 — MEDIUM**  
Location: `src/app/(authed)/loading.tsx` and target route loading boundaries  
Affected Module: Tasks, Config, Medicare, ACA  
Trigger: Navigate during server loading.  
Expected: Skeleton approximates the incoming header/toolbar/table geometry.  
Actual: Dashboard-shaped blocks are replaced by tables, producing misleading layout shift.  
Root Cause: One generic authenticated loading boundary serves unrelated page shapes.  
Impact: Visible loading inconsistency; no state loss.  
Fix: Add route-level table skeletons or a shared table-shaped fallback.  
Regression Risk: Low.  
Verification: Static route/loading hierarchy comparison.  
Status: **OPEN**

### X-04 — Global dark preference conflicts with light-only module controls

Issue: Global CSS changes foreground in dark system mode while target modules hardcode light surfaces; Config's new-column input lacks explicit text/background.  
Severity: **P3 — MEDIUM**  
Location: `globals.css` dark media rule; Config new-column input; target module color classes  
Affected Module: Primarily Config, with cross-module theme risk  
Trigger: OS/browser `prefers-color-scheme: dark`.  
Expected: Readable contrast or an explicitly light application theme.  
Actual: At least the new-column label input can render near-light text on a light field.  
Root Cause: Global theme variables and hardcoded light module styles are mixed.  
Impact: Input readability/accessibility defect.  
Fix: Give affected controls explicit light text/background or remove unsupported global dark override until a real theme exists.  
Regression Risk: Low for targeted contrast fix.  
Verification: Static CSS cascade trace; visual browser check still required.  
Status: **OPEN**

### X-05 — Detail deep-link behavior is inconsistent

Issue: Opening a task from board/list may clear `?task=`, search pushes it, while Enrollment consistently pushes `?record=`.  
Severity: **P3 — MEDIUM**  
Location: Tasks drawer/search open handlers; Enrollment record open handler  
Affected Module: Tasks and Enrollment  
Trigger: Open detail from different entry points and use Back/share URL.  
Expected: Same detail navigation semantics across entry paths/modules.  
Actual: Some drawers are shareable/back-navigable and others are not.  
Root Cause: URL synchronization is implemented per entry path.  
Impact: Confusing navigation and broken sharing expectations; no data loss.  
Fix: Define one product contract and centralize URL updates per module.  
Regression Risk: Medium; browser Back/deep-link hydration must be tested.  
Verification: Static handler comparison.  
Status: **OPEN**

## Regression Risks

| Change area | Required regression coverage |
| --- | --- |
| T-01 layout hydration | Saved/no layout, localStorage fallback, archived/default-hidden columns, one GET only |
| Task/Enrollment mutation ownership | A→B→C→D, 403/409, two users, network reject, canonical version, no whole-row collateral rollback |
| Atomic domain writes/import | Failure after each statement, retry/idempotency, history/activity/notification consistency |
| Live Config/options | Scope revision, open forms, removed selected value, preserve unrelated typing, no full-record storm |
| Layout persistence | Three scopes, reordered PUTs, admin reset versus stale tab, invalid scope |
| Pagination/search | Permission parity, comment/FUB/file results, export/deep links, realtime page invalidation |
| Permissions | Manager, creator, Caller, Responsible/Assignee, read-only task worker, every shared control |

---

# Final Go-Live Status

Status: **NOT READY**

## P0

T-01 implementation is committed in `cdd06de`; saved-layout browser request-count verification is still a release gate. No other code-level P0 was found.

## P1

Remaining P1 gates after implementation:

- **Verification pending:** T-03 (`4f59280`) now makes generic PATCH atomic, but special-action routes and deployed-schema/failure-injection proof remain; M-03 (`f95ebbe`) still requires transactional or durable idempotent repair semantics.
- **Conditional/open:** C-04/C-05 require an explicit Config freeze or a safe live-config implementation.
- **Verification pending:** T-02 (`81e8562`), M-01 (`d608d9c`), M-02 (`fc00dbe`), and A-01 (`2c7b96e`).
- C-01/C-02/C-03 are no longer reachable because Import was removed; reconciliation/direct-route/export evidence is still required before closing them.

## P2

Active P2 findings remain. T-04 (`16ad882`), T-05 (`82885a3`), T-06 (`ff87eaf`), T-07 (`f9c1643`), T-08 truncation containment (`a52156e`), and T-09 subscription stabilization (`036984e`) are implemented pending browser/route evidence; T-08 server-window/render work and other Tasks/Enrollment/Config/ACA/cross-module P2s remain open or require production-volume/operational measurements.

## P3

**17 issue groups:** T-10 through T-14; M-13 through M-17; C-13 through C-16; X-03 through X-05.

## P4

**4 issue groups:** T-15, M-18, C-17, X-06.

## Critical Bugs

- T-01 browser proof is still required for the saved-layout hydration blocker.
- Enrollment canonical writes can still commit before required related work is repaired (M-03); Tasks core state/history now use the atomic command but deployment/failure-injection evidence is pending (T-03).
- Live Config/workflow changes can leave active clients stale or invalidate stage state (C-04/C-05).
- Import runtime paths are removed; historical-request reconciliation and Export regression evidence remain.

## Critical Fixes

- Import removal/Export preservation: `4fdac30`
- Tasks layout hydration: `cdd06de`
- Tasks serialized canonical PATCH/rebase: `81e8562`
- Enrollment permission affordances: `d608d9c`
- Enrollment serialized PATCH/rebase: `fc00dbe`
- ACA/Medicare stakeholder default visibility: `2c7b96e`
- Tasks atomic canonical/history command: `4f59280` (deployment/failure-injection gate remains)
- Tasks truncation containment: `a52156e` (server-window/volume gate remains)
- Tasks realtime subscription lifecycle: `036984e` (browser WS/refetch gate remains)
- Post-commit warning truthfulness: `e219c91`, `f95ebbe` (partial gates remain)

## Performance Risks

T-01 dominates immediate risk. T-08/M-07/C-09 and C-04 then compound with data/session growth. No production benchmark was available, so volume-dependent P2 acceptance requires measured row, payload, render, and concurrent-session thresholds.

## Race Conditions

Confirmed static interleavings include client-generated task version conflicts, whole-row rollback, incomplete per-record pending tracking, reordered layout/column/option/detail/Overview requests, stale import overwrite, and active-form Config invalidation. Current unit tests do not exercise these orders.

## UI/UX Risks

Read-only controls look editable, successful ACA creation looks lost, advertised search fields are missing, stale options look empty, and Config errors look like success. Core visual language is consistent; behavior/error semantics are not.

## Duplicate Logic

Config import is the most dangerous duplicate. Task assignment and workflow identity also have multiple implementations. Do not spend the release week consolidating cosmetic duplication; fix concrete invariants first.

## Regression Risks

High. Shared client/routes mean a local-looking change can affect Tasks, ACA, Medicare, Config, history, notifications, imports, layouts, and realtime. Use the regression matrix above before reducing severity.

## Remaining Risks

- Production schema/RPC/table compatibility is unverified. M-12 becomes a P0 deployment problem if required objects are absent.
- No authenticated browser/database failure-injection or slow/reordered network harness was available.
- No production-sized dataset/session benchmark was run.
- Broad task-worker access to all Enrollment records/comments/files requires explicit product/security sign-off.
- Owner selected permanent Import feature removal; C-01/C-02/C-03/C-06 close only after code-surface removal, existing-request reconciliation, direct-route verification, and Export regression evidence are complete.
- C-04/C-05 can be contained temporarily only by a documented Config freeze, forced reload after changes, and named operational owner.

## Final Execution Plan

This section supersedes earlier Recommended Actions in both review documents. It is the active release execution plan and evidence log.

### Plan rules

1. **No READY state with a reachable P0/P1.** A release control counts only when it is technically enforced, verified, owned, and documented with an expiry/removal condition.
2. **Do not use the Claude “seven-item / 2–3 day” list as the complete commitment.** It omits T-03/M-03 and full regression. Calendar estimates require named engineers, staging/DB access, and a short implementation spike.
3. **Separate removal, containment, and closure.** Import findings close only after the feature code surface is removed and verified. A Config freeze only contains Config findings; it does not close them.
4. **Fix local invariants before architectural work.** No react-query/SWR migration, broad component relocation, or virtualization rewrite during blocker remediation.
5. **Import scope is decided, not optional:** remove Import completely; Export stays enabled. Any future Import capability is a new product/security project, not a re-enable switch.

### Implementation log

| Date | Fix | Commit | Verification / remaining work |
| --- | --- | --- | --- |
| 2026-08-08 | **Import removal — Phase 0A code-surface portion.** Removed the Config Import Review tab, Tasks/ACA Import UI and dialogs, Import submit/review/approve/reject API routes, Import classifier/types/tests, and spreadsheet read path. Renamed the shared authorization helper to `canActorExport`; Tasks/ACA/Medicare Export routes and export tests remain in place. Historical `import_request`/staging tables were intentionally left read-only in the schema. | `4fdac30` | `npm run typecheck` PASS after regenerating Next route types; targeted Export tests PASS (2 files / 2 tests). Remaining Phase 0A evidence: production reconciliation of existing pending/processing/failed rows, direct old-URL 404 check, and Tasks/ACA/Medicare Export staging smoke tests. |
| 2026-08-08 | **T-01 — Tasks layout hydration loop.** Added a per-board hydration guard and derived fallback sets from the initial server columns so the layout GET/effect cannot restart when the effect updates its own layout state. | `cdd06de` | `npm run typecheck` PASS; targeted ESLint PASS for `TaskBoardClient.tsx`. Browser request-count/stable-render verification remains required before marking T-01 closed. |
| 2026-08-08 | **T-02 — Tasks optimistic mutation race.** Removed client-generated `updated_at`, added per-task serialized PATCH queues with immediate optimistic rendering, rebased queued patches after each canonical response, and fetched the canonical row on 409 instead of restoring a stale full-row snapshot. | `81e8562` | `npm run typecheck` PASS; targeted ESLint PASS for `TaskBoardClient.tsx`. Slow-network/two-user browser conflict verification remains required before marking T-02 closed. |
| 2026-08-08 | **M-01 — Enrollment mutation affordance mismatch.** Added the shared `canEditRecord` contract to row and drawer stage, ownership, option, consent, QC, date, text, custom-field, reopen, and overview assignment controls. Read-only workers now get disabled/hidden controls while New Enrollment remains editable. | `d608d9c` | `npm run typecheck` PASS; targeted ESLint PASS for EnrollmentClient/EnrollmentOverview. Authenticated read-only ACA + Medicare browser checks must still confirm zero PATCH/DELETE requests. |
| 2026-08-08 | **M-02 — Enrollment overlapping PATCH race.** Replaced boolean pending tracking with counted pending writes, added per-record serialized PATCH queues with immediate optimistic rendering, rebased later edits after canonical responses, and fetched the canonical row on 409 instead of restoring a stale whole-record snapshot. Create/archive/refetch pending tracking now shares the counter. | `fc00dbe` | `npm run typecheck` PASS; targeted ESLint PASS; Enrollment + table-config tests PASS (11 files / 70 tests). Slow-network/two-user conflict and deferred-refetch browser verification remains required. |
| 2026-08-08 | **A-01 — ACA new-record visibility.** Added an explicit “mine” predicate to the non-manager default view: creator, Caller, or Responsible records remain visible. The UI still shows the selected Responsible filter, while changing that filter or clearing filters returns to the explicit user-selected behavior. | `2c7b96e` | `npm run typecheck` PASS; targeted ESLint PASS. Product/browser check remains required for ACA create → close drawer → default list and cleared-filter behavior; Medicare uses the same stakeholder predicate for parity. |
| 2026-08-08 | **T-03 — committed task mutation truthfulness (partial).** Canonical task PATCHes no longer return retryable 5xx solely because assignee/history/activity/notification/broadcast/assignee-reload side effects fail after commit. Results are checked with `Promise.allSettled`, logged, and returned as `warnings`; the client can keep the committed row. | `e219c91` | `npm run typecheck` PASS; targeted ESLint PASS. T-03 remains **OPEN/P1** until canonical task + assignee junction + required history are transactionally atomic or have a durable idempotent repair queue; this commit only removes false-failure/retry behavior. |
| 2026-08-08 | **T-03 — atomic task mutation command.** Added `patch_task_atomic` to the Supabase schema and routed generic task PATCH through it. The task row, assignee junction/cycles, stage/overdue history, activity rows, and last-activity token now commit or roll back together; notifications and realtime remain non-authoritative warnings. | `4f59280` | `npm run typecheck` PASS; targeted ESLint PASS; Tasks tests PASS (21 files / 239 tests); PostgreSQL 16 schema replay PASS; local RPC commit/rollback smoke checks PASS. Deployment of the function, authenticated failure-injection, and broader route regression remain required before closing T-03. |
| 2026-08-08 | **T-04 — special-action optimistic concurrency.** Added `expected_updated_at` to reopen, overdue-unlock, assignee add/remove, and archive requests; moved the core action writes through the atomic task command or guarded version predicate; clients send the token and reconcile canonical state on 409 instead of restoring stale intent. Post-commit notification/rotation/broadcast failures are returned as warnings. | `16ad882` | `npm run typecheck` PASS; targeted ESLint PASS for routes and `TaskBoardClient`; Tasks tests PASS (21 files / 239 tests); PostgreSQL 16 schema replay and stale-token RPC smoke PASS. Authenticated two-tab action/archive verification remains required. |
| 2026-08-08 | **T-05 — visible search pagination and file hits.** Replaced the fixed pre-authorization candidate limit with paginated visibility filtering (up to a bounded 1,000-row scan per result type), preserving the six-result groups after scope resolution. Added file results to keyboard navigation and the dropdown, including task/comment deep links. | `82885a3` | `npm run typecheck` PASS; targeted ESLint PASS; Tasks/search helper tests PASS (21 files / 239 tests). Staging verification remains for common terms with >40 hidden matches, permission parity, and attachment-only results. |
| 2026-08-08 | **T-06 — task detail metadata reconciliation.** Added a shared canonical task-list metadata loader (RPC with the existing schema fallback), returned counts/latest activity from task detail, and pushed confirmed metadata into the board row after comment/file reloads. Equal metadata is ignored so opening a drawer does not create a synthetic local write or refetch race. | `ff87eaf` | `npm run typecheck` PASS; targeted ESLint PASS; Tasks tests PASS (21 files / 240 tests), including the metadata RPC contract test. Authenticated comment/file mutation and slow-refetch browser verification remains required. |
| 2026-08-08 | **T-08 — Tasks response truncation containment.** Added exact row counts to the Tasks query (including the legacy-column fallback), fail-closed detection when PostgREST returns fewer rows than the count, a structured 503 for board reloads, and visible refetch error handling. Export now also refuses to operate on an incomplete source set. | `a52156e` | `npm run typecheck` PASS; targeted ESLint PASS; Tasks tests PASS (21 files / 242 tests), including complete/countless and truncated-response cases. Production volume, API/SSR overflow behavior, server-window pagination, and render benchmark remain required. |
| 2026-08-08 | **T-09 — Tasks realtime subscription churn.** Stabilized the Tasks channel effect so view/date-dependent loaders are read through refs and the channel is not torn down/rejoined when the user changes view or Overview date range. Category reload remains a stable callback and refetch continues through the existing ref. | `036984e` | `npm run typecheck` PASS; targeted ESLint PASS for `TaskBoardClient.tsx`; Tasks tests PASS (21 files / 242 tests). Browser WS join count, two-tab broadcast delivery, and Overview refresh behavior remain required. |
| 2026-08-08 | **M-03 — committed enrollment mutation truthfulness (partial).** Enrollment create/update now check audit/history results, contain notification/recipient/broadcast/reload failures, return the committed record with `warnings`, and log the repair signal instead of falsely returning a retryable 5xx. | `f95ebbe` | `npm run typecheck` PASS; targeted ESLint PASS for both enrollment mutation routes. M-03 remains **OPEN/P1** until canonical record plus required audit is transactional or backed by durable idempotent repair; failure-injection evidence is still required. |
| 2026-08-08 | **M-04 — archive failure rollback.** Failed Enrollment archive requests now restore only the archived row at its prior position, preserving concurrent changes to other records instead of replacing the entire collection snapshot. | `802493a` | `npm run typecheck` PASS; targeted ESLint PASS. A two-tab archive-failure/realtime browser scenario remains useful regression evidence. |
| 2026-08-08 | **M-09 — Enrollment no-op response.** PATCH requests that produce no persisted field change now reload and return the canonical record with comment/attachment stats instead of manufacturing zero counts. | `373a4dc` | `npm run typecheck` PASS; targeted ESLint PASS for the Enrollment PATCH route. Route-level no-op stats test remains to be added. |
| 2026-08-08 | **T-07 — Tasks archive failure rollback.** Failed archive requests now restore only the target task at its prior position, preserving concurrent changes to other tasks instead of restoring a collection-wide snapshot. | `f9c1643` | `npm run typecheck` PASS; targeted ESLint PASS for `TaskBoardClient.tsx`. Two-tab archive failure/realtime regression remains to be exercised. |

### Phase 0 — Remove Import, enforce Config control, and run preflight

These tasks can start in parallel and must produce evidence, not verbal confirmation.

| Work item | Owner | Required action | Exit evidence |
| --- | --- | --- | --- |
| **0A — Remove Import feature — SELECTED** | Backend + Frontend + Product/Ops | Inventory pending/processing/failed requests, quarantine them, and inspect whether rows partially applied. Remove Import submit/review UI, API routes, application helpers/types/tests, navigation/copy, and every submission/approval/reject/retry/resume path. Keep historical DB records read-only for audit; do not drop tables/data in the Go-Live patch. Leave Export routes/UI unchanged. | Repository search finds no reachable Import UI/runtime route; direct old Import URLs return 404/removed; no request can continue; existing requests have reconciliation records; Tasks/ACA/Medicare Export regression passes; deletion diff is reviewed for accidental Export/shared-code removal. |
| **0B — Global Config freeze** | Backend + Config owner | Block global column/option/stage/agent/assistant/import mutations through permission or server guard. Preserve ordinary reads and user layout only if explicitly safe. Any approved exception requires a maintenance window and forced reload/re-auth of every active consumer. | Mutation matrix returns the planned denial; no “F5 when convenient” dependency; exception procedure and named owner recorded. |
| **0C — Production schema preflight (M-12)** | DB owner | Verify at minimum `enrollment_records.description`, `enrollment_records.custom_values`, `tasks.custom_values`, `user_table_layout`, `task_list_metadata`, and current required history/notification tables/constraints. Record schema version/check output. | Signed query output attached to release ticket. Any missing object keeps status NOT READY and triggers migration/fail-closed work. |
| **0D — Scheduler ownership (T-14)** | DevOps | Confirm exactly one active supported scheduler for `check-overdue`, hosting-plan cadence support, last successful runs, idempotency, and alerting for missed runs. A monthly manual reminder is not an adequate 15-minute-job control. | Scheduler config, recent logs, one-owner runbook, missed-run alert, and no duplicate schedule. |
| **0E — Production volume preflight** | Backend + QA | Capture active Tasks/ACA/Medicare counts, largest list payload, comment-search payload, PostgREST row cap, and expected concurrent open tabs. | Threshold table determines whether T-08/M-07/C-09 remain accepted P2 or become release blockers. |

### Phase 1 — Close the immediate P0

| Order | Finding | Implementation objective | Required verification |
| ---: | --- | --- | --- |
| 1 | **T-01** | Make Tasks layout hydration one-shot/stable without changing saved-layout semantics. | Saved layout: exactly one GET and stable render. No layout: fallback remains correct. Toggle/refresh persists. Cover archived/default-hidden columns. Add a component/browser request-count regression test; a helper reference test alone is not sufficient. |

Exit criterion: T-01 is closed before performance measurements or live Config hydration work. Other independent fixes may be developed in parallel, but T-02/T-01 combined browser verification uses this order.

### Phase 2 — Close deterministic client/state correctness blockers

| Finding | Owner | Minimum complete fix | Required verification |
| --- | --- | --- | --- |
| **T-02** | Frontend + API owner | Remove client ownership of `updated_at`; serialize/rebase per task; on real 409 accept/fetch canonical row; never protect a failed rollback snapshot. | One user A→B→C on Slow 3G persists both changes; two users still produce a legitimate 409; no A→B→A flicker; list/drawer/Kanban agree. |
| **M-01** | Enrollment frontend | Apply one `canEdit`/disabled contract to every record mutation control, while New Enrollment remains editable. | Read-only worker sends **zero** mutation requests; manager/creator/Caller/Responsible/Assignee behavior matches server policy in ACA and Medicare. |
| **M-02** | Enrollment frontend + API owner | Serialize/rebase per record and reconcile canonical state on conflict. A counter may replace Set for refetch tracking, but is not the complete fix. | Two rapid field/QC edits cannot erase a confirmed value; genuine cross-user conflict resolves to canonical row; deferred refetch flushes only after all writes settle. |
| **A-01** | Product + Enrollment frontend | Decide the exact “My records” predicate (creator/Caller/Responsible) or require/assign Responsible, then make default filter and create behavior agree. | Non-manager creates without Responsible, closes drawer, and still finds the record; manager/global and cleared-filter behavior remain correct. |

Phase 2 can run in parallel after owners/product decisions are available. Do not declare M-02 fixed from a Set→counter-only patch.

### Phase 3 — Close core server consistency blockers

T-03 and M-03 cannot be removed from the release gate by Config/import controls because they sit on normal core mutations.

| Finding | Owner | Required design decision | Exit criteria |
| --- | --- | --- | --- |
| **T-03** | Backend/DB | Deploy and verify `patch_task_atomic` for generic task PATCHes. Keep notification/broadcast failure non-authoritative and observable. Audit special-action routes separately for their own transaction boundaries. | Failure injection after every atomic statement proves full rollback; retries are OCC/idempotent; history/assignment/SLA invariants hold; deployed RPC and route regression pass. |
| **M-03** | Backend/DB | Make Enrollment canonical record plus required stage/activity audit atomic; explicitly inspect every Supabase result. Make notification delivery idempotent/non-authoritative for the mutation response. | Create/update failure injection cannot return failure after hidden canonical commit or success with missing required audit; duplicate retry is prevented; both programs pass. |

Until the RPC is deployed and failure-injection evidence exists, status remains **NOT READY**. “No incident observed yet” is not evidence that a deterministic failure boundary is safe.

### Phase 4 — Resolve conditional Config/import blockers

#### Selected Import branch — permanent removal; Export only

- Complete Phase 0A as a code-surface deletion, not a hidden tab or feature flag.
- C-01/C-02/C-03/C-06 close when no Import runtime path remains and existing requests/data have a signed reconciliation record.
- Export remains available in Tasks, ACA, and Medicare. Import removal must not delete shared export helpers, endpoints, buttons, column selection, or spreadsheet dependencies still used by Export.
- Preserve historical `import_request`/staging data read-only through the release for audit and rollback analysis. A later table/data deletion requires retention approval, backup, and a dedicated migration.
- Any future request for Import starts as a new reviewed feature with transactional/idempotent application, target OCC, domain-equivalent rules, row-level review, durable progress, and failure/resume testing.

#### Config branch — decision still required: freeze or fix

- **If freeze is selected:** keep Phase 0B enforcement active. C-04/C-05 remain open but unreachable. Do not allow ad hoc after-hours changes; an exception requires stopping affected operations, applying the change, forcing every active client to reload/re-auth, verifying state, and then resuming.
- **If Config must remain live instead:** after T-01, implement scoped revisioned invalidation with active-form-safe reconciliation for C-04, enforce stage minimum/in-use migration rules for C-05, and verify no record-refetch storm or user-input reset.

### Phase 5 — P2 triage and explicit acceptance

Before Go-Live, every P2 needs one of: fixed and verified; unreachable by a Phase 0 control; or an owner-signed acceptance containing impact, likelihood, monitoring, workaround, and expiry date.

Prioritize low-risk/high-value P2 work after blockers:

1. M-04 archive catch and row-scoped rollback.
2. M-09 canonical no-op stats response.
3. C-10 per-column ordering/reconciliation.
4. A-06 disable/audit unsupported Consent Required.
5. T-09 realtime subscription stability.
6. X-01 layout serialization/versioning across all scopes.

Volume-dependent T-08/M-07/C-09 cannot be accepted without Phase 0E measurements; T-08 now has truncation detection but still lacks server-window/render evidence.

### Phase 6 — Verification matrix

#### Automated

- Add component/effect coverage for T-01, T-02, M-01, M-02, and A-01.
- Add route/database failure-injection coverage for T-03, M-03, C-01/C-03, invalid program/scope, archive rejection, and stage invariants.
- Run `npm run typecheck`, `npm run lint`, `npm run test:run`, and `npm run build` on the final release commit.

#### Staging scenarios

- Rapid A→B→C→D changes, double-click/double-submit, Slow 3G, reordered responses, navigation/unmount while pending, refresh while pending, and two-user conflicts.
- Tasks List/Kanban/drawer/search/archive/comment/file plus saved/unsaved layouts.
- ACA and Medicare Create/list/drawer/QC/reopen/archive/comment/file/Overview, including read-only users and active Config-option invalidation.
- Verify old Import routes/UI/runtime helpers are absent and historical requests cannot execute, while Tasks/ACA/Medicare Export still succeeds. Verify Config freeze or full live-feature behavior according to the selected Config branch.

#### Operations/data

- Attach schema preflight, scheduler evidence, feature-gate/config-freeze evidence, volume measurements, and P2 acceptance table to the release ticket.
- Prepare rollback criteria for request-rate spike, 403/409 surge, mutation 5xx, stale-config submission 400, scheduler miss, and unexpected import/config writes.

### Phase 7 — Final Go/No-Go gate

The release approver may change status only when all are true:

- P0 = 0.
- Every core P1 (T-02, T-03, M-01, M-02, M-03, A-01) is fixed and verified.
- Import feature removal is complete, C-01/C-02/C-03/C-06 are closed by removal, Export regression passes, and Config P1 paths are either fixed or technically unreachable under the Config branch chosen before release.
- M-12 schema and T-14 scheduler preflights pass.
- Full automated baseline and four-module staging matrix pass on the release commit.
- Every remaining P2 has an owner-signed acceptance or is unreachable.
- Rollback/monitoring ownership is named and evidence is attached.

Until Phase 7 is signed, status remains **NOT READY**.

### Dependency and parallelization map

```text
Phase 0A/0B/0C/0D/0E ───────────────────────────────────────────────┐
                                                                  │
T-01 ──→ T-02 verification ───────────────────────────────────────┤
                                                                  ├─→ Phase 6 full verification ─→ Phase 7 Go/No-Go
M-01 ─┐                                                          │
M-02 ─┼─→ shared ACA + Medicare regression ───────────────────────┤
A-01 ─┘                                                          │
                                                                  │
T-03 ─┐                                                          │
M-03 ─┴─→ failure-injection + idempotency evidence ───────────────┤
                                                                  │
If Config stays live: T-01 ─→ C-04/C-05 ──────────────────────────┘
Import removed / Config frozen: Phase 0 evidence supplies the gate ──┘
```

Relative sizing only: T-01 is small; T-02/M-01/A-01 are small-to-medium with product/regression work; M-02 is medium-to-high; T-03/M-03 and live-Config enablement are high-risk. Import removal is medium-risk because Export and spreadsheet dependencies must be preserved, even though the deleted feature itself is no longer repaired. No calendar promise is made without staffing and a staging spike.

## Verification Summary

Verification recorded across the execution commits through `036984e`:

- `npm run typecheck`: **PASS after T-09**.
- Targeted ESLint for the changed Tasks/detail/query routes and components, including `TaskBoardClient.tsx`: **PASS**.
- `npm run test:run -- src/lib/tasks`: **PASS — 21 files / 242 tests**.
- PostgreSQL 16 replay of `supabase/schema.sql`: **PASS**; atomic commit/rollback and stale-token RPC smoke checks passed.
- Baseline full `npm run lint`, `npm run test:run` (50 files / 431 tests), and `npm run build` passed on `df561ef` before this execution batch; they must be rerun after the batch.
- These results do not prove authenticated browser behavior, deployed-schema parity, route failure injection, or slow/reordered network behavior. A final full-suite/build run remains required.

## Overall Risk

**CRITICAL.** Client P0/P1 fixes are committed but browser/deployed-schema verification is pending; M-03 still needs transactional or durable repair semantics, T-03 needs failure-injection proof, and C-04/C-05 still need a Config decision.

## Go-Live Recommendation

**DO NOT GO LIVE.** Do not use the earlier shortcut “fix five items and mark READY WITH RISKS.” Reassess only after T-01 and all P1 paths are fixed or enforceably disabled, production schema is verified, deterministic regression coverage passes, and volume-dependent P2 risks receive explicit acceptance.

Final Recommendation: **NOT READY**.
