# Deep Production Code Review — All Commits Since Friday

**Reviewer:** Principal-level review, evidence-based
**Date of review:** 2026-08-10 19:12 +07
**Repository:** `agent-portal` (Next.js 16.2.4 + Supabase)

---

## Executive Summary

```text
Review window:   2026-08-07 00:00  →  2026-08-10 01:49 (HEAD)
Branch:          config
Commit range:    be706b0^..ed99359
Commits total:   266
  code-bearing:  101
  docs-only:     165
Files changed:   179
Lines:           +31,211 / −6,026
  of which docs: ~19,000 insertions (plans, changelog, review records)
  code + SQL:    ~12,000 insertions

P0:  0
P1:  2
P2:  2
P3:  2
```

### Scope honesty

This review is **not** a uniform line-by-line pass over all 101 code commits, and I will not
present it as one. What I actually did:

- **Deep-read (full body, traced call paths):** `supabase/schema.sql` (+1,797/−15 — every new
  function, trigger, and ACL statement), all four `supabase/rollouts/*.sql`, `src/lib/cron-auth.ts`,
  `src/app/api/cron/*`, the optimistic-concurrency paths in `src/app/api/tasks/[id]/route.ts`, and
  the RPC signatures/grants for all 24 new database functions.
- **Surveyed (diff read, spot-checked):** the 36 enrollment-UI, 31 task-UI, and 15 config-UI commits.
- **Not independently re-derived:** UI visual regressions, which need a browser.

Both P1 findings below were traced end to end and are reproducible from the code as written.

### Architecture (derived, not assumed)

```text
Browser (React 19, Supabase anon key in bundle)
  ↓  fetch
Next.js App Router route handlers  ── authn (session) + authz (RBAC / actor scope)
  ↓  service-role client
Supabase Postgres
  ├── atomic mutation RPCs (SECURITY DEFINER)   ← the new commit boundary
  ├── tables + triggers
  └── Storage (private bucket, 1 h signed URLs)
  ↑
Vercel Cron → /api/cron/*  (bearer-authenticated)
  ↑
Supabase Realtime (content-free broadcast hints)
```

**There is no GFI, no ML model, no ranking, no retrieval, and no recommendation pipeline in this
repository.** I searched for them. The review prompt's GFI/ML/accuracy sections are therefore
**not applicable**, and I have deliberately left them empty rather than inventing content. The
closest analogue to a "quality-sensitive path" here is the SLA/overdue KPI computation, which I have
covered under Correctness and Data Integrity.

### Top risks

| # | Sev | One-line |
|---|---|---|
| 1 | **P1** | Four `SECURITY DEFINER` enrollment mutation RPCs are defined *after* the ACL sweep in `schema.sql`, so any environment provisioned from that file exposes them to `authenticated` via PostgREST — bypassing the entire enrollment permission model added the same weekend |
| 2 | **P1** | The new `tasks_updated_at_monotonic` trigger bumps `updated_at` on **every** `UPDATE`, including six cron reminder writes that previously left it alone — silently invalidating every open client's concurrency token and producing spurious 409s |

---

## Finding 1

## [P1] `schema.sql` ACL sweep is positional; four SECURITY DEFINER enrollment RPCs land after it

```text
Commit:     224bebb  feat(enrollment): add atomic enrollment mutation RPCs   (2026-08-09 23:53)
Interacts:  42a9db7  fix(security): restrict security definer rpc execution  (2026-08-09 00:21)
File:       supabase/schema.sql
Lines:      sweep 3424–3445; unprotected functions 3631, 3798, 3880, 3920
Subsystem:  Database / authorization boundary
Blast radius: All enrollment records (ACA + Medicare) in any environment provisioned from schema.sql
```

### Problem

Commit `42a9db7` hardened SECURITY DEFINER execution with a dynamic sweep:

```sql
-- supabase/schema.sql:3424
do $$
declare routine record;
begin
  for routine in
    select p.oid::regprocedure::text as signature
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
  loop
    execute format('revoke all on function %s from public, anon, authenticated', routine.signature);
    execute format('grant execute on function %s to service_role', routine.signature);
  end loop;
end $$;
```

