# Consolidated Production Remediation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.
>
> **This document is self-contained.** It carries the findings, the evidence, and the fixes. You do
> not need to open either source review to execute it.

**Goal:** Clear every deployment blocker and correctness regression introduced by commits
`be706b0^..ed99359` (2026-08-07 → 2026-08-10), so the branch can ship.

**Architecture:** Four blockers share one shape — a guard or a migration step that is correct in
intent but wrong in reach or ordering. Fix each, then add an assertion that fails loudly if the same
class is reintroduced. The assertions are the durable deliverable; the fixes are mostly one-line.
Everything after Phase 1 is parity work: the weekend hardened Tasks and left Enrollment behind on the
same shared client.

**Tech Stack:** PostgreSQL 16 (Supabase), plpgsql, TypeScript, Next.js 16.2.4 App Router,
Vitest (node environment).

---

## 1. Provenance and verification status

This plan merges two independent reviews of the same commit range:

| Source | Verdict | Findings |
|---|---|---|
| `docs/2026-08-10-production-code-review-since-friday.md` (Claude) | REQUEST CHANGES | 2 P1, 2 P2, 2 P3 |
| `docs/2026-08-10-friday-commit-production-review.md` (Codex) | BLOCK | 1 P0, 2 P1, 10 P2, 3 P3 |

The two reviews overlap on exactly one finding (the ACL sweep) and are otherwise complementary.
**Codex found two deployment blockers Claude missed entirely; Claude found one live correctness
regression Codex missed entirely.** Neither review alone is sufficient.

Every finding carried into this plan was **re-verified against the working tree at `HEAD ed99359`
while writing it.** Verification status is recorded per finding — nothing is inherited on trust.

| ID | Sev | Finding | Source | Verified how |
|---|---|---|---|---|
| **B1** | **P1** | `schema.sql` cannot apply to a fresh database — `agent_email` is UPDATEd at line 3366 but only ADDed at line 3455 | Codex | **CONFIRMED** — read `create table if not exists enrollment_records` (3307-3341): the column list has `caller_email` and `responsible_enroll_email` but no `agent_email`. Codex additionally reproduced SQLSTATE 42703 on PG 16.8 |
| **B2** | **P0** | Four SECURITY DEFINER enrollment RPCs are created after the global ACL sweep and keep `PUBLIC EXECUTE` | Both | **CONFIRMED** — sweep at 3424-3445; functions at 3631, 3798, 3880, 3920; no explicit `revoke` for any of the four, while all eleven other new SECURITY DEFINER functions have one |
| **B3** | **P1** | Stage backfill emits a positive-duration `entry_marker`, violating its own CHECK constraint; the whole backfill aborts | Codex | **CONFIRMED** — constraint at `schema.sql:3525` requires `duration_seconds = 0` for `entry_marker`; backfill at `2026-08-09-enrollment-stage-time-backfill.sql:158-166` emits `kind='entry_marker'` with a computed positive duration |
| **B4** | **P1** | `tasks_updated_at_monotonic` bumps `updated_at` on **every** UPDATE, invalidating concurrency tokens on six cron writes | Claude | **CONFIRMED** — trigger at `schema.sql:1371-1385` uses a bare `<=`; six reminder writes at `check-overdue/route.ts:251,274,296,335,358,382` plus `mark_task_overdue_atomic:2582` never set `updated_at` |
| C1 | P2 | `GET /api/tasks/[id]/attachments` returns soft-deleted rows and signs with `Promise.all` | Codex | **CONFIRMED** — route lines 96-121: `.eq("task_id", id).is("comment_id", null)` with no `deleted_at` filter, then `Promise.all(... signTaskFile ...)` |
| C2 | P2 | Clearing an Enrollment person logs the **old** person in the audit | Codex | **CONFIRMED** — `enrollment/[id]/route.ts:395`: `patch.caller_email ?? current.caller_email`; `??` treats an intentional `null` as absent |
| C3 | P2 | Enrollment attachment upload ignores the `client_request_id` the shared client sends | Codex | **CONFIRMED** — zero occurrences of `client_request_id` in `enrollment/[id]/attachments/route.ts` |
| C4 | P2 | Task upload limits are TOCTOU; Enrollment enforces none server-side | Codex | **CONFIRMED** — `checkOperationLimits` at task route line 191, upload at 205, locking RPC at 234; no limit call anywhere in the enrollment comment route |
| C5 | P2 | Enrollment comment/attachment mutations are not atomic and have no CAS | Codex | Consistent with the code structure; **NEEDS VALIDATION** per path |
| C6 | P2 | Enrollment creation is non-idempotent; Task replay can lose must-run side effects | Codex | Consistent; **NEEDS VALIDATION** |
| C7 | P2 | Lists/overview fail or undercount at the PostgREST row cap | Codex | Consistent; **NEEDS VALIDATION** — needs seeded data above the cap |
| C8 | P2 | Task search can fan one query into ~180 DB calls | Codex | Structure confirmed; cost **UNKNOWN** — no measurement exists |
| C9 | P2 | Non-overdue cron reminder classes remain unpaged and non-atomic | Codex | Consistent; **NEEDS VALIDATION** |
| C10 | P2 | No safe old-app rollback after the stage-tracking schema lands | Codex | Operational; accept or gate |
| D1 | P3 | Enrollment scope equality relies on a non-enforced lowercase invariant | Codex | Consistent |
| D2 | P3 | Task detail cache expires lazily with no size bound | Codex | **CONFIRMED** — `detail-cache.ts` checks TTL only on read of the same id |
| D3 | P3 | Dead second activity-construction path in Enrollment PATCH | Codex | **CONFIRMED** — `rpcActivityRows` is the persisted input; a second array is built post-commit and never inserted |
| D4 | P3 | Cron secret uses non-constant-time comparison | Claude | **CONFIRMED** — `cron-auth.ts:12` uses `===` |
| D5 | P3 | No SQL tests for the eight task atomic commands | Claude | **CONFIRMED** — only `2026-08-09-enrollment-stage-time-test.sql` exists |

### Corrections to the source reviews

Recording these so nobody re-derives them.

**Claude's P1 framing of B2 was imprecise, and Codex's is better.** Claude wrote "an environment
provisioned from `schema.sql` gets four unprotected RPCs". That cannot happen — because of **B1**,
a *fresh* apply dies at line 3366 long before reaching them. The real exposure window is an
**existing** database where `enrollment_records` already has `agent_email`, so `create table if not
exists` is a no-op, the UPDATE succeeds, and the file runs through to the unprotected functions.
Fix B1 first and this window becomes the *only* window.

**Claude's P2 about `mark_task_overdue_atomic`'s `status = 'in_progress'` predicate is withdrawn.**
The selection query at `check-overdue/route.ts:63` already has `.eq("status", "in_progress")`, so
the predicate inside the command is a re-assertion within the transaction — a correct TOCTOU guard,
not accidental narrowing. **No action required.**

**Claude's P2 about the docs-to-code commit ratio** (165 of 266 commits are docs-only) is a process
observation with no code change. Not carried forward as a task.

---

## 2. Global Constraints

- **Phase 0 is read-only and gates everything.** Do not change any schema until the production ACL
  audit has run and its result is recorded.
- **B1 must land before B2 and B3 can be validated.** Until `schema.sql` applies cleanly, there is no
  way to test any schema-level assertion on a fresh database. Sequence is not negotiable.
- **Vitest collects `src/**/*.test.ts` only, in `environment: "node"`.** `.tsx` is not collected and
  there is no DOM harness. Client behaviour that must be tested lives in a pure `.ts` helper. Tests
  are explicit: `import { describe, expect, it } from "vitest";` (`globals: false`); import app code
  through the `@/` alias.
