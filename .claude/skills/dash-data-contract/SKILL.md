---
name: dash-data-contract
description: >
  The data layer for Next.js dashboards — the pure-assembler pattern (rows →
  chart-ready payload), the canonical payload types (Kpi, DualAxisTrend, StackedDist, HBar,
  FunnelStages, TableRow, Insight, SectionPayload), prior-period delta rules and
  dir-vs-inverse polarity, null-vs-zero semantics, ratio volume floors, the percent-units
  convention and pp vs %, derive-never-hardcode, CSV formula-injection-safe export, and
  where assembly lives in the App Router (server component, unstable_cache, revalidate).
  Load this before defining the props of any dashboard chart or section component.
  TRIGGERS: dash data contract, chart payload, chart-ready shape, assembler, assembleWeekly,
  SectionPayload, DualAxisTrend, Kpi type, chart props, section props, null vs zero, volume
  floor, percent units, pp vs percent, percentage points, prior-period delta, inverse
  polarity, dashboard CSV export, CSV injection guard, unstable_cache revalidate,
  server-side dashboard data, dashboard freshness.
---

# Dashboard — Data Contract

One rule underneath everything: **the server produces chart-ready shapes; the client only
displays them.** A chart component never computes a rate, never derives a delta, never
decides a colour by business logic. It receives a typed object and hands it to a builder.

Distilled from the payload contracts and pure serializers of a production analytics dashboard.

**Sibling skills:** chart builders → `dash-charts` · tokens → `dash-design-system` ·
page composition → `dash-page-patterns`.

---

## 0. Setup — in this order

1. **Copy `references/dashboard.ts`** into `types/dashboard.ts`. Both `dash-charts` and
   `dash-page-patterns` type against these shapes; they are the interface between the layers.
2. **Write the query layer** — data access only, cached. No display shaping.
3. **Write the pure assembler** — `assembleX(rows, opts) → payload`. No I/O, no `Date.now()`,
   no `Math.random()`. Unit-test it with synthetic rows.
4. **Wire the server component** — resolve params, fetch, assemble, pass typed props down.

---

## 1. Architecture

```
Warehouse / API                assembleX()                  <Section />
┌──────────────┐   rows    ┌──────────────────┐  typed   ┌──────────────┐
│ query layer  │ ────────► │  PURE function   │ ───────► │ server comp. │
│  (cached)    │           │  rows → payload  │          │      │       │
└──────────────┘           └──────────────────┘          │      ▼       │
                              no I/O, no dates,          │ <Chart />    │
                              no randomness              │ "use client" │
                                                         └──────────────┘
```

Three layers, three responsibilities:

| Layer | Does | Must not |
|---|---|---|
| **Query** | Fetch rows. Cached / revalidated | Shape for display |
| **Assembler** | Rows → chart-ready payload. **Pure** | Touch I/O, `Date.now()`, `Math.random()` |
| **Component** | Render the payload | Fetch, aggregate, compute rates or deltas |

Keeping the assembler pure is what makes the data layer testable: feed it synthetic rows,
assert the payload. Every non-trivial number in the product is worth one such test.

---

## 2. Canonical shapes

**Copy `references/dashboard.ts` into `types/dashboard.ts` and import it from both sides** —
the assembler produces these shapes, the components consume them. One definition, so a rename
is a compile error rather than a runtime surprise. Do not retype them.

| Type | Feeds | Notes |
|---|---|---|
| `Kpi` | metric tile | `value`/`delta` are display STRINGS, formatted server-side |
| `DualAxisTrend` | `buildDualAxisBarLine`, `buildRateOverVolume` | bar = denominator, lines = rates |
| `StackedDist` | `buildStackedBar` | one payload serves both plain and 100% stacked |
| `HBar` | `buildHorizontalBar` | pre-sorted descending by the server |
| `FunnelStages` | `buildFunnel` | sequence order, not sorted by size |
| `ScatterPoint` | `buildScatter` | two measures + the identity for the tooltip |
| `TableRow` | `.df` / `.numtbl` | plain record; the column list decides what renders |
| `Insight` | `.callout` | structure, not prose — see §6 |
| `SectionPayload` | one page section | every section is a subset of this |
| `GlanceTile` / `GlanceSummary` | glance hero | count `targetsTotal` from tiles that HAVE a target |
| `PageMeta` | provenance footer | window · grain · source · filters · formula · as-of |

