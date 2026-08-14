# Primitives — markup + CSS

Twelve components that cover ~95% of a dashboard page. Each is given as the CSS
(paste into `app/styles/primitives.css`, imported after `tokens.css`) plus a React usage
sketch. All colours come from tokens — see `dash-design-system` Rule 1.

---

## 1. Metric tile — `.metric`

The workhorse. Label + big value + delta + optional sub-line. Delta polarity follows the
metric's `inverse` flag (cost semantics vs volume semantics).

```css
.metric {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r);
  padding: var(--tile-pad);
}
.metric .lbl { color: var(--muted); font-weight: 500; font-size: 0.82rem;
               display: flex; align-items: center; gap: 4px; }
.metric .val { font-weight: 600; font-size: var(--metric-val); line-height: 1.15;
               padding-top: 0.15rem; letter-spacing: -0.02em; }
.metric .dlt { font-size: 0.82rem; font-weight: 600; padding-top: 0.2rem; }
.metric .sub { font-size: 0.72rem; color: var(--subtle); padding-top: 0.2rem; }

/* polarity: default is COST semantics (up = bad). `.normal` flips to volume semantics. */
.metric .dlt.up          { color: var(--bad); }
.metric .dlt.down        { color: var(--good); }
.metric .dlt.up.normal   { color: var(--good); }
.metric .dlt.down.normal { color: var(--bad); }
```

```tsx
type Kpi = {
  label: string; value: string;
  delta?: string | null; dir?: "up" | "down" | null;
  inverse?: boolean;            // true = cost semantics (default)
  sub?: string | null; help?: string | null;
};

export function Metric({ label, value, delta, dir, inverse = true, sub, help }: Kpi) {
  const cls = ["dlt", dir, dir && !inverse ? "normal" : ""].filter(Boolean).join(" ");
  return (
    <div className="metric">
      <div className="lbl">
        {label}
        {help && <span className="help" title={help}>?</span>}
      </div>
      <div className="val tnum">{value}</div>
      {delta && <div className={cls}>{dir === "down" ? "▼ " : dir === "up" ? "▲ " : ""}{delta}</div>}
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}
```

**Status variant** — add a coloured status rail when the metric has a target:

```tsx
<div className="metric" style={{ boxShadow: `inset 3px 0 0 ${statusColor}` }}>
```
where `statusColor` is `var(--good)` / `var(--bad)` / `var(--subtle)` for pass/fail/no-data.

---

## 2. Card — `.card`

Container for a chart or a table. Nothing else about it is decorative.

```css
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  padding: var(--tile-pad);
}
```

---

## 3. Section title — `.section-title`

Question-style heading with an accent rule. Optional muted granularity suffix.

```css
.section-title {
  font-size: 1.12rem; font-weight: 600;
  border-left: 3px solid var(--accent);
  padding: 0.1rem 0 0.1rem 0.6rem;
  margin: 1.4rem 0 0.6rem;
  color: var(--text);
}
.section-title .gran { color: var(--muted); font-weight: 400; font-size: 0.92rem; margin-left: 0.4rem; }
```

```tsx
<div className="section-title">
  Why is cost trending up?<span className="gran">(week)</span>
</div>
```

---

## 4. Eyebrow — `.eyebrow`

Tiny uppercase label above a KPI row or a block.

```css
.eyebrow {
  font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.07em;
  font-weight: 700; color: var(--muted); margin: 1.5rem 0 0.5rem;
}
```

---

## 5. Narrative card — `.narrative`

One auto-generated insight sentence, sitting between a section head and its chart.
Content is generated server-side (see `dash-data-contract`), rendered as rich text with
`<b>` and `<code>` allowed.

```css
.narrative {
  color: var(--text); background: var(--card);
  border-left: 3px solid var(--accent); border-radius: var(--r-sm);
  padding: 11px 15px; margin: 0.3rem 0 0.9rem;
  font-size: 0.92rem; line-height: 1.55;
}
.narrative code { background: rgba(127,127,127,0.14); padding: 1px 6px; border-radius: 4px;
                  font-family: var(--mono); font-size: 0.85em; }
.narrative b { font-weight: 700; }
```

