# Enrollment ACA Overview — Design

**Date:** 2026-08-13
**Status:** Design agreed in session; not yet implemented
**Scope:** The Overview tab of `/enrollment` for the **ACA program only**
**Explicitly out of scope:** Medicare. It is a separate program with a different field set and will get its own design pass. Nothing here should be built as a shared/parameterised component in anticipation of it.
**Supersedes for ACA:** `2026-08-09-enrollment-operations-dashboard-design.md`. That document is kept for its verified data facts and its record of what shipped; its tier structure and priority split no longer describe what we are building.

---

## 1. Purpose

Stated by the owner, in order:

> "agent có thể thấy được là tình hình các task đang được vận hành như thế nào. agent làm việc ra sao ai đang nhiều task ai đang ít task để assign task cho hợp lí."

So the dashboard answers three questions:

1. **How is the pipeline running?** — where work piles up, where it moves.
2. **How is each person working?** — who lets work go stale, who pushes it through.
3. **Who should get the next record?** — load balance and turn order.

### 1.1 A deliberate reversal of the previous design

The previous design (2026-08-09) removed the per-person workload table on the grounds that *"who has capacity"* was the CS question and not Enrollment's. **That judgement is now reversed by the owner.** Assignment balance is a primary question for Enrollment, and this design restores it as a first-class section.

This is a decision, not a discovery. It is recorded here so the next reader does not "fix" the dashboard back toward the old spec.

---

## 2. Verified data facts

Every fact below was verified against the working tree on 2026-08-13. These are constraints, not preferences.

**F1 — Current-stage entry time exists and is trustworthy going forward.**
`enrollment_records.stage_entered_at` and `stage_entered_source` were added by `supabase/rollouts/2026-08-09-enrollment-stage-time-schema.sql:6-24`. `stage_entered_source` is constrained to `'live' | 'history_backfill' | 'record_created'`, and a paired-null check guarantees `stage_entered_at` and `stage_entered_source` are either both set or both null.

`patch_enrollment_atomic` sets both to the commit moment whenever the stage changes **or** the record becomes active again (same file, lines 247-254). So the value resets on reopen, not only on stage change — a reopened record correctly starts its stage clock over.

**F2 — Full per-stage dwell history exists in `enrollment_stage_cycles`.**
Defined at `2026-08-09-enrollment-stage-time-schema.sql:36-61`. Columns: `record_id`, `stage_id`, `from_stage_id`, `to_stage_id`, `agent_email`, `program`, `kind`, `started_at`, `ended_at`, `duration_seconds`, `started_by_email`, `ended_by_email`, `source`.

- `kind` is `'dwell'` or `'entry_marker'`; entry markers are zero-duration rows written when a record lands on a stage while already closed.
- `source` is `'live'` or `'backfill'`.
- A partial unique index (`enrollment_stage_cycles_open_idx`) guarantees **at most one open cycle per record**.

**F3 — `enrollment_stage_cycles` does NOT record the responsible person.**
It carries `agent_email`, `started_by_email`, `ended_by_email` — but **not** `responsible_enroll_email`. The owner has confirmed the "worker" being evaluated is **Responsible Enroll**. Any historical per-person stage timing therefore requires a schema change (see §9.1). This is the single largest gap in this design.

**F4 — Historical stage timing only exists from 2026-08-09.**
`fetchStageDwellMetrics` (`src/lib/enrollment/stage-metrics.ts:63-79`) filters to `kind='dwell'`, `source='live'`, `ended_at IS NOT NULL`, within a 90-day lookback. Backfilled rows are excluded by design. Anything older than the rollout has no measured duration.

**F5 — Statistics are already suppressed on thin samples.**
`MIN_DURATION_SAMPLE = 10` in `src/lib/enrollment/stage-time.ts:19`; `summarizeDurations` returns `measured: false` below that. The current UI renders "Not enough samples" (`EnrollmentOverview.tsx:287`). This design keeps that rule everywhere a median is shown.

**F6 — `secondsInCurrentStage()` and `isMeasuredStageTime()` are written but never called.**
`src/lib/enrollment/stage-time.ts:8-17` — referenced only by their own test file. The helpers this design needs mostly already exist; they have simply never been wired to UI.

**F7 — Stage display order comes from the label, not from `position`.**
`compareEnrollmentOptionText` uses `Intl.Collator("en-US", { numeric: true })` over the label (`src/lib/enrollment/options.ts:28-34`). This is why the numeric prefixes (`1-`, `2-`, … `11-`) exist. **Ordering the stage table by `position` would produce the wrong workflow order.**

**F8 — Person changes are logged, with the new values.**
`src/app/api/enrollment/[id]/route.ts:406-409` writes an `enrollment_activity` row of type `people_changed` with `meta = { caller, responsible_enroll }` holding the **new** assignment. This is what makes "last assigned at" derivable — with one gap, see F9.

**F9 — A record created already-assigned produces no `people_changed` row.**
Assignment at creation time is part of the insert, not a person-change event. "Last assigned at" must therefore also consider `enrollment_records.created_at` for records whose `responsible_enroll_email` is that person. Without this, whoever mostly receives brand-new records looks permanently un-assigned and pins to the top of the queue forever.

**F10 — Any edit bumps `last_activity_at`.**
`patch_enrollment_atomic` sets `last_activity_at = greatest(coalesce(last_activity_at, v_now), v_now)` on every patch (`2026-08-09-enrollment-stage-time-schema.sql:283-286`). It is therefore **not** a clean "real work happened" signal — see §4.3.

