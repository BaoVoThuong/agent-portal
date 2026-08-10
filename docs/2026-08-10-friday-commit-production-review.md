# Deep Production Review — All Commits Since Friday

## Executive Summary

Review snapshot:

- Window: `2026-08-07 00:00:00 +07:00` through audit snapshot `2026-08-10 02:20:09 +07:00`
- First commit: `be706b0a49575e49adba33f65891bf8358863f0a`
- Base parent: `cc75e9ab0c8a74279240a1bb6523c7e87c790435`
- Last commit / HEAD: `ed9935985a9488dde75fde3f6d94162ff3c24d58`
- Branch: `config`
- Commits reviewed: **266**; merge commits: **0**
- Runtime/config/schema commits: **150**; documentation-only commits: **116**
- Cumulative changed paths reviewed: **179**
- Cumulative diff: **31,211 insertions + 6,026 deletions = 37,237 changed lines**
- Aggregate commit-by-commit churn reviewed: **33,254 insertions + 8,069 deletions = 41,323 changed lines**
- Author: `BaoVoThuong`

Severity count for findings introduced by or materially exposed by this range:

- P0: **1 conditional deployment-security blocker**
- P1: **2 reproducible migration blockers**
- P2: **10**
- P3: **3**

Verdict: **BLOCK**.

The two strongest correctness findings were reproduced against PostgreSQL 16.8, not inferred from static code. A clean `supabase/schema.sql` apply stops at line 3368 because `agent_email` is referenced before it is added. Separately, the stage backfill aborts for an archived historical record because it emits a non-zero-duration `entry_marker` that violates its own table constraint. A third, conditional P0 was also reproduced: if the monolithic schema reaches its first complete pass, the new enrollment mutation RPCs are created after the global ACL sweep and retain `PUBLIC EXECUTE`. The dedicated rollout file revokes them correctly, but the canonical schema does not.

Typecheck, all 560 unit/integration tests, and the production build pass. Those checks do not execute the clean-schema path, realistic stage backfill data, live Supabase row caps, concurrent upload races, or production ACLs; therefore they do not clear the blockers above.

## System Model Derived From the Repository

```text
Browser / React 19 client
  ↓ Next.js 16 App Router pages and route handlers
NextAuth session + permission/capability resolution
  ↓
Supabase service-role client
  ├─ PostgreSQL tables and SECURITY DEFINER RPC commands
  ├─ Storage for attachments
  └─ Realtime broadcasts / notification rows
  ↓
Tasks, ACA Enrollment, Medicare Enrollment, Config/SLA
  ↓
Vercel/GitHub scheduled reminder and data-sync routes
```

The repository is a single Next.js monolith. Critical writes are progressively being moved from multi-statement route logic to PostgreSQL RPC transaction boundaries. There is no queue/worker service, distributed cache, model server, or feature-flag service in the reviewed surface. The only application cache materially changed here is a browser-side task-detail `Map`.

The repository contains AI/dashboard UI, but no component named GFI and no ML, embedding, retrieval, learned ranking, inference, model-version, or scoring pipeline in this review range. Enrollment overview prioritization is deterministic TypeScript aggregation. Therefore GFI/model accuracy categories are **not applicable**, and no accuracy metric is fabricated.

## Top Findings

### [P0] Canonical schema can expose privileged enrollment mutation RPCs to PUBLIC

```text
Commit: 224bebb47dcea116b96847d143ac67ca6289ebe6
File: supabase/schema.sql
Line: 3417-3445; 3631-3938
Function: patch_enrollment_atomic, create_enrollment_atomic,
          archive_enrollment_atomic, enrollment_touch_activity
Subsystem: Database security / deployment
Risk: CONFIRMED on a first complete schema pass; production exposure NEEDS VALIDATION
```

#### Problem

The global `SECURITY DEFINER` ACL sweep executes before these four functions are created. PostgreSQL grants function execution to `PUBLIC` by default. The functions trust caller-supplied `actor_email` and perform privileged writes; authorization exists in Next.js, not inside the RPC.

#### Evidence

The ACL loop is at `supabase/schema.sql:3417-3445`; the functions are created later at lines 3631, 3798, 3880, and 3920. On a clean temporary database, after inserting only the missing `agent_email` column to allow the schema to finish once, `pg_proc.proacl` returned `<NULL=PUBLIC EXECUTE>` for all four functions. The comment/edit RPCs that have adjacent explicit revokes were restricted correctly. The dedicated rollout file also has a correct explicit revoke/grant block at `supabase/rollouts/2026-08-09-enrollment-stage-time-schema.sql:478-493`.

#### Before

The earlier ACL sweep correctly restricted every `SECURITY DEFINER` routine that existed at that point.

#### After

New enrollment mutation functions are created after the sweep and are public on their first canonical-schema creation. A later full schema rerun happens to revoke them because they then exist when the earlier sweep executes; relying on a second apply is unsafe.

#### Impact

- Correctness: arbitrary create/update/archive/touch if the RPC is exposed through Supabase PostgREST.
- Security: severe authorization bypass; anonymous/authenticated clients can bypass Next.js capability checks.
- Data integrity: arbitrary enrollment mutations and fabricated actor attribution.
- Reliability/API: depends on deployment path. The dedicated rollout is safe; the monolithic schema first pass is not.

#### Production Scenario

An environment applies `supabase/schema.sql` to an existing database where the file reaches these function definitions. A client holding the public Supabase key calls `/rest/v1/rpc/patch_enrollment_atomic`, supplying another record ID and a fabricated actor email.

#### Recommendation

Move a final dynamic ACL sweep to the absolute end of `schema.sql`, or add explicit revoke/grant statements immediately after every enrollment function. Keep the dedicated rollout block. Query production `pg_proc.proacl` before go-live and fail deployment if `public`, `anon`, or `authenticated` has execute.

#### Validation

Apply the schema once to a fresh database, then assert all `prosecdef` functions in `public` are executable only by the owner and `service_role`. Also attempt RPC calls as `anon` and `authenticated`; both must be denied.

### [P1] Fresh database bootstrap fails because `agent_email` is normalized before it exists

```text
Commit: ab3a7c7915c1a4a59173e95960e54a238cc3b95c
File: supabase/schema.sql
Line: 3307-3368; 3455
Function: canonical schema bootstrap
Subsystem: Database migration / disaster recovery
```

#### Problem

`enrollment_records` is created without `agent_email`, lines 3366-3368 update that column, and only line 3455 adds it.

#### Evidence

A clean PostgreSQL 16.8 database running `psql -v ON_ERROR_STOP=1 -f supabase/schema.sql` fails with SQLSTATE `42703`: `column "agent_email" does not exist` at line 3368. This was reproduced twice.

#### Before

The canonical schema could proceed through enrollment table creation.

#### After

New environments, CI schema tests, disaster recovery, and clean local setup stop mid-schema. PostgreSQL DDL before the failure is not wrapped by one outer transaction, so the environment is partially initialized.

#### Impact

- Reliability: clean deploy/DR is blocked.
- Data integrity: partial schema state invites unsafe manual reruns/workarounds.
- Rollback: no atomic rollback for the whole file.

#### Production Scenario

A go-live or recovery environment provisions from `schema.sql`; provisioning exits at line 3368 and never creates later indexes, RPCs, ACLs, comments, or stage tracking objects.

#### Recommendation

Add `agent_email` to the table definition, or move its `ADD COLUMN IF NOT EXISTS` before the normalization update. Wrap/test bootstrap in a disposable database.

#### Validation

One-pass clean apply, second idempotent apply, then schema-object/ACL assertions. Both applies must exit zero without manual ALTER statements.

### [P1] Stage-time backfill aborts on archived/closed historical records

```text
Commit: fff248cdf2cd7e53e6910b3d4f0fea1d8b9e74e4
File: supabase/rollouts/2026-08-09-enrollment-stage-time-backfill.sql
Line: 149-168
Function: current-stage historical backfill
Subsystem: Enrollment stage tracking / migration
```

#### Problem

For an inactive record, the backfill selects `kind='entry_marker'` but computes `ended_at` and a positive duration from stage start to inactive time. The table constraint requires every `entry_marker` to have `ended_at IS NOT NULL` and `duration_seconds = 0`.

#### Evidence

A fixture with a current stage, `created_at=2026-01-01`, `archived_at=2026-01-03`, and no live cycle causes the INSERT at line 149 to fail its check constraint with duration `172800`. The transaction rolls back, so it does not partially corrupt data, but no record is backfilled.

#### Before

No stage-cycle migration was required.

#### After

Any realistic inactive legacy record matching this path can prevent the entire production backfill from completing.

#### Impact

- Correctness/data: stage tracking rollout cannot complete; overview dwell data remains unavailable/incomplete.
- Availability: application code deployed before successful schema/backfill can return schema-out-of-date responses.
- Rollback: transaction rollback is safe, but deployment is blocked.

#### Production Scenario

The existing enrollment table contains archived sample or customer records with a stage and no live cycle. The one-shot backfill aborts on the first such row.

#### Recommendation

Use a completed `dwell` row for a measurable inactive visit, or emit a true zero-duration `entry_marker`; make `kind`, timestamps, and duration consistent. Add archived and closed fixtures to the SQL assertions.

#### Validation

Run backfill twice against fixtures covering active, terminal, closed, archived, no-stage, first-history-event, mixed live/backfill, and same-timestamp transitions. Assert idempotency and all constraints.

### [P2] Enrollment attachment retry tokens are generated but ignored server-side

```text
Commit: 923075b7e740c6673ece6fde6bff3e98fa0c1642
File: src/app/(authed)/tasks/_components/CommentThread.tsx;
      src/app/api/enrollment/[id]/attachments/route.ts
Line: CommentThread 521-539, 640-645, 700-728; enrollment route 72-190
Function: shared comment attachment upload / Enrollment POST attachment
Subsystem: Collaboration / storage / idempotency
```

#### Problem

The shared composer sends a stable `client_request_id` for both Tasks and Enrollment. Task upload persists it through an atomic RPC. Enrollment never parses or stores the token and directly inserts a new row/path.

#### Before

Both surfaces could duplicate uploads on ambiguous network failure.

#### After

Tasks became replay-safe; Enrollment appears to have the same retry UX but still duplicates metadata and storage objects.

#### Impact

- Data integrity/resource usage: duplicate file rows and orphan/duplicate storage.
- Reliability: a lost successful response followed by Retry is a realistic trigger.
- API compatibility: the client sends a contract Enrollment silently ignores.

#### Recommendation

Add an enrollment attachment request-id column/unique index and atomic create RPC, or do not present Retry as idempotent. Return the original row/path on replay and compensate only the retry upload.

#### Validation

Commit the first upload, drop its HTTP response, retry the same token, and assert one DB row, one canonical object, one activity event, and stable counters.

### [P2] Collaboration limits are TOCTOU on Tasks and client-only on Enrollment

```text
Commit: 062bed575672c31886d6a52b6694310a8b5dd25d
File: src/app/api/tasks/[id]/attachments/route.ts;
      supabase/schema.sql;
      src/app/api/enrollment/[id]/comments/route.ts;
      src/app/api/enrollment/[id]/attachments/route.ts
Line: task route 175-195 and 233-244; schema 2048-2124;
      enrollment comment 56-68; enrollment attachment 79-89
Function: upload/comment operation limits
Subsystem: Collaboration / abuse resistance
```

#### Problem

Task count/aggregate checks run before storage upload and before the row-locking RPC. Two concurrent uploads can both observe 9 files and both commit, producing 11. The database command does not enforce the limit. Enrollment uses the same client component and therefore displays the limits, but its APIs enforce neither the 10,000-character comment limit nor per-comment count/aggregate limits.

#### Before

Only the per-file cap existed.

#### After

Normal sequential Task usage is protected, but concurrent Task requests and direct/old Enrollment clients bypass the advertised invariant.

#### Impact

- Security/resource usage: authenticated clients can exceed intended storage/text bounds.
- Correctness: UI and API behavior differ across the unified system.
- Concurrency: classic check-then-act race.

#### Recommendation

Enforce comment count and aggregate bytes inside the locked attachment command. Apply the same server contract to Enrollment. Keep client validation for feedback only.

#### Validation

Run parallel uploads at 9 files/just below 50MB, direct oversized Enrollment comments, and Enrollment uploads above count/aggregate. Exactly one boundary-crossing request may commit.

### [P2] Enrollment collaboration audit and deletion are not transactionally complete

```text
Commit: 64880484997fd75ccbac99979a2863053abdd93d (exposes parity gap)
File: src/app/api/enrollment/[id]/comments/route.ts;
      src/app/api/enrollment/[id]/comments/[cid]/route.ts;
      src/app/api/enrollment/[id]/attachments/route.ts
Line: comments 70-123; comment delete 99-120; attachments 166-206
Function: Enrollment comment/attachment mutation paths
Subsystem: Collaboration / audit / data consistency
```

#### Problem

Enrollment comment creation commits the comment first, then separately touches parent activity and inserts audit. Attachment creation does the same. Comment deletion directly soft-deletes the comment, has no CAS token, does not atomically delete linked attachments, and writes no `comment_deleted` activity even though that vocabulary exists. Its broadcast failure is not contained and can return a retryable 500 after the delete committed.

#### Before

The paths were already multi-statement, but the reviewed Tasks hardening creates an explicit behavioral and reliability split in one product.

#### After

Task collaboration has atomic comment/attachment commands; Enrollment can retain committed content with missing audit/last-activity, or return a misleading failure after commit.

#### Impact

- Data integrity/audit: missing or inconsistent activity history and linked-file state.
- Concurrency: edit/delete races have no compare-and-swap protection.
- Reliability: response status can disagree with durable state.

#### Recommendation

Implement Enrollment atomic comment create/edit/delete and attachment metadata commands with the same invariants and warning semantics as Tasks; keep storage cleanup compensating and observable.

#### Validation

Inject failures after each durable step, race edit versus delete, delete a comment with files, and assert parent timestamps, audit, counters, storage repair warnings, and response semantics.

### [P2] Clearing Enrollment ownership records the old person in audit metadata

```text
Commit: 64880484997fd75ccbac99979a2863053abdd93d
File: src/app/api/enrollment/[id]/route.ts
Line: 395-398; 423-567
Function: PATCH enrollment activity construction
Subsystem: Audit correctness
```

#### Problem

The RPC activity payload uses `patch.caller_email ?? current.caller_email` and the equivalent responsible field. `null` is the valid value for clearing a person, so nullish coalescing incorrectly replaces the new null with the old email. A second, correct-looking `activityRows` array is then built after the commit but never inserted.

#### Before

Audit was written after reading the updated record and could use the persisted value.

#### After

The atomic RPC improves consistency, but a clear action is durably logged with the previous person, reducing audit trust.

#### Impact

- Correctness/data: activity metadata is false for a reachable user action.
- Security/audit: accountability and investigation output are misleading.

#### Recommendation

Distinguish property absence from explicit null using `"caller_email" in patch`, or build audit metadata from sanitized next values inside the RPC. Delete the dead post-RPC activity builder.

#### Validation

Clear caller only, responsible only, and both; assert persisted record and `people_changed.meta` contain null exactly where cleared.

### [P2] Enrollment creation remains non-idempotent; idempotent Task side effects can be lost

```text
Commit: ac2e23b756e9e1ed3fbd5e9929486faa67716b0a; 224bebb47dcea116b96847d143ac67ca6289ebe6
File: src/app/api/tasks/route.ts; src/app/api/enrollment/route.ts; supabase/schema.sql
Line: enrollment route 243-258; schema 3798-3878
Function: create_task_atomic / create_enrollment_atomic
Subsystem: Create flows / idempotency / notification side effects
```

#### Problem

Task creation has a request token, but Enrollment creation has none. A lost successful Enrollment response followed by retry creates two records. For Tasks, replay returns `was_created=false` and intentionally skips rotation/notification/broadcast. If the process dies after the database commit but before those effects, the retry can never repair them.

#### Before

Both creates were non-idempotent multi-statement operations.

#### After

Task core data is replay-safe but has an outbox gap; Enrollment core data is still duplicate-prone.

#### Impact

- Data integrity: duplicate enrollments; missing assignment rotation or notifications for Tasks.
- Reliability: response loss/process termination is realistic under deployment or provider failure.

#### Recommendation

Add Enrollment create request tokens. For durable must-run side effects, use an outbox/idempotent reconciliation record or a repairable status rather than `was_created` as the only trigger.

#### Validation

Kill the handler after RPC commit and before side effects, then retry. Assert one parent row and eventually exactly-once/at-least-once-deduplicated required effects.

### [P2] Soft-deleted Task attachments are returned by the task-level GET endpoint

```text
Commit: fb7fd68ba967d240453f80001213ba6c0f937865; 4ce4f97dfbdb7937269765a8c1de091d655133ac
File: src/app/api/tasks/[id]/attachments/route.ts
Line: 95-121
Function: GET task attachments
Subsystem: Attachments / API consistency
```

#### Problem

Deletes now set `deleted_at` and remove storage, but the existing GET query filters only `task_id` and `comment_id`; it does not require `deleted_at IS NULL`. It also uses `Promise.all` for signing, so one stale row can fail the whole response.

#### Before

Attachment metadata was physically deleted, so the old query was correct.

#### After

The storage/delete model changed without updating this consumer. Deleted files can reappear or break refreshes.

#### Impact

- Correctness/UI: deleted data can be listed again as unavailable.
- Reliability: one stale sign can fail the endpoint.

#### Recommendation

Filter active rows and use the same per-file signing isolation as task detail.

#### Validation

Delete a task-level attachment, call GET directly, upload another attachment and reload; the deleted ID must never return and an independently unsignable active file must not hide other files.

### [P2] Core lists and overview fail or become incomplete at the PostgREST row cap

```text
Commit: a52156e59a48ce7b052388a89fd865edb796f9bc; f7c1d945d66c4f134b82f30b13fccc5f4a62df7;
        9937515; 08948cd
File: src/lib/tasks/queries.ts; src/lib/enrollment/queries.ts;
      src/lib/enrollment/overview-data.ts; src/lib/enrollment/stage-metrics.ts
Line: tasks 25-113 and 152-179; enrollment 80-160;
      overview-data 38-91; stage-metrics 47-55
Function: list, export, overview data loaders
Subsystem: Database scalability / availability
```

#### Problem

Tasks and Enrollment intentionally throw if an un-ranged response is truncated, making the entire board/export unavailable above the configured PostgREST limit (commonly 1,000). Overview loads records without paging; stage metrics then performs an exact-count ID query and throws at the cap. Enrollment auxiliary comment/attachment queries have neither paging nor a count guard, so they can silently undercount and omit searchable comment text before the record cap is reached.

#### Before

The UI could silently show a partial list.

#### After

Primary list correctness fails closed, which is safer, but availability has a hard growth ceiling and auxiliary correctness remains silent.

#### Impact

- Availability/scalability: at 10x current volume, core pages and exports can return 503/500.
- Correctness: Enrollment comment search/counts can be incomplete.
- DB/network: all records and comment bodies are transferred to application memory.

#### Recommendation

Introduce server pagination/windowing or database RPC aggregation/search. Page all record IDs and auxiliary rows; do not join a large ID list in application memory.

#### Validation

Seed above the configured row cap with more than 1,000 comments/attachments, then test list, export, search, and overview for both scoped and unscoped actors.

### [P2] Task search can amplify one query into roughly hundreds of database calls

```text
Commit: 82885a3897ab252428dca08db130d32ed6e0099e
File: src/lib/tasks/search.ts
Line: 121-127; 171-296; 303-380
Function: collectVisibleHits / runTaskSearch
Subsystem: Search performance / authorization
```

#### Problem

Visibility is resolved after fetching raw matches. Each of three parallel groups can scan twenty 50-row pages up to `MAX_SEARCH_SCAN=1000`; every page runs a candidate query plus task metadata and assignee queries. For common terms where visible matches occur late, this is on the order of 180 database calls for one user search, plus membership queries.

#### Evidence

The loop and limits are explicit. No p50/p95/p99 measurement or query-count test exists. Exact production cost is **UNKNOWN**.

#### Before

A fixed raw limit could miss valid visible results.

#### After

Recall/correctness improves, but worst-case DB QPS and tail latency rise sharply.

#### Impact

- Latency/throughput: p95/p99 and DB connection pressure can degrade under common queries.
- Scalability: concurrent searchers multiply the page-level query fan-out.

#### Recommendation

Move authorization predicates and grouped limits into SQL/RPC, add cancellation, record pages scanned/query count/duration, and retain a clearly signaled truncation ceiling.

#### Validation

Benchmark manager and scoped users with common and rare terms at 10k/100k task-comment-file rows; report DB calls and p50/p95/p99.

### [P2] Scheduled reminder processing is unpaged and several transitions remain non-atomic

```text
Commit: 6b9c0ddd5794eff02a70aa165fd943dbfa821826 (partial fix); baseline paths remain
File: src/app/api/cron/check-overdue/route.ts;
      src/app/api/cron/check-enrollment-due/route.ts
Line: task cron 59-185, 187-258; enrollment cron 35-183
Function: scheduled reminder routes
Subsystem: Reliability / notifications
```

#### Problem

Initial Task overdue transition is now correctly guarded by an atomic RPC. Other Task reminders still notify before a conditional marker update, so concurrent cron invocations can duplicate reminders. Enrollment updates/inserts often do not verify matched rows or errors before notifying. Both crons query active populations without explicit paging and process matches with unbounded `Promise.all`.

#### Before

All overdue/reminder paths were vulnerable to duplicate work.

#### After

One critical Task transition is fixed; the rest can still duplicate or silently skip records above the row cap.

#### Impact

- Reliability: duplicate/missed user notifications.
- Scalability/resource usage: burst DB/API fan-out and silent truncation.
- Observability: response counts do not prove every write/notification succeeded.

#### Recommendation

Use guarded atomic claim/update RPCs for every reminder class, paginate deterministically, bound concurrency, deduplicate notifications, and emit failure/lag metrics.

#### Validation

Run two cron invocations concurrently, inject update/insert failures, and seed beyond the row cap. Assert each due event is claimed once and every page is processed.

### [P2] Stage tracking has no safe old-app rollback after schema deployment

```text
Commit: 224bebb47dcea116b96847d143ac67ca6289ebe6; 64880484997fd75ccbac99979a2863053abdd93d
File: supabase/rollouts/2026-08-09-enrollment-stage-time-schema.sql;
      src/app/api/enrollment/[id]/route.ts
Function: atomic stage mutation rollout
Subsystem: Mixed-version deployment / rollback
```

#### Problem

New code alone maintains `stage_entered_at`, history, and cycles through RPCs. After schema rollout, rolling the app back to an older version restores direct row writes that bypass these invariants. There is no compatibility trigger or feature gate.

#### Before

No stage-cycle invariant existed.

#### After

Schema/new app is correct, but old app + new schema silently stops maintaining new history.

#### Impact

- Data integrity: rollback or mixed-version deploy creates gaps in cycle/history data.
- Operations: rollback is not safe even if API contracts appear compatible.

#### Recommendation

Declare a no-rollback gate after migration, or add a temporary compatibility trigger/dual-write guard. Canary code only after schema and ACL assertions; finish backfill before enabling metrics.

#### Validation

Exercise old app + new schema and 50/50 mixed instances. Every stage transition must produce exactly one history/cycle update or be explicitly rejected.

### [P3] Enrollment scope equality still depends on a non-enforced lowercase invariant

```text
Commit: b2b3b00a6851b9ade6bafc09f314395f5a6f430b; ab3a7c7
File: src/lib/enrollment/scope.ts; supabase/schema.sql
Line: scope 45-85; schema 3364-3374
Function: applyEnrollmentScope / isRecordInScope
Subsystem: Authorization consistency
```

