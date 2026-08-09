# Enrollment Operations Dashboard — Design

**Date:** 2026-08-09
**Status:** P0 IMPLEMENTED — P1/P2 deferred behind the documented data/config gates
**Source of truth:** working tree at `HEAD = f202992`, every implementation entry below was verified on 2026-08-09
**Scope:** replaces the Overview tab of `/enrollment` for **both** programs, as **two separate dashboards**

---

## 1. Problem

`/enrollment`'s Overview tab today is a near-copy of the Health CS workload overview. It answers *"who has capacity, who should I assign this to"* — the CS question.

Enrollment's actual operating question, stated by the owner:

> "chủ yếu là tracking xem họ đã lấy thông tin khách thế nào, cái nào bị pending, cái nào chưa lấy được cần reason"
> …and: *"cần biết enroll nào cần take care, bạn nhân viên nào chưa làm tốt"*

So the dashboard must answer two things, in this order:

1. **Which enrollment records need attention** — record triage.
2. **Which staff member is not performing** — people accountability.

These are not the CS questions. CS asks *"who is free?"*; Enrollment asks *"who is dropping the ball?"* Same table shape, opposite purpose — which is why the CS panel cannot be inherited.

## 2. What exists today, and what is wrong with it

`src/app/(authed)/enrollment/_components/EnrollmentOverview.tsx` renders:

- KPI tiles: People / Free / Open records / Needs attention / Unassigned
- "Attention areas" bars, from only three flags
- "Work mix by stage" histogram
- Per-person Workload table with `free / ok / busy / overloaded`
- Unassigned queue
- An assignment-recommendation panel

Concrete defects found by reading the code:

| # | Finding | Evidence |
|---|---|---|
| D1 | Only **three** risk flags exist: `qc_stale`, `missing_owner`, `no_due_date` | `src/lib/enrollment/overview-types.ts:8-13` |
| D2 | The code's own comment claims Enrollment has no overdue workflow. **Stale** — `check-enrollment-due` already computes due-soon / overdue / reminder, and `enrollment_activity` already accepts `due_soon` and `went_overdue`. The overview flags `no_due_date` but never `overdue`. | `overview-types.ts:6-7` vs `src/app/api/cron/check-enrollment-due/route.ts` |
| D3 | The overview **does not even select** the information-collection columns. `OVERVIEW_RECORD_COLUMNS` omits `consent_id`, `aca_status_id`, `payment_status_id`, `carrier_id`, `platform_id`, `pcp_2025`, `pcp_2026`, `custom_values`. The owner's core question is answerable for free today and the query does not look. | `src/lib/enrollment/overview-data.ts:13-14` |
| D4 | The assignment recommendation is a stub — it ignores its own target argument (`void targetRecordId`) and ranks purely on open count. | `src/lib/enrollment/overview.ts:245-273` |
| D5 | The stage histogram hardcodes `danger: 0`, so the risk shading never fires. | `src/lib/enrollment/overview.ts:200-218` |

## 3. Verified data facts that shape this design

These are constraints, not preferences. Every one was verified against the tree.

**F1 — ACA and Medicare are structurally different, enforced by the database.**
`enrollment_records_medicare_fields_check` (`supabase/schema.sql:2665-2675`) **forbids** Medicare rows from having `caller_email`, `pcp_2026`, `platform_id`, `consent_id`, `payment_status_id`, `aca_status_id`.

| | ACA | Medicare |
|---|---|---|
| Option sets | stage, carrier, platform, consent, payment_status, aca_status (**6**) | stage, carrier (**2**) |
| Collectable items | Carrier, Payment status, AC status, Consent, Platform, PCP 2025, PCP 2026 | Carrier, PCP |
| People roles | Caller **and** Responsible | Assignee only (`responsible_enroll_email`) |
| Seeded stages | 14 | 3 |

**F2 — the seeded stage vocabulary.** ACA (`schema.sql:2825-2838`):