> Prefer structured props over an HTML string in React. If you do render HTML, sanitise it —
> the source used `dangerouslySetInnerHTML` only because the payload came from its own
> trusted serializer.

---

## 6. Coverage banner — `.coverage-banner`

Amber caveat strip: data gap, proxy attribution, partial coverage, known caveat. Sits at
the top of a section or tab, never in the headline.

```css
.coverage-banner {
  background: var(--warn-bg); color: var(--warn-fg);
  border-left: 3px solid var(--warn-rule); border-radius: var(--r-sm);
  padding: 10px 14px; margin: 0.3rem 0 1rem;
  font-size: 0.86rem; line-height: 1.5;
}
.coverage-banner b { color: var(--warn-fg); }
```

---

## 7. Chip — `.chip`

Status pill, count badge, or legend swatch+label.

```css
.chip {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 0.78rem; font-weight: 600;
  padding: 4px 10px; border-radius: 999px;
  border: 1px solid var(--border); background: var(--surface);
  color: var(--muted); cursor: default; white-space: nowrap;
}
.chip .dot  { width: 8px; height: 8px; border-radius: 50%; }
.chip.good  { background: rgba(30,142,62,0.10);  border-color: rgba(30,142,62,0.30);  color: var(--good); }
.chip.bad   { background: rgba(217,48,37,0.10);  border-color: rgba(217,48,37,0.30);  color: var(--bad); }
.chip.info  { background: var(--card); }
.chip.clickable { cursor: pointer; transition: background 150ms; }
.chip.clickable:hover { background: var(--card); }
```

---

## 8. Segmented control — `.seg`

2–5 exclusive short options: period (7D/14D/30D/MTD), view mode (Volume/%rate), level.
Prefer this over a dropdown whenever the options are short and few.

```css
.seg {
  display: flex; background: var(--card); border: 1px solid var(--border);
  border-radius: var(--r); padding: 3px; gap: 2px;
}
.seg button {
  flex: 1; border: 0; background: transparent; color: var(--muted);
  font: inherit; font-size: 0.8rem; font-weight: 600;
  padding: 0.32rem 0; border-radius: var(--r-sm);
  cursor: pointer; transition: all 150ms;
}
.seg button.on { background: var(--surface); color: var(--text); box-shadow: var(--shadow-sm); }
```

```tsx
<div className="seg" role="tablist">
  {options.map(o => (
    <button key={o} className={value === o ? "on" : ""} onClick={() => onChange(o)}>{o}</button>
  ))}
</div>
```

When a `.seg` lives inside a chart-card header, shrink it: `width: auto; flex: 0 0 auto;`
and `button { padding: .3rem .75rem; font-size: .76rem; }`.

---

## 9. Tabs — `.tabs` / `.tab`

The primary view switch on a page. Deliberately sized to read as a **heading**, matching
`.section-title` scale — a tab bar sits in the heading hierarchy, not in body text.

```css
.tabs {
  display: flex; gap: 1.2rem; border-bottom: 1px solid var(--border);
  margin: 0.4rem 0 0.9rem; flex-wrap: wrap;
}
.tab {
  padding: 0.5rem 0.1rem; font-size: 0.9rem; font-weight: 500; color: var(--muted);
  border: 0; border-bottom: 2px solid transparent; margin-bottom: -1px;
  background: none; font-family: inherit; cursor: pointer; transition: color 150ms;
}
.tab:hover { color: var(--text); }
.tab.on { color: var(--accent); border-bottom-color: var(--accent); font-weight: 600; }
```

---

## 10. Expander — `.expander`

Native `<details>`. Use for deep tables, raw case lists, formula references — anything an
analyst wants and a stakeholder does not.

