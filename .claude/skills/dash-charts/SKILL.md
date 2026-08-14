---
name: dash-charts
description: >
  The ECharts chart system for dashboards in Next.js — the shared <ECharts> host on
  echarts-for-react, the base option contract (axes, tooltip, legend, grid geometry,
  dataZoom), 18 chart recipes (dual-axis bar+line, stacked bar, 100% stacked, horizontal
  bar, KPI-vs-target, gauge, sparkline, waterfall, donut, funnel, funnel trend, ranked bar,
  compare-series, compare-stacked, actual-vs-projected, rate-over-volume, grouped bars,
  scatter, HTML funnel), the formatter matrix, series colour assignment, high-cardinality
  stacks, on-chart label floors, null/zero semantics and additive legend isolate. Use this
  INSTEAD of the generic `dataviz` skill for any chart in a dashboard built on this system.
  Requires the tokens from `dash-design-system` to be installed — if tokens.css is not
  already in the repo, load that skill too before writing chart code.
  TRIGGERS: dash chart, ECharts, echarts-for-react, EChartsOption, chart recipe, stacked bar,
  100% stacked, dual axis, dataZoom, markLine, target line, threshold line, gauge, waterfall,
  donut, funnel chart, sparkline, ranked bar, grouped bars, scatter, heatmap ramp, axis
  formatter, chart tooltip, legend isolate, grid.bottom, high-cardinality stack, too many
  series, chart not recolouring in dark mode.
---

# Dashboard — Chart System

Every chart is an Apache ECharts option built from one shared grammar. This skill is that
grammar. **Use it instead of the generic `dataviz` skill** for any chart in this system.

Distilled from 24 chart builders in a production analytics dashboard.

**Sibling skills:** tokens → `dash-design-system` · payload shapes → `dash-data-contract` ·
how a chart sits on a page → `dash-page-patterns`.

**Reference files — copy the two code files in as-is; they are the implementation, not
pseudocode:**

| File | Holds |
|---|---|
| `references/echarts-host.tsx` | The `<ECharts>` host, `cssVar`/`T()`, `baseAxis`/`tip`, `zoomWidgets`, `useThemeKey` |
| `references/format.ts` | Formatter matrix, palettes, `labelInk`, `hexToRgba`, `chartTextStyle`, `entityColors` |
| `references/recipes.md` | All 18 builders. A lookup table — read only the section you need |
| `references/escape-hatches.md` | The four invariants that have real exceptions |

---

## 1. Prerequisite — check this before writing any chart code

These charts resolve their **entire palette from CSS custom properties at runtime**. If
`--text`, `--muted`, `--border`, `--grid`, `--card`, `--surface`, `--good`, `--bad`,
`--accent` and `--font` are not defined on `:root`, every chart renders with correct
**series** colours — those are hex constants — and **broken, invisible chrome**: no axis
labels, no gridlines, no tooltip background. Nothing throws, so it reads as an ECharts quirk
rather than a missing dependency.

Run this first:

```bash
grep -rl "^\s*--grid:" app/ src/ styles/ 2>/dev/null
```

- **No match** → the design system is not installed. **Load `dash-design-system` now** and
  follow its Setup section: copy `references/tokens.css`, import it in the root layout, set
  `data-theme` and `data-density` on `<html>`. Do not continue until
  `document.documentElement` carries `data-theme`.
- **Match** → continue.

Add this guard to `echarts-host.tsx` so the failure can never be silent again:

```ts
if (process.env.NODE_ENV !== "production" && !cssVar("--grid")) {
  throw new Error("dash-charts: tokens.css is not loaded — see the dash-design-system skill.");
}
```

---

## 2. Setup

```bash
npm i echarts echarts-for-react
```

Copy `references/echarts-host.tsx` and `references/format.ts` into `components/charts/`.
**Do not call `echarts.init` anywhere else** — the host owns init, resize, disposal, theme
rebuild and legend behaviour.

Charts are **client components** (`"use client"`). They take an already-shaped payload as
props from a server component; **never fetch inside a chart** (see `dash-data-contract`).

```tsx
"use client";
import { ECharts, useThemeKey } from "@/components/charts/echarts-host";
import { buildDualAxisBarLine } from "@/components/charts/recipes";
import type { DualAxisTrend } from "@/types/dashboard";

export function RateTrend({ trend }: { trend: DualAxisTrend }) {
  const themeKey = useThemeKey();
  const option = useMemo(() => buildDualAxisBarLine(trend), [trend, themeKey]);
  return <ECharts option={option} height={320} />;
}
```

