---
name: dash-page-patterns
description: >
  How to compose a dashboard page in Next.js — and the entry point whenever someone asks for
  a whole page or a whole dashboard. Covers page anatomy, glance-vs-drill hierarchy, page
  header, the five-tile glance hero and its north-star variants, sticky section jump-nav, the
  numbered section rhythm, chart cards, distribution scorecard, chart-to-table toggle,
  progressive disclosure, filter-bar behaviour and filter correctness, empty/loading/error
  states, PNG/PDF export and the provenance footer. Building a page needs all four dash-*
  skills — load `dash-design-system`, `dash-charts` and `dash-data-contract` alongside this
  one before writing page code.
  TRIGGERS: dash page, build a dashboard, new dashboard page, scaffold a dashboard, report
  page, dashboard layout, page anatomy, glance hero, north-star metric block, above the fold,
  tile soup, section rhythm, jump nav, chart card, chart vs table toggle, progressive
  disclosure, dashboard filter bar, date range preset, dashboard empty state, dashboard
  skeleton, export dashboard PNG, export report PDF, provenance footer, source note,
  as-of timestamp.
---

# Dashboard — Page Patterns

The grammar for composing a page out of `dash-design-system` primitives and `dash-charts`
recipes. Distilled from six live report pages of a production analytics dashboard.

---

## 0. Load these first

Building a page needs all four dash-* skills. Every code sample below uses classes and
components that only exist if the other three were followed. Before writing page code:

1. **`dash-design-system`** — install `references/tokens.css` and set `data-theme` on
   `<html>`, or every `var(--…)` below resolves to nothing. Its primitive table is where
   `.card`, `.chip`, `.eyebrow`, `.seg`, `.metric`, `.numtbl`, `.bluf`, `.callout` come from.
2. **`dash-data-contract`** — defines `SectionPayload`, `Kpi`, `DualAxisTrend`,
   `GlanceSummary`, `PageMeta`: the props every component below takes.
3. **`dash-charts`** — the `<ECharts>` host and the recipe that goes inside each chart card.

Then copy `references/page-css.css` into `app/styles/page.css` and import it **after**
tokens.css and primitives.css. That file holds every class this skill references; nothing
here asks you to transcribe CSS by hand.

---

## 1. The governing principle: glance vs drill

Every page serves two readers, and the failure mode is serving neither:

- **Stakeholder** — wants the headline, the trend, and "are we healthy vs target". Glances weekly.
- **Analyst** — wants to know *why* it moved, sliced by dimension. Daily.

**A first-time viewer must know the headline number, its trend and its health in under five
seconds.** Everything after that is a ladder of detail.

Build the page in this order of priority:

1. **Top third = glance.** Hero / KPI band + health status. Never scrolled past.
2. **Middle = the primary story.** One chart that carries the page's main claim.
3. **Below, or behind disclosure = drill.** Dimension slicing, deep tables, case lists.
4. **Demote config.** Settings are not insight — put them in a drawer at the bottom.

**Do not place more than five equal-weight tiles in one band.** Give exactly one element on
the page the largest visual weight, and make it the headline number. The named anti-pattern
is **tile soup**: eleven equal-weight numbers, no hierarchy, the eye bounces and nobody can
tell what the page is about. A page where everything has the same weight has no hierarchy,
however clean it looks.

---

## 2. Page anatomy

```
┌ .page-head ────────────────────────────────────────────┐
│ H1 title                              [date picker]    │
│ caption sentence                      resolved window  │
└────────────────────────────────────────────────────────┘
  [ .filterbar ]                   ← when the page has filters
  [ .seg  view switch ]            ← only when the page has >1 mode
┌ .glance / .hero ───────────────────────────────────────┐
│ eyebrow + "N/M targets met" chip                       │
│ 5 status tiles                                         │
└────────────────────────────────────────────────────────┘
  [ .secnav ]                      ← only on report pages with 5+ sections
┌ .sec ──────────────────────────────────────────────────┐
│ ①  CODE  Section title            .sec-head            │
│    one-sentence description                            │
│    ───────────────────────────────────────────         │
│    [ .callout insight ]                                │
│    [ .row-4 : KPI tiles ]                              │
│    [ .chart-card : trend ]                             │
│    [ .chart-card : distribution ] [ .expander detail ] │
└────────────────────────────────────────────────────────┘
   … sections repeat, same order every time …
┌ .foot : window · grain · source · formula · as-of ─────┐
```