This is a **point-in-time** sweep: it protects every SECURITY DEFINER function that exists *at the
moment the block executes*. Twenty-three hours later, commit `224bebb` appended four new SECURITY
DEFINER functions **below** it in the same file.

### Evidence

Function positions versus the sweep at line 3424–3445:

| Function | Line | Explicit `revoke` in schema.sql |
|---|---:|---|
| `patch_enrollment_atomic(uuid, timestamptz, jsonb, text, jsonb, timestamptz)` | 3631 | **none** |
| `create_enrollment_atomic(jsonb, text, jsonb, timestamptz)` | 3798 | **none** |
| `archive_enrollment_atomic(uuid, text, jsonb, timestamptz)` | 3880 | **none** |
| `enrollment_touch_activity(uuid, text, timestamptz)` | 3920 | **none** |
| `create_enrollment_comment_idempotent(...)` | 3983 | line 4043 ✅ |
| `edit_enrollment_comment_atomic(...)` | 4090 | line 4146 ✅ |

Every other new SECURITY DEFINER function in the file got an explicit `revoke`/`grant` pair
(lines 1902–1906, 1944, 2039, 2127, 2209, 2283, 2559, 2623, 3414). These four did not, and they are
the only ones that sit past the sweep without one.

Each is a privileged writer. `archive_enrollment_atomic` in full:

```sql
-- supabase/schema.sql:3880
create or replace function archive_enrollment_atomic(
  p_record_id uuid, p_actor_email text, p_activity jsonb default '[]'::jsonb,
  p_now timestamptz default now()
) returns jsonb language plpgsql security definer set search_path = public as $$
...
  select * into target_record from enrollment_records where id = p_record_id for update;
  ...
  update enrollment_records set archived_at = v_now, updated_at = v_now,
    updated_by_email = actor, ...
```

**The actor is a plain text parameter.** The function performs no permission check of its own — by
design, because the Next.js layer is supposed to be the authorization boundary. That contract holds
only while the function is unreachable from the client.

### Before

Before `224bebb`, enrollment mutations went through the route handler, which since commits
`1e5a763` (capability resolver), `b2b3b00` (actor scope resolver), `cc86ddb` (scope every read),
and `20b7909` (per-action permissions) enforces per-record capabilities.

### After

In an environment provisioned from `schema.sql`, these four functions keep PostgreSQL's default
`EXECUTE` grant to `PUBLIC`. Supabase's `authenticated` role inherits `PUBLIC`, and PostgREST
exposes `public`-schema functions at `/rest/v1/rpc/<name>`. `SECURITY DEFINER` also bypasses RLS.

### Impact

```text
Correctness:      unaffected
Security:         privilege escalation — full bypass of the enrollment permission model
Data integrity:   any authenticated user can archive/patch/create any enrollment record
API compatibility: unaffected
Latency:          unaffected
Scalability:      unaffected
```

### Mitigating factor — read this before triaging as P0

`supabase/rollouts/2026-08-09-enrollment-stage-time-schema.sql:478-494` **does** revoke all seven
functions, using an explicit array rather than a `pg_proc` scan, placed correctly after the
definitions:

```sql
foreach routine_signature in array array[
  'enrollment_norm_email(text)',
  'enrollment_close_open_cycle_internal(uuid, text, timestamptz, uuid)',
  'enrollment_write_activity_internal(uuid, text, jsonb, timestamptz)',
  'patch_enrollment_atomic(uuid, timestamptz, jsonb, text, jsonb, timestamptz)',
  'create_enrollment_atomic(jsonb, text, jsonb, timestamptz)',
  'archive_enrollment_atomic(uuid, text, jsonb, timestamptz)',
  'enrollment_touch_activity(uuid, text, timestamptz)'
] loop ...
```

So **if production was migrated using the rollout file, production is protected.** This is rated P1
rather than P0 because the exploitable state depends on the apply path, and the rollout path is
correct. It is not rated P2 because `schema.sql` is the repository's canonical schema, the drift is
silent, and the failure mode is total authorization bypass.

