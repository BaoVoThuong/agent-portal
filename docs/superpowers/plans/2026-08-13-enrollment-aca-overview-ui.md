# Enrollment ACA Overview — UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the seven sections of the redesigned ACA overview against the snapshot endpoint built by the data-layer plan, replacing the ACA branch of `EnrollmentOverview.tsx` — with a staleness-threshold selector, a frozen-column person × stage matrix, a horizontally scrolling assignment queue, and honest marking of estimated stage ages.

**Architecture:** Every component is a thin `.tsx` that maps snapshot fields to markup. All derivation, formatting, pagination and column-geometry logic lives in pure `.ts` helpers with unit tests, because this repo's Vitest runs in a **node** environment and only collects `src/**/*.test.ts` — components cannot be rendered in tests at all. The composition swaps in behind the existing `program === "aca"` branch so Medicare keeps its current dashboard untouched.

**Tech Stack:** React 19 / Next.js App Router client components, Tailwind utility classes matching the existing Atlassian-ish palette in `EnrollmentOverview.tsx`, Vitest (node).

**Depends on:** `docs/superpowers/plans/2026-08-13-enrollment-aca-overview-data-layer.md` must be complete and `GET /api/enrollment/aca-overview` must return `AcaOverviewSnapshot`.

**Spec:** `docs/superpowers/specs/2026-08-13-enrollment-aca-overview-design.md`

## Global Constraints

- **ACA only.** The new composition renders under `program === "aca"`. Do not touch `MedicareEnrollmentDashboard`.
- **No component tests are possible.** `vitest.config.ts` sets `environment: "node"` and `include: ["src/**/*.test.ts"]`. Every task therefore puts its logic in a `.ts` helper with a real test, and verifies the `.tsx` with `npx tsc --noEmit` plus `npm run build`. **Do not add jsdom, do not add `.test.tsx`, do not change `vitest.config.ts`** — that is a repo-wide decision, not this feature's to make.
- **All labels in English**, matching the spec.
- **Manager-only.** The whole ACA overview renders only when `isManager` is true — the prop already exists and is already passed (`EnrollmentClient.tsx:1280`, sourced from `canManageOptions`). The API returns 403 otherwise; the UI must not depend on that to hide itself.
- **Estimated stage ages must look different from measured ones.** Any cell derived from a record with `stageAgeEstimated: true` renders muted with a `title` explaining why. Never style an estimate identically to a measurement.
- **Every section that shows workload carries a visible date-range caption.** Because all sections obey the created-in-range cohort, a narrowed range can make a fully loaded person read as `Holding 0` and rank first in the queue. The caption is the guard.
- Follow the existing visual vocabulary in `EnrollmentOverview.tsx`: `rounded-lg border border-[#e6eaf0] bg-white`, section headers via `SectionHeader`, muted text `#6b778c`, danger `#bf2600`, warning `#b76e00`, ok `#00875a`.
- Read the relevant guide in `node_modules/next/dist/docs/` before writing client components — this Next.js version's conventions may differ from the ones you know.
- Run `npx tsc --noEmit` before every commit.

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `src/lib/enrollment/aca-overview-format.ts` | Duration/percent/date formatting and the estimated-age label |
| `src/lib/enrollment/aca-overview-matrix-layout.ts` | Column geometry for the two-level matrix header |
| `src/lib/enrollment/aca-overview-paging.ts` | Page slicing for the needs-action list |
| `src/app/(authed)/enrollment/_components/aca/AcaOverview.tsx` | Composition + fetch |
| `src/app/(authed)/enrollment/_components/aca/AcaControls.tsx` | Threshold selector + range caption |
| `src/app/(authed)/enrollment/_components/aca/AcaScorecards.tsx` | The 15 tiles |
| `src/app/(authed)/enrollment/_components/aca/AcaStageTable.tsx` | Stage table |
| `src/app/(authed)/enrollment/_components/aca/AcaActionList.tsx` | Needs-action list + pagination |
| `src/app/(authed)/enrollment/_components/aca/AcaPeopleTable.tsx` | People table |
| `src/app/(authed)/enrollment/_components/aca/AcaMatrix.tsx` | Person × stage matrix |
| `src/app/(authed)/enrollment/_components/aca/AcaQueue.tsx` | Assignment queue strip |
| `src/app/(authed)/enrollment/_components/aca/AcaUnassigned.tsx` | Unassigned tasks table |

**Modified:**

| File | Change |
|---|---|
| `src/app/(authed)/enrollment/_components/EnrollmentOverview.tsx` | ACA branch delegates to `AcaOverview`; Medicare branch unchanged |
| `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx` | Threshold state; overview date range defaults to All dates |

---

## Task 1: Formatting helpers

**Files:**
- Create: `src/lib/enrollment/aca-overview-format.ts`
- Test: `src/lib/enrollment/aca-overview-format.test.ts`

**Interfaces:**
- Produces: `formatDays(value)`, `formatPercent(value)`, `formatCount(value)`, `formatRangeCaption(from, to)`, `ESTIMATED_AGE_TITLE`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  ESTIMATED_AGE_TITLE,
  formatCount,
  formatDays,
  formatPercent,
  formatRangeCaption,
} from "./aca-overview-format";

describe("formatDays", () => {
  it("renders one decimal place with a d suffix", () => {
    expect(formatDays(3.44)).toBe("3.4d");
  });

  it("renders a dash for null so an empty cell is never mistaken for zero", () => {
    expect(formatDays(null)).toBe("—");
  });

  it("renders exact zero as 0d, not as a dash", () => {
    expect(formatDays(0)).toBe("0d");
  });
});

describe("formatPercent", () => {
  it("renders one decimal place", () => {
    expect(formatPercent(15.75)).toBe("15.8%");
  });

  it("renders a dash for null", () => {
    expect(formatPercent(null)).toBe("—");
  });
});

describe("formatCount", () => {
  it("renders a dash for null so blanked terminal cells read as not-applicable", () => {
    expect(formatCount(null)).toBe("—");
    expect(formatCount(0)).toBe("0");
  });
});

describe("formatRangeCaption", () => {
  it("says All dates when the range is open", () => {
    expect(formatRangeCaption("", "")).toBe("All dates");
  });

  it("collapses a single-day range to one date", () => {
    expect(formatRangeCaption("2026-08-13", "2026-08-13")).toBe("Aug 13, 2026");
  });

  it("renders a span with an en dash", () => {
    expect(formatRangeCaption("2026-08-01", "2026-08-13")).toBe("Aug 1, 2026 – Aug 13, 2026");
  });
});