```
 1-Need quote · 2-Quoted · 3-Waiting for Confirmation · 4-Need documents
 5-Ready to enroll · 6-Enrolled · 7-1st payment done · 8-Need assign PCP
 9-Assigned PCP/Get ID Card
10-DONE                 is_terminal=true,  triggers_qc=true
11-Terminated           is_terminal=true,  triggers_qc=false
Need call to renewal    is_terminal=false
Can't Contact           is_terminal=false      ← still OPEN
Can not get ID card     is_terminal=false      ← still OPEN
```

Medicare (`schema.sql:2899-2901`):
```
New                     is_terminal=false
E- ID Card Unavailable  is_terminal=false      ← still OPEN
10 - DONE               is_terminal=true,  triggers_qc=true
```

Two consequences that change the design:

- **`Can't Contact` and `Can not get ID card` are NOT terminal.** Records there are still open (`closed_at IS NULL`). They therefore cannot appear in any "closed this period" outcome ratio. They are *open records stuck in a failure-shaped state* and belong to triage, not to outcomes.
- **Medicare has no failure terminal stage at all.** Only `10 - DONE` is terminal. A Medicare enrollment cannot be marked as lost. Medicare therefore has **no success/failure ratio** — only a completion count. Section 6 reflects this rather than inventing a metric.

**F3 — stage display order comes from the label, not from `position`.**
`position` is assigned as `last + 10` on insert (`src/app/api/enrollment/option-sets/route.ts:103-106`) and there is **no reorder UI** for enrollment option sets. Real ordering is `Intl.Collator("en-US", { numeric: true })` over the label (`src/lib/enrollment/options.ts:21-27`), which is why the numeric prefixes exist. **The funnel must order by label collation. Ordering by `position` would break it.**

**F4 — stage labels are protected from renaming.** `src/app/api/enrollment/option-sets/[id]/route.ts:52-57` returns 409: *"Stage and Consent option labels are protected workflow identities."* So keying logic off the label prefix is safe — the vocabulary is effectively an enum.

**F5 — "when did the stage last change" has two independent, both-lossy sources.**
Both writes are best-effort *after* the record commits, and a failure only appends to `mutationWarnings` while the record update stands:
- `enrollment_stage_history` insert — `src/app/api/enrollment/[id]/route.ts:351-360`
- `enrollment_activity` insert (`type='stage_changed'`) — `src/app/api/enrollment/[id]/route.ts:499-502`

They are separate statements, so one can succeed when the other fails. Nothing in `src/` has ever *read* `enrollment_stage_history`, so its integrity has never been validated by any consumer. Records created before the feature have no rows at all.

**F6 — a comment bumps the record's `updated_at`.** `src/app/api/enrollment/[id]/comments/route.ts:94`. So `updated_at` means *"someone touched this, including just commenting"* — useful for "is anyone still on it", but game-able as an inactivity metric.

**F7 — `enrollment_activity` is typed**, which is what makes F6 recoverable: `created`, `edited`, `field_changed`, `stage_changed`, `people_changed`, `comment_added`, `attachment_added`, `qc_needed`, `qc_reviewed`, `qc_review_cleared`, `reopened`, `archived`, `due_soon`, `went_overdue` (`schema.sql:2723-2740`).

## 4. Scope decision: two dashboards, no shared component

ACA and Medicare get **separate dashboard compositions**. They may share pure calculation helpers in `src/lib/enrollment/`, but **no shared React component and no inheritance**, because:

- different collectable items (7 vs 2) → the "missing information" report has a different row axis
- different people roles (Caller+Responsible vs Assignee) → different people table
- different stage depth (14 vs 3) → the funnel means something different
- Medicare has no failure outcome → Section 6 does not exist for Medicare

A single parameterised component would end up as a chain of `isMedicare ? … : …` branches, which is how the current shared client became 4,200 lines.

## 5. The dashboard — ACA

### Tier 0 — Glance strip (6 tiles)