Not every page needs every block. A single-question page is header → hero → one chart → one
table. **The rhythm is what stays constant.**

---

## 3. Glance hero

Render five tiles in one raised card. Each carries value + delta + either a target status or
a note. Put a chip in the header counting targets met.

```tsx
export function Glance({ summary }: { summary: GlanceSummary }) {
  const allMet = summary.targetsTotal > 0 && summary.targetsMet === summary.targetsTotal;
  return (
    <div className="glance">
      <div className="glance-head">
        <div className="eyebrow"><Activity size={13} /> At a glance</div>
        <span className={`chip ${allMet ? "good" : "bad"}`}>
          <span className="dot" style={{ background: allMet ? "var(--good)" : "var(--bad)" }} />
          {summary.targetsMet}/{summary.targetsTotal} targets met
        </span>
      </div>
      <div className="glance-grid">
        {summary.tiles.map((t, i) => <GlanceTile key={i} t={t} />)}
      </div>
    </div>
  );
}
```

Give every tile a **status rail**: `box-shadow: inset 3px 0 0 var(--good)` / `var(--bad)` /
`var(--border)`, so pass/fail reads without reading. Where a tile has no target, use
`--border` and render `note` — not a status pill.

Count `targetsTotal` from tiles that actually **have** a target. Counting all tiles makes the
chip say "3/8 targets met" on a page with three targets.

---

## 4. Section rhythm

Number and code every section, so a reader can say "section 04" or its code in chat and
everyone lands in the same place.

```tsx
export function SectionHead({ num, code, title, desc }: SectionHeadProps) {
  return (
    <header className="sec-head">
      <div className="sec-head-top">
        <span className="sec-num">{num}</span>
        {code && <span className="sec-code">{code}</span>}
        <h2>{title}</h2>
      </div>
      {desc && <p className="sec-desc">{desc}</p>}
    </header>
  );
}
```

**Get vertical rhythm from flex `gap`, never from per-block margins.** Wrap sections in
`.flow` (gap 1.75rem) and each section body in `.sec-body` (gap 0.85rem). Never hand-tune
`margin-bottom` on an individual block — that is how a page drifts out of rhythm.

### Order within a section — fixed

1. Section head — number, code, title, one-sentence description
2. Insight callout — the generated "what happened" sentence
3. KPI row — 4–5 tiles, `.row-4` / `.row-5`
4. Primary trend chart
5. Distribution / composition chart
6. Expander for deep tables and case lists

Skip freely; **do not reorder.** A reader learns the rhythm on section 1 and navigates the
rest by muscle memory.

---

## 5. Chart card

```tsx
export function ChartCard({ title, hint, right, children }: ChartCardProps) {
  return (
    <div className="card chart-card">
      {(title || right) && (
        <div className="chart-head">
          <div>
            <div className="chart-title">{title}</div>
            {hint && <div className="chart-hint">{hint}</div>}
          </div>
          {right}
        </div>
      )}
      {children}
    </div>
  );
}
```

Put the control **in the header**, not floating above the card.

**Write a hint line on every chart card** naming the denominator, the exclusions and the
grain. It costs one line and prevents most "is this number wrong?" questions.

### Distribution scorecard

Above a stacked chart, render the period grand total plus each series' share.

**Compute the totals from the same `dist` object you built the chart option from.** Never
issue a second query, never accept a server-supplied total — that is the only thing
guaranteeing the strip and the chart cannot disagree.

```tsx
const totals = dist.series.map(s => ({
  name: s.name, color: s.color,
  total: s.data.reduce((a, v) => a + (Number(v) || 0), 0),
}));
const grand = totals.reduce((a, c) => a + c.total, 0);
```

---

## 6. Chart ↔ table toggle

Every chart is one representation of a table that also exists. Put a `.seg` in the chart
header switching **Chart / Table**. It costs almost nothing and removes the most common
request an analyst makes.

```tsx
const [view, setView] = useState<"chart" | "table">("chart");
<ChartCard title="By category, each period" right={<Seg value={view} onChange={setView} options={["chart","table"]} />}>
  {view === "chart" ? <ECharts option={opt} height={340} /> : <NumberTable … />}
</ChartCard>
```

Build the table with `.numtbl` (`dash-design-system` primitive 16) **from the same payload
object** the chart option was built from.