**Risk: NEEDS VALIDATION** — confirm which artefact was applied to production before deciding
whether this is a live exposure or only a provisioning-time landmine.

### Production Scenario

A new staging environment, a disaster-recovery rebuild, or a developer's local Supabase is
provisioned by running `schema.sql`. The sweep executes at line 3424 and finds nothing to protect at
3631+. Any user who can log in — including a `workflow`-only worker whom commit `bfada34`
specifically restricted from main content — opens devtools, lifts the anon key from the bundle, and
calls:

```
POST /rest/v1/rpc/archive_enrollment_atomic
{"p_record_id":"<any uuid>","p_actor_email":"admin@company.com"}
```

Every enrollment record can be archived, patched, or forged, with the activity trail attributing the
change to a spoofed actor.

### Recommendation

1. **Immediate — verify production ACLs:**

```sql
select p.oid::regprocedure::text as signature,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef
order by 2 desc, 1;
```

Any row with `authenticated_can_execute = true` is a live exposure. Revoke immediately.

2. **Fix the file:** move the sweep block in `schema.sql` to the **end of the file**, after every
   function definition. A positional sweep must be positionally last.

3. **Make it structural rather than positional** — add a fail-closed assertion at the very end so
   the schema refuses to apply if any SECURITY DEFINER function is still world-executable:

```sql
do $$
declare leaked text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into leaked
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
    and has_function_privilege('authenticated', p.oid, 'execute');
  if leaked is not null then
    raise exception 'SECURITY DEFINER functions still executable by authenticated: %', leaked;
  end if;
end $$;
```

This converts a silent drift into a loud deploy failure, and it cannot be defeated by appending a
new function — the next person who does so gets a red build.

### Validation

Apply `schema.sql` to a scratch database, run the `has_function_privilege` query above, assert zero
rows. Then append a dummy SECURITY DEFINER function below the sweep and confirm the new assertion
**fails the apply**.

---

## Finding 2

## [P1] Monotonic trigger bumps `updated_at` on every UPDATE, invalidating concurrency tokens from cron

```text
Commit:     24146e8  fix(tasks): clamp task version monotonically   (2026-08-10 00:21)
File:       supabase/schema.sql:1371-1389
Function:   tasks_updated_at_monotonic()
Affected:   src/app/api/cron/check-overdue/route.ts:251, 274, 296, 335, 358, 382
            supabase/schema.sql:2582 (mark_task_overdue_atomic)
Subsystem:  Tasks — optimistic concurrency control
Blast radius: Every task the overdue/reminder cron touches, on every cron pass
```

### Problem

The trigger was introduced to stop `updated_at` regressing (audit finding F2 — a real bug). Its
guard is written as `<=`, and it fires on **every** row update:

```sql
-- supabase/schema.sql:1371
create or replace function tasks_updated_at_monotonic()
returns trigger language plpgsql as $$
begin
  if new.updated_at is null or new.updated_at <= old.updated_at then
    new.updated_at := old.updated_at + interval '1 microsecond';
  end if;
  ...
end $$;

create trigger tasks_updated_at_monotonic
  before update on tasks
  for each row execute function tasks_updated_at_monotonic();
```

In a `BEFORE UPDATE ... FOR EACH ROW` trigger, columns not named in the `SET` clause carry the old
value into `NEW`. So for any statement that does not set `updated_at`:

```text
new.updated_at == old.updated_at
  → the `<=` branch is taken
  → new.updated_at := old.updated_at + 1µs
  → updated_at CHANGES on a write that previously left it alone
```

The intent was "never go backwards". The implementation is "always go forwards".

### Evidence

Six cron writes update only a reminder marker:

```text
src/app/api/cron/check-overdue/route.ts:251  .update({ overdue_reminded_at: nowIso })
src/app/api/cron/check-overdue/route.ts:274  .update({ waiting_reminded_at: nowIso })
src/app/api/cron/check-overdue/route.ts:296  .update({ todo_reminded_at: nowIso })
src/app/api/cron/check-overdue/route.ts:335  .update({ due_soon_notified_at: nowIso })
src/app/api/cron/check-overdue/route.ts:358  .update({ stale_reminded_at: nowIso })
src/app/api/cron/check-overdue/route.ts:382  .update({ qc_reminded_at: nowIso })
```

