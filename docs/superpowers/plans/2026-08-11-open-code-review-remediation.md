# Open Code Review — Validated Production Remediation Plan

> **Review-only output.** This document validates Alibaba Open Code Review findings against the
> current repository. It does not authorize changing production data or applying SQL to production.
> During execution, complete one task per commit and append the commit SHA to the log in section 10.

**Goal:** Fix only the production risks that remain after independently validating the automated
review, with particular attention to Health CS Tasks, ACA/Medicare Enrollment, Config Table, and
their shared database/data-sync dependencies.

**Reviewed revision:** branch `config`, commit `9a6a94cc9740c837367c22a38305399baabaa97e`

**Review tool:** `@alibaba-group/open-code-review` / `ocr` 1.9.1, Anthropic Claude Sonnet 4.5

**Architecture in scope:** Next.js 16.2.4 App Router, React, TypeScript, Supabase/PostgreSQL,
PostgREST RPCs, Supabase Realtime/Storage, XLSX automation routes, and the Node Google-Sheet sync.

---

## 1. Audit evidence and limits

The global package was installed and the provider connectivity check passed. OCR preview found 531
tracked candidates. It classified 350 as reviewable; the partitioned full scan successfully
processed 349 source/config files. `package-lock.json` was assigned but skipped by OCR at runtime.
Two generated documentation deck HTML files larger than 2 MB were not source code and were not
included.

| Metric | Result |
|---|---:|
| Successful scan partitions | 12 / 12 |
| Source/config files reviewed | 349 |
| Raw OCR comments | 1,410 |
| Raw severity | 10 critical · 172 high · 684 medium · 544 low |
| Raw category | 502 bug · 87 security · 109 performance · 617 maintainability · 95 other |
| Model tokens | 8,846,620 total · 560,184 output |

Successful OCR session IDs:

```text
03ee2f7b-065e-4fe5-8932-8ec28ed4f2d6
398b8248-1ace-45c4-87bb-38eeba471408
769a67ef-f384-4c79-86a5-e6227ecb41f1
9be77cfb-b740-4928-95af-dfe312965376
1150259c-9ebc-4b54-b66b-e21ef9294baf
f7a99347-2536-48cf-af7e-86b1b0c9b890
a7257664-1b03-4b91-9c9c-8f7a350072d7
d866ddf2-a84b-4a8b-bd91-7122144d3c92
e694d651-079d-495e-8932-9abc0fd38f87
804c596d-c162-42b3-a406-b2402bcf0833
e6a21d6b-a7bd-4467-ba58-6c3940c15db3
c839ef4e-376a-4733-9fb1-28ffdc2927e1
```

### [Codex validation]

Raw severity is not accepted as final severity. Every carried finding below was checked for a
reachable code path, existing guard, schema invariant, caller contract, and realistic production
trigger. Representative rejected findings are recorded in section 8 so an executing agent does not
reintroduce bugs by following an incorrect automated suggestion.

---

## 2. Final validated finding matrix