Where the chart has a **Share / Volume** toggle, the table follows it: in share mode each
cell is that series' % of the period total, and the trailing "Share" column disappears — the
last period column already is it, and the Total row is a tautological 100%.

---

## 7. Hero treatment variants

For a single-metric page, the same number supports three interchangeable hero visuals. **Pick
one per page; do not offer the reader a switch.**

| Variant | Shows | Choose when |
|---|---|---|
| **Band** | Position on a good→bad gradient track, with a value marker and a dashed goal tick | There is an accepted healthy range and "are we inside it" is the question |
| **Gauge** | Dial with three coloured zones, value as a needle | Same, but the page has room and wants a focal object |
| **Spark** | The window's trend line with the band shaded behind | *Direction* matters more than today's position |

Build the left-hand column in this order: eyebrow + `?` definition · value at ~4.2rem
(`.ns-value`) + unit · formula line (`.ns-formula`) · delta vs prior with a benchmark chip ·
one-sentence "moved because…" · chips.

Scale the track maximum from the data, rounded to a clean step, so an adjustable band or a
changed basis can never push the marker off the end:

```ts
const heroMax = Math.max(0.30, Math.ceil(Math.max(band.high, value, goal) * 1.2 / 0.05) * 0.05);
const markerPct = Math.max(0, Math.min(100, value / heroMax * 100));
```

**Polarity.** For a lower-is-better metric, below the band is **good** — beating the
benchmark is a win, so only the upper side is red. Getting this backwards turns the best week
of the year into a red dashboard.

---

## 8. Chips that navigate

A chip can set the drill tab and scroll to it in one click:

```tsx
<Chip onClick={() => { setDrill("why"); document.getElementById("drill")?.scrollIntoView({ block: "start" }); }}>
  rate × efficiency ▸
</Chip>
```

Give the drill section an `id` and `scroll-margin-top: 64px` so the sticky nav does not cover
it. **Suffix `▸` on every chip that navigates; never on a label chip.**

---

## 9. Sticky section nav

Add `.secnav` on report pages with 5+ sections — pill links to each section anchor. Give each
`.sec` a matching `id`.

---

## 10. Progressive disclosure — which control for what

| Need | Control |
|---|---|
| Switch between **mutually exclusive full views** of the page | `.tabs` — reads as a heading |
| Switch a **short bounded option** (period, level, volume vs rate) | `.seg` |
| Reveal **detail an analyst wants and a stakeholder does not** | `.expander` (`<details>`) |
| Reveal a **definition or caveat** | `?` help glyph with a `title`, or the chart hint |
| **Many or long options** | `<select>` — but reconsider whether the page needs them all |

Two hard rules:

- **Never nest tabs inside tabs.** If you want to, the page is two pages.
- **Make the default the common case.** An expander that is open by default is not
  disclosure, it is layout.

Put deep tables inside an `.expander` **and** give the table wrapper
`overflow: auto; max-height: 440px` with `position: sticky; top: 0` on `thead th`, so a
24×N matrix never consumes the page.

**Collapse degenerate toggle grids.** If one toggle is a normalisation of another —
Volume/% crossed with Count/Share — you have multiplied the options without adding a reading
anyone wanted. Collapse to a single 3-way control.

---

## 11. Filters

Put filters in one bordered strip (`.filterbar`) directly under the page header — a single
visual group, not controls scattered next to the charts they affect.

### Where each kind of filter lives

- **View toggles** (share vs volume, level, channel) — **client state**, instant, no refetch.
  Ship all variants in the payload.
- **Window and dimension filters** — **URL search params**, so a filtered view is shareable
  and back-button-able.
- Always render the **resolved window as text** next to the picker
  (`2026-05-21 → 2026-06-03`). A preset name alone is not enough when someone screenshots it.
- Show a **one-line summary of what is filtered** when a filter is non-default, so a
  surprising number is explained by the row above it.

Standard presets: `7d · 14d · 30d · MTD · since launch · custom`.

### Filter correctness — four rules that produce silent wrong numbers

1. **Derive aggregate figures from the aggregate, never from a truncated detail payload.**
   A detail list capped at N rows will silently under-report if you sum it for a chart or a
   share. Keep the aggregate in the payload alongside the capped detail, and say which is
   which in the field comment.