- **SQL assertions follow the convention in `supabase/rollouts/2026-08-09-enrollment-stage-time-test.sql`:**
  one file wrapped in `begin; do $$ ... $$; rollback;`, numbered `CASE<n>` failures raised as
  exceptions, run with `psql "$SCRATCH_DATABASE_URL" -v ON_ERROR_STOP=1 -f <file>`. Everything rolls
  back, fixtures included. **Never run these against production.**
- **Every logic change gets a `changelog.md` entry** (repo root: `agent-portal/changelog.md`) in the
  same commit.
- **Commit per task.** Stage only files owned by the current task — this worktree has unrelated dirty
  files. Do not `git push` unless explicitly asked.
- **Next.js 16.2.4 is not the Next.js in your training data.** Before editing anything under
  `src/app/`, read `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`.
  Route params are async: `{ params }: Ctx` with `const { id } = await params`.
- **Do not "fix" B4 by adding `updated_at` to the cron updates.** That converts an accidental version
  bump into an intentional one and produces identical 409s. The fix belongs in the trigger.
- **`CommentThread.tsx` is shared by Tasks and Enrollment (ACA + Medicare).** Enrollment's comment
  and attachment APIs are *separate* implementations. A client-side contract added for Tasks is not
  automatically honoured by Enrollment — that asymmetry is the root of C3, C4, C5, and C6.

---

## 3. File Structure

| Path | Change | Owner task |
|---|---|---|
| `supabase/rollouts/2026-08-10-security-definer-acl-audit.sql` | Create | 1 |
| `supabase/schema.sql:3307-3341` | Modify | 2 |
| `supabase/schema.sql:3424-3445` → end of file | Move | 3 |
| `supabase/schema.sql` (append) | Create | 3 |
| `supabase/rollouts/2026-08-09-enrollment-stage-time-backfill.sql:149-168` | Modify | 4 |
| `supabase/rollouts/2026-08-10-task-version-monotonic-fix.sql` | Create | 5 |
| `supabase/rollouts/2026-08-10-task-atomic-commands-test.sql` | Create | 5, 11 |
| `src/app/api/tasks/[id]/attachments/route.ts` | Modify | 6, 8 |
| `src/app/api/enrollment/[id]/route.ts` | Modify | 7 |
| `src/app/api/enrollment/[id]/attachments/route.ts` | Modify | 8 |
| `src/app/api/enrollment/[id]/comments/route.ts` | Modify | 8 |
| `src/lib/cron-auth.ts` + test | Modify | 10 |
| `src/lib/tasks/detail-cache.ts` + test | Modify | 10 |

---

# Phase 0 — Emergency verification

## Task 1: Audit production for SECURITY DEFINER exposure

**Read-only. Run before touching anything.** B2's severity depends entirely on which artefact
production received. The dedicated rollout
(`supabase/rollouts/2026-08-09-enrollment-stage-time-schema.sql:478-494`) revokes all seven enrollment
functions correctly; `schema.sql` does not. Which one ran is unknown from the repository.

**Files:**
- Create: `supabase/rollouts/2026-08-10-security-definer-acl-audit.sql`

**Interfaces:**
- Produces: one row per SECURITY DEFINER function with its effective grants. Task 3 reuses the same
  query as its post-fix validation.

- [ ] **Step 1: Write the audit query**

```sql
-- supabase/rollouts/2026-08-10-security-definer-acl-audit.sql
--
-- READ-ONLY. Safe against production.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f this-file.sql
--
-- Every SECURITY DEFINER routine here is a server-only RPC whose caller does
-- authorization in Next.js first. PostgreSQL grants EXECUTE to PUBLIC by
-- default, Supabase's `authenticated` inherits PUBLIC, and PostgREST exposes
-- public-schema functions at /rest/v1/rpc/<name>. Any row below with
-- authenticated_can_execute = true is reachable from the browser with the anon
-- key, bypassing that boundary -- and SECURITY DEFINER bypasses RLS too.

select
  p.oid::regprocedure::text                                  as signature,
  has_function_privilege('authenticated', p.oid, 'execute')  as authenticated_can_execute,
  has_function_privilege('anon', p.oid, 'execute')           as anon_can_execute,
  has_function_privilege('service_role', p.oid, 'execute')   as service_role_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef
order by authenticated_can_execute desc, anon_can_execute desc, signature;
```

- [ ] **Step 2: Run it against production**

Run: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/rollouts/2026-08-10-security-definer-acl-audit.sql`

Expected in a healthy database: every row `authenticated_can_execute = f`, `anon_can_execute = f`,
`service_role_can_execute = t`.

- [ ] **Step 3: Branch on the result**

**If any row is `t` for `authenticated` or `anon`** — live exposure. Revoke now, before continuing:

```sql
do $$
declare routine record;
begin
  for routine in
    select p.oid::regprocedure::text as signature
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and (has_function_privilege('authenticated', p.oid, 'execute')
        or has_function_privilege('anon', p.oid, 'execute'))
  loop
    execute format('revoke all on function %s from public, anon, authenticated', routine.signature);
    execute format('grant execute on function %s to service_role', routine.signature);
  end loop;
end $$;
```

Re-run Step 2 to confirm clean. Then treat the window since `224bebb` (2026-08-09 23:53) as a
possible incident: check `enrollment_activity` for `actor_email` values that match no plausible
session, and `enrollment_records.archived_at` for unexpected archives.

**If every row is already `f`** — production ran the rollout file and is safe. B2 is confined to
`schema.sql`. Proceed at normal priority.

- [ ] **Step 4: Record the outcome and commit**

Write the date, row count, and which branch applied into `changelog.md`.

```bash
git add supabase/rollouts/2026-08-10-security-definer-acl-audit.sql changelog.md
git commit -m "chore(security): add read-only security definer ACL audit"
```

---

# Phase 1 — Deployment blockers

## Task 2: Make `schema.sql` apply to a fresh database (B1, P1)

`create table if not exists enrollment_records` at `schema.sql:3307-3341` declares `caller_email`
and `responsible_enroll_email` but **not** `agent_email`. Line 3366 then runs:

```sql
update enrollment_records
set agent_email = nullif(lower(btrim(agent_email)), '')
where agent_email is distinct from nullif(lower(btrim(agent_email)), '');
```

The column is only added at line 3455. On a database where the table does not already exist, this
fails with SQLSTATE `42703 column "agent_email" does not exist`. Codex reproduced this twice on
PostgreSQL 16.8.

Because the file is not wrapped in one transaction, the failure leaves the database **partially
initialized** — every index, RPC, ACL statement, and stage-tracking object after line 3366 is
missing. Clean deploys, CI schema tests, disaster recovery, and new local setups are all blocked.

**Files:**
- Modify: `supabase/schema.sql:3307-3341`

**Interfaces:**
- Produces: a `schema.sql` that applies end to end on an empty database. **Tasks 3 and 11 cannot be
  validated until this lands.**

- [ ] **Step 1: Reproduce the failure**

Run: `psql "$SCRATCH_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/schema.sql`
Expected: **FAIL** with `ERROR: column "agent_email" does not exist` around line 3366.

Use a genuinely empty database. If it succeeds, the scratch database already has the table and you
are not testing the bootstrap path — drop and recreate it.

- [ ] **Step 2: Add the column to the table definition**

In the `create table if not exists enrollment_records (...)` block, add `agent_email` immediately
after `caller_email` so the ownership columns stay together:

```sql
  caller_email text,
  agent_email text,
  responsible_enroll_email text,
```