`useThemeKey` is exported from `echarts-host.tsx`. **Import it; do not write a second copy.**

---

## 3. The theme bridge

Canvas cannot read CSS classes, so charts resolve the custom properties to concrete hex at
build time. **Call `T()` as the first line of every build function.** Never at module scope —
there is no computed style before the document exists — and never write a literal colour for
axis, grid, tooltip or text chrome.

### Theme rebuild — the rule people get wrong

An ECharts option is a **snapshot** of the palette at the moment it was built. Flipping
`data-theme` changes the CSS but not the built option. **Put both the theme key and the
decimal-precision setting in every memo's dependency list:**

```tsx
const option = useMemo(() => buildX(data), [data, themeKey, dp]);
```

`dp` belongs there for the same reason `themeKey` does: `DP()` is read while the option is
being built, so a precision change against a stale memo leaves every tooltip at the old
precision.

Missing the theme key is the single most common porting bug — light-mode axis labels survive
into dark mode and become unreadable.

---

## 4. Invariants — true of every chart

1. **`animation: false`.** Every option, top level. These are analytics dashboards; a
   re-render must not replay a growth animation. It is also what makes export capture reliable.
2. **`textStyle: chartTextStyle()`.** Every option, top level. Canvas does **not** inherit the
   page font — omit it and charts render in the browser default sans while the page is Inter.
   The seam shows in every screenshot.
3. **`null` renders as a gap, never as zero.** A missing period is not a zero period. Blank it
   upstream and let the axis break. Use `connectNulls: true` only where a line is genuinely
   continuous across the gap.
4. **Rate/percentage axes anchor at `min: 0`** — never `scale: true`. A cropped range turns a
   0.3pp move into a cliff. *Exception: `references/escape-hatches.md`.*
5. **Spread `baseAxis(t)` into every axis** so ticks, gridlines and axis lines share one look.
6. **Assign colour by identity, not by index**, wherever a series names an entity that appears
   elsewhere in the product (see §7).
7. **`containLabel: true`** on every grid, and compute the bottom band — do not guess it (§6).
   *Exception: `references/escape-hatches.md`.*
8. **Centralise formatting** in `format.ts`. No inline `toFixed()` in a recipe.
9. **`emphasis: { focus: "series" }`** on stacked series, so hovering dims the rest.
10. **Only one axis of a dual-axis chart draws `splitLine`.** Two gridline sets produce a
    plaid background and neither scale stays readable.
11. **`tooltip.confine: true`** on any chart inside a card, or a tooltip near the edge is
    clipped by the container.

---

## 5. Base fragments

`baseAxis(t, name)` and `tip(t, formatter)` live in `echarts-host.tsx`; every recipe composes
from them. Spread them — do not re-declare them locally.

Set `axisPointer` by chart type: **`shadow`** for anything with bars, **`line`** for pure line
charts, **`cross`** for dual-axis charts where the reader traces a value to both axes.

---

## 6. Grid geometry — the bottom band is arithmetic

The most frequent visual defect is a legend colliding with the dataZoom slider or the x-axis
labels. Pick `grid.bottom` from what is actually stacked below the plot:

| Chart has | `grid.bottom` |
|---|---|
| x labels only | `24` |
| x labels + legend | `40–48` |
| x labels + dataZoom slider + legend | **`60–74`** |
| x labels + slider + two legend rows | `74+` |

with the slider at `{ height: 16, bottom: 28 }` and the legend at `{ bottom: 0 }`.

Four more geometry rules:

- Set **`grid.right: 48`** on any line chart with `boundaryGap: false`, or the last category
  label — centred on the grid edge — gets clipped.
- Set **`grid.right: 70`** when a secondary right-hand y-axis carries a `name`.
- Set **`grid.top: 32–40`** when either y-axis has a `name`; `16` when neither does.
- Set **`grid.right: 56`** on horizontal bars, for `position: "right"` value labels.

---

## 7. Series colour assignment

Decide in this order — stop at the first that applies:

1. **Frozen entity map.** The series names a known entity. Use `entityColors()` from
   `format.ts`, which reads the `--entity-*` tokens `dash-design-system` owns. Pin the
   **stacking order** from `ENTITY_ORDER` so one entity sits in the same slot on every chart.
2. **Semantic colour.** The series means good / bad / target / threshold →
   `t.good` / `t.bad` / `t.muted` (dashed).
3. **Comparison pair.** Two entities head-to-head → `COMPARE_COLORS`. Fixed, not
   accent-derived, so the two never collide with a themed accent.
4. **Categorical palette by index** — `CHART_CATEGORICAL`.

