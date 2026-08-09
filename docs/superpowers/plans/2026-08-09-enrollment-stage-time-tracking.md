# Enrollment Stage-Time Tracking Implementation Plan

> Status: **REVISED AFTER ADVERSARIAL REVIEW — PLAN ONLY, NOT IMPLEMENTED**
>
> Last validated: 2026-08-09 against the current `agent-portal` repository
>
> Execution rule: implement task-by-task, one focused commit per task, and record the commit ID in this file/changelog.

## Goal

Give ACA and Medicare Enrollment reliable data for:

- time spent in the current configurable stage;
- one durable row per visit to every stage;
- median/p75 stage duration without per-stage schema columns;
- the most recent **human** activity and actor;
- scoped overview metrics that cannot mix another agent's data.

This plan is measurement only. It does **not** add SLA thresholds, overdue behavior, reminders, notifications, or per-stage columns.

## Corrected architecture

`enrollment_records` receives four denormalized fields used by list/detail/overview reads:

- `stage_entered_at timestamptz`;
- `stage_entered_source text` (`live`, `history_backfill`, or `record_created`);
- `last_activity_at timestamptz`;
- `last_activity_by_email text`.

`enrollment_stage_cycles` stores one row per visit. It includes `agent_email` as an attribution snapshot and `source` (`live` or `backfill`). A transfer while a record is active closes the old owner's cycle and opens a same-stage cycle for the new owner without resetting `stage_entered_at`.

Three trigger definitions are required:

1. `BEFORE INSERT OR UPDATE` on `enrollment_records`: prepare denormalized stage state and maintain cycles for updates.
2. `AFTER INSERT` on `enrollment_records`: create the initial cycle only after the parent row exists.
3. `AFTER INSERT` on `enrollment_activity`: advance last-human-activity fields monotonically.

The first two may share helper functions, but they must remain different trigger timings. A single `BEFORE INSERT` trigger cannot safely insert a child cycle that has a foreign key to the parent row being inserted.

## Non-negotiable constraints

- No stage label, ordinal, or program-specific stage is hardcoded. All stage behavior is keyed by `enrollment_options.id`.
- Schema is applied before application code reads the new columns.
- Trigger time uses `clock_timestamp()`, not `now()`/`transaction_timestamp()`.
- A close time is always `greatest(clock_timestamp(), started_at)`.
- Terminal stage entry updates `stage_entered_at` and creates a closed terminal visit; it must not return early after closing the previous cycle.
- Backfill is distinguishable from live measurement and is rerunnable only inside the guarded pre-live rollout window.
- `updated_at` remains the optimistic-concurrency token. The last-activity trigger must never move it.
- System cron activity (`actor_email = 'system'`) is not a human touch.
- `agent_email` on a cycle is analytics attribution, not the only authorization boundary. Restricted metrics must begin with records allowed by `resolveEnrollmentScope`.
- SQL trigger behavior is tested against a scratch database. Vitest/node cannot execute PostgreSQL triggers.

---

## Review validation ledger

### Claude findings incorporated