Leave the `alter table enrollment_records add column if not exists agent_email text;` at line 3455
exactly where it is. It is now redundant for fresh databases and still required for existing ones
that predate the column. Both must work.

- [ ] **Step 3: Verify a clean one-pass apply**

Run: `psql "$SCRATCH_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/schema.sql`
Expected: exits zero, no manual `ALTER` needed.

- [ ] **Step 4: Verify idempotency on a second apply**

Run the same command again against the same database.
Expected: exits zero. The whole file is written to be re-runnable; a second pass must not error.

- [ ] **Step 5: Assert the schema is actually complete**

```sql
-- Objects defined after the old failure point must now exist.
select
  to_regclass('public.enrollment_stage_cycles')            is not null as has_stage_cycles,
  to_regprocedure('public.patch_enrollment_atomic(uuid, timestamptz, jsonb, text, jsonb, timestamptz)')
                                                            is not null as has_patch_rpc,
  exists (select 1 from information_schema.columns
           where table_name = 'enrollment_records' and column_name = 'agent_email')
                                                            as has_agent_email;
```

Expected: all three `t`.

- [ ] **Step 6: Commit**

```bash
git add supabase/schema.sql changelog.md
git commit -m "fix(schema): declare enrollment agent_email before it is normalized"
```

---

## Task 3: Make the SECURITY DEFINER ACL invariant structural (B2, P0)

`42a9db7` added a `pg_proc` sweep that revokes PUBLIC execute from every SECURITY DEFINER function.
It sits at `schema.sql:3424-3445`. Twenty-three hours later `224bebb` appended four more SECURITY
DEFINER functions **below** it — `patch_enrollment_atomic` (3631), `create_enrollment_atomic` (3798),
`archive_enrollment_atomic` (3880), `enrollment_touch_activity` (3920) — none with an explicit
`revoke`. A positional sweep only protects what already exists when it runs.

All four take the actor as a plain `text` parameter and perform privileged writes; they contain no
authorization of their own, by design, because Next.js is meant to be the only caller.

**Files:**
- Modify: `supabase/schema.sql` — move 3424-3445 (with its comment at 3417-3423) to end of file
- Modify: `supabase/schema.sql` — append the fail-closed assertion

**Interfaces:**
- Consumes: Task 1's audit query; Task 2's applying schema.
- Produces: `schema.sql` refuses to apply if any SECURITY DEFINER function is world-executable.

- [ ] **Step 1: Move the sweep to the end of the file**

Cut the entire `do $$ ... end $$;` block at 3424-3445 together with its explanatory comment at
3417-3423, and paste both at the very end of `schema.sql`. Keep the comment — it is accurate.

Leave the individual `revoke`/`grant` pairs (lines 1902-1906, 1944, 2039, 2127, 2209, 2283, 2559,
2623, 3414, 4043, 4146) where they are. They are redundant once the sweep runs last, but they
document intent at each definition site and are the only protection if a function is ever extracted
into a separate migration.

- [ ] **Step 2: Append the fail-closed assertion**

Immediately after the relocated sweep, at the very end of the file:

```sql
-- Fail-closed ACL invariant. The sweep above is positional: it protects every
-- SECURITY DEFINER routine that exists when it runs, so a function appended
-- below it silently keeps PostgreSQL's default PUBLIC EXECUTE grant and becomes
-- reachable from the browser through PostgREST at /rest/v1/rpc/<name>, bypassing
-- the Next.js authorization boundary and RLS alike. That is exactly how
-- patch_enrollment_atomic, create_enrollment_atomic, archive_enrollment_atomic
-- and enrollment_touch_activity were left exposed. This turns the next
-- occurrence from a silent hole into a failed deploy.
do $$
declare leaked text;
begin
  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text)
    into leaked
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef
    and (has_function_privilege('authenticated', p.oid, 'execute')
      or has_function_privilege('anon', p.oid, 'execute'));

  if leaked is not null then
    raise exception
      'SECURITY DEFINER functions are still executable by anon/authenticated: %. '
      'Move the ACL sweep below every function definition.', leaked;
  end if;
end $$;
```

- [ ] **Step 3: Verify on a clean apply**

Run: `psql "$SCRATCH_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/schema.sql`
Expected: applies to completion with no exception. (Requires Task 2.)

Then: `psql "$SCRATCH_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/rollouts/2026-08-10-security-definer-acl-audit.sql`
Expected: every row `authenticated_can_execute = f`, `anon_can_execute = f`, `service_role = t`.

- [ ] **Step 4: Prove the assertion catches the regression**

An assertion nobody has watched fail is not known to work.

Append a throwaway function **after** the assertion:

```sql
create or replace function acl_canary_delete_me()
returns void language sql security definer set search_path = public as $$ select 1 $$;
```

Apply once → still succeeds (the canary is created after the check).
Apply a **second** time → **must FAIL** with
`SECURITY DEFINER functions are still executable by anon/authenticated: acl_canary_delete_me()`.

That two-pass behaviour is inherent to a positional check, and you should understand it before
relying on it: the assertion catches a stray function on the *next* apply, not the one that
introduced it. **It is a ratchet, not a gate.** Anyone adding a SECURITY DEFINER function must still
write its `revoke`/`grant` pair at the definition site; the assertion exists to make forgetting it
loud rather than silent.

Delete the canary and confirm a fresh apply is clean again.

- [ ] **Step 5: Commit**

```bash
git add supabase/schema.sql changelog.md
git commit -m "fix(security): enforce security definer ACL invariant at schema apply"
```

---

## Task 4: Fix the stage backfill's constraint violation (B3, P1)

`schema.sql:3525` constrains the cycle table:

```sql
  check (kind <> 'entry_marker' or (ended_at is not null and duration_seconds = 0))
```

An `entry_marker` is by definition a zero-duration marker recording that a record entered a stage.
The backfill at `2026-08-09-enrollment-stage-time-backfill.sql:158-166` picks that `kind` for
inactive records but then computes a **real elapsed duration** for it:

```sql
  case when c.inactive_at is not null then 'entry_marker' else 'dwell' end,
  c.started_at,
  case when c.inactive_at is not null then greatest(c.inactive_at, c.started_at) else null end,
  case when c.inactive_at is not null
       then greatest(0, round(extract(epoch from (greatest(c.inactive_at, c.started_at) - c.started_at)))::integer)
       else null end,
```

Any archived or closed record whose stage started before it went inactive produces a positive
duration on an `entry_marker` row and violates the check. Codex reproduced it with a fixture
(`created_at=2026-01-01`, `archived_at=2026-01-03`) producing `duration_seconds = 172800`.

The insert is one statement, so the transaction rolls back cleanly — no partial corruption. But the
**entire backfill aborts on the first such row**, and stage-tracking rollout cannot complete.

**Files:**
- Modify: `supabase/rollouts/2026-08-09-enrollment-stage-time-backfill.sql:149-168`
- Modify: `supabase/rollouts/2026-08-09-enrollment-stage-time-test.sql` (add fixtures)

- [ ] **Step 1: Add the failing fixtures to the SQL assertions**

Append inside the existing `do $$` block of
`supabase/rollouts/2026-08-09-enrollment-stage-time-test.sql`, before its closing `end $$;`:

```sql
  -- CASE15: an archived record with a measurable visit must backfill as a
  -- completed dwell, not a positive-duration entry_marker. The constraint
  -- allows entry_marker only at duration 0, so the old mapping aborted the
  -- whole backfill on the first archived record.
  declare
    archived_id uuid;
    cyc record;
  begin
    insert into enrollment_records (
      program, client_name, stage_id, created_by_email, created_at, archived_at
    ) values (
      'aca', 'archived fixture', stage_a, 'fixture@example.test',
      t0, t0 + interval '2 days'
    ) returning id into archived_id;

    insert into enrollment_stage_cycles (
      record_id, stage_id, kind, started_at, ended_at, duration_seconds, source
    ) values (
      archived_id, stage_a, 'dwell', t0, t0 + interval '2 days', 172800, 'backfill'
    );

    select * into cyc from enrollment_stage_cycles where record_id = archived_id;
    if cyc.kind <> 'dwell' then
      raise exception 'CASE15: archived visit stored as %, expected dwell', cyc.kind;
    end if;
    if cyc.duration_seconds <= 0 then
      raise exception 'CASE15: archived visit recorded zero duration';
    end if;
  end;

  -- CASE16: a record that went inactive at the same instant its stage started
  -- has no measurable visit, so a zero-duration entry_marker is correct.
  declare
    instant_id uuid;
  begin
    insert into enrollment_records (
      program, client_name, stage_id, created_by_email, created_at, archived_at
    ) values ('aca', 'instant fixture', stage_a, 'fixture@example.test', t0, t0)
    returning id into instant_id;

    insert into enrollment_stage_cycles (
      record_id, stage_id, kind, started_at, ended_at, duration_seconds, source
    ) values (instant_id, stage_a, 'entry_marker', t0, t0, 0, 'backfill');
  end;
```

- [ ] **Step 2: Run the assertions to confirm they pass against the constraint**

Run: `psql "$SCRATCH_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/rollouts/2026-08-09-enrollment-stage-time-test.sql`
Expected: PASS. These fixtures encode the *correct* mapping; they are the specification the backfill
must satisfy.

- [ ] **Step 3: Fix the backfill's kind/duration mapping**

Replace lines 158-166 of `2026-08-09-enrollment-stage-time-backfill.sql`. The rule: **a measurable
visit is a completed `dwell`; only a zero-length visit is an `entry_marker`.**

```sql
  -- kind must agree with duration: entry_marker means "entered, no measurable
  -- time", and the table constrains it to duration_seconds = 0. An inactive
  -- record whose stage started before it went inactive DID accumulate time, so
  -- it is a completed dwell. Mapping every inactive record to entry_marker
  -- emitted positive-duration markers and aborted the whole backfill.
  case
    when c.inactive_at is null then 'dwell'
    when greatest(c.inactive_at, c.started_at) > c.started_at then 'dwell'
    else 'entry_marker'
  end,
  c.started_at,
  case when c.inactive_at is not null then greatest(c.inactive_at, c.started_at) else null end,
  case when c.inactive_at is not null
       then greatest(0, round(extract(epoch from (greatest(c.inactive_at, c.started_at) - c.started_at)))::integer)
       else null end,
```

A still-active record keeps `kind='dwell'` with `ended_at`/`duration_seconds` null, exactly as
before. Only the inactive branch changes.

- [ ] **Step 4: Run the backfill twice against realistic fixtures**

Seed a scratch database with one record of each shape — active, terminal, closed, archived,
no-stage, first-history-event, mixed live/backfill, and same-timestamp transition — then:

Run: `psql "$SCRATCH_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/rollouts/2026-08-09-enrollment-stage-time-backfill.sql`
Expected: exits zero, every seeded record backfilled.

Run it a **second** time. Expected: exits zero and produces no duplicate cycles — the backfill must
be idempotent, because a first attempt that aborted will be retried.

- [ ] **Step 5: Commit**

```bash
git add supabase/rollouts/2026-08-09-enrollment-stage-time-backfill.sql \
  supabase/rollouts/2026-08-09-enrollment-stage-time-test.sql changelog.md
git commit -m "fix(enrollment): map inactive stage visits to completed dwells"
```

---

## Task 5: Correct the monotonic trigger's reach (B4, P1)

`24146e8` added `tasks_updated_at_monotonic` to stop `updated_at` regressing — a real bug. Its guard
is a bare `<=`, and in a `BEFORE UPDATE ... FOR EACH ROW` trigger, columns absent from the `SET`
clause carry the old value into `NEW`. So any statement that does not name `updated_at` satisfies
`new.updated_at <= old.updated_at` and gets bumped by 1 µs.

The intent was "never go backwards". The implementation is "always go forwards".

Six cron writes update only a reminder marker and never set `updated_at`
(`check-overdue/route.ts:251, 274, 296, 335, 358, 382`), as does `mark_task_overdue_atomic`
(`schema.sql:2582`). Both concurrency checks use exact equality —
`patch_task_atomic:2682` raises `TASK_CONFLICT` on `target_task.updated_at <> p_expected_updated_at`,
and the archive path uses `.eq("updated_at", expectedUpdatedAt)` — so a 1 µs bump is as fatal as an
hour.

**Files:**
- Modify: `supabase/schema.sql:1371-1385`
- Create: `supabase/rollouts/2026-08-10-task-version-monotonic-fix.sql`
- Create: `supabase/rollouts/2026-08-10-task-atomic-commands-test.sql`

**Interfaces:**
- Produces: corrected `tasks_updated_at_monotonic()`. Task 11 extends the same test file.

- [ ] **Step 1: Write the failing SQL assertions**

```sql
-- supabase/rollouts/2026-08-10-task-atomic-commands-test.sql
--
-- Scratch-only assertions for the task version trigger and atomic commands.
--   psql "$SCRATCH_DATABASE_URL" -v ON_ERROR_STOP=1 -f this-file.sql
-- Everything is rolled back, fixtures included.

begin;

do $$
declare
  -- Deliberately NOT named `task_id`: that is also a column on task_activity
  -- and task_comments, and plpgsql raises "column reference is ambiguous" the
  -- moment such a variable appears in a WHERE clause against those tables.
  fixture_task_id uuid;
  v0 timestamptz;
  v1 timestamptz;
begin
  insert into tasks (title, status, reporter_email)
  values ('trigger fixture', 'todo', 'fixture@example.test')
  returning id, updated_at into fixture_task_id, v0;

  -- CASE1: a write that does not name updated_at must leave it alone. This is
  -- the regression: cron reminder writes were version-neutral, and the bare
  -- `<=` made every one of them invalidate the client's concurrency token.
  update tasks set overdue_reminded_at = now() where id = fixture_task_id;
  select updated_at into v1 from tasks where id = fixture_task_id;
  if v1 <> v0 then
    raise exception 'CASE1: reminder-only update moved updated_at from % to %', v0, v1;
  end if;

  -- CASE2: a write supplying an OLDER timestamp must still be clamped forward.
  -- This is the original bug the trigger exists to prevent.
  update tasks set updated_at = v0 - interval '1 hour' where id = fixture_task_id;
  select updated_at into v1 from tasks where id = fixture_task_id;
  if v1 <= v0 then
    raise exception 'CASE2: backwards updated_at was accepted (% <= %)', v1, v0;
  end if;

  -- CASE3: an identical timestamp must still advance, so two writers in the
  -- same microsecond cannot share one version.
  v0 := v1;
  update tasks set updated_at = v0 where id = fixture_task_id;
  select updated_at into v1 from tasks where id = fixture_task_id;
  if v1 <= v0 then
    raise exception 'CASE3: identical updated_at was not advanced (% <= %)', v1, v0;
  end if;

  -- CASE4: a genuine forward write is preserved exactly, not re-clamped.
  v0 := v1 + interval '5 minutes';
  update tasks set updated_at = v0 where id = fixture_task_id;
  select updated_at into v1 from tasks where id = fixture_task_id;
  if v1 <> v0 then
    raise exception 'CASE4: forward updated_at was rewritten from % to %', v0, v1;
  end if;

  -- CASE5: last_activity_at must never regress, and its actor travels with it.
  update tasks set last_activity_at = now(), last_activity_by_email = 'first@example.test'
   where id = fixture_task_id;
  update tasks set last_activity_at = now() - interval '1 hour',
                   last_activity_by_email = 'second@example.test'
   where id = fixture_task_id;
  if (select last_activity_by_email from tasks where id = fixture_task_id)
     <> 'first@example.test' then
    raise exception 'CASE5: regressing last_activity_at did not restore its actor';
  end if;
end $$;

rollback;
```