List queries use exact `.in("agent_email", lowercaseValues)`, while direct record guards normalize both sides. The migration normalizes current data and new RPCs normalize future writes, which materially reduces likelihood. There is still no database lowercase check/citext invariant, and old-app rollback/direct data writes can reintroduce mixed case. Then a record can be absent from list but accessible by direct scoped link. Add a database constraint or normalize in every writer; include a mixed-case test.

### [P3] Task detail cache expires entries lazily but has no size bound

```text
Commit: 91235d9d20a70f473d0050635dcf6258633eda75
File: src/lib/tasks/detail-cache.ts
Line: 7-27
Function: task detail browser cache
Subsystem: Client memory
```

TTL is checked only when the same ID is read. A long-lived tab hovering many distinct tasks retains expired entries forever. The risk is bounded by user browsing patterns, not server traffic, but at large datasets memory grows monotonically. Add a maximum/LRU or periodic sweep and test eviction.

### [P3] Enrollment PATCH retains a dead second activity-construction path

```text
Commit: 64880484997fd75ccbac99979a2863053abdd93d
File: src/app/api/enrollment/[id]/route.ts
Line: 423-567
Function: PATCH enrollment
Subsystem: Maintainability / audit ownership
```

`rpcActivityRows` is the only persisted audit input, but a second `activityRows` array is built after commit and never written. It already diverges from the RPC version. Remove it after correcting the explicit-null bug; otherwise future maintainers can fix the wrong path or accidentally reintroduce duplicate audit writes.

## Commit Matrix

Every commit is represented in the compact risk matrix below. `N/A` is used for GFI and model-accuracy dimensions because this repository has no such runtime path; it does not mean those dimensions were silently skipped.

| Commit | Intent | Correctness | GFI | Accuracy | Performance | Reliability | Security | Data | API | Severity |
|---|---|---|---|---|---|---|---|---|---|---|
| `be706b0a4957` | feat(tasks): Required field thật theo table_column config + Stage field ở Create/Detail | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `91c516c53b42` | fix(ui): align CS/Enrollment Create+Detail UI, tighten Archive perms, default List view | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `3029620025e1` | fix(table-config): make column labels config-driven end to end, add archive confirm | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `df561ef9e402` | fix(tasks): stop the A-B-A-B UI revert across CS/Enrollment/Config | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `4fdac30b72d4` | feat(config): remove import workflow, preserve export | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `dc4ffaa9fa8c` | docs(go-live): record import removal execution | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `cdd06de23880` | fix(tasks): hydrate layout once per board mount | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `5fd0d9f91aec` | docs(go-live): record tasks layout fix | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `81e8562c919e` | fix(tasks): serialize patches against canonical versions | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `90f3bf278403` | docs(go-live): record task mutation race fix | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `d608d9cf1fbd` | fix(enrollment): disable record controls without edit access | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `bc7f774d84a2` | docs(go-live): record enrollment permission fix | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `fc00dbec5ceb` | fix(enrollment): serialize record patches and rebase conflicts | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `4c3491bf0a0e` | docs(go-live): record enrollment mutation race fix | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `2c7b96e49976` | fix(enrollment): keep creator records in my default view | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `c980fb57b756` | docs(go-live): record enrollment visibility fix | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `e219c9105df7` | fix(tasks): report committed mutation side-effect failures | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `e3443716dcd7` | docs(go-live): record task mutation warning handling | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `f95ebbe72369` | fix(enrollment): report committed side-effect warnings | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `97af7f0c1b17` | docs(go-live): record enrollment mutation warning handling | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `802493a434f7` | fix(enrollment): restore only failed archive row | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `211c26580a1e` | docs(go-live): record archive rollback fix | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `373a4dc097ab` | fix(enrollment): return canonical stats for no-op patches | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `6ffb5435151e` | docs(go-live): record enrollment no-op fix | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `f9c164386295` | fix(tasks): restore only failed archive task | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `fb6c2a704ba5` | docs(go-live): record task archive rollback fix | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `874b725ee855` | docs(go-live): reconcile execution status and verification gates | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `4f59280b82bc` | fix(tasks): commit canonical mutation and history atomically | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `9af6262c3dc0` | docs(go-live): record atomic task mutation fix | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `50bbadf6f3bd` | docs(go-live): clarify task atomicity scope | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `16ad882d8b91` | fix(tasks): add optimistic concurrency to special actions | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `5059f3045157` | docs(go-live): record special-action concurrency fix | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `82885a3897ab` | fix(tasks): paginate visible search results and render files | PASS | N/A | N/A | F11 | F11 | PASS | F11 DB load | PASS | P2 |
| `4da59a005667` | docs(go-live): record searchable task result fix | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `ff87eaff458c` | fix(tasks): reconcile list metadata after detail mutations | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `93b82eb40bdc` | docs(go-live): record task metadata reconciliation | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `a52156e59a48` | fix(tasks): detect truncated list responses | F10 | N/A | N/A | F10 | F10 | PASS | F10 | F10 | P2 |
| `14c22c11e7a1` | docs(go-live): record task truncation guard | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `036984e9280b` | fix(tasks): stabilize realtime subscription lifecycle | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `2e22c5122666` | docs(go-live): record realtime subscription stabilization | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `e77cb7884a41` | fix(tasks): reconcile drawer drafts with external updates | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `9204df42a6ce` | docs(go-live): record drawer draft reconciliation | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `16203e3b231e` | fix(tasks): align archive confirmation copy | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `37a89d5d56b7` | docs(go-live): record archive confirmation semantics | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `d6fbe37ab3c1` | fix(tasks): escape permission filter identities | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `f43fbf0b0eea` | docs(go-live): record permission filter hardening | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `17b86e24e964` | fix(security): require bearer auth for cron routes | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `841f51044d78` | docs(go-live): record cron auth hardening | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `bb6dca351f04` | docs(ops): align overdue scheduler ownership | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `28adc4a07b64` | docs(go-live): record scheduler ownership gate | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `fac06e7ef81d` | fix(tasks): use toast for export failures | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `612e377cb532` | docs(go-live): record task error-surface fix | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `c6dfc3db6743` | fix(config): reject invalid table scopes | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `c02e78852ae7` | docs(go-live): record strict config scope fix | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `38e6409f55d8` | fix(config): serialize layout writes with version checks | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `ec4218f52b13` | docs(go-live): record versioned layout writes | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `c0abf1662e80` | fix(ui): add table-shaped module loading states | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `c816ed9a70d6` | fix(config): preserve new-column input contrast | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `70d09822fe46` | docs(go-live): record cross-module ui fixes | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `3a5bd97a1ccc` | fix(tasks): preserve task detail deep links | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `769deb29d973` | docs(go-live): record detail deep-link fix | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `054c11efed92` | fix(enrollment): skip unchanged layout autosaves | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `ae121ce74d86` | docs(go-live): record enrollment layout autosave guard | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `10ddc4374dbc` | fix(enrollment): skip unchanged due-date writes | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `367caf01ecb4` | docs(go-live): record due-date write guard | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `92bf8398ee29` | fix(enrollment): surface create validation errors | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `f18df7135ff6` | docs(go-live): record enrollment validation fix | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `55177af00214` | fix(enrollment): use shared reopen reason modal | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `7d80c1091ecc` | docs(go-live): record shared reopen modal | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `68cdb533189d` | fix(enrollment): unify due-date validation | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `a6c8cc42b57c` | docs(go-live): record unified due-date validation | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `ef50046a47af` | fix(enrollment): reject invalid program parameters | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `691d15bfd906` | docs(go-live): record strict program boundary | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `8a4155f63db4` | fix(enrollment): include FUB links in search | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `8ea831f8a707` | docs(go-live): record FUB search fix | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `6feda4ae453a` | fix(enrollment): reconcile archived form options | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `219d91273273` | docs(go-live): record archived option fix | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `dcec66fa4bd4` | fix(enrollment): validate ownership emails | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `12414f38eb8d` | docs(go-live): record ownership validation | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `a974000af4ee` | fix(config): align required checkbox validation | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `b712799fd812` | docs(go-live): record consent required fix | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `fc88006e1e8e` | fix(enrollment): return canonical comment parent version | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `d6c0f023e797` | docs(go-live): record canonical comment version | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `c0960cd6d56c` | fix(enrollment): reconcile attachment storage and counts | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `b5250de38685` | docs(go-live): record attachment reconciliation | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `261901af1900` | fix(enrollment): scope realtime by program | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `818c0b04130f` | docs(go-live): record scoped enrollment realtime | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `973c63acdba9` | fix(enrollment): ignore stale async reloads | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `148a4afedb52` | docs(go-live): record enrollment request ordering | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `f7c1d945d66c` | fix(enrollment): fail closed on truncated lists | F10 | N/A | N/A | F10 | F10 | PASS | F10 | F10 | P2 |
| `0668b9a16663` | docs(go-live): record enrollment truncation guard | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `1b8de1d9a72b` | fix(config): distinguish success and error toasts | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `ee0b0ae7c742` | docs(go-live): record config toast fix | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `e93a24cf7075` | fix(config): apply column invariants on create | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `28542c1982b1` | docs(go-live): record config column invariant fix | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `6b0023b2df10` | fix(config): serialize column patches | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `e8afe7c0ae3d` | docs(go-live): record config patch ordering fix | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `165e4485ae47` | fix(config): isolate scope drafts and refreshes | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `c41b4693eabf` | docs(go-live): record config scope isolation fix | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `0255bd3abc7c` | fix(config): guard stage rule toggles | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `28096422874e` | docs(go-live): record stage rule toggle fix | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `1cfccb088e54` | fix(config): disclose custom required semantics | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `5f32d929fba6` | docs(go-live): record custom required disclosure | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `a318646a606f` | fix(config): require scoped column reads | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `00847800e3c3` | docs(go-live): record scoped config read fix | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `310ec87dd3ce` | fix(enrollment): preserve an active stage | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `44e5b43f72c0` | docs(go-live): record stage cardinality guard | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `2461470814bb` | fix(enrollment): protect workflow option labels | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `68d358825794` | docs(go-live): record workflow label guard | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `3ea385e47844` | perf(config): aggregate enrollment option usage | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `ed653c9bcd57` | docs(go-live): record usage count optimization | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `f867c15ccf1e` | fix(config): report post-commit layout warnings | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `13befec28ff0` | docs(go-live): record config warning containment | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `d19dbb51a227` | fix(config): avoid reserved usage rpc alias | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `97d1383c6239` | docs(go-live): record usage rpc schema correction | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `f1eef1f38d81` | fix(enrollment): fail closed on missing schema | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `bfbd5f343f20` | docs(go-live): record schema fail-closed writes | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `76ef352c1f6a` | fix(config): notify active clients of config changes | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `7aef78cfe2e6` | docs(go-live): record config invalidation banner | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `c599c31dc900` | docs(go-live): record full regression verification | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `c5948d86a80b` | docs(go-live): refresh final risk summary | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `aea802e325cf` | fix(config): broadcast option set invalidation | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `202c4714cb05` | docs(go-live): record config producer coverage | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `fdab65fea4f3` | fix(realtime): preserve scoped option invalidation | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `bd94032a6095` | docs(go-live): record scoped config broadcast correction | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `765432d51b9f` | docs(go-live): record final regression rerun | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `2cd421d28420` | fix(config): restrict usage rpc execution | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `8d0835127a37` | docs(go-live): record usage rpc access hardening | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `82e6107c0c3d` | fix(enrollment): simplify create properties header | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `5fef27464ee7` | docs(go-live): record enrollment dialog copy cleanup | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `2537db1a19e0` | fix(enrollment): remove payment status filter | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `b5a109702181` | docs(go-live): record payment filter removal | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `3334b1cf4bc6` | fix(tasks): allow inline client name edits | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `d0952c51d4ab` | docs(go-live): record task client name editing | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `42a9db761874` | fix(security): restrict security definer rpc execution | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `08e3538c0dd4` | fix(enrollment): restore archive on network failure | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `7c7341edb293` | perf(config): avoid data refetch on column changes | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `29a355f8993b` | docs(go-live): adjudicate claude post-fix review | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `c838e8e2ea3e` | docs(go-live): record claude adjudication regression | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `3ec061653792` | refactor(sla): centralize admin constants and drift tests | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `36e41cc9eb29` | fix(sla): enforce duration upper bound in api | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `30746ba9724e` | feat(config): add SLA times admin section | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `5886f10186ef` | refactor(tasks): move sla management to config | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `fd9894d631f2` | docs(go-live): record SLA config implementation | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `f20392edf9b5` | refactor(enrollment): extract option badge palette into tested module | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `c51691ff86d4` | fix(enrollment): use a surface-aware empty state for person fields | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `f7601b3dc6b3` | docs(changelog): record enrollment person field surface fix | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `912bb000b06c` | fix(enrollment): apply CS identity and state badge languages | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `9369b9e871a1` | docs(changelog): record enrollment list badge language split | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `b86ffbb5c839` | fix(enrollment): show neutral empty option badges | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `9cb8375c2292` | docs(changelog): record neutral enrollment option badges | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `7d6ab454ac8a` | docs(go-live): record enrollment UI standardization verification | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `9ea8358fb6fd` | docs(go-live): mark enrollment UI plan execution | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `e77fbcb5dce5` | fix(sla): constrain editor duration combinations | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `c5b58d100fb4` | fix(sla): serialize rule editor saves | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `0e873641a23a` | fix(sla): restore rule editor after failed saves | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `e134b22a3b19` | test(sla): validate every schema default declaration | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `d15d43f8974f` | style(tasks): soften category badge colours | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `c01d84f24211` | style(enrollment): soften option badge colours | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `6b7ca86df207` | fix(enrollment): match CS option field surfaces | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `a697cb3ae727` | docs(enrollment): log option field surface fix | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `350058662fba` | fix(enrollment): use select placeholders in create form | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `c48863fc99bb` | docs(enrollment): log select placeholder fix | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `ed5bf0cbfc02` | fix(enrollment): remove create program badge | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `4866d8e4a1dc` | docs(enrollment): log program badge removal | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `8e6a549d12f3` | fix(list): open task from client name | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `56ce6eb7a0b8` | docs(enrollment): log client name navigation fix | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `99375158923f` | feat(enrollment): build operations overview metrics | F10 | N/A | N/A | F10 | F10 | PASS | F10 | F10 | P2 |
| `f202992ab730` | feat(enrollment): ship program-specific operations overview | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `823159a1b139` | docs(enrollment): record operations dashboard implementation | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `2eceedee97a5` | feat(seed): assign eligible agents to enrollment sample records | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `6b532387ef5f` | feat(seed): add guarded assistant seeding for permission testing | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `1e5a76383716` | feat(enrollment): add per-action capability resolver | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `b2b3b00a6851` | feat(enrollment): add actor scope resolver | F14 | N/A | N/A | PASS | PASS | F14 | F14 | F14 | P3 |
| `cc86ddba3c0c` | fix(enrollment): scope every record read by actor | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `20b7909ac466` | feat(enrollment): enforce per-action permissions on mutations | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `99698b58936b` | fix(enrollment): scope list overview and export queries | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `50cdd85eb7fc` | feat(enrollment): gate creation and render controls from capabilities | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `c70587b9116c` | feat(rbac): add task export permission catalogue | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `512a738bc465` | fix(export): require task export permission across UI and API | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `ff126067cec8` | chore(rbac): add task export permission rollout sql | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `f2b45caa8c2b` | docs(enrollment): record permission rollout and deployment gate | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `a4f4ccf4de0e` | fix(enrollment): default own assignment filter for plain workers | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `bfada34731f9` | fix(enrollment): protect main content from workflow-only workers | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `4c28d0df17d3` | fix(enrollment): embed FUB link in client column | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `baae642914c5` | fix(enrollment): preserve read-only person colors | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `993db8f4d02f` | style(lists): soften identity badges | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `4724042a7a9e` | feat(ui): add searchable option matching helpers | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `2be5cdb46653` | feat(ui): add shared searchable listbox panel | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `e6fee2c53263` | docs(plan): log searchable dropdown tasks 1 and 2 | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `49ec83dc3a29` | feat(enrollment): add searchable option menus | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `261b9ae44c00` | docs(plan): log enrollment searchable menus | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `2a76381bf1d0` | feat(enrollment): make people filters searchable | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `caa8b9e3b929` | docs(plan): log enrollment people search | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `7fca96cad18e` | feat(tasks): standardize searchable dynamic selectors | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `e0787d95458d` | docs(plan): log health cs selector standardization | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `4acfca413c1f` | refactor(table-config): expose custom value equality | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `1121a0c202e0` | docs(plan): log custom value equality preparation | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `f45954e7a29a` | feat(ui): make custom field menus searchable | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `d6c4d7ea4966` | docs(plan): log custom field menu lifecycle | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `48d649164724` | docs(plan): complete searchable dropdown regression pass | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `cc5e77331bfb` | docs(plan): record regression pass commit | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `0378f1cad902` | docs(enrollment): harden stage tracking plan | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `2b53be643710` | fix(config): align dropdown color previews | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `b1c33a31241e` | feat(config): cycle recommended dropdown colors | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `2173014c9fdf` | fix(seed): backfill enrollment QA sample agents | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `8fc1a96cad94` | docs(plan): record QA agent backfill | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `78208aa44fa5` | fix(comments): flip mention menu above docked composer | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `ab3a7c7915c1` | feat(enrollment): add stage-time tracking schema | F2, F14 | N/A | N/A | PASS | F2 | F14 | F2, F14 | F14 | P1 |
| `224bebb47dce` | feat(enrollment): add atomic enrollment mutation RPCs | F1 | N/A | N/A | PASS | F13 | F1 | F1 | F1 | P0 |
| `d361655cf400` | test(enrollment): add stage tracking SQL assertions | F3 test gap | N/A | N/A | PASS | F3 test gap | PASS | F3 test gap | PASS | P1-linked |
| `fff248cdf2cd` | chore(enrollment): add stage cycle backfill script | F3 | N/A | N/A | PASS | F3 | PASS | F3 | PASS | P1 |
| `051c7701395b` | feat(enrollment): expose stage-time fields and helpers | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `64880484997f` | feat(enrollment): route mutations through atomic RPCs | F7, F16 | N/A | N/A | PASS | F6, F13 | PASS | F6, F7 | F13 | P2 |
| `08948cd058e8` | feat(enrollment): add scoped stage dwell metrics | F10 | N/A | N/A | F10 | F10 | PASS | F10 | F10 | P2 |
| `9df44a956edd` | fix(enrollment): record initial stage history atomically | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `62023f3fedc4` | docs(enrollment): record stage tracking execution evidence | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `441502bd74f9` | docs(enrollment): record production build verification | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `e554e91549a1` | chore(tasks): add collaboration audit script | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `24146e87f20e` | fix(tasks): clamp task version monotonically | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `e520f0e9830a` | feat(tasks): add typed activity contracts | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `b59131d2bc38` | fix(task-detail): isolate unsignable attachments | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `fb7fd68ba967` | fix(attachments): delete metadata before storage cleanup | F9 | N/A | N/A | PASS | PASS | PASS | F9 | F9 | P2 |
| `a4130c71ff78` | docs(tasks): record task 5 execution | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `f48e1e119bdc` | fix(comments): create comments atomically and idempotently | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `94d7b09699b5` | docs(tasks): record task 6 execution | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `9dcf7a1817b6` | fix(comments): guard duplicate submissions across task and enrollment | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `728e299dbf45` | docs(tasks): record task 7 execution | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `19f9f44d6e24` | fix(comments): separate comment and file upload state | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `c51eafa1282d` | docs(tasks): record task 8 execution | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `923075b7e740` | fix(attachments): make uploads idempotent with compensation | F4 | N/A | N/A | PASS | F4 | PASS | PASS | F4 | P2 |
| `af8060fc0038` | docs(tasks): record task 9 execution | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `c9249a2460a1` | fix(comments): add atomic compare-and-swap edits | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `eeeddfd66a8a` | docs(tasks): record task 10 execution | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `4ce4f97dfbdb` | fix(comments): soft-delete comments and linked attachments atomically | F9 | N/A | N/A | PASS | PASS | PASS | F9 | F9 | P2 |
| `ce3ebc7261cc` | docs(tasks): record task 11 execution | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `8a028e931233` | fix(activity): pair last-activity actor with timestamp | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `3f741e29e95b` | docs(tasks): record task 12 execution | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `2be2df95ba78` | fix(tasks): record assignee removals accurately | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `c10f567d82f7` | docs(tasks): record task 13 execution | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `ac2e23b756e9` | fix(tasks): create tasks atomically and idempotently | F8 | N/A | N/A | PASS | F8 | PASS | F8 | F8 | P2 |
| `3e0521ee6462` | docs(tasks): record task 14 execution | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `6b9c0ddd5794` | fix(activity): make overdue transition atomic and idempotent | PASS | N/A | N/A | F12 | F12 | PASS | F12 | PASS | P2 |
| `e539de5693a2` | docs(tasks): record task 15 execution | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `f88ec8fff0b0` | fix(comments): resolve canonical author and editor names | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `42e15abf3732` | docs(tasks): record task 16 execution | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `c28ad4451971` | fix(comments): unify searchable mentions across create reply and edit | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `a344eb3a9c0d` | docs(plan): record unified mention implementation | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `d3f4052faa7a` | fix(task-detail): authorize before privileged reads | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `c32dea6a5518` | docs(plan): record task detail authorization | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `91235d9d20a7` | fix(task-detail): expire and invalidate detail cache | PASS | N/A | N/A | F15 | F15 | PASS | PASS | PASS | P3 |
| `4e6b454e855d` | docs(plan): record task detail cache hardening | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `062bed575672` | fix(tasks): enforce collaboration operation limits | F5 | N/A | N/A | F5 concurrency | F5 | PASS | F5 | PASS | P2 |
| `7c1ee1e5c98e` | docs(plan): record collaboration operation limits | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `b4ad295811b5` | fix(tasks): enforce same-task collaboration invariants | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `df4635bf6b4f` | docs(plan): record same-task invariant audit | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `968b093894b6` | fix(activity): align feed labels with allowed vocabulary | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `2029f7880095` | docs(plan): record activity vocabulary alignment | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `f8af6f1d93b2` | fix(comments): fix thread navigation, counters and mutation feedback | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `c8e46df3cd42` | docs(tasks): record thread navigation verification | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `b49eeaa07f28` | fix(comments): harden attachment presentation and preview | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `0ebad81e0d62` | docs(tasks): record attachment UI verification | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `252f8e387e19` | docs(tasks): record collaboration hardening verification | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `c335c237d2d6` | docs(tasks): link final reconciliation commit | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |
| `a55842906fd3` | fix(schema): correct task actor backfill correlation | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | None |
| `ed9935985a94` | docs(tasks): record actor backfill SQL correction | N/A (DOC) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | None |

## Commit-by-Commit Review

The detailed ledger below supplies the required author, timestamp, parent, files, line counts, subsystem, intent, blast radius, and individual review result for every commit. `DOC` means the commit changed documentation/changelog only; it was checked for contradictory rollout claims but has no executable blast radius. `PASS` means no material regression was identified after reading the individual diff and checking its interaction with final code. `F#` references the findings above in order of appearance.