| Tile | Definition | Source |
|---|---|---|
| Open | `closed_at IS NULL AND archived_at IS NULL` | ✅ free |
| New (period) | `created_at` within period | ✅ free |
| Closed (period) | `closed_at` within period | ✅ free |
| **Net change** | New − Closed | ✅ free |
| Needs care | count of Tier 2 union | needs thresholds |
| Overdue | `due_date < today AND closed_at IS NULL` | ✅ free — reuse the cron's exact predicate so dashboard and notification agree |

**Net change is the most important tile and exists nowhere today.** 40 in / 12 out makes every other number a symptom.

### Tier 0b — Date range, and the snapshot/period split

The dashboard gets the **existing** `DateRangeFilter` component (`src/app/(authed)/tasks/_components/TaskToolbar.tsx:873-882`), which EnrollmentClient **already imports** (`EnrollmentClient.tsx:87`) but currently renders **only when `view === "list"`** (`:1420`) — so the Overview has no date control at all today. Move it so it renders for the Overview too.

Its eight presets are reused as-is, no new picker: `Fixed` · `Today` · `Yesterday` · `This month` · `Last 7 days` · `Last 14 days` · `Last 30 days` · `All dates`. **Default: `This month`.**

**The trap this must avoid:** on an operations dashboard, some numbers are a *photograph of right now* and some are a *count over a window*. If both silently obey the date picker, a user selecting "Today" sees `Open = 0` and concludes the system is broken. If neither does, the picker looks inert.

So every metric is explicitly one of two kinds:

| Kind | Obeys date range? | Metrics |
|---|---|---|
| **Snapshot** — state as of now | **No** | Open · Overdue · Needs care · Tier 1.1 funnel (all columns) · all Tier 2 lists · Tier 3.1 · Tier 3.2 · Tier 4 columns *Holding / Abandoned / Stuck / Overdue / Avg completeness / QC returned* |
| **Period** — events inside the window | **Yes** | New · Closed · Net change · Tier 1.2 · Tier 1.3 · Tier 5.1 · Tier 5.2 · Tier 4 column *Closed* |

Implementation requirements that follow:

1. **Tier 0's strip is visually split** — snapshot tiles on the left, period tiles on the right under a heading carrying the selected range, e.g. *"This month (1–9 Aug)"*. The user must be able to see which half the picker controls without being told.
2. **Period sections carry the range in their own heading**, not only in the global picker.
3. **Snapshot sections carry no date caption at all** — an absent caption is the signal.
4. `All dates` applies only to period metrics; snapshot metrics are unaffected by definition.
5. The picker choice is **per program** — switching ACA ↔ Medicare must not silently carry a range that meant something different.

> **Note on an existing bug this inherits:** `DateRangeFilter` is shared with Tasks and Enrollment list view, and its draft state is resynced on open via `toggleRangePicker()` (`TaskToolbar.tsx:638-648`). That is correct today. Do not "fix" it — a previous review incorrectly flagged it as unsynced.

### Tier 1 — Pipeline health

**1.1 Funnel — the entry point, not a chart.** One row per stage, ordered by label collation (F3):

| Stage | Open | Stuck >7d | Stuck >14d | Oldest | Top holder |
|---|---|---|---|---|---|

**Column availability differs — this row is split across priorities:**
- `Stage` and `Open` are free (P0). The funnel ships useful with just these two.
- `Stuck >7d`, `Stuck >14d`, `Oldest` need both §7 thresholds and the §8 gate (P2).
- `Top holder` = the person holding the most open records in that stage, counted on **`responsible_enroll_email`** (not Caller — Responsible is the accountable owner in both programs). Free (P1, needs only the Tier 4 people join).

Clicking a stuck count opens **1.1b**; a toggle switches to **1.1c**.

**1.1b — records inside that stage:**

| Client | Days in stage | Days untouched | Responsible | Last activity type |
|---|---|---|---|---|