- [ ] **Step 2: Run to verify CASE1 fails**

Run: `psql "$SCRATCH_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/rollouts/2026-08-10-task-atomic-commands-test.sql`
Expected: **FAIL** with `CASE1: reminder-only update moved updated_at from ... to ...`

CASE2–CASE5 should already pass. If CASE1 passes, the trigger is not installed on this database —
apply `schema.sql` first or you are testing nothing.

- [ ] **Step 3: Correct the trigger in `schema.sql:1371-1385`**

```sql
create or replace function tasks_updated_at_monotonic()
returns trigger language plpgsql as $$
begin
  -- Correct a genuine regression only. `is distinct from` is load-bearing: in a
  -- BEFORE UPDATE row trigger a column absent from the SET clause carries the
  -- OLD value into NEW, so a bare `<=` matched every write that left updated_at
  -- alone -- the six cron reminder writes and mark_task_overdue_atomic -- and
  -- bumped it by 1us. Both concurrency checks compare updated_at by exact
  -- equality, so that silently invalidated every open client's token and
  -- produced 409s on tasks nobody had edited.
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

A write that *supplies* `updated_at` equal to the old value is still advanced (CASE3) — two writers
in the same microsecond must not share a version. Only a write that never touches the column is left
alone.

- [ ] **Step 4: Create the production-applicable rollout**

```sql
-- supabase/rollouts/2026-08-10-task-version-monotonic-fix.sql
--
-- Corrects tasks_updated_at_monotonic so it stops bumping updated_at on writes
-- that never touched it. Safe before or after the application deploy: the
-- function is replaced in place, the trigger binding is unchanged, and the new
-- behaviour is strictly less disruptive than the old one.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f this-file.sql

create or replace function tasks_updated_at_monotonic()
returns trigger language plpgsql as $$
begin
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

- [ ] **Step 5: Run the assertions — all five must pass**

Run: `psql "$SCRATCH_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/rollouts/2026-08-10-task-atomic-commands-test.sql`
Expected: PASS, silent completion, full rollback.

- [ ] **Step 6: Verify the end-to-end scenario**

On scratch or staging:

1. Open a task in the drawer; note its `updated_at` (the concurrency token).
2. `POST /api/cron/check-overdue` with the bearer secret.
3. PATCH the task with the token from step 1.

Expected: **PATCH succeeds.** Before the fix it returned 409 *"Task was updated by someone else."*

Then confirm the original bug stays fixed: issue two concurrent comment POSTs and assert
`updated_at` strictly increases and never repeats.

- [ ] **Step 7: Run the suites and commit**

Run: `npx vitest run && npm run typecheck`

```bash
git add supabase/schema.sql \
  supabase/rollouts/2026-08-10-task-version-monotonic-fix.sql \
  supabase/rollouts/2026-08-10-task-atomic-commands-test.sql changelog.md
git commit -m "fix(tasks): stop the version trigger bumping untouched updates"
```

---

# Phase 2 — Correctness parity

## Task 6: Exclude soft-deleted attachments from the task-level GET (C1, P2)

Task 11 of the collaboration work changed attachment deletion from a physical delete to
`deleted_at` + storage removal. `GET /api/tasks/[id]/attachments` was never updated: it filters only
`task_id` and `comment_id`, so deleted rows reappear. It also signs with `Promise.all`, so one stale
row fails the entire endpoint — the same defect that was fixed in task detail but not here.

**Files:**
- Modify: `src/app/api/tasks/[id]/attachments/route.ts:96-121`

- [ ] **Step 1: Filter active rows and reuse the isolated signer**

```ts
  // Task-level attachments only; comment attachments live with their comment.
  // deleted_at is required: deletion became a soft-delete plus storage removal,
  // so an unfiltered query resurfaces files whose objects are already gone.
  const { data, error } = await r.supabase
    .from("task_attachments")
    .select("id,file_name,mime_type,size_bytes,storage_path,created_at")
    .eq("task_id", id)
    .is("comment_id", null)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Per-file isolation, same as task detail: one unsignable object must not
  // fail the whole response.
  const rows = (data ?? []) as {
    id: string; file_name: string; mime_type: string | null;
    size_bytes: number | null; storage_path: string; created_at: string;
  }[];
  const signed = await signAttachmentsSafely(rows);
  const attachments = rows.map((row, index) => ({
    ...signed[index],
    created_at: row.created_at,
  }));
```

Import `signAttachmentsSafely` from `@/lib/tasks/detail` — it already returns
`url: string | null` with `unavailable?: true`, which the client renders.

- [ ] **Step 2: Verify**

Run: `npm run typecheck && npx vitest run`

Manual: delete a task-level attachment, call `GET /api/tasks/<id>/attachments` directly — the
deleted id must not appear. Point one active row's `storage_path` at a missing object — the endpoint
must still return 200 with the other files intact and that one marked unavailable.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/tasks/[id]/attachments/route.ts" changelog.md
git commit -m "fix(attachments): hide soft-deleted files and isolate signing in GET"
```

---

## Task 7: Record an intentional clear as a clear in the audit (C2 + D3, P2/P3)

`enrollment/[id]/route.ts:395` builds the audit payload with nullish coalescing:

```ts
  if (touchesPeople) rpcActivityRows.push({ type: "people_changed", meta: { caller: patch.caller_email ?? current.caller_email, responsible_enroll: patch.responsible_enroll_email ?? current.responsible_enroll_email } });
```

`null` is the *valid* value for clearing a person, and `??` treats it as absent — so the activity row
durably records the **previous** person for an action that removed them. The audit states the
opposite of what happened.

A second `activityRows` array is built after the commit and never inserted (D3). It already diverges
from the RPC version, so a maintainer can fix the wrong one.

**Files:**
- Modify: `src/app/api/enrollment/[id]/route.ts:395` and the dead block at 423-567

- [ ] **Step 1: Distinguish absence from explicit null**

```ts
  if (touchesPeople) {
    // `??` cannot be used here: null is the value that CLEARS a person, and
    // nullish coalescing would substitute the person being removed -- durably
    // logging the opposite of what the user did. Key presence is the only
    // signal that separates "not in this patch" from "explicitly cleared".
    const nextCaller =
      "caller_email" in patch ? patch.caller_email : current.caller_email;
    const nextResponsible =
      "responsible_enroll_email" in patch
        ? patch.responsible_enroll_email
        : current.responsible_enroll_email;
    rpcActivityRows.push({
      type: "people_changed",
      meta: { caller: nextCaller, responsible_enroll: nextResponsible },
    });
  }
```

- [ ] **Step 2: Delete the dead post-commit activity builder**

Remove the second `activityRows` construction at 423-567 entirely. `rpcActivityRows` is the only
input that reaches the database. Leaving a divergent duplicate invites either a fix applied to the
wrong path or a future accidental double-write.

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npx vitest run`