| ID | Final sev | Area | Validated finding | Status |
|---|---|---|---|---|
| OCR-01 | **P0 conditional** | Data sync / DB security | Standalone `datasync/schema.sql` creates destructive `SECURITY DEFINER` RPCs without revoking default `PUBLIC EXECUTE` | Open; production ACL audit gates all work |
| OCR-02 | **P1** | Health statement | Clear and insert use separate transactions; an insert failure leaves `health_payment_summary` empty | Open |
| OCR-03 | **P1** | Google Sheet sync | Delete-first plus batched upsert can leave a source empty or partially refreshed | Open |
| OCR-04 | **P1** | Automation uploads | Three workbook routes have no count, per-file, aggregate-size, or accepted-type guard before concurrent parsing | Open |
| OCR-05 | **P1** | Enrollment migration | Stage backfill commits before validating its new constraint | Open |
| OCR-06 | **P2** | Tasks + Enrollment | `TASK-xxx` has 900 values and `ENR-xxxx` has 9,000; duplicate visible identifiers are realistic/already likely | Open |
| OCR-07 | **P2** | Config agents | Membership deletion and agent deletion are two non-atomic statements | Open |
| OCR-08 | **P2** | Config dropdowns | Custom-option creation ignores the max-position read error and computes the next position outside a lock | Open |
| OCR-09 | **P2** | Task/Enrollment collaboration | Both detail loaders fetch every comment and sign every comment attachment with no page/cursor bound | Open |
| OCR-10 | **P2** | Enrollment attachments | One signed-URL failure rejects the entire Enrollment detail while Tasks fail soft per file | Open |
| OCR-11 | **P2** | Enrollment create | Create loads all options once, then reloads all sets/options once per populated option field | Open |
| OCR-12 | **P2 / decision gate** | Data mart accuracy | `paid_producer` appends `/2025` in 2026; health-row filter uses a contradictory NULL predicate | Product semantics must be confirmed before changing |
| OCR-13 | **P2** | Task/Enrollment UI | Attachment deletion failure is silent; users cannot tell whether the file was removed | Open |
| OCR-14 | **P3** | Notifications | Five optional enrichment queries ignore their errors, silently degrading title/name/body without telemetry | Open |
| OCR-15 | **P3** | Task access diagnostics | Participant lookups turn every DB failure into `false`, masking outages as authorization misses | Open |
| OCR-16 | **P3** | Realtime hardening | Missing `AUTH_SECRET` falls back to the public constant `task-notify` for per-user topic HMACs | Open |
| OCR-17 | **P3** | Enrollment maintainability | PATCH constructs a second, unused activity array after the atomic RPC already persisted activity | Open |

**Go-live rule:** any confirmed live exposure in OCR-01 and all P1 items block go-live. OCR-06 and
OCR-09 need explicit product acceptance if not completed before release. P3 items do not block alone.

---

## 3. Global execution constraints

- Do not apply schema files to production while implementing. Test SQL against a disposable
  PostgreSQL/Supabase database first.
- Run the production ACL query in Task 1 read-only. If it finds exposure, revoke first and treat it
  as an incident; do not wait for the application release.
- Schema first, code second for new columns/RPCs. New application code must not be deployed against
  an old schema that lacks its contract.
- Every task is one commit. Add a `changelog.md` entry for logic/schema changes and record the SHA in
  section 10. Preserve unrelated worktree changes.
- Before editing a Next.js route, read
  `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`.
- Keep ACA and Medicare on the same shared implementation unless a business rule genuinely differs.
- Do not replace database UUIDs as internal identifiers. The display-key work adds a durable unique
  human identifier; permissions, mutations, routes, and relationships continue to use UUIDs.
- Do not solve upload pressure with debounce or client-only checks. The server and platform boundary
  must reject oversized requests.
- Do not solve data replacement with a compensating second request. The old live data must remain
  visible unless the complete replacement commits.

---

# Phase 0 — Release gates

## Task 1 — Audit and lock down standalone datasync RPC privileges (OCR-01)

**Evidence:** `datasync/schema.sql` defines `refresh_pc_mart()`, `refresh_health_mart()`, and
`clear_health_payment_summary()` as `SECURITY DEFINER`. The file has no `REVOKE`. PostgreSQL grants
function execution to `PUBLIC` by default; `clear_health_payment_summary()` runs `TRUNCATE`.
`supabase/schema.sql` is protected by a final global ACL sweep, but the standalone datasync setup
file must be safe on its own. `CREATE OR REPLACE` retains an existing ACL, so the live severity
depends on which artifact first created the functions. That uncertainty makes the production audit
mandatory.

**Files:**

- Create `datasync/security-definer-acl-audit.sql` (read-only)
- Modify `datasync/schema.sql`
- Add a disposable-database SQL assertion

**Steps:**

- [ ] Query every `public` routine where `prosecdef`, reporting
  `has_function_privilege('anon'|'authenticated'|'service_role', oid, 'execute')`.
- [ ] Run the query against production read-only and record timestamp/result. Healthy means
  `anon=false`, `authenticated=false`, `service_role=true` for every row.