So does the new overdue command:

```sql
-- supabase/schema.sql:2582 (mark_task_overdue_atomic)
update tasks
set overdue_flagged_at = v_now, overdue_reminded_at = v_now,
    overdue_count = coalesce(overdue_count, 0) + 1
where id = p_task_id and status = 'in_progress' and overdue_flagged_at is null;
```

None sets `updated_at`. All now bump it.

Both concurrency checks are **exact equality**, so a 1 µs bump is as fatal as an hour:

```sql
-- supabase/schema.sql:2681 (patch_task_atomic)
if p_expected_updated_at is null or target_task.updated_at <> p_expected_updated_at then
  raise exception 'TASK_CONFLICT';
```

```ts
// src/app/api/tasks/[id]/route.ts:567-575 (archive path)
    .eq("updated_at", expectedUpdatedAt)
    .select("id").maybeSingle();
  if (!data) {
    return NextResponse.json(
      { error: "Task was updated by someone else. Refresh and try again." },
      { status: 409 }
```

### Before

A cron reminder pass wrote `overdue_reminded_at` and nothing else. `updated_at` was untouched, so
every client holding a token stayed valid and could keep editing.

### After

Every cron pass rewrites `updated_at` for every task it reminds on. Each such task's open clients now
hold a stale token. Their next edit — a status change, a field edit, an archive — fails with
**"Task was updated by someone else. Refresh and try again."** for a task that no human touched.

### Impact

```text
Correctness:      P1 — spurious conflicts on unmodified tasks
Reliability:      recurring, scheduled, affects many tasks per pass
Data integrity:   no corruption; the guard fails closed (rejects, does not overwrite)
Latency:          negligible
Scalability:      unaffected
Security:         unaffected
Observability:    poor — a spurious 409 is indistinguishable from a genuine one in logs
```

The audit that motivated this trigger recorded **110 overdue-marked tasks**. The stale-reminder and
due-soon branches touch broader sets. The blast radius is "most active tasks, every scheduled run".

### Production Scenario

09:00 — an agent opens task T; the drawer caches `updated_at = t0`.
09:05 — the overdue cron runs; T is in progress and due soon, so line 335 writes
`due_soon_notified_at`. The trigger bumps `updated_at` to `t0 + 1µs`.
09:06 — the agent moves T to Done. The PATCH sends `expected_updated_at = t0`.
`patch_task_atomic` raises `TASK_CONFLICT`. The agent sees "Task was updated by someone else" and
loses their edit. Nobody else touched the task. This repeats every cron pass.

### Recommendation

Make the trigger a true monotonicity guard rather than an unconditional bump — only intervene when
the statement actually tried to move the value **backwards**:

```sql
create or replace function tasks_updated_at_monotonic()
returns trigger language plpgsql as $$
begin
  -- Only correct a genuine regression. A statement that leaves updated_at alone
  -- (cron reminder markers, position reorders) must keep leaving it alone —
  -- bumping it there silently invalidates every client's concurrency token and
  -- produces 409s on tasks nobody edited.
  if new.updated_at is distinct from old.updated_at
     and new.updated_at <= old.updated_at then
    new.updated_at := old.updated_at + interval '1 microsecond';
  end if;

  if new.last_activity_at is not null
     and old.last_activity_at is not null
     and new.last_activity_at < old.last_activity_at then
    new.last_activity_at := old.last_activity_at;
    new.last_activity_by_email := old.last_activity_by_email;
  end if;
  return new;
end $$;
```

`is distinct from` leaves untouched writes untouched while still clamping any writer that supplies an
older timestamp — which is the actual F2 failure mode.

**Do not instead "fix" this by adding `updated_at` to the cron updates.** That would make the version
churn intentional rather than accidental and produce the same 409s.