**F11 — A stage change is itself an activity.**
Because the same statement writes `stage_entered_at` and `last_activity_at`, *days silent* can never exceed *days in stage* for live data. Consequence in §6.2.

**F12 — The date-range control already exists and is already wired to the Overview.**
`DATE_PRESETS` at `src/app/(authed)/tasks/_components/TaskToolbar.tsx:877-886` — `Fixed`, `Today`, `Yesterday`, `This month`, `Last 7 days`, `Last 14 days`, `Last 30 days`, `All dates`. `EnrollmentClient.tsx:1509` already passes an overview-specific `allDatesLabel`, and the selected range is stored per program. **No new picker is needed.**

**F13 — CS already has a fair assignment queue, and it excludes Enrollment.**
`AssignmentQueue` in `src/app/(authed)/tasks/_components/CSWorkloadOverview.tsx:807-944`: a horizontally scrolling strip of numbered cards, sorted by `queueDueAt` then `slaLoadMinutes` then email, with an **Edit queue** toggle grid controlling `queueEnabled` per person. `2026-07-25-cs-fair-assignment-queue-design.md` explicitly scopes Enrollment out. The **visual pattern is reused; the code is not**.

**F14 — `Can't Contact` and `Can not get ID card` are NOT terminal in the database.**
Only `10-DONE` and `11-Terminated` carry `is_terminal = true`. Records sitting on those two "failure-shaped" stages are still open (`closed_at IS NULL`). See §5 for how this design handles them.

**F15 — A hard-coded blocking-stage list already exists, and its membership differs from this design's.**
`stageIsBlocking` (`src/lib/enrollment/overview.ts:166-173`) already hard-codes, for ACA:

```ts
["can't contact", "can not get id card", "need call to renewal"]
```

compared against `normalizeLabel(stage.label)`. Two consequences:

1. The "hard-code the labels" option in §5 is not hypothetical — it is the status quo, and it is what the new Config flag replaces.
2. **The existing list includes `Need call to renewal`; this design's terminal-equivalent set does not.** The owner's decision was that `Can't Contact` and `Can not get ID card` are treated as terminal, while `Need call to renewal` remains a running stage that *can* be flagged stuck or silent. Migrating to the Config flag must therefore not simply tick all three — that would silently change which records are eligible for stuck/silent accounting. The correct migration seeds the flag on exactly `Can't Contact` and `Can not get ID card`.

Note also that this existing list feeds the `blocking_stage` risk flag, which is consumed by the current needs-care section. Removing or repurposing `stageIsBlocking` has consumers.

---

## 3. What exists today

`src/app/(authed)/enrollment/_components/EnrollmentOverview.tsx` currently renders, for both programs:

| Section | Component |
|---|---|
| 6 KPI tiles (Open / Needs care / Overdue \| New / Closed / Net change) | `SnapshotStrip` |
| Funnel by stage — **Stage and Open columns only** | `FunnelSection` |
| Weekly in-vs-out + cycle time | `FlowSection` |
| Time in stage — median/p75, 90 days, live cycles only | `StageDwellSection` |
| Needs-care drill-through lists | `NeedsCareSection` |
| Most-missing info + average completeness | `InformationQualitySection` |
| Outcome Done/Terminated (ACA only) | `OutcomeSection` |

This design **replaces** the ACA composition. Sections not carried forward are listed in §11.

---

## 4. Global controls

### 4.1 Date range — filters by record creation date

The existing eight-preset control (F12) is kept. **Semantics decided in session: the range filters on `enrollment_records.created_at`, and every metric on the dashboard is then computed over that cohort.**

One consequence must be stated in the UI, because it will otherwise be read as a bug:

> **"Done" means *created in this range and currently Done*, not *finished in this range*.**
> With `This month` selected, a record created in July that finished yesterday is not counted anywhere on the page.

`All dates` must therefore be readily reachable — it is the only view that shows the whole operation. **Open question: which preset opens by default** (§12.2).

### 4.2 Staleness threshold — a picker, not a constant

A single control at the top of the dashboard offers **1 day · 3 days · 7 days · 10 days**. Changing it recomputes every affected number **and relabels every affected column header** (`Stuck ≥3d` → `Stuck ≥7d`).

The value stored in `/config` becomes the *default selection on load*, per program — not a hard-coded constant anywhere in the calculation.

### 4.3 "Silent" excludes comments

*Days silent* is computed from `enrollment_activity`, **not** from `last_activity_at`, with three exclusions:

| Excluded | Why |
|---|---|
| `type = 'comment_added'` | By F10 any edit bumps `last_activity_at`, and a comment is an edit. One throwaway comment would make an abandoned record look actively worked. |
| `type = 'attachment_added'` | Same one-click gaming vector as a comment (`src/app/api/enrollment/[id]/attachments/route.ts:203`). |
| `actor_email = 'system'` | **The cron resets the clock by itself.** `src/app/api/cron/check-enrollment-due/route.ts:118-124` and `:138-144` insert `due_soon` and `went_overdue` rows with `actor_email = 'system'`. Without this exclusion, the most neglected records — the overdue ones — have their silence clock reset by a machine, and the metric inverts precisely where it matters most. |

The `actor_email = 'system'` exclusion is not an invention: `enrollment_touch_activity` already applies the same rule (`2026-08-09-enrollment-stage-time-schema.sql:468` — `if actor is null or actor = 'system' then return;`).

`comment_edited` and `comment_deleted` exist in the type check constraint but are never written by the enrollment API, so they need no exclusion.