- [ ] If exposed, immediately revoke `public, anon, authenticated`, grant only `service_role`, then
  review logs/table mutations during the exposure window. This is the only production mutation in
  this plan and requires explicit operational authorization.
- [ ] Add explicit revoke/grant statements directly after all three definitions in
  `datasync/schema.sql`, plus an end-of-file assertion matching the main schema's fail-closed ACL
  invariant.
- [ ] Apply standalone datasync schema to an empty scratch DB and prove an `authenticated` role
  cannot execute any of the three functions while `service_role` can.

**Commit:** `fix(security): lock down datasync definer RPCs`

## Task 2 — Make stage backfill validation atomic (OCR-05)

**Evidence:** `supabase/rollouts/2026-08-09-enrollment-stage-time-backfill.sql` executes its manual
invariants, then `COMMIT`, then `VALIDATE CONSTRAINT`. If validation fails, the backfill is already
durable and `ROLLBACK` is impossible.

**Steps:**

- [ ] Move `VALIDATE CONSTRAINT enrollment_records_stage_entry_required_check` before `COMMIT`.
- [ ] Keep the existing manual invariant block; it provides clearer diagnostics than the constraint.
- [ ] Add a scratch SQL case that deliberately creates an invalid row, proves the script fails, and
  proves all backfill writes roll back.
- [ ] Re-run the successful backfill replay and its existing stage-cycle test.

**Do not implement OCR's other constraint suggestion.** The schema already enforces
`stage_entered_at` and `stage_entered_source` as a pair; the rollout dependency on existing
`enrollment_activity` and `enrollment_stage_history` is an explicit prerequisite, not a missing
table bug.

**Commit:** `fix(enrollment): validate stage backfill before commit`

---

# Phase 1 — Data integrity and availability

## Task 3 — Replace health payment summary in one transaction (OCR-02)

**Evidence:** `src/app/api/automation/health-statement/run/route.ts` calls
`clear_health_payment_summary`, then separately inserts parsed rows. Failure of the insert returns
500 after the old summary has been destroyed.

**Steps:**

- [ ] Add one service-role-only RPC that accepts the validated replacement rows and performs the
  delete/truncate plus insert in one transaction.
- [ ] Validate all expected JSON fields/types inside the RPC before deleting existing rows.
- [ ] Have the route call only the replacement RPC; remove the separate clear/insert sequence.
- [ ] Revoke public/anon/authenticated execution at the definition site and keep the global ACL
  assertion green.
- [ ] Failure-injection test: malformed/new-row insertion fails and the old fixture dataset remains
  byte-for-byte unchanged.
- [ ] Success test: replacement is complete, no mixed old/new rows, report generation still uses the
  exact parsed rows returned by the request.

**Commit:** `fix(automation): replace health summary atomically`

## Task 4 — Stage and atomically finalize Google Sheet syncs (OCR-03)

**Evidence:** `datasync/lib/sync-runner.js` deletes current rows first, then sends 500-row upsert
batches. A network/constraint failure after delete leaves zero or partial data. A catch block would
improve the message but would not repair integrity.

**Implementation contract:**

- [ ] Introduce a staging table keyed by `run_id`, target, source sheet/gid, and source row number.
- [ ] Upload batches only to staging. Live readers must never see staging rows.
- [ ] Add a service-role-only finalize RPC. It must whitelist the known target tables, lock the
  target source partition, delete the old source partition, insert every staged row, and remove the
  staging run in one DB transaction.
- [ ] If validation/insert/finalize fails, the old live partition remains intact. Retain or clean the
  failed staging run with a bounded TTL job.
- [ ] Reject empty filters, unknown table/RPC names, missing sheet/gid, and a non-positive or
  non-integer batch size before any service-role request. These are internal hardening checks, not
  claims of current user-controlled injection.
- [ ] Test failure on batch 2/N, failure during finalize, process interruption, retry of the same
  run ID, and two concurrent runs for the same source.

**Commit:** `fix(datasync): finalize sheet refreshes atomically`

## Task 5 — Bound workbook upload resources (OCR-04)

**Affected routes:**

