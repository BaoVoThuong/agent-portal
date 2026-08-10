# Post-Review Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the two P1 blockers found in the 2026-08-10 production review of commits
`be706b0^..ed99359`, and make both failure classes structurally impossible to reintroduce.

**Architecture:** Both P1s are one-line-class defects with a shared shape — a guard that is correct
in intent but wrong in reach. The trigger guards against version regression but fires on every
write; the ACL sweep protects every SECURITY DEFINER function but only those that exist when it
runs. Each fix therefore has two halves: correct the guard, then add an assertion that fails loudly
if the guard is ever bypassed again. The assertions are the durable part.

**Tech Stack:** PostgreSQL 15 (Supabase), plpgsql, TypeScript, Vitest (node environment),
Next.js 16.2.4 route handlers.

**Source:** `docs/2026-08-10-production-code-review-since-friday.md`. Finding IDs below refer to it.

---

## Global Constraints

- **Task 1 is read-only and gates the rest.** Do not change any schema until the production ACL
  audit has run and its result is recorded. Its outcome decides whether Task 3 is an emergency
  hotfix or routine hardening.
- **Vitest collects `src/**/*.test.ts` only, in `environment: "node"`.** `.tsx` is not collected and
  there is no DOM harness. Tests are explicit: `import { describe, expect, it } from "vitest";`
  (`globals: false`). Import app code through the `@/` alias.
- **SQL assertions follow the existing convention** established by
  `supabase/rollouts/2026-08-09-enrollment-stage-time-test.sql`: a single file wrapped in
  `begin; do $$ ... $$; rollback;`, numbered `CASE<n>` failures raised as exceptions, run against a
  disposable database with `psql "$SCRATCH_DATABASE_URL" -v ON_ERROR_STOP=1 -f <file>`. Everything
  rolls back, including fixtures. Never run these against production.
- **Every logic change gets a `changelog.md` entry** (repo root: `agent-portal/changelog.md`) in the
  same commit as the change.
- **Commit per task.** Stage only files owned by the current task — this worktree has unrelated
  dirty files. Do not `git push` unless explicitly asked.
- **Next.js 16.2.4 is not the Next.js in your training data.** Before editing anything under
  `src/app/`, read `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`.
- **Do not "fix" Finding 2 by adding `updated_at` to the cron updates.** That converts an accidental
  version bump into an intentional one and produces the identical 409s. The fix belongs in the
  trigger.

---

## Findings addressed

| Finding | Sev | Task | Status |
|---|---|---|---|
| Monotonic trigger bumps `updated_at` on every UPDATE | **P1** | 2 | Open |
| SECURITY DEFINER enrollment RPCs defined after the ACL sweep | **P1** | 1, 3 | Open |
| Cron secret non-constant-time comparison | P3 | 4 | Open |
| No SQL tests for the eight task atomic commands | P3 | 5 | Open |
| `mark_task_overdue_atomic` `status = 'in_progress'` narrowing | ~~P2~~ | — | **Resolved during planning — see below** |
| Docs-to-code commit ratio | P2 | — | Process observation, no code change |

### Resolved during planning: the overdue status narrowing is correct

The review flagged `mark_task_overdue_atomic`'s `and status = 'in_progress'` predicate as possible
accidental narrowing, marked **NEEDS VALIDATION**. I validated it while writing this plan and it is
**correct as written — no change required.**

The selection query already restricts to in-progress tasks:

```ts
// src/app/api/cron/check-overdue/route.ts:59-66
  const { data: taskRows, error: tasksError } = await supabase
    .from("tasks")
    .select("id,status,priority,...")
    .eq("status", "in_progress")
    .is("archived_at", null)
    .not("in_progress_at", "is", null);
```

So the command's predicate is a **re-assertion of the same condition inside the transaction** — a
correct time-of-check-to-time-of-use guard for a status that changed between `SELECT` and `UPDATE`.
A task skipped that way is genuinely no longer overdue-eligible, and because `overdue_flagged_at`
stays null it is re-evaluated on the next pass if it returns to In Progress. Nothing is lost.

Recording this here rather than silently dropping it, so nobody re-opens it.

---

## File Structure