---

## 5. The terminal-stage rule

For **dashboard purposes only**, a stage is "terminal" if it is `is_terminal` in the database **or** flagged as terminal-equivalent in Config. For ACA this set is:

`10-DONE` · `11-Terminated` · `Can't Contact` · `Can not get ID card`

**This must NOT be implemented by setting `is_terminal = true` on those two option rows.** That flag drives record-closing behaviour elsewhere in the application; flipping it would make open records be treated as closed well outside this dashboard.

**Implementation: a new boolean on the stage option, editable in `/config`** (§9.2). Admin ticks "treat as terminal on dashboard". A future blocking stage then needs no code change. The alternative — hard-coding the two labels — was considered and rejected: label renaming is already blocked by the API (`src/app/api/enrollment/option-sets/[id]/route.ts:52-57` returns 409 for protected stage labels) so it would not *break*, but it would require a code change every time the team invents a new dead-end stage.

**Effect of the rule:**

| Surface | Behaviour on terminal stages |
|---|---|
| Stage table (§6.1) | Row still shown; the four waiting columns are blank |
| Needs-action list (§6.2) | Excluded entirely |
| Person × Stage matrix (§6.4) | Column not shown |
| `Stuck` / `Silent` counts anywhere | Excluded |
| Dedicated scorecards | `Can't Contact` and `Can not get ID card` keep their own tiles — they are excluded from *stuck/silent* accounting, not from *visibility* |

That last row is the point of the whole rule: those records are not neglected by an individual, but 14 records dying quietly on `Can't Contact` is still something the dashboard must show.

---

## 6. Scorecards

Fifteen tiles. All labels in English. All obey the date-range cohort (§4.1).

| # | Label | Definition |
|---|---|---|
| 1 | **Total tasks** | All records in the cohort, excluding archived |
| 2 | **Done** | Currently on `10-DONE` |
| 3 | **Open** | `closed_at IS NULL` |
| 4 | **Terminated** | Currently on `11-Terminated` |
| 5 | **Unassigned** | `responsible_enroll_email IS NULL` |
| 6 | **No activity ≥N d** | No non-comment activity for N days; terminal stages excluded |
| 7 | **Stuck in stage ≥N d** | `stage_entered_at` older than N days; terminal stages excluded |
| 8 | **Can't Contact** | Currently on that stage |
| 9 | **Can not get ID card** | Currently on that stage |
| 10 | **Median open age** | Median days since `created_at`, open records |
| 11 | **Median time to done** | Median days from `created_at` to reaching `10-DONE` |
| 12 | **Slowest stage** | Stage with the highest median dwell — shows stage name plus the figure |
| 13 | **Median time in current stage** | Across all open records |
| 14 | **Active people** | People holding at least one open record |
| 15 | **Avg tasks per person** | #3 ÷ #14 |

**Invariant: #2 + #3 + #4 = #1.** If it ever doesn't, the cohort filter and the stage filter disagree and that is a bug.

Tiles 11, 12 and 13 rest on `enrollment_stage_cycles`, so by F4 **they carry no data before 2026-08-09** and by F5 must render "Not enough samples" below n=10 rather than a figure computed from two rows.

**Deliberately excluded, with reasons:** *Overdue* and *Due soon* — the owner states Enrollment does not operate on due dates. *QC pending* — the owner states QC volume is negligible. *Success rate*, *inflow this period*, *load spread*, *per-person throughput* — proposed and declined in session, to keep the strip readable.

> **Side finding, not part of this work:** the cron `check-enrollment-due` still computes due-soon/overdue and emits notifications, and `enrollment_activity` still accepts `due_soon` and `went_overdue`. If due dates are genuinely not part of the workflow, that job is sending notifications nobody acts on. Worth a separate decision.

---

## 7. Tables

Sample figures throughout §7 are **illustrative, not real data**.

### 7.1 Stage table — one row per stage

Rows come from the ACA stage option set **dynamically**, ordered by label collation (F7). A new stage added in Config appears automatically. A synthetic **`0-Unassigned`** row is placed first.

| Column | Definition |
|---|---|
| Stage | Label + colour dot |
| In stage | Records currently on it |
| % | Share of open records |
| Median wait | Median time the records *currently* there have been there |
| Longest | Oldest current occupant |
| Stuck ≥N d | Count over the threshold |
| Silent ≥N d | Count with no non-comment activity |

**`0-Unassigned` holds records pulled out of their stage row**, not counted twice. Consequently every real stage row counts only assigned records, and a separate "unassigned" column would be redundant — which is why it was dropped.

The four waiting columns are blank on terminal stages (§5). Clicking a row opens the record list for that stage.

**Rejected columns, recorded so they are not re-proposed:** *time to clear the stage historically*, *records that left this stage*, *top holder* — all removed by the owner. *Trend vs previous period* was proposed and deferred: the system stores no daily snapshots, so past occupancy must be reconstructed from stage cycles, which only works after 2026-08-09.

### 7.2 Needs-action list — one row per record

| Task ID | Client | Agent | Responsible | Caller | Stage | Days in stage | Days silent |
|---|---|---|---|---|---|---|---|

- **Sorted by `max(days in stage, days silent)` descending.** By F11 this equals *days in stage* for all healthy data; the `max()` only matters where activity rows are missing. Implement the `max()` anyway — it is the correct expression of intent and it self-heals on bad data.
- **Running stages only** (§5).
- **Full pagination**, not a top-N cut.
- Clicking a row opens the record.
- Layout follows the existing enrollment list table, not a new table style.