### Three consistency rules

- **`x` is the shared spine.** Every array in a section is index-aligned to it. Never ship
  parallel arrays of different lengths.
- **Display labels in `x`, ISO dates alongside** when the client needs to sort or filter:
  `x: string[]` for display, `dates: string[]` (`YYYY-MM-DD`) for logic. `YYYY-MM-DD` sorts
  lexicographically, so string comparison is safe.
- **Colours travel with the series** only when the series names an entity from the frozen map.
  Otherwise omit `color` and let the builder assign from the categorical palette.

**Pre-sort server-side.** Ranked bars, tables and legend order arrive in final order.

---

## 3. Numbers: units, nulls, precision

### Percent units — pick one and say so

A percentage crosses the wire either as a **fraction** (`0.223`) or in **percent units**
(`22.3`). Carrying both in one codebase is a recurring source of 100× errors.

> **Convention for new work: percent units end-to-end.** `22.3` means 22.3%. State it in
> the type comment. Thresholds, targets and axis values are in the same units as the data.

Percentage **differences** are in **percentage points** and are labelled `pp`, never `%`:
`+0.42 pp vs prior`. A relative change of a rate is a different number and gets `%`.

### null vs zero

| Situation | Value | Renders as |
|---|---|---|
| No activity that period | `0` | A zero bar / a point at zero |
| Not measured, suppressed, below volume floor | `null` | **A gap** |
| Denominator is zero (rate undefined) | `null` | A gap — never `0`, never `NaN` |

Blank at the source. A `0` where a `null` belongs is a lie the chart cannot detect, and
`NaN` reaching ECharts renders a full-extent bar labelled `NaN%`.

### Rounding

Round for **display only**, in the assembler, at the last step. Keep full precision through
every intermediate calculation. Sub-cent unit economics (a per-unit cost) carry 3 decimals.

### Ratio metrics need a volume floor

This is the rule that costs the most to learn the hard way. A per-unit metric divides one
column by another, so on a low-volume period the denominator collapses and the ratio
explodes into a number that is arithmetically correct and completely meaningless — a
near-fixed cost spread over a handful of units. One such spike rescales the whole y-axis and
flattens every real datapoint into a line at the bottom.

**Blank the ratio below an explicit volume floor. Never plot it, never clamp it.**

```ts
// Pick floors from the ACTUAL volume distribution and record it here: real
// periods run ~17k–60k units; every noise period is under ~250. The floors sit
// well above the noise and well below the real range, so nothing legitimate hides.
const MIN_DENOM_UNITS = 1000;
const MIN_EVENTS      = 100;

const perUnit = (numerator: number, denom: number, events: number): number | null => {
  const thin = events < MIN_EVENTS || denom < MIN_DENOM_UNITS;
  // Guard the zero denominator too: x/0 is Infinity or NaN, and either one
  // silently breaks a chart's axis instead of showing a gap.
  return (denom > 0 && !thin) ? numerator / denom : null;
};
```

Three parts to getting this right:

1. **Pick the floors from the actual volume distribution**, and write the numbers into a
   comment with the range they were chosen against.
2. **The floor applies to the per-unit series only.** The absolute series and the
   period-level aggregate still include every row — the aggregate divides two large sums, so
   it is not affected by any single thin period.
3. **Say so on the chart.** A caption naming the floor
   (`periods under 1,000 units hidden — the per-unit ratio is not meaningful there`) is the difference between
   a gap that reads as a deliberate exclusion and a gap that reads as broken data.

Same rule for **cropped denominators generally**: any rate whose denominator can legitimately
reach zero (a conversion rate on a day with no qualified leads) returns `null`, not `0`.

---

## 4. Deltas and prior periods

Every KPI that can be compared carries a delta. The rules:

```ts
/** Prior window = the immediately preceding window of EQUAL LENGTH. */
export function priorPeriod(start: Date, end: Date): [Date, Date] {
  const days = Math.round((+end - +start) / 86400000) + 1;
  const priorEnd = addDays(start, -1);
  return [addDays(priorEnd, -(days - 1)), priorEnd];
}
```