| Finding | Validation against current repo | Required plan change |
|---|---|---|
| `now()` can precede Node-written `created_at` | **Confirmed.** Create/PATCH routes use `new Date().toISOString()` while the old trigger used transaction time. | Use `clock_timestamp()` and close with `greatest(moment, started_at)`; assert rapid create/change. |
| Terminal branch returned before updating stage entry | **Confirmed BLOCKER.** `src/app/api/enrollment/[id]/route.ts` writes `stage_id` and terminal `closed_at` in the same PATCH. | Unified close → record new visit → update denormalized state flow; no early terminal return. |
| Missing-column fallback fails silently | **Confirmed BLOCKER.** Both fallback predicates in `src/lib/enrollment/queries.ts` currently accept every `42703`. | Make fallback predicates column-specific and make missing tracking columns return `SCHEMA_OUT_OF_DATE`. |
| `on conflict do nothing` made backfill idempotency false | **Confirmed.** The conflict target is a partial index for open cycles; historical closed rows never conflict. | Delete only `source='backfill'` rows inside a guarded transaction, then reconstruct them. |
| Window function in `WHERE` | **Confirmed.** `lead(...)` cannot be used directly in the same SELECT's `WHERE`. | Compute window values in a CTE/subquery and filter in the outer query. |
| First visit omitted | **Confirmed.** Transition rows only describe `from → to`; the old insert began at `to_option_id`. | Reconstruct `created_at → first changed_at` from the first row's `from_option_id`. |
| Cycles lacked agent attribution/scope | **Confirmed.** Enrollment scope is based on `enrollment_records.agent_email`. | Add cycle `agent_email`, split active cycles on owner transfer, and scope reads through allowed record IDs. |
| Cron `system` activity polluted last activity | **Confirmed.** `check-enrollment-due` writes `due_soon` and `went_overdue` activity with `actor_email: "system"`; the file contains additional system notification/update actors. | Ignore system actors in trigger and backfill. Do not filter only by activity type because human `qc_needed` is legitimate. |
| `updated_at` should mirror CS | **Claude's conclusion retained; causal wording corrected by Codex.** CS behavior is route-specific. Enrollment PATCH commits the canonical update, awaits activity, then normally refetches before responding. | Keep `updated_at` untouched. An activity trigger would create a second version change outside the optimistic PATCH; a failed canonical refetch/fallback response or a competing client can then retain the earlier token and receive a false 409. It is not correct to claim every normal next edit always 409s. |
| `tasks.last_activity_by_email` exists | **Corrected.** It is not a `tasks` column; CS derives it through `task_list_metadata` in `supabase/schema.sql`. | Remove the false parity claim; Enrollment deliberately stores its own denormalized actor. |
| SECURITY DEFINER ACL is an unresolved repo finding | **Corrected.** `supabase/schema.sql` already loops over public security-definer routines and revokes `public/anon/authenticated`. | Keep explicit revokes for new routines as defense in depth, but do not call the repo globally vulnerable. |

### Codex validation and additional comments

1. **New BLOCKER — child insert from `BEFORE INSERT`:** the old plan inserted `enrollment_stage_cycles` before the parent `enrollment_records` row existed. With an immediate foreign key this is not a safe design. Initial cycle creation moves to `AFTER INSERT`; the `BEFORE` trigger only mutates `NEW` on insert.
2. **Permission must not trust cycle ownership alone:** `agent_email` is a snapshot. A record can later transfer. Overview code must first resolve/fetch scoped `enrollment_records`, then query cycles only for those record IDs. Cycle email is used for attribution and aggregate segmentation, not direct-record authorization.
3. **Ownership changes need a cycle boundary:** otherwise an open cycle keeps the old agent forever. Close/open the same stage on `agent_email` change, but preserve `stage_entered_at` because the stage itself did not change.
4. **Last activity must be monotonic:** a delayed or backdated activity insert must not overwrite a newer touch. Update the parent only when `NEW.created_at >= last_activity_at`.
5. **`stage_id` in the cycle should be `NOT NULL`:** a cycle is created only for an actual stage. Only `from_stage_id` needs to be nullable for the first visit.
6. **Terminal visits need an explicit representation:** insert a zero-duration closed cycle at terminal entry. This records the visit without letting completed records accrue forever.
7. **Backfill and trigger installation require a short enrollment write pause:** otherwise a record can transition between history measurement, seed creation, and trigger activation. The rollout must not pretend SQL idempotency solves concurrent writes.
8. **The supplied context names 19 adversarial findings but only provides details for #1–8, #11, and #18.** This revision incorporates and validates every concrete finding supplied. Before marking implementation complete, rerun the full adversarial review and append/close the nine findings whose text is absent; do not claim “19/19 closed” from this document alone.

### Confirmed design decisions retained