| # | Commit | Author / timestamp / parent | Files / lines | Subsystem | Intent | Blast radius | Review |
|---:|---|---|---|---|---|---|---|
| 1 | `be706b0a49575e49adba33f65891bf8358863f0a` | BaoVoThuong<br>2026-08-07T00:53:04+07:00<br>parent `cc75e9ab0c8a74279240a1bb6523c7e87c790435` | 17 files; +3716/-564<br>`changelog.md`, `docs/superpowers/plans/2026-08-04-fix-admin-hidden-field-visibility.md`, `src/app/(authed)/config/_components/ConfigClient.tsx`, `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`, `src/app/(authed)/tasks/_components/NewTaskDialog.tsx`, `src/app/(authed)/tasks/_components/TaskBoardClient.tsx`, `src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx`, `src/app/(authed)/tasks/_components/TaskRowItem.tsx`, `src/app/api/config/columns/[id]/route.ts`, `src/app/api/enrollment/[id]/route.ts`, `src/app/api/enrollment/route.ts`, `src/app/api/tasks/[id]/route.ts`, `src/app/api/tasks/route.ts`, `src/lib/table-config/columns.test.ts`, `src/lib/table-config/columns.ts`, `src/lib/table-config/required.ts`, `supabase/schema.sql` | Database / migration | feat(tasks): Required field thật theo table_column config + Stage field ở Create/Detail | Schema, deployment order, and all affected API consumers | PASS — individual diff and final interaction checked; no material regression identified |
| 2 | `91c516c53b42b5e35ebc6c8287f8987b4d0c8c94` | BaoVoThuong<br>2026-08-07T01:32:04+07:00<br>parent `be706b0a49575e49adba33f65891bf8358863f0a` | 8 files; +1278/-67<br>`changelog.md`, `docs/superpowers/plans/2026-08-07-sla-config-section.md`, `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`, `src/app/(authed)/tasks/_components/NewTaskDialog.tsx`, `src/app/(authed)/tasks/_components/TaskBoardClient.tsx`, `src/app/api/enrollment/[id]/route.ts`, `src/lib/enrollment/access.ts`, `src/lib/table-config/values.ts` | Enrollment | fix(ui): align CS/Enrollment Create+Detail UI, tighten Archive perms, default List view | ACA and Medicare list/detail/create/API flows | PASS — individual diff and final interaction checked; no material regression identified |
| 3 | `3029620025e1c8149bdcfe9248628dd0ccc4b3a4` | BaoVoThuong<br>2026-08-08T00:40:48+07:00<br>parent `91c516c53b42b5e35ebc6c8287f8987b4d0c8c94` | 14 files; +801/-109<br>`changelog.md`, `docs/superpowers/plans/2026-08-07-column-config-hardcoding-DRAFT.md`, `docs/superpowers/plans/2026-08-07-column-config-hardcoding-audit.md`, `docs/superpowers/plans/2026-08-07-column-config-hardcoding-fix.md`, `src/app/(authed)/config/_components/ConfigClient.tsx`, `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`, `src/app/(authed)/tasks/_components/KanbanBoard.tsx`, `src/app/(authed)/tasks/_components/NewTaskDialog.tsx`, `src/app/(authed)/tasks/_components/TaskBoardClient.tsx`, `src/app/(authed)/tasks/_components/TaskCard.tsx`, `src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx`, `src/app/(authed)/tasks/_components/TaskToolbar.tsx`, `src/lib/table-config/queries.ts`, `supabase/schema.sql` | Database / migration | fix(table-config): make column labels config-driven end to end, add archive confirm | Schema, deployment order, and all affected API consumers | PASS — individual diff and final interaction checked; no material regression identified |
| 4 | `df561ef9e4021f297f90e2bf4adfa079b9111d54` | BaoVoThuong<br>2026-08-08T16:48:11+07:00<br>parent `3029620025e1c8149bdcfe9248628dd0ccc4b3a4` | 16 files; +796/-123<br>`changelog.md`, `docs/superpowers/plans/2026-08-08-task-module-state-architecture.md`, `src/app/(authed)/_shared/Toast.tsx`, `src/app/(authed)/account-manager/AccountManagerClient.tsx`, `src/app/(authed)/config/_components/ConfigClient.tsx`, `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`, `src/app/(authed)/role-manager/RoleManagerClient.tsx`, `src/app/(authed)/tasks/_components/CommentThread.tsx`, `src/app/(authed)/tasks/_components/TaskBoardClient.tsx`, `src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx`, `src/app/api/config/columns/[id]/route.ts`, `src/app/api/enrollment/[id]/comments/route.ts`, `src/app/api/tasks/[id]/comments/route.ts`, `src/lib/table-config/columns.test.ts`, `src/lib/table-config/columns.ts`, `src/lib/tasks/last-activity.ts` | Enrollment | fix(tasks): stop the A-B-A-B UI revert across CS/Enrollment/Config | ACA and Medicare list/detail/create/API flows | PASS — individual diff and final interaction checked; no material regression identified |
| 5 | `4fdac30b72d449c409ae6acf1165593f70086ca1` | BaoVoThuong<br>2026-08-08T18:30:58+07:00<br>parent `df561ef9e4021f297f90e2bf4adfa079b9111d54` | 15 files; +32/-1658<br>`src/app/(authed)/_components/HealthTableImportDialog.tsx`, `src/app/(authed)/config/_components/ConfigClient.tsx`, `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`, `src/app/(authed)/enrollment/page.tsx`, `src/app/(authed)/tasks/_components/TaskBoardClient.tsx`, `src/app/(authed)/tasks/page.tsx`, `src/app/api/config/imports/[id]/route.ts`, `src/app/api/config/imports/route.ts`, `src/app/api/enrollment/export/route.ts`, `src/app/api/tasks/export/route.ts`, `src/lib/table-config/export-access.test.ts`, `src/lib/table-config/export-access.ts`, `src/lib/table-config/import.test.ts`, `src/lib/table-config/import.ts`, `src/lib/table-config/sheet-io.ts` | Enrollment | feat(config): remove import workflow, preserve export | ACA and Medicare list/detail/create/API flows | PASS — individual diff and final interaction checked; no material regression identified |
| 6 | `dc4ffaa9fa8ccb489eb0e1d8f9fe857059107948` | BaoVoThuong<br>2026-08-08T18:31:10+07:00<br>parent `4fdac30b72d449c409ae6acf1165593f70086ca1` | 1 files; +1587/-0<br>`docs/codex_review_code.md` | Documentation | docs(go-live): record import removal execution | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 7 | `cdd06de23880308c0773179778949d9654353dd7` | BaoVoThuong<br>2026-08-08T18:32:20+07:00<br>parent `dc4ffaa9fa8ccb489eb0e1d8f9fe857059107948` | 1 files; +16/-19<br>`src/app/(authed)/tasks/_components/TaskBoardClient.tsx` | Security / permissions | fix(tasks): hydrate layout once per board mount | Authorization and export surface across modules | PASS — individual diff and final interaction checked; no material regression identified |
| 8 | `5fd0d9f91aec4a70c9a4d0acc8807bca93c708b9` | BaoVoThuong<br>2026-08-08T18:32:34+07:00<br>parent `cdd06de23880308c0773179778949d9654353dd7` | 1 files; +1/-0<br>`docs/codex_review_code.md` | Documentation | docs(go-live): record tasks layout fix | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 9 | `81e8562c919e5c082868f7300cd4f2895dc15419` | BaoVoThuong<br>2026-08-08T18:36:22+07:00<br>parent `5fd0d9f91aec4a70c9a4d0acc8807bca93c708b9` | 1 files; +121/-37<br>`src/app/(authed)/tasks/_components/TaskBoardClient.tsx` | Security / permissions | fix(tasks): serialize patches against canonical versions | Authorization and export surface across modules | PASS — individual diff and final interaction checked; no material regression identified |
| 10 | `90f3bf2784032a120453030cd59c6b45523b2de6` | BaoVoThuong<br>2026-08-08T18:36:32+07:00<br>parent `81e8562c919e5c082868f7300cd4f2895dc15419` | 1 files; +1/-0<br>`docs/codex_review_code.md` | Documentation | docs(go-live): record task mutation race fix | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 11 | `d608d9cf1fbd7311acf664bf43ff1fa5faaf048b` | BaoVoThuong<br>2026-08-08T18:40:26+07:00<br>parent `90f3bf2784032a120453030cd59c6b45523b2de6` | 2 files; +91/-20<br>`src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`, `src/app/(authed)/enrollment/_components/EnrollmentOverview.tsx` | Security / permissions | fix(enrollment): disable record controls without edit access | Authorization and export surface across modules | PASS — individual diff and final interaction checked; no material regression identified |
| 12 | `bc7f774d84a2a53600afa82e6fdd83d65bc68c01` | BaoVoThuong<br>2026-08-08T18:40:36+07:00<br>parent `d608d9cf1fbd7311acf664bf43ff1fa5faaf048b` | 1 files; +1/-0<br>`docs/codex_review_code.md` | Documentation | docs(go-live): record enrollment permission fix | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 13 | `fc00dbec5ceb5cf91d645111aa8434c26d7d186e` | BaoVoThuong<br>2026-08-08T18:42:50+07:00<br>parent `bc7f774d84a2a53600afa82e6fdd83d65bc68c01` | 1 files; +142/-45<br>`src/app/(authed)/enrollment/_components/EnrollmentClient.tsx` | Security / permissions | fix(enrollment): serialize record patches and rebase conflicts | Authorization and export surface across modules | PASS — individual diff and final interaction checked; no material regression identified |
| 14 | `4c3491bf0a0e8cc77bbac25237a2f9840a0caf80` | BaoVoThuong<br>2026-08-08T18:43:01+07:00<br>parent `fc00dbec5ceb5cf91d645111aa8434c26d7d186e` | 1 files; +1/-0<br>`docs/codex_review_code.md` | Documentation | docs(go-live): record enrollment mutation race fix | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 15 | `2c7b96e499760643343d2e0915444383c972f207` | BaoVoThuong<br>2026-08-08T18:44:16+07:00<br>parent `4c3491bf0a0e8cc77bbac25237a2f9840a0caf80` | 1 files; +20/-5<br>`src/app/(authed)/enrollment/_components/EnrollmentClient.tsx` | Security / permissions | fix(enrollment): keep creator records in my default view | Authorization and export surface across modules | PASS — individual diff and final interaction checked; no material regression identified |
| 16 | `c980fb57b756515fb340535e9fff0f01d05aa9e3` | BaoVoThuong<br>2026-08-08T18:44:26+07:00<br>parent `2c7b96e499760643343d2e0915444383c972f207` | 1 files; +1/-0<br>`docs/codex_review_code.md` | Documentation | docs(go-live): record enrollment visibility fix | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 17 | `e219c9105df733330971ce602cb96f322ff8470c` | BaoVoThuong<br>2026-08-08T18:46:02+07:00<br>parent `c980fb57b756515fb340535e9fff0f01d05aa9e3` | 1 files; +74/-21<br>`src/app/api/tasks/[id]/route.ts` | Tasks | fix(tasks): report committed mutation side-effect failures | Health CS task list/detail/API flows | PASS — individual diff and final interaction checked; no material regression identified |
| 18 | `e3443716dcd79351395f60f5fbed68199bef6134` | BaoVoThuong<br>2026-08-08T18:46:12+07:00<br>parent `e219c9105df733330971ce602cb96f322ff8470c` | 1 files; +1/-0<br>`docs/codex_review_code.md` | Documentation | docs(go-live): record task mutation warning handling | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 19 | `f95ebbe72369af29da0dcd461bb4bdcbb9b1c433` | BaoVoThuong<br>2026-08-08T18:47:31+07:00<br>parent `e3443716dcd79351395f60f5fbed68199bef6134` | 2 files; +144/-37<br>`src/app/api/enrollment/[id]/route.ts`, `src/app/api/enrollment/route.ts` | Enrollment | fix(enrollment): report committed side-effect warnings | ACA and Medicare list/detail/create/API flows | PASS — individual diff and final interaction checked; no material regression identified |
| 20 | `97af7f0c1b17b1fe257714f66ba4d977b37819b0` | BaoVoThuong<br>2026-08-08T18:47:44+07:00<br>parent `f95ebbe72369af29da0dcd461bb4bdcbb9b1c433` | 1 files; +1/-0<br>`docs/codex_review_code.md` | Documentation | docs(go-live): record enrollment mutation warning handling | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 21 | `802493a434f783d46ce4c61a5645c49e2d26fa70` | BaoVoThuong<br>2026-08-08T18:48:23+07:00<br>parent `97af7f0c1b17b1fe257714f66ba4d977b37819b0` | 1 files; +9/-2<br>`src/app/(authed)/enrollment/_components/EnrollmentClient.tsx` | Security / permissions | fix(enrollment): restore only failed archive row | Authorization and export surface across modules | PASS — individual diff and final interaction checked; no material regression identified |
| 22 | `211c26580a1e1c6e85a2e52fd4a61bed9a3db8b2` | BaoVoThuong<br>2026-08-08T18:48:36+07:00<br>parent `802493a434f783d46ce4c61a5645c49e2d26fa70` | 1 files; +1/-0<br>`docs/codex_review_code.md` | Documentation | docs(go-live): record archive rollback fix | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 23 | `373a4dc097ab0f14186d264a3a01cd1d4f6df327` | BaoVoThuong<br>2026-08-08T18:48:52+07:00<br>parent `211c26580a1e1c6e85a2e52fd4a61bed9a3db8b2` | 1 files; +4/-1<br>`src/app/api/enrollment/[id]/route.ts` | Enrollment | fix(enrollment): return canonical stats for no-op patches | ACA and Medicare list/detail/create/API flows | PASS — individual diff and final interaction checked; no material regression identified |
| 24 | `6ffb5435151e7a6156347c7932f8caad3cf1b51f` | BaoVoThuong<br>2026-08-08T18:49:01+07:00<br>parent `373a4dc097ab0f14186d264a3a01cd1d4f6df327` | 1 files; +1/-0<br>`docs/codex_review_code.md` | Documentation | docs(go-live): record enrollment no-op fix | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 25 | `f9c164386295e73846f5c5bf29aa8fc649bc06d5` | BaoVoThuong<br>2026-08-08T18:49:21+07:00<br>parent `6ffb5435151e7a6156347c7932f8caad3cf1b51f` | 1 files; +15/-3<br>`src/app/(authed)/tasks/_components/TaskBoardClient.tsx` | Security / permissions | fix(tasks): restore only failed archive task | Authorization and export surface across modules | PASS — individual diff and final interaction checked; no material regression identified |
| 26 | `fb6c2a704ba54c3d6a7bd050036e6f6b6225cb00` | BaoVoThuong<br>2026-08-08T18:49:32+07:00<br>parent `f9c164386295e73846f5c5bf29aa8fc649bc06d5` | 1 files; +1/-0<br>`docs/codex_review_code.md` | Documentation | docs(go-live): record task archive rollback fix | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 27 | `874b725ee8554f03d6855ef670c42618ae75903c` | BaoVoThuong<br>2026-08-08T18:54:25+07:00<br>parent `fb6c2a704ba54c3d6a7bd050036e6f6b6225cb00` | 1 files; +42/-45<br>`docs/codex_review_code.md` | Documentation | docs(go-live): reconcile execution status and verification gates | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 28 | `4f59280b82bcc725b67c28b2bfff673a4e229d80` | BaoVoThuong<br>2026-08-08T19:53:44+07:00<br>parent `874b725ee8554f03d6855ef670c42618ae75903c` | 2 files; +321/-96<br>`src/app/api/tasks/[id]/route.ts`, `supabase/schema.sql` | Database / migration | fix(tasks): commit canonical mutation and history atomically | Schema, deployment order, and all affected API consumers | PASS — individual diff and final interaction checked; no material regression identified |
| 29 | `9af6262c3dc08b4d462a41545b6f4794d27d4016` | BaoVoThuong<br>2026-08-08T19:55:09+07:00<br>parent `4f59280b82bcc725b67c28b2bfff673a4e229d80` | 1 files; +20/-19<br>`docs/codex_review_code.md` | Documentation | docs(go-live): record atomic task mutation fix | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 30 | `50bbadf6f3bd632d158f01d5209250d31f4d15d7` | BaoVoThuong<br>2026-08-08T19:55:36+07:00<br>parent `9af6262c3dc08b4d462a41545b6f4794d27d4016` | 1 files; +2/-2<br>`docs/codex_review_code.md` | Documentation | docs(go-live): clarify task atomicity scope | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 31 | `16ad882d8b91f69ba483bfc7d90d5faecef222da` | BaoVoThuong<br>2026-08-08T20:03:28+07:00<br>parent `50bbadf6f3bd632d158f01d5209250d31f4d15d7` | 7 files; +436/-260<br>`src/app/(authed)/tasks/_components/TaskBoardClient.tsx`, `src/app/api/tasks/[id]/assignees/[email]/route.ts`, `src/app/api/tasks/[id]/assignees/route.ts`, `src/app/api/tasks/[id]/overdue-unlock/route.ts`, `src/app/api/tasks/[id]/reopen/route.ts`, `src/app/api/tasks/[id]/route.ts`, `supabase/schema.sql` | Database / migration | fix(tasks): add optimistic concurrency to special actions | Schema, deployment order, and all affected API consumers | PASS — individual diff and final interaction checked; no material regression identified |
| 32 | `5059f304515741b5fb11d007d60476413319794c` | BaoVoThuong<br>2026-08-08T20:04:25+07:00<br>parent `16ad882d8b91f69ba483bfc7d90d5faecef222da` | 1 files; +11/-10<br>`docs/codex_review_code.md` | Documentation | docs(go-live): record special-action concurrency fix | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 33 | `82885a3897ab252428dca08db130d32ed6e0099e` | BaoVoThuong<br>2026-08-08T20:08:33+07:00<br>parent `5059f304515741b5fb11d007d60476413319794c` | 2 files; +281/-168<br>`src/app/(authed)/tasks/_components/TaskSearchBox.tsx`, `src/lib/tasks/search.ts` | Tasks | fix(tasks): paginate visible search results and render files | Health CS task list/detail/API flows | F11/P2 — task search query amplification |
| 34 | `4da59a005667dd47fff4489d492c3e6d4b53aec2` | BaoVoThuong<br>2026-08-08T20:09:26+07:00<br>parent `82885a3897ab252428dca08db130d32ed6e0099e` | 1 files; +10/-9<br>`docs/codex_review_code.md` | Documentation | docs(go-live): record searchable task result fix | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 35 | `ff87eaff458ce35f443ccdf3c57336cdb0da232b` | BaoVoThuong<br>2026-08-08T20:19:22+07:00<br>parent `4da59a005667dd47fff4489d492c3e6d4b53aec2` | 6 files; +112/-27<br>`src/app/(authed)/tasks/_components/TaskBoardClient.tsx`, `src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx`, `src/app/api/tasks/[id]/detail/route.ts`, `src/lib/tasks/detail.ts`, `src/lib/tasks/queries.test.ts`, `src/lib/tasks/queries.ts` | Tasks | fix(tasks): reconcile list metadata after detail mutations | Health CS task list/detail/API flows | PASS — individual diff and final interaction checked; no material regression identified |
| 36 | `93b82eb40bdcb87fc7a3d2cafc18c18207f1aa7b` | BaoVoThuong<br>2026-08-08T20:20:52+07:00<br>parent `ff87eaff458ce35f443ccdf3c57336cdb0da232b` | 1 files; +12/-11<br>`docs/codex_review_code.md` | Documentation | docs(go-live): record task metadata reconciliation | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 37 | `a52156e59a48ce7b052388a89fd865edb796f9bc` | BaoVoThuong<br>2026-08-08T20:23:45+07:00<br>parent `93b82eb40bdcb87fc7a3d2cafc18c18207f1aa7b` | 4 files; +92/-7<br>`src/app/(authed)/tasks/_components/TaskBoardClient.tsx`, `src/app/api/tasks/route.ts`, `src/lib/tasks/queries.test.ts`, `src/lib/tasks/queries.ts` | Tasks | fix(tasks): detect truncated list responses | Health CS task list/detail/API flows | F10/P2 — capped/unpaged list or auxiliary data path |
| 38 | `14c22c11e7a1a3c5e091676a061d046ffa25bf73` | BaoVoThuong<br>2026-08-08T20:24:38+07:00<br>parent `a52156e59a48ce7b052388a89fd865edb796f9bc` | 1 files; +13/-11<br>`docs/codex_review_code.md` | Documentation | docs(go-live): record task truncation guard | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 39 | `036984e9280b381eb8e78385f3f7f2d2646bc3ef` | BaoVoThuong<br>2026-08-08T20:26:44+07:00<br>parent `14c22c11e7a1a3c5e091676a061d046ffa25bf73` | 1 files; +25/-10<br>`src/app/(authed)/tasks/_components/TaskBoardClient.tsx` | Security / permissions | fix(tasks): stabilize realtime subscription lifecycle | Authorization and export surface across modules | PASS — individual diff and final interaction checked; no material regression identified |
| 40 | `2e22c5122666f2dde509b8e7b85fcb9f43f8140d` | BaoVoThuong<br>2026-08-08T20:27:17+07:00<br>parent `036984e9280b381eb8e78385f3f7f2d2646bc3ef` | 1 files; +12/-10<br>`docs/codex_review_code.md` | Documentation | docs(go-live): record realtime subscription stabilization | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 41 | `e77cb7884a411a0799b41941b7d3bda62239ec72` | BaoVoThuong<br>2026-08-08T20:31:03+07:00<br>parent `2e22c5122666f2dde509b8e7b85fcb9f43f8140d` | 1 files; +98/-0<br>`src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx` | Security / permissions | fix(tasks): reconcile drawer drafts with external updates | Authorization and export surface across modules | PASS — individual diff and final interaction checked; no material regression identified |
| 42 | `9204df42a6ce56d73e57c7e67cc448647677c820` | BaoVoThuong<br>2026-08-08T20:31:39+07:00<br>parent `e77cb7884a411a0799b41941b7d3bda62239ec72` | 1 files; +9/-8<br>`docs/codex_review_code.md` | Documentation | docs(go-live): record drawer draft reconciliation | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 43 | `16203e3b231ee155307bf05005e5c7a995e42afc` | BaoVoThuong<br>2026-08-08T20:33:24+07:00<br>parent `9204df42a6ce56d73e57c7e67cc448647677c820` | 1 files; +6/-5<br>`src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx` | Security / permissions | fix(tasks): align archive confirmation copy | Authorization and export surface across modules | PASS — individual diff and final interaction checked; no material regression identified |
| 44 | `37a89d5d56b7329c41d043bc930598f2df87b293` | BaoVoThuong<br>2026-08-08T20:33:52+07:00<br>parent `16203e3b231ee155307bf05005e5c7a995e42afc` | 1 files; +8/-7<br>`docs/codex_review_code.md` | Documentation | docs(go-live): record archive confirmation semantics | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 45 | `d6fbe37ab3c14852fc3a83898f62bb770c6ecb04` | BaoVoThuong<br>2026-08-08T20:35:47+07:00<br>parent `37a89d5d56b7329c41d043bc930598f2df87b293` | 2 files; +49/-9<br>`src/lib/tasks/queries.test.ts`, `src/lib/tasks/queries.ts` | Tasks | fix(tasks): escape permission filter identities | Health CS task list/detail/API flows | PASS — individual diff and final interaction checked; no material regression identified |
| 46 | `f43fbf0b0eeae9b0a7f77efcbf8c6b7179a9df3b` | BaoVoThuong<br>2026-08-08T20:36:16+07:00<br>parent `d6fbe37ab3c14852fc3a83898f62bb770c6ecb04` | 1 files; +10/-9<br>`docs/codex_review_code.md` | Documentation | docs(go-live): record permission filter hardening | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 47 | `17b86e24e964d3d51ba50d2fa229ca63bb74e3bd` | BaoVoThuong<br>2026-08-08T20:38:22+07:00<br>parent `f43fbf0b0eeae9b0a7f77efcbf8c6b7179a9df3b` | 5 files; +70/-38<br>`src/app/api/cron/check-enrollment-due/route.ts`, `src/app/api/cron/check-overdue/route.ts`, `src/app/api/cron/sync-data/route.ts`, `src/lib/cron-auth.test.ts`, `src/lib/cron-auth.ts` | Security / permissions | fix(security): require bearer auth for cron routes | Authorization and export surface across modules | PASS — individual diff and final interaction checked; no material regression identified |
| 48 | `841f51044d783e25049a3b5cbc45265c3cc3ea82` | BaoVoThuong<br>2026-08-08T20:39:29+07:00<br>parent `17b86e24e964d3d51ba50d2fa229ca63bb74e3bd` | 1 files; +13/-11<br>`docs/codex_review_code.md` | Documentation | docs(go-live): record cron auth hardening | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 49 | `bb6dca351f0485f98b0c7421c31f750d3520e007` | BaoVoThuong<br>2026-08-08T20:39:56+07:00<br>parent `841f51044d783e25049a3b5cbc45265c3cc3ea82` | 1 files; +2/-1<br>`src/app/api/cron/check-overdue/route.ts` | Shared application | docs(ops): align overdue scheduler ownership | Shared UI/runtime consumers named by the changed files | PASS — individual diff and final interaction checked; no material regression identified |
| 50 | `28adc4a07b647abf42d2e869733714fd62c71b77` | BaoVoThuong<br>2026-08-08T20:40:58+07:00<br>parent `bb6dca351f0485f98b0c7421c31f750d3520e007` | 1 files; +5/-4<br>`docs/codex_review_code.md` | Documentation | docs(go-live): record scheduler ownership gate | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 51 | `fac06e7ef81dd69ad439cbf5e6bea586a7565b4b` | BaoVoThuong<br>2026-08-08T20:41:47+07:00<br>parent `28adc4a07b647abf42d2e869733714fd62c71b77` | 1 files; +2/-2<br>`src/app/(authed)/tasks/_components/TaskBoardClient.tsx` | Security / permissions | fix(tasks): use toast for export failures | Authorization and export surface across modules | PASS — individual diff and final interaction checked; no material regression identified |
| 52 | `612e377cb53292d1091d868bdb6d94cb7fff0d2e` | BaoVoThuong<br>2026-08-08T20:42:31+07:00<br>parent `fac06e7ef81dd69ad439cbf5e6bea586a7565b4b` | 1 files; +8/-7<br>`docs/codex_review_code.md` | Documentation | docs(go-live): record task error-surface fix | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 53 | `c6dfc3db674316a20042bef5a57b9c7999a143ed` | BaoVoThuong<br>2026-08-08T20:43:45+07:00<br>parent `612e377cb53292d1091d868bdb6d94cb7fff0d2e` | 4 files; +36/-5<br>`src/app/api/config/columns/route.ts`, `src/app/api/config/layout/route.ts`, `src/lib/table-config/types.test.ts`, `src/lib/table-config/types.ts` | Config / SLA | fix(config): reject invalid table scopes | Configuration plus downstream task/enrollment behavior | PASS — individual diff and final interaction checked; no material regression identified |
| 54 | `c02e78852ae737badaf421210237ecff615963a2` | BaoVoThuong<br>2026-08-08T20:44:37+07:00<br>parent `c6dfc3db674316a20042bef5a57b9c7999a143ed` | 1 files; +9/-7<br>`docs/codex_review_code.md` | Documentation | docs(go-live): record strict config scope fix | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 55 | `38e6409f55d80855bf7e0443fbc562e7e50c82fa` | BaoVoThuong<br>2026-08-08T20:49:58+07:00<br>parent `c02e78852ae737badaf421210237ecff615963a2` | 3 files; +169/-45<br>`src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`, `src/app/(authed)/tasks/_components/TaskBoardClient.tsx`, `src/app/api/config/layout/route.ts` | Config / SLA | fix(config): serialize layout writes with version checks | Configuration plus downstream task/enrollment behavior | PASS — individual diff and final interaction checked; no material regression identified |
| 56 | `ec4218f52b13f87dcb5a33a86139fcc1777fc460` | BaoVoThuong<br>2026-08-08T20:51:02+07:00<br>parent `38e6409f55d80855bf7e0443fbc562e7e50c82fa` | 1 files; +9/-7<br>`docs/codex_review_code.md` | Documentation | docs(go-live): record versioned layout writes | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 57 | `c0abf1662e802fb320f2849c031caeda285bea3c` | BaoVoThuong<br>2026-08-08T20:51:59+07:00<br>parent `ec4218f52b13f87dcb5a33a86139fcc1777fc460` | 4 files; +59/-0<br>`src/app/(authed)/_components/TablePageSkeleton.tsx`, `src/app/(authed)/config/loading.tsx`, `src/app/(authed)/enrollment/loading.tsx`, `src/app/(authed)/tasks/loading.tsx` | Config / SLA | fix(ui): add table-shaped module loading states | Configuration plus downstream task/enrollment behavior | PASS — individual diff and final interaction checked; no material regression identified |
| 58 | `c816ed9a70d63c9b77f64ff06350aa8193d982c3` | BaoVoThuong<br>2026-08-08T20:52:20+07:00<br>parent `c0abf1662e802fb320f2849c031caeda285bea3c` | 1 files; +1/-1<br>`src/app/(authed)/config/_components/ConfigClient.tsx` | Config / SLA | fix(config): preserve new-column input contrast | Configuration plus downstream task/enrollment behavior | PASS — individual diff and final interaction checked; no material regression identified |
| 59 | `70d09822fe46eff5e7b1755741038437209d989e` | BaoVoThuong<br>2026-08-08T20:53:43+07:00<br>parent `c816ed9a70d63c9b77f64ff06350aa8193d982c3` | 1 files; +14/-11<br>`docs/codex_review_code.md` | Documentation | docs(go-live): record cross-module ui fixes | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 60 | `3a5bd97a1ccc71e7fad645b0eac469c5bc2c7f91` | BaoVoThuong<br>2026-08-08T20:54:18+07:00<br>parent `70d09822fe46eff5e7b1755741038437209d989e` | 1 files; +1/-1<br>`src/app/(authed)/tasks/_components/TaskBoardClient.tsx` | Security / permissions | fix(tasks): preserve task detail deep links | Authorization and export surface across modules | PASS — individual diff and final interaction checked; no material regression identified |
| 61 | `769deb29d9739db60f84683a49f27326d8bdb3ae` | BaoVoThuong<br>2026-08-08T20:55:16+07:00<br>parent `3a5bd97a1ccc71e7fad645b0eac469c5bc2c7f91` | 1 files; +8/-6<br>`docs/codex_review_code.md` | Documentation | docs(go-live): record detail deep-link fix | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 62 | `054c11efed92263ec10722cbc8460a724dc601b3` | BaoVoThuong<br>2026-08-08T20:56:46+07:00<br>parent `769deb29d9739db60f84683a49f27326d8bdb3ae` | 1 files; +13/-2<br>`src/app/(authed)/enrollment/_components/EnrollmentClient.tsx` | Security / permissions | fix(enrollment): skip unchanged layout autosaves | Authorization and export surface across modules | PASS — individual diff and final interaction checked; no material regression identified |
| 63 | `ae121ce74d86105283eb5e09618fe0779925b560` | BaoVoThuong<br>2026-08-08T20:57:56+07:00<br>parent `054c11efed92263ec10722cbc8460a724dc601b3` | 1 files; +8/-6<br>`docs/codex_review_code.md` | Documentation | docs(go-live): record enrollment layout autosave guard | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 64 | `10ddc4374dbc96cadd407819b862c80f1e8e96a9` | BaoVoThuong<br>2026-08-08T20:58:16+07:00<br>parent `ae121ce74d86105283eb5e09618fe0779925b560` | 1 files; +5/-3<br>`src/app/(authed)/enrollment/_components/EnrollmentClient.tsx` | Security / permissions | fix(enrollment): skip unchanged due-date writes | Authorization and export surface across modules | PASS — individual diff and final interaction checked; no material regression identified |
| 65 | `367caf01ecb4c3b0dfd899b22f43c2735a06e8a9` | BaoVoThuong<br>2026-08-08T20:59:12+07:00<br>parent `10ddc4374dbc96cadd407819b862c80f1e8e96a9` | 1 files; +8/-6<br>`docs/codex_review_code.md` | Documentation | docs(go-live): record due-date write guard | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 66 | `92bf8398ee290533845a1b0b811c26319508639d` | BaoVoThuong<br>2026-08-08T21:00:24+07:00<br>parent `367caf01ecb4c3b0dfd899b22f43c2735a06e8a9` | 1 files; +21/-2<br>`src/app/(authed)/enrollment/_components/EnrollmentClient.tsx` | Security / permissions | fix(enrollment): surface create validation errors | Authorization and export surface across modules | PASS — individual diff and final interaction checked; no material regression identified |
| 67 | `f18df7135ff6d8bbd8942baebc6bbc409395c8e6` | BaoVoThuong<br>2026-08-08T21:01:05+07:00<br>parent `92bf8398ee290533845a1b0b811c26319508639d` | 1 files; +8/-6<br>`docs/codex_review_code.md` | Documentation | docs(go-live): record enrollment validation fix | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 68 | `55177af002148ff26ab9174b1a10f7129d1e5e0c` | BaoVoThuong<br>2026-08-08T21:01:37+07:00<br>parent `f18df7135ff6d8bbd8942baebc6bbc409395c8e6` | 1 files; +28/-3<br>`src/app/(authed)/enrollment/_components/EnrollmentClient.tsx` | Security / permissions | fix(enrollment): use shared reopen reason modal | Authorization and export surface across modules | PASS — individual diff and final interaction checked; no material regression identified |
| 69 | `7d80c1091ecce44c7ac5f5a2df28e782954330d0` | BaoVoThuong<br>2026-08-08T21:02:33+07:00<br>parent `55177af002148ff26ab9174b1a10f7129d1e5e0c` | 1 files; +8/-6<br>`docs/codex_review_code.md` | Documentation | docs(go-live): record shared reopen modal | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 70 | `68cdb533189d11f1b374b1db4b9f66b5637cf9e9` | BaoVoThuong<br>2026-08-08T21:04:04+07:00<br>parent `7d80c1091ecce44c7ac5f5a2df28e782954330d0` | 4 files; +51/-19<br>`src/app/api/enrollment/[id]/route.ts`, `src/app/api/enrollment/route.ts`, `src/lib/enrollment/dates.test.ts`, `src/lib/enrollment/dates.ts` | Enrollment | fix(enrollment): unify due-date validation | ACA and Medicare list/detail/create/API flows | PASS — individual diff and final interaction checked; no material regression identified |
| 71 | `a6c8cc42b57c77a724516a2d59f2d9451c848549` | BaoVoThuong<br>2026-08-08T21:05:05+07:00<br>parent `68cdb533189d11f1b374b1db4b9f66b5637cf9e9` | 1 files; +8/-6<br>`docs/codex_review_code.md` | Documentation | docs(go-live): record unified due-date validation | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 72 | `ef50046a47afda41df8659a308196190a1e029a8` | BaoVoThuong<br>2026-08-08T21:08:10+07:00<br>parent `a6c8cc42b57c77a724516a2d59f2d9451c848549` | 6 files; +66/-12<br>`src/app/api/enrollment/export/route.ts`, `src/app/api/enrollment/option-sets/route.ts`, `src/app/api/enrollment/overview/route.ts`, `src/app/api/enrollment/route.ts`, `src/lib/enrollment/types.test.ts`, `src/lib/enrollment/types.ts` | Enrollment | fix(enrollment): reject invalid program parameters | ACA and Medicare list/detail/create/API flows | PASS — individual diff and final interaction checked; no material regression identified |
| 73 | `691d15bfd9067d17450b3e5915f5852e235b65a2` | BaoVoThuong<br>2026-08-08T21:08:57+07:00<br>parent `ef50046a47afda41df8659a308196190a1e029a8` | 1 files; +10/-8<br>`docs/codex_review_code.md` | Documentation | docs(go-live): record strict program boundary | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 74 | `8a4155f63db49fe722ad872027d8fe918aa54de6` | BaoVoThuong<br>2026-08-08T21:09:44+07:00<br>parent `691d15bfd9067d17450b3e5915f5852e235b65a2` | 3 files; +34/-8<br>`src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`, `src/lib/enrollment/filtering.test.ts`, `src/lib/enrollment/filtering.ts` | Enrollment | fix(enrollment): include FUB links in search | ACA and Medicare list/detail/create/API flows | PASS — individual diff and final interaction checked; no material regression identified |
| 75 | `8ea831f8a707f4d69c42f24e5158426e9613e14d` | BaoVoThuong<br>2026-08-08T21:10:15+07:00<br>parent `8a4155f63db49fe722ad872027d8fe918aa54de6` | 1 files; +9/-7<br>`docs/codex_review_code.md` | Documentation | docs(go-live): record FUB search fix | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 76 | `6feda4ae453afa04fd787d747f954961e1fd42bc` | BaoVoThuong<br>2026-08-08T21:12:36+07:00<br>parent `8ea831f8a707f4d69c42f24e5158426e9613e14d` | 3 files; +67/-0<br>`src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`, `src/lib/enrollment/form-options.test.ts`, `src/lib/enrollment/form-options.ts` | Enrollment | fix(enrollment): reconcile archived form options | ACA and Medicare list/detail/create/API flows | PASS — individual diff and final interaction checked; no material regression identified |
| 77 | `219d91273273bdfe141de12f9df704eed581805b` | BaoVoThuong<br>2026-08-08T21:13:09+07:00<br>parent `6feda4ae453afa04fd787d747f954961e1fd42bc` | 1 files; +11/-9<br>`docs/codex_review_code.md` | Documentation | docs(go-live): record archived option fix | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 78 | `dcec66fa4bd46df1617659cc766050f1855a35df` | BaoVoThuong<br>2026-08-08T21:15:09+07:00<br>parent `219d91273273bdfe141de12f9df704eed581805b` | 4 files; +168/-0<br>`src/app/api/enrollment/[id]/route.ts`, `src/app/api/enrollment/route.ts`, `src/lib/enrollment/ownership.test.ts`, `src/lib/enrollment/ownership.ts` | Enrollment | fix(enrollment): validate ownership emails | ACA and Medicare list/detail/create/API flows | PASS — individual diff and final interaction checked; no material regression identified |
| 79 | `12414f38eb8d158b700c244cc25965b8b145a800` | BaoVoThuong<br>2026-08-08T21:15:43+07:00<br>parent `dcec66fa4bd46df1617659cc766050f1855a35df` | 1 files; +10/-8<br>`docs/codex_review_code.md` | Documentation | docs(go-live): record ownership validation | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 80 | `a974000af4ee31172ef163161b98c530dbb8eb3b` | BaoVoThuong<br>2026-08-08T23:00:49+07:00<br>parent `12414f38eb8d158b700c244cc25965b8b145a800` | 2 files; +28/-4<br>`src/lib/table-config/required.test.ts`, `src/lib/table-config/required.ts` | Config / SLA | fix(config): align required checkbox validation | Configuration plus downstream task/enrollment behavior | PASS — individual diff and final interaction checked; no material regression identified |
| 81 | `b712799fd812c6f780a3800a94cf27c3cb0a63a9` | BaoVoThuong<br>2026-08-08T23:01:24+07:00<br>parent `a974000af4ee31172ef163161b98c530dbb8eb3b` | 1 files; +10/-8<br>`docs/codex_review_code.md` | Documentation | docs(go-live): record consent required fix | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 82 | `fc88006e1e8e610025c3d80d3038d2701ca4fda0` | BaoVoThuong<br>2026-08-08T23:03:13+07:00<br>parent `b712799fd812c6f780a3800a94cf27c3cb0a63a9` | 3 files; +95/-25<br>`src/app/api/enrollment/[id]/comments/route.ts`, `src/lib/enrollment/comments.test.ts`, `src/lib/enrollment/comments.ts` | Enrollment | fix(enrollment): return canonical comment parent version | ACA and Medicare list/detail/create/API flows | PASS — individual diff and final interaction checked; no material regression identified |
| 83 | `d6c0f023e7979bcbcfe75afda6823468a9212c7d` | BaoVoThuong<br>2026-08-08T23:04:01+07:00<br>parent `fc88006e1e8e610025c3d80d3038d2701ca4fda0` | 1 files; +10/-8<br>`docs/codex_review_code.md` | Documentation | docs(go-live): record canonical comment version | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 84 | `c0960cd6d56c318f503a51763e98667aea821f2b` | BaoVoThuong<br>2026-08-08T23:06:09+07:00<br>parent `d6c0f023e7979bcbcfe75afda6823468a9212c7d` | 3 files; +111/-20<br>`src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`, `src/app/api/enrollment/[id]/attachments/[aid]/route.ts`, `src/app/api/enrollment/[id]/attachments/route.ts` | Enrollment | fix(enrollment): reconcile attachment storage and counts | ACA and Medicare list/detail/create/API flows | PASS — individual diff and final interaction checked; no material regression identified |
| 85 | `b5250de38685a3c9c47029cc98d328e77a49d75e` | BaoVoThuong<br>2026-08-08T23:06:55+07:00<br>parent `c0960cd6d56c318f503a51763e98667aea821f2b` | 1 files; +10/-8<br>`docs/codex_review_code.md` | Documentation | docs(go-live): record attachment reconciliation | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 86 | `261901af1900663487516f5e45b5fe83e105f6ea` | BaoVoThuong<br>2026-08-08T23:09:23+07:00<br>parent `b5250de38685a3c9c47029cc98d328e77a49d75e` | 9 files; +51/-14<br>`src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`, `src/app/api/enrollment/[id]/attachments/route.ts`, `src/app/api/enrollment/[id]/comments/route.ts`, `src/app/api/enrollment/[id]/route.ts`, `src/app/api/enrollment/option-sets/route.ts`, `src/app/api/enrollment/route.ts`, `src/lib/enrollment/realtime-topics.test.ts`, `src/lib/enrollment/realtime-topics.ts`, `src/lib/enrollment/realtime.ts` | Enrollment | fix(enrollment): scope realtime by program | ACA and Medicare list/detail/create/API flows | PASS — individual diff and final interaction checked; no material regression identified |
| 87 | `818c0b04130f5c36c65a58103be02e9e9156c402` | BaoVoThuong<br>2026-08-08T23:10:13+07:00<br>parent `261901af1900663487516f5e45b5fe83e105f6ea` | 1 files; +10/-8<br>`docs/codex_review_code.md` | Documentation | docs(go-live): record scoped enrollment realtime | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 88 | `973c63acdba9f8f5f8c49c53c4b12ac41fca813d` | BaoVoThuong<br>2026-08-08T23:11:50+07:00<br>parent `818c0b04130f5c36c65a58103be02e9e9156c402` | 2 files; +19/-30<br>`src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`, `src/app/(authed)/enrollment/_components/EnrollmentOverview.tsx` | Security / permissions | fix(enrollment): ignore stale async reloads | Authorization and export surface across modules | PASS — individual diff and final interaction checked; no material regression identified |
| 89 | `148a4afedb52d3549e85f29ec995c99586179942` | BaoVoThuong<br>2026-08-08T23:12:41+07:00<br>parent `973c63acdba9f8f5f8c49c53c4b12ac41fca813d` | 1 files; +10/-8<br>`docs/codex_review_code.md` | Documentation | docs(go-live): record enrollment request ordering | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 90 | `f7c1d945d66c4f134b82f30b13fccc5f4a62df7b` | BaoVoThuong<br>2026-08-08T23:14:18+07:00<br>parent `148a4afedb52d3549e85f29ec995c99586179942` | 4 files; +99/-9<br>`src/app/api/enrollment/export/route.ts`, `src/app/api/enrollment/route.ts`, `src/lib/enrollment/queries.test.ts`, `src/lib/enrollment/queries.ts` | Enrollment | fix(enrollment): fail closed on truncated lists | ACA and Medicare list/detail/create/API flows | F10/P2 — capped/unpaged list or auxiliary data path |
| 91 | `0668b9a166635dc3b10fbe2bba168f638e36c55f` | BaoVoThuong<br>2026-08-08T23:15:14+07:00<br>parent `f7c1d945d66c4f134b82f30b13fccc5f4a62df7b` | 1 files; +10/-8<br>`docs/codex_review_code.md` | Documentation | docs(go-live): record enrollment truncation guard | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 92 | `1b8de1d9a72be0c935f3b2f53a63b75ef980de73` | BaoVoThuong<br>2026-08-08T23:16:04+07:00<br>parent `0668b9a166635dc3b10fbe2bba168f638e36c55f` | 1 files; +14/-3<br>`src/app/(authed)/config/_components/ConfigClient.tsx` | Config / SLA | fix(config): distinguish success and error toasts | Configuration plus downstream task/enrollment behavior | PASS — individual diff and final interaction checked; no material regression identified |
| 93 | `ee0b0ae7c742840d6d38cae25f4ab0fd7e979711` | BaoVoThuong<br>2026-08-08T23:16:58+07:00<br>parent `1b8de1d9a72be0c935f3b2f53a63b75ef980de73` | 1 files; +10/-8<br>`docs/codex_review_code.md` | Documentation | docs(go-live): record config toast fix | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 94 | `e93a24cf707504d79ad4196be4d66d44b01fe2b8` | BaoVoThuong<br>2026-08-08T23:18:36+07:00<br>parent `ee0b0ae7c742840d6d38cae25f4ab0fd7e979711` | 1 files; +15/-5<br>`src/app/api/config/columns/route.ts` | Config / SLA | fix(config): apply column invariants on create | Configuration plus downstream task/enrollment behavior | PASS — individual diff and final interaction checked; no material regression identified |
| 95 | `28542c1982b131c21da8275493a5d9b346c5d4d3` | BaoVoThuong<br>2026-08-08T23:20:01+07:00<br>parent `e93a24cf707504d79ad4196be4d66d44b01fe2b8` | 1 files; +8/-6<br>`docs/codex_review_code.md` | Documentation | docs(go-live): record config column invariant fix | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 96 | `6b0023b2df107b7264ae0cce4c9d340c9cd9afaf` | BaoVoThuong<br>2026-08-08T23:21:41+07:00<br>parent `28542c1982b131c21da8275493a5d9b346c5d4d3` | 1 files; +25/-23<br>`src/app/(authed)/config/_components/ConfigClient.tsx` | Config / SLA | fix(config): serialize column patches | Configuration plus downstream task/enrollment behavior | PASS — individual diff and final interaction checked; no material regression identified |
| 97 | `e8afe7c0ae3d3f93b03e7306c2382fc1e2e2a412` | BaoVoThuong<br>2026-08-08T23:22:32+07:00<br>parent `6b0023b2df107b7264ae0cce4c9d340c9cd9afaf` | 1 files; +9/-7<br>`docs/codex_review_code.md` | Documentation | docs(go-live): record config patch ordering fix | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 98 | `165e4485ae473720561e1b379db39be7aefe35c8` | BaoVoThuong<br>2026-08-08T23:24:50+07:00<br>parent `e8afe7c0ae3d3f93b03e7306c2382fc1e2e2a412` | 1 files; +23/-1<br>`src/app/(authed)/config/_components/ConfigClient.tsx` | Config / SLA | fix(config): isolate scope drafts and refreshes | Configuration plus downstream task/enrollment behavior | PASS — individual diff and final interaction checked; no material regression identified |
| 99 | `c41b4693eabfd5884a54912a1fbb3d3f28a209e9` | BaoVoThuong<br>2026-08-08T23:25:32+07:00<br>parent `165e4485ae473720561e1b379db39be7aefe35c8` | 1 files; +9/-7<br>`docs/codex_review_code.md` | Documentation | docs(go-live): record config scope isolation fix | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 100 | `0255bd3abc7c0f61918e623dafb1d053ca90a18e` | BaoVoThuong<br>2026-08-08T23:26:41+07:00<br>parent `c41b4693eabfd5884a54912a1fbb3d3f28a209e9` | 1 files; +50/-4<br>`src/app/(authed)/config/_components/ConfigClient.tsx` | Config / SLA | fix(config): guard stage rule toggles | Configuration plus downstream task/enrollment behavior | PASS — individual diff and final interaction checked; no material regression identified |
| 101 | `28096422874ebf1bb33b2400f36e1e9a45f3cc36` | BaoVoThuong<br>2026-08-08T23:27:24+07:00<br>parent `0255bd3abc7c0f61918e623dafb1d053ca90a18e` | 1 files; +9/-7<br>`docs/codex_review_code.md` | Documentation | docs(go-live): record stage rule toggle fix | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 102 | `1cfccb088e54942816fe6537934b33155f373756` | BaoVoThuong<br>2026-08-08T23:28:19+07:00<br>parent `28096422874ebf1bb33b2400f36e1e9a45f3cc36` | 1 files; +21/-10<br>`src/app/(authed)/config/_components/ConfigClient.tsx` | Config / SLA | fix(config): disclose custom required semantics | Configuration plus downstream task/enrollment behavior | PASS — individual diff and final interaction checked; no material regression identified |
| 103 | `5f32d929fba673ffc0fc1f3519724674e77f871d` | BaoVoThuong<br>2026-08-08T23:29:03+07:00<br>parent `1cfccb088e54942816fe6537934b33155f373756` | 1 files; +9/-7<br>`docs/codex_review_code.md` | Documentation | docs(go-live): record custom required disclosure | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 104 | `a318646a606ff808830269627a259780aa6dd78d` | BaoVoThuong<br>2026-08-08T23:29:48+07:00<br>parent `5f32d929fba673ffc0fc1f3519724674e77f871d` | 1 files; +1/-5<br>`src/app/api/config/columns/route.ts` | Config / SLA | fix(config): require scoped column reads | Configuration plus downstream task/enrollment behavior | PASS — individual diff and final interaction checked; no material regression identified |
| 105 | `00847800e3c3b89f5c976c4b74741d0711e96af8` | BaoVoThuong<br>2026-08-08T23:30:38+07:00<br>parent `a318646a606ff808830269627a259780aa6dd78d` | 1 files; +10/-8<br>`docs/codex_review_code.md` | Documentation | docs(go-live): record scoped config read fix | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 106 | `310ec87dd3ce9e8934d6f5e5d7150ea2e9e1cc09` | BaoVoThuong<br>2026-08-08T23:31:55+07:00<br>parent `00847800e3c3b89f5c976c4b74741d0711e96af8` | 1 files; +33/-1<br>`src/app/api/enrollment/option-sets/[id]/route.ts` | Enrollment | fix(enrollment): preserve an active stage | ACA and Medicare list/detail/create/API flows | PASS — individual diff and final interaction checked; no material regression identified |
| 107 | `44e5b43f72c0303bb612152e17d8eafa9ccdf496` | BaoVoThuong<br>2026-08-08T23:32:53+07:00<br>parent `310ec87dd3ce9e8934d6f5e5d7150ea2e9e1cc09` | 1 files; +9/-7<br>`docs/codex_review_code.md` | Documentation | docs(go-live): record stage cardinality guard | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 108 | `2461470814bb2afe853b8f07cb8f60244da9df3a` | BaoVoThuong<br>2026-08-08T23:35:22+07:00<br>parent `44e5b43f72c0303bb612152e17d8eafa9ccdf496` | 2 files; +36/-2<br>`src/app/(authed)/config/_components/ConfigClient.tsx`, `src/app/api/enrollment/option-sets/[id]/route.ts` | Enrollment | fix(enrollment): protect workflow option labels | ACA and Medicare list/detail/create/API flows | PASS — individual diff and final interaction checked; no material regression identified |
| 109 | `68d358825794bc2b80bd6979549f6ede873d58c3` | BaoVoThuong<br>2026-08-08T23:36:06+07:00<br>parent `2461470814bb2afe853b8f07cb8f60244da9df3a` | 1 files; +9/-7<br>`docs/codex_review_code.md` | Documentation | docs(go-live): record workflow label guard | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 110 | `3ea385e47844f81b553bf5c95671d31672b0b362` | BaoVoThuong<br>2026-08-08T23:37:28+07:00<br>parent `68d358825794bc2b80bd6979549f6ede873d58c3` | 2 files; +36/-27<br>`src/app/(authed)/config/page.tsx`, `supabase/schema.sql` | Database / migration | perf(config): aggregate enrollment option usage | Schema, deployment order, and all affected API consumers | PASS — individual diff and final interaction checked; no material regression identified |
| 111 | `ed653c9bcd578128d5268a0154a829e684d3b575` | BaoVoThuong<br>2026-08-08T23:38:14+07:00<br>parent `3ea385e47844f81b553bf5c95671d31672b0b362` | 1 files; +9/-7<br>`docs/codex_review_code.md` | Documentation | docs(go-live): record usage count optimization | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 112 | `f867c15ccf1e6297ba8cd569ed770d5577cb4cef` | BaoVoThuong<br>2026-08-08T23:39:04+07:00<br>parent `ed653c9bcd578128d5268a0154a829e684d3b575` | 2 files; +15/-4<br>`src/app/api/config/columns/[id]/route.ts`, `src/app/api/config/columns/reorder/route.ts` | Config / SLA | fix(config): report post-commit layout warnings | Configuration plus downstream task/enrollment behavior | PASS — individual diff and final interaction checked; no material regression identified |
| 113 | `13befec28ff01065b891a41866580754f638c60b` | BaoVoThuong<br>2026-08-08T23:39:49+07:00<br>parent `f867c15ccf1e6297ba8cd569ed770d5577cb4cef` | 1 files; +9/-7<br>`docs/codex_review_code.md` | Documentation | docs(go-live): record config warning containment | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 114 | `d19dbb51a2270fa54be0eba36bf04b51dce295c1` | BaoVoThuong<br>2026-08-08T23:40:18+07:00<br>parent `13befec28ff01065b891a41866580754f638c60b` | 1 files; +1/-1<br>`supabase/schema.sql` | Database / migration | fix(config): avoid reserved usage rpc alias | Schema, deployment order, and all affected API consumers | PASS — individual diff and final interaction checked; no material regression identified |
| 115 | `97d1383c6239a7119120da9afa9da096d2fc0b86` | BaoVoThuong<br>2026-08-08T23:40:46+07:00<br>parent `d19dbb51a2270fa54be0eba36bf04b51dce295c1` | 1 files; +6/-5<br>`docs/codex_review_code.md` | Documentation | docs(go-live): record usage rpc schema correction | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 116 | `f1eef1f38d815d6432dce41481fcdc5e2dd60770` | BaoVoThuong<br>2026-08-08T23:42:04+07:00<br>parent `97d1383c6239a7119120da9afa9da096d2fc0b86` | 2 files; +16/-34<br>`src/app/api/enrollment/[id]/route.ts`, `src/app/api/enrollment/route.ts` | Enrollment | fix(enrollment): fail closed on missing schema | ACA and Medicare list/detail/create/API flows | PASS — individual diff and final interaction checked; no material regression identified |
| 117 | `bfbd5f343f20762e0dbc9d8dac966f1169edc20f` | BaoVoThuong<br>2026-08-08T23:42:54+07:00<br>parent `f1eef1f38d815d6432dce41481fcdc5e2dd60770` | 1 files; +9/-7<br>`docs/codex_review_code.md` | Documentation | docs(go-live): record schema fail-closed writes | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 118 | `76ef352c1f6acd0eeaff882cab48f7217b0a63d3` | BaoVoThuong<br>2026-08-08T23:45:50+07:00<br>parent `bfbd5f343f20762e0dbc9d8dac966f1169edc20f` | 4 files; +75/-1<br>`src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`, `src/app/(authed)/tasks/_components/TaskBoardClient.tsx`, `src/lib/table-config/realtime-topics.ts`, `src/lib/table-config/realtime.ts` | Config / SLA | fix(config): notify active clients of config changes | Configuration plus downstream task/enrollment behavior | PASS — individual diff and final interaction checked; no material regression identified |
| 119 | `7aef78cfe2e645e33f2f2050dfbc5569fbf38536` | BaoVoThuong<br>2026-08-08T23:46:43+07:00<br>parent `76ef352c1f6acd0eeaff882cab48f7217b0a63d3` | 1 files; +9/-7<br>`docs/codex_review_code.md` | Documentation | docs(go-live): record config invalidation banner | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 120 | `c599c31dc9008cfa8475f7debefa7004c620e2d2` | BaoVoThuong<br>2026-08-08T23:48:43+07:00<br>parent `7aef78cfe2e645e33f2f2050dfbc5569fbf38536` | 1 files; +3/-1<br>`docs/codex_review_code.md` | Documentation | docs(go-live): record full regression verification | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 121 | `c5948d86a80bb251bb44fab7ba356324c6a91473` | BaoVoThuong<br>2026-08-08T23:49:10+07:00<br>parent `c599c31dc9008cfa8475f7debefa7004c620e2d2` | 1 files; +5/-2<br>`docs/codex_review_code.md` | Documentation | docs(go-live): refresh final risk summary | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 122 | `aea802e325cfd002315ea2d7dfa66c402b66ded7` | BaoVoThuong<br>2026-08-08T23:50:09+07:00<br>parent `c5948d86a80bb251bb44fab7ba356324c6a91473` | 2 files; +5/-5<br>`src/app/api/enrollment/option-sets/[id]/route.ts`, `src/app/api/enrollment/option-sets/route.ts` | Enrollment | fix(config): broadcast option set invalidation | ACA and Medicare list/detail/create/API flows | PASS — individual diff and final interaction checked; no material regression identified |
| 123 | `202c4714cb05070555a434ca2e5c5f39d7070cd8` | BaoVoThuong<br>2026-08-08T23:50:38+07:00<br>parent `aea802e325cfd002315ea2d7dfa66c402b66ded7` | 1 files; +5/-5<br>`docs/codex_review_code.md` | Documentation | docs(go-live): record config producer coverage | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 124 | `fdab65fea4f3f4de744cd5f41e3a306e07007971` | BaoVoThuong<br>2026-08-08T23:51:30+07:00<br>parent `202c4714cb05070555a434ca2e5c5f39d7070cd8` | 3 files; +25/-6<br>`src/app/api/enrollment/option-sets/[id]/route.ts`, `src/app/api/enrollment/option-sets/route.ts`, `src/lib/table-config/realtime.ts` | Enrollment | fix(realtime): preserve scoped option invalidation | ACA and Medicare list/detail/create/API flows | PASS — individual diff and final interaction checked; no material regression identified |
| 125 | `bd94032a6095975bc0c193987e733ada54c619cd` | BaoVoThuong<br>2026-08-08T23:51:57+07:00<br>parent `fdab65fea4f3f4de744cd5f41e3a306e07007971` | 1 files; +5/-5<br>`docs/codex_review_code.md` | Documentation | docs(go-live): record scoped config broadcast correction | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 126 | `765432d51b9fcfd1deb6c8c0e086c099754bd5c5` | BaoVoThuong<br>2026-08-08T23:53:45+07:00<br>parent `bd94032a6095975bc0c193987e733ada54c619cd` | 1 files; +2/-2<br>`docs/codex_review_code.md` | Documentation | docs(go-live): record final regression rerun | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 127 | `2cd421d28420cdb520b76905f8a7f605ab76f997` | BaoVoThuong<br>2026-08-08T23:54:17+07:00<br>parent `765432d51b9fcfd1deb6c8c0e086c099754bd5c5` | 1 files; +2/-0<br>`supabase/schema.sql` | Database / migration | fix(config): restrict usage rpc execution | Schema, deployment order, and all affected API consumers | PASS — individual diff and final interaction checked; no material regression identified |
| 128 | `8d0835127a37017a2e2123e78f18269f577e016b` | BaoVoThuong<br>2026-08-08T23:54:51+07:00<br>parent `2cd421d28420cdb520b76905f8a7f605ab76f997` | 1 files; +5/-5<br>`docs/codex_review_code.md` | Documentation | docs(go-live): record usage rpc access hardening | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 129 | `82e6107c0c3d9d3c32f193f3df86a1e73791502f` | BaoVoThuong<br>2026-08-09T00:08:01+07:00<br>parent `8d0835127a37017a2e2123e78f18269f577e016b` | 1 files; +1/-7<br>`src/app/(authed)/enrollment/_components/EnrollmentClient.tsx` | Security / permissions | fix(enrollment): simplify create properties header | Authorization and export surface across modules | PASS — individual diff and final interaction checked; no material regression identified |
| 130 | `5fef27464ee7cd9b49943597f4331921b9c6bc7c` | BaoVoThuong<br>2026-08-09T00:08:20+07:00<br>parent `82e6107c0c3d9d3c32f193f3df86a1e73791502f` | 1 files; +3/-2<br>`docs/codex_review_code.md` | Documentation | docs(go-live): record enrollment dialog copy cleanup | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 131 | `2537db1a19e09c751a45f88f9e108185040da6f3` | BaoVoThuong<br>2026-08-09T00:10:52+07:00<br>parent `5fef27464ee7cd9b49943597f4331921b9c6bc7c` | 1 files; +0/-29<br>`src/app/(authed)/enrollment/_components/EnrollmentClient.tsx` | Security / permissions | fix(enrollment): remove payment status filter | Authorization and export surface across modules | PASS — individual diff and final interaction checked; no material regression identified |
| 132 | `b5a1097021818f419a2ecae5883a2f371b107f49` | BaoVoThuong<br>2026-08-09T00:11:05+07:00<br>parent `2537db1a19e09c751a45f88f9e108185040da6f3` | 1 files; +3/-2<br>`docs/codex_review_code.md` | Documentation | docs(go-live): record payment filter removal | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 133 | `3334b1cf4bc6e5f050b1663df71770e45cd2dd12` | BaoVoThuong<br>2026-08-09T00:18:20+07:00<br>parent `b5a1097021818f419a2ecae5883a2f371b107f49` | 1 files; +16/-16<br>`src/app/(authed)/tasks/_components/TaskRowItem.tsx` | Security / permissions | fix(tasks): allow inline client name edits | Authorization and export surface across modules | PASS — individual diff and final interaction checked; no material regression identified |
| 134 | `d0952c51d4ab1dc4cba76e9367f65af7ad54b90f` | BaoVoThuong<br>2026-08-09T00:18:57+07:00<br>parent `3334b1cf4bc6e5f050b1663df71770e45cd2dd12` | 1 files; +3/-2<br>`docs/codex_review_code.md` | Documentation | docs(go-live): record task client name editing | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 135 | `42a9db761874a9f0b5e812ab23dedc57f02dce23` | BaoVoThuong<br>2026-08-09T00:21:51+07:00<br>parent `d0952c51d4ab1dc4cba76e9367f65af7ad54b90f` | 1 files; +30/-0<br>`supabase/schema.sql` | Database / migration | fix(security): restrict security definer rpc execution | Schema, deployment order, and all affected API consumers | PASS — individual diff and final interaction checked; no material regression identified |
| 136 | `08e3538c0dd4e28d963346e7a1ef9371a5d8217a` | BaoVoThuong<br>2026-08-09T00:21:55+07:00<br>parent `42a9db761874a9f0b5e812ab23dedc57f02dce23` | 1 files; +8/-0<br>`src/app/(authed)/enrollment/_components/EnrollmentClient.tsx` | Security / permissions | fix(enrollment): restore archive on network failure | Authorization and export surface across modules | PASS — individual diff and final interaction checked; no material regression identified |
| 137 | `7c7341edb29337c5ee47c6bba76bfdcce042cbe1` | BaoVoThuong<br>2026-08-09T00:21:59+07:00<br>parent `08e3538c0dd4e28d963346e7a1ef9371a5d8217a` | 5 files; +12/-12<br>`src/app/api/config/columns/[id]/options/[optionId]/route.ts`, `src/app/api/config/columns/[id]/options/route.ts`, `src/app/api/config/columns/[id]/route.ts`, `src/app/api/config/columns/reorder/route.ts`, `src/app/api/config/columns/route.ts` | Config / SLA | perf(config): avoid data refetch on column changes | Configuration plus downstream task/enrollment behavior | PASS — individual diff and final interaction checked; no material regression identified |
| 138 | `29a355f8993bf397016556b5c4f396584fe73bec` | BaoVoThuong<br>2026-08-09T00:22:54+07:00<br>parent `7c7341edb29337c5ee47c6bba76bfdcce042cbe1` | 1 files; +17/-2<br>`docs/codex_review_code.md` | Documentation | docs(go-live): adjudicate claude post-fix review | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 139 | `c838e8e2ea3e6540de8caad50f7568342b0652c6` | BaoVoThuong<br>2026-08-09T00:24:35+07:00<br>parent `29a355f8993bf397016556b5c4f396584fe73bec` | 1 files; +2/-1<br>`docs/codex_review_code.md` | Documentation | docs(go-live): record claude adjudication regression | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 140 | `3ec0616537923a4c825c45bdceafcccdab254d12` | BaoVoThuong<br>2026-08-09T00:43:40+07:00<br>parent `c838e8e2ea3e6540de8caad50f7568342b0652c6` | 2 files; +164/-0<br>`src/lib/tasks/sla-config.test.ts`, `src/lib/tasks/sla-config.ts` | Tasks | refactor(sla): centralize admin constants and drift tests | Health CS task list/detail/API flows | PASS — individual diff and final interaction checked; no material regression identified |
| 141 | `36e41cc9eb29c55c2299f9c537e376c368b586ff` | BaoVoThuong<br>2026-08-09T00:44:13+07:00<br>parent `3ec0616537923a4c825c45bdceafcccdab254d12` | 1 files; +10/-4<br>`src/app/api/admin/task-sla-rules/route.ts` | Config / SLA | fix(sla): enforce duration upper bound in api | Configuration plus downstream task/enrollment behavior | PASS — individual diff and final interaction checked; no material regression identified |
| 142 | `30746ba9724e480ae36b41a0e93392a2a451f0f2` | BaoVoThuong<br>2026-08-09T00:47:18+07:00<br>parent `36e41cc9eb29c55c2299f9c537e376c368b586ff` | 3 files; +556/-3<br>`src/app/(authed)/config/_components/ConfigClient.tsx`, `src/app/(authed)/config/_components/ConfigSlaSection.tsx`, `src/app/(authed)/config/page.tsx` | Config / SLA | feat(config): add SLA times admin section | Configuration plus downstream task/enrollment behavior | PASS — individual diff and final interaction checked; no material regression identified |
| 143 | `5886f10186ef2db6a939c12db60b7591dd1979e7` | BaoVoThuong<br>2026-08-09T00:48:51+07:00<br>parent `30746ba9724e480ae36b41a0e93392a2a451f0f2` | 4 files; +10/-602<br>`changelog.md`, `src/app/(authed)/tasks/_components/SlaRulesModal.tsx`, `src/app/(authed)/tasks/_components/TaskBoardClient.tsx`, `src/lib/tasks/sla-config.ts` | Tasks | refactor(tasks): move sla management to config | Health CS task list/detail/API flows | PASS — individual diff and final interaction checked; no material regression identified |
| 144 | `fd9894d631f211f1b2d1943f132144f5bf4cfda2` | BaoVoThuong<br>2026-08-09T00:51:15+07:00<br>parent `5886f10186ef2db6a939c12db60b7591dd1979e7` | 1 files; +59/-2<br>`docs/codex_review_code.md` | Documentation | docs(go-live): record SLA config implementation | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 145 | `f20392edf9b5790e3ed7db02600fff7bcb48235b` | BaoVoThuong<br>2026-08-09T00:57:32+07:00<br>parent `fd9894d631f211f1b2d1943f132144f5bf4cfda2` | 3 files; +156/-1<br>`src/lib/enrollment/option-badge.test.ts`, `src/lib/enrollment/option-badge.ts`, `src/lib/tasks/category-colors.ts` | Enrollment | refactor(enrollment): extract option badge palette into tested module | ACA and Medicare list/detail/create/API flows | PASS — individual diff and final interaction checked; no material regression identified |
| 146 | `c51691ff86d4ffcf4085d7fa706dbc9fccc236b7` | BaoVoThuong<br>2026-08-09T00:58:57+07:00<br>parent `f20392edf9b5790e3ed7db02600fff7bcb48235b` | 1 files; +29/-13<br>`src/app/(authed)/enrollment/_components/EnrollmentClient.tsx` | Security / permissions | fix(enrollment): use a surface-aware empty state for person fields | Authorization and export surface across modules | PASS — individual diff and final interaction checked; no material regression identified |
| 147 | `f7601b3dc6b3d39bc6adffe8174e66f2e842abf5` | BaoVoThuong<br>2026-08-09T00:59:13+07:00<br>parent `c51691ff86d4ffcf4085d7fa706dbc9fccc236b7` | 1 files; +8/-0<br>`changelog.md` | Documentation | docs(changelog): record enrollment person field surface fix | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 148 | `912bb000b06cfa6b281244405fc3ca169df6e51d` | BaoVoThuong<br>2026-08-09T01:00:18+07:00<br>parent `f7601b3dc6b3d39bc6adffe8174e66f2e842abf5` | 1 files; +14/-28<br>`src/app/(authed)/enrollment/_components/EnrollmentClient.tsx` | Security / permissions | fix(enrollment): apply CS identity and state badge languages | Authorization and export surface across modules | PASS — individual diff and final interaction checked; no material regression identified |
| 149 | `9369b9e871a134287865c8b8c1eb5df747535e3e` | BaoVoThuong<br>2026-08-09T01:00:32+07:00<br>parent `912bb000b06cfa6b281244405fc3ca169df6e51d` | 1 files; +8/-0<br>`changelog.md` | Documentation | docs(changelog): record enrollment list badge language split | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 150 | `b86ffbb5c839c26f2f1c32a88deedcf99232e040` | BaoVoThuong<br>2026-08-09T01:02:13+07:00<br>parent `9369b9e871a134287865c8b8c1eb5df747535e3e` | 1 files; +2/-2<br>`src/app/(authed)/enrollment/_components/EnrollmentClient.tsx` | Security / permissions | fix(enrollment): show neutral empty option badges | Authorization and export surface across modules | PASS — individual diff and final interaction checked; no material regression identified |
| 151 | `9cb8375c229260f8c63538f841970e2bca0a11cd` | BaoVoThuong<br>2026-08-09T01:03:08+07:00<br>parent `b86ffbb5c839c26f2f1c32a88deedcf99232e040` | 1 files; +8/-0<br>`changelog.md` | Documentation | docs(changelog): record neutral enrollment option badges | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 152 | `7d6ab454ac8ab5317a1f8a1a76cb5905bff658e9` | BaoVoThuong<br>2026-08-09T01:06:25+07:00<br>parent `9cb8375c229260f8c63538f841970e2bca0a11cd` | 2 files; +932/-2<br>`docs/codex_review_code.md`, `docs/superpowers/plans/2026-08-09-enrollment-task-ui-standardization.md` | Documentation | docs(go-live): record enrollment UI standardization verification | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 153 | `9ea8358fb6fda7f39a1b0a3257ff9a8bf6841399` | BaoVoThuong<br>2026-08-09T01:07:02+07:00<br>parent `7d6ab454ac8ab5317a1f8a1a76cb5905bff658e9` | 1 files; +24/-24<br>`docs/superpowers/plans/2026-08-09-enrollment-task-ui-standardization.md` | Documentation | docs(go-live): mark enrollment UI plan execution | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 154 | `e77fbcb5dce5f4c03c2de209028a5e9d991fa06b` | BaoVoThuong<br>2026-08-09T01:12:55+07:00<br>parent `9ea8358fb6fda7f39a1b0a3257ff9a8bf6841399` | 4 files; +52/-3<br>`changelog.md`, `src/app/(authed)/config/_components/ConfigSlaSection.tsx`, `src/lib/tasks/sla-config.test.ts`, `src/lib/tasks/sla-config.ts` | Tasks | fix(sla): constrain editor duration combinations | Health CS task list/detail/API flows | PASS — individual diff and final interaction checked; no material regression identified |
| 155 | `c5b58d100fb43da592e6c9b7897ca357cbf54b34` | BaoVoThuong<br>2026-08-09T01:14:40+07:00<br>parent `e77fbcb5dce5f4c03c2de209028a5e9d991fa06b` | 2 files; +43/-14<br>`changelog.md`, `src/app/(authed)/config/_components/ConfigSlaSection.tsx` | Config / SLA | fix(sla): serialize rule editor saves | Configuration plus downstream task/enrollment behavior | PASS — individual diff and final interaction checked; no material regression identified |
| 156 | `0e873641a23a45e316588caf71418573dd348600` | BaoVoThuong<br>2026-08-09T01:16:20+07:00<br>parent `c5b58d100fb43da592e6c9b7897ca357cbf54b34` | 2 files; +28/-6<br>`changelog.md`, `src/app/(authed)/config/_components/ConfigSlaSection.tsx` | Config / SLA | fix(sla): restore rule editor after failed saves | Configuration plus downstream task/enrollment behavior | PASS — individual diff and final interaction checked; no material regression identified |
| 157 | `e134b22a3b19101bb0de267a3222a7998f11a36d` | BaoVoThuong<br>2026-08-09T01:16:53+07:00<br>parent `0e873641a23a45e316588caf71418573dd348600` | 2 files; +24/-8<br>`changelog.md`, `src/lib/tasks/sla-config.test.ts` | Tasks | test(sla): validate every schema default declaration | Health CS task list/detail/API flows | PASS — individual diff and final interaction checked; no material regression identified |
| 158 | `d15d43f8974fab39cd23f0e9a0bcd4c8682e61d1` | BaoVoThuong<br>2026-08-09T01:24:03+07:00<br>parent `e134b22a3b19101bb0de267a3222a7998f11a36d` | 4 files; +59/-4<br>`src/app/(authed)/tasks/_components/TaskCard.tsx`, `src/app/(authed)/tasks/_components/TaskRowItem.tsx`, `src/lib/tasks/category-colors.test.ts`, `src/lib/tasks/category-colors.ts` | Tasks | style(tasks): soften category badge colours | Health CS task list/detail/API flows | PASS — individual diff and final interaction checked; no material regression identified |
| 159 | `c01d84f24211bf621f76eefaf0cc0808362b3345` | BaoVoThuong<br>2026-08-09T01:26:38+07:00<br>parent `d15d43f8974fab39cd23f0e9a0bcd4c8682e61d1` | 3 files; +32/-16<br>`src/lib/enrollment/option-badge.test.ts`, `src/lib/enrollment/option-badge.ts`, `src/lib/tasks/category-colors.ts` | Enrollment | style(enrollment): soften option badge colours | ACA and Medicare list/detail/create/API flows | PASS — individual diff and final interaction checked; no material regression identified |
| 160 | `6b7ca86df2075a192aac3a81924cf7ea41fef1a6` | BaoVoThuong<br>2026-08-09T01:38:23+07:00<br>parent `c01d84f24211bf621f76eefaf0cc0808362b3345` | 1 files; +58/-37<br>`src/app/(authed)/enrollment/_components/EnrollmentClient.tsx` | Security / permissions | fix(enrollment): match CS option field surfaces | Authorization and export surface across modules | PASS — individual diff and final interaction checked; no material regression identified |
| 161 | `a697cb3ae727728f1e0dc36fa63f14c8644fb163` | BaoVoThuong<br>2026-08-09T01:38:37+07:00<br>parent `6b7ca86df2075a192aac3a81924cf7ea41fef1a6` | 1 files; +257/-0<br>`docs/enrollment-task-ui-standardization-plan.md` | Documentation | docs(enrollment): log option field surface fix | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 162 | `350058662fba4045f2ac004ae9d3d6fdc70cbb8c` | BaoVoThuong<br>2026-08-09T01:39:58+07:00<br>parent `a697cb3ae727728f1e0dc36fa63f14c8644fb163` | 1 files; +10/-3<br>`src/app/(authed)/enrollment/_components/EnrollmentClient.tsx` | Security / permissions | fix(enrollment): use select placeholders in create form | Authorization and export surface across modules | PASS — individual diff and final interaction checked; no material regression identified |
| 163 | `c48863fc99bb2679337018009728d88ec5c11d02` | BaoVoThuong<br>2026-08-09T01:40:12+07:00<br>parent `350058662fba4045f2ac004ae9d3d6fdc70cbb8c` | 1 files; +1/-1<br>`docs/enrollment-task-ui-standardization-plan.md` | Documentation | docs(enrollment): log select placeholder fix | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 164 | `ed5bf0cbfc02e1605888c6fa90f886c2af89042c` | BaoVoThuong<br>2026-08-09T01:41:05+07:00<br>parent `c48863fc99bb2679337018009728d88ec5c11d02` | 1 files; +0/-6<br>`src/app/(authed)/enrollment/_components/EnrollmentClient.tsx` | Security / permissions | fix(enrollment): remove create program badge | Authorization and export surface across modules | PASS — individual diff and final interaction checked; no material regression identified |
| 165 | `4866d8e4a1dc2ced7cfea3567a08096119d52738` | BaoVoThuong<br>2026-08-09T01:41:16+07:00<br>parent `ed5bf0cbfc02e1605888c6fa90f886c2af89042c` | 1 files; +1/-1<br>`docs/enrollment-task-ui-standardization-plan.md` | Documentation | docs(enrollment): log program badge removal | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 166 | `8e6a549d12f3aee2bd124d16eabdce131dcf2471` | BaoVoThuong<br>2026-08-09T01:44:19+07:00<br>parent `4866d8e4a1dc2ced7cfea3567a08096119d52738` | 2 files; +32/-26<br>`src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`, `src/app/(authed)/tasks/_components/TaskRowItem.tsx` | Security / permissions | fix(list): open task from client name | Authorization and export surface across modules | PASS — individual diff and final interaction checked; no material regression identified |
| 167 | `56ce6eb7a0b8ae6713150b6525f27e3815929576` | BaoVoThuong<br>2026-08-09T01:44:36+07:00<br>parent `8e6a549d12f3aee2bd124d16eabdce131dcf2471` | 1 files; +1/-0<br>`docs/enrollment-task-ui-standardization-plan.md` | Documentation | docs(enrollment): log client name navigation fix | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 168 | `99375158923f5e2166044040629602765f8c021d` | BaoVoThuong<br>2026-08-09T01:56:30+07:00<br>parent `56ce6eb7a0b8ae6713150b6525f27e3815929576` | 5 files; +651/-576<br>`src/app/api/enrollment/overview/route.ts`, `src/lib/enrollment/overview-data.ts`, `src/lib/enrollment/overview-types.ts`, `src/lib/enrollment/overview.test.ts`, `src/lib/enrollment/overview.ts` | Enrollment | feat(enrollment): build operations overview metrics | ACA and Medicare list/detail/create/API flows | F10/P2 — capped/unpaged list or auxiliary data path |
| 169 | `f202992ab7306dc324c7bfd168be165e8ec9803d` | BaoVoThuong<br>2026-08-09T12:13:59+07:00<br>parent `99375158923f5e2166044040629602765f8c021d` | 4 files; +328/-343<br>`src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`, `src/app/(authed)/enrollment/_components/EnrollmentOverview.tsx`, `src/lib/enrollment/overview-types.ts`, `src/lib/enrollment/overview.ts` | Enrollment | feat(enrollment): ship program-specific operations overview | ACA and Medicare list/detail/create/API flows | PASS — individual diff and final interaction checked; no material regression identified |
| 170 | `823159a1b1397d70a803726015c34c69dc994e1b` | BaoVoThuong<br>2026-08-09T12:15:22+07:00<br>parent `f202992ab7306dc324c7bfd168be165e8ec9803d` | 1 files; +338/-0<br>`docs/superpowers/specs/2026-08-09-enrollment-operations-dashboard-design.md` | Documentation | docs(enrollment): record operations dashboard implementation | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 171 | `2eceedee97a58e4103d17694c0c9cced59fc02e1` | BaoVoThuong<br>2026-08-09T13:03:48+07:00<br>parent `823159a1b1397d70a803726015c34c69dc994e1b` | 2 files; +118/-2<br>`changelog.md`, `scripts/seed-enrollment-samples.mjs` | Seed / QA data | feat(seed): assign eligible agents to enrollment sample records | Sample/backfill data and local QA behavior | PASS — individual diff and final interaction checked; no material regression identified |
| 172 | `6b532387ef5f3e78dd4f675af4807d786db49bd2` | BaoVoThuong<br>2026-08-09T13:04:42+07:00<br>parent `2eceedee97a58e4103d17694c0c9cced59fc02e1` | 2 files; +98/-0<br>`changelog.md`, `scripts/seed-enrollment-samples.mjs` | Seed / QA data | feat(seed): add guarded assistant seeding for permission testing | Sample/backfill data and local QA behavior | PASS — individual diff and final interaction checked; no material regression identified |
| 173 | `1e5a76383716597e862eeb36498047ef58b96dd0` | BaoVoThuong<br>2026-08-09T13:06:00+07:00<br>parent `6b532387ef5f3e78dd4f675af4807d786db49bd2` | 2 files; +184/-4<br>`src/lib/enrollment/access.ts`, `src/lib/enrollment/capabilities.test.ts` | Enrollment | feat(enrollment): add per-action capability resolver | ACA and Medicare list/detail/create/API flows | PASS — individual diff and final interaction checked; no material regression identified |
| 174 | `b2b3b00a6851b9ade6bafc09f314395f5a6f430b` | BaoVoThuong<br>2026-08-09T13:07:16+07:00<br>parent `1e5a76383716597e862eeb36498047ef58b96dd0` | 2 files; +123/-0<br>`src/lib/enrollment/scope.test.ts`, `src/lib/enrollment/scope.ts` | Enrollment | feat(enrollment): add actor scope resolver | ACA and Medicare list/detail/create/API flows | F14/P3 — exact list scope differs from normalized direct guard |
| 175 | `cc86ddba3c0cc7b7a2e78a458011e4e60092298b` | BaoVoThuong<br>2026-08-09T13:10:39+07:00<br>parent `b2b3b00a6851b9ade6bafc09f314395f5a6f430b` | 10 files; +108/-109<br>`src/app/(authed)/enrollment/page.tsx`, `src/app/api/enrollment/[id]/activity/route.ts`, `src/app/api/enrollment/[id]/attachments/[aid]/route.ts`, `src/app/api/enrollment/[id]/attachments/route.ts`, `src/app/api/enrollment/[id]/comments/[cid]/edits/route.ts`, `src/app/api/enrollment/[id]/comments/[cid]/route.ts`, `src/app/api/enrollment/[id]/comments/route.ts`, `src/app/api/enrollment/[id]/detail/route.ts`, `src/app/api/enrollment/[id]/route.ts`, `src/lib/enrollment/scope.ts` | Enrollment | fix(enrollment): scope every record read by actor | ACA and Medicare list/detail/create/API flows | PASS — individual diff and final interaction checked; no material regression identified |
| 176 | `20b7909ac466193769576597d15ff6834ae7e5fb` | BaoVoThuong<br>2026-08-09T13:12:08+07:00<br>parent `cc86ddba3c0cc7b7a2e78a458011e4e60092298b` | 1 files; +88/-7<br>`src/app/api/enrollment/[id]/route.ts` | Enrollment | feat(enrollment): enforce per-action permissions on mutations | ACA and Medicare list/detail/create/API flows | PASS — individual diff and final interaction checked; no material regression identified |
| 177 | `99698b58936b2ddd5a563c279b35981d2a3c0b4e` | BaoVoThuong<br>2026-08-09T13:14:51+07:00<br>parent `20b7909ac466193769576597d15ff6834ae7e5fb` | 8 files; +86/-24<br>`src/app/(authed)/enrollment/page.tsx`, `src/app/api/enrollment/export/route.ts`, `src/app/api/enrollment/overview/route.ts`, `src/app/api/enrollment/route.ts`, `src/lib/enrollment/overview-data.ts`, `src/lib/enrollment/queries.ts`, `src/lib/enrollment/scope.test.ts`, `src/lib/enrollment/scope.ts` | Enrollment | fix(enrollment): scope list overview and export queries | ACA and Medicare list/detail/create/API flows | PASS — individual diff and final interaction checked; no material regression identified |
| 178 | `50cdd85eb7fc5625eb5adbe41e4cccab73552c54` | BaoVoThuong<br>2026-08-09T13:21:28+07:00<br>parent `99698b58936b2ddd5a563c279b35981d2a3c0b4e` | 6 files; +168/-182<br>`src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`, `src/app/(authed)/enrollment/page.tsx`, `src/app/api/enrollment/[id]/attachments/route.ts`, `src/app/api/enrollment/route.ts`, `src/lib/enrollment/access.test.ts`, `src/lib/enrollment/access.ts` | Enrollment | feat(enrollment): gate creation and render controls from capabilities | ACA and Medicare list/detail/create/API flows | PASS — individual diff and final interaction checked; no material regression identified |
| 179 | `c70587b9116c4389328c0f9f13ce2f85a4e182ab` | BaoVoThuong<br>2026-08-09T13:22:03+07:00<br>parent `50cdd85eb7fc5625eb5adbe41e4cccab73552c54` | 2 files; +14/-2<br>`src/lib/rbac/permissions.ts`, `supabase/schema.sql` | Database / migration | feat(rbac): add task export permission catalogue | Schema, deployment order, and all affected API consumers | PASS — individual diff and final interaction checked; no material regression identified |
| 180 | `512a738bc46550f879b4f541db31e17f405c5ca1` | BaoVoThuong<br>2026-08-09T13:22:45+07:00<br>parent `c70587b9116c4389328c0f9f13ce2f85a4e182ab` | 7 files; +24/-24<br>`src/app/(authed)/enrollment/page.tsx`, `src/app/(authed)/tasks/page.tsx`, `src/app/api/enrollment/export/route.ts`, `src/app/api/tasks/export/route.ts`, `src/lib/enrollment/access.ts`, `src/lib/table-config/export-access.test.ts`, `src/lib/table-config/export-access.ts` | Enrollment | fix(export): require task export permission across UI and API | ACA and Medicare list/detail/create/API flows | PASS — individual diff and final interaction checked; no material regression identified |
| 181 | `ff126067cec8ceb05ce267a3d8b83b6e12ab58f6` | BaoVoThuong<br>2026-08-09T13:23:34+07:00<br>parent `512a738bc46550f879b4f541db31e17f405c5ca1` | 1 files; +61/-0<br>`supabase/rollouts/2026-08-09-task-export-permission.sql` | Database / migration | chore(rbac): add task export permission rollout sql | Schema, deployment order, and all affected API consumers | PASS — individual diff and final interaction checked; no material regression identified |
| 182 | `f2b45caa8c2bf14474577612aac1e83018c7e496` | BaoVoThuong<br>2026-08-09T13:27:00+07:00<br>parent `ff126067cec8ceb05ce267a3d8b83b6e12ab58f6` | 2 files; +1020/-0<br>`changelog.md`, `docs/superpowers/plans/2026-08-09-enrollment-permission-final.md` | Documentation | docs(enrollment): record permission rollout and deployment gate | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 183 | `a4f4ccf4de0e7bbea5d7845d2193fa7af10d18e0` | BaoVoThuong<br>2026-08-09T13:35:05+07:00<br>parent `f2b45caa8c2bf14474577612aac1e83018c7e496` | 3 files; +15/-3<br>`changelog.md`, `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`, `src/app/(authed)/enrollment/page.tsx` | Security / permissions | fix(enrollment): default own assignment filter for plain workers | Authorization and export surface across modules | PASS — individual diff and final interaction checked; no material regression identified |
| 184 | `bfada34731f9977d96a4bbfcde2ff03e1db6af52` | BaoVoThuong<br>2026-08-09T13:39:14+07:00<br>parent `a4f4ccf4de0e7bbea5d7845d2193fa7af10d18e0` | 6 files; +39/-5<br>`changelog.md`, `docs/superpowers/plans/2026-08-09-enrollment-permission-final.md`, `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`, `src/app/api/enrollment/[id]/route.ts`, `src/lib/enrollment/access.ts`, `src/lib/enrollment/capabilities.test.ts` | Enrollment | fix(enrollment): protect main content from workflow-only workers | ACA and Medicare list/detail/create/API flows | PASS — individual diff and final interaction checked; no material regression identified |
| 185 | `4c28d0df17d3ed39644829b41dc4f2c2b2b18567` | BaoVoThuong<br>2026-08-09T13:41:44+07:00<br>parent `bfada34731f9977d96a4bbfcde2ff03e1db6af52` | 1 files; +35/-35<br>`src/app/(authed)/enrollment/_components/EnrollmentClient.tsx` | Security / permissions | fix(enrollment): embed FUB link in client column | Authorization and export surface across modules | PASS — individual diff and final interaction checked; no material regression identified |
| 186 | `baae642914c5be3e2c79cde32948b46d840a467e` | BaoVoThuong<br>2026-08-09T13:44:07+07:00<br>parent `4c28d0df17d3ed39644829b41dc4f2c2b2b18567` | 1 files; +43/-3<br>`src/app/(authed)/enrollment/_components/EnrollmentClient.tsx` | Security / permissions | fix(enrollment): preserve read-only person colors | Authorization and export surface across modules | PASS — individual diff and final interaction checked; no material regression identified |
| 187 | `993db8f4d02f68bb09a0c2887da85f6f9138dbc3` | BaoVoThuong<br>2026-08-09T13:48:04+07:00<br>parent `baae642914c5be3e2c79cde32948b46d840a467e` | 6 files; +30/-6<br>`src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`, `src/app/(authed)/tasks/_components/TaskRowItem.tsx`, `src/lib/enrollment/option-badge.test.ts`, `src/lib/enrollment/option-badge.ts`, `src/lib/tasks/category-colors.test.ts`, `src/lib/tasks/category-colors.ts` | Enrollment | style(lists): soften identity badges | ACA and Medicare list/detail/create/API flows | PASS — individual diff and final interaction checked; no material regression identified |
| 188 | `4724042a7a9e90e51cc919272bde1965d815d910` | BaoVoThuong<br>2026-08-09T14:26:15+07:00<br>parent `993db8f4d02f68bb09a0c2887da85f6f9138dbc3` | 3 files; +740/-0<br>`docs/superpowers/plans/2026-08-09-searchable-dynamic-dropdowns.md`, `src/lib/ui/option-search.test.ts`, `src/lib/ui/option-search.ts` | Shared application | feat(ui): add searchable option matching helpers | Shared UI/runtime consumers named by the changed files | PASS — individual diff and final interaction checked; no material regression identified |
| 189 | `2be5cdb466534f582d9c41ebeae9e4265ed9d318` | BaoVoThuong<br>2026-08-09T14:32:05+07:00<br>parent `4724042a7a9e90e51cc919272bde1965d815d910` | 2 files; +289/-3<br>`src/app/(authed)/_shared/SearchableListboxPanel.tsx`, `src/app/(authed)/tasks/_components/use-anchored-menu.ts` | Security / permissions | feat(ui): add shared searchable listbox panel | Authorization and export surface across modules | PASS — individual diff and final interaction checked; no material regression identified |
| 190 | `e6fee2c5326391989048b14b961481fb74ed30b3` | BaoVoThuong<br>2026-08-09T14:32:31+07:00<br>parent `2be5cdb466534f582d9c41ebeae9e4265ed9d318` | 1 files; +16/-16<br>`docs/superpowers/plans/2026-08-09-searchable-dynamic-dropdowns.md` | Documentation | docs(plan): log searchable dropdown tasks 1 and 2 | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 191 | `49ec83dc3a29d498c31352b1563fb5a5c4f6c25e` | BaoVoThuong<br>2026-08-09T14:35:18+07:00<br>parent `e6fee2c5326391989048b14b961481fb74ed30b3` | 1 files; +57/-70<br>`src/app/(authed)/enrollment/_components/EnrollmentClient.tsx` | Security / permissions | feat(enrollment): add searchable option menus | Authorization and export surface across modules | PASS — individual diff and final interaction checked; no material regression identified |
| 192 | `261b9ae44c000a7122ea18eaf73796deed845f28` | BaoVoThuong<br>2026-08-09T14:35:40+07:00<br>parent `49ec83dc3a29d498c31352b1563fb5a5c4f6c25e` | 1 files; +13/-13<br>`docs/superpowers/plans/2026-08-09-searchable-dynamic-dropdowns.md` | Documentation | docs(plan): log enrollment searchable menus | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 193 | `2a76381bf1d07807e5d6a13ca048ef99b8271bce` | BaoVoThuong<br>2026-08-09T14:38:53+07:00<br>parent `261b9ae44c000a7122ea18eaf73796deed845f28` | 3 files; +153/-51<br>`src/app/(authed)/_shared/SearchableListboxPanel.tsx`, `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`, `src/app/(authed)/tasks/_components/TaskSelect.tsx` | Security / permissions | feat(enrollment): make people filters searchable | Authorization and export surface across modules | PASS — individual diff and final interaction checked; no material regression identified |
| 194 | `caa8b9e3b92919a6d5bc5805afb763457fc1050d` | BaoVoThuong<br>2026-08-09T14:39:15+07:00<br>parent `2a76381bf1d07807e5d6a13ca048ef99b8271bce` | 1 files; +12/-12<br>`docs/superpowers/plans/2026-08-09-searchable-dynamic-dropdowns.md` | Documentation | docs(plan): log enrollment people search | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 195 | `7fca96cad18e3c0af877b7591ca87a8e53a3904f` | BaoVoThuong<br>2026-08-09T14:42:35+07:00<br>parent `caa8b9e3b92919a6d5bc5805afb763457fc1050d` | 5 files; +136/-99<br>`src/app/(authed)/tasks/_components/NewTaskDialog.tsx`, `src/app/(authed)/tasks/_components/TaskAssigneePicker.tsx`, `src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx`, `src/app/(authed)/tasks/_components/TaskRowItem.tsx`, `src/app/(authed)/tasks/_components/TaskToolbar.tsx` | Security / permissions | feat(tasks): standardize searchable dynamic selectors | Authorization and export surface across modules | PASS — individual diff and final interaction checked; no material regression identified |
| 196 | `e0787d95458d700b419473b1d6f291a655411f64` | BaoVoThuong<br>2026-08-09T14:43:03+07:00<br>parent `7fca96cad18e3c0af877b7591ca87a8e53a3904f` | 1 files; +10/-10<br>`docs/superpowers/plans/2026-08-09-searchable-dynamic-dropdowns.md` | Documentation | docs(plan): log health cs selector standardization | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 197 | `4acfca413c1fcb10656fbb56aa3d95e9626eb88c` | BaoVoThuong<br>2026-08-09T14:44:10+07:00<br>parent `e0787d95458d700b419473b1d6f291a655411f64` | 3 files; +49/-14<br>`src/app/(authed)/_shared/EditableCustomCell.tsx`, `src/lib/table-config/values.test.ts`, `src/lib/table-config/values.ts` | Config / SLA | refactor(table-config): expose custom value equality | Configuration plus downstream task/enrollment behavior | PASS — individual diff and final interaction checked; no material regression identified |
| 198 | `1121a0c202e0a911828ad0ad885a08ad141ab1d9` | BaoVoThuong<br>2026-08-09T14:44:29+07:00<br>parent `4acfca413c1fcb10656fbb56aa3d95e9626eb88c` | 1 files; +6/-6<br>`docs/superpowers/plans/2026-08-09-searchable-dynamic-dropdowns.md` | Documentation | docs(plan): log custom value equality preparation | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 199 | `f45954e7a29ae5ffa44480421e3f800ebef8041f` | BaoVoThuong<br>2026-08-09T14:47:20+07:00<br>parent `1121a0c202e0a911828ad0ad885a08ad141ab1d9` | 2 files; +98/-44<br>`changelog.md`, `src/app/(authed)/_shared/EditableCustomCell.tsx` | Security / permissions | feat(ui): make custom field menus searchable | Authorization and export surface across modules | PASS — individual diff and final interaction checked; no material regression identified |
| 200 | `d6c4d7ea49663f85c9f2d06d6f7ead33250f7002` | BaoVoThuong<br>2026-08-09T14:47:45+07:00<br>parent `f45954e7a29ae5ffa44480421e3f800ebef8041f` | 1 files; +14/-14<br>`docs/superpowers/plans/2026-08-09-searchable-dynamic-dropdowns.md` | Documentation | docs(plan): log custom field menu lifecycle | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 201 | `48d64916472459b5a65cc70c2d3be2cbb940ce61` | BaoVoThuong<br>2026-08-09T14:49:38+07:00<br>parent `d6c4d7ea49663f85c9f2d06d6f7ead33250f7002` | 1 files; +6/-6<br>`docs/superpowers/plans/2026-08-09-searchable-dynamic-dropdowns.md` | Documentation | docs(plan): complete searchable dropdown regression pass | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 202 | `cc5e77331bfb61661b2c26baecc4d67f5fb29c8e` | BaoVoThuong<br>2026-08-09T14:49:54+07:00<br>parent `48d64916472459b5a65cc70c2d3be2cbb940ce61` | 1 files; +1/-1<br>`docs/superpowers/plans/2026-08-09-searchable-dynamic-dropdowns.md` | Documentation | docs(plan): record regression pass commit | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 203 | `0378f1cad90250104b31e1a6fc9dc84633ae6cde` | BaoVoThuong<br>2026-08-09T15:02:13+07:00<br>parent `cc5e77331bfb61661b2c26baecc4d67f5fb29c8e` | 1 files; +476/-0<br>`docs/superpowers/plans/2026-08-09-enrollment-stage-time-tracking.md` | Documentation | docs(enrollment): harden stage tracking plan | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 204 | `2b53be6437109cf01aa4b60d5e6ddcefd3e3582d` | BaoVoThuong<br>2026-08-09T15:12:40+07:00<br>parent `0378f1cad90250104b31e1a6fc9dc84633ae6cde` | 6 files; +234/-18<br>`changelog.md`, `src/app/(authed)/config/_components/ConfigClient.tsx`, `src/lib/enrollment/option-badge.ts`, `src/lib/table-config/value-colors.test.ts`, `src/lib/table-config/value-colors.ts`, `src/lib/tasks/category-colors.ts` | Enrollment | fix(config): align dropdown color previews | ACA and Medicare list/detail/create/API flows | PASS — individual diff and final interaction checked; no material regression identified |
| 205 | `b1c33a31241ea976da61265883291f12ab899db3` | BaoVoThuong<br>2026-08-09T15:16:02+07:00<br>parent `2b53be6437109cf01aa4b60d5e6ddcefd3e3582d` | 4 files; +88/-20<br>`changelog.md`, `src/app/(authed)/config/_components/ConfigClient.tsx`, `src/lib/table-config/value-colors.test.ts`, `src/lib/table-config/value-colors.ts` | Config / SLA | feat(config): cycle recommended dropdown colors | Configuration plus downstream task/enrollment behavior | PASS — individual diff and final interaction checked; no material regression identified |
| 206 | `2173014c9fdfa9ad84e60426aeee2105e718479b` | BaoVoThuong<br>2026-08-09T15:25:26+07:00<br>parent `b1c33a31241ea976da61265883291f12ab899db3` | 3 files; +139/-18<br>`changelog.md`, `docs/superpowers/plans/2026-08-09-enrollment-permission-final.md`, `scripts/seed-enrollment-samples.mjs` | Security / permissions | fix(seed): backfill enrollment QA sample agents | Authorization and export surface across modules | PASS — individual diff and final interaction checked; no material regression identified |
| 207 | `8fc1a96cad9467391ae96d59e45c96f8aab1baec` | BaoVoThuong<br>2026-08-09T15:25:46+07:00<br>parent `2173014c9fdfa9ad84e60426aeee2105e718479b` | 1 files; +1/-0<br>`docs/superpowers/plans/2026-08-09-enrollment-permission-final.md` | Documentation | docs(plan): record QA agent backfill | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 208 | `78208aa44fa58e093d7c2c0b7c5efd13befb35de` | BaoVoThuong<br>2026-08-09T15:28:54+07:00<br>parent `8fc1a96cad9467391ae96d59e45c96f8aab1baec` | 2 files; +136/-34<br>`changelog.md`, `src/app/(authed)/tasks/_components/CommentThread.tsx` | Security / permissions | fix(comments): flip mention menu above docked composer | Authorization and export surface across modules | PASS — individual diff and final interaction checked; no material regression identified |
| 209 | `ab3a7c7915c1a4a59173e95960e54a238cc3b95c` | BaoVoThuong<br>2026-08-09T23:48:28+07:00<br>parent `78208aa44fa58e093d7c2c0b7c5efd13befb35de` | 3 files; +164/-1<br>`changelog.md`, `supabase/rollouts/2026-08-09-enrollment-stage-time-schema.sql`, `supabase/schema.sql` | Database / migration | feat(enrollment): add stage-time tracking schema | Schema, deployment order, and all affected API consumers | F2/P1; F14/P3 — clean bootstrap ordering and lowercase invariant |
| 210 | `224bebb47dcea116b96847d143ac67ca6289ebe6` | BaoVoThuong<br>2026-08-09T23:53:02+07:00<br>parent `ab3a7c7915c1a4a59173e95960e54a238cc3b95c` | 3 files; +823/-0<br>`changelog.md`, `supabase/rollouts/2026-08-09-enrollment-stage-time-schema.sql`, `supabase/schema.sql` | Database / migration | feat(enrollment): add atomic enrollment mutation RPCs | Schema, deployment order, and all affected API consumers | F1/P0; F13/P2 — canonical ACL and mixed-version deployment blockers |
| 211 | `d361655cf400e51269c025cb8fd7b922639572d2` | BaoVoThuong<br>2026-08-09T23:54:30+07:00<br>parent `224bebb47dcea116b96847d143ac67ca6289ebe6` | 2 files; +228/-0<br>`changelog.md`, `supabase/rollouts/2026-08-09-enrollment-stage-time-test.sql` | Database / migration | test(enrollment): add stage tracking SQL assertions | Schema, deployment order, and all affected API consumers | F3 validation gap — tests omit archived/closed fixture |
| 212 | `fff248cdf2cd7e53e6910b3d4f0fea1d8b9e74e4` | BaoVoThuong<br>2026-08-09T23:56:05+07:00<br>parent `d361655cf400e51269c025cb8fd7b922639572d2` | 2 files; +253/-0<br>`changelog.md`, `supabase/rollouts/2026-08-09-enrollment-stage-time-backfill.sql` | Database / migration | chore(enrollment): add stage cycle backfill script | Schema, deployment order, and all affected API consumers | F3/P1 — archived stage backfill violates its constraint |
| 213 | `051c7701395be29b573b6a2111e5c2fadf00ea2f` | BaoVoThuong<br>2026-08-10T00:06:58+07:00<br>parent `fff248cdf2cd7e53e6910b3d4f0fea1d8b9e74e4` | 9 files; +168/-10<br>`changelog.md`, `src/lib/enrollment/overview-data.ts`, `src/lib/enrollment/overview-types.ts`, `src/lib/enrollment/queries.ts`, `src/lib/enrollment/schema-errors.test.ts`, `src/lib/enrollment/schema-errors.ts`, `src/lib/enrollment/stage-time.test.ts`, `src/lib/enrollment/stage-time.ts`, `src/lib/enrollment/types.ts` | Enrollment | feat(enrollment): expose stage-time fields and helpers | ACA and Medicare list/detail/create/API flows | PASS — individual diff and final interaction checked; no material regression identified |
| 214 | `64880484997fd75ccbac99979a2863053abdd93d` | BaoVoThuong<br>2026-08-10T00:10:02+07:00<br>parent `051c7701395be29b573b6a2111e5c2fadf00ea2f` | 7 files; +94/-158<br>`changelog.md`, `src/app/api/enrollment/[id]/attachments/[aid]/route.ts`, `src/app/api/enrollment/[id]/attachments/route.ts`, `src/app/api/enrollment/[id]/comments/[cid]/route.ts`, `src/app/api/enrollment/[id]/comments/route.ts`, `src/app/api/enrollment/[id]/route.ts`, `src/app/api/enrollment/route.ts` | Enrollment | feat(enrollment): route mutations through atomic RPCs | ACA and Medicare list/detail/create/API flows | F6-F7/P2; F13/P2; F16/P3 — audit atomicity, null attribution, rollout, dead path |
| 215 | `08948cd058e833f6cd11912bb5f1f03647e12afa` | BaoVoThuong<br>2026-08-10T00:12:32+07:00<br>parent `64880484997fd75ccbac99979a2863053abdd93d` | 8 files; +150/-3<br>`changelog.md`, `src/app/(authed)/enrollment/_components/EnrollmentOverview.tsx`, `src/app/api/enrollment/overview/route.ts`, `src/lib/enrollment/overview-data.ts`, `src/lib/enrollment/overview-types.ts`, `src/lib/enrollment/overview.ts`, `src/lib/enrollment/stage-metrics.test.ts`, `src/lib/enrollment/stage-metrics.ts` | Enrollment | feat(enrollment): add scoped stage dwell metrics | ACA and Medicare list/detail/create/API flows | F10/P2 — capped/unpaged list or auxiliary data path |
| 216 | `9df44a956edd58493b63d252e9a4a90c829aa5bc` | BaoVoThuong<br>2026-08-10T00:14:03+07:00<br>parent `08948cd058e833f6cd11912bb5f1f03647e12afa` | 3 files; +13/-0<br>`changelog.md`, `supabase/rollouts/2026-08-09-enrollment-stage-time-schema.sql`, `supabase/schema.sql` | Database / migration | fix(enrollment): record initial stage history atomically | Schema, deployment order, and all affected API consumers | PASS — individual diff and final interaction checked; no material regression identified |
| 217 | `62023f3fedc425ecbeb2c2080534321da5b99615` | BaoVoThuong<br>2026-08-10T00:14:45+07:00<br>parent `9df44a956edd58493b63d252e9a4a90c829aa5bc` | 1 files; +2060/-304<br>`docs/superpowers/plans/2026-08-09-enrollment-stage-time-tracking.md` | Documentation | docs(enrollment): record stage tracking execution evidence | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 218 | `441502bd74f9474fd4869b4421a914007af68c6e` | BaoVoThuong<br>2026-08-10T00:16:13+07:00<br>parent `62023f3fedc425ecbeb2c2080534321da5b99615` | 1 files; +1/-0<br>`docs/superpowers/plans/2026-08-09-enrollment-stage-time-tracking.md` | Documentation | docs(enrollment): record production build verification | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 219 | `e554e91549a12a1e9ddad3ffb1ced577edda5a00` | BaoVoThuong<br>2026-08-10T00:19:35+07:00<br>parent `441502bd74f9474fd4869b4421a914007af68c6e` | 4 files; +3914/-0<br>`changelog.md`, `docs/superpowers/plans/2026-08-09-task-collaboration-final-plan.md`, `scripts/audit-task-collaboration.ts`, `supabase/schema.sql` | Database / migration | chore(tasks): add collaboration audit script | Schema, deployment order, and all affected API consumers | PASS — individual diff and final interaction checked; no material regression identified |
| 220 | `24146e87f20e189d4c2f857a208571ae4ffeb08b` | BaoVoThuong<br>2026-08-10T00:21:04+07:00<br>parent `e554e91549a12a1e9ddad3ffb1ced577edda5a00` | 6 files; +74/-7<br>`changelog.md`, `docs/superpowers/plans/2026-08-09-task-collaboration-final-plan.md`, `src/app/api/tasks/[id]/comments/route.ts`, `src/lib/tasks/last-activity.test.ts`, `src/lib/tasks/last-activity.ts`, `supabase/schema.sql` | Database / migration | fix(tasks): clamp task version monotonically | Schema, deployment order, and all affected API consumers | PASS — individual diff and final interaction checked; no material regression identified |
| 221 | `e520f0e9830a4bfcd3d0e7c5226d373023d6ffe4` | BaoVoThuong<br>2026-08-10T00:22:25+07:00<br>parent `24146e87f20e189d4c2f857a208571ae4ffeb08b` | 5 files; +121/-1<br>`changelog.md`, `docs/superpowers/plans/2026-08-09-task-collaboration-final-plan.md`, `src/lib/tasks/activity-events.test.ts`, `src/lib/tasks/activity-events.ts`, `src/lib/tasks/mutation-result.ts` | Tasks | feat(tasks): add typed activity contracts | Health CS task list/detail/API flows | PASS — individual diff and final interaction checked; no material regression identified |
| 222 | `b59131d2bc38eb831e7964dca5cacfcaf0223ec4` | BaoVoThuong<br>2026-08-10T00:24:40+07:00<br>parent `e520f0e9830a4bfcd3d0e7c5226d373023d6ffe4` | 6 files; +61/-30<br>`changelog.md`, `docs/superpowers/plans/2026-08-09-task-collaboration-final-plan.md`, `src/app/(authed)/tasks/_components/AttachmentPanel.tsx`, `src/app/(authed)/tasks/_components/CommentThread.tsx`, `src/lib/tasks/detail.test.ts`, `src/lib/tasks/detail.ts` | Tasks | fix(task-detail): isolate unsignable attachments | Health CS task list/detail/API flows | PASS — individual diff and final interaction checked; no material regression identified |
| 223 | `fb7fd68ba967d240453f80001213ba6c0f937865` | BaoVoThuong<br>2026-08-10T00:26:38+07:00<br>parent `b59131d2bc38eb831e7964dca5cacfcaf0223ec4` | 4 files; +74/-5<br>`changelog.md`, `docs/superpowers/plans/2026-08-09-task-collaboration-final-plan.md`, `src/app/api/tasks/[id]/attachments/[aid]/route.ts`, `supabase/schema.sql` | Database / migration | fix(attachments): delete metadata before storage cleanup | Schema, deployment order, and all affected API consumers | F9/P2 — soft-deleted task attachments remain list-visible |
| 224 | `a4130c71ff7886d89a27ee6fc04e8ffe77a4fc33` | BaoVoThuong<br>2026-08-10T00:26:49+07:00<br>parent `fb7fd68ba967d240453f80001213ba6c0f937865` | 1 files; +1/-1<br>`docs/superpowers/plans/2026-08-09-task-collaboration-final-plan.md` | Documentation | docs(tasks): record task 5 execution | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 225 | `f48e1e119bdc35c113ccb40715351d5b63f7c9df` | BaoVoThuong<br>2026-08-10T00:30:01+07:00<br>parent `a4130c71ff7886d89a27ee6fc04e8ffe77a4fc33` | 5 files; +225/-80<br>`changelog.md`, `docs/superpowers/plans/2026-08-09-task-collaboration-final-plan.md`, `src/app/api/tasks/[id]/comments/route.ts`, `src/lib/tasks/participants.ts`, `supabase/schema.sql` | Database / migration | fix(comments): create comments atomically and idempotently | Schema, deployment order, and all affected API consumers | PASS — Task audit transaction improved; Enrollment parity tracked in F6 |
| 226 | `94d7b09699b5df4683cb98998a0a7aef9a2bf281` | BaoVoThuong<br>2026-08-10T00:30:17+07:00<br>parent `f48e1e119bdc35c113ccb40715351d5b63f7c9df` | 1 files; +1/-1<br>`docs/superpowers/plans/2026-08-09-task-collaboration-final-plan.md` | Documentation | docs(tasks): record task 6 execution | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 227 | `9dcf7a1817b6f17e0cce948d200b0e4765724dd5` | BaoVoThuong<br>2026-08-10T00:33:29+07:00<br>parent `94d7b09699b5df4683cb98998a0a7aef9a2bf281` | 6 files; +225/-34<br>`docs/superpowers/plans/2026-08-09-task-collaboration-final-plan.md`, `src/app/(authed)/tasks/_components/CommentThread.tsx`, `src/app/api/enrollment/[id]/comments/route.ts`, `src/lib/tasks/comment-submission.test.ts`, `src/lib/tasks/comment-submission.ts`, `supabase/schema.sql` | Database / migration | fix(comments): guard duplicate submissions across task and enrollment | Schema, deployment order, and all affected API consumers | PASS — individual diff and final interaction checked; no material regression identified |
| 228 | `728e299dbf4531c916901fac0eef772e115212fa` | BaoVoThuong<br>2026-08-10T00:33:41+07:00<br>parent `9dcf7a1817b6f17e0cce948d200b0e4765724dd5` | 1 files; +1/-1<br>`docs/superpowers/plans/2026-08-09-task-collaboration-final-plan.md` | Documentation | docs(tasks): record task 7 execution | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 229 | `19f9f44d6e24c041a050bb5aa2c82c021a879770` | BaoVoThuong<br>2026-08-10T00:37:23+07:00<br>parent `728e299dbf4531c916901fac0eef772e115212fa` | 5 files; +339/-32<br>`changelog.md`, `docs/superpowers/plans/2026-08-09-task-collaboration-final-plan.md`, `src/app/(authed)/tasks/_components/CommentThread.tsx`, `src/lib/tasks/comment-submission.test.ts`, `src/lib/tasks/comment-submission.ts` | Tasks | fix(comments): separate comment and file upload state | Health CS task list/detail/API flows | PASS — individual diff and final interaction checked; no material regression identified |
| 230 | `c51eafa1282d5e7e0a8f280d0b1e0fcb5aa2cfd9` | BaoVoThuong<br>2026-08-10T00:37:36+07:00<br>parent `19f9f44d6e24c041a050bb5aa2c82c021a879770` | 1 files; +1/-1<br>`docs/superpowers/plans/2026-08-09-task-collaboration-final-plan.md` | Documentation | docs(tasks): record task 8 execution | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 231 | `923075b7e740c6673ece6fde6bff3e98fa0c1642` | BaoVoThuong<br>2026-08-10T00:40:36+07:00<br>parent `c51eafa1282d5e7e0a8f280d0b1e0fcb5aa2cfd9` | 6 files; +288/-43<br>`changelog.md`, `docs/superpowers/plans/2026-08-09-task-collaboration-final-plan.md`, `src/app/(authed)/tasks/_components/CommentThread.tsx`, `src/app/api/tasks/[id]/attachments/route.ts`, `src/lib/tasks/attachments.test.ts`, `supabase/schema.sql` | Database / migration | fix(attachments): make uploads idempotent with compensation | Schema, deployment order, and all affected API consumers | F4/P2 — retry token accepted but ignored |
| 232 | `af8060fc0038b9ad90714b461f2409462b49f461` | BaoVoThuong<br>2026-08-10T00:40:50+07:00<br>parent `923075b7e740c6673ece6fde6bff3e98fa0c1642` | 1 files; +1/-1<br>`docs/superpowers/plans/2026-08-09-task-collaboration-final-plan.md` | Documentation | docs(tasks): record task 9 execution | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 233 | `c9249a2460a19bcdb9b896e6aa92803136d9d64c` | BaoVoThuong<br>2026-08-10T00:44:22+07:00<br>parent `af8060fc0038b9ad90714b461f2409462b49f461` | 6 files; +310/-63<br>`changelog.md`, `docs/superpowers/plans/2026-08-09-task-collaboration-final-plan.md`, `src/app/(authed)/tasks/_components/CommentThread.tsx`, `src/app/api/enrollment/[id]/comments/[cid]/route.ts`, `src/app/api/tasks/[id]/comments/[cid]/route.ts`, `supabase/schema.sql` | Database / migration | fix(comments): add atomic compare-and-swap edits | Schema, deployment order, and all affected API consumers | PASS — individual diff and final interaction checked; no material regression identified |
| 234 | `eeeddfd66a8a2d2a02bd971e6bb347202fade53b` | BaoVoThuong<br>2026-08-10T00:44:37+07:00<br>parent `c9249a2460a19bcdb9b896e6aa92803136d9d64c` | 1 files; +1/-1<br>`docs/superpowers/plans/2026-08-09-task-collaboration-final-plan.md` | Documentation | docs(tasks): record task 10 execution | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 235 | `4ce4f97dfbdb7937269765a8c1de091d655133ac` | BaoVoThuong<br>2026-08-10T00:46:39+07:00<br>parent `eeeddfd66a8a2d2a02bd971e6bb347202fade53b` | 8 files; +150/-11<br>`changelog.md`, `docs/superpowers/plans/2026-08-09-task-collaboration-final-plan.md`, `src/app/(authed)/tasks/_components/CommentThread.tsx`, `src/app/api/tasks/[id]/comments/[cid]/route.ts`, `src/lib/tasks/detail.ts`, `src/lib/tasks/queries.ts`, `src/lib/tasks/search.ts`, `supabase/schema.sql` | Database / migration | fix(comments): soft-delete comments and linked attachments atomically | Schema, deployment order, and all affected API consumers | F9/P2 — soft-deleted task attachments remain list-visible |
| 236 | `ce3ebc7261cc63699cc9e5c57407858d353ca187` | BaoVoThuong<br>2026-08-10T00:46:53+07:00<br>parent `4ce4f97dfbdb7937269765a8c1de091d655133ac` | 1 files; +1/-1<br>`docs/superpowers/plans/2026-08-09-task-collaboration-final-plan.md` | Documentation | docs(tasks): record task 11 execution | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 237 | `8a028e9312339c3a82738fe8f34abf583c4fd73a` | BaoVoThuong<br>2026-08-10T00:52:41+07:00<br>parent `ce3ebc7261cc63699cc9e5c57407858d353ca187` | 8 files; +67/-41<br>`changelog.md`, `docs/superpowers/plans/2026-08-09-task-collaboration-final-plan.md`, `src/app/api/tasks/[id]/route.ts`, `src/app/api/tasks/route.ts`, `src/lib/tasks/last-activity.test.ts`, `src/lib/tasks/last-activity.ts`, `src/lib/tasks/queries.ts`, `supabase/schema.sql` | Database / migration | fix(activity): pair last-activity actor with timestamp | Schema, deployment order, and all affected API consumers | PASS — individual diff and final interaction checked; no material regression identified |
| 238 | `3f741e29e95b413237a8bc40d7c43b0cdb1112a8` | BaoVoThuong<br>2026-08-10T00:53:02+07:00<br>parent `8a028e9312339c3a82738fe8f34abf583c4fd73a` | 1 files; +1/-1<br>`docs/superpowers/plans/2026-08-09-task-collaboration-final-plan.md` | Documentation | docs(tasks): record task 12 execution | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 239 | `2be2df95ba7880b8cfa46da972c4e04096ab8e8d` | BaoVoThuong<br>2026-08-10T00:54:10+07:00<br>parent `3f741e29e95b413237a8bc40d7c43b0cdb1112a8` | 6 files; +87/-6<br>`changelog.md`, `docs/superpowers/plans/2026-08-09-task-collaboration-final-plan.md`, `src/app/(authed)/tasks/_components/ActivityFeed.tsx`, `src/app/api/tasks/[id]/assignees/[email]/route.ts`, `src/lib/tasks/activity-events.test.ts`, `src/lib/tasks/activity-events.ts` | Tasks | fix(tasks): record assignee removals accurately | Health CS task list/detail/API flows | PASS — individual diff and final interaction checked; no material regression identified |
| 240 | `c10f567d82f74e3245e0dd3f66b7841cd3d38548` | BaoVoThuong<br>2026-08-10T00:54:23+07:00<br>parent `2be2df95ba7880b8cfa46da972c4e04096ab8e8d` | 1 files; +1/-1<br>`docs/superpowers/plans/2026-08-09-task-collaboration-final-plan.md` | Documentation | docs(tasks): record task 13 execution | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 241 | `ac2e23b756e9e1ed3fbd5e9929486faa67716b0a` | BaoVoThuong<br>2026-08-10T00:58:44+07:00<br>parent `c10f567d82f74e3245e0dd3f66b7841cd3d38548` | 5 files; +301/-120<br>`changelog.md`, `docs/superpowers/plans/2026-08-09-task-collaboration-final-plan.md`, `src/app/(authed)/tasks/_components/NewTaskDialog.tsx`, `src/app/api/tasks/route.ts`, `supabase/schema.sql` | Database / migration | fix(tasks): create tasks atomically and idempotently | Schema, deployment order, and all affected API consumers | F8/P2 — non-idempotent create/post-commit side effects |
| 242 | `3e0521ee6462235fce52c3e2d95ba7ccf5e36087` | BaoVoThuong<br>2026-08-10T00:58:57+07:00<br>parent `ac2e23b756e9e1ed3fbd5e9929486faa67716b0a` | 1 files; +1/-1<br>`docs/superpowers/plans/2026-08-09-task-collaboration-final-plan.md` | Documentation | docs(tasks): record task 14 execution | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 243 | `6b9c0ddd5794eff02a70aa165fd943dbfa821826` | BaoVoThuong<br>2026-08-10T01:01:02+07:00<br>parent `3e0521ee6462235fce52c3e2d95ba7ccf5e36087` | 4 files; +85/-24<br>`changelog.md`, `docs/superpowers/plans/2026-08-09-task-collaboration-final-plan.md`, `src/app/api/cron/check-overdue/route.ts`, `supabase/schema.sql` | Database / migration | fix(activity): make overdue transition atomic and idempotent | Schema, deployment order, and all affected API consumers | F12/P2 — bounded concurrency added, pagination/claim race remains |
| 244 | `e539de5693a22ceb69e45658054378042664ec65` | BaoVoThuong<br>2026-08-10T01:01:19+07:00<br>parent `6b9c0ddd5794eff02a70aa165fd943dbfa821826` | 1 files; +1/-1<br>`docs/superpowers/plans/2026-08-09-task-collaboration-final-plan.md` | Documentation | docs(tasks): record task 15 execution | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 245 | `f88ec8fff0b00b778c22c23143a5dac0e1df32a2` | BaoVoThuong<br>2026-08-10T01:05:38+07:00<br>parent `e539de5693a22ceb69e45658054378042664ec65` | 13 files; +161/-31<br>`changelog.md`, `docs/superpowers/plans/2026-08-09-task-collaboration-final-plan.md`, `src/app/(authed)/tasks/_components/ActivityFeed.tsx`, `src/app/(authed)/tasks/_components/CommentThread.tsx`, `src/app/(authed)/tasks/_components/OverdueLog.tsx`, `src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx`, `src/app/api/enrollment/[id]/comments/[cid]/edits/route.ts`, `src/app/api/tasks/[id]/comments/[cid]/edits/route.ts`, `src/lib/enrollment/detail.ts`, `src/lib/enrollment/types.ts`, `src/lib/people/display-names.test.ts`, `src/lib/people/display-names.ts`, `src/lib/tasks/detail.ts` | Enrollment | fix(comments): resolve canonical author and editor names | ACA and Medicare list/detail/create/API flows | PASS — individual diff and final interaction checked; no material regression identified |
| 246 | `42e15abf373279f24556583a8f7eff98a5566a69` | BaoVoThuong<br>2026-08-10T01:05:54+07:00<br>parent `f88ec8fff0b00b778c22c23143a5dac0e1df32a2` | 1 files; +1/-1<br>`docs/superpowers/plans/2026-08-09-task-collaboration-final-plan.md` | Documentation | docs(tasks): record task 16 execution | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 247 | `c28ad4451971dd8f9b9d665e4c0dbe0efba49906` | BaoVoThuong<br>2026-08-10T01:17:53+07:00<br>parent `42e15abf373279f24556583a8f7eff98a5566a69` | 7 files; +648/-173<br>`changelog.md`, `docs/superpowers/plans/2026-08-09-task-collaboration-final-plan.md`, `src/app/(authed)/tasks/_components/CommentThread.tsx`, `src/app/api/enrollment/[id]/comments/[cid]/route.ts`, `src/app/api/tasks/[id]/comments/[cid]/route.ts`, `src/lib/tasks/mention-draft.test.ts`, `src/lib/tasks/mention-draft.ts` | Enrollment | fix(comments): unify searchable mentions across create reply and edit | ACA and Medicare list/detail/create/API flows | PASS — individual diff and final interaction checked; no material regression identified |
| 248 | `a344eb3a9c0d861734280464951994209c0056c6` | BaoVoThuong<br>2026-08-10T01:18:15+07:00<br>parent `c28ad4451971dd8f9b9d665e4c0dbe0efba49906` | 1 files; +1/-1<br>`docs/superpowers/plans/2026-08-09-task-collaboration-final-plan.md` | Documentation | docs(plan): record unified mention implementation | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 249 | `d3f4052faa7ad890c83294316a762b4efc52f119` | BaoVoThuong<br>2026-08-10T01:19:21+07:00<br>parent `a344eb3a9c0d861734280464951994209c0056c6` | 3 files; +20/-10<br>`changelog.md`, `docs/superpowers/plans/2026-08-09-task-collaboration-final-plan.md`, `src/app/api/tasks/[id]/detail/route.ts` | Tasks | fix(task-detail): authorize before privileged reads | Health CS task list/detail/API flows | PASS — individual diff and final interaction checked; no material regression identified |
| 250 | `c32dea6a55185f6443bc3772b10c6cd62233d52b` | BaoVoThuong<br>2026-08-10T01:19:34+07:00<br>parent `d3f4052faa7ad890c83294316a762b4efc52f119` | 1 files; +1/-1<br>`docs/superpowers/plans/2026-08-09-task-collaboration-final-plan.md` | Documentation | docs(plan): record task detail authorization | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 251 | `91235d9d20a70f473d0050635dcf6258633eda75` | BaoVoThuong<br>2026-08-10T01:21:31+07:00<br>parent `c32dea6a55185f6443bc3772b10c6cd62233d52b` | 6 files; +87/-10<br>`changelog.md`, `docs/superpowers/plans/2026-08-09-task-collaboration-final-plan.md`, `src/app/(authed)/tasks/_components/CommentThread.tsx`, `src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx`, `src/lib/tasks/detail-cache.test.ts`, `src/lib/tasks/detail-cache.ts` | Tasks | fix(task-detail): expire and invalidate detail cache | Health CS task list/detail/API flows | F15/P3 — detail cache has no size bound |
| 252 | `4e6b454e855dabf35010dff3725bdaa18afb4a45` | BaoVoThuong<br>2026-08-10T01:21:45+07:00<br>parent `91235d9d20a70f473d0050635dcf6258633eda75` | 1 files; +1/-1<br>`docs/superpowers/plans/2026-08-09-task-collaboration-final-plan.md` | Documentation | docs(plan): record task detail cache hardening | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 253 | `062bed575672c31886d6a52b6694310a8b5dd25d` | BaoVoThuong<br>2026-08-10T01:24:06+07:00<br>parent `4e6b454e855dabf35010dff3725bdaa18afb4a45` | 7 files; +149/-12<br>`changelog.md`, `docs/superpowers/plans/2026-08-09-task-collaboration-final-plan.md`, `src/app/(authed)/tasks/_components/CommentThread.tsx`, `src/app/api/tasks/[id]/attachments/route.ts`, `src/app/api/tasks/[id]/comments/route.ts`, `src/lib/tasks/attachment-limits.test.ts`, `src/lib/tasks/attachment-limits.ts` | Tasks | fix(tasks): enforce collaboration operation limits | Health CS task list/detail/API flows | F5/P2 — attachment limits remain raceable/client-only |
| 254 | `7c1ee1e5c98e833f6abb4f111bc461030fd61aff` | BaoVoThuong<br>2026-08-10T01:24:22+07:00<br>parent `062bed575672c31886d6a52b6694310a8b5dd25d` | 1 files; +1/-1<br>`docs/superpowers/plans/2026-08-09-task-collaboration-final-plan.md` | Documentation | docs(plan): record collaboration operation limits | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 255 | `b4ad295811b5f91624acaab62604678cd2b831d8` | BaoVoThuong<br>2026-08-10T01:25:42+07:00<br>parent `7c1ee1e5c98e833f6abb4f111bc461030fd61aff` | 4 files; +39/-1<br>`changelog.md`, `docs/superpowers/plans/2026-08-09-task-collaboration-final-plan.md`, `scripts/audit-task-collaboration.ts`, `supabase/schema.sql` | Database / migration | fix(tasks): enforce same-task collaboration invariants | Schema, deployment order, and all affected API consumers | PASS — individual diff and final interaction checked; no material regression identified |
| 256 | `df4635bf6b4f5777479a329becaa769517d95a37` | BaoVoThuong<br>2026-08-10T01:26:00+07:00<br>parent `b4ad295811b5f91624acaab62604678cd2b831d8` | 1 files; +1/-1<br>`docs/superpowers/plans/2026-08-09-task-collaboration-final-plan.md` | Documentation | docs(plan): record same-task invariant audit | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 257 | `968b093894b6c4fdf791674e4ef317f25ccaca8d` | BaoVoThuong<br>2026-08-10T01:27:26+07:00<br>parent `df4635bf6b4f5777479a329becaa769517d95a37` | 5 files; +53/-20<br>`changelog.md`, `docs/superpowers/plans/2026-08-09-task-collaboration-final-plan.md`, `src/app/(authed)/tasks/_components/ActivityFeed.tsx`, `src/app/(authed)/tasks/_components/activity-labels.ts`, `src/lib/tasks/activity-events.test.ts` | Tasks | fix(activity): align feed labels with allowed vocabulary | Health CS task list/detail/API flows | PASS — individual diff and final interaction checked; no material regression identified |
| 258 | `2029f78800954cce22ad16a97314dd1354296912` | BaoVoThuong<br>2026-08-10T01:27:44+07:00<br>parent `968b093894b6c4fdf791674e4ef317f25ccaca8d` | 1 files; +1/-1<br>`docs/superpowers/plans/2026-08-09-task-collaboration-final-plan.md` | Documentation | docs(plan): record activity vocabulary alignment | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 259 | `f8af6f1d93b26d25864367f2d01e5cb06423ee17` | BaoVoThuong<br>2026-08-10T01:37:36+07:00<br>parent `2029f78800954cce22ad16a97314dd1354296912` | 5 files; +298/-33<br>`src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`, `src/app/(authed)/tasks/_components/CommentThread.tsx`, `src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx`, `src/lib/tasks/thread-view.test.ts`, `src/lib/tasks/thread-view.ts` | Tasks | fix(comments): fix thread navigation, counters and mutation feedback | Health CS task list/detail/API flows | PASS — individual diff and final interaction checked; no material regression identified |
| 260 | `c8e46df3cd42c7229ca46d9a86d0227a4e474e30` | BaoVoThuong<br>2026-08-10T01:38:13+07:00<br>parent `f8af6f1d93b26d25864367f2d01e5cb06423ee17` | 2 files; +9/-1<br>`changelog.md`, `docs/superpowers/plans/2026-08-09-task-collaboration-final-plan.md` | Documentation | docs(tasks): record thread navigation verification | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 261 | `b49eeaa07f28378aae4acf91b507940b17286c56` | BaoVoThuong<br>2026-08-10T01:41:41+07:00<br>parent `c8e46df3cd42c7229ca46d9a86d0227a4e474e30` | 1 files; +144/-22<br>`src/app/(authed)/tasks/_components/CommentThread.tsx` | Security / permissions | fix(comments): harden attachment presentation and preview | Authorization and export surface across modules | PASS — individual diff and final interaction checked; no material regression identified |
| 262 | `0ebad81e0d6272123b8295fcde9098ab2f2ddfbf` | BaoVoThuong<br>2026-08-10T01:42:07+07:00<br>parent `b49eeaa07f28378aae4acf91b507940b17286c56` | 2 files; +9/-1<br>`changelog.md`, `docs/superpowers/plans/2026-08-09-task-collaboration-final-plan.md` | Documentation | docs(tasks): record attachment UI verification | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 263 | `252f8e387e194e0cde1b09993fb9ba235699e226` | BaoVoThuong<br>2026-08-10T01:45:49+07:00<br>parent `0ebad81e0d6272123b8295fcde9098ab2f2ddfbf` | 2 files; +35/-15<br>`changelog.md`, `docs/superpowers/plans/2026-08-09-task-collaboration-final-plan.md` | Documentation | docs(tasks): record collaboration hardening verification | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 264 | `c335c237d2d6eb33b850b0fece94b1d5d3d82592` | BaoVoThuong<br>2026-08-10T01:46:06+07:00<br>parent `252f8e387e194e0cde1b09993fb9ba235699e226` | 1 files; +1/-1<br>`docs/superpowers/plans/2026-08-09-task-collaboration-final-plan.md` | Documentation | docs(tasks): link final reconciliation commit | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |
| 265 | `a55842906fd3d84d0213d0ff7da59474956688dc` | BaoVoThuong<br>2026-08-10T01:48:42+07:00<br>parent `c335c237d2d6eb33b850b0fece94b1d5d3d82592` | 1 files; +12/-4<br>`supabase/schema.sql` | Database / migration | fix(schema): correct task actor backfill correlation | Schema, deployment order, and all affected API consumers | PASS — individual diff and final interaction checked; no material regression identified |
| 266 | `ed9935985a9488dde75fde3f6d94162ff3c24d58` | BaoVoThuong<br>2026-08-10T01:49:06+07:00<br>parent `a55842906fd3d84d0213d0ff7da59474956688dc` | 2 files; +9/-1<br>`changelog.md`, `docs/superpowers/plans/2026-08-09-task-collaboration-final-plan.md` | Documentation | docs(tasks): record actor backfill SQL correction | No executable blast radius; rollout/review claims only | DOC — checked for rollout contradictions |