2. **When a filter is active, re-derive the chart from the filtered rows** so the chart
   always equals the table beside it. A filtered table next to an unfiltered chart is read
   as a bug in the numbers.
3. **Use `null` as the "all selected" sentinel** for a multi-select, not a Set containing
   every option. A full Set goes stale the moment the window changes and a new category
   appears — the new one silently arrives deselected.
4. **Coerce an impossible combination, do not disable it.** If a measure is meaningless at
   the selected level (a rate whose numerator and denominator are the same column at that
   grain), snap the view back to a valid one in an effect rather than greying out a control
   the user already clicked.

---

## 12. States

Five, not four. Design all of them.

| State | Render |
|---|---|
| **Loading** | Skeleton at the **real height** of the chart/table. Never a spinner that collapses the layout and reflows on arrival |
| **Empty** (query ran, nothing in the window) | Inside the card, at chart height: one muted line saying what was searched and why it might be empty. Not a bare "No data" |
| **Filtered to nothing** (data exists, the filter excluded it) | A *different* message — name the active filter and offer a Reset. Showing "no data" here sends the reader hunting for a pipeline problem that does not exist |
| **Partial** (some rows suppressed, a source is stale) | Render the chart **plus** a `.coverage-banner` naming what is missing |
| **Error** | Inside the card, `--bad` text, one actionable sentence. Never a stack trace |

Use `loading.tsx` + `<Suspense>` **per section**, so one slow query does not block the page.

---

## 13. Export

Report pages carry PNG / PDF export — people paste these into decks.

```tsx
const canvas = await html2canvas(node, {
  scale: 2,
  backgroundColor: getComputedStyle(document.body).getPropertyValue("--bg").trim() || "#fff",
  useCORS: true, logging: false,
  ignoreElements: el => el.getAttribute?.("data-export-ignore") !== null,
});
```

Mark the toolbar `data-export-ignore`. For PDF, fit the image to a single landscape A4 page.
**Name the file with the data date, not the export date:** `weekly-report_2026-06-03.png`.
Show the row count on an export button and disable it at zero.

Charts must carry `animation: false` for capture to be reliable — see `dash-charts`,
"Invariants".

---

## 14. Footer — the provenance line

End every analytical page with a source note. It is what makes a number defensible when
someone challenges it in a meeting.

Structure it as **bold label + value, pipe-separated** — a reader scans it for one fact, they
do not read it as prose:

```tsx
<div className="foot">
  <b>Window</b> {meta.window} · <b>Grain</b> {meta.grain} ·{" "}
  <b>Source</b> <code>{meta.base}</code> ·{" "}
  <b>Filters</b> {meta.filters} ·{" "}
  <b>Formula</b> {meta.formula} ·{" "}
  <b>As-of</b> {meta.asOf}
</div>
```

Cover, in this order: **window · grain · source · filters applied · formula · as-of ·
known caveats**. Take every value from `PageMeta` (`dash-data-contract`) — a hardcoded footer
goes stale silently and is worse than none.

### Grain is the caveat that matters most

When one page shows numbers at **different grains** — sessions vs items vs attempts — label
every one and state plainly that they do not tie.

The reason: one session that retries an action three times is *one* session and *three*
attempts. Both counts are correct and will never reconcile. A reader who spots two numbers
that should match and don't reports it as a bug — so **name the grain where the numbers are**,
not only in the footer.

---

## 15. Checklist for a new page

- [ ] All four dash-* skills loaded; `page-css.css` imported after tokens + primitives
- [ ] Headline number, trend and health readable in under 5 seconds without scrolling
- [ ] Exactly one element carries the largest visual weight
- [ ] Sections numbered/coded, fixed order (head → insight → KPIs → trend → distribution)
- [ ] Vertical rhythm from flex `gap`, not per-block margins
- [ ] Every chart card has a hint line naming denominator, exclusions and grain
- [ ] Chart↔table toggle built from the same payload object
- [ ] Deep detail behind an expander; long tables scroll inside their card
- [ ] Filters in one strip; window filters in the URL; resolved window shown as text
- [ ] Aggregates derived from aggregates, not from a capped detail list
- [ ] All five states designed, including filtered-to-nothing
- [ ] Grid collapses at 1180 / 820 / 560; no horizontal page scroll
- [ ] Footer populated from `PageMeta`; every grain on the page labelled
- [ ] Renders correctly in dark mode, charts included