**Stack the largest total at the bottom** when no order is pinned, so the legend reads
top-down by share. **Append any series missing from the entity map at the end; never drop it**
— a chart with one stray colour beats a chart that silently loses data.

Pick inside-fill label ink with `labelInk()`. Never hardcode white: it disappears on the light
end of a sequential ramp and on grey "other" slices.

### High-cardinality stacks — past ~12 series, colour stops working

`CHART_CATEGORICAL` has 22 entries, but **pairwise distinctness is not achievable at n≈24**.
Any palette that size contains pairs a reader cannot tell apart. Do not try to generate more
colours. Change what colour is responsible for:

1. **Optimise for adjacency, not global distinctness.** In a stacked bar the only pairs a
   reader actually compares are **neighbouring segments**. Order the palette so adjacent
   segments sit far apart in hue, and accept that two distant segments may look similar.
2. **Never let colour be the only carrier of identity.** At high cardinality identity comes
   from the **legend, the tooltip and the table view** too. That is why the chart↔table toggle
   (`dash-page-patterns`) is not a nice-to-have on these charts — it is the fallback that
   makes them legible at all.
3. **Step the dark palette separately.** A light palette flipped for dark loses its adjacent
   contrast. Build two ramps and select between them by measuring the **luminance of
   `--card`**, not by reading `data-theme` — the chart already resolves `--card`, so this needs
   no second theme channel:

```ts
const isDark = (() => {
  const c = cssVar("--card").replace("#", "");
  if (c.length !== 6) return false;
  const [r, g, b] = [0, 2, 4].map(i => parseInt(c.slice(i, i + 2), 16));
  return (r * 299 + g * 587 + b * 114) / 1000 < 128;
})();
```

4. **Turn on `legendIsolate`** (§11). At 25 series, isolating one is the primary reading
   action, and ECharts' subtractive default costs 24 clicks to get there.

---

## 8. Formatter matrix

Three kinds (`usd` | `pct` | `int`) × three contexts. All implementations live in
`format.ts` — **never inline a `toFixed()` in a recipe.**

| Context | usd | pct | int |
|---|---|---|---|
| **Axis tick** — short, must not duplicate | `axisFmt` → `$1,234` (0 dp) | adaptive: `10%` / `1.5%` | `1,234` |
| **Tooltip / read value** — full precision | `tipFmt` → `$1,234.56` | `DP()` dp → `22.30%` | `1,234` |
| **On-chart label** — compact, must not collide | `compactFmt` → `$26K` | `1.9%` | `466K`, `1.5M` |

Four specialised formatters exist because the generic three get these cases wrong:

- **`axisFmtUsdUnit()`** — 2 dp ticks for a **sub-dollar** axis. `axisFmt("usd")` is
  whole-dollar and renders every tick on a $0–$0.40 axis as `"$0"`.
- **`fmtUsd4`** — 3 dp for sub-cent unit economics (`$0.135`). Named after the source helper;
  it renders **three** decimals deliberately. Do not "fix" the name or the precision.
- **`fmtUsdSmart`** — cents below $10, whole dollars above. Use on a money column whose rows
  span magnitudes; whole-dollar rounding turns a real $0.34 into `"$0"`, which reads as a bug.