## GFI / ML / Ranking Review

No GFI symbol, service, input/output contract, model, retrieval candidate generator, learned ranker, embedding store, inference client, model version, or evaluation pipeline exists in the reviewed changes. Repository searches and architecture tracing found deterministic task/enrollment filtering, sorting, SLA calculation, and overview aggregation only.

- GFI input/output impact: not applicable.
- Retrieval/ranking accuracy: not applicable.
- Model input distribution: not applicable.
- Precision/recall/F1/calibration: not applicable.
- Required evaluation: ordinary business-rule regression tests and operational metric validation, not ML evaluation.

## Performance Review

- CPU: TypeScript overview aggregation and in-memory comment-search text scale linearly with all loaded records/comments. No production benchmark exists.
- Memory: whole-board data is loaded into server/client memory; task detail browser cache has no maximum size.
- Database: task search can create high query fan-out; overview/list/crons are unpaged; stage dwell cycles are paged only after an unpaged ID load.
- Network: list and overview transfer whole records and comment bodies. Realtime broadcasts can trigger refetches, but request-generation guards reduce stale-response overwrites.
- Cache: no server cache changed. Client cache TTL is five minutes; hit rate and memory are unmeasured.
- Inference: none.
- Concurrency: task atomic RPCs improve row-level correctness. Attachment limit checks and several cron claims remain non-atomic.
- p50/p95/p99/throughput: **UNKNOWN**. No load test, trace sample, or production metric evidence was provided. Required validation is listed below.