- Per-stage columns remain rejected because stages are configurable.
- Live measurements and inferred/backfilled measurements remain separate.
- `expected_updated_at` still prevents two concurrent PATCH stage changes: PostgreSQL rechecks the optimistic `WHERE updated_at = expected` qualifier before firing the row trigger for the winning update.

---

## Task 1 — Base schema, constraints, indexes, and RLS

**Files**

- Modify `supabase/schema.sql`.
- Create `supabase/rollouts/2026-08-09-enrollment-stage-time-schema.sql`.

### Steps

- [ ] Add the four denormalized columns:

```sql
alter table enrollment_records
  add column if not exists stage_entered_at timestamptz,
  add column if not exists stage_entered_source text,
  add column if not exists last_activity_at timestamptz,
  add column if not exists last_activity_by_email text;
```

- [ ] Add idempotent constraints. `stage_entered_source` allows only `live`, `history_backfill`, and `record_created`. Require timestamp/source to be both null or both non-null.

```sql
alter table enrollment_records
  drop constraint if exists enrollment_records_stage_entered_source_check;
alter table enrollment_records
  add constraint enrollment_records_stage_entered_source_check
  check (
    stage_entered_source is null or
    stage_entered_source in ('live', 'history_backfill', 'record_created')
  );

alter table enrollment_records
  drop constraint if exists enrollment_records_stage_entered_pair_check;
alter table enrollment_records
  add constraint enrollment_records_stage_entered_pair_check
  check ((stage_entered_at is null) = (stage_entered_source is null));
```

- [ ] Create the cycle table:

```sql
create table if not exists enrollment_stage_cycles (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references enrollment_records(id) on delete cascade,
  stage_id uuid not null references enrollment_options(id) on delete restrict,
  from_stage_id uuid references enrollment_options(id) on delete restrict,
  agent_email text,
  started_at timestamptz not null,
  ended_at timestamptz,
  duration_seconds integer,
  started_by_email text,
  ended_by_email text,
  source text not null default 'live'
    check (source in ('live', 'backfill')),
  created_at timestamptz not null default clock_timestamp(),
  check (ended_at is null or ended_at >= started_at),
  check (duration_seconds is null or duration_seconds >= 0),
  check (
    (ended_at is null and duration_seconds is null) or
    (ended_at is not null and duration_seconds is not null)
  )
);
```

- [ ] Normalize cycle ownership at write time with `nullif(lower(btrim(email)), '')`. Do not rewrite historical `enrollment_records.agent_email` in this plan.

- [ ] Add only indexes with a defined consumer:

```sql
create unique index if not exists enrollment_stage_cycles_open_idx
  on enrollment_stage_cycles (record_id)
  where ended_at is null;

create index if not exists enrollment_stage_cycles_record_started_idx
  on enrollment_stage_cycles (record_id, started_at desc);

create index if not exists enrollment_stage_cycles_stage_started_idx
  on enrollment_stage_cycles (stage_id, started_at desc);

create index if not exists enrollment_stage_cycles_agent_started_idx
  on enrollment_stage_cycles (agent_email, started_at desc);

create index if not exists enrollment_records_stage_entered_idx
  on enrollment_records (program, archived_at, stage_entered_at);

create index if not exists enrollment_records_last_activity_idx
  on enrollment_records (program, archived_at, last_activity_at);
```

- [ ] Add `enrollment_stage_cycles` to the existing `protected_tables` RLS loop. Confirm `relrowsecurity = true`.

- [ ] Add explicit `revoke all ... from public, anon, authenticated` and `grant execute ... to service_role` for each new security-definer function. This supplements the existing global revoke loop; it does not replace it.

- [ ] Verify columns, constraints, indexes, FK behavior, RLS, and ACLs with SQL catalog queries.

- [ ] Run repository checks and commit: `feat(enrollment): add stage-time tracking schema`.

---

## Task 2 — Stage state and cycle triggers

**Files**

- Modify `supabase/schema.sql`.
- Modify the schema rollout from Task 1.

### Trigger A: `BEFORE INSERT OR UPDATE`