**Why both day columns are mandatory.** `34d / 31d` is neglect — chase the owner. `26d / 2d` is a blocker — someone is working it and cannot advance, which is a business obstacle, not a performance problem. A single "days" column merges the two and produces unfair conclusions.

### 7.3 People table — one row per responsible person

| Person | Holding | Stuck ≥N d | Silent ≥N d | Median wait | Longest | Done in period |
|---|---|---|---|---|---|---|

Closing rows: **Team total**, and **Unassigned** shown separately in muted styling (it is not a person).

Three rules, deliberate:

1. **The denominator `Holding` is always visible** beside every error count, as a count and a percentage.
2. **Every number drills through** to the records behind it.
3. **No composite score column.** A single blended number hides which dimension is bad and is the easiest thing on the page to game.

Computed on `responsible_enroll_email`. ACA also has a `Caller` role; if that view is wanted it should be a role toggle on this table, not a second table.

### 7.4 Person × Stage matrix

Two-level header. Each stage is a group of three sub-columns: **Tasks · Stuck · Silent**. Under each `Stuck` figure sits a smaller **median stuck duration**, suppressed when `Stuck = 0`.

```
                    │ 1-Need quote          │ 2-Quoted              │ 4-Need documents      │
 Responsible ▾      │ Tasks  Stuck  Silent  │ Tasks  Stuck  Silent  │ Tasks  Stuck  Silent  │  →
────────────────────┼───────────────────────┼───────────────────────┼───────────────────────┤
 Minh Thư           │   2      1      0     │   3      2      1     │  16     13      7     │  …
                    │        1.2d           │        3.4d           │        9.6d           │
 Hoàng Nam          │   3      1      1     │   2      1      1     │   2      2      1     │  …
                    │        4.0d           │        5.1d           │       11.2d           │
────────────────────┼───────────────────────┼───────────────────────┼───────────────────────┤
 Total              │  11      3      1     │  11      5      3     │  21     16      8     │  …
                    │        3.1d           │        4.2d           │        8.9d           │
```

**This table is what keeps §7.3 honest.** A person can show the worst stuck percentage on the team purely because they hold the stage where everyone is stuck. The `Total` row is what separates "this person is slow" from "this stage is broken", and it is not optional.

The sub-line uses a **median**, not a mean: a handful of 60-day records would drag a mean into a figure that describes nobody.

Requirements:
- `Responsible` column frozen while scrolling horizontally; both header rows frozen while scrolling vertically.
- Heavy rule between stage groups, light rule between sub-columns.
- Dropdown on the `Responsible` header to filter to one person.
- **Running stages only**, so the matrix total is lower than §7.3's `Holding` total. This difference must be captioned, or it reads as missing data.

### 7.5 Assignment queue — view only

Reuses the CS visual pattern (F13): a horizontally scrolling strip of numbered cards with an **Edit queue** toggle grid.

```
 Assignment queue                                    5 people   [ Edit queue ]
 Fair turn order across the enrollment pool.
 ┌──────────────────┐┌──────────────────┐┌──────────────────┐┌────────────── →
 │ ① Sang           ││ ② Trâm           ││ ③ Ngọc Anh       ││ ④ Hoàng Nam
 │ Last assign   —  ││ Last assign Aug 2││ Last assign Aug 9││ Last assign Aug 11
 │ Holding      10  ││ Holding      14  ││ Holding      22  ││ Holding      24
 │ Stuck         3  ││ Stuck         4  ││ Stuck         7  ││ Stuck         9
 └──────────────────┘└──────────────────┘└──────────────────┘└────────────── →
```

- **Order: longest time since last assignment first. People never assigned rank at the very top.**
- **Last assigned at** = the later of: the most recent `people_changed` activity naming them as `responsible_enroll` (F8), and the `created_at` of any record created already assigned to them (F9). Omitting the second source is the most likely bug in this table.
- **`Holding` and `Stuck` do not affect the order** but must be displayed. Pure turn-taking will happily surface someone already holding forty records; the person assigning needs to see that before acting.
- **Membership is manual** via *Edit queue*, mirroring CS. No automatic exclusion by activity status — the toggle is the mechanism.
- **View only.** No assign button on the cards.

**Where this necessarily differs from CS:** the CS queue orders by `queueDueAt`, a computed eligibility moment derived from the SLA size of the task just assigned, so a big task pushes someone further back. **Enrollment records carry no SLA**, so no size signal exists. This queue is therefore pure rotation. Weighting by current load was considered and rejected — it would turn a turn-taking queue back into a load ranking, which is what the queue exists to avoid.

### 7.6 Unassigned tasks — the one write surface

Rendered in the style of the enrollment list table.

| Task ID | Client | Agent | Caller | Stage | Days in stage | Assign to |
|---|---|---|---|---|---|---|

- Sorted by `Days in stage` descending. Single sort order; no sort selector.
- `Assign to` is a person picker that performs the assignment in place.

**This is the only part of the dashboard that writes,** which pulls in two requirements the read-only sections do not have:

1. **Permission — gate on `canAssignPeople`, not on "manager".**
   `resolveEnrollmentCapabilities` exposes `canAssignPeople` (`src/lib/enrollment/access.ts:86`), granted to **managers, agent owners, and promoted assistants** — `canAssignPeople: isOwner`, plus the blanket manager grant at `access.ts:49-61`. It is enforced server-side at `src/app/api/enrollment/[id]/route.ts:293-298`.
   The picker must be **hidden when `canAssignPeople` is false**, not shown-then-rejected.
   **Do not write a manager-only check.** There is no "stakeholder" role in this codebase — the actor model has exactly `isManager` and `isWorker` (`src/lib/tasks/access.ts:35-48`). An earlier draft of this document claimed editing was manager/stakeholder-only; that was wrong, and implementing it would lock agent owners out of assigning their own records.
2. **Post-write refresh.** A successful assignment changes `Unassigned`, the queue order, the people table and the matrix. The dashboard must reload its snapshot immediately, or two people will assign the same record twice.

**Open question (§12.1) blocks the row set here:** which stages an unassigned record can legitimately be on.

---

## 8. Composition order

1. Date range + threshold controls
2. Scorecards (§6)
3. Stage table (§7.1)
4. Needs-action list (§7.2)
5. People table (§7.3)
6. Person × Stage matrix (§7.4)
7. Assignment queue (§7.5)
8. Unassigned tasks (§7.6)

---

## 9. Required changes outside the dashboard

### 9.1 `enrollment_stage_cycles.responsible_enroll_email` — deferred

Needed only for *historical* per-person stage timing ("on this stage, how long does each person actually take"), which is the fairest performance measure available because it compares people within the same stage.

It requires:
- a new column plus a backfill;
- a decision on **whether a mid-stage handover splits the cycle**. Today it would not: a record that sat 20 days and changed hands on day 18 would charge all 20 days to the incoming person;
- acceptance that data starts accruing only from implementation.

**Recommendation: keep this out of the first implementation.** Everything in §6 and §7 works without it. Ship the dashboard, then decide.

### 9.2 Stage option flag: "treat as terminal on dashboard"

New boolean on enrollment stage options, editable in `/config`. Required by §5. Small, and it removes a hard-coded label list before one gets written.

### 9.3 Config defaults

Per program: default staleness threshold (default 3 days), and the default date preset.

### 9.4 Queue membership for enrollment

The CS `queueEnabled` mechanism has no enrollment equivalent yet. Needs storage plus the toggle endpoint behind the *Edit queue* grid.

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| **Measuring people produces unfair blame.** Whoever holds the hard stages always looks worst. | Denominators always visible; drill-through everywhere; no composite score; the §7.4 `Total` row exists precisely to separate a slow person from a broken stage. |
| **Staleness is game-able through comments.** | §4.3 computes silence from typed activity excluding `comment_added`. |
| **Stage timing is silently absent before 2026-08-09.** | F4/F5: suppress below n=10, label honestly, never fill the gap with backfill-derived numbers. |
| **The date filter is easy to misread** (§4.1). | State the cohort meaning in the UI; keep `All dates` one click away. |
| **Query cost.** The overview already pulls every non-archived record unpaginated; six more sections multiply it. | Keep aggregation as pure functions in `src/lib/enrollment/` (node-testable); bound cycle queries to the existing 90-day lookback; compute per-stage and per-person groupings in one pass over one fetch, not one query per section. |

---

## 11. Not carried forward from the current ACA composition

| Removed | Why |
|---|---|
| Overdue / Due soon tiles and needs-care rows | Owner states Enrollment does not operate on due dates |
| QC pending tile | Owner states volume is negligible |
| Weekly in-vs-out chart | Not requested; the date cohort model replaces the period framing |
| Outcome Done/Terminated section | Absorbed into scorecards 2 and 4 |
| Most-missing info / average completeness | Not requested in this pass. **Not deleted from the codebase** — decide explicitly before removing working sections |

---

## 12. Open questions

1. **Unassigned records — which stages?** A record on `4-Need documents` with no responsible person is nonsense: somebody advanced it through four stages. Needed: (a) which stages an unassigned record is normally on, (b) from which stage a responsible person becomes mandatory. If real data *does* show unassigned records deep in the pipeline, that is a data defect and belongs in its own alert, not mixed into §7.6's waiting queue.
2. **Default date preset on load.**
3. **The `Assign to` picker** — does it list only people enabled in the queue, or everyone permitted to work? Does assigning need a confirmation step?
4. **§9.1** — build historical per-person stage timing at all, and if so, does a handover split the cycle?
5. **`Caller` role view** — is a role toggle on §7.3 wanted, or is Responsible sufficient?

---

## 12b. Blocking decisions raised by review (2026-08-13)

Two independent reviews of this document found the problems below. **Items 1-4 were owner decisions; all four are now decided (2026-08-13) and recorded inline.** Items 5+ are corrections the implementer must apply.

### 1. DECIDED — Manager/admin only, unscoped.

**Owner decision: the dashboard is for task managers and admins.** It is not shown to scoped agents or assistants.

This resolves the problem below, and it also means the endpoint must **not** apply `applyEnrollmentScope` — an unscoped read behind a manager gate, rather than a scoped read for everyone. Gate the route on `actor.isManager`.

*Original finding:* read scope is not broad. `src/lib/enrollment/scope.ts:28-59` restricts agents and promoted assistants to records whose `agent_email` is in their covered set, and the overview endpoint already applies it (`overview-data.ts:50`). For a scoped viewer, the people table, the matrix, the queue and every scorecard describe a slice of the org, not the org — and §1's question, *"ai đang nhiều task ai đang ít task để assign task cho hợp lí"*, cannot be answered from a slice.