- `src/app/api/automation/health-statement/run/route.ts`
- `src/app/api/automation/health-statement/report-preview/route.ts`
- `src/app/api/automation/pc-statement/report-preview/route.ts`

**Steps:**

- [ ] Add one shared server-side validator for allowed XLS/XLSX MIME/extension, max file count,
  max bytes per file, and aggregate bytes. Define constants once.
- [ ] Validate `File.size` and type before any `arrayBuffer()` or workbook parser call.
- [ ] Replace unbounded `Promise.all(files.map(...))` with sequential parsing or an explicit small
  concurrency limit.
- [ ] Configure the hosting/platform request-body limit consistently; app checks occur after
  `request.formData()` and cannot replace an upstream body cap.
- [ ] Return 400 for invalid type/count and 413 for byte limits. Do not expose parser internals.
- [ ] Test boundary minus one, exact limit, limit plus one, too many files, aggregate overflow,
  spoofed extension/MIME, and confirm the parser is not called on rejection.

**Commit:** `fix(automation): bound workbook upload resources`

---

# Phase 2 — Tasks, Enrollment, and Config correctness

## Task 6 — Add durable unique Task and Enrollment display numbers (OCR-06)

**Evidence:** `taskKey()` hashes UUIDs into 900 values. `enrollmentKey()` hashes into 9,000 values.
These keys are displayed in rows, drawers, notifications, search, and exports. With hundreds of
records, collisions are realistic; UUID routing prevents direct data corruption, but users can no
longer reliably identify a record by the visible key.

**Steps:**

- [ ] Add immutable, non-null, unique numeric display columns for `tasks` and
  `enrollment_records`, backed by separate sequences/identity generators.
- [ ] Backfill existing rows deterministically by `created_at, id`; verify no duplicates/nulls and
  advance sequences beyond the maximum.
- [ ] Deploy schema before application code. Old code may continue hashing during the rolling
  window; new code must read the canonical number from DB and never derive it from UUID.
- [ ] Thread the canonical value through list/detail/search/notification/export query shapes and
  types. Keep UUIDs as API/resource identifiers.
- [ ] Decide and document external compatibility: existing hash labels will change once. If users
  rely on them outside the app, export a one-time old-label → new-label mapping.
- [ ] Tests: uniqueness for more than 20,000 fixtures, immutability across edits, search/export
  parity, notification labels, and sequence behavior after backfill.

**Commit:** `fix(records): make visible task and enrollment keys unique`

## Task 7 — Delete Config agents atomically (OCR-07)

**Evidence:** `DELETE /api/config/agents` deletes `agent_members`, then `task_agents`. Failure of the
second statement leaves the agent configured but all assistant mappings gone.

**Steps:**

- [ ] Add `delete_task_agent_atomic(email)` RPC or a correct FK cascade with the intended ownership
  direction. Prefer the RPC if cascade behavior for historical references is not globally safe.
- [ ] Normalize email inside the transaction and lock/check the target agent.
- [ ] Return whether a row was deleted; make repeated delete idempotent.
- [ ] Route calls only the atomic operation, then sends best-effort config invalidation.
- [ ] Failure-injection proves membership and agent rows both roll back.

**Commit:** `fix(config): delete task agents atomically`

## Task 8 — Allocate custom dropdown positions atomically (OCR-08)

**Evidence:** `POST /api/config/columns/[id]/options` ignores the error from its descending-position
query. On failure it silently selects position 10. Concurrent creates can also compute the same
next position.

**Steps:**

- [ ] First, fail on the existing max-position query error rather than continuing.
- [ ] Move default position allocation into a transaction/RPC that locks the parent column, verifies
  it is an active custom dropdown, calculates `max(position)+10`, and inserts the option.
- [ ] Preserve explicit position only if a current caller legitimately sends it; validate bounds.
- [ ] Add concurrent-create and query-failure tests; ensure label/color validation and Config
  realtime invalidation remain unchanged.

**Commit:** `fix(config): allocate dropdown option positions safely`

## Task 9 — Paginate collaboration history consistently (OCR-09, OCR-10)

