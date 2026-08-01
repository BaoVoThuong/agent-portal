# Health Task / Enrollment / Config Code Review

Date: 2026-08-01

Scope reviewed:

- Health Customer Service: `/tasks`
- Health ACA Enrollment: `/enrollment?program=aca`
- Health Medicare Enrollment: `/enrollment?program=medicare`
- Health Table Configuration: `/config`

Main files traced:

- `src/app/(authed)/_components/Sidebar.tsx`
- `src/app/(authed)/tasks/page.tsx`
- `src/app/(authed)/tasks/_components/TaskBoardClient.tsx`
- `src/app/(authed)/enrollment/page.tsx`
- `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`
- `src/app/(authed)/config/page.tsx`
- `src/app/(authed)/config/_components/ConfigClient.tsx`
- `src/app/api/tasks/**`
- `src/app/api/enrollment/**`
- `src/app/api/config/**`
- `src/app/api/admin/task-agents/route.ts`
- `src/lib/tasks/**`
- `src/lib/enrollment/**`
- `src/lib/table-config/**`
- `src/lib/rbac/routes.ts`
- `supabase/schema.sql`

Baseline checks:

- `npm run typecheck`: pass.
- `npm run test:run`: pass, 48 files / 403 tests.
- `npm run lint`: pass with 1 warning:
  - `src/app/(authed)/config/_components/ConfigClient.tsx:582`
  - `_ariaDescribedBy` is assigned but never used.

Worktree note at review time:

- Existing dirty files before this report:
  - `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`
  - `src/app/(authed)/tasks/_components/TaskBoardClient.tsx`
- These looked like UI/header/spacing changes, not logic changes.

Fix batch status after implementation:

- Added row-scoped enrollment access for list/detail/export/overview and record-related APIs.
- Restricted config import/export and task-agent admin changes to manager-level actors.
- Added import file limits, import value validation contexts, approval claiming, processing/failed states, and task assignee sync for imports.
- Added task assignee eligibility checks across create/reassign/assign/queue flows.
- Added attachment extension/MIME allowlists with content-signature validation before upload.
- Added Medicare field sanitization in app code plus a database check/backfill for inapplicable fields.
- Post-fix checks: `npm run typecheck`, `npm run test:run` (51 files / 416 tests), `npm run lint`, and `git diff --check` pass.

Residual note:

- Import approval is now idempotent at the request-claim level, but applying rows is still not a single database transaction. A future RPC should wrap request claim, row application, and final status update atomically if partial import rollback is required.

## High Severity Findings

### 1. Enrollment access is too broad for potential PII

Current behavior:

- Sidebar exposes ACA and Medicare enrollment to users with either `task.manage` or `task.work`.
- `loadEnrollmentActor()` reuses task-board access.
- `fetchEnrollmentRecords(program)` returns all active records for that program.
- Individual record GET/PATCH/DELETE/comment/file routes only check that the caller can access enrollment generally.

Relevant references:

- `src/app/(authed)/_components/Sidebar.tsx:107`
- `src/app/(authed)/enrollment/page.tsx:36`
- `src/lib/enrollment/access.ts:11`
- `src/lib/enrollment/queries.ts:64`
- `src/app/api/enrollment/[id]/route.ts:57`
- `src/app/api/enrollment/[id]/comments/route.ts:149`
- `src/app/api/enrollment/[id]/attachments/route.ts:166`

Risk:

- Any worker with task-board access can see and mutate all ACA/Medicare records.
- If enrollment records contain PII, this is a real data exposure.
- If the business rule is intentionally "shared enrollment queue", this should be explicitly documented and tested because the current code does not make that intent obvious.

Recommended fix:

- Add enrollment-specific permissions, for example `enrollment.work`, `enrollment.manage`, and possibly `enrollment.config`.
- Decide row-level scope:
  - Manager: all records.
  - Worker: only records where they are caller/responsible/participant/mentioned, or records assigned to their permitted agent group.
- Centralize row-level enrollment access in one helper, then use it in:
  - list query
  - record GET/PATCH/DELETE
  - comments
  - attachments
  - detail/activity
  - export/import.

### 2. Medicare-inapplicable fields are enforced only in UI, not on server or DB

Current behavior:

- UI hides Medicare fields and strips some create payload values.
- API still accepts and persists Medicare-inapplicable fields:
  - `caller_email`
  - `pcp_2026`
  - `payment_status_id`
  - `aca_status_id`
  - `consent_id`
  - `platform_id`
- Import approval also writes those fields for Medicare.
- DB schema has only a `program in ('aca', 'medicare')` check, no cross-field constraint.

Relevant references:

- UI strips create payload: `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx:2725`
- UI hides drawer fields: `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx:2341`
- Create API accepts fields: `src/app/api/enrollment/route.ts:28`
- Create API loops all option fields: `src/app/api/enrollment/route.ts:88`
- Patch API accepts fields: `src/app/api/enrollment/[id]/route.ts:33`
- Patch API loops all option fields: `src/app/api/enrollment/[id]/route.ts:143`
- Import writes enrollment fields: `src/app/api/config/imports/[id]/route.ts:185`
- Import field split includes Medicare-inapplicable fields: `src/app/api/config/imports/[id]/route.ts:286`
- Schema lacks program-specific constraint: `supabase/schema.sql:2241`

Risk:

- Medicare records can contain ACA-only data even though the product hides it.
- Later reports/export/filter logic may read stale or impossible states.
- Import/API callers can bypass the client entirely.

Recommended fix:

- Add server-side sanitizer for enrollment create/patch/import:
  - If `program === "medicare"`, force ACA-only fields to `null`.
  - Reject attempts to set hidden Medicare fields, or silently null them. Prefer reject for API clarity, null for import migration compatibility.
- Add DB check constraint:
  - For `program = 'medicare'`, require ACA-only columns to be null.
- Add tests for POST/PATCH/import on Medicare records.

### 3. Import approval is not atomic or idempotent

Current behavior:

- Approve route loads the import request.
- Checks `status === "pending"`.
- Applies every row in a loop.
- Only after all rows are applied, updates request status to `approved`.

Relevant references:

- `src/app/api/config/imports/[id]/route.ts:46`
- Row loop: `src/app/api/config/imports/[id]/route.ts:66`
- Status update after writes: `src/app/api/config/imports/[id]/route.ts:70`

Risk:

- Two admins can approve the same pending import at the same time.
- A partial failure leaves already-applied rows in real tables while request remains pending.
- Retrying can duplicate add rows or reapply updates.

Recommended fix:

- Move approval into a DB transaction, ideally Supabase RPC/stored procedure.
- Or at minimum:
  - atomically claim the request with `update ... where id = ? and status = 'pending'`
  - set status to `processing`
  - apply rows
  - mark `approved` or `failed`
- Make add rows idempotent using deterministic external keys or import-row application markers.
- Record per-row apply status if partial application is allowed.

### 4. Import validation context exists but is not used by the upload route

Current behavior:

- `classifyImportRows()` supports `ctxByColumnKey`.
- `coerceCustomValue()` can validate dropdown option IDs/labels and person emails when context is provided.
- `/api/config/imports` calls `classifyImportRows()` without context.
- Approve later blindly applies system and custom values.

Relevant references:

- Route call missing context: `src/app/api/config/imports/route.ts:78`
- Context parameter: `src/lib/table-config/import.ts:17`
- Dropdown/person validation: `src/lib/table-config/values.ts:60`
- Task value split blindly maps system fields: `src/app/api/config/imports/[id]/route.ts:247`
- Enrollment value split blindly maps system fields: `src/app/api/config/imports/[id]/route.ts:286`

Risk:

- Invalid dropdown/person values can be staged.
- Approve can fail late on foreign keys or persist invalid custom values.
- Preview can say add/update even when the row is actually not valid.

Recommended fix:

- Build validation context per scope before classification:
  - table column options for custom dropdowns
  - active portal accounts for person fields
  - enrollment option IDs/labels for enrollment system fields
  - task categories/status/priority/agent/person values for task system fields
- Treat invalid values as row errors during staging.
- Add tests for invalid dropdown/person import values.

## Medium Severity Findings

### 5. Config/import permissions drift from manager model

Current behavior:

- `/config` page uses `loadConfigAdmin()`, which requires an enrollment actor that can manage options.
- `canManageEnrollmentOptions()` means `actor.isManager`.
- `actor.isManager` requires both `task.manage` and admin-like task role.
- Export/import allows manager OR any worker in `task_agents`.
- `/api/admin/task-agents` can be managed by `account.manager` or `task.manage` alone, without `isTaskViewAdmin`.

Relevant references:

- Config page: `src/app/(authed)/config/page.tsx:18`
- Config admin access: `src/lib/table-config/access.ts:11`
- Export/import access: `src/lib/table-config/export-access.ts:4`
- Task actor manager model: `src/lib/tasks/access.ts:35`
- Task agents route permission: `src/app/api/admin/task-agents/route.ts:9`
- Task agents POST/DELETE: `src/app/api/admin/task-agents/route.ts:40`

Risk:

- A non-admin role with `task.manage` can manage `task_agents`.
- Membership in `task_agents` grants export/import.
- This weakens the intended "manager requires task.manage + admin role" model.

Recommended fix:

- Decide one policy:
  - Either export/import is manager-only.
  - Or it has a dedicated permission like `table.export_import`.
- Make `/api/admin/task-agents` use the same admin/manager check as config, or a dedicated account/group-management permission.
- Remove or update drifted pure helper in `src/lib/table-config/permissions.ts`.

### 6. Task assistant/owner permission helpers are inconsistent across detail/comment/file routes

Current behavior:

- Some routes use `isAgentOwnerOrAssistant()`, which treats promoted assistants as agent-owner equivalent.
- Other comment/edit/delete/activity helpers still calculate agent ownership with older helper patterns.

Relevant references:

- Canonical helper: `src/lib/tasks/membership.ts:72`
- Detail route uses assistant-aware helper: `src/app/api/tasks/[id]/detail/route.ts:50`
- Generic task patch uses assistant-aware helper: `src/app/api/tasks/[id]/route.ts:128`
- Comments route older helper area: `src/app/api/tasks/[id]/comments/route.ts:54`
- Comment edit/delete route older helper area: `src/app/api/tasks/[id]/comments/[cid]/route.ts:17`
- Comment edits route older helper area: `src/app/api/tasks/[id]/comments/[cid]/edits/route.ts:44`
- Attachment delete route older helper area: `src/app/api/tasks/[id]/attachments/[aid]/route.ts:15`
- Activity helper area: `src/app/api/tasks/[id]/activity/route.ts:15`

Risk:

- Assistant may be able to view detail but blocked from related comments/edit history/delete paths.
- Permission behavior depends on route, not business rule.

Recommended fix:

- Replace old route-local ownership checks with one shared access resolver.
- Add tests for assistant access to:
  - task detail
  - comments
  - comment edits
  - attachment delete
  - activity.

### 7. Task create can leave orphan task rows if follow-up writes fail

Current behavior:

- Task row is inserted first.
- Assignee junction rows are inserted afterward.
- Rotation updates happen afterward.
- If assignee insert or rotation fails, route returns 500 after task already exists.

Relevant references:

- Task insert: `src/app/api/tasks/route.ts:154`
- Assignee insert: `src/app/api/tasks/route.ts:184`
- Rotation update: `src/app/api/tasks/route.ts:197`

Risk:

- Task exists without intended assignees.
- Client sees failure and may retry, creating duplicates.
- Rotation/KPI state can diverge.

Recommended fix:

- Wrap task create + assignees + rotation/history in a transaction/RPC.
- Or defer non-critical rotation errors and return success only if the core task state is consistent.
- Add integration-style tests around assignee insert failure.

### 8. Task assignee add/remove is not atomic and has no optimistic concurrency

Current behavior:

- POST `/api/tasks/[id]/assignees` fetches current assignees, upserts junction row, then updates `tasks.assignee_email/status`.
- DELETE does delete junction row, then updates legacy field/status.
- There is no `expected_updated_at`, lock, or transaction.
- The route comment says assigners can assign to any account.

Relevant references:

- Add route: `src/app/api/tasks/[id]/assignees/route.ts:52`
- Add upsert: `src/app/api/tasks/[id]/assignees/route.ts:82`
- Add task update: `src/app/api/tasks/[id]/assignees/route.ts:113`
- Remove route: `src/app/api/tasks/[id]/assignees/[email]/route.ts:51`
- Remove delete: `src/app/api/tasks/[id]/assignees/[email]/route.ts:77`
- Remove task update: `src/app/api/tasks/[id]/assignees/[email]/route.ts:104`

Risk:

- Concurrent add/remove can desync junction table, legacy assignee field, status, history, and notifications.
- Assigning arbitrary inactive/non-worker accounts may be possible if DB does not prevent it.

Recommended fix:

- Use a single transactional RPC for assignee changes.
- Validate target email against active eligible accounts.
- Use `expected_updated_at` or row locking.
- Make legacy `assignee_email` derived or updated only inside the same transaction.

### 9. Attachment upload trusts browser MIME and extension

Current behavior:

- Bucket is private and signed URLs are gated, which is good.
- Size is capped at 15MB, which is also good.
- Bucket allows all MIME types.
- `inferAttachmentMimeType()` trusts `file.type` from browser first.
- No magic-byte/content sniffing.

Relevant references:

- Bucket config: `src/lib/tasks/storage.ts:27`
- MIME inference: `src/lib/tasks/attachments.ts:29`
- Task upload: `src/app/api/tasks/[id]/attachments/route.ts:115`
- Enrollment upload: `src/app/api/enrollment/[id]/attachments/route.ts:62`