`src/lib/enrollment/scope.ts:28-59` restricts agents and promoted assistants to records whose `agent_email` is within their covered set, and the overview endpoint already applies it (`overview-data.ts:50`). For a scoped viewer, the people table, the matrix, the queue and every scorecard describe **a slice of the org, not the org**.

§1 states the purpose as *"ai đang nhiều task ai đang ít task để assign task cho hợp lí"* — a question that cannot be answered from a slice. Options:

- **(a)** Dashboard is manager-only, unscoped. Simple, and the numbers mean what they say.
- **(b)** Everyone sees it, scoped. Then §7.3/§7.4/§7.5 must be labelled as "within your records", and load-balancing across the team is not what it shows.
- **(c)** Sections 0-2 scoped for everyone; the people-facing sections (§7.3-§7.6) unscoped and manager-only.

### 2. DECIDED — Include backfilled stage clocks for now, revisit later.

**Owner decision: ship the simple behaviour for this pass** ("tạm thời làm tạm"). Backfilled records are counted rather than excluded, so no record disappears from the stuck lists.

**Required mitigation, because the numbers are otherwise fiction for pre-rollout records:** wherever a stage age is shown for a record whose `stage_entered_source` is not `'live'`, mark it visibly — a muted style plus a tooltip reading *"estimated: this record predates stage-time tracking"*. `isMeasuredStageTime()` already exists for exactly this test (`stage-time.ts:15-17`) and is currently unused. Never present an estimate and a measurement in the same styling.

Revisit once pre-2026-08-09 records have mostly cycled out.

*Original finding, kept because it explains what the mark is for:*

`2026-08-09-enrollment-stage-time-backfill.sql:187-190` sets `stage_entered_at = created_at, stage_entered_source = 'record_created'` for every pre-rollout record whose history could not be rebuilt. A record created in November and since moved through five stages therefore carries a fabricated stage age of ~270 days.

- **Exclude** (treat non-`'live'` as unknown, which is what `isMeasuredStageTime()` already expresses): every stuck/wait figure is honest, but `Stuck ≥N d` **silently omits the oldest records in the system** — inverting the dashboard's purpose.
- **Include:** the "worst first" sort of §7.2 fills its top rows with backfill artifacts.
- **Third path:** include them but render the cell as *"age of record"* with distinct styling, never as measured dwell.

This affects tiles 7 and 13, §7.1's four wait columns, §7.2's sort order, and §7.4's median sub-line.

### 3. DECIDED — Every table and chart obeys the date range. One rule, no exceptions.

**Owner decision: the date-range filter at the top of the dashboard applies to every section**, including the people table, the matrix, the queue and the unassigned list. One rule the reader can hold in their head, rather than a per-section exception list.

**This was decided against the recommendation below, which is recorded because the failure mode is real and needs a mitigation, not a re-argument:**

`Holding`, `Stuck`, `Done in period` and `last assigned at` are properties of a *person*, not of a creation cohort. With `This month` selected, a person whose open records were all created in June shows `Holding 0` **and pins to the top of the assignment queue** — so the queue would recommend giving more work to the most loaded person on the team. §12c.G documents this independently.

**Mandatory mitigations, given the decision:**

1. **The default preset for this dashboard is `All dates`, not `This month`.** The whole-operation view is the correct thing to open on; narrowing is then an explicit act by the viewer. Note this differs from the existing overview's default (`EnrollmentClient.tsx:500-502`), which is `thisMonth` — see item 14.
2. **The queue and the people table carry a visible range caption**, so a reader who has narrowed the range cannot mistake `Holding 0` for "this person is free".
3. **Never auto-assign or auto-recommend from the queue.** It is view-only (§7.5), which contains the damage: a human reads the caption before acting.

### 4. DECIDED — Tile 12 follows the same rule; ship the simple version.

Per the owner's *"tạm thời làm tạm"*: tile 12 obeys the date range like everything else, over the existing 90-day cycle bound. With `All dates` as the default (item 3) the tile is populated on open. On a narrow range it will legitimately read "Not enough samples" — that is correct behaviour, not a defect, and the n≥10 rule already produces that message.

*Original finding:* under both §4.1's cohort rule and §10's 90-day cycle bound, tile 12 resolves to cycles belonging to records created in range **and** ended within 90 days, which on `Today` is approximately zero rows.

### 5. The invariant's stated diagnosis is wrong

`closed_at` is written only as a derivative of `is_terminal` (`api/enrollment/[id]/route.ts:212-216`), and **`is_terminal` is a live checkbox in `/config`** (`ConfigClient.tsx:1289, 1526` → `option-sets/[id]/route.ts:70`). If an admin ticks it on a third stage, closed records exist on neither `10-DONE` nor `11-Terminated` and `#2 + #3 + #4 = #1` breaks with nothing wrong with the cohort filter. Do not send the engineer to debug date handling. This also means F14 is a mutable row state, not a constraint.

### 6. Tile 15 arithmetic is wrong as written

`Open ÷ Active people` counts unassigned records in the numerator that nobody holds. It will not match §7.3's team row. Use **assigned open records ÷ active people**, and show the unassigned count beside it.

### 7. Tiles 11 and 13 do not rest on stage cycles

Tile 11 (`created_at` → `10-DONE`) needs only `closed_at` and is already implemented that way in `overview.ts:252-279`. Tile 13 reads `enrollment_records.stage_entered_at`. Only tile 12 uses cycles. The blanket "no data before 2026-08-09" sentence would blank two tiles that have years of usable data.

### 8. The n≥10 rule cannot apply to §7.4