- [ ] Create `enrollment_stage_tracking_prepare()` using `clock_timestamp()`.
- [ ] Resolve whether old/new stages are terminal from `enrollment_options.is_terminal`; do not depend solely on application-maintained `closed_at`.
- [ ] Define inactivity as archived, closed, or terminal.
- [ ] On INSERT:
  - if `stage_id` is null, keep `stage_entered_at/source` null;
  - otherwise set `stage_entered_at = coalesce(NEW.created_at, moment)` and source `live`;
  - initialize missing last-human-activity fields from `created_at/created_by_email`;
  - **do not insert a cycle from this BEFORE branch**.
- [ ] On UPDATE calculate flags before mutating anything: `stage_changed`, `owner_changed`, `was_inactive`, `now_inactive`.
- [ ] Close an open cycle when the stage changes, ownership changes while active, or the record becomes inactive. Closing must use one computed value:

```sql
close_at := greatest(moment, open_cycle.started_at);
duration_seconds := greatest(
  0,
  extract(epoch from (close_at - open_cycle.started_at))::integer
);
```

Do not compute `clock_timestamp()` twice for the same close.

- [ ] Apply the update flow in this exact order, with one `RETURN NEW` at the end:
  1. close the existing open cycle when required;
  2. if the stage changed to a real stage, set `stage_entered_at = moment`, source `live`;
  3. if that new stage is inactive/terminal, insert a **closed zero-duration** live cycle at `moment`;
  4. otherwise insert the new open live cycle;
  5. if the stage changed to null, clear `stage_entered_at/source`;
  6. if a closed/archived record reopens without changing stage, start a new open cycle and reset `stage_entered_at/source` to `moment/live`;
  7. if only `agent_email` changed while active, open a same-stage cycle for the new normalized owner but preserve the original stage entry timestamp/source.

- [ ] If stage and owner change together, create only the new-stage cycle with the new owner.
- [ ] Unrelated updates, including updates made by the activity trigger, must not touch stage cycles.

### Trigger B: `AFTER INSERT`

- [ ] Create `enrollment_stage_cycle_seed_after_insert()`.
- [ ] If the inserted record has no stage, do nothing.
- [ ] If it starts inactive/terminal, insert one closed zero-duration live cycle using `NEW.stage_entered_at` for both endpoints.
- [ ] Otherwise insert one open live cycle.
- [ ] Use the normalized initial `agent_email` snapshot and `from_stage_id = null`.

### Trigger definitions

```sql
drop trigger if exists enrollment_stage_tracking_prepare_trigger
  on enrollment_records;
create trigger enrollment_stage_tracking_prepare_trigger
before insert or update on enrollment_records
for each row execute function enrollment_stage_tracking_prepare();

drop trigger if exists enrollment_stage_cycle_seed_trigger
  on enrollment_records;
create trigger enrollment_stage_cycle_seed_trigger
after insert on enrollment_records
for each row execute function enrollment_stage_cycle_seed_after_insert();
```

- [ ] Verify both functions have fixed `search_path = public`, explicit ACLs, and no callable access for `public/anon/authenticated`.
- [ ] Commit: `feat(enrollment): maintain stage cycles with database triggers`.

> **Claude review applied:** terminal handling is no longer an early-return branch.
>
> **Codex comment:** splitting INSERT timing is required for the parent/child foreign key; do not recombine these triggers to reduce line count.

---

## Task 3 — SQL trigger tests against a scratch database

**File:** create `supabase/rollouts/2026-08-09-enrollment-stage-time-test.sql`.