| Path | Change | Responsibility |
|---|---|---|
| `supabase/schema.sql:1371-1385` | Modify | Correct `tasks_updated_at_monotonic` reach |
| `supabase/schema.sql:3424-3445` | Move | Relocate the ACL sweep to end-of-file |
| `supabase/schema.sql` (new, end) | Create | Fail-closed ACL assertion |
| `supabase/rollouts/2026-08-10-task-version-monotonic-fix.sql` | Create | Production-applicable trigger fix |
| `supabase/rollouts/2026-08-10-security-definer-acl-audit.sql` | Create | Read-only production ACL audit |
| `supabase/rollouts/2026-08-10-task-atomic-commands-test.sql` | Create | SQL assertions for the trigger + task commands |
| `src/lib/cron-auth.ts` | Modify | Constant-time secret comparison |
| `src/lib/cron-auth.test.ts` | Modify | Cover the constant-time path |

---

## Task 1: Audit production for SECURITY DEFINER exposure

**Read-only. Run this before touching anything else.** Its result decides whether Finding 1 is a
live production exposure (drop everything, revoke now) or a provisioning-time landmine in
`schema.sql` only (fix calmly in Task 3).

The review established that `supabase/rollouts/2026-08-09-enrollment-stage-time-schema.sql:478-494`
revokes all seven enrollment functions correctly, while `supabase/schema.sql` does not, because four
of them sit past the positional sweep. Which one production actually received is unknown from the
repository alone.

**Files:**
- Create: `supabase/rollouts/2026-08-10-security-definer-acl-audit.sql`

**Interfaces:**
- Produces: a row per SECURITY DEFINER function with its effective `authenticated` grant. Task 3
  reuses the same query as its post-fix validation.

- [ ] **Step 1: Write the audit query**

```sql
-- supabase/rollouts/2026-08-10-security-definer-acl-audit.sql
--
-- READ-ONLY. Safe to run against production.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f this-file.sql
--
-- Every SECURITY DEFINER routine in this schema is a server-only RPC whose
-- caller performs authorization in Next.js first. PostgreSQL grants EXECUTE to
-- PUBLIC by default, Supabase's `authenticated` role inherits PUBLIC, and
-- PostgREST exposes public-schema functions at /rest/v1/rpc/<name>. Any row
-- below with authenticated_can_execute = true is therefore reachable from the
-- browser with the anon key, bypassing the application authorization boundary
-- entirely — SECURITY DEFINER also bypasses RLS.

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

Expected in a healthy database: **every row shows `authenticated_can_execute = f` and
`anon_can_execute = f`, and `service_role_can_execute = t`.**

- [ ] **Step 3: Branch on the result**

**If any row shows `t` for `authenticated` or `anon`** — this is a live exposure. Revoke immediately,
before continuing with the plan:

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

Then re-run Step 2 and confirm the audit is clean. Treat the window between `224bebb`
(2026-08-09 23:53) and the revoke as a potential incident: check
`enrollment_activity` for writes whose `actor_email` does not match any plausible session, and check
`enrollment_records.archived_at` for unexpected archives.

**If every row is already `f`** — production was migrated with the rollout file and is safe.
Finding 1 is confined to `schema.sql`. Continue to Task 2 at normal priority.

- [ ] **Step 4: Record the outcome and commit**

Write the result into `changelog.md` with the date, the row count, and which branch applied.

```bash
git add supabase/rollouts/2026-08-10-security-definer-acl-audit.sql changelog.md
git commit -m "chore(security): add read-only security definer ACL audit"
```

---

## Task 2: Correct the monotonic trigger's reach (Finding 2, P1)

`tasks_updated_at_monotonic` was added by `24146e8` to stop `updated_at` regressing — a real bug
(audit finding F2). Its guard is `<=`, and in a `BEFORE UPDATE ... FOR EACH ROW` trigger, columns
absent from the `SET` clause carry the old value into `NEW`. So any statement that does not name
`updated_at` satisfies `new.updated_at <= old.updated_at` and gets bumped by 1 µs.

That turns six cron reminder writes — plus `mark_task_overdue_atomic` — into version-invalidating
operations. Both concurrency checks compare with exact equality
(`patch_task_atomic`: `target_task.updated_at <> p_expected_updated_at`; the archive path:
`.eq("updated_at", expectedUpdatedAt)`), so a 1 µs bump produces
*"Task was updated by someone else. Refresh and try again."* on a task nobody edited.

**Files:**
- Modify: `supabase/schema.sql:1371-1385`
- Create: `supabase/rollouts/2026-08-10-task-version-monotonic-fix.sql`
- Create: `supabase/rollouts/2026-08-10-task-atomic-commands-test.sql`

**Interfaces:**
- Produces: corrected `tasks_updated_at_monotonic()`. Task 5 extends the same test file.

- [ ] **Step 1: Write the failing SQL assertions**

Create `supabase/rollouts/2026-08-10-task-atomic-commands-test.sql`:

```sql
-- Scratch-only assertions for the task version trigger.
-- Run against a disposable database with the complete schema:
--   psql "$SCRATCH_DATABASE_URL" -v ON_ERROR_STOP=1 -f this-file.sql
-- Everything is rolled back, including fixtures.