## Accuracy / Quality Review

There is no model-quality surface. For deterministic business behavior:

- Permission scope coverage improved across Enrollment reads, list, overview, export, and mutations.
- Task visible-search recall improved, with a performance tradeoff and a hard 1,000-candidate ceiling.
- Stage dwell metrics intentionally include only closed live cycles in the 90-day window; inferred backfill is excluded from operational median calculations.
- Audit accuracy regresses when caller/responsible is explicitly cleared.
- Enrollment auxiliary comment counts/search text can become incomplete at the backend cap.

## Reliability Review

Positive changes include optimistic concurrency, latest-request guards, atomic Task commands, canonical mutation responses, warning-based post-commit responses, per-file signing isolation in detail, and atomic stage/history updates. Remaining material gaps are migration bootstrap/backfill failure, non-idempotent Enrollment create/uploads, non-atomic Enrollment collaboration audit/delete, reminder claim races, unpaged jobs, and unsafe old-app rollback after stage schema rollout.

## Security Review

Evidence-based improvements:

- Cron secrets were removed from query strings and restricted to Bearer headers.
- Enrollment read/mutation scopes and per-action capabilities were added.
- Task export gained explicit UI/API permission enforcement.
- PostgREST filter identities are escaped.
- Existing `SECURITY DEFINER` RPC execution was restricted.

