# Enrollment ACA — Per-Person Stage Timing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Answer "on this stage, how long does each person actually take" — the fairest performance measure available, because it compares people only within the same stage — by attributing completed stage cycles to the person responsible for them.

**Architecture:** Two new columns on `enrollment_stage_cycles` record who was responsible when the cycle opened and when it closed. Per-person statistics use only cycles where those agree, so a record handed over mid-stage is excluded rather than charged to whoever happened to hold it at the end. Stage-level dwell statistics are unaffected, because no cycle is split. The matrix gains a mode toggle: current occupancy (today's behaviour) or historical speed (this).

**Tech Stack:** Supabase `plpgsql`, TypeScript, Vitest (node), React client components.

**Depends on:** the data-layer and UI plans complete.

**Spec:** `docs/superpowers/specs/2026-08-13-enrollment-aca-overview-design.md` §7.4 layer 3, §9.1, F3

## Global Constraints

- **Do not split cycles on handover.** The obvious design — close the cycle and open a new one when the responsible person changes — would silently corrupt the stage-level dwell metric that already ships: a stage that genuinely takes 10 days would report two 5-day cycles, and "Slowest stage" would understate every stage that ever changes hands. The attribution problem is solved by recording *both* endpoints and excluding the ambiguous cycles, not by cutting the data.
- **No historical backfill is possible, and none should be faked.** `enrollment_stage_cycles` has never carried the responsible person (spec F3), and the record's *current* responsible says nothing about who held it during a cycle that closed in June. Leave pre-existing rows NULL, exclude them, and **show the coverage** so nobody reads a thin sample as the whole picture.
- **The n ≥ 10 rule applies here.** These are historical measured samples — exactly what `MIN_DURATION_SAMPLE` (`src/lib/enrollment/stage-time.ts:19`) was written for. Below the floor, render "Not enough samples", never a median over three rows. (This is the opposite of the current-occupancy medians in the shipped matrix, which are directly observed and are not suppressed.)
- **Medians, never means.**
- ACA only. Run `npx tsc --noEmit` before every commit.

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `supabase/rollouts/2026-08-13-aca-person-stage-timing.sql` | Columns + RPC maintenance |
| `supabase/rollouts/2026-08-13-aca-person-stage-timing-test.sql` | Disposable assertions |
| `src/lib/enrollment/aca-person-stage-timing.ts` | Aggregation |
| `src/lib/enrollment/aca-person-stage-timing.test.ts` | Its tests |

**Modified:**

| File | Change |
|---|---|
| `src/lib/enrollment/aca-overview-types.ts` | `personStageTiming` on the snapshot |
| `src/lib/enrollment/aca-overview-data.ts` | Fetch attributed cycles |
| `src/lib/enrollment/aca-overview.ts` | Compose it in |
| `src/app/(authed)/enrollment/_components/aca/AcaMatrix.tsx` | Mode toggle |

---

## Task 1: Record responsibility on both ends of a cycle

**Files:**
- Create: `supabase/rollouts/2026-08-13-aca-person-stage-timing.sql`
- Create: `supabase/rollouts/2026-08-13-aca-person-stage-timing-test.sql`

**Interfaces:**
- Produces: `enrollment_stage_cycles.responsible_start_email`, `.responsible_end_email`

- [ ] **Step 1: Write the columns**

```sql
-- Who was responsible when this cycle opened, and when it closed. Per-person
-- statistics use only the cycles where the two agree; a record handed over
-- mid-stage is ambiguous and is excluded rather than charged to whoever
-- happened to hold it at the end.
--
-- Deliberately NOT implemented by splitting the cycle on handover: that would
-- halve the durations behind the stage-level dwell metric that already ships,
-- making every stage that changes hands look faster than it is.
alter table enrollment_stage_cycles
  add column if not exists responsible_start_email text,
  add column if not exists responsible_end_email text;

create index if not exists enrollment_stage_cycles_attributed_idx
  on enrollment_stage_cycles (stage_id, responsible_start_email, ended_at desc)
  where kind = 'dwell'
    and source = 'live'
    and ended_at is not null
    and responsible_start_email is not null
    and responsible_start_email = responsible_end_email;
```

No backfill statement. Pre-existing rows stay NULL by design — see the constraint above.

- [ ] **Step 2: Stamp the opening end in `patch_enrollment_atomic` and `create_enrollment_atomic`**

Copy each function from its current rollout file and edit, as in the data-layer plan's Task 10.

In `patch_enrollment_atomic`, the two `insert into enrollment_stage_cycles` statements (the `dwell` and the `entry_marker` branch) each gain a column and a value:

```sql
          responsible_start_email
```
```sql
          enrollment_norm_email(next_record.responsible_enroll_email)
```

In `create_enrollment_atomic`, both inserts gain the same pair, using `new_record.responsible_enroll_email`.

- [ ] **Step 3: Stamp the closing end in `enrollment_close_open_cycle_internal`**

That function already takes the actor and the moment. Add a parameter for the responsible person rather than re-reading the record inside it, so the caller's already-computed value is used:

```sql
create or replace function enrollment_close_open_cycle_internal(
  p_record_id uuid,
  p_actor_email text,
  p_moment timestamptz,
  p_to_stage_id uuid,
  p_responsible_email text default null
)
```

and in its `update` list:

```sql
      responsible_end_email = enrollment_norm_email(p_responsible_email),
```

Update all three call sites — in `patch_enrollment_atomic` and `archive_enrollment_atomic` — to pass the responsible person. In `patch_enrollment_atomic` pass `target_record.responsible_enroll_email`, **not** `next_record`: the cycle being closed was held under the *old* responsibility, and passing the new one would make every handover look unambiguous and attribute the whole dwell to the incoming person — the exact error this design exists to avoid.

- [ ] **Step 4: Re-apply the grants**

Re-run the grant block from `2026-08-09-enrollment-stage-time-schema.sql:478-494` for every function re-created here.

- [ ] **Step 5: Write the assertions**

```sql
do $$
declare
  target uuid;
  stage_a uuid;
  stage_b uuid;
  closed record;
begin
  select r.id, r.stage_id into target, stage_a
  from enrollment_records r
  where r.program = 'aca' and r.archived_at is null and r.closed_at is null
    and r.responsible_enroll_email is not null
  limit 1;
  if target is null then
    raise notice 'no open assigned ACA record; skipping';
    return;
  end if;

  select o.id into stage_b
  from enrollment_options o
  join enrollment_option_sets s on s.id = o.set_id
  where s.key = 'stage' and s.program = 'aca' and o.id <> stage_a
    and not o.is_terminal
  limit 1;

  perform patch_enrollment_atomic(
    target,
    (select updated_at from enrollment_records where id = target),
    jsonb_build_object('stage_id', stage_b),
    'timing-probe@example.com'
  );

  select responsible_start_email, responsible_end_email into closed
  from enrollment_stage_cycles
  where record_id = target and ended_at is not null
  order by ended_at desc limit 1;

  if closed.responsible_end_email is null then
    raise exception 'closing a cycle did not stamp responsible_end_email';
  end if;

  -- Move it back so the probe leaves no trace beyond two extra cycle rows.
  perform patch_enrollment_atomic(
    target,
    (select updated_at from enrollment_records where id = target),
    jsonb_build_object('stage_id', stage_a),
    'timing-probe@example.com'
  );
end $$;
```

- [ ] **Step 6: Run the rollout and assertions**

Run both files. Expected: no output, or the skip notice.

- [ ] **Step 7: Commit**

```bash
git add supabase/rollouts/2026-08-13-aca-person-stage-timing.sql supabase/rollouts/2026-08-13-aca-person-stage-timing-test.sql
git commit -m "feat(enrollment): attribute stage cycles to the responsible person"
```

---

## Task 2: Aggregation

**Files:**
- Create: `src/lib/enrollment/aca-person-stage-timing.ts`
- Test: `src/lib/enrollment/aca-person-stage-timing.test.ts`

**Interfaces:**
- Consumes: `summarizeDurations`, `MIN_DURATION_SAMPLE` from `./stage-time`
- Produces: `summarizePersonStageTiming(rows, stageIds, emails)`, and the `AcaPersonStageTiming` type

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { summarizePersonStageTiming } from "./aca-person-stage-timing";

const DAY = 86_400;

function rows(email: string, stageId: string, count: number, seconds: number) {
  return Array.from({ length: count }, () => ({
    stage_id: stageId,
    responsible_start_email: email,
    duration_seconds: seconds,
  }));
}

describe("summarizePersonStageTiming", () => {
  it("reports a median once the sample reaches the floor", () => {
    const result = summarizePersonStageTiming(
      rows("a@x.com", "s1", 10, 2 * DAY),
      ["s1"],
      ["a@x.com"]
    );
    expect(result.cells["a@x.com"]["s1"].medianDays).toBe(2);
    expect(result.cells["a@x.com"]["s1"].sampleSize).toBe(10);
  });

  it("suppresses the median below the floor but still reports the sample size", () => {
    const result = summarizePersonStageTiming(
      rows("a@x.com", "s1", 3, 2 * DAY),
      ["s1"],
      ["a@x.com"]
    );
    expect(result.cells["a@x.com"]["s1"].medianDays).toBeNull();
    expect(result.cells["a@x.com"]["s1"].sampleSize).toBe(3);
  });

  it("gives every requested person and stage a cell, so the grid is never ragged", () => {
    const result = summarizePersonStageTiming([], ["s1", "s2"], ["a@x.com", "b@x.com"]);
    expect(Object.keys(result.cells)).toEqual(["a@x.com", "b@x.com"]);
    expect(Object.keys(result.cells["a@x.com"])).toEqual(["s1", "s2"]);
    expect(result.cells["a@x.com"]["s1"].sampleSize).toBe(0);
  });

  it("computes a stage baseline across everyone, for comparison within the column", () => {
    const result = summarizePersonStageTiming(
      [...rows("a@x.com", "s1", 5, 2 * DAY), ...rows("b@x.com", "s1", 5, 4 * DAY)],
      ["s1"],
      ["a@x.com", "b@x.com"]
    );
    expect(result.stageBaseline["s1"].sampleSize).toBe(10);
    expect(result.stageBaseline["s1"].medianDays).toBe(3);
  });

  it("ignores rows for people or stages that were not requested", () => {
    const result = summarizePersonStageTiming(
      rows("ghost@x.com", "s9", 20, DAY),
      ["s1"],
      ["a@x.com"]
    );
    expect(result.stageBaseline["s1"].sampleSize).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/enrollment/aca-person-stage-timing.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
import { summarizeDurations } from "./stage-time";

const SECONDS_PER_DAY = 86_400;

export type AttributedCycleRow = {
  stage_id: string;
  responsible_start_email: string | null;
  duration_seconds: number | null;
};

export type PersonStageCell = {
  sampleSize: number;
  /** Null below the sample floor — a median over three rows is noise, not a fact. */
  medianDays: number | null;
};

export type AcaPersonStageTiming = {
  cells: Record<string, Record<string, PersonStageCell>>;
  stageBaseline: Record<string, PersonStageCell>;
};

function toCell(durations: number[]): PersonStageCell {
  const summary = summarizeDurations(durations);
  return {
    sampleSize: summary.sampleSize,
    medianDays:
      summary.measured && summary.medianSeconds !== null
        ? Math.round((summary.medianSeconds / SECONDS_PER_DAY) * 10) / 10
        : null,
  };
}

export function summarizePersonStageTiming(
  rows: readonly AttributedCycleRow[],
  stageIds: readonly string[],
  emails: readonly string[]
): AcaPersonStageTiming {
  const stageSet = new Set(stageIds);
  const emailSet = new Set(emails);

  const byPerson = new Map<string, Map<string, number[]>>();
  const byStage = new Map<string, number[]>();

  for (const row of rows) {
    const email = row.responsible_start_email;
    if (!email || !emailSet.has(email)) continue;
    if (!stageSet.has(row.stage_id)) continue;
    if (row.duration_seconds === null) continue;
    const seconds = Math.max(0, row.duration_seconds);

    const stages = byPerson.get(email) ?? new Map<string, number[]>();
    stages.set(row.stage_id, [...(stages.get(row.stage_id) ?? []), seconds]);
    byPerson.set(email, stages);

    byStage.set(row.stage_id, [...(byStage.get(row.stage_id) ?? []), seconds]);
  }

  const cells: AcaPersonStageTiming["cells"] = {};
  for (const email of emails) {
    cells[email] = {};
    for (const stageId of stageIds) {
      cells[email][stageId] = toCell(byPerson.get(email)?.get(stageId) ?? []);
    }
  }

  const stageBaseline: AcaPersonStageTiming["stageBaseline"] = {};
  for (const stageId of stageIds) {
    stageBaseline[stageId] = toCell(byStage.get(stageId) ?? []);
  }

  return { cells, stageBaseline };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/enrollment/aca-person-stage-timing.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/enrollment/aca-person-stage-timing.ts src/lib/enrollment/aca-person-stage-timing.test.ts
git commit -m "feat(enrollment): aggregate per-person stage timing"
```

---

## Task 3: Fetch and compose

**Files:**
- Modify: `src/lib/enrollment/aca-overview-data.ts`
- Modify: `src/lib/enrollment/aca-overview-types.ts`
- Modify: `src/lib/enrollment/aca-overview.ts`

- [ ] **Step 1: Add the fetch**

Append to `aca-overview-data.ts`, following the chunk-and-page shape already used by `fetchStageDwellMedians`:

```ts
/**
 * Only unambiguous cycles: same responsible person at both ends. A record handed
 * over mid-stage tells us nothing reliable about either person's speed, so it is
 * excluded rather than charged to the one holding it when the cycle closed.
 */
export async function fetchAttributedCycles(
  recordIds: readonly string[]
): Promise<AttributedCycleRow[]> {
  const supabase = getSupabaseAdmin();
  const rows: AttributedCycleRow[] = [];
  const CHUNK = 500;

  for (let start = 0; start < recordIds.length; start += CHUNK) {
    const ids = recordIds.slice(start, start + CHUNK);
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const result = await supabase
        .from("enrollment_stage_cycles")
        .select("stage_id,responsible_start_email,responsible_end_email,duration_seconds")
        .in("record_id", ids)
        .eq("program", "aca")
        .eq("kind", "dwell")
        .eq("source", "live")
        .not("ended_at", "is", null)
        .not("responsible_start_email", "is", null)
        .range(offset, offset + PAGE_SIZE - 1);
      if (result.error) throw new Error(result.error.message);
      const page = (result.data ?? []) as (AttributedCycleRow & {
        responsible_end_email: string | null;
      })[];
      // PostgREST cannot compare two columns in a filter, so the equality test
      // happens here. The partial index still covers the rest of the predicate.
      rows.push(
        ...page.filter((row) => row.responsible_start_email === row.responsible_end_email)
      );
      if (page.length < PAGE_SIZE) break;
    }
  }
  return rows;
}
```

- [ ] **Step 2: Add it to the input and snapshot**

`AcaOverviewInput` gains `attributedCycles: readonly AttributedCycleRow[]`; `AcaOverviewSnapshot` gains `personStageTiming: AcaPersonStageTiming`.

In `aca-overview.ts`:

```ts
    personStageTiming: summarizePersonStageTiming(
      input.attributedCycles,
      buildMatrix(input).stageIds,
      input.people.filter((person) => person.canWork).map((person) => person.email)
    ),
```

**Do not call `buildMatrix` twice.** Hoist its result into a local and pass `matrix.stageIds` to both, or the aggregation runs the whole matrix computation a second time on every request.

- [ ] **Step 3: Verify**

Run: `npx vitest run src/lib/enrollment/ && npx tsc --noEmit`
Expected: PASS. Add `attributedCycles: []` to every existing `AcaOverviewInput` fixture.

- [ ] **Step 4: Commit**

```bash
git add src/lib/enrollment/aca-overview-data.ts src/lib/enrollment/aca-overview-types.ts src/lib/enrollment/aca-overview.ts src/lib/enrollment/*.test.ts
git commit -m "feat(enrollment): expose per-person stage timing in the ACA snapshot"
```

---

## Task 4: Matrix mode toggle

**Files:**
- Modify: `src/app/(authed)/enrollment/_components/aca/AcaMatrix.tsx`

- [ ] **Step 1: Add the toggle**

Two modes over the same grid:

- **Now** (default, unchanged): `Tasks · Stuck · Silent` per stage — who is holding what right now.
- **Speed**: one column per stage showing the person's median completed dwell, with the stage baseline in the `Total` row and "—" plus a sample count where the floor is not met.

```tsx
const [mode, setMode] = useState<"now" | "speed">("now");
```

In **Speed** mode the grid template is `matrixGridTemplate` with one column per stage rather than three — extract a `matrixGridTemplateSingle(stageCount)` alongside the existing helper rather than special-casing inline, and give it its own test.

Each speed cell:

```tsx
<div className="px-2 py-1.5 text-right">
  {cell.medianDays === null ? (
    <span className="text-[#8993a4]" title={`${cell.sampleSize} completed cycles — below the reporting floor`}>
      —
    </span>
  ) : (
    <span className="font-bold text-[#172b4d]">{formatDays(cell.medianDays)}</span>
  )}
</div>
```

- [ ] **Step 2: Add the coverage caption**

Mandatory, directly under the table in Speed mode:

```tsx
<p className="border-t border-[#ebecf0] px-4 py-2 text-[11px] font-medium text-[#6b778c]">
  Measured from completed stage cycles where one person held the record throughout.
  Records handed over mid-stage are excluded, and no data exists before this feature
  shipped — a person with few cycles shows “—”, not a fast time.
</p>
```

Without it, an empty row reads as "this person is slow" when it means "we have not measured them yet" — and that misreading is the whole risk of the feature.

- [ ] **Step 3: Verify the build**

Run: `npx tsc --noEmit` then `npx vitest run` then `npm run build`
Expected: PASS.

- [ ] **Step 4: See it running**

Switch the matrix to Speed mode on the ACA overview. Immediately after shipping, every cell should read "—" with a zero sample count — that is correct, not a bug, and confirms nothing is being fabricated from the backfill.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(authed)/enrollment/_components/aca/AcaMatrix.tsx" src/lib/enrollment/aca-overview-matrix-layout.ts src/lib/enrollment/aca-overview-matrix-layout.test.ts
git commit -m "feat(enrollment): add speed mode to the ACA person-stage matrix"
```

---

## Task 5: Changelog

- [ ] **Step 1: Append**

```markdown
## 2026-08-13 — ACA per-person stage timing

- `enrollment_stage_cycles` now records who was responsible when a cycle opened
  and when it closed. Per-person statistics use only the cycles where the two
  agree, so a record handed over mid-stage is excluded rather than charged to
  whoever held it at the end.
- Cycles are deliberately NOT split on handover: splitting would halve the
  durations behind the existing stage-level dwell metric and make every stage
  that changes hands look faster than it is.
- No backfill. The responsible person was never recorded on cycles before now,
  and the record's current owner says nothing about who held it during a cycle
  that closed months ago. Pre-existing rows stay null and are excluded.
- The person × stage matrix gained a Speed mode showing each person's median
  completed dwell per stage, suppressed below the existing 10-sample floor and
  captioned so an unmeasured person is not read as a fast one.
```

- [ ] **Step 2: Commit**

```bash
git add changelog.md
git commit -m "docs: record ACA per-person stage timing"
```

---

## Not planned, and why

**Medicare.** It has no design document. Its field set, roles and stage vocabulary differ enough that planning it from the ACA spec would produce the parameterised component the ACA design explicitly rejected. It needs its own design session first.

## Codex implementation notes (2026-08-13)

- Responsibility attribution is added to the canonical stage-time function
  definitions in `supabase/schema.sql` as well as the deployable rollout, so a
  fresh bootstrap and an incremental deployment have the same behaviour.
- The implementation verifies the real function signatures and passes the
  pre-transition responsible value when closing a cycle; this is required to
  exclude handovers instead of charging a whole cycle to the incoming person.