1. **Equal-length window**, immediately preceding. Not "last month", not "same period last
   year", unless the metric is explicitly seasonal and you label it.
2. **Rates get percentage-point deltas** (`+0.42 pp`). **Counts and money get relative
   deltas** (`+2.4%`) or absolute (`+$1,240`) — whichever the reader acts on.
3. **`dir` is the sign; `inverse` is the meaning.** `dir` = did it go up or down.
   `inverse` = is up bad. Keep them independent: the same `dir: "up"` is green on
   a throughput metric and red on a cost metric.
4. **A null prior yields a null delta.** Do not render "+100%" or "—%" against a zero or
   missing baseline; render nothing.
5. **Always name what it is compared against** — "vs prior", "vs prior week", "vs May 21 →
   Jun 03". A bare `+2.4%` is unreadable.

```ts
export function fmtDelta(curr: number, prior: number | null, kind: Kind): { delta: string | null; dir: Dir } {
  if (prior == null || prior === 0) return { delta: null, dir: null };
  const raw = kind === "pct" ? curr - prior : (curr - prior) / prior * 100;
  const dir: Dir = raw > 0 ? "up" : raw < 0 ? "down" : null;
  const sign = raw >= 0 ? "+" : "−";
  const body = kind === "pct" ? `${Math.abs(raw).toFixed(2)} pp`
             : kind === "usd" ? `$${Math.abs(raw).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
             : `${Math.abs(raw).toFixed(1)}%`;
  return { delta: `${sign}${body} vs prior`, dir };
}
```

---

## 5. Derive, never hardcode

From the source contract, and it still holds:

> "119 categories" must be `categories.length`; "$0.135" must compute from the series.
> Hard-coded literals won't reflect real data and will read as wrong.

This covers headline counts, totals, spans, "N of M targets met", and every number inside
a narrative sentence. If a number appears in prose on the page, it comes from the payload.

The date anchor is part of this. Pick the clock deliberately and centralise it:

```ts
/** The operational clock. Window presets anchor here, NOT on the server's timezone,
 *  so window boundaries line up with the locally-dated buckets the charts plot. */
export const OPERATIONAL_TZ = "America/New_York";
export const operationalToday = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: OPERATIONAL_TZ }).format(new Date());
  // en-CA yields "YYYY-MM-DD", which sorts lexicographically
```

Two bugs the source hit and fixed, both worth avoiding by construction:

- A module-level `const TODAY = today()` **freezes at process start** — in a long-lived
  server it silently serves yesterday's window forever. Compute per request.
- `new Date()` on the server follows the container timezone, which is usually UTC and
  usually wrong for the reader.

---

## 6. Insights: generated prose, structured payload

Auto-generated insight sentences are part of the contract, not an afterthought. The
server emits **structure**; the client renders it. This keeps wording consistent and
sanitisation unnecessary.

```ts
// Full type in references/dashboard.ts
type Insight = { /* metric, label, periodTo, delta, dominant, rising, trends, lines */ };
  dominant?: { label: string; color: string; share: number };   // biggest contributor
  rising?: { label: string; deltaPts: number; periodFrom?: string };
  trends?: { label: string; pct?: number | null;
             story?: { word: "rising" | "easing" | "flat"; tone: string;
                       first: number; last: number; improving: boolean } }[];
  trendsLabel?: string;
  lines?: string[];               // free-text supporting points
};
```

The badge picks its **arrow by sign** and its **colour by `improving`** — never colour by
sign. That separation is what lets one component narrate both a cost metric and a quality
metric correctly.

---

## 7. Where assembly lives in Next.js

```
app/
  (dashboard)/
    weekly/
      page.tsx                 ← server component: read params, fetch, assemble, render
      _components/
        payment-section.tsx    ← server component, takes SectionPayload
        payment-trend.tsx      ← "use client" — the chart only
lib/
  queries/weekly.ts            ← data access, cached
  assemble/weekly.ts           ← PURE: rows → payload