begin;

do $$
declare
  -- Deliberately NOT named `task_id`: that is also a column name on
  -- task_activity and task_comments, and plpgsql raises
  -- "column reference is ambiguous" the moment such a variable appears in a
  -- WHERE clause against those tables. Task 5 extends this block and would hit
  -- it immediately.
  fixture_task_id uuid;
  v0 timestamptz;
  v1 timestamptz;
begin
  insert into tasks (title, status, reporter_email)
  values ('trigger fixture', 'todo', 'fixture@example.test')
  returning id, updated_at into fixture_task_id, v0;

  -- CASE1: a write that does not name updated_at must leave it alone.
  -- This is the regression: cron reminder writes used to be version-neutral,
  -- and the `<=` guard made every one of them invalidate the client's token.
  update tasks set overdue_reminded_at = now() where id = fixture_task_id;
  select updated_at into v1 from tasks where id = fixture_task_id;
  if v1 <> v0 then
    raise exception 'CASE1: reminder-only update moved updated_at from % to %', v0, v1;
  end if;

  -- CASE2: a write supplying an OLDER timestamp must still be clamped forward.
  -- This is the original bug the trigger exists to prevent (audit F2).
  update tasks set updated_at = v0 - interval '1 hour' where id = fixture_task_id;
  select updated_at into v1 from tasks where id = fixture_task_id;
  if v1 <= v0 then
    raise exception 'CASE2: backwards updated_at was accepted (% <= %)', v1, v0;
  end if;

  -- CASE3: a write supplying the SAME timestamp must still be clamped forward,
  -- so two writers in the same microsecond cannot collide on one version.
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

  -- CASE5: last_activity_at must never regress, and its actor must travel with it.
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

- [ ] **Step 2: Run the assertions against a scratch database to verify CASE1 fails**

Run: `psql "$SCRATCH_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/rollouts/2026-08-10-task-atomic-commands-test.sql`
Expected: **FAIL** with `CASE1: reminder-only update moved updated_at from ... to ...`

CASE2–CASE5 should already pass. If CASE1 passes, the trigger is not installed on this database —
apply `schema.sql` first, otherwise you are testing nothing.

- [ ] **Step 3: Correct the trigger in `supabase/schema.sql:1371-1385`**

```sql
create or replace function tasks_updated_at_monotonic()
returns trigger language plpgsql as $$
begin
  -- Correct a genuine regression only. `is distinct from` is load-bearing: in a
  -- BEFORE UPDATE row trigger, a column absent from the SET clause carries the
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

Note the semantics: a write that supplies `updated_at` equal to the old value is still advanced
(CASE3), because two writers in the same microsecond must not share a version. Only a write that
does not touch the column at all is left alone.

- [ ] **Step 4: Create the production-applicable rollout**

```sql
-- supabase/rollouts/2026-08-10-task-version-monotonic-fix.sql
--
-- Corrects tasks_updated_at_monotonic so it stops bumping updated_at on writes
-- that never touched it. Safe to apply before or after the application deploy:
-- the function is replaced in place, the trigger binding is unchanged, and the
-- new behaviour is strictly less disruptive than the old one.
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

- [ ] **Step 5: Run the assertions to verify all five cases pass**

Run: `psql "$SCRATCH_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/rollouts/2026-08-10-task-atomic-commands-test.sql`
Expected: PASS — the script completes silently and rolls back.

- [ ] **Step 6: Verify the end-to-end scenario the regression produced**

On a scratch or staging environment:

1. Open a task in the drawer and note its `updated_at` (the concurrency token).
2. Invoke `POST /api/cron/check-overdue` with the bearer secret.
3. PATCH the task with the token captured in step 1.