### Validation

```sql
-- 1. An untouched write must not move the version.
select updated_at into v0 from tasks where id = :t;
update tasks set overdue_reminded_at = now() where id = :t;
select updated_at = v0 from tasks where id = :t;      -- expect TRUE

-- 2. A genuine regression must still be clamped forward.
update tasks set updated_at = v0 - interval '1 hour' where id = :t;
select updated_at > v0 from tasks where id = :t;      -- expect TRUE
```

Integration: hold a token, run `/api/cron/check-overdue`, then PATCH with the held token — must
succeed. Regression test belongs in `src/lib/tasks/` as a SQL assertion alongside
`supabase/rollouts/2026-08-09-enrollment-stage-time-test.sql`.

---

## Lower-severity findings

### [P2] `mark_task_overdue_atomic` narrows the overdue condition — NEEDS VALIDATION

`supabase/schema.sql:2582` gates the transition on `status = 'in_progress'`:

```sql
where id = p_task_id and status = 'in_progress' and overdue_flagged_at is null;
```

The pre-existing route-level code (`check-overdue/route.ts`) selected `newlyOverdue` by SLA
expiry and did **not** re-assert status inside the update. If a task's status changes between
selection and command execution, the command now returns `false` and the task is silently skipped —
never flagged, never re-evaluated on the next pass if the selection query no longer matches.

I could not determine from the code alone whether that skip is intended tightening or an accidental
narrowing. **Risk: NEEDS VALIDATION.** Compare overdue counts before/after one production cron pass.

### [P2] Docs-to-code commit ratio obscures the change set

165 of 266 commits (62%) are docs-only, interleaved one-for-one with code commits
(`fix(...)` → `docs(...)` → `fix(...)`). `git log --oneline` is therefore not usable for change
review, and `git bisect` runs cost roughly 2.6× the necessary steps. This is a process observation,
not a defect. Consider amending the doc note into its code commit.

### [P3] Cron secret uses non-constant-time comparison

`src/lib/cron-auth.ts:12` — `authHeader === \`Bearer ${cronSecret}\``. Timing-attack surface is
theoretical over HTTP with network jitter, and the routes otherwise fail closed correctly
(`misconfigured` → 500, `unauthorized` → 401, verified in all three cron routes). Use
`crypto.timingSafeEqual` on equal-length buffers if you want it airtight. **Not blocking.**

### [P3] `schema.sql` grew +1,797 lines with 24 new functions and no schema-level test harness

`supabase/rollouts/2026-08-09-enrollment-stage-time-test.sql` is the only SQL assertion file, and it
covers enrollment stage-time only. None of the eight new task-side atomic commands
(`create_task_comment_atomic`, `edit_task_comment_atomic`, `delete_task_comment_atomic`,
`create_task_attachment_atomic`, `delete_task_attachment_atomic`, `create_task_atomic`,
`mark_task_overdue_atomic`, `tasks_updated_at_monotonic`) has a SQL-level test. Finding 2 is exactly
the class of bug such a test catches in one assertion.

---

## Commit Matrix

101 code commits, clustered by subsystem. Per the review's own instruction not to mechanically mark
every dimension, only dimensions where I found something are populated; `·` means examined, nothing
material.