**Evidence:** `loadComments()` and `loadEnrollmentComments()` load every comment and every comment
attachment. Each detail open signs all attachment URLs. Task activity is capped at 200 and
Enrollment activity at 250, but comments are unbounded. Enrollment signing uses `Promise.all`, so
one storage failure turns the complete drawer into a 500; Tasks already return individual files as
unavailable.

**Steps:**

- [ ] Define one cursor contract for Task and Enrollment comment history, ordered by
  `(created_at, id)`, with an explicit page size and `nextCursor/hasMore`.
- [ ] Initial detail loads the newest page for fast open; UI offers “Load older comments” and
  preserves chronological rendering, reply structure, counts, edit/delete state, and deep-link
  highlighting. A highlighted older comment must be fetched directly or by cursor expansion.
- [ ] Query/sign only attachments belonging to returned comments.
- [ ] Use bounded `allSettled`-style signing for Enrollment as Tasks do. Return an unavailable file
  marker instead of failing the drawer.
- [ ] Keep current comment POST/edit/delete contracts backward compatible during rollout.
- [ ] Add tests for equal timestamps, page boundaries, deleted comments, replies whose parent is on
  an older page, deep links, one failed signed URL, and 1,000+ comment performance.

**Commit:** `fix(collaboration): paginate task and enrollment history`

## Task 10 — Reuse the Enrollment option snapshot during create (OCR-11)

**Evidence:** `POST /api/enrollment` calls `fetchEnrollmentOptionData(program)` for the initial
stage, then each call to `assertEnrollmentOptionSet()` reloads all sets/options. A fully populated
ACA request can repeat the same two database queries multiple times and can validate fields from
different snapshots.

**Steps:**

- [ ] Validate all requested option IDs against one loaded program snapshot/map, including expected
  set and `archived_at` state.
- [ ] Preserve the configured first-stage fallback and program-specific set list.
- [ ] Do not introduce a process-global stale cache. Config invalidation correctness is more
  important than avoiding two small queries across requests.
- [ ] Test wrong program, wrong set, archived option, missing option, stage fallback, and assert one
  set query plus one option query per create request.

**Commit:** `perf(enrollment): validate create options from one snapshot`

## Task 11 — Surface attachment deletion failures (OCR-13)

**Evidence:** shared `AttachmentPanel.remove()` ignores non-OK responses and network errors. The row
remains, but the user receives no explanation and may repeatedly click delete.

**Steps:**

- [ ] Add per-file deleting state, prevent duplicate clicks, parse the server error, and render an
  accessible inline error/toast.
- [ ] Reload only on success; keep the file visible on failure.
- [ ] Verify the shared component against CS Tasks, ACA, and Medicare API bases.
- [ ] Tests or browser proofs: 403, 404, 500, network loss, success, and rapid double click.

**Commit:** `fix(collaboration): report attachment delete failures`

---

# Phase 3 — Data-quality decision gate

## Task 12 — Correct stale year and health-row filtering semantics (OCR-12)

This task must not guess business meaning.

**Confirmed code facts:**

- Both `supabase/schema.sql` and `datasync/schema.sql` append `/2025` when `paid_producer` lacks a
  four-digit year. The current date is 2026, so new yearless inputs can be recorded in the wrong year.
- Both files use `deal_name is null AND btrim(deal_name) <> ''`, which can never be true; SQL NULL
  propagation makes the enclosing predicate behave differently from a normal empty-row filter.

**Required product decisions:**

- [ ] Identify what year a yearless `paid_producer` represents: statement year, import/report year,
  policy effective year, or invalid input. Do **not** blindly use `current_date`; reprocessing old
  statements would then change historical output.
- [ ] Confirm which Health rows are junk. Recommended explicit rule if either identifier is valid:
  keep rows where `coalesce(btrim(deal_name),'') <> '' OR
  coalesce(btrim(primary_member_id),'') <> ''`.
- [ ] Build fixtures from real 2025/2026 statements, year boundary, null/blank names, member-only
  rows, and fully blank rows.
- [ ] Apply the identical expression to both schema sources and add a parity test so they cannot
  drift again.
- [ ] Rebuild marts in scratch, compare row counts/totals before and after, and require business
  sign-off for any changed record.