The two day-columns side by side are the whole point:
- `31d / 22d` → **abandoned** — chase the owner
- `28d / 2d` → **blocked** — someone is on it but cannot advance; this is a business obstacle

`Last activity type` comes from F7 and defeats the F6 gaming problem: `comment_added` is not the same as `stage_changed`.

**1.1c — same stage, grouped by person:**

| Person | Stuck here | Oldest | **Share of their load** |
|---|---|---|---|

The last column is the fairness guard. 6 stuck out of 9 held is a different conversation from 5 stuck out of 38.

**1.2 In vs Out over time** — paired weekly bars, 8–12 weeks, from `created_at` / `closed_at`. Shows when backlog started accumulating. ✅ free.

**1.3 Cycle time** — median and p90 days from `created_at` to `closed_at`, split by outcome stage. ✅ free.

**1.4 Where it clogs** — median days resident per stage. ⚠️ depends on F5; see §8.

### Tier 2 — Needs care today

Each row is a clickable list, not just a number:

| List | Criterion |
|---|---|
| Abandoned | untouched > N days (`updated_at`, cross-checked against `enrollment_activity` excluding `comment_added`) |
| Stuck in stage | in same stage > N days **but** still has activity |
| Overdue | `due_date` passed |
| Due soon | `due_date` within X days |
| Missing required info | empty value on a column Config marks `required` |
| QC pending | current stage `triggers_qc` and `qc_checked_at IS NULL` |
| Unowned | `responsible_enroll_email IS NULL` |
| **Stuck on a blocking stage** | current stage ∈ {`Can't Contact`, `Can not get ID card`, `Need call to renewal`} — open, not closed (F2) |

The last row is where "cái nào chưa lấy được cần reason" is answered with data that exists today: the stage label *is* the reason, at the granularity the team already chose.

### Tier 3 — Information quality

**3.1 Most-missing items** — ranked across open records: Consent missing on 40, PCP 2026 on 31, Payment status on 22… Row axis = the 7 ACA collectable items plus any `required` custom column. ✅ free — needs only D3 fixed.

**3.2 Average completeness** — % of applicable items filled across all open records. One number to trend.

### Tier 4 — People

One row per person. **ACA shows Caller and Responsible separately** (two tables, or one table with a role switch).

| Column | Measures |
|---|---|
| Holding | **denominator — always shown** |
| Abandoned (n and %) | neglect |
| Stuck (n and %) | stagnation |
| Overdue (n) | deadline discipline |
| Avg completeness (%) | sloppiness |
| Closed (period) | throughput |
| QC returned | quality |

Rules, deliberate:
- **Always show the denominator.** Never a bare "worst 3" ranking.
- Every number drills through to its records.
- No composite score. A single number invites gaming and hides which dimension is bad.

### Tier 5 — Outcomes *(ACA only — see F2)*

**5.1 Outcome of closed records (period).** Among records with `closed_at` in the period, split by terminal stage: `10-DONE` (success) vs `11-Terminated` (lost).

> **Correction to an earlier verbal statement:** `Can't Contact` was previously described as a failure outcome. It is `is_terminal = false` (F2), so those records are still open and cannot appear here. They are reported in Tier 2's last row instead.

**5.2 Loss reasons** — for `11-Terminated` records, the stage they occupied immediately before termination, from the stage-transition sources (F5). ⚠️ depends on F5; degrade to "not enough history" rather than showing a wrong number.

## 6. The dashboard — Medicare

Same skeleton, reduced to what Medicare actually has.

- **Tier 0** — identical six tiles.
- **Tier 1** — funnel over 3 stages; 1.1b / 1.1c identical but "Responsible" is labelled **Assignee**. 1.2 and 1.3 identical.
- **Tier 2** — same lists, minus Caller-related ones. The blocking-stage row lists `E- ID Card Unavailable` (open, not terminal).
- **Tier 3** — only **two** items (Carrier, PCP) plus required custom columns. Rendered as a short list, **not** a matrix — a 2-row matrix is noise.
- **Tier 4** — one table only (Assignee). Same columns.
- **Tier 5** — **does not exist.** Medicare has no failure terminal stage, so there is no ratio to compute. Tier 0's "Closed (period)" already carries the completion count. Inventing a denominator here would be fabricating a metric.

