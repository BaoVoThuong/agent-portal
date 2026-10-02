# UI Action Responsiveness — Checklist and Action Plan

**Date:** 2026-10-02
**Scope:** Task, Lead, Enrollment, Customer Registration, Provider, Config, Account, Settings, Time Off and Notifications
**Goal:** Make user actions feel immediate without weakening server authority, data consistency or authorization.

## 1. Problem statement

The product has no consistent contract for write actions. Some handlers update local state immediately, while others wait for an API response, attachment uploads, a full list reload or `router.refresh()` before showing the result.

This creates four user-facing problems:

- The same action feels fast in one module and blocked in another.
- Dialogs and entire tables are locked by broad `saving` or `loading` flags.
- Creating an item is coupled to attachment uploads and secondary refreshes.
- Errors and conflicts are discovered late because the UI has no explicit pending, rollback or conflict state.

The target behavior is:

```text
user intent
→ immediate local transition
→ per-resource pending state
→ server mutation
→ canonical response reconciliation
→ rollback or conflict handling on failure
→ background refresh when needed
```

This plan does not make every action optimistic. Security-sensitive, bulk and server-computed operations remain server-confirmed with clear progress feedback.

## 2. Rules of engagement

- Backend authorization and validation remain authoritative.
- Never fabricate a server-computed assignment, approval, balance or distribution result.
- Every optimistic mutation must have a rollback path.
- Use `expected_updated_at` or an equivalent version for conflict detection.
- Use a client request id/idempotency key for create and retryable mutations.
- Pending state must be scoped to the row, field or operation; do not block unrelated UI.
- A successful mutation should use the server response as canonical data.
- Background refresh must never replace newer local pending changes.
- Do not change the untracked legacy plan file `docs/superpowers/plans/2026-09-18-task-board-latency.md`.

## 3. Priority matrix

| Priority | Area | Action | Current code path | Target behavior |
|---|---|---|---|---|
| P0 | Task | Create task and upload attachments | `NewTaskDialog.tsx`, `TaskBoardClient.createTask` | Create row/dialog result immediately after entity creation; upload files in background |
| P0 | Task | Edit/delete comment | `CommentThread.tsx` | Optimistic row edit/remove with rollback; refresh in background |
| P0 | Lead | Create lead and attachments | `LeadAddDialog.tsx` | Same create/upload split as tasks |
| P0 | Lead | Add interaction/comment | `LeadDetailDrawer.tsx` | Add pending activity/comment immediately |
| P0 | Enrollment | Create enrollment and attachments | `EnrollmentClient.createRecord`, new-record submit | Add pending record after create; attachment work is independent |
| P1 | Lead | Single and batch assign | `LeadsClient.assignLead`, `assignSelected` | Optimistic assignee/status; rollback and canonical reconcile |
| P1 | Enrollment | Assign responsible and queue toggle | `AcaAssignPicker`, `AcaOverviewDashboard` | Optimistic field/toggle updates with rollback |
| P1 | Registration | Health and P&C update/delete/inline edit | `EntryGrid`, `PcEntryGrid` | Row-level pending state, rollback, no full-table wait |
| P1 | Provider | Inline provider patch | `ProviderListClient.patchProvider` | Optimistic cell patch and rollback |
| P1 | Task | Overview assignment refresh | `TaskBoardClient.assignOverviewTask` | Release control after canonical mutation; reload overview in background |
| P1 | Notifications | Mark read/mark all read | `NotificationBell` | Optimistic badge/list update and rollback |
| P2 | Task | Attachment add/delete | `AttachmentPanel` | Pending attachment/removal state, background reload |
| P2 | Config | Category/value/stage/SLA toggles | `ConfigClient`, `ConfigSlaSection` | Optimistic labels, colors and switches |
| P2 | Account | Account/role CRUD | `AccountManagerClient`, `RoleManagerClient` | Local list update after response; background refresh instead of blocking full page |
| P2 | Settings | Profile/avatar | `SettingsClient` | Local preview/update with rollback; password remains server-confirmed |
| P2 | Time Off | Request/decision/holiday operations | `TimeOffClient` | Pending row/calendar state; do not fake balances or approvals |

## 4. Phase checklist

### Phase 0 — Baseline and instrumentation

- [ ] Freeze the current mutation behavior with screenshots and short recordings for Task, Lead and Enrollment.
- [ ] Record p50/p95 time from click to visible UI change for create, comment, assign, edit and delete.
- [ ] Add a shared mutation event shape: module, action, entity id, request id, started at, completed at, result.
- [ ] Add error/conflict telemetry without logging customer content or attachments.
- [ ] Confirm current API responses include canonical row data where possible.
- [ ] Define the test matrix for success, validation error, network error, 409 conflict, duplicate submit and refresh during pending work.

**Exit criteria:** baseline metrics exist and every P0 action has a named API response and rollback strategy.

### Phase 1 — Shared mutation primitives

- [ ] Create a small client utility or hook for optimistic mutations.
- [ ] Support `applyOptimistic`, `commit`, `rollback`, `reconcile`, `pendingKey` and `onConflict`.
- [ ] Keep pending overlays separate from fetched server data.
- [ ] Prevent duplicate submit while allowing unrelated controls to work.
- [ ] Add request id/idempotency support for creates and retries.
- [ ] Add a consistent inline pending indicator and error retry affordance.

**Exit criteria:** one non-critical module uses the primitive and passes rollback/conflict tests.

### Phase 2 — Task and comments