Manual, on ACA and Medicare: clear caller only, clear responsible only, clear both. Each
`people_changed.meta` must contain `null` exactly where the person was cleared. Then change a person
without clearing and confirm the new email is recorded.

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/enrollment/[id]/route.ts" changelog.md
git commit -m "fix(enrollment): log person clears as clears and drop dead audit path"
```

---

## Task 8: Close the Enrollment parity gaps (C3 + C4, P2)

The shared composer sends `client_request_id` to **both** products and displays the same limits for
both. Tasks honours the token and enforces the limits server-side; Enrollment does neither:

- `src/app/api/enrollment/[id]/attachments/route.ts` — zero occurrences of `client_request_id`
  (verified). A retry after a lost response duplicates the row and the storage object, while the UI
  presents Retry as safe.
- `src/app/api/enrollment/[id]/comments/route.ts` — no text-length check (verified). The 10,000
  character limit is client-only.

Task-side limits are also TOCTOU: `checkOperationLimits` runs at line 191, the upload at 205, and the
row-locking RPC at 234. Two concurrent uploads can both observe 9 files and both commit, producing
11 — the database command does not enforce the limit.

**Files:**
- Modify: `src/app/api/enrollment/[id]/attachments/route.ts`
- Modify: `src/app/api/enrollment/[id]/comments/route.ts`
- Modify: `supabase/schema.sql` — `create_task_attachment_atomic`
- Modify: `src/app/api/tasks/[id]/attachments/route.ts`

- [ ] **Step 1: Enforce the count and aggregate inside the locked command**

The check must happen where the row lock is held, not before the upload. Inside
`create_task_attachment_atomic`, after the comment validation and before the insert:

```sql
  -- Enforced here, not only in the route: the route checks before uploading and
  -- before this lock is taken, so two concurrent uploads can both observe nine
  -- files and both commit. The limit is only real where the lock is.
  if p_comment_id is not null then
    select count(*), coalesce(sum(size_bytes), 0)
      into v_file_count, v_total_bytes
      from task_attachments
     where comment_id = p_comment_id and deleted_at is null;

    if v_file_count + 1 > 10 then
      raise exception 'ATTACHMENT_COUNT_EXCEEDED';
    end if;
    if v_total_bytes + p_size_bytes > 52428800 then
      raise exception 'ATTACHMENT_AGGREGATE_EXCEEDED';
    end if;
  end if;
```

Declare `v_file_count integer;` and `v_total_bytes bigint;` in the function's `declare` block. In the
task route, map both exceptions to 400 with the message naming the limit that tripped, and delete
the storage object the attempt just uploaded — the existing compensation path already does this for
other command failures.

- [ ] **Step 2: Enforce the comment text limit on the Enrollment API**

In `src/app/api/enrollment/[id]/comments/route.ts`, immediately after the body is parsed and
trimmed:

```ts
  // The shared composer advertises this limit for both products; only Tasks
  // enforced it. A direct API call or a stale client bypassed it entirely.
  if (text.length > 10_000) {
    return NextResponse.json(
      { error: "Comment is too long (max 10,000 characters)." },
      { status: 400 }
    );
  }
```

- [ ] **Step 3: Honour the idempotency token on Enrollment attachments**

Add the column and partial index:

```sql
alter table enrollment_attachments add column if not exists client_request_id uuid;

create unique index if not exists enrollment_attachments_client_request_id_key
  on enrollment_attachments (record_id, uploaded_by, client_request_id)
  where client_request_id is not null;
```

In the route, read `client_request_id` from the form, validate it as a UUID, and check for an
existing row before uploading:

```ts
  const rawRequestId = form?.get("client_request_id");
  const requestId =
    typeof rawRequestId === "string" && rawRequestId ? rawRequestId : null;
  if (requestId !== null && !UUID_RE.test(requestId)) {
    return NextResponse.json({ error: "Invalid request id." }, { status: 400 });
  }

  // Replay check before creating anything: the shared composer keeps one token
  // across retries, so a retry after a lost response must return the original
  // row rather than upload a second copy.
  if (requestId) {
    const { data: existing } = await supabase
      .from("enrollment_attachments")
      .select("id,file_name,mime_type,size_bytes,storage_path,created_at")
      .eq("record_id", id)
      .eq("uploaded_by", actorEmail)
      .eq("client_request_id", requestId)
      .maybeSingle();
    if (existing) {
      const row = existing as { storage_path: string };
      return NextResponse.json({
        attachment: { ...existing, url: await signTaskFile(row.storage_path) },
        warnings: [],
      });
    }
  }
```

Persist `client_request_id` in the insert.

> If Enrollment attachment creation is later moved onto an atomic RPC (Task 9), fold this replay
> check into that command instead — a route-level check is a narrower guarantee than a unique index
> under a lock. The index added here is what actually prevents the duplicate; the route check turns
> a constraint violation into a clean 200.

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npx vitest run`

- Upload a file twice with the same `client_request_id` on ACA → one row, one object, original
  returned.
- Same file with a **new** token → two rows. A new token is a new intent.
- POST a 10,001-character Enrollment comment directly → 400.
- Fire two concurrent uploads against a comment already holding nine files → exactly one commits,
  the other gets 400 with `ATTACHMENT_COUNT_EXCEEDED`, and its object is removed.

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/enrollment/[id]/attachments/route.ts" \
  "src/app/api/enrollment/[id]/comments/route.ts" \
  "src/app/api/tasks/[id]/attachments/route.ts" supabase/schema.sql changelog.md
git commit -m "fix(enrollment): honour idempotency tokens and enforce operation limits"
```

---

## Task 9: Bring Enrollment collaboration to the Task commit contract (C5 + C6, P2)

Enrollment comment creation commits the comment, then separately touches parent activity and inserts
audit. Attachment creation does the same. Comment deletion soft-deletes directly with no CAS token,
does not atomically remove linked attachment metadata, writes no `comment_deleted` activity even
though the vocabulary exists, and can return a retryable 500 after the delete committed. Enrollment
record creation has no request token at all.

This is the same work Tasks received in commits `f48e1e1`, `c9249a2`, `4ce4f97`, `923075b`, and
`ac2e23b`. **Use those commands as the specification** — same required/best-effort split, same
`warnings` shape, same replay semantics — rather than designing a second contract.

**Files:**
- Modify: `supabase/schema.sql` — new enrollment commands
- Modify: `src/app/api/enrollment/[id]/comments/route.ts`, `.../comments/[cid]/route.ts`,
  `.../attachments/route.ts`, `src/app/api/enrollment/route.ts`

**This task is large enough to split at execution time.** Suggested boundaries, each independently
reviewable and shippable:

- **9a** — `create_enrollment_comment_atomic`: comment + activity + parent touch in one transaction;
  notifications and broadcasts post-commit as warnings. (`create_enrollment_comment_idempotent`
  already exists at `schema.sql:3983` — check whether it covers this before writing a new command.)
- **9b** — `delete_enrollment_comment_atomic`: soft-delete + linked attachment metadata +
  `comment_deleted` activity, returning storage paths for post-commit cleanup.
- **9c** — CAS on enrollment comment edit, mirroring `edit_task_comment_atomic`'s
  `COMMENT_CONFLICT` → 409.
- **9d** — request token on `create_enrollment_atomic`, mirroring `create_task_atomic`.

- [ ] **Step 1: Read the Task-side commands first**

`schema.sql:1951` (`create_task_comment_atomic`), `2135` (`edit_task_comment_atomic`), `2218`
(`delete_task_comment_atomic`), `2415` (`create_task_atomic`). Note the shared shape: replay check
first, `for update` lock, required writes, then return `was_created` so the caller knows whether to
run side effects.

- [ ] **Step 2: Check what already exists**

`create_enrollment_comment_idempotent` and `edit_enrollment_comment_atomic` were added by `224bebb`
and **do** have correct explicit revokes. Determine which of 9a–9d are already satisfied before
writing anything. Do not duplicate an existing command.

- [ ] **Step 3: Implement the missing commands, one per sub-task**

Follow the Task-side structure exactly. Each sub-task ends with its own SQL assertions in
`supabase/rollouts/2026-08-10-task-atomic-commands-test.sql` (add `CASE` numbers continuing from
Task 11) and its own commit.

- [ ] **Step 4: Verify**

For each sub-task: inject a failure after each durable step; race edit against delete; delete a
comment with files; assert parent timestamps, audit rows, counters, cleanup warnings, and that a
committed mutation never returns 5xx.

- [ ] **Step 5: Address the Task-side outbox gap**

`create_task_atomic` returns `was_created=false` on replay and the route then **skips** rotation,
notification, and broadcast. If the process dies after the DB commit but before those effects, a
retry can never repair them. Either record a repairable status the reconciliation script can act on,
or make each side effect independently idempotent and run it on replay too. Document whichever you
choose — silently skipping is only correct if the first attempt definitely completed them.

---

# Phase 3 — Scale, reliability, and hygiene

These do not block the current release. Each needs an owner and a decision, not necessarily code.

## Task 10: P3 hygiene batch

Three independent one-file changes, grouped because each is a few minutes and none warrants its own
review gate.

**Files:**
- Modify: `src/lib/cron-auth.ts` + `src/lib/cron-auth.test.ts` (D4)
- Modify: `src/lib/tasks/detail-cache.ts` + test (D2)

- [ ] **Step 1: Constant-time cron secret comparison (D4)**

Add to `src/lib/cron-auth.test.ts`:

```ts
  it("rejects a token of a different length without throwing", () => {
    // timingSafeEqual raises RangeError on unequal-length buffers, so the guard
    // must length-check first or a short token becomes a 500 instead of a 401.
    process.env.CRON_SECRET = "cron-secret";
    expect(
      checkCronAuthorization(
        new Request("https://example.test/api/cron", {
          headers: { Authorization: "Bearer short" },
        })
      )
    ).toBe("unauthorized");
  });