## 7. Configuration

All day-count thresholds live in `/config`, per program — never hardcoded. This follows the pattern just established for CS SLA (`src/lib/tasks/sla-config.ts`).

| Setting | Proposed default |
|---|---|
| Abandoned after | 5 days untouched |
| Stuck — warning | 7 days in stage |
| Stuck — alert | 14 days in stage |
| Due soon window | 3 days |
| Default date preset | `This month` (one of the eight in Tier 0b) |

Per-stage overrides are **out of scope for v1** but the storage shape should not preclude them: a stage like `4-Need documents` legitimately takes longer than `2-Quoted`, and a single global threshold will produce false alarms there. Revisit after observing real dwell data from Tier 1.4.

## 8. Data reliability gate — must run before building the stage-age features

Everything that needs *"how long has this record been in its current stage"* depends on F5, which is unvalidated. Before implementing Tier 1.1's stuck columns, Tier 1.4, Tier 2's "Stuck in stage", Tier 4's "Stuck", and Tier 5.2:

1. **Measure coverage.** For open, non-archived records per program: what fraction has at least one `enrollment_stage_history` row, and what fraction has at least one `enrollment_activity` row of type `stage_changed`?
2. **Resolve with a documented fallback chain:**
   `MAX(enrollment_stage_history.changed_at)` → else `MAX(enrollment_activity.created_at WHERE type='stage_changed')` → else `created_at`.
   Using both sources materially raises coverage because they are independent writes (F5).
3. **Never mix meanings silently.** When the value came from the `created_at` fallback, the UI must label it **"age of record"**, not "days in stage".
4. **Suppress statistics on thin data.** Medians and percentiles only when n ≥ 10 for that stage; otherwise show raw days.
5. **If coverage is below ~90%, ship these features in a later phase** rather than displaying a number that is wrong for an unknown, silent fraction of records.

## 9. What gets removed

| Removed | Why |
|---|---|
| Per-person Workload table (`free/ok/busy/overloaded`) | Answers "who has capacity" — the CS question. Tier 4 replaces it with an accountability table. |
| Unassigned queue as its own section | Demoted to one row in Tier 2. |
| Assignment recommendation panel + `rankEnrollmentRecommendation` | Not Enrollment's question, and it is a stub (D4). |
| `ENROLLMENT_OVERVIEW_THRESHOLDS` open-count buckets | Superseded by §7 config. |
| The stale comment at `overview-types.ts:6-7` | Contradicted by the shipped cron (D2). |

## 10. Priority

**P0 — free data, no thresholds, no dependency on F5:**
Tier 0 (all six tiles — "Needs care" counts only the P0 lists below) · Tier 1.1 **Stage + Open columns only** · Tier 1.2 · Tier 1.3 · Tier 2 rows for Overdue / Due soon / Missing required / QC pending / Unowned / Blocking stage · Tier 3.1 · Tier 3.2 · Tier 5.1 · all removals in §9.

**This is the boundary for the first implementation plan.** P0 is a complete, shippable dashboard on its own and requires no config UI and no data-quality gate. P1 and P2 each get their own plan afterwards — P1 once thresholds are agreed, P2 once §8's coverage measurement comes back.

This alone answers most of the operating question without new data, without thresholds, and without touching the unreliable table.

**P1 — needs the §7 config thresholds:**
Tier 2 Abandoned · Tier 4 (all columns except Stuck).

**P2 — gated by §8:**
Tier 1.1 stuck columns · Tier 1.1b/1.1c · Tier 1.4 · Tier 4 Stuck column · Tier 5.2.

## 11. Risks