- [ ] Split task creation from attachment upload.
- [ ] Close the create dialog after the task is accepted by the API.
- [ ] Insert the returned task row immediately; use a temporary pending row only until an id exists.
- [ ] Upload attachments independently with per-file progress and retry.
- [ ] Optimistically edit/delete task comments.
- [ ] Keep text-only comment posting behavior unchanged because it is already optimistic.
- [ ] Reconcile comment updates using server timestamps/version fields.
- [ ] Move overview refreshes to background after a successful assignment mutation.

**Exit criteria:** task create, comment edit/delete and assignment show a visible result without waiting for a full reload.

### Phase 3 — Leads

- [ ] Split lead creation from attachment upload.
- [ ] Add optimistic activity/comment rows in `LeadDetailDrawer`.
- [ ] Optimistically assign one lead.
- [ ] Optimistically update selected rows for batch assign.
- [ ] Preserve server authority for distribute-pool round-robin results.
- [ ] Show an operation banner for distribute/import instead of freezing the whole dialog.

**Exit criteria:** lead create, comment, interaction and assign have rollback and retry behavior.

### Phase 4 — Enrollment

- [ ] Split enrollment creation from file upload.
- [ ] Guard pending creates from being removed by a background refresh.
- [ ] Optimistically update responsible assignment.
- [ ] Optimistically update queue membership.
- [ ] Preserve `expected_updated_at` conflict handling.
- [ ] Verify stage/visibility/notification side effects still use canonical server state.

**Exit criteria:** a create followed immediately by edit or refresh does not lose the record; assignment and queue actions reconcile correctly.

### Phase 5 — Registration and Provider

- [ ] Extract shared row mutation logic for Health and P&C grids.
- [ ] Add row-level pending state for delete/update/inline edit.
- [ ] Roll back AG Grid cell changes on failed PATCH.
- [ ] Optimistically patch provider cells and reconcile returned provider data.
- [ ] Keep imports server-confirmed with progress, retry and failure summary.

**Exit criteria:** one-row mutations do not trigger a blocking full-table spinner or hide unrelated edits.

### Phase 6 — Config, Account, Settings and Notifications

- [ ] Make category/value/stage/SLA switches optimistic with rollback.
- [ ] Replace unnecessary `router.refresh()` calls with local list updates plus background refresh.
- [ ] Keep password, role authorization and destructive account operations server-confirmed.
- [ ] Make profile/avatar display update immediately with rollback.
- [ ] Make mark-read and mark-all-read optimistic.
- [ ] Verify notification visibility still enforces authorization after local state changes.

**Exit criteria:** no small toggle or label edit blocks an entire configuration section.

### Phase 7 — Time Off and exceptional operations

- [ ] Add pending calendar/request state without faking approval or balance results.
- [ ] Keep balance adjustments and approvals server-confirmed.
- [ ] Add progress/cancel/retry to imports, exports, report generation and long-running searches.
- [ ] Review attachment, AI and provider finder operations for clear progress states.

**Exit criteria:** all intentionally server-confirmed actions explain their progress and final result.

### Phase 8 — Cleanup and enforcement

- [ ] Search for remaining mutation handlers that update state only after `await fetch`.
- [ ] Search for `router.refresh()` and full-list reloads after single-row actions.
- [ ] Remove obsolete global `saving/loading` locks.
- [ ] Remove duplicate mutation helpers in Health/P&C and other modules.
- [ ] Add a code review checklist requiring optimistic/rollback classification for every new write action.
- [ ] Document exceptions where optimistic UI is unsafe.

**Exit criteria:** every write action is classified as optimistic, hybrid or server-confirmed.

## 5. Test checklist

### Unit tests

- [ ] Optimistic state is applied before the request resolves.
- [ ] Successful response replaces optimistic data with canonical data.
- [ ] Validation/network failure restores the previous state.
- [ ] 409/version conflict keeps server data and shows a conflict state.
- [ ] Duplicate click does not create duplicate records.
- [ ] Retry uses the same idempotency key where required.

### Integration tests

- [ ] Create task then immediately reload.
- [ ] Create lead/enrollment then immediately edit.
- [ ] Create entity with slow attachment upload.
- [ ] Edit/delete comment while another user changes the parent record.
- [ ] Assign one item while list refreshes in the background.
- [ ] Batch assign with a partial failure.
- [ ] Queue toggle with a failed PATCH.
- [ ] Health and P&C inline edit rollback.
- [ ] Notification mark-read rollback after a failed request.

### E2E acceptance checks

- [ ] Visible UI change starts within one render after click for optimistic actions.
- [ ] No unrelated row or control becomes disabled.
- [ ] Error state is visible and retryable.
- [ ] Refresh never removes a pending item that has already been accepted by the server.
- [ ] Authorization and data visibility remain backend-enforced.
- [ ] Attachment progress is independent from entity creation.

## 6. Rollback plan

- Ship each phase behind a module-level feature flag where practical.
- Keep the existing API-first path available for immediate rollback.
- Roll back a module if duplicate records, stale overwrites, lost creates or authorization regressions appear.
- Preserve server-side audit records; rollback only client behavior and feature flags.
- Compare mutation error rate, conflict rate and time-to-visible-result before and after rollout.

## 7. Definition of done

- [ ] Every write action in the audited modules has an explicit classification: optimistic, hybrid or server-confirmed.
- [ ] Optimistic actions have rollback, conflict handling and canonical reconciliation.
- [ ] Entity creation is no longer blocked by secondary attachment uploads.
- [ ] Single-row changes do not require full-table reloads.
- [ ] Global loading flags no longer block unrelated controls.
- [ ] Backend authorization remains the final authority.
- [ ] Tests cover success, failure, retry, conflict, refresh and duplicate-submit scenarios.
- [ ] Baseline metrics show lower click-to-visible latency without increased mutation errors.