Blocking security issue: the later enrollment mutation RPCs are created after the global ACL sweep in canonical schema. Production ACLs must be inspected, not assumed.

Baseline dependency audit, not introduced by this commit range: `npm audit --omit=dev --audit-level=high` reports **9 vulnerabilities** (2 critical, 6 high, 1 moderate), including advisories affecting `next`, `next-auth`, `xlsx`, `sharp`, `ws`, `postcss`, `nanoid`, and `qs`. `package.json` and the lockfile did not change in this window, so this is a carry-forward release risk rather than a Friday-commit regression. Reachability/remediation must still be triaged before go-live; `xlsx` remains imported by active automation/parser/export code.

## Data / API Compatibility Review

- Schema additions are mostly nullable/additive, supporting new app + old data.
- New code + old schema intentionally fails closed for stage tracking, so schema must deploy first.
- Old app + new stage schema is not safe for rollback because old writes bypass cycle/history maintenance.
- Task idempotency fields are nullable, so old clients remain accepted.
- Enrollment create/upload lacks equivalent request-token compatibility.
- Import UI/routes were removed while legacy import tables remain. This is deliberate preservation, not a runtime regression.
- No external/mobile API consumer was found; compatibility conclusions are limited to repository consumers.

## Cross-Commit Regression Analysis