**Commit after decisions:** `fix(datasync): derive statement dates and filter blank health rows`

---

# Phase 4 — Non-blocking hardening

## Task 13 — Make optional notification enrichment observable (OCR-14)

- [ ] Inspect `.error` from all five enrichment queries in
  `src/app/api/tasks/notifications/route.ts`.
- [ ] Keep the bell fail-soft: return base notifications even if optional title/name/body enrichment
  fails. Do not turn a partial enrichment outage into a blank notification list.
- [ ] Emit one structured warning/metric naming failed enrichments without logging comment text/PII.
- [ ] Test each secondary query failing independently.

**Commit:** `fix(notifications): observe enrichment degradation`

## Task 14 — Distinguish participant outage from non-membership (OCR-15)

- [ ] Preserve fail-closed authorization, but stop representing arbitrary DB errors as a confirmed
  `false` membership result.
- [ ] During any supported additive-schema rollout, only SQLSTATE `42P01` may use the documented
  temporary assignee-only fallback. Other errors should throw to the route and become an observable
  500, never a misleading 403/404.
- [ ] Apply the same rule to participant ID/email loaders; add DB failure and missing-table tests.

**Commit:** `fix(tasks): expose participant lookup failures safely`

## Task 15 — Remove predictable production notification-topic fallback (OCR-16)

- [ ] Require `AUTH_SECRET` or a dedicated `REALTIME_TOPIC_SECRET` in production.
- [ ] Permit a development/test fallback only when `NODE_ENV !== 'production'`, with a clear warning.
- [ ] Keep broadcasts content-free and keep notification data behind the authenticated API.
- [ ] Test normalization, stable HMAC output, missing production secret, and dev fallback.

**Commit:** `fix(realtime): require topic secret in production`

## Task 16 — Remove dead Enrollment PATCH activity construction (OCR-17)

- [ ] Prove `rpcActivityRows` is the only persisted activity input to `patch_enrollment_atomic`.
- [ ] Remove only the second unused `activityRows` construction; retain notification construction,
  warnings, broadcast, and canonical reload.
- [ ] Regression-test stage, reopen, QC, people, and generic field activity exactly once.

**Commit:** `refactor(enrollment): remove dead post-commit activity builder`

---

## 8. Rejected or down-scoped OCR findings

These are recorded explicitly. Do not implement them unless new evidence changes the conclusion.

| OCR claim | Codex verdict | Evidence |
|---|---|---|
| ESLint `defineConfig/globalIgnores` do not exist | **False** | Current installed ESLint exports them; project lint passes |
| `useId` is not imported in Account Manager | **False** | It is present in the React import |
| ACA and Medicare usage counts are mixed | **False** | Counts are keyed by globally unique option UUIDs; each program consumes only its own IDs |
| Google auth allows every domain when env is empty | **False** | The branch falls through to `return false` |
| Settings `return` skips `finally` and leaves saving true | **False JavaScript semantics** | `finally` runs even when returning inside `try` |
| Role APIs silently discard multiple roles | **False current contract** | API and UI intentionally require exactly one active role |
| Notification read empty ID accidentally reaches task filter | **False** | Empty/missing ID deliberately selects the mark-all branch |
| Task/Enrollment attachment upload has no size check | **False** | Both upload routes check `file.size` before buffering; workbook automation routes do not |
| Task QC crashes on null agent | **False** | `fetchAgentOwnerAndAssistantEmails(string|null)` explicitly returns `[]` for null |
| Comment/activity display-name code crashes on null email | **Not reachable under schema** | Author and actor columns are `NOT NULL` |
| Enrollment delete fails after broadcast outage | **False** | shared broadcast helper catches provider errors internally |
| Append `Z` to date-only formatting | **Incorrect fix** | UTC conversion can shift a date-only business value for local users |
| SLA row local state never follows props | **False in current tree** | row key includes canonical minutes and remounts when saved value changes |
| Enrollment set-state-during-render loops | **False** | documented React adjustment converges on the new prop identity |
| Task board fetch updates state after unmount | **False** | effect has an `alive` cleanup guard |
| `ensureTableColumns` can create duplicates | **Already guarded** | DB upsert uses conflict handling; restore update is idempotent |
| Task overview date predicate is backwards | **Intentional** | open work created before the range remains in current-workload overview |
| Concurrent overdue calls both update the row | **False PostgreSQL locking model** | row lock plus qualifier re-evaluation makes the second update affect zero rows |
| `assign_unassigned_task` must re-authorize actor inside RPC | **Down-scoped** | server route authorizes and final schema ACL makes the RPC service-role-only |
| Backfill constraint omits `stage_entered_source` | **False in complete rollout** | earlier schema constraints already enforce the entered-at/source pair |
| Re-entering To Do loses prior time | **False** | every exit banks the current stint; every entry creates a new start |
| Task option badge colors without `#` are common | **Not reachable through current writes** | Config validation and seeds store six-digit colors with `#` |
| Every missing route-level try/catch is a production bug | **Rejected generic warning** | framework returns 500; only committed-write ambiguity or intentional response contracts require local recovery |
| `deleteSupabaseRows` currently receives attacker-controlled table/filter/RPC names | **False** | callers use checked static configs; validation is still included as defense in Task 4 |
| `commentFailed` needs a setter | **False feature inference** | state path is dead, not evidence of missing production behavior |
| Empty `custom_values: {}` must clear every field | **Rejected without product contract** | current API is a partial merge used by per-cell edits; global clear is not a reachable UI action |