`MIN_DURATION_SAMPLE` was written for *historical measured dwell samples*. §7.4's sub-line is a median over *current occupancy*, where every record is directly observed — a different statistical situation, and its cells are single digits. Applying n≥10 there blanks nearly the whole matrix. **Restrict the n≥10 rule to cycle-derived statistics (tile 12, and any historical dwell).** Current-occupancy medians (tiles 10, 13, §7.1, §7.3, §7.4) show whatever they have.

### 9. §7.2 has no membership rule

Stated filters are only "running stages" and "full pagination". Nothing says whether the threshold N filters rows. "Needs-action" implies yes; "not a top-N cut" implies no. **Decide: the list contains records where `max(days in stage, days silent) ≥ N`**, paginated in full — that reconciles both sentences and is the reading the implementation plan assumes.

### 10. Stage identity for tiles 2, 4, 8, 9

§5 rejects hard-coded labels, but these four tiles identify their stage by name. Once `treat_as_terminal` is the mechanism it marks a *set* and says nothing about which member gets which tile. **Decide:** these four tiles match on normalised label (as `overview.ts:389-390` already does), and that is an accepted exception to §5 — §5's flag governs *behaviour*, tiles govern *identity*.

### 11. Records with no stage are undefined everywhere

`stage_id IS NULL` records are open (tile 3) but appear in no §7.1 row. The current implementation has a "No stage" bucket (`overview.ts:358-361`). Also, the paired-null constraint means `stage_entered_at` is always NULL there, so `Days in stage` has no value. Decide whether §7.1 keeps a "No stage" row.

### 12. §7.1's `%` column has a different denominator from its count

Terminal rows show a count of closed records over a denominator of open records, so percentages cannot sum to 100 and the DONE row can exceed it. Resolved in the implementation plan by rendering `%` as null on terminal rows; record it here too.

### 13. §11's "absorbed" claim is false

The existing Outcome section counts records **closed during the period** (`overview.ts:386-390`). Tiles 2 and 4 count records **created in the period and currently on that stage**. Different question, different number. Removing that section on the strength of "absorbed" is data loss.

### 14. The biggest visible change is unflagged

Today `openCount` is not period-filtered at all (`overview.ts:338, 398`). Under §4.1 the most-looked-at tile on the page drops by an order of magnitude on the default preset — and the code already defaults to `thisMonth` (`EnrollmentClient.tsx:500-502`), so **§12.2 is not a deferrable question**: not deciding ships the confusing view. Note this also answers §12.2: the current default is This month.

### 15. Corrections to §2

- **F7:** the collator is `options.ts:28-31`, the function `33-35`. The claim that `position` ordering "would produce the wrong workflow order" is **false for today's seed data** — positions `10,20,…,140` happen to match label collation. It is true only prospectively, because new options get `max + 10` (`option-sets/route.ts:91-106`). Keep the label sort; fix the justification.
- **F8:** a **caller-only** edit also writes a `people_changed` row, because `touchesPeople` is `"caller_email" in patch || "responsible_enroll_email" in patch` (`[id]/route.ts:253-254`) and the meta falls back to the *unchanged* responsible. Deriving "last assigned" from the latest such row therefore resets the queue clock for someone never re-assigned. The activity row does not store the previous value, so the derivation must compare consecutive rows per record rather than take the latest.
- **F11:** the reasoning runs on `last_activity_at` but §4.3's metric runs on `enrollment_activity`; the proof does not transfer. Also `became_active` includes un-archiving, which resets `stage_entered_at` with no stage change. The `max()` in §7.2 is doing real work, not insurance.
- **F12:** the reused artifact is the exported `DateRangeFilter` component, not the `DATE_PRESETS` constant. The selected range is `useState` only — **not persisted** — which matters for §9.3.
- **§5:** the 409 rename guard covers `stage` **and** `consent`.
- **§10:** `fetchEnrollmentOverview` (`overview-data.ts:38-52`) requests no `count` and never calls `assertEnrollmentRecordsComplete`, so it can silently truncate at PostgREST's row cap **today**. Any "one pass over one fetch" mitigation inherits that defect and must fix it.

---

## 12c. Implementation-risk review (2026-08-13)

### A. The central correction: compute both time-since values on write, not on read

Both expensive numbers in this design are *"time since X last happened"*, and both were specified as read-time derivations over `enrollment_activity` — a table with exactly one index (`(record_id, created_at desc)`, `schema.sql:4282-4283`), no index on `type`, no GIN on `meta`, appended to on every patch and never pruned.

Measured cost of building it as originally written, at 5,000 records and 20 people:

| Section | Added cost per page load |
|---|---|
| §4.3 days silent (feeds five sections) | **~55 sequential requests, ~50,000 rows** |
| §7.5 last assigned at | an unindexed sequential scan with per-row JSONB extraction, **plus a second un-cohort-filtered record fetch** |
| §7.4 person × stage matrix | **zero** — pure in-memory grouping over records already fetched |
| §6 tiles 1-5, 8-11, 13-15, §7.1, §7.3 | **zero** — all derivable from the existing record fetch |

**The matrix is not the cost problem, contrary to where §10's mitigation points.** Two writes fix everything:

1. **`enrollment_records.last_work_activity_at`** — maintained inside `patch_enrollment_atomic` beside the `last_activity_at` write it already performs, set only when the activity is real work. Comments arrive through a different route (`src/app/api/enrollment/[id]/comments/route.ts`), so the split is clean. Days-silent becomes a column on a fetch that already happens.
2. **`enrollment_records.responsible_assigned_at`** — set whenever `responsible_enroll_email` actually changes. `max()` per person then falls out of the same fetch.