| Risk | Mitigation |
|---|---|
| **Measuring people creates unfair blame.** Records differ in difficulty; whoever holds the hard ones always looks worst. | Denominators always visible; drill-through on every number; no composite score; no "worst N" ranking. |
| **Inactivity is game-able** — one throwaway comment resets `updated_at` (F6). | Compute Abandoned from `enrollment_activity` excluding `comment_added`, and surface `Last activity type` in the record list. |
| **Stage-age may be wrong for an unknown fraction** (F5). | The §8 gate: measure first, dual-source, label fallbacks honestly, suppress thin statistics, defer if coverage is poor. |
| **Query cost.** `overview-data.ts` already pulls every non-archived record unpaginated; adding history scans multiplies it. | Bound history queries to the trailing 90 days; compute per-stage distributions once per request; keep aggregation as pure functions in `src/lib/enrollment/` (node-testable, no jsdom needed). **No new RPC and no `security definer` function** — there is an open P0 on default-PUBLIC execute grants for existing ones. |
| **Two dashboards drift apart.** | Shared pure helpers in `src/lib/enrollment/`; only the composition differs. Divergence in *calculation* is a bug; divergence in *composition* is the design. |

## 12. Out of scope for v1

- A dedicated "blocked reason" table or field. Tier 2's blocking-stage row answers the reason question at the granularity the team already uses. Whether a finer taxonomy is needed should be decided from the observed distribution, not guessed now.
- Per-stage threshold overrides (§7).
- Retiring the non-terminal "reason" stages (`Can't Contact`, `Can not get ID card`) from the stage vocabulary. That is a data migration behind `ON DELETE RESTRICT` FKs and needs its own decision.
- Any change to enrollment write paths, permissions, or payloads. This design is **read-only** over existing data, except for the new config thresholds in §7.

## 13. Open questions

1. ~~**Period definition**~~ — **RESOLVED 2026-08-09.** It is a dashboard, so it gets the full date picker: reuse the existing eight-preset `DateRangeFilter`, default `This month`. See Tier 0b, including the mandatory snapshot-vs-period split.
2. **Tier 4 for ACA** — Caller and Responsible as two tables, or one table with a role toggle?
3. **Who may see Tier 4?** The people-accountability table is sensitive. Today the Overview renders for anyone who can reach `/enrollment`; `canManageOptions` (manager) is available as a gate. Recommendation: **restrict Tier 4 to managers**, leave Tiers 0–3 and 5 visible to all.

## 14. Implementation log

The first implementation follows the priority boundary in §10. P0 is the
shippable operations dashboard; P1/P2 remain explicitly deferred rather than
displaying unvalidated stage-age or accountability metrics.

| Scope | Status | Source commit | Verification | Notes |
|---|---|---|---|---|
| P0 calculation model and overview API | Completed | `9937515` | `npx vitest run src/lib/enrollment/overview.test.ts`; `npx tsc --noEmit`; targeted ESLint | Replaced the CS-style workload snapshot with snapshot/period KPIs, needs-care union, funnel, weekly flow, cycle time, completeness, and ACA outcomes. API now accepts `from`/`to` and loads full enrollment fields plus required column configuration. |
| ACA and Medicare P0 dashboard UI | Completed | `f202992` | `npx vitest run` (63 files / 482 tests); `npm run build`; targeted ESLint; `git diff --check` | Separate dashboard compositions are rendered for each program. Medicare omits ACA-only outcome metrics and uses its reduced collectable set. |
| Overview date range | Completed | `f202992` | `npx tsc --noEmit`; `npm run build` | Reuses `DateRangeFilter`, defaults to This month, stores ranges independently per program, and visually labels snapshot vs period metrics. |
| P1 thresholds in `/config` | Deferred | — | — | Required before Abandoned and accountability metrics; current P0 uses the plan's proposed 3-day Due soon default only. |
| P2 stage-age/history metrics | Deferred | — | — | Blocked by §8 coverage measurement and fallback semantics. No stage-age number is shown until the data gate is run. |