Expected: **the PATCH succeeds.** Before this fix it returned 409
*"Task was updated by someone else. Refresh and try again."*

Then confirm the original bug is still fixed: issue two concurrent comment POSTs against one task
and assert `updated_at` strictly increases and never repeats.

- [ ] **Step 7: Run the existing suites and commit**

Run: `npx vitest run && npm run typecheck`
Expected: PASS.

```bash
git add supabase/schema.sql \
  supabase/rollouts/2026-08-10-task-version-monotonic-fix.sql \
  supabase/rollouts/2026-08-10-task-atomic-commands-test.sql changelog.md
git commit -m "fix(tasks): stop the version trigger bumping untouched updates"
```

---

## Task 3: Make the SECURITY DEFINER ACL invariant structural (Finding 1, P1)

`42a9db7` added a `pg_proc` sweep that revokes PUBLIC execute from every SECURITY DEFINER function.
It sits at `supabase/schema.sql:3424-3445`. Twenty-three hours later `224bebb` appended four more
SECURITY DEFINER functions **below** it — `patch_enrollment_atomic` (3631),
`create_enrollment_atomic` (3798), `archive_enrollment_atomic` (3880), `enrollment_touch_activity`
(3920) — none with an explicit `revoke`. A positional sweep only protects what already exists.

Two changes: move the sweep last, and add an assertion so appending a function below it can never
silently re-open the hole.

**Files:**
- Modify: `supabase/schema.sql` (move the block at 3424-3445 to end-of-file)
- Modify: `supabase/schema.sql` (append the assertion)

**Interfaces:**
- Consumes: the audit query from Task 1.
- Produces: `schema.sql` fails to apply if any SECURITY DEFINER function is world-executable.

- [ ] **Step 1: Move the sweep to the end of the file**

Cut the entire `do $$ ... end $$;` block currently at `supabase/schema.sql:3424-3445`, together with
its explanatory comment at 3417-3423, and paste both at the very end of the file. Keep the comment —
it is accurate and explains why the ACL matters.

Leave the individual `revoke`/`grant` pairs at lines 1902-1906, 1944, 2039, 2127, 2209, 2283, 2559,
2623, 3414, 4043, and 4146 exactly where they are. They are redundant once the sweep runs last, but
they document intent at each definition site and they are the only protection if someone extracts a
single function into another migration.

- [ ] **Step 2: Append the fail-closed assertion**

Immediately after the relocated sweep, at the very end of `supabase/schema.sql`:

```sql
-- Fail-closed ACL invariant. The sweep above is positional: it protects every
-- SECURITY DEFINER routine that exists when it runs, so a function appended
-- below it silently keeps PostgreSQL's default PUBLIC EXECUTE grant and becomes
-- reachable from the browser through PostgREST at /rest/v1/rpc/<name>, bypassing
-- the Next.js authorization boundary and RLS alike. That is exactly how
-- patch_enrollment_atomic, create_enrollment_atomic, archive_enrollment_atomic
-- and enrollment_touch_activity were left exposed. This assertion converts the
-- next occurrence from a silent hole into a failed deploy.
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

- [ ] **Step 3: Verify the assertion passes on a clean apply**

Run: `psql "$SCRATCH_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/schema.sql`
Expected: applies to completion with no exception.

Then run the Task 1 audit against the same scratch database:

Run: `psql "$SCRATCH_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/rollouts/2026-08-10-security-definer-acl-audit.sql`
Expected: every row `authenticated_can_execute = f`, `anon_can_execute = f`,
`service_role_can_execute = t`.

- [ ] **Step 4: Prove the assertion actually catches the regression**

This step is the point of the whole task — an assertion nobody has seen fail is not known to work.

Append a throwaway function to the end of `supabase/schema.sql`, **after** the assertion:

```sql
create or replace function acl_canary_delete_me()
returns void language sql security definer set search_path = public as $$ select 1 $$;
```

Run: `psql "$SCRATCH_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/schema.sql`
Expected: still succeeds — the canary is after the assertion, so this run does not catch it.

Run it a **second** time. Expected: **FAILS** with
`SECURITY DEFINER functions are still executable by anon/authenticated: acl_canary_delete_me()`.