Risk:

- Executable or spoofed files can be stored and served through signed URLs.
- Browser behavior depends on content type and file content.

Recommended fix:

- Define an allowlist:
  - PDF
  - PNG/JPEG/WebP/GIF/HEIC if needed
  - CSV/TXT/XLS/XLSX if needed
- Sniff common magic bytes for binary types.
- Force `application/octet-stream` or download disposition for unknown types.
- Consider blocking HTML/SVG/JS uploads.

### 10. Config import upload has no file-size or row-count cap

Current behavior:

- Route reads full upload into memory:
  - `Buffer.from(await file.arrayBuffer())`
- No file size cap.
- No row count cap.
- No MIME/extension gate.

Relevant references:

- `src/app/api/config/imports/route.ts:43`
- `src/app/api/config/imports/route.ts:64`

Risk:

- Large XLSX/CSV can cause memory pressure or slow requests.
- A user with export/import access can stage a huge number of rows.

Recommended fix:

- Add max file size, for example 5-10MB.
- Add max rows, for example 5k or 10k depending on business need.
- Validate file extension/MIME.
- Return clear error before reading or inserting staging rows.

### 11. Enrollment DELETE returns OK even when nothing was archived

Current behavior:

- DELETE updates `enrollment_records` where `id = ?` and `archived_at is null`.
- It does not select the updated row or check affected row count.
- It inserts activity and returns `{ ok: true }` regardless.
- Activity insert error is not checked.

Relevant references:

- `src/app/api/enrollment/[id]/route.ts:418`
- Update without row check: `src/app/api/enrollment/[id]/route.ts:430`
- Activity insert without error check: `src/app/api/enrollment/[id]/route.ts:441`

Risk:

- Deleting a nonexistent or already archived record can report success.
- Audit log can say archived even when no state changed.

Recommended fix:

- Use `.update(...).eq(...).is(...).select("id").maybeSingle()`.
- Return 404 or 409 when no row changed.
- Check activity insert error.

### 12. Task create/update can accept arbitrary assignee-like emails in some paths

Current behavior:

- Task creation dedupes requested assignees but does not verify each one is active/eligible.
- Generic task patch validates shape/status rules but not whether next assignee is an active account.
- Dedicated assignment-queue path may be stricter, but general paths should not rely on UI-only constraints.

Relevant references:

- Create requested assignees: `src/app/api/tasks/route.ts:97`
- Create assigned emails: `src/app/api/tasks/route.ts:115`
- Create inserts assignees: `src/app/api/tasks/route.ts:184`
- Patch resolves assignee shape only: `src/lib/tasks/transitions.ts:123`
- Patch applies assignee replacement: `src/app/api/tasks/[id]/route.ts:290`

Risk:

- Invalid/inactive/non-worker emails can enter task assignment state.
- Notifications/history/filters may behave oddly.

Recommended fix:

- Centralize eligible assignee validation.
- Apply it in create, patch, assignees add, assignment queue, and import.
- Add tests for inactive/nonexistent assignee rejection.

## Low Severity Findings

### 13. Supabase `.or()` filter strings interpolate emails/IDs without escaping

Current behavior:

- `fetchTasksForActor()` builds PostgREST `.or(...)` strings using actor email and related agent emails.
- Emails generally come from account data, but PostgREST filter strings are syntax-sensitive.

Relevant references:

- `src/lib/tasks/queries.ts:41`
- `src/lib/tasks/queries.ts:277`

Risk:

- Crafted or unusual emails can break query syntax.
- Not classic SQL injection, but can cause errors or possibly widen/narrow filters depending on syntax.

Recommended fix:

- Avoid string-built `.or()` for user-controlled values where possible.
- Escape PostgREST filter values if string-built filters are unavoidable.
- Add tests for emails containing comma/parentheses/special chars.

### 14. `/config` is in sidebar but missing from first-accessible route map

Current behavior:

- Sidebar has `/config` under Task Management with `task.manage`.
- `ACCESSIBLE_ROUTES` has `/tasks` for task permissions but no `/config`.

Relevant references:

- Sidebar config item: `src/app/(authed)/_components/Sidebar.tsx:121`
- Route map: `src/lib/rbac/routes.ts:46`

Risk:

- Users with config-like access may not be redirected to the intended route after login.
- Less severe because `task.manage` also grants `/tasks`, but it is still policy drift.

Recommended fix:

- Add `/config` to route map if it is a first-class accessible destination.
- Or keep `/tasks` first intentionally and document that config is not a default landing route.

### 15. Table-config export/import pure permission helper is drifted/dead