describe("ESTIMATED_AGE_TITLE", () => {
  it("explains why the value is muted", () => {
    expect(ESTIMATED_AGE_TITLE.toLowerCase()).toContain("estimated");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/enrollment/aca-overview-format.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
/**
 * Shown on any stage-age value reconstructed by the 2026-08-09 backfill rather
 * than measured from a real transition. The owner chose to count those records
 * rather than hide them, so the honesty is paid here instead.
 */
export const ESTIMATED_AGE_TITLE =
  "Estimated: this record predates stage-time tracking, so its stage age is derived from its creation date.";

/** Em dash, not 0: a blank cell and a genuine zero mean different things. */
const EMPTY = "—";

export function formatDays(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return EMPTY;
  return `${Math.round(value * 10) / 10}d`;
}

export function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return EMPTY;
  return `${Math.round(value * 10) / 10}%`;
}

export function formatCount(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return EMPTY;
  return String(value);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

export function formatRangeCaption(from: string, to: string): string {
  if (!from && !to) return "All dates";
  if (from && from === to) return formatDate(from);
  if (from && to) return `${formatDate(from)} – ${formatDate(to)}`;
  return from ? `From ${formatDate(from)}` : `Until ${formatDate(to)}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/enrollment/aca-overview-format.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/enrollment/aca-overview-format.ts src/lib/enrollment/aca-overview-format.test.ts
git commit -m "feat(enrollment): add ACA overview formatting helpers"
```

---

## Task 2: Matrix layout and paging helpers

**Files:**
- Create: `src/lib/enrollment/aca-overview-matrix-layout.ts`
- Test: `src/lib/enrollment/aca-overview-matrix-layout.test.ts`
- Create: `src/lib/enrollment/aca-overview-paging.ts`
- Test: `src/lib/enrollment/aca-overview-paging.test.ts`

**Interfaces:**
- Produces: `matrixGridTemplate(stageCount)`, `matrixColumnBoundaries(stageCount)`, `sliceRows(rows, page, pageSize)`, `pageCount(total, pageSize)`, `ACA_ACTION_PAGE_SIZE`

- [ ] **Step 1: Write the failing tests**

`aca-overview-matrix-layout.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { matrixColumnBoundaries, matrixGridTemplate } from "./aca-overview-matrix-layout";

describe("matrixGridTemplate", () => {
  it("puts the frozen person column first, then three columns per stage", () => {
    expect(matrixGridTemplate(2)).toBe("14rem repeat(6, 4.5rem)");
  });

  it("still emits a valid template with no stages", () => {
    expect(matrixGridTemplate(0)).toBe("14rem");
  });
});

describe("matrixColumnBoundaries", () => {
  it("marks the first data column of each stage group so a heavy rule can be drawn", () => {
    expect(matrixColumnBoundaries(3)).toEqual([0, 3, 6]);
  });

  it("is empty with no stages", () => {
    expect(matrixColumnBoundaries(0)).toEqual([]);
  });
});
```

`aca-overview-paging.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ACA_ACTION_PAGE_SIZE, pageCount, sliceRows } from "./aca-overview-paging";

describe("sliceRows", () => {
  const rows = Array.from({ length: 55 }, (_, index) => index);

  it("returns the requested page", () => {
    expect(sliceRows(rows, 1, 25)).toEqual(rows.slice(25, 50));
  });

  it("clamps a page past the end to the last page rather than returning empty", () => {
    expect(sliceRows(rows, 99, 25)).toEqual(rows.slice(50));
  });

  it("clamps a negative page to the first", () => {
    expect(sliceRows(rows, -3, 25)).toEqual(rows.slice(0, 25));
  });

  it("handles an empty list", () => {
    expect(sliceRows([], 0, 25)).toEqual([]);
  });
});

describe("pageCount", () => {
  it("rounds up", () => {
    expect(pageCount(55, 25)).toBe(3);
  });

  it("is 1 for an empty list so the pager still renders", () => {
    expect(pageCount(0, 25)).toBe(1);
  });
});

describe("ACA_ACTION_PAGE_SIZE", () => {
  it("is a sane page size", () => {
    expect(ACA_ACTION_PAGE_SIZE).toBe(25);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/enrollment/aca-overview-matrix-layout.test.ts src/lib/enrollment/aca-overview-paging.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write both implementations**

`aca-overview-matrix-layout.ts`:

```ts
/** Person column width; frozen while the stage columns scroll horizontally. */
const PERSON_COLUMN = "14rem";
const DATA_COLUMN = "4.5rem";
export const MATRIX_COLUMNS_PER_STAGE = 3; // Tasks · Stuck · Silent

export function matrixGridTemplate(stageCount: number): string {
  if (stageCount <= 0) return PERSON_COLUMN;
  const dataColumns = stageCount * MATRIX_COLUMNS_PER_STAGE;
  return `${PERSON_COLUMN} repeat(${dataColumns}, ${DATA_COLUMN})`;
}

/**
 * Zero-based indexes of the data column that starts each stage group. The
 * matrix is unreadable without a heavy rule at these positions: 30 unlabelled
 * numeric columns read as one grey mass.
 */
export function matrixColumnBoundaries(stageCount: number): number[] {
  return Array.from({ length: Math.max(0, stageCount) }, (_, index) => index * MATRIX_COLUMNS_PER_STAGE);
}
```

`aca-overview-paging.ts`:

```ts
export const ACA_ACTION_PAGE_SIZE = 25;

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/**
 * Clamps rather than returning empty. A stale page index — after the threshold
 * changes and the list shrinks — must show the last page, not a blank table
 * that looks like a failed request.
 */
export function sliceRows<T>(rows: readonly T[], page: number, pageSize: number): T[] {
  const lastPage = pageCount(rows.length, pageSize) - 1;
  const safePage = Math.min(Math.max(0, page), lastPage);
  const start = safePage * pageSize;
  return rows.slice(start, start + pageSize);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/enrollment/aca-overview-matrix-layout.test.ts src/lib/enrollment/aca-overview-paging.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/enrollment/aca-overview-matrix-layout.ts src/lib/enrollment/aca-overview-matrix-layout.test.ts src/lib/enrollment/aca-overview-paging.ts src/lib/enrollment/aca-overview-paging.test.ts
git commit -m "feat(enrollment): add ACA overview matrix layout and paging helpers"
```

---

## Task 3: Controls — threshold selector and range caption

**Files:**
- Create: `src/app/(authed)/enrollment/_components/aca/AcaControls.tsx`

**Interfaces:**
- Consumes: `ACA_OVERVIEW_THRESHOLD_DAYS`, `AcaOverviewThresholdDays` from `@/lib/enrollment/aca-overview-types`; `formatRangeCaption` from `@/lib/enrollment/aca-overview-format`
- Produces: `<AcaControls thresholdDays onThresholdChange from to generatedAt onRefresh />`, and `<RangeCaption from to />` re-exported for the sections that need it

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { RefreshCw } from "lucide-react";
import {
  ACA_OVERVIEW_THRESHOLD_DAYS,
  type AcaOverviewThresholdDays,
} from "@/lib/enrollment/aca-overview-types";
import { formatRangeCaption } from "@/lib/enrollment/aca-overview-format";

export function RangeCaption({ from, to }: { from: string; to: string }) {
  return (
    <span className="rounded bg-[#f4f5f7] px-2 py-0.5 text-[11px] font-bold text-[#6b778c]">
      {formatRangeCaption(from, to)}
    </span>
  );
}

export function AcaControls({
  thresholdDays,
  onThresholdChange,
  from,
  to,
  generatedAt,
  onRefresh,
}: {
  thresholdDays: AcaOverviewThresholdDays;
  onThresholdChange: (value: AcaOverviewThresholdDays) => void;
  from: string;
  to: string;
  generatedAt: string;
  onRefresh: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wide text-[#6b778c]">
          Stale after
        </span>
        <div className="inline-flex overflow-hidden rounded border border-[#cfd8e5]">
          {ACA_OVERVIEW_THRESHOLD_DAYS.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => onThresholdChange(value)}
              aria-pressed={value === thresholdDays}
              className={`px-2.5 py-1 text-xs font-bold transition ${
                value === thresholdDays
                  ? "bg-[#0c66e4] text-white"
                  : "bg-white text-[#344054] hover:bg-[#f8fafc]"
              }`}
            >
              {value}d
            </button>
          ))}
        </div>
        {/* Every section obeys the date range, so the reader must always be able
            to see which slice they are looking at. Without this a fully loaded
            person can read as Holding 0 and rank first in the queue. */}
        <RangeCaption from={from} to={to} />
      </div>

      <div className="flex items-center gap-3">
        <p className="text-xs font-medium text-[#6b778c]">
          As of {new Date(generatedAt).toLocaleString()}
        </p>
        <button
          type="button"
          onClick={onRefresh}
          className="inline-flex h-8 items-center gap-1.5 rounded border border-[#cfd8e5] bg-white px-2.5 text-xs font-bold text-[#344054] hover:bg-[#f8fafc]"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(authed)/enrollment/_components/aca/AcaControls.tsx"
git commit -m "feat(enrollment): add ACA overview controls"
```

---

## Task 4: Scorecards

**Files:**
- Create: `src/app/(authed)/enrollment/_components/aca/AcaScorecards.tsx`

**Interfaces:**
- Consumes: `AcaOverviewScorecards`; `formatDays`, `formatPercent` from the format helper
- Produces: `<AcaScorecards scorecards thresholdDays />`

- [ ] **Step 1: Write the component**

```tsx
"use client";

import type { AcaOverviewScorecards } from "@/lib/enrollment/aca-overview-types";
import { formatDays } from "@/lib/enrollment/aca-overview-format";

type Tone = "default" | "ok" | "warning" | "danger";

function Tile({
  label,
  value,
  detail,
  tone = "default",
}: {
  label: string;
  value: string | number;
  detail?: string;
  tone?: Tone;
}) {
  const valueClass = {
    default: "text-[#172b4d]",
    ok: "text-[#00875a]",
    warning: "text-[#b76e00]",
    danger: "text-[#bf2600]",
  }[tone];
  return (
    <div className="rounded border border-[#ebecf0] bg-[#fafbfc] px-3 py-2.5">
      <p className="text-[10px] font-bold uppercase tracking-wide text-[#8993a4]">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${valueClass}`}>{value}</p>
      {detail ? <p className="mt-0.5 text-[11px] font-medium text-[#6b778c]">{detail}</p> : null}
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-[#e6eaf0] bg-white p-3">
      <h2 className="mb-2 px-1 text-[11px] font-bold uppercase tracking-wide text-[#6b778c]">
        {title}
      </h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">{children}</div>
    </section>
  );
}

export function AcaScorecards({
  scorecards,
  thresholdDays,
}: {
  scorecards: AcaOverviewScorecards;
  thresholdDays: number;
}) {
  const s = scorecards;
  return (
    <div className="space-y-3">
      <Group title="Volume">
        <Tile label="Total tasks" value={s.totalTasks} />
        <Tile label="Open" value={s.open} />
        <Tile label="Done" value={s.done} tone="ok" />
        <Tile label="Terminated" value={s.terminated} tone="danger" />
        <Tile
          label="Unassigned"
          value={s.unassigned}
          tone={s.unassigned ? "warning" : "ok"}
        />
      </Group>

      <Group title="Attention">
        <Tile
          label={`No activity ≥${thresholdDays}d`}
          value={s.noActivity}
          tone={s.noActivity ? "warning" : "ok"}
        />
        <Tile
          label={`Stuck in stage ≥${thresholdDays}d`}
          value={s.stuckInStage}
          tone={s.stuckInStage ? "warning" : "ok"}
        />
        <Tile label="Can't Contact" value={s.cantContact} />
        <Tile label="Can not get ID card" value={s.cannotGetIdCard} />
        <Tile label="Median open age" value={formatDays(s.medianOpenAgeDays)} />
      </Group>

      <Group title="Speed and staffing">
        <Tile label="Median time to done" value={formatDays(s.medianTimeToDoneDays)} />
        <Tile
          label="Slowest stage"
          value={s.slowestStage ? formatDays(s.slowestStage.medianDays) : "—"}
          detail={s.slowestStage?.stageLabel ?? "Not enough samples"}
        />
        <Tile label="Median time in stage" value={formatDays(s.medianTimeInCurrentStageDays)} />
        <Tile label="Active people" value={s.activePeople} />
        <Tile
          label="Avg tasks per person"
          value={s.avgTasksPerPerson === null ? "—" : Math.round(s.avgTasksPerPerson * 10) / 10}
        />
      </Group>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(authed)/enrollment/_components/aca/AcaScorecards.tsx"
git commit -m "feat(enrollment): add ACA overview scorecards"
```

---

## Task 5: Stage table

**Files:**
- Create: `src/app/(authed)/enrollment/_components/aca/AcaStageTable.tsx`

**Interfaces:**
- Consumes: `AcaOverviewStageRow`; `formatCount`, `formatDays`, `formatPercent`
- Produces: `<AcaStageTable rows thresholdDays />`

- [ ] **Step 1: Write the component**

```tsx
"use client";

import type { AcaOverviewStageRow } from "@/lib/enrollment/aca-overview-types";
import { formatCount, formatDays, formatPercent } from "@/lib/enrollment/aca-overview-format";

const GRID = "grid grid-cols-[minmax(12rem,1fr)_5rem_5rem_6rem_6rem_6rem_6rem]";

export function AcaStageTable({
  rows,
  thresholdDays,
}: {
  rows: AcaOverviewStageRow[];
  thresholdDays: number;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-[#e6eaf0] bg-white">
      <div className="px-4 py-3">
        <h2 className="text-sm font-bold text-[#172b4d]">Pipeline by stage</h2>
        <p className="mt-1 text-xs text-[#667085]">
          Unassigned records are listed in their own row, not inside their stage.
          Stages that end the pipeline show no waiting figures.
        </p>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[52rem]">
          <div
            className={`${GRID} border-y border-[#ebecf0] bg-[#fafbfc] px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-[#6b778c]`}
          >
            <span>Stage</span>
            <span className="text-right">In stage</span>
            <span className="text-right">%</span>
            <span className="text-right">Median wait</span>
            <span className="text-right">Longest</span>
            <span className="text-right">Stuck ≥{thresholdDays}d</span>
            <span className="text-right">Silent ≥{thresholdDays}d</span>
          </div>

          <div className="divide-y divide-[#ebecf0]">
            {rows.map((row) => (
              <div
                key={row.stageId ?? "unassigned"}
                className={`${GRID} items-center px-4 py-2.5 text-sm ${
                  row.stageId === null ? "bg-[#fffaf0]" : ""
                } ${row.isTerminal ? "text-[#8993a4]" : "text-[#172b4d]"}`}
              >
                <span className="flex min-w-0 items-center gap-2 font-semibold">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-sm"
                    style={{ backgroundColor: row.stageColor ?? "#c1c7d0" }}
                  />
                  <span className="truncate">{row.stageLabel}</span>
                </span>
                <span className="text-right font-bold">{row.inStage}</span>
                <span className="text-right">{formatPercent(row.sharePercent)}</span>
                <span className="text-right">{formatDays(row.medianWaitDays)}</span>
                <span className="text-right">{formatDays(row.longestWaitDays)}</span>
                <span
                  className={`text-right font-bold ${row.stuckCount ? "text-[#b76e00]" : ""}`}
                >
                  {formatCount(row.stuckCount)}
                </span>
                <span
                  className={`text-right font-bold ${row.silentCount ? "text-[#bf2600]" : ""}`}
                >
                  {formatCount(row.silentCount)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(authed)/enrollment/_components/aca/AcaStageTable.tsx"
git commit -m "feat(enrollment): add ACA overview stage table"
```

---

## Task 6: Needs-action list

**Files:**
- Create: `src/app/(authed)/enrollment/_components/aca/AcaActionList.tsx`

**Interfaces:**
- Consumes: `AcaOverviewActionRow`; `ACA_ACTION_PAGE_SIZE`, `pageCount`, `sliceRows`; `ESTIMATED_AGE_TITLE`, `formatDays`; `personLabel` from `@/lib/tasks/people`
- Produces: `<AcaActionList rows onOpenRecord from to />`

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useEffect, useState } from "react";
import type { AcaOverviewActionRow } from "@/lib/enrollment/aca-overview-types";
import {
  ACA_ACTION_PAGE_SIZE,
  pageCount,
  sliceRows,
} from "@/lib/enrollment/aca-overview-paging";
import { ESTIMATED_AGE_TITLE, formatDays } from "@/lib/enrollment/aca-overview-format";
import { personLabel } from "@/lib/tasks/people";
import { RangeCaption } from "./AcaControls";

const GRID =
  "grid grid-cols-[7rem_minmax(10rem,1fr)_8rem_9rem_8rem_minmax(9rem,1fr)_6rem_6rem]";

export function AcaActionList({
  rows,
  onOpenRecord,
  from,
  to,
}: {
  rows: AcaOverviewActionRow[];
  onOpenRecord: (id: string) => void;
  from: string;
  to: string;
}) {
  const [page, setPage] = useState(0);
  const total = pageCount(rows.length, ACA_ACTION_PAGE_SIZE);

  // The threshold selector can shrink the list under a stale page index.
  useEffect(() => {
    setPage((current) => Math.min(current, total - 1));
  }, [total]);

  const visible = sliceRows(rows, page, ACA_ACTION_PAGE_SIZE);

  return (
    <section className="overflow-hidden rounded-lg border border-[#e6eaf0] bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <div>
          <h2 className="text-sm font-bold text-[#172b4d]">Needs action</h2>
          <p className="mt-1 text-xs text-[#667085]">
            Sorted worst first. Read the two day columns together: a high stage age
            with recent activity is a blocked record, not a neglected one.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <RangeCaption from={from} to={to} />
          <span className="text-xs font-bold text-[#6b778c]">{rows.length} records</span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[62rem]">
          <div
            className={`${GRID} border-y border-[#ebecf0] bg-[#fafbfc] px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-[#6b778c]`}
          >
            <span>Task ID</span>
            <span>Client</span>
            <span>Agent</span>
            <span>Responsible</span>
            <span>Caller</span>
            <span>Stage</span>
            <span className="text-right">Days in stage</span>
            <span className="text-right">Days silent</span>
          </div>

          <div className="divide-y divide-[#ebecf0]">
            {visible.map((row) => (
              <button
                key={row.recordId}
                type="button"
                onClick={() => onOpenRecord(row.recordId)}
                className={`${GRID} w-full items-center px-4 py-2.5 text-left text-sm hover:bg-[#f4f9ff]`}
              >
                <span className="font-mono text-xs text-[#6b778c]">{row.taskId ?? "—"}</span>
                <span className="truncate font-semibold text-[#172b4d]">
                  {row.clientName || "Unnamed client"}
                </span>
                <span className="truncate text-[#42526e]">{personLabel(row.agentEmail)}</span>
                <span className="truncate text-[#42526e]">
                  {row.responsibleEmail ? personLabel(row.responsibleEmail) : "—"}
                </span>
                <span className="truncate text-[#42526e]">{personLabel(row.callerEmail)}</span>
                <span className="truncate text-[#42526e]">{row.stageLabel ?? "No stage"}</span>
                <span
                  className={`text-right font-bold ${
                    row.stageAgeEstimated ? "text-[#8993a4] italic" : "text-[#172b4d]"
                  }`}
                  title={row.stageAgeEstimated ? ESTIMATED_AGE_TITLE : undefined}
                >
                  {formatDays(row.daysInStage)}
                </span>
                <span className="text-right font-bold text-[#172b4d]">
                  {formatDays(row.daysSilent)}
                </span>
              </button>
            ))}
            {visible.length === 0 ? (
              <p className="px-4 py-6 text-sm text-[#97a0af]">Nothing needs action right now.</p>
            ) : null}
          </div>
        </div>
      </div>

      {total > 1 ? (
        <div className="flex items-center justify-between border-t border-[#ebecf0] px-4 py-2.5">
          <button
            type="button"
            onClick={() => setPage((current) => Math.max(0, current - 1))}
            disabled={page === 0}
            className="rounded border border-[#cfd8e5] bg-white px-2.5 py-1 text-xs font-bold text-[#344054] disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-xs font-bold text-[#6b778c]">
            Page {page + 1} of {total}
          </span>
          <button
            type="button"
            onClick={() => setPage((current) => Math.min(total - 1, current + 1))}
            disabled={page >= total - 1}
            className="rounded border border-[#cfd8e5] bg-white px-2.5 py-1 text-xs font-bold text-[#344054] disabled:opacity-40"
          >
            Next
          </button>
        </div>
      ) : null}
    </section>
  );
}
```

**Before writing this, open `src/lib/tasks/people.ts` and confirm `personLabel`'s exact signature.** The UI must show display names rather than raw emails; if the export is named differently, use the real one rather than formatting emails inline here.

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(authed)/enrollment/_components/aca/AcaActionList.tsx"
git commit -m "feat(enrollment): add ACA overview needs-action list"
```

---

## Task 7: People table

**Files:**
- Create: `src/app/(authed)/enrollment/_components/aca/AcaPeopleTable.tsx`

**Interfaces:**
- Consumes: `AcaOverviewPeopleRow`; `formatDays`; `personLabel`; `RangeCaption`
- Produces: `<AcaPeopleTable rows thresholdDays from to />`

- [ ] **Step 1: Write the component**

```tsx
"use client";

import type { AcaOverviewPeopleRow } from "@/lib/enrollment/aca-overview-types";
import { formatDays } from "@/lib/enrollment/aca-overview-format";
import { personLabel } from "@/lib/tasks/people";
import { RangeCaption } from "./AcaControls";

const GRID = "grid grid-cols-[minmax(10rem,1fr)_5rem_7rem_7rem_7rem_6rem_6rem]";

/** Always paired with its denominator. A bare error count invites unfair reads. */
function WithShare({ value, holding, tone }: { value: number; holding: number; tone: string }) {
  const share = holding === 0 ? null : Math.round((value / holding) * 100);
  return (
    <span className={`text-right font-bold ${value ? tone : "text-[#172b4d]"}`}>
      {value}
      {share === null ? "" : ` (${share}%)`}
    </span>
  );
}

export function AcaPeopleTable({
  rows,
  thresholdDays,
  from,
  to,
}: {
  rows: AcaOverviewPeopleRow[];
  thresholdDays: number;
  from: string;
  to: string;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-[#e6eaf0] bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <div>
          <h2 className="text-sm font-bold text-[#172b4d]">By person</h2>
          <p className="mt-1 text-xs text-[#667085]">
            Every error count is shown against what that person is holding. Read this
            with the matrix below before drawing conclusions — a bad percentage is
            often a bad stage, not a bad worker.
          </p>
        </div>
        <RangeCaption from={from} to={to} />
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[50rem]">
          <div
            className={`${GRID} border-y border-[#ebecf0] bg-[#fafbfc] px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-[#6b778c]`}
          >
            <span>Person</span>
            <span className="text-right">Holding</span>
            <span className="text-right">Stuck ≥{thresholdDays}d</span>
            <span className="text-right">Silent ≥{thresholdDays}d</span>
            <span className="text-right">Median wait</span>
            <span className="text-right">Longest</span>
            <span className="text-right">Done</span>
          </div>

          <div className="divide-y divide-[#ebecf0]">
            {rows.map((row) => {
              const isTeam = row.email === "__team__";
              const isUnassigned = row.email === null;
              return (
                <div
                  key={row.email ?? "unassigned"}
                  className={`${GRID} items-center px-4 py-2.5 text-sm ${
                    isTeam ? "bg-[#f4f5f7] font-bold" : ""
                  } ${isUnassigned ? "bg-[#fffaf0] italic text-[#6b778c]" : "text-[#172b4d]"}`}
                >
                  <span className="truncate font-semibold">
                    {isTeam || isUnassigned ? row.name : personLabel(row.email)}
                  </span>
                  <span className="text-right font-bold">{row.holding}</span>
                  <WithShare value={row.stuck} holding={row.holding} tone="text-[#b76e00]" />
                  <WithShare value={row.silent} holding={row.holding} tone="text-[#bf2600]" />
                  <span className="text-right">{formatDays(row.medianWaitDays)}</span>
                  <span className="text-right">{formatDays(row.longestWaitDays)}</span>
                  <span className="text-right font-bold text-[#00875a]">{row.doneInPeriod}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(authed)/enrollment/_components/aca/AcaPeopleTable.tsx"
git commit -m "feat(enrollment): add ACA overview people table"
```

---

## Task 8: Person × Stage matrix

**Files:**
- Create: `src/app/(authed)/enrollment/_components/aca/AcaMatrix.tsx`

**Interfaces:**
- Consumes: `AcaOverviewMatrix`, `AcaOverviewMatrixCell`; `matrixGridTemplate`, `MATRIX_COLUMNS_PER_STAGE`; `formatDays`; `personLabel`
- Produces: `<AcaMatrix matrix thresholdDays holdingTotal />`

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useState } from "react";
import type {
  AcaOverviewMatrix,
  AcaOverviewMatrixCell,
} from "@/lib/enrollment/aca-overview-types";
import {
  MATRIX_COLUMNS_PER_STAGE,
  matrixGridTemplate,
} from "@/lib/enrollment/aca-overview-matrix-layout";
import { formatDays } from "@/lib/enrollment/aca-overview-format";
import { personLabel } from "@/lib/tasks/people";

/** Heavy rule at the first column of each stage group; light between sub-columns. */
function cellBorder(columnIndex: number): string {
  return columnIndex % MATRIX_COLUMNS_PER_STAGE === 0
    ? "border-l-2 border-l-[#c1c7d0]"
    : "border-l border-l-[#ebecf0]";
}

function Cells({ cells, tone }: { cells: AcaOverviewMatrixCell[]; tone: string }) {
  return (
    <>
      {cells.flatMap((cell, stageIndex) => {
        const base = stageIndex * MATRIX_COLUMNS_PER_STAGE;
        return [
          <div key={`${stageIndex}-t`} className={`px-2 py-1.5 text-right ${cellBorder(base)} ${tone}`}>
            {cell.tasks || ""}
          </div>,
          <div
            key={`${stageIndex}-s`}
            className={`px-2 py-1.5 text-right ${cellBorder(base + 1)} ${
              cell.stuck ? "font-bold text-[#b76e00]" : tone
            }`}
          >
            {cell.stuck || ""}
            {cell.stuck ? (
              <span className="block text-[10px] font-medium text-[#8993a4]">
                {formatDays(cell.medianStuckDays)}
              </span>
            ) : null}
          </div>,
          <div
            key={`${stageIndex}-l`}
            className={`px-2 py-1.5 text-right ${cellBorder(base + 2)} ${
              cell.silent ? "font-bold text-[#bf2600]" : tone
            }`}
          >
            {cell.silent || ""}
          </div>,
        ];
      })}
    </>
  );
}

export function AcaMatrix({
  matrix,
  thresholdDays,
  holdingTotal,
}: {
  matrix: AcaOverviewMatrix;
  thresholdDays: number;
  holdingTotal: number;
}) {
  const [selected, setSelected] = useState<string>("");
  const template = matrixGridTemplate(matrix.stageLabels.length);
  const rows = selected ? matrix.rows.filter((row) => row.email === selected) : matrix.rows;
  const matrixTotal = matrix.totals.reduce((sum, cell) => sum + cell.tasks, 0);

  return (
    <section className="overflow-hidden rounded-lg border border-[#e6eaf0] bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <div>
          <h2 className="text-sm font-bold text-[#172b4d]">Person × stage</h2>
          <p className="mt-1 text-xs text-[#667085]">
            Each stage shows Tasks · Stuck ≥{thresholdDays}d · Silent ≥{thresholdDays}d.
            Compare a person against the Total row of the same stage, never against
            another stage.
          </p>
        </div>
        <select
          value={selected}
          onChange={(event) => setSelected(event.target.value)}
          className="h-8 rounded border border-[#cfd8e5] bg-white px-2 text-xs font-bold text-[#475467] outline-none"
        >
          <option value="">All people</option>
          {matrix.rows.map((row) => (
            <option key={row.email ?? ""} value={row.email ?? ""}>
              {row.email ? personLabel(row.email) : "Unassigned"}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-max">
          {/* Two-level header, both rows sticky vertically; person column sticky horizontally. */}
          <div className="grid" style={{ gridTemplateColumns: template }}>
            <div className="sticky left-0 z-20 bg-[#fafbfc] px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-[#6b778c]">
              Responsible
            </div>
            {matrix.stageLabels.map((label, index) => (
              <div
                key={label}
                style={{ gridColumn: `span ${MATRIX_COLUMNS_PER_STAGE}` }}
                className={`truncate bg-[#fafbfc] px-2 py-1.5 text-[11px] font-bold text-[#172b4d] ${cellBorder(
                  index * MATRIX_COLUMNS_PER_STAGE
                )}`}
                title={label}
              >
                {label}
              </div>
            ))}

            <div className="sticky left-0 z-20 border-y border-[#ebecf0] bg-[#fafbfc] px-3 py-1.5" />
            {matrix.stageLabels.flatMap((label, stageIndex) =>
              ["Tasks", "Stuck", "Silent"].map((sub, subIndex) => (
                <div
                  key={`${label}-${sub}`}
                  className={`border-y border-[#ebecf0] bg-[#fafbfc] px-2 py-1.5 text-right text-[10px] font-bold uppercase text-[#8993a4] ${cellBorder(
                    stageIndex * MATRIX_COLUMNS_PER_STAGE + subIndex
                  )}`}
                >
                  {sub}
                </div>
              ))
            )}

            {rows.map((row) => (
              <div key={row.email ?? "unassigned"} className="contents">
                <div className="sticky left-0 z-10 truncate border-b border-[#ebecf0] bg-white px-3 py-1.5 text-sm font-semibold text-[#172b4d]">
                  {row.email ? personLabel(row.email) : "Unassigned"}
                </div>
                <Cells cells={row.cells} tone="text-[#42526e]" />
              </div>
            ))}

            {/* The Total row is what separates "this person is slow" from "this
                stage is broken". It is not decoration. */}
            <div className="sticky left-0 z-10 border-t-2 border-[#c1c7d0] bg-[#f4f5f7] px-3 py-1.5 text-sm font-bold text-[#172b4d]">
              Total
            </div>
            <Cells cells={matrix.totals} tone="font-bold text-[#172b4d]" />
          </div>
        </div>
      </div>

      {matrixTotal !== holdingTotal ? (
        <p className="border-t border-[#ebecf0] px-4 py-2 text-[11px] font-medium text-[#6b778c]">
          Showing {matrixTotal} of {holdingTotal} assigned records. The difference sits on
          stages that end the pipeline, which are not shown here.
        </p>
      ) : null}
    </section>
  );
}
```

The caption at the bottom is mandatory: the matrix covers running stages only, so its total is lower than the people table's `Holding` total, and without an explanation that reads as missing data.

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(authed)/enrollment/_components/aca/AcaMatrix.tsx"
git commit -m "feat(enrollment): add ACA overview person-stage matrix"
```

---

## Task 9: Assignment queue

**Files:**
- Create: `src/app/(authed)/enrollment/_components/aca/AcaQueue.tsx`

**Interfaces:**
- Consumes: `AcaOverviewQueueCard`; `personLabel`; `RangeCaption`
- Produces: `<AcaQueue cards from to />`

- [ ] **Step 1: Write the component**

```tsx
"use client";

import type { AcaOverviewQueueCard } from "@/lib/enrollment/aca-overview-types";
import { personLabel } from "@/lib/tasks/people";
import { RangeCaption } from "./AcaControls";

function formatLastAssigned(value: string | null): string {
  if (!value) return "Never";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(
    new Date(value)
  );
}

export function AcaQueue({
  cards,
  from,
  to,
}: {
  cards: AcaOverviewQueueCard[];
  from: string;
  to: string;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-[#e6eaf0] bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <div>
          <h2 className="text-sm font-bold text-[#172b4d]">Assignment queue</h2>
          <p className="mt-1 text-xs text-[#667085]">
            Turn order: longest since their last assignment first. Holding and Stuck
            are shown but do not affect the order — check them before assigning.
          </p>
        </div>
        <RangeCaption from={from} to={to} />
      </div>

      {cards.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-[#667085]">
          Nobody is enabled in the queue.
        </p>
      ) : (
        <div className="overflow-x-auto px-4 py-4">
          <div className="flex min-w-max gap-3">
            {cards.map((card, index) => (
              <div
                key={card.email}
                className="w-[15.5rem] shrink-0 rounded border border-[#dbe7f5] bg-[#fbfdff] p-3"
              >
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#0c66e4] text-xs font-bold text-white">
                    {index + 1}
                  </span>
                  <span className="min-w-0 truncate text-sm font-bold text-[#172b4d]">
                    {personLabel(card.email)}
                  </span>
                </div>
                <div className="mt-3 grid gap-1.5 text-xs">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[#667085]">Last assign</span>
                    <span
                      className={`font-bold ${
                        card.lastAssignedAt ? "text-[#172b4d]" : "text-[#0c66e4]"
                      }`}
                    >
                      {formatLastAssigned(card.lastAssignedAt)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[#667085]">Holding</span>
                    <span className="font-bold text-[#172b4d]">{card.holding}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[#667085]">Stuck</span>
                    <span
                      className={`font-bold ${card.stuck ? "text-[#b76e00]" : "text-[#172b4d]"}`}
                    >
                      {card.stuck}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
```

No **Edit queue** control in this task — membership editing needs its own endpoint and belongs with the write-surface plan. The queue reads `queueEnabled` from the roster the API already resolves.

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(authed)/enrollment/_components/aca/AcaQueue.tsx"
git commit -m "feat(enrollment): add ACA overview assignment queue"
```

---

## Task 10: Unassigned tasks table

**Files:**
- Create: `src/app/(authed)/enrollment/_components/aca/AcaUnassigned.tsx`

**Interfaces:**
- Consumes: `AcaOverviewActionRow`; `formatDays`, `ESTIMATED_AGE_TITLE`; `personLabel`
- Produces: `<AcaUnassigned rows onOpenRecord />`

Read-only in this plan. The `Assign to` picker is the write surface and belongs to its own plan, which must first extend the row type with `updated_at` (the PATCH endpoint requires `expected_updated_at`) and batch the per-record permission check.

- [ ] **Step 1: Write the component**

```tsx
"use client";

import type { AcaOverviewActionRow } from "@/lib/enrollment/aca-overview-types";
import { ESTIMATED_AGE_TITLE, formatDays } from "@/lib/enrollment/aca-overview-format";
import { personLabel } from "@/lib/tasks/people";

const GRID = "grid grid-cols-[7rem_minmax(10rem,1fr)_8rem_8rem_minmax(9rem,1fr)_7rem]";

export function AcaUnassigned({
  rows,
  onOpenRecord,
}: {
  rows: AcaOverviewActionRow[];
  onOpenRecord: (id: string) => void;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-[#e6eaf0] bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <div>
          <h2 className="text-sm font-bold text-[#172b4d]">Unassigned</h2>
          <p className="mt-1 text-xs text-[#667085]">
            Oldest in stage first. A record deep in the pipeline with nobody
            responsible is a data problem, not a queue item — check it.
          </p>
        </div>
        <span className="text-xs font-bold text-[#6b778c]">{rows.length} records</span>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[48rem]">
          <div
            className={`${GRID} border-y border-[#ebecf0] bg-[#fafbfc] px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-[#6b778c]`}
          >
            <span>Task ID</span>
            <span>Client</span>
            <span>Agent</span>
            <span>Caller</span>
            <span>Stage</span>
            <span className="text-right">Days in stage</span>
          </div>

          <div className="divide-y divide-[#ebecf0]">
            {rows.map((row) => (
              <button
                key={row.recordId}
                type="button"
                onClick={() => onOpenRecord(row.recordId)}
                className={`${GRID} w-full items-center px-4 py-2.5 text-left text-sm hover:bg-[#f4f9ff]`}
              >
                <span className="font-mono text-xs text-[#6b778c]">{row.taskId ?? "—"}</span>
                <span className="truncate font-semibold text-[#172b4d]">
                  {row.clientName || "Unnamed client"}
                </span>
                <span className="truncate text-[#42526e]">{personLabel(row.agentEmail)}</span>
                <span className="truncate text-[#42526e]">{personLabel(row.callerEmail)}</span>
                <span className="truncate text-[#42526e]">{row.stageLabel ?? "No stage"}</span>
                <span
                  className={`text-right font-bold ${
                    row.stageAgeEstimated ? "text-[#8993a4] italic" : "text-[#172b4d]"
                  }`}
                  title={row.stageAgeEstimated ? ESTIMATED_AGE_TITLE : undefined}
                >
                  {formatDays(row.daysInStage)}
                </span>
              </button>
            ))}
            {rows.length === 0 ? (
              <p className="px-4 py-6 text-sm text-[#97a0af]">Everything has an owner.</p>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(authed)/enrollment/_components/aca/AcaUnassigned.tsx"
git commit -m "feat(enrollment): add ACA overview unassigned table"
```

---

## Task 11: Composition and integration

**Files:**
- Create: `src/app/(authed)/enrollment/_components/aca/AcaOverview.tsx`
- Modify: `src/app/(authed)/enrollment/_components/EnrollmentOverview.tsx`
- Modify: `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`

**Interfaces:**
- Consumes: every component from Tasks 3-10
- Produces: `<AcaOverview from to isManager onOpenRecord />`

- [ ] **Step 1: Write the composition**

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle } from "lucide-react";
import {
  ACA_OVERVIEW_DEFAULT_THRESHOLD_DAYS,
  type AcaOverviewSnapshot,
  type AcaOverviewThresholdDays,
} from "@/lib/enrollment/aca-overview-types";
import { AcaControls } from "./AcaControls";
import { AcaScorecards } from "./AcaScorecards";
import { AcaStageTable } from "./AcaStageTable";
import { AcaActionList } from "./AcaActionList";
import { AcaPeopleTable } from "./AcaPeopleTable";
import { AcaMatrix } from "./AcaMatrix";
import { AcaQueue } from "./AcaQueue";
import { AcaUnassigned } from "./AcaUnassigned";

export function AcaOverview({
  from,
  to,
  isManager,
  onOpenRecord,
}: {
  from: string;
  to: string;
  isManager: boolean;
  onOpenRecord: (id: string) => void;
}) {
  const [thresholdDays, setThresholdDays] = useState<AcaOverviewThresholdDays>(
    ACA_OVERVIEW_DEFAULT_THRESHOLD_DAYS
  );
  const [snapshot, setSnapshot] = useState<AcaOverviewSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const sequenceRef = useRef(0);

  const load = useCallback(async () => {
    const sequence = ++sequenceRef.current;
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ from, to, threshold: String(thresholdDays) });
      const response = await fetch(`/api/enrollment/aca-overview?${query.toString()}`, {
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as
        | AcaOverviewSnapshot
        | { error?: string }
        | null;
      if (!response.ok) {
        throw new Error(
          payload && "error" in payload ? payload.error : "Could not load overview."
        );
      }
      if (sequence !== sequenceRef.current) return;
      setSnapshot(payload as AcaOverviewSnapshot);
    } catch (loadError) {
      if (sequence !== sequenceRef.current) return;
      setError(loadError instanceof Error ? loadError.message : "Could not load overview.");
    } finally {
      if (sequence === sequenceRef.current) setLoading(false);
    }
  }, [from, thresholdDays, to]);

  useEffect(() => {
    void load();
  }, [load]);

  // The API returns 403 for non-managers, but the UI must not rely on a failed
  // request to hide a section that answers "who is underperforming".
  if (!isManager) {
    return (
      <div className="rounded-lg border border-dashed border-[#c1c7d0] bg-[#f4f5f7] px-6 py-12 text-center text-sm font-semibold text-[#6b778c]">
        This dashboard is available to managers.
      </div>
    );
  }

  if (loading && !snapshot) {
    return (
      <div className="rounded-lg border border-dashed border-[#c1c7d0] bg-[#f4f5f7] px-6 py-12 text-center text-sm font-semibold text-[#6b778c]">
        Loading enrollment operations...
      </div>
    );
  }

  if (error || !snapshot) {
    return (
      <div className="rounded-lg border border-[#ffbdad] bg-[#ffebe6] px-4 py-4 text-sm font-bold text-[#bf2600]">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error ?? "No overview data."}</span>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-3 rounded border border-[#bf2600]/30 bg-white px-3 py-1.5 text-xs font-bold text-[#bf2600] hover:bg-[#fff5f2]"
        >
          Retry
        </button>
      </div>
    );
  }

  const holdingTotal =
    snapshot.people.find((row) => row.email === "__team__")?.holding ?? 0;

  return (
    <div className="space-y-4">
      <AcaControls
        thresholdDays={thresholdDays}
        onThresholdChange={setThresholdDays}
        from={from}
        to={to}
        generatedAt={snapshot.generatedAt}
        onRefresh={() => void load()}
      />
      <AcaScorecards scorecards={snapshot.scorecards} thresholdDays={thresholdDays} />
      <AcaStageTable rows={snapshot.stageTable} thresholdDays={thresholdDays} />
      <AcaActionList rows={snapshot.actions} onOpenRecord={onOpenRecord} from={from} to={to} />
      <AcaPeopleTable
        rows={snapshot.people}
        thresholdDays={thresholdDays}
        from={from}
        to={to}
      />
      <AcaMatrix
        matrix={snapshot.matrix}
        thresholdDays={thresholdDays}
        holdingTotal={holdingTotal}
      />
      <AcaQueue cards={snapshot.queue} from={from} to={to} />
      <AcaUnassigned rows={snapshot.unassigned} onOpenRecord={onOpenRecord} />
    </div>
  );
}
```

- [ ] **Step 2: Delegate the ACA branch**

In `EnrollmentOverview.tsx`, replace the `AcaEnrollmentDashboard` call with `AcaOverview`. The component currently fetches its own snapshot for both programs (`:29-56`) and then branches at `:94-98`; move the branch **above** the fetch so the ACA path does not fire the old `/api/enrollment/overview` request at all:

```tsx
export function EnrollmentOverview({ program, from, to, isManager, onOpenRecord }: OverviewProps) {
  if (program === "aca") {
    return <AcaOverview from={from} to={to} isManager={isManager} onOpenRecord={onOpenRecord} />;
  }
  return <MedicareOverview from={from} to={to} onOpenRecord={onOpenRecord} />;
}
```

Move the existing fetch, loading, error and `MedicareEnrollmentDashboard` rendering into a `MedicareOverview` component in the same file, unchanged. **Delete `AcaEnrollmentDashboard`** — it is now dead. Leave `SnapshotStrip`, `FunnelSection`, `FlowSection`, `StageDwellSection`, `NeedsCareSection`, `InformationQualitySection` in place: Medicare still renders them.

- [ ] **Step 3: Default the overview range to All dates**

In `EnrollmentClient.tsx`, the overview date range initialises from `thisMonthDateRange()` (around `:500-502`). For ACA it must open on **All dates** — an empty `from`/`to` — because every section obeys the range and a narrowed default hides workload:

```tsx
const [overviewDateRange, setOverviewDateRange] = useState<Record<EnrollmentProgram, { from: string; to: string }>>({
  aca: { from: "", to: "" },
  medicare: thisMonthDateRange(),
});
```

Read the surrounding code first — the exact shape of that state is per-program and may differ from this sketch. Keep Medicare on its current default; only ACA changes.

- [ ] **Step 4: Verify the build**

Run: `npx tsc --noEmit` then `npx vitest run` then `npm run build`
Expected: all PASS. The existing enrollment tests must be untouched and green.

- [ ] **Step 5: See it running**

Start the app, open `/enrollment`, switch to the Overview tab on ACA as a manager account, and confirm:
- the threshold buttons change every `≥Nd` column header and the numbers behind them
- the matrix scrolls horizontally with the Responsible column pinned and both header rows pinned vertically
- a record with an estimated stage age renders muted with the tooltip
- switching to Medicare still shows the old dashboard unchanged

- [ ] **Step 6: Commit**

```bash
git add "src/app/(authed)/enrollment/_components/aca/AcaOverview.tsx" "src/app/(authed)/enrollment/_components/EnrollmentOverview.tsx" "src/app/(authed)/enrollment/_components/EnrollmentClient.tsx"
git commit -m "feat(enrollment): render the redesigned ACA overview"
```

---

## Task 12: Changelog

**Files:**
- Modify: `changelog.md`

- [ ] **Step 1: Append the entry**

```markdown
## 2026-08-13 — ACA overview UI

- Replaced the ACA branch of the enrollment Overview with seven new sections:
  15 scorecards, a stage table with a synthetic unassigned row, a paginated
  needs-action list, a people table, a person × stage matrix with a frozen
  person column and a two-level header, a turn-order assignment queue, and a
  read-only unassigned list. Medicare keeps its previous dashboard unchanged.
- Added a staleness threshold selector (1/3/7/10 days) that relabels and
  recomputes every affected column.
- The ACA overview defaults to All dates and shows the selected range on every
  workload section, because all sections obey the created-in-range cohort and a
  narrowed range can otherwise make a loaded person read as Holding 0.
- Stage ages derived from the 2026-08-09 backfill render muted with an
  "estimated" tooltip rather than looking like measurements.
- The dashboard is manager-only in the UI as well as at the API.
```

- [ ] **Step 2: Commit**

```bash
git add changelog.md
git commit -m "docs: record ACA overview UI"
```

---

## Still to plan

- **Assignment write surface** — the `Assign to` picker in §7.6. Blocked on: extending the unassigned row with `updated_at` (PATCH requires `expected_updated_at`), batching the per-record `canAssignPeople` check so it is not one `agent_members` query per row, and wiring a post-write refresh that does not double-fire with `broadcastEnrollmentChanged`.
- **Edit queue membership** — the toggle grid behind the queue, plus its endpoint and the seeding rule for a newly enabled person.
- **Per-person stage timing** — spec §9.1.
- **Medicare** — its own design pass.

## Codex implementation notes (2026-08-13)

- The existing `EnrollmentOverview` does not currently receive `isManager`;
  the integration adds that prop from `EnrollmentClient`'s existing
  `canManageOptions` capability and keeps the Medicare branch unchanged.
- The ACA branch is moved before the legacy snapshot fetch, so ACA does not
  issue the old overview request in parallel with the new endpoint.
- The component examples in this document are treated as contracts, not blind
  copy-paste: actual local types and callback signatures are checked before
  each component is wired.

## Codex execution log

### Stage 4 — ACA Overview integration UI

- Commit: `087aca7`
- Added the manager-only ACA dashboard surface with scorecards, stage table,
  needs-action/unassigned lists, people, matrix, and assignment queue. It uses
  request sequencing and the all-dates default.
- `EnrollmentOverview` delegates ACA before the legacy fetch; non-managers get
  an explicit access message and Medicare remains unchanged.
- Verification: `npm run typecheck`.

### Final verification

- Full repository verification passed after implementation: `npm run test:run`
  (87 files, 602 tests), `npm run typecheck`, and `npm run build`.

- Queue membership editing was completed in follow-up commit `163cb26`; the
  `Edit queue` grid is manager-only through the dashboard route and uses the
  enrollment-specific membership endpoint.
- Scorecard rendering was completed in `481ff32`; all 15 planned volume,
  attention, speed, and staffing tiles are now present instead of the earlier
  five-card placeholder.
- Needs-action and unassigned action surfaces now paginate at 20 rows in
  `764c373`, preventing large cohorts from being silently truncated.