```css
.expander { border: 1px solid var(--border); border-radius: var(--r); margin: 0.6rem 0;
            background: var(--surface); overflow: hidden; }
.expander > summary {
  list-style: none; cursor: pointer; padding: 0.7rem 1rem;
  font-weight: 600; font-size: 0.9rem; display: flex; align-items: center; gap: 0.5rem;
  color: var(--text);
}
.expander > summary::-webkit-details-marker { display: none; }
.expander > summary .caret { transition: transform 150ms; color: var(--muted); }
.expander[open] > summary .caret { transform: rotate(90deg); }
.expander[open] > summary { border-bottom: 1px solid var(--border); }
.expander .exp-body { padding: 1rem; }
```

---

## 11. Data table — `.df`

```css
.df { width: 100%; border-collapse: collapse; font-size: 0.86rem; }
.df thead th {
  text-align: left; font-weight: 600; color: var(--muted); background: var(--card);
  padding: 0.5rem 0.7rem; border-bottom: 1px solid var(--border); white-space: nowrap;
}
.df thead th.num, .df td.num { text-align: right; font-variant-numeric: tabular-nums; }
.df tbody td { padding: 0.5rem 0.7rem; border-bottom: 1px solid var(--border); color: var(--text); }
.df tbody tr:last-child td { border-bottom: 0; }
.df tbody tr:hover { background: var(--card); }
.df .mono { font-family: var(--mono); font-size: 0.92em; }
.df .pill { display: inline-block; padding: 1px 8px; border-radius: 999px;
            font-size: 0.78rem; font-weight: 600; white-space: nowrap; }

/* long tables scroll inside their card, header pinned */
.df-scroll { overflow: auto; max-height: 440px; }
.df-scroll .df thead th { position: sticky; top: 0; z-index: 1; }
```

Column definitions carry their own formatting so a table is declarative:

```tsx
type Col<T> = { label: string; num?: boolean; mono?: boolean; render: (row: T) => React.ReactNode };

export function DataTable<T>({ columns, rows }: { columns: Col<T>[]; rows: T[] }) {
  return (
    <table className="df">
      <thead>
        <tr>{columns.map((c, i) => <th key={i} className={c.num ? "num" : ""}>{c.label}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r, ri) => (
          <tr key={ri}>
            {columns.map((c, ci) => (
              <td key={ci} className={`${c.num ? "num " : ""}${c.mono ? "mono" : ""}`}>{c.render(r)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

**Matrix tables** (N reasons × M periods) additionally pin the first column:

```css
.mtbl { border-collapse: collapse; font-size: .72rem; font-variant-numeric: tabular-nums; width: 100%; }
.mtbl th, .mtbl td { padding: 3px 8px; border-bottom: 1px solid var(--border);
                     text-align: right; white-space: nowrap; }
.mtbl thead th { position: sticky; top: 0; background: var(--card); z-index: 2; font-size: .6rem;
                 text-transform: uppercase; letter-spacing: .03em; color: var(--muted); }
.mtbl tbody th { position: sticky; left: 0; background: var(--card); z-index: 1; text-align: left;
                 font-weight: 600; font-family: var(--mono); font-size: .68rem; }
.mtbl thead th:first-child { left: 0; z-index: 3; text-align: left; }
.mtbl tbody tr:hover td { background: var(--accent-soft); }
```

---

## 12. Page header — `.page-head`

Title + caption on the left, date picker / status chip on the right.

```css
.page-head {
  display: flex; align-items: flex-start; justify-content: space-between;
  gap: 1rem; margin-bottom: 0.4rem;
}
.page-head h1 { font-size: 1.7rem; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 0.15rem; }
.page-head .cap { font-size: 0.85rem; color: var(--muted); max-width: 640px; line-height: 1.5; }
.page-head .date-pick { display: flex; flex-direction: column; align-items: flex-end;
                        gap: 0.25rem; flex: 0 0 auto; }
.page-head .date-pick .span { font-size: 0.74rem; color: var(--subtle); }
```

---

## 13. BLUF card — `.bluf`

"Bottom line up front". The first thing on an analytical page: the conclusion, as 1–4
bullets, before any chart. Left rule carries the verdict tone.

```css
.bluf { background: var(--surface); border: 1px solid var(--border);
        border-left: 4px solid var(--brand); border-radius: var(--r-lg);
        padding: var(--tile-pad); margin-bottom: 0.9rem; }