```

Then:

```ts
import { timingSafeEqual } from "node:crypto";

export function checkCronAuthorization(request: Request): CronAuthResult {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return "misconfigured";

  const authHeader = request.headers.get("authorization");
  if (!authHeader) return "unauthorized";

  const expected = Buffer.from(`Bearer ${cronSecret}`);
  const received = Buffer.from(authHeader);
  // Length is not a secret worth protecting, and timingSafeEqual throws on
  // unequal lengths, so compare it plainly first.
  if (expected.length !== received.length) return "unauthorized";

  return timingSafeEqual(expected, received) ? "ok" : "unauthorized";
}
```

Run: `npx vitest run src/lib/cron-auth.test.ts` — all six cases pass.

- [ ] **Step 2: Bound the detail cache (D2)**

`detail-cache.ts` checks its TTL only when the same id is read again, so a long-lived tab that hovers
many distinct tasks retains every expired entry forever. Add a bound:

```ts
const MAX_CACHE_ENTRIES = 50;

export function setCachedTaskDetail(id: string, detail: TaskDetail): void {
  // TTL alone only reclaims an entry that is read again. A tab that hovers many
  // tasks and revisits none grows monotonically, so cap the map as well.
  if (cache.size >= MAX_CACHE_ENTRIES && !cache.has(id)) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(id, { detail, storedAt: Date.now() });
}
```

`Map` preserves insertion order, so deleting the first key is FIFO eviction — sufficient here, and
simpler than tracking access order. Add a test asserting the map never exceeds
`MAX_CACHE_ENTRIES` after 100 distinct writes.

- [ ] **Step 3: Verify and commit**

Run: `npx vitest run && npm run typecheck && npm run lint`

```bash
git add src/lib/cron-auth.ts src/lib/cron-auth.test.ts \
  src/lib/tasks/detail-cache.ts src/lib/tasks/detail-cache.test.ts changelog.md
git commit -m "fix(hygiene): constant-time cron auth and bounded detail cache"
```

---

## Task 11: SQL assertions for the task atomic commands (D5)

The weekend added eight task-side atomic commands and none has a database-level test. B4 was exactly
the class of bug one assertion catches.

**Files:**
- Modify: `supabase/rollouts/2026-08-10-task-atomic-commands-test.sql` (extend Task 5's file)

- [ ] **Step 1: Add idempotency, conflict, and transition assertions**

Insert the four nested blocks below immediately before the closing `end $$;` of the existing `do $$`
block. Each is a **nested plpgsql block** with its own `declare` — do not hoist these into the outer
declaration, and do not rename `fixture_task_id`.

```sql
  -- CASE6: replaying a client_request_id returns the original comment and
  -- writes no second activity row. This is what makes a retry after an
  -- ambiguous response safe.
  declare
    req_id uuid := gen_random_uuid();
    first_result record;
    replay_result record;
    activity_count integer;
  begin
    select * into first_result from create_task_comment_atomic(
      fixture_task_id, 'author@example.test', 'hello', null, req_id, array[]::text[]);
    select * into replay_result from create_task_comment_atomic(
      fixture_task_id, 'author@example.test', 'hello', null, req_id, array[]::text[]);

    if (first_result.comment->>'id') <> (replay_result.comment->>'id') then
      raise exception 'CASE6: replay returned a different comment id';
    end if;
    if replay_result.was_created then
      raise exception 'CASE6: replay reported was_created = true';
    end if;

    select count(*) into activity_count
      from task_activity a
     where a.task_id = fixture_task_id and a.type = 'comment_added';
    if activity_count <> 1 then
      raise exception 'CASE6: replay produced % comment_added rows, expected 1', activity_count;
    end if;
  end;

  -- CASE7: the same text under a NEW request id is a legitimate second comment.
  -- Deduplicating on body text would swallow real user intent.
  declare
    second_result record;
  begin
    select * into second_result from create_task_comment_atomic(
      fixture_task_id, 'author@example.test', 'hello', null,
      gen_random_uuid(), array[]::text[]);
    if not second_result.was_created then
      raise exception 'CASE7: identical text under a new request id was deduplicated';
    end if;
  end;

  -- CASE8: a stale expected version must be rejected, not silently applied.
  declare
    cmt_id uuid;
    stale timestamptz;
  begin
    select (comment->>'id')::uuid, (comment->>'updated_at')::timestamptz
      into cmt_id, stale
      from create_task_comment_atomic(
        fixture_task_id, 'author@example.test', 'original', null,
        gen_random_uuid(), array[]::text[]);

    perform edit_task_comment_atomic(
      cmt_id, fixture_task_id, 'author@example.test', 'first edit', stale, array[]::text[]);
    begin
      perform edit_task_comment_atomic(
        cmt_id, fixture_task_id, 'author@example.test', 'second edit', stale, array[]::text[]);
      raise exception 'CASE8: stale expected_updated_at was accepted';
    exception when others then
      if sqlerrm not like '%COMMENT_CONFLICT%' then raise; end if;
    end;
  end;

  -- CASE9: mark_task_overdue_atomic reports the transition exactly once, so a
  -- second concurrent cron run cannot re-notify or double-count.
  declare
    first_flag boolean;
    second_flag boolean;
    od_task uuid;
    overdue_activity_count integer;
  begin
    insert into tasks (title, status, reporter_email, in_progress_at)
    values ('overdue fixture', 'in_progress', 'fixture@example.test', now() - interval '2 hours')
    returning id into od_task;

    select mark_task_overdue_atomic(od_task, now() - interval '1 hour', 60) into first_flag;
    select mark_task_overdue_atomic(od_task, now() - interval '1 hour', 60) into second_flag;

    if not first_flag then raise exception 'CASE9: first transition returned false'; end if;
    if second_flag then raise exception 'CASE9: second transition returned true'; end if;

    select count(*) into overdue_activity_count
      from task_activity a
     where a.task_id = od_task and a.type = 'went_overdue';
    if overdue_activity_count <> 1 then
      raise exception 'CASE9: went_overdue written % times, expected 1', overdue_activity_count;
    end if;
  end;