- **`fmtPctAdaptive`** — 2 dp at or above 1%, 3 dp below. Use on a series spanning magnitudes
  (a funnel's cumulative share runs 4.6% down to 0.09%); at fixed 2 dp the small end collapses
  into ties.

**Percent units:** every formatter here expects percent units (`22.3` = 22.3%), never
fractions. Convert in the assembler — see `dash-data-contract`.

---

## 9. On-chart labels

Labels on segments and points are opt-in, and they need **floors** — not just
`labelLayout: { hideOverlap: true }`. Blank a label rather than let it collide or overflow:

```ts
// stacked segment, share mode — needs enough bar to sit in, and a real stack to sit on
formatter: (o) => (segmentCount[o.dataIndex] > 1 && o.value >= 12) ? Math.round(o.value) + "%" : ""
// stacked segment, count mode
formatter: (o) => o.value >= 3 ? String(o.value) : ""
// stacked segment, money mode
formatter: (o) => o.value >= 250 ? fmtUsdSmart(o.value) : ""
```

The `segmentCount > 1` guard matters: a lone segment is trivially 100%, and its label
overflows the bar it is meant to sit inside.

**Add a halo to value labels on a spiky line** — the line dips through its own labels, and
bare text is unreadable where it crosses:

```ts
label: { show: true, position: "top", backgroundColor: t.card, padding: [1, 2], borderRadius: 2 }
```

---

## 10. Choosing a chart

| The question | Chart | Recipe |
|---|---|---|
| Is this rate healthy over time, and on what volume? | dual-axis bar + line | `buildDualAxisBarLine` |
| What is this total made of, over time? | stacked bar | `buildStackedBar` |
| How did the **mix** shift over time? | 100% stacked | `buildStackedBar({normalize:true})` |
| Which categories are worst? (ranked, scannable) | horizontal bar | `buildHorizontalBar` |
| Is this KPI meeting its target? | line + dashed target markLine | `buildKpiTrend` |
| One number vs a healthy band, right now | gauge | `buildGauge` |
| Trend shape inside a tile | sparkline | `buildSpark` |
| How do the parts add to the total, right now? | waterfall | `buildWaterfall` |
| What share does each part hold, right now? | donut | `buildDonut` |
| Where do users drop out of a sequence? | funnel | `buildFunnel` |
| How is each funnel stage trending? | multi-line (log or %) | `buildFunnelTrend` |
| Us vs them, one metric over time | grouped bars / overlaid lines | `buildCompareSeries` |
| Us vs them, each side split into parts | stacked-per-entity bars | `buildCompareStacked` |
| Actual so far + projected remainder | stacked solid + striped | `buildProjected` |
| Several rates compared, volume as background | inverted dual axis | `buildRateOverVolume` |
| Do two groups share a distribution across bands? | grouped bars | `buildGroupedBars` |
| Does X drive Y, and does it differ by group? | scatter, one dot per entity | `buildScatter` |
| Two funnels side by side | **CSS grid, not ECharts** | recipes.md, "HTML funnel" |

**Anti-patterns:** pie with >5 slices (use donut or ranked bar) · dual axes where both are
rates (use one axis) · stacked lines · 3-D anything · an ECharts `funnel` used for a
side-by-side comparison — trapezoid widths are not comparable across two instances.

---

## 11. Interaction

### dataZoom

Attach `zoomWidgets(t)` to any time series past ~30 categories. **Remove it** when the
category count is small and fixed (≤ ~12) — and reclaim `grid.bottom` when you do.

### Legend

```ts
legend: { bottom: 0, icon: "roundRect", itemWidth: 11, itemHeight: 11,
          textStyle: { color: t.text }, type: "scroll" }
```

`type: "scroll"` is **required** past ~8 entries — it holds the legend to one row with pager
arrows instead of wrapping upward into the dataZoom slider.

**Suppress the legend and draw your own** when an entry needs more than a name: a definition
tooltip, a count, a label too long for one row. Render swatch + label + `ⓘ` below the chart.

### legendIsolate — additive legend selection

ECharts' default legend click is *subtractive*: a click hides that series. On a 25-series
stack, isolating one costs 24 clicks. `legendIsolate` flips it:

- from all-shown, the **first click isolates** the clicked series
- further clicks **add/remove** from the selection
- **emptying** the selection returns to all-shown

Series are only ever *hidden*, never removed from the option — so every legend entry keeps its
colour and stays clickable, and no plotted value is recomputed.

Three load-bearing traps — implementation and full comments in `echarts-host.tsx`:

1. **Pass a compile-time constant.** The prop is read once on mount; a state-driven value
   silently never takes effect.
2. **Do not combine with a share-in-tooltip stacked bar.** That tooltip totals only *visible*
   series, so shares would re-base on the selection — the one thing this promises not to do.
3. **String-coerce the series name.** Object keys are strings; a `Set` holding a non-string
   name would let a series be added but never removed.

### Tooltip content

Build multi-series axis tooltips in this order: bold category header, one
`marker + name + value` row per series, then a bold **Total** row where a total is meaningful.
**Filter invisible stack-total carrier series out of the rows AND out of the total.**

Where series names are long, let the tooltip wrap — see `references/escape-hatches.md`.

---

## 12. Height

| Context | Height |
|---|---|
| Sparkline in a tile | 56–70 |
| Small panel in a 3-column grid | 232–270 |
| Standard section chart | 320 |
| Primary / hero chart | 380–420 |

**Pick one height per grid and hold it across the whole grid** — an unequal panel reads as
more important when it is not.

---

## 13. Escape hatches

Four invariants have real, documented exceptions: `tooltip.confine` + wrapping,
`containLabel: false` for rotated axis names, a cropped percentage axis, and stripping
`dataZoom` / `legend`. See **`references/escape-hatches.md`** — and comment the reason at
every call site, or the next reader "fixes" it back.