types/dashboard.ts             ← the shapes above
```

```tsx
// app/(dashboard)/weekly/page.tsx
export default async function WeeklyPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { start, end } = resolveWindow(await searchParams);     // per request, never module-level
  const rows    = await fetchWeeklyFrames({ start, end });       // cached
  const payload = assembleWeekly(rows, { start, end });          // pure
  return <WeeklyReport data={payload} />;
}
```

### Caching

```ts
export const fetchWeeklyFrames = unstable_cache(
  async (p: Params) => runQueries(p),
  ["weekly-frames"],
  { revalidate: 900, tags: ["weekly"] },   // match the upstream mart refresh cadence
);
```

Set `revalidate` from **how often the source data actually lands**, not from a guess.
Surface the freshness in the UI — the source shows a "mart freshness" line in the sidebar,
and it is the first thing anyone checks when a number looks wrong.

### Filters: client-side vs server-side

| Filter changes | Handle it |
|---|---|
| Which series/rows of an **already-loaded** payload are shown (view mode, level, channel, share-vs-volume, legend) | **Client state.** Ship all variants in the payload; toggling is a series swap, no refetch |
| The **query window** or a dimension that changes what is aggregated (date range, call type) | **Server.** A URL search param → new fetch → new payload |

The source ships all three payment-channel variants pre-computed so switching costs
nothing. Do the same wherever the variant count is small and bounded.

---

## 8. CSV export — and the injection guard

Analysts export tables. Two non-negotiables:

```ts
/** Neutralise CSV formula injection: a cell starting with = + - @ TAB or CR is
 *  executed as a formula by Excel/Sheets on open. Prefix with an apostrophe so it
 *  is read as text. This is a real exfiltration vector when any exported column
 *  contains user- or transcript-derived text. */
function csvCell(v: unknown): string {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

/** Blob + object URL, not a data: URI — data URIs hit length limits on large
 *  exports and are blocked in more sandboxed contexts. */
export function downloadCsv(filename: string, headers: string[], rows: unknown[][]) {
  const body = rows.map(r => r.map(csvCell).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([headers.join(",") + "\n" + body], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
```

Name the file with the **data date, not the export date**, and include the filter that
produced it: `dropoff_stage3_payment-declined_2026-06-03.csv`. Sanitise the slug —
`replace(/[^a-z0-9]+/gi, "_").slice(0, 80)`.

Show the row count on the button (`⬇ Export CSV (1,284)`) and disable it at zero, so nobody
downloads an empty file and reports it as a bug.

---

## 9. Documenting the contract

Every payload type carries a comment block listing what the UI reads and what each field
means. The discipline from the source, kept:

> **If you change a field, change the comment.**

For each field, record three things: the **unit** (percent units? currency? count?), the
**grain** (what one row counts — a session, an item, an attempt, a day), and the **null
semantics**.

**Grain matters most.** As soon as one page mixes grains, some of its numbers stop tying to
each other — a session that retries an action three times is one session and three attempts,
so a session count and an attempt count are both correct and will never reconcile. Label the
grain on every figure derived from a different one, and say plainly that they do not tie. Two
numbers on one screen that legitimately disagree get reported as a bug unless the page
explains why they don't.

---

## 10. Checklist

- [ ] Assembler is pure — no I/O, no `Date.now()`, no `Math.random()`; unit-tested with synthetic rows
- [ ] Every array in a section is index-aligned to `x`
- [ ] Percent units are consistent end-to-end and documented; differences labelled `pp`
- [ ] Unmeasured/undefined values are `null`, not `0`, not `NaN`
- [ ] Every ratio metric has an explicit volume floor, and the chart says what was hidden
- [ ] Every division guards a zero denominator (`Infinity`/`NaN` breaks an axis silently)
- [ ] CSV exports run cells through the formula-injection guard
- [ ] Deltas use an equal-length prior window and name what they compare against
- [ ] `dir` and `inverse` are set independently and correctly per metric
- [ ] No headline number, count or narrative figure is a literal
- [ ] Date anchor computed per request, on the operational timezone
- [ ] Cache `revalidate` matches the upstream refresh cadence; freshness is visible in the UI
- [ ] Client-side toggles have their variants pre-computed; only window changes refetch