Current behavior:

- `src/lib/table-config/permissions.ts` says:
  - manager can export/import
  - worker can export/import only if not assistant
- Actual async check in `export-access.ts` ignores assistant status and grants access to workers in `task_agents`.

Relevant references:

- Pure helper: `src/lib/table-config/permissions.ts:1`
- Actual helper: `src/lib/table-config/export-access.ts:4`

Risk:

- Tests may verify one policy while runtime uses another.
- Future changes can accidentally call the wrong helper.

Recommended fix:

- Delete dead helper or make runtime use it.
- Add tests directly around `canActorExportImport()`.

### 16. Enrollment search placeholder still says "task"

Current behavior:

- Enrollment list search placeholder is "Search task name and comments...".

Relevant reference:

- `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx:1048`

Risk:

- UI polish/copy issue only.

Recommended fix:

- Change to "Search client, FUB, and comments..." or similar.

### 17. Config lint warning

Current behavior:

- ESLint warning for unused destructured `_ariaDescribedBy`.

Relevant reference:

- `src/app/(authed)/config/_components/ConfigClient.tsx:582`

Risk:

- Low. No runtime issue.

Recommended fix:

- Use a rest-helper pattern that avoids unused variable warning.
- Or explicitly disable the one line if intentional.

## Positive Findings

- `/tasks`, `/enrollment`, and `/config` are under `(authed)` layout and require session.
- Server-side route handlers perform auth checks; client-only hiding is not the only protection for the broad route families.
- Task main PATCH uses `expected_updated_at` and returns 409 on stale writes.
- Enrollment PATCH also uses `expected_updated_at`.
- Task attachment bucket is private.
- Attachment signed URLs are generated after route-level visibility gates.
- Attachment size cap exists for task/enrollment uploads.
- Cron routes checked during review require `CRON_SECRET`.
- React rendering escapes user text; no `dangerouslySetInnerHTML` found in reviewed task/enrollment UI.
- External link helper only allows raw `http://` or `https://`; other schemes get prefixed with `https://`, so `javascript:` is not directly rendered as a JS href.

## Suggested Fix Order

1. Enrollment access model:
   - Define whether enrollment is shared queue or scoped PII workflow.
   - Add dedicated permissions and row-level scope if needed.
   - Enforce same helper in list/detail/mutation/comment/file/export/import.

2. Medicare data integrity:
   - Add server sanitizer for create/patch/import.
   - Add DB check constraint.
   - Add tests.

3. Import safety:
   - Add file size and row count caps.
   - Pass validation context into `classifyImportRows()`.
   - Validate system fields as well as custom fields.
   - Make approve transactional/idempotent.

4. Permission cleanup:
   - Resolve config/export/import/task_agents policy.
   - Remove or align drifted table-config permission helper.

5. Task assignment consistency:
   - Validate assignee eligibility everywhere.
   - Move create/assignment writes into RPC/transaction.
   - Add concurrency tests.

6. Attachment hardening:
   - MIME allowlist.
   - basic content sniffing.
   - safer download/content-disposition behavior for unknown files.

7. Small cleanup:
   - Enrollment placeholder copy.
   - `/config` route map decision.
   - Config lint warning.

## Tests To Add

- Enrollment worker cannot see records outside allowed scope, if scoped access is chosen.
- Enrollment manager can see all records.
- Medicare POST/PATCH nulls or rejects ACA-only fields.
- Medicare import cannot persist ACA-only fields.
- Import upload rejects too-large files and too many rows.
- Import classification rejects invalid dropdown/person/system values.
- Import approve cannot be applied twice concurrently.
- Import approve failure does not leave partial writes, or marks partial state explicitly.
- Task assistant has consistent access to detail/comments/comment edits/activity/attachment delete.
- Task create rejects invalid assignee emails.
- Task assignee add/remove rejects inactive/nonexistent emails.
- Task assignment concurrent add/remove does not desync junction and legacy fields.
- Attachment upload rejects disallowed MIME/content.
- `canActorExportImport()` policy is tested directly.

## Open Questions

- Is enrollment intended to be a shared queue for every `task.work` user, or should ACA/Medicare records be scoped?
- Are ACA and Medicare option sets supposed to share all system option columns internally, or should Medicare truly never carry Payment/Consent/Platform/AC/Caller/PCP-2026?
- Who should be allowed to export/import table data: only manager, task agent, or a dedicated permission?
- Should `task_agents` be managed by account managers, task managers, or only task-view admins?
- Should imported rows be allowed to create new task/enrollment records, or only update matched records?
- What maximum import size/row count is acceptable operationally?