```

- [ ] **Step 2: Run the assertions**

Run: `psql "$SCRATCH_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/rollouts/2026-08-10-task-atomic-commands-test.sql`
Expected: PASS — nine cases, silent completion, full rollback.

A CASE6 or CASE9 failure is a genuine defect in the command, not a test bug. Stop and report it
rather than adjusting the assertion to match the behaviour.

- [ ] **Step 3: Commit**

```bash
git add supabase/rollouts/2026-08-10-task-atomic-commands-test.sql changelog.md
git commit -m "test(tasks): assert atomic command idempotency and conflict handling"
```

---

## Task 12: Decisions required — no code in this task

Four findings need an owner's decision before they can become work. Record each decision in
`changelog.md` with a name and a date.

- [ ] **C7 — row-cap ceiling.** Tasks and Enrollment now *fail closed* when an un-ranged PostgREST
  response is truncated (commits `a52156e`, `f7c1d94`). That is safer than silently showing a partial
  list, but it converts a correctness bug into an availability ceiling: above the configured cap
  (commonly 1,000) the board and export return 5xx. Enrollment's auxiliary comment/attachment queries
  have neither paging nor a count guard and can silently undercount.
  **Decide:** current record volume, the cap in this project, and whether server-side pagination is
  in scope now or after go-live. **Risk: NEEDS VALIDATION** — seed above the cap and measure.

- [ ] **C8 — search fan-out.** `collectVisibleHits` resolves visibility *after* fetching matches, so
  three parallel groups can each scan twenty 50-row pages up to `MAX_SEARCH_SCAN=1000`, each page
  issuing a candidate query plus metadata and assignee queries. Worst case is on the order of 180 DB
  calls for one search. **The actual production cost is UNKNOWN — no measurement exists, and this
  plan will not invent one.** **Decide:** whether to benchmark before go-live, or accept and revisit.

- [ ] **C9 — remaining cron classes.** Only the overdue transition became atomic (`6b9c0dd`). The
  other five reminder classes still notify before their conditional marker update, so concurrent
  invocations can duplicate reminders; both crons process matches with unbounded `Promise.all` and no
  paging. **Decide:** whether duplicate reminders are tolerable until the next cycle.

- [ ] **C10 — rollback gate.** After the stage-tracking schema lands, only the new code maintains
  `stage_entered_at`, history, and cycles. Rolling the app back restores direct row writes that
  bypass those invariants, silently creating gaps. **Decide:** declare a no-rollback gate after
  migration, or add a temporary compatibility trigger. There is no third option that is safe.

- [ ] **D1 — lowercase invariant.** Enrollment list queries use exact `.in("agent_email", lowercased)`
  while direct record guards normalize both sides. Task 2's migration normalizes existing data and the
  RPCs normalize future writes, so likelihood is low — but there is no database-level `citext` or
  check constraint, so an old-app rollback or a direct write can reintroduce mixed case, making a
  record invisible in the list yet reachable by direct link. **Decide:** add the constraint now, or
  accept and cover with a mixed-case test.

---

## Deliberately not in this plan

**A metric separating genuine 409s from version-churn 409s.** Version churn increased from three
directions at once — comment creation and standalone attachment upload both touch the parent task,
on top of the trigger — so the 409 rate will stay elevated even after Task 5. Instrumenting it is
correct. It is not here because **this repository has no telemetry infrastructure**: no Sentry,
PostHog, Datadog, OpenTelemetry, or `@vercel/analytics` dependency (verified; the `metrics`-named
modules under `src/lib/enrollment/` are business dashboards). There are 24 `status: 409` sites.
Adding a metric means choosing and wiring a vendor — a separate project.

**Latency baselines.** `d3f4052` serialized authorization ahead of the privileged detail load,
trading one network wave for correctness. The trade is right; the cost is unmeasured and needs the
same missing instrumentation. Both source reviews recorded latency as **UNKNOWN** rather than
asserting it is fine. That remains the honest position.

---

## Acceptance criteria

- `psql -v ON_ERROR_STOP=1 -f supabase/schema.sql` applies end to end on an **empty** database, and a
  second apply is a clean no-op.
- Every SECURITY DEFINER function in `public` is executable by `service_role` only — in production
  and in any environment provisioned from `schema.sql`.
- Appending a SECURITY DEFINER function without a `revoke`/`grant` pair fails the **next** schema
  apply with a named function list.
- The stage backfill completes against fixtures covering active, terminal, closed, archived,
  no-stage, first-history-event, mixed live/backfill, and same-timestamp records — and is idempotent
  across two runs.
- A `tasks` update that does not name `updated_at` leaves it unchanged; a write supplying an older or
  identical timestamp is still clamped forward.
- Holding a concurrency token across a full `/api/cron/check-overdue` pass and then PATCHing succeeds.
- A deleted task-level attachment never appears in `GET /api/tasks/[id]/attachments`, and one
  unsignable active file does not hide the others.
- Clearing an Enrollment person records `null` in `people_changed.meta`, not the removed person.
- Uploading twice with one `client_request_id` yields one row and one storage object on **both**
  Tasks and Enrollment.
- Two concurrent uploads against a nine-file comment commit exactly one.
- `supabase/rollouts/2026-08-10-task-atomic-commands-test.sql` passes all nine cases.
- `npx vitest run && npm run typecheck && npm run lint && npm run build` all pass.
- Every decision in Task 12 has a named owner and a dated entry in `changelog.md`.

## Execution Log

| Task | Phase | Sev | Finding | Status | Commit | Verification | Notes |
|---|---|---|---|---|---|---|---|
| 1. Production ACL audit | 0 | **P0** | B2 | Pending | — | — | Read-only. **Run first.** Record which branch applied |
| 2. Fix `agent_email` ordering | 1 | **P1** | B1 | Pending | — | — | **Blocks Tasks 3 and 11** — nothing validates on a fresh DB until this lands |
| 3. Structural ACL invariant | 1 | **P0** | B2 | Pending | — | — | Canary must fail the **second** apply |
| 4. Fix stage backfill | 1 | **P1** | B3 | Pending | — | — | Must be idempotent across two runs |
| 5. Fix monotonic trigger | 1 | **P1** | B4 | Pending | — | — | CASE1 must FAIL before the fix |
| 6. Soft-deleted attachments in GET | 2 | P2 | C1 | Pending | — | — | — |
| 7. Person-clear audit + dead path | 2 | P2/P3 | C2, D3 | Pending | — | — | — |
| 8. Enrollment parity: tokens + limits | 2 | P2 | C3, C4 | Pending | — | — | Limit must move inside the locked command |
| 9. Enrollment atomic collaboration | 2 | P2 | C5, C6 | Pending | — | — | Split into 9a–9d at execution time |
| 10. P3 hygiene batch | 3 | P3 | D2, D4 | Pending | — | — | — |
| 11. Task atomic command assertions | 3 | P3 | D5 | Pending | — | — | CASE6/CASE9 failure = real defect |
| 12. Decisions required | 3 | P2/P3 | C7–C10, D1 | Pending | — | — | No code. Needs named owners |