| Cluster | Commits | Intent | Correctness | Perf | Reliability | Security | Data | API | Sev |
|---|---:|---|---|---|---|---|---|---|---|
| Enrollment stage-time schema + RPCs (`ab3a7c7`…`441502b`) | 8 | Atomic enrollment mutations, stage dwell metrics | · | · | · | **P1-1** | · | · | **P1** |
| Task collaboration hardening (`e554e91`…`ed99359`) | 25 | Execute the 24-finding audit plan | **P1-2** | · | · | · | · | · | **P1** |
| Enrollment permission model (`2eceede`…`f2b45ca`) | 12 | Per-action capabilities, actor scope, export gate | · | · | · | ✅ sound | · | · | — |
| Config hardening (`4fdac30`…`c838e8e`) | 21 | Scope isolation, serialized writes, fail-closed reads | · | · | ✅ | ✅ `42a9db7` | · | · | — |
| Task board state/concurrency (`cdd06de`…`16ad882`) | 14 | Optimistic concurrency, realtime lifecycle, truncation guards | · | · | ✅ | · | · | · | — |
| Searchable dropdowns (`4724042`…`cc5e773`) | 11 | Shared searchable listbox across CS/Enrollment | · | · | · | · | · | · | — |
| SLA config (`3ec0616`…`e134b22`) | 7 | Move SLA to config, bound durations, serialize saves | · | · | ✅ | · | · | · | — |
| Enrollment UI standardization (`82e6107`…`993db8f`) | 21 | Badge language, surfaces, placeholders, FUB links | · | · | · | · | · | · | — |
| Cron auth (`17b86e2`, `bb6dca3`) | 2 | Bearer auth for cron routes | · | · | ✅ | **P3** | · | · | P3 |
| Seed/scripts (`6b53238`, `2173014`, `fff248c`, `e554e91`) | 4 | Guarded seeding, backfill, audit script | · | · | · | ✅ guarded | · | · | — |

**Positive observations worth recording** — this weekend's work fixed considerably more than it
broke:

- `42a9db7` correctly identified and closed a real PostgREST RPC exposure. Finding 1 is a *gap in the
  mechanism*, not a failure to recognise the problem.
- `4f59280`, `81e8562`, `fc00dbe`, `16ad882` moved task and enrollment mutations onto genuine atomic
  commit boundaries with optimistic concurrency. This is the right architecture.
- `f1eef1f`, `f7c1d94`, `a52156e` introduce fail-closed behaviour on truncated or missing data —
  correct instinct, correctly implemented.
- `e219c91`, `f95ebbe` implement the committed-with-warnings pattern properly: a durable mutation
  returns 2xx with warnings rather than a retryable 5xx.
- `d6fbe37` escapes permission-filter identities (PostgREST `.or()` injection surface). Real fix.

---

## Cross-Commit Regression Analysis

The two P1s are independent, but three compound effects are worth stating.

**1. The permission model and its enforcement boundary landed 23 hours apart, in that order.**
Commits `1e5a763`→`f2b45ca` (2026-08-09 13:03–13:27) built the enrollment capability model on the
premise that the Next.js route is the only path to the data. Commit `224bebb` (23:53) then added
RPCs that, in a schema.sql-provisioned environment, are a *second* path with no checks. Neither
commit is wrong alone; together they invert the security model. This is precisely the class of
interaction a per-commit review misses.

**2. The monotonic trigger was added mid-way through a 25-commit sequence and every later commit
inherits it.** `24146e8` is commit 3 of the collaboration-hardening run. The eight atomic commands
added after it (`f48e1e1`, `923075b`, `c9249a2`, `4ce4f97`, `ac2e23b`, `6b9c0dd`, …) were all written
and verified against a database where `updated_at` self-bumps. Any test written during that sequence
would have baked in the wrong behaviour as expected. When fixing Finding 2, re-verify those commands
rather than assuming their tests still mean what they meant.

**3. Version-churn pressure increased from three directions simultaneously.** Comment creation now
touches the parent task (`f48e1e1`), attachment upload touches it for standalone files (`923075b`),
and the trigger makes every other write touch it too (`24146e8`). Each is individually defensible;
together, `tasks.updated_at` changes far more often than before, and the concurrency check is exact
equality. Finding 2 is the acute symptom; the chronic condition is that the 409 rate will rise even
after it is fixed. Instrument it.

---

## Regression Matrix