That two-run behaviour is inherent to a positional check and is worth understanding before you rely
on it: the assertion catches a stray function on the *next* apply, not the one that introduced it.
It is a ratchet, not a gate. Anyone appending a SECURITY DEFINER function must still add its
`revoke`/`grant` pair at the definition site — the assertion exists to make forgetting it loud
rather than silent.

Now delete the canary function from `supabase/schema.sql` and confirm a fresh apply is clean again.

- [ ] **Step 5: Commit**

```bash
git add supabase/schema.sql changelog.md
git commit -m "fix(security): enforce security definer ACL invariant at schema apply"
```

---

## Task 4: Constant-time cron secret comparison (P3)

`src/lib/cron-auth.ts:12` compares with `===`, which short-circuits on the first differing byte.
The practical risk over HTTP is low — network jitter swamps the signal — and the routes already fail
closed correctly (`misconfigured` → 500, `unauthorized` → 401, verified in all three cron routes).
This is cheap to make airtight, so make it airtight.

**Files:**
- Modify: `src/lib/cron-auth.ts`
- Modify: `src/lib/cron-auth.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `src/lib/cron-auth.test.ts`:

```ts
  it("rejects a token of a different length without throwing", () => {
    // timingSafeEqual raises RangeError on unequal-length buffers; the guard has
    // to length-check first or a short token becomes a 500 instead of a 401.
    process.env.CRON_SECRET = "cron-secret";

    expect(
      checkCronAuthorization(
        new Request("https://example.test/api/cron", {
          headers: { Authorization: "Bearer short" },
        })
      )
    ).toBe("unauthorized");
  });

  it("rejects a token that shares a prefix with the secret", () => {
    process.env.CRON_SECRET = "cron-secret";

    expect(
      checkCronAuthorization(
        new Request("https://example.test/api/cron", {
          headers: { Authorization: "Bearer cron-secreX" },
        })
      )
    ).toBe("unauthorized");
  });
```

- [ ] **Step 2: Run the tests**

Run: `npx vitest run src/lib/cron-auth.test.ts`
Expected: PASS — the current `===` already satisfies both. These tests pin the behaviour so the
rewrite in Step 3 cannot regress it; that is their job.

- [ ] **Step 3: Switch to a constant-time comparison**

```ts
import { timingSafeEqual } from "node:crypto";

export type CronAuthResult = "ok" | "misconfigured" | "unauthorized";

/**
 * Cron credentials must stay in the Authorization header. Query-string
 * secrets are routinely copied into access logs, proxy logs, and history.
 */
export function checkCronAuthorization(request: Request): CronAuthResult {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return "misconfigured";

  const authHeader = request.headers.get("authorization");
  if (!authHeader) return "unauthorized";

  const expected = Buffer.from(`Bearer ${cronSecret}`);
  const received = Buffer.from(authHeader);
  // timingSafeEqual throws on unequal lengths, and the length itself is not a
  // secret worth protecting, so compare it first and bail plainly.
  if (expected.length !== received.length) return "unauthorized";

  return timingSafeEqual(expected, received) ? "ok" : "unauthorized";
}
```

- [ ] **Step 4: Verify the whole suite still passes**

Run: `npx vitest run src/lib/cron-auth.test.ts && npm run typecheck`
Expected: PASS — all six cases, including the four that predate this task.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cron-auth.ts src/lib/cron-auth.test.ts changelog.md
git commit -m "fix(security): compare cron secret in constant time"
```

---

## Task 5: SQL assertions for the task atomic commands (P3)

The weekend added eight task-side atomic commands. Only enrollment has a SQL assertion file. Finding
2 was precisely the class of bug one assertion catches, which is the argument for this task: the
commands are the commit boundary for comments, attachments, activity, and task creation, and none of
them has a test that runs against a real database.