| Area | Before | After | Compound risk |
| --- | --- | --- | --- |
| Mutation races | Many route-level multi-write paths | Task and Enrollment core edits increasingly atomic | Enrollment collaboration and create/upload remain split, creating inconsistent guarantees across one UI |
| Stage tracking | No durable Enrollment dwell cycles | Atomic cycles/history plus overview dwell metrics | Canonical schema order, ACL order, backfill bug, and rollback incompatibility combine into a blocked rollout |
| Permissions | Several Enrollment reads/controls were broad or UI-only | Scoped reads, action capabilities, export permission | Exact lowercase list scope still relies on a data invariant; production role/ACL matrix remains required |
| Search | Raw limited matches could hide visible results | Visibility-aware paged scan | Correctness improves while worst-case DB work rises by orders of magnitude |
| Lists | Could silently truncate | Primary lists fail closed | Correctness improves but availability now has a hard cap; auxiliary Enrollment rows can still silently truncate |
| Collaboration | Duplicate/non-atomic operations | Tasks gain idempotency, CAS, soft deletion, limits | Enrollment shared UI advertises guarantees its server does not provide; Task soft-delete consumer was missed |
| Reminders | Multiple non-atomic markers | Initial Task overdue transition atomic | Other reminder classes, Enrollment cron, paging, and concurrency remain weak |
| UI consistency | Divergent controls/badges/dropdowns | Shared searchable listbox and softened badges | No material functional regression found; browser accessibility regression matrix is still not automated |