---

## 9. Final verification and release checklist

- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm run test:run`
- [ ] `npm run build`
- [ ] Fresh scratch apply of `supabase/schema.sql`
- [ ] Fresh scratch apply of standalone `datasync/schema.sql`
- [ ] Run every new SQL rollback/failure-injection test with `ON_ERROR_STOP=1`
- [ ] Confirm deployed-schema ACL: no `anon`/`authenticated` execution on any definer function
- [ ] Slow/failing-network browser pass: CS Task detail, ACA detail, Medicare detail, Config agents/options
- [ ] 1,000-comment fixture: bounded initial payload, older-page navigation, deep-link behavior
- [ ] Workbook boundary tests and hosting body limit verified in deployed preview
- [ ] Atomic replacement failure injection proves old datasets remain intact
- [ ] Search/list/detail/export/notification display keys match and are unique
- [ ] Business owner signs OCR-12 before any mart rebuild

**Release recommendation now:** `NOT READY` until OCR-01 is audited and OCR-02 through OCR-05 are
closed. After those pass, reassess OCR-06/OCR-09 as explicit P2 go-live decisions.

---

## 10. Execution log

Append one row immediately after each task is completed. Do not pre-fill commit IDs.

| Task | Status | What changed | Verification | Commit |
|---|---|---|---|---|
| 1 — datasync ACL | Completed | Added read-only audit, service-role-only grants, explicit search paths, and fail-closed assertion. Production/scratch ACL query was not run because no DB connection variables are available in this environment. | `git diff --check`; static schema review | Pending commit |
| 2 — backfill transaction | Completed | Moved constraint validation before COMMIT and added rollback-boundary SQL assertion. Full scratch replay remains pending because no DB URL is available. | `git diff --check`; static ordering check | Pending commit |
| 3 — health summary atomic replace | Not started | — | — | — |
| 4 — staged data sync | Not started | — | — | — |
| 5 — workbook limits | Not started | — | — | — |
| 6 — unique display keys | Not started | — | — | — |
| 7 — atomic Config agent delete | Not started | — | — | — |
| 8 — atomic option positioning | Not started | — | — | — |
| 9 — collaboration pagination | Not started | — | — | — |
| 10 — Enrollment option snapshot | Not started | — | — | — |
| 11 — attachment deletion feedback | Not started | — | — | — |
| 12 — data-quality semantics | Blocked on product decision | — | — | — |
| 13 — notification enrichment | Not started | — | — | — |
| 14 — participant errors | Not started | — | — | — |
| 15 — realtime topic secret | Not started | — | — | — |
| 16 — dead Enrollment activity | Not started | — | — | — |