.bluf-lbl { font-size: 0.68rem; font-weight: 800; letter-spacing: 0.06em;
            text-transform: uppercase; color: var(--brand); }
.bluf ul { margin: 0.35rem 0 0; padding-left: 1.1rem; font-size: 0.86rem; line-height: 1.5; }
```

```tsx
<div className="bluf" style={{ borderLeftColor: toneColor }}>
  <div className="bluf-lbl" style={{ color: toneColor }}>◆ Bottom line</div>
  <ul>{points.map((p, i) => <li key={i}>{p}</li>)}</ul>
</div>
```

Tone: `--brand` for a neutral read, `--bad` when the verdict is a problem, `--warn-rule`
when it is inconclusive. A single-sentence verdict can replace the list.

---

## 14. Callout — `.callout`

A boxed aside that chunks running prose. Two kinds, and the distinction is load-bearing:

- **note** (blue) — methodology, definition, caveat. *How to read this.*
- **insight** (emerald, `◆`) — a finding or verdict. *What this says.*

```css
.callout { border-left: 3px solid; border-radius: 6px; padding: 0.5rem 0.75rem;
           margin: 8px 0; font-size: 0.78rem; color: var(--text); line-height: 1.6; }
.callout-lbl { font-size: 0.62rem; font-weight: 800; letter-spacing: 0.05em; margin-bottom: 3px; }
.callout.note    { border-color: #3B82F6; background: rgba(59,130,246,0.07); }
.callout.note    .callout-lbl { color: #3B82F6; }
.callout.insight { border-color: #059669; background: rgba(5,150,105,0.07); }
.callout.insight .callout-lbl { color: #059669; }
```

Do not use `.narrative` for these — that is the generated per-section insight sentence,
and mixing the two makes both stop meaning anything.

---

## 15. Status pill — `.pill-status`

A pill tinted from a single semantic hue, via hex-alpha suffixes rather than a parallel set
of tint tokens.

```css
.pill-status { font-size: 0.66rem; font-weight: 800; letter-spacing: 0.02em;
               padding: 2px 9px; border-radius: 999px; border: 1px solid;
               text-transform: uppercase; white-space: nowrap; display: inline-block; }
```

```tsx
const TONE = { good: "--good", bad: "--bad", warn: "--warn-rule",
               info: "--entity-b",  subtle: "--subtle" } as const;

export function StatusPill({ tone, children }: { tone: keyof typeof TONE; children: React.ReactNode }) {
  const c = getComputedStyle(document.documentElement).getPropertyValue(TONE[tone]).trim();
  return (
    <span className="pill-status"
          style={{ color: c, background: c + "1f", borderColor: c + "40" }}>
      {children}
    </span>
  );
}
```

Map a status **vocabulary** to tones once, in one object, and reuse it everywhere that
vocabulary appears — chart colours, table pills, legend swatches:

```ts
const HEALTH_TONE = { healthy: "good", new: "subtle", watch: "warn", retire: "bad" } as const;
const ACTION_TONE = { keep: "good", monitor: "info", throttle: "warn", retire: "bad" } as const;
```

---

## 16. Number table — `.numtbl`

Distinct from `.df`. Where `.df` is a list of records, this is a **measure × period matrix**:
right-aligned throughout, a swatch tying each row to its chart series, a Δ column, and a
bold Total row.

```css
.numtbl { overflow-x: auto; border: 1px solid var(--border); border-radius: 8px; margin-top: 10px; }
.numtbl table { border-collapse: collapse; width: 100%; font-size: 0.8rem; }
.numtbl th { background: var(--card); color: var(--muted); font-weight: 600; text-align: right;
             padding: 6px 9px; border-bottom: 2px solid var(--border); white-space: nowrap; }
.numtbl th.l, .numtbl td.l { text-align: left; }
.numtbl td { text-align: right; padding: 5px 9px; border-bottom: 1px solid var(--border);
             white-space: nowrap; }
.numtbl tr:last-child td { border-bottom: none; }
.numtbl tr.total td { font-weight: 700; border-top: 2px solid var(--border); background: var(--card); }
.numtbl .sw { display: inline-block; width: 9px; height: 9px; border-radius: 2px;
              margin-right: 6px; vertical-align: middle; }
```

Three rules that make it trustworthy:

1. **Δ is the relative change of the metric currently displayed**, newest period vs the one
   before — not of some other column.
2. **Δ polarity follows the row's meaning.** More of a failure reason is worse, so `+Δ` is
   red there; a volume row's Δ is **neutral grey** (more calls is neither good nor bad).
   Never colour a row whose polarity you cannot name.
3. **In share mode, drop the trailing "Share" column** — the last period column already is
   it, and the Total row is a tautological 100%.

---

## 17. Distribution bar — `.distbar`

A single horizontal bar split into weighted segments — a category mix in one line, where a
donut would be overkill.

```css
.distbar { display: flex; height: 22px; border-radius: 5px; overflow: hidden;
           border: 1px solid var(--border); }
.distbar > i { display: flex; align-items: center; justify-content: center;
               font-size: 0.66rem; font-weight: 800; color: #fff; min-width: 0; font-style: normal; }
.distbar-leg { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 7px;
               font-size: 0.68rem; color: var(--muted); font-weight: 600; }
.distbar-leg i { width: 9px; height: 9px; border-radius: 2px; display: inline-block;
                 margin-right: 4px; vertical-align: -1px; font-style: normal; }
```

```tsx
{order.map(k => counts[k] > 0 && (
  <i key={k} style={{ flex: counts[k], background: toneColor(k) }} title={`${k} ${counts[k]}`}>
    {counts[k] / total > 0.08 ? counts[k] : ""}   {/* hide the label below 8% — it won't fit */}
  </i>
))}
```

`flex: <count>` does the proportioning, so no percentage maths. The always-visible legend
below is not optional: unlabelled segments are unreadable.

---

## 18. Formula strip — `.formula`

Shows how a derived number is computed, as equal steps separated by operators. Use it when
the *arithmetic itself* is the point — capacity sizing, a unit-economics definition, a
target derivation.

```css
.formula { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr;
           background: var(--surface); border: 1px solid var(--border);
           border-radius: var(--r-lg); padding: 0; }
.formula .step { padding: 12px 16px; border-right: 1px solid var(--border); }
.formula .step:last-child { border-right: none; }
.formula .op  { font-size: 0.64rem; font-weight: 700; text-transform: uppercase;
                letter-spacing: 0.04em; color: var(--subtle); }
.formula .big { font-family: var(--mono); font-size: 1.5rem; font-weight: 700; margin-top: 3px; }
.formula .sm  { font-size: 0.72rem; color: var(--muted); margin-top: 1px; }
.formula .result .big { color: var(--bad); }   /* or --good — colour the OUTCOME, not the inputs */
```

The operator belongs in the step label (`÷ sustainable cap`, `= numbers needed`), so the
row reads as one equation left to right.

> **Note on `var(--mono)` for big numbers.** The `.metric` tile uses the UI font for its
> value; these denser composite cards use the mono font. Both exist in the source. Pick per
> component and hold it: mono suits a grid of many small figures being compared
> digit-by-digit, the UI font suits a single headline number.

---

## 19. Compare card — `.cmpcard`

Two entities on one metric: a labelled bar each (width = fraction of the larger), then a
footer with Δ, confidence interval, and a significance chip.

```css
.cmpcard-arm  { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
.cmpcard-nm   { font-size: 0.71rem; color: var(--muted); width: 66px; flex: none;
                display: flex; align-items: center; gap: 6px; }
.cmpcard-nm i { width: 10px; height: 10px; border-radius: 50%; }
.cmpcard-track{ flex: 1; height: 6px; background: rgba(128,128,128,0.18);
                border-radius: 3px; overflow: hidden; }
.cmpcard-fill { display: block; height: 100%; border-radius: 3px; }
.cmpcard-val  { font-size: 0.94rem; font-weight: 800; width: 66px; text-align: right;
                flex: none; font-variant-numeric: tabular-nums; }
.cmpcard-foot { display: flex; justify-content: space-between; align-items: center; gap: 8px;
                margin-top: 9px; padding-top: 8px; border-top: 1px dashed var(--border); }
```

The **dashed** footer rule is deliberate — it separates the statistics from the measurement
without reading as a new section.

---

## 20. Definition affordances

Definitions are systematic in this product, not ad-hoc. Three levels:

```tsx
// 1. Inline glyph on a metric label or table header
const H = (label: string, tip: string) =>
  <span title={tip}>{label}<span className="help">?</span></span>;

<th>{H("Δ rate", "Current − baseline, in percentage points — the drift signal")}</th>

// 2. Chart hint line — the denominator and exclusions, under the chart title

// 3. Glossary expander at the bottom of the page — every metric, one table
<Expander label="Metric definitions" icon="fileText">
  <table className="df">…</table>
</Expander>
```

Plus a **status legend** wherever pills appear, always visible rather than hover-only:
a row of the actual pills followed by the thresholds that produce them
(`decaying = Δ ≥ +6pp · burned = Δ ≥ +12pp · new = < 1,000 lifetime calls`). A reader
should never have to hover to learn what a colour means.

---

## 21. Section banner — `.section-banner`

The full-width alternative to `.section-title`. Use it for **top-level dividers** on a long
report where an accent rule is too quiet to break the page. Pair with `.section-sub` for a
label sitting above a single chart inside a banner section.

```css
.section-banner { background: var(--section-bg); color: var(--text);
                  font-size: 1.15rem; font-weight: 600; padding: 10px 16px;
                  margin: 1.4rem 0 0.6rem; border-radius: 3px;
                  border-bottom: 1px solid var(--section-rule); }
.section-sub    { color: var(--text); font-size: 1rem; font-weight: 700;
                  margin: 1rem 0 0.4rem; }
```

**Pick one section-header style per product and hold it.** `.section-title` (accent rule) and
`.section-banner` (filled strip) both work; mixing them on sibling pages does not.

---

## 22. Heat-shaded table cell

For a measure × period matrix where the reader hunts for hot spots. Two rules make it honest:

1. **Scale each column to its own max**, never to a table-wide max — the columns are different
   measures and must never be read off one scale.
2. **Flip the ink above ~55% of the ramp**, or dark text on a saturated cell disappears.

```ts
/** Interpolate a single-hue ramp. `frac` is the cell's share of ITS column max. */
function heatCell(frac: number, ramp: [number[], number[]]) {
  const [lo, hi] = ramp;
  const rgb = lo.map((c, i) => Math.round(c + (hi[i] - c) * frac));
  return {
    background: `rgb(${rgb.join(",")})`,
    color: frac > 0.55 ? "#fff" : "var(--text)",
  };
}

// blue ramp for neutral magnitude, red ramp for "more is worse"
export const RAMP_BLUE: [number[], number[]] = [[239, 246, 255], [29, 78, 216]];
export const RAMP_RED:  [number[], number[]] = [[254, 242, 242], [185, 28, 28]];

// per column, not per table:
const colMax = Math.max(...rows.map(r => Number(r[col]) || 0)) || 1;
const style  = heatCell((Number(row[col]) || 0) / colMax, RAMP_RED);
```

Use `RAMP_RED` only where more genuinely is worse. A red heat map over a neutral measure
reads as an alarm that was never raised.

---

## 23. Insight callout renderer — `.insight`

Renders the `Insight` payload from `dash-data-contract`. Distinct from `.callout` (a
hand-written aside) and from `.narrative` (a single generated sentence): this one renders
**structure** — a headline metric, a delta badge, a dominant contributor, and per-item trend
rows.

```css
.insight { border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px;
           margin: 0 0 12px; font-size: 0.82rem; line-height: 1.55;
           background: var(--accent-soft); }
.insight-metric { font-size: 0.95rem; font-weight: 700; }
.insight-period { color: var(--muted); font-size: 0.76rem; margin-left: 6px; }
.insight-badge  { font-weight: 700; margin-left: 8px; font-size: 0.78rem; }
.insight-sw     { width: 9px; height: 9px; border-radius: 2px; display: inline-block; margin-right: 6px; }
.insight-row    { display: flex; justify-content: space-between; gap: 10px;
                  font-size: 0.79rem; line-height: 1.7; }
```

```tsx
export function InsightCallout({ ins }: { ins?: Insight | null }) {
  if (!ins) return null;
  const dl = ins.delta;
  // ARROW BY SIGN, COLOUR BY `improving`. Never colour by sign — that is what lets
  // one component narrate a cost metric and a quality metric correctly.
  const arrow = !dl ? "" : dl.pts > 0 ? "▲" : dl.pts < 0 ? "▼" : "▬";
  const colour = !dl || dl.pts === 0 ? "var(--muted)"
               : dl.improving ? "var(--good)" : "var(--bad)";
  return (
    <div className="insight">
      <div>
        <b className="insight-metric">{ins.metric}</b>{ins.label ? ` ${ins.label}` : ""}
        {ins.periodTo && <span className="insight-period">· {ins.periodTo}</span>}
        {dl && (
          <span className="insight-badge" style={{ color: colour }}>
            {arrow} {dl.pts > 0 ? "+" : ""}{dl.pts}{dl.unit ? ` ${dl.unit}` : ""}
            {dl.periodFrom ? ` vs ${dl.periodFrom}` : " vs prior"}
          </span>
        )}
      </div>
      {ins.dominant && (
        <div>
          <span className="insight-sw" style={{ background: ins.dominant.color }} />
          Dominant: <b>{ins.dominant.label}</b> — {ins.dominant.share}% of the movement
        </div>
      )}
      {ins.rising && (
        <div style={{ color: "var(--muted)" }}>
          ↑ Rising: {ins.rising.label} (+{ins.rising.deltaPts} pts
          {ins.rising.periodFrom ? ` vs ${ins.rising.periodFrom}` : ""})
        </div>
      )}
      {ins.trends && (
        <div style={{ marginTop: 6 }}>
          {ins.trendsLabel && (
            <div style={{ fontSize: ".72rem", color: "var(--muted)", marginBottom: 3 }}>
              {ins.trendsLabel}
            </div>
          )}
          {ins.trends.map((tr, i) => {
            const s = tr.story;
            const a = !s ? "" : s.word === "rising" ? "▲" : s.word === "easing" ? "▼" : "▬";
            const c = !s || s.word === "flat" ? "var(--muted)"
                    : s.improving ? "var(--good)" : "var(--bad)";
            return (
              <div className="insight-row" key={i}>
                <span>{tr.label}</span>
                {s ? (
                  <span style={{ whiteSpace: "nowrap" }}>
                    {s.first}% → <b>{s.last}%</b>
                    <span style={{ color: c, marginLeft: 6, fontWeight: 700 }}>
                      {a} {s.word} ({s.tone})
                    </span>
                  </span>
                ) : (
                  <span><b>{tr.pct == null ? "—" : `${tr.pct}%`}</b></span>
                )}
              </div>
            );
          })}
        </div>
      )}
      {(ins.lines ?? []).map((t, i) => <div key={i} style={{ color: "var(--muted)" }}>{t}</div>)}
    </div>
  );
}
```

**Use the flat marker `▬` for zero**, not a blank. A missing arrow reads as a rendering bug;
an explicit flat marker reads as "we checked, it didn't move".

---

## Bonus: inline share bar (table cell)

Used where a percentage in a table benefits from a magnitude cue.

```css
.bar { position: relative; height: 18px; background: var(--card); border-radius: var(--r-sm);
       overflow: hidden; min-width: 130px; }
.bar-fill { position: absolute; inset: 0 auto 0 0; background: var(--accent); opacity: 0.5; }
.bar-txt  { position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
            font-size: 0.72rem; color: var(--text); }
```