- [ ] Make fixtures self-contained inside `BEGIN; ... ROLLBACK;`. Create unique option-set/options needed by the test; do not rely on production UUIDs.
- [ ] Assert each case with `RAISE EXCEPTION` on failure:
  1. active insert creates exactly one open cycle and correct live stage source;
  2. insert without a stage creates no cycle and null stage state;
  3. initially terminal insert succeeds despite the FK and creates a closed zero-duration visit;
  4. active → active stage change closes/opens in order;
  5. create with a Node-style future `created_at`, then change stage immediately in the same transaction; no CHECK failure and `ended_at >= started_at`;
  6. active → terminal in one UPDATE that also sets `closed_at`; previous cycle closes, terminal cycle exists, `stage_entered_at` moves;
  7. terminal/closed → active reopen creates one open cycle;
  8. stage clear closes the visit and clears stage state;
  9. archive closes the visit and unrelated later updates do not reopen it;
  10. re-entering a previously visited stage preserves both visits;
  11. two rapid stage changes leave exactly one open cycle;
  12. agent transfer splits the cycle between normalized owners without resetting stage dwell;
  13. stage plus owner change creates only one new cycle;
  14. unrelated field/last-activity update leaves cycle count unchanged.
- [ ] Assert the unique partial index by attempting a second open cycle and expecting a constraint error.
- [ ] Run with `psql "$SCRATCH_DATABASE_URL" -v ON_ERROR_STOP=1 ...`; record actual execution evidence. Typecheck is not evidence for trigger correctness.
- [ ] Commit: `test(enrollment): add stage tracking SQL assertions`.

---

## Task 4 — Guarded, idempotent backfill

**File:** create `supabase/rollouts/2026-08-09-enrollment-stage-time-backfill.sql`.

### Preconditions

- [ ] Pause enrollment creates/edits for the production backfill window.
- [ ] Measure history coverage by program and record the counts in `changelog.md`.
- [ ] Run the entire backfill in one transaction with an advisory lock.
- [ ] Fail if any `source = 'live'` cycle exists. This script is idempotent in the pre-live rollout window, not a repair tool to run after live tracking starts.

### Reconstruction algorithm

- [ ] Delete only `source = 'backfill'` rows. Do not use `ON CONFLICT DO NOTHING` as an idempotency mechanism.
- [ ] Build an `ordered_history` CTE with deterministic order `(changed_at, id)` and compute `row_number`, `lead(changed_at)`, and `lead(changed_by_email)` there.
- [ ] Filter window results only in outer CTEs/queries.
- [ ] Reconstruct the first visit from `enrollment_records.created_at` to the first transition's `changed_at`, using that first row's `from_option_id`.
- [ ] Reconstruct intermediate `to_option_id` visits from `changed_at` to `next_changed_at`.
- [ ] Reconstruct the final current-stage visit as:
  - closed to the inactivity time for closed/archived records; or
  - an open backfill cycle for active records.
- [ ] For records with missing/incomplete history, seed the current visit from `created_at`. Label it `source='backfill'`; never present it as measured live data.
- [ ] Populate backfill cycle `agent_email` from the current record owner and normalize it. Historical ownership is not recoverable from `enrollment_stage_history`, so this is explicitly inferred.
- [ ] Close timestamps use `greatest(candidate_end, started_at)` so corrupted/clock-skewed history cannot violate the CHECK.

### Denormalized current-stage source

- [ ] Set `stage_entered_at/source` for every record with a stage:
  - latest matching transition time + `history_backfill` when trustworthy;
  - otherwise `created_at` + `record_created`.
- [ ] Keep both fields null when `stage_id` is null.
- [ ] Do not clear terminal records' stage entry timestamp.

### Verification

- [ ] Zero records have more than one open cycle.
- [ ] Every active record with a stage has exactly one open cycle.
- [ ] Every inactive/terminal record has no open cycle and has a visit for its current stage.
- [ ] Every staged record has a non-null timestamp and source.
- [ ] Rerun inside the guarded window produces identical counts and durations.
- [ ] Release the write pause only after triggers and smoke checks are complete.
- [ ] Commit: `chore(enrollment): backfill stage visits safely`.

> **Claude review applied:** delete/reinsert replaces the ineffective partial-index conflict clause, the first visit is restored, and all window filtering occurs outside the windowed SELECT.
>
> **Codex comment:** rerunnable does not mean concurrency-safe. The write pause and “no live rows” guard are mandatory.

---