This is also what CS already does: its "Last assign" is denormalised in `task_assignment_rotation` (`schema.sql:3020-3027`), bumped by `bump_task_assignment_rotation` (`:3039-3074`). The design claimed to reuse the CS pattern and then specified the opposite mechanism.

**Second benefit: it dissolves F9 and the caller-only bug together.** A column written on assignment is written at creation too, so there is no second source to union, and a caller-only edit does not touch it. §12b item 15's `people_changed` hazard disappears rather than needing a window function to work around.

### B. §7.6 cannot call the existing PATCH as designed

1. **The snapshot carries no `updated_at`.** PATCH hard-requires `expected_updated_at` (`[id]/route.ts:111-117`, 409 at `:142-147`, and the RPC's `where updated_at = p_expected_updated_at`). `EnrollmentOverviewRecordSummary` has no such field (`overview-types.ts:80-92`). The row type must carry it, refreshed from each PATCH response.
2. **Edit rights are per row, not per page.** `canAssignPeople` comes from `isAgentOwner`, resolved per record against that record's `agent_email` with a database round-trip (`[id]/route.ts:125-128` → `membership.ts:74-88`). Computing it naively is one `agent_members` query **per unassigned row**. Fetch the actor's `agent_members` rows once and intersect in memory.
3. **No refresh wiring exists.** `EnrollmentOverview` owns its fetch and exposes no imperative reload (`EnrollmentOverview.tsx:23-56`) and has no realtime subscription. The assign also fires `broadcastEnrollmentChanged` (`[id]/route.ts:531`), which triggers the parent's refetch — plan for one reload, not two.

### C. §9.4 — the CS queue table cannot be reused

`task_assignment_queue_members` is keyed on email alone with no program column (`schema.sql:3029-3034`), **and the CS assignment-validation RPC rejects assignment outright for disabled members** (`schema.sql:3171-3175`, `raise exception 'INVALID_CS'`). Toggling someone off in an enrollment queue would make them un-assignable for CS tasks. A separate table is mandatory. The CS endpoint is likewise not reusable: it gates on `actor.isManager` and validates against CS eligibility (`api/tasks/assignment-queue/route.ts:20-22, 33-38`), whereas the enrollment person set is `portal_account where is_active` (`queries.ts:263-271`).

**Also unresolved:** a person newly toggled into the queue has no assignment history and pins to #1 permanently until they receive a record. CS avoids this by creating the rotation row with `queue_due_at` defaulting to `now()` (`schema.sql:3022, 3058-3070`). Enrollment needs an equivalent seeding rule.

### D. §9.3 — there is no per-program settings table

The nearest analogue is a singleton (`task_reminder_settings`, `schema.sql:1735-1743`). So "config defaults" is a new table plus a new API route plus a new Config UI section, not a config edit. Separately, §4.2 makes the stored value the *default selection on load*, which means the live picker value needs per-user persistence somewhere — unspecified.

### E. §5's flag leaves two disagreeing definitions live

`stageIsBlocking` (`overview.ts:166-173`) stays in the tree per §11 and drives the `blocking_stage` risk flag consumed by `needsCare` (`overview.ts:320, 327, 345-350`). Its ACA list includes `need call to renewal`, which this design's terminal set omits. After §9.2 ships there are two live, disagreeing definitions. **Migrate `stageIsBlocking` in the same change.**

Full mechanical checklist for the flag, all required: `enrollment_options` column (`schema.sql:3321-3332`) · `EnrollmentOption` type (`types.ts:60-70`) · **both** select lists (`options.ts:81` *and* `overview-data.ts:62`) · POST gated on `is_stage` like its siblings (`option-sets/route.ts:107-112`) · PATCH (`option-sets/[id]/route.ts:70-71`) · `DropdownValueRow` (`ConfigClient.tsx:986-992`) · `valueRows` mapping (`:1204-1206`) · `toggleStageRule` (`:1289`) · third checkbox (`:1517-1546`). The per-option promise queue at `ConfigClient.tsx:1289-1300` already serialises concurrent toggles.

### F. The existing overview fetch can silently truncate, and the invariant cannot detect it

`fetchEnrollmentOverview` (`overview-data.ts:38-52`) requests no `count`, no `.range()`, and never calls `assertEnrollmentRecordsComplete` — unlike both sibling fetchers (`queries.ts:82-133`, `stage-metrics.ts:49-54`). At 5,000 records it may compute over a truncated set.

**And §6's invariant would still hold on truncated data**, because all four counts truncate together. The design's own integrity check cannot detect its most likely failure. Fix the fetch before shipping anything people make staffing decisions from.

### G. §4.1's cohort filter breaks the queue outright

`Holding`, `Stuck`, `Done in period` and `last assigned at` are properties of a *person*, not of a creation cohort. With `This month` selected, a person whose open records were all created in June shows `Holding 0` **and pins to the top of the assignment queue** — the design would then recommend giving more work to the most loaded person on the team. This is §12b item 3 restated with its concrete failure, and it settles that question: **the person-facing sections must ignore the date range.**

### H. `enrollment_activity.type` has no `assigned` value

The CHECK constraint (`schema.sql:4258-4277`) does not include one, so a purpose-built assignment event would require altering the constraint — a further reason to prefer the denormalised column in §12c.A.

---

## 13. Implementation log

| Scope | Status | Commit | Verification |
|---|---|---|---|
| — | Not started | — | — |