The highest compound risk is not any one stage-time function. It is the required deployment chain: canonical schema currently fails; the one-pass ACL is unsafe if the failure is worked around; the historical backfill then fails on archived data; and rolling application code back after schema success creates silent tracking gaps.

## Verification Performed

- `npm run typecheck`: PASS.
- `npm run test:run`: PASS — 78 test files, 560 tests.
- `npm run lint`: PASS with 0 errors and 3 warnings in `CommentThread.tsx` cleanup-ref access.
- `npm run build`: PASS.
- `supabase/schema.sql` clean PostgreSQL apply: FAIL at line 3368 (`agent_email` missing).
- `supabase/schema.sql` rerun after a manual local test-only column workaround: PASS; second idempotent rerun: PASS.
- Enrollment stage SQL assertion script: PASS (transaction rolls back as designed).
- Enrollment stage backfill on empty data: PASS.
- Enrollment stage backfill on archived historical fixture: FAIL with `entry_marker` duration check violation.
- First-pass ACL test after only bypassing the ordering error: FAIL — four mutation RPCs have `PUBLIC EXECUTE`.
- Final-schema ACL after a second full rerun: PASS, demonstrating why a rerun can mask the first-pass defect.
- `npm audit --omit=dev --audit-level=high`: 9 baseline vulnerabilities; no dependency file changed in range.
- No CI workflow was found that runs typecheck/tests/build or a clean database bootstrap. The only GitHub workflow in scope is task reminders.

No claim is made that production browser flows, live Supabase RLS/ACLs, notification delivery, cron scheduling, or performance passed; those were not available from repository-local evidence.

## Missing Tests / Validation

### Must fix before merge / deployment

1. One-pass clean `schema.sql` bootstrap and second-pass idempotency test.
2. First-pass `SECURITY DEFINER` ACL assertion for every public-schema function.
3. Stage backfill fixtures for archived and closed records, plus rerun idempotency.
4. Enrollment explicit-null ownership audit test.
5. Task attachment GET test proving soft-deleted rows are excluded.

### Must validate before production

1. Production `pg_proc.proacl` query and anon/authenticated RPC denial tests.
2. Production stage preflight counts and backfill dry run in a maintenance window.
3. Role matrix for manager/plain worker/agent/assistant/caller/responsible/creator across list, direct link, detail, export, comment, attachment, edit, archive, and QC.
4. Concurrent retry tests for Enrollment create/upload/comment/delete and all scheduled reminders.
5. Volume tests above the configured PostgREST cap for Tasks, both Enrollment programs, overview, exports, comments, attachments, and crons.
6. Search benchmark with DB query count plus p50/p95/p99 at realistic and 10x data.
7. Dependency advisory reachability and upgrade/mitigation decision.
8. Browser keyboard/screen-reader matrix for the portaled searchable listboxes.

### Recommended follow-up

1. CI job that provisions a clean PostgreSQL database, applies schema once/twice, runs SQL assertions, and validates ACLs.
2. Bounded concurrency and metrics for cron processed/claimed/notified/failed counts.
3. Outbox/reconciliation for notification and rotation side effects that must survive process termination.
4. LRU/maximum size for the browser detail cache.

## FINAL VERDICT

**BLOCK**

The change set must not be promoted through the canonical schema/backfill path until the P0/P1 items are fixed and their one-pass tests pass. Runtime TypeScript quality is generally strong and many commits materially improve race handling, permissions, UI consistency, and auditability. The blockers are deployment/database defects that normal unit/build checks do not exercise.

## MUST-FIX BEFORE MERGE

### [P0] Restrict new enrollment `SECURITY DEFINER` RPCs on first creation

```text
Commit: 224bebb47dcea116b96847d143ac67ca6289ebe6
File: supabase/schema.sql
Required change: final ACL sweep or adjacent explicit revoke/grant for every new routine;
                 verify current production ACLs immediately.
Validation: one-pass clean schema + pg_proc ACL assertion + anon/authenticated denial calls.
```

### [P1] Repair canonical schema column ordering

```text
Commit: ab3a7c7915c1a4a59173e95960e54a238cc3b95c
File: supabase/schema.sql
Required change: create/add agent_email before normalization.
Validation: clean apply and idempotent rerun both exit zero.
```

### [P1] Repair inactive-record stage backfill

```text
Commit: fff248cdf2cd7e53e6910b3d4f0fea1d8b9e74e4
File: supabase/rollouts/2026-08-09-enrollment-stage-time-backfill.sql
Required change: make kind/timestamps/duration satisfy the intended historical semantics and constraint.
Validation: archived/closed fixtures plus double-run idempotency and invariant assertions.
```