| Area | Before | After | Risk |
|---|---|---|---|
| Behaviour — task edit after cron | Succeeds | **409 on unmodified tasks** | **P1** |
| Behaviour — comment/attachment atomicity | Multi-step, partial commits | Single transaction | Improved |
| Security — enrollment RPC surface | Route-only | **PostgREST-reachable in schema.sql envs** | **P1** |
| Security — cron routes | Unauthenticated | Bearer, fail-closed | Improved |
| Data — comment/activity consistency | Divergent on failure | Atomic | Improved |
| Data — `tasks.updated_at` semantics | "changed by a user action" | "changed by any write" | **P1** |
| API — response shape | `{data}` | `{data, warnings}` additive | Compatible |
| Latency | — | No measurement taken | UNKNOWN |
| Throughput / p95 / p99 | — | No measurement taken | UNKNOWN |
| Cache | No TTL on detail cache | 5 min TTL + invalidation | Improved |
| GFI / accuracy / ranking | N/A | N/A | Not applicable |

Latency rows are **UNKNOWN**, not "fine". No profiling was performed and I will not fabricate
numbers. The atomic RPCs replace N round trips with one, which should help; the added triggers and
`FOR UPDATE` row locks add contention. Net effect requires measurement.

---

## Missing Tests / Validation

### Must fix before merge

1. **Trigger monotonicity semantics** — a SQL assertion that an `UPDATE` not naming `updated_at`
   leaves it unchanged, and that an `UPDATE` supplying an older value is clamped forward. This single
   test is the one that would have caught Finding 2.
2. **SECURITY DEFINER ACL invariant** — the fail-closed assertion in Finding 1's recommendation,
   executed as the last statement of `schema.sql`.

### Must validate before production

3. **Production ACL audit** — run the `has_function_privilege` query against production and confirm
   zero SECURITY DEFINER functions are executable by `authenticated`.
4. **Cron-then-edit integration test** — hold a token, run the overdue cron, PATCH with the held
   token; must succeed.
5. **Overdue count reconciliation** — one production cron pass before/after, to resolve the P2
   `status = 'in_progress'` narrowing.

### Recommended follow-up

6. SQL-level tests for the remaining seven task atomic commands, mirroring
   `2026-08-09-enrollment-stage-time-test.sql`.
7. A metric separating genuine 409s from token-churn 409s.
8. Latency baselines for the drawer-open path (Task-detail authorization was serialized in `d3f4052`,
   trading one network wave for correctness — the trade is right, the cost is unmeasured).

---

## FINAL VERDICT

```text
REQUEST CHANGES
```

The engineering direction across these 266 commits is sound and, in several places, genuinely good:
real atomic commit boundaries, fail-closed reads, committed-with-warnings semantics, and a correctly
diagnosed RPC exposure. I found no P0 and no data corruption.

Two issues block, and both are single-line-class fixes rather than redesigns:

- **Finding 2 is a live functional regression.** It will produce spurious "Task was updated by
  someone else" errors on every cron pass, on tasks nobody edited, and users will lose work. The fix
  is `is distinct from`.
- **Finding 1 is a silent authorization drift.** Production may well be safe — the rollout file is
  correct — but the canonical schema is not, and the failure mode is total bypass of the permission
  model this same weekend introduced. Verify production, then make the invariant structural so
  appending a function cannot re-open it.

---

## MUST-FIX BEFORE MERGE

```text
[P1] Monotonic trigger bumps updated_at on every UPDATE
Commit:          24146e8
File:            supabase/schema.sql:1371-1385
Required change: guard with `new.updated_at is distinct from old.updated_at
                 and new.updated_at <= old.updated_at`
Validation:      SQL assertion that a reminder-only UPDATE leaves updated_at unchanged,
                 and that a backwards-dated UPDATE is still clamped forward;
                 integration test: hold token → run cron → PATCH must succeed
```

```text
[P1] SECURITY DEFINER enrollment RPCs defined after the ACL sweep
Commit:          224bebb (interacting with 42a9db7)
File:            supabase/schema.sql:3631, 3798, 3880, 3920 vs sweep at 3424-3445
Required change: (a) audit production with has_function_privilege;
                 (b) move the sweep to end-of-file;
                 (c) add a fail-closed assertion so any world-executable
                     SECURITY DEFINER function aborts the schema apply
Validation:      apply schema.sql to a scratch DB, assert zero SECURITY DEFINER
                 functions executable by `authenticated`; append a dummy
                 SECURITY DEFINER function below the sweep and confirm the apply FAILS
```