## Task 5 — Last human activity trigger and backfill

**Files:** modify schema/rollout and extend the SQL test file.

- [ ] Create `enrollment_touch_last_activity()` as an `AFTER INSERT` trigger on `enrollment_activity`.
- [ ] Ignore rows whose normalized actor is `system`. Do not exclude `qc_needed` by type because the stage PATCH also writes legitimate human `qc_needed` activity.
- [ ] Update only when the incoming activity is not older than the current value:

```sql
update enrollment_records
set last_activity_at = new.created_at,
    last_activity_by_email = nullif(lower(btrim(new.actor_email)), '')
where id = new.record_id
  and lower(btrim(new.actor_email)) <> 'system'
  and (last_activity_at is null or new.created_at >= last_activity_at);
```

- [ ] Never update `updated_at` or `updated_by_email` in this function.

**Why `updated_at` must remain unchanged:** the Enrollment PATCH commits the record using the client's `expected_updated_at`, then performs an activity insert as a separate database operation and normally refetches before responding. Moving `updated_at` in that activity trigger creates a second version transition that was not protected by the original optimistic predicate. The normal refetch can observe it, so a false 409 is not guaranteed on every request; however, fallback responses after a refetch failure and competing clients can retain the earlier token. Keep last-activity maintenance separate from the concurrency token. CS's `touchLastActivity` behavior is not transferable because CS routes explicitly own/return that parent token in their workflow.

- [ ] Backfill from the latest non-system activity per record using `DISTINCT ON (record_id)` ordered by `created_at DESC, id DESC`.
- [ ] If no human activity exists, fall back to `created_at/created_by_email`, not blindly to `updated_at`: the enrollment cron itself writes `updated_at` with `updated_by_email='system'`.
- [ ] SQL tests:
  - human activity moves last activity and leaves `updated_at` unchanged;
  - an older delayed activity cannot move it backward;
  - system due/overdue activity does not move it;
  - the parent update caused by this trigger creates no stage cycle.
- [ ] Commit: `feat(enrollment): track last human activity`.

---

## Task 6 — Strict query surface, scoped metrics, and pure helpers

**Files**

- Modify `src/lib/enrollment/queries.ts`, `types.ts`, `overview-data.ts`, `overview.ts`, and `overview-types.ts`.
- Create `src/lib/enrollment/stage-time.ts` and `stage-time.test.ts`.

### Fix schema-drift handling before widening columns

- [ ] Make `isMissingEnrollmentDescriptionColumn` return true only when the error identifies `enrollment_records.description`.
- [ ] Make `isMissingEnrollmentCustomValuesColumn` return true only when the error identifies `enrollment_records.custom_values`.
- [ ] Do not treat a bare `42703` or `PGRST204` as proof that either legacy column is missing.
- [ ] Add a tracking-column-specific detector for `stage_entered_at`, `stage_entered_source`, `last_activity_at`, and `last_activity_by_email` that produces a clear `SCHEMA_OUT_OF_DATE`/503. There is no legacy fallback for tracking columns.
- [ ] Unit-test a `42703` naming `stage_entered_at`: description/custom fallbacks must both reject it, and the tracking detector must accept it.

### Types and helpers

- [ ] Widen all canonical/fallback column lists consistently and update `EnrollmentRecord`.
- [ ] Pure helpers must:
  - compute current stage seconds without negatives and cap inactive records at their inactive timestamp;
  - expose `live`, `history_backfill`, and `record_created` rather than guessing source by comparing timestamps;
  - summarize closed visit durations and visit counts;
  - compute median/p75 only at the documented minimum sample size (`n >= 10`);
  - never blend `live` and `backfill` samples without an explicit caller choice.

### Scoped cycle reads