**Files:**
- Modify: `supabase/rollouts/2026-08-10-task-atomic-commands-test.sql` (extend Task 2's file)

**Interfaces:**
- Consumes: the file created in Task 2, and the commands
  `create_task_comment_atomic(uuid, text, text, uuid, uuid, text[])`,
  `edit_task_comment_atomic(uuid, uuid, text, text, timestamptz, text[])`,
  `delete_task_comment_atomic(uuid, uuid, text)`,
  `mark_task_overdue_atomic(uuid, timestamptz, integer)`.

- [ ] **Step 1: Add idempotency and atomicity assertions**

Insert the four blocks below immediately before the closing `end $$;` of the existing `do $$` block
in `supabase/rollouts/2026-08-10-task-atomic-commands-test.sql`. Each is a **nested plpgsql block**
with its own `declare` — do not hoist these variables into the outer block's declaration, and do
not rename `fixture_task_id`: a variable called `task_id` collides with the column of that name on
`task_activity`, and plpgsql raises `column reference "task_id" is ambiguous`.

```sql
  -- CASE6: replaying a client_request_id returns the original comment and
  -- writes no second activity row. This is the guarantee that makes a retry
  -- after an ambiguous response safe.
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
  -- Deduplicating on body text would silently swallow real user intent.
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
Expected: PASS — all nine cases, silent completion, full rollback.

If CASE6 or CASE9 fails, that is a genuine defect in the corresponding command, not a test bug.
Stop and report it rather than adjusting the assertion to match the behaviour.

- [ ] **Step 3: Document how to run it**

Add one line to `changelog.md` recording the file and its invocation, so the next person does not
have to rediscover the `SCRATCH_DATABASE_URL` convention:

```text
psql "$SCRATCH_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/rollouts/2026-08-10-task-atomic-commands-test.sql
```

- [ ] **Step 4: Commit**

```bash
git add supabase/rollouts/2026-08-10-task-atomic-commands-test.sql changelog.md
git commit -m "test(tasks): assert atomic command idempotency and conflict handling"
```

---

## Deliberately not in this plan

The review's "Recommended follow-up" section lists two items this plan does **not** address. Stating
why, so they are deferred rather than silently dropped.

**A metric separating genuine 409s from token-churn 409s** (review follow-up 7). The cross-commit
analysis is right that version churn increased from three directions at once — comment creation and
standalone attachment upload both now touch the parent task, on top of the trigger — so the 409 rate
will stay elevated even after Task 2. Instrumenting it is the correct response.

It is not in this plan because **this repository has no telemetry or metrics infrastructure.** I
checked: no Sentry, PostHog, Datadog, OpenTelemetry, or `@vercel/analytics` dependency; the
`metrics`-named modules under `src/lib/enrollment/` are business dashboards, not observability.
There are 24 `status: 409` sites across the API. Adding a metric therefore means choosing and wiring
a telemetry vendor — a separate project with its own cost, access, and retention decisions, not a
step inside a P1 remediation.

**Latency baselines for the drawer-open path** (review follow-up 8). Commit `d3f4052` serialized
authorization ahead of the privileged detail load, trading one network wave for correctness. The
trade is right; the cost is unmeasured. Measuring it needs production traffic and the same missing
instrumentation. Deferred with the same reasoning — and the review recorded the latency rows as
**UNKNOWN** rather than asserting they are fine, which remains the honest position.

Neither item blocks the P1 fixes. Both should get an owner before the next release that touches
concurrency.

## Acceptance criteria

- A `tasks` update that does not name `updated_at` leaves the column unchanged; a write supplying an
  older or identical timestamp is still clamped forward.
- Holding a concurrency token across a full `/api/cron/check-overdue` pass and then PATCHing the task
  succeeds.
- Every SECURITY DEFINER function in `public` is executable by `service_role` only, in production and
  in any environment provisioned from `schema.sql`.
- Appending a SECURITY DEFINER function without a `revoke`/`grant` pair fails the next schema apply
  with a named function list.
- The cron secret comparison is constant-time and still returns `unauthorized` — never a 500 — for
  short, long, and prefix-matching tokens.
- `supabase/rollouts/2026-08-10-task-atomic-commands-test.sql` passes all nine cases on a scratch
  database.
- `npx vitest run && npm run typecheck && npm run lint && npm run build` all pass.

## Execution Log

| Task | Sev | Status | Commit | Verification | Notes |
|---|---|---|---|---|---|
| 1. Production ACL audit | **P1** | Pending | — | — | Read-only. Record which branch applied |
| 2. Fix monotonic trigger | **P1** | Pending | — | — | CASE1 must fail before the fix |
| 3. Structural ACL invariant | **P1** | Pending | — | — | Canary must fail the second apply |
| 4. Constant-time cron compare | P3 | Pending | — | — | — |
| 5. Atomic command assertions | P3 | Pending | — | — | A CASE6/CASE9 failure is a real defect |