- [ ] Resolve scope and fetch allowed `enrollment_records` first.
- [ ] Query trailing-90-day cycles only for those allowed record IDs, chunking `.in('record_id', ids)` to avoid oversized PostgREST URLs.
- [ ] For an empty restricted scope, issue no cycle query and return empty metrics.
- [ ] Use cycle `agent_email` for attribution breakdowns, not as the sole permission predicate.
- [ ] Keep ACA/Medicare separated by the already-scoped records/stage option sets.
- [ ] Add tests proving that cycles belonging only to an out-of-scope record never enter median/p75 input.

> **Claude review applied:** adding `agent_email` prevents global medians from being attributed indiscriminately.
>
> **Codex correction:** current record scope remains the security boundary because snapshot ownership can differ after transfers.

- [ ] Verify Vitest, typecheck, lint, and a live SQL comparison for one record.
- [ ] Commit: `feat(enrollment): expose scoped stage-time metrics`.

---

## Task 7 — Rollout, regression gate, and documentation

### Scratch first

- [ ] Apply the complete candidate schema to a scratch database.
- [ ] Run the SQL assertions from Task 3.
- [ ] Run the backfill twice in its guarded mode and compare deterministic counts/durations.
- [ ] Run application typecheck, targeted/full Vitest, lint for touched files, and build if the normal repository build is available.

### Production order

1. Enable a short Enrollment write pause.
2. Apply columns/table/indexes/RLS/functions/triggers.
3. Run the guarded backfill before any live stage transition is allowed.
4. Verify open-cycle, terminal-cycle, source, RLS, and ACL invariants.
5. Deploy application reads/helpers.
6. Smoke-test ACA and Medicare.
7. Resume writes.

- [ ] Smoke test active → active, active → terminal, reopen, owner transfer, comment, attachment, cron system activity, and a stale `expected_updated_at` conflict.
- [ ] Confirm the next edit after a PATCH/activity fan-out does not receive a false 409.
- [ ] Confirm restricted workers' medians use only allowed records.
- [ ] Confirm live and inferred values are visually/semantically distinguishable wherever exposed.
- [ ] Rerun the full 19-finding adversarial review. Append the missing raw findings and disposition before declaring complete.

### Rollback

- [ ] Drop/disable all three trigger definitions first.
- [ ] Roll back application reads to the pre-tracking column list.
- [ ] Keep columns/table for forensic recovery; do not destroy collected data during incident response.

### Documentation

- [ ] Update `changelog.md` with schema objects, trigger behavior, coverage numbers, source semantics, scope behavior, SQL evidence, and every commit ID.
- [ ] State explicitly that no SLA/reminder/notification behavior was introduced.
- [ ] Commit: `docs(enrollment): record stage tracking rollout evidence`.

---

## Final go/no-go checklist

Do not mark this plan complete unless all are true:

- [ ] No unresolved BLOCKER/HIGH finding from the complete adversarial review.
- [ ] Immediate create/change and active→terminal SQL cases pass.
- [ ] No cycle has `ended_at < started_at` or negative/null mismatched duration.
- [ ] Exactly one open cycle exists for every active staged record; none for inactive records.
- [ ] Terminal entry moves `stage_entered_at` and creates a closed visit.
- [ ] Backfill includes the first visit and is source-labelled.
- [ ] System automation does not advance last human activity.
- [ ] Human activity never advances `updated_at` through the activity trigger.
- [ ] Missing tracking schema fails with 503 rather than silent legacy fallback.
- [ ] Restricted metrics contain no out-of-scope records.
- [ ] ACA and Medicare smoke tests both pass.
- [ ] Actual SQL/Vitest/typecheck/lint/build evidence is recorded; no test is claimed without execution.

## Final Codex assessment of this revision

The old plan was **not safe to execute** because its terminal branch, timestamp source, fallback detection, backfill SQL/idempotency, scoping, and initial child insert could all produce incorrect data or hard failures. This revision resolves the concrete findings supplied by the user and Claude at the plan level, and adds the missing FK-timing, ownership-transfer, monotonic-activity, and authorization-boundary requirements.

Implementation is still gated on the full text or rerun of the nine adversarial findings not included in the supplied context. That gate prevents this document from falsely claiming that all 19 findings were closed.
