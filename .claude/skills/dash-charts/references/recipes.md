# Chart recipes

Eighteen builders. Each takes a plain config object (shapes in `dash-data-contract`) and
returns an `EChartsOption`.

**Read only the numbered section for the recipe you need** — this is a lookup table, not a
document. 1 dual-axis · 2 stacked · 3 horizontal bar · 4 KPI-vs-target · 5 gauge · 6 spark ·
7 waterfall · 8 donut · 9 funnel · 10 funnel trend · 11 ranked bar · 12 compare-series ·
13 compare-stacked · 14 projected · 15 rate-over-volume · 16 grouped bars · 17 scatter ·
18 HTML funnel.

Common imports for every recipe:

```ts
import type { EChartsOption } from "echarts";
import { T, baseAxis, tip, zoomWidgets, type Theme } from "./echarts-host";
import {
  axisFmt, tipFmt, compactFmt, fmtUsd4, DP, labelInk, hexToRgba,
  CHART_CATEGORICAL, chartTextStyle, entityColors, axisFmtUsdUnit, type Kind,
} from "./format";
```

Three things every builder does:

1. Starts with `const t = T();`
2. Returns an option carrying **`animation: false`** and **`textStyle: chartTextStyle()`**
   (canvas does not inherit the page font — omit it and the chart renders in the
   browser default sans while the page is Inter).
3. **Annotates its return type as `EChartsOption`.** Without the annotation TypeScript
   widens `type: "bar"` to `string` and the object stops assignable to the host's prop.
   The code below omits the annotation for brevity — add it:
   `export function buildX(cfg: XCfg): EChartsOption { … }`

> The snippets below show only what differs from these three. Do not redeclare
> `hexToRgba` locally — import it from `./format`.

---

## 1. `buildDualAxisBarLine` — rate line(s) over a volume bar

**The most-used chart in the product.** Answers "is this rate healthy, and on what
volume?". Bar = denominator/volume on the right axis, faded. Lines = rates on the left
axis. Optional dashed threshold.

```ts
export type DualAxisTrend = {
  x: string[];
  bar: { name: string; data: (number | null)[]; color?: string; opacity?: number };
  lines: { name: string; data: (number | null)[]; color?: string }[];
  leftLabel?: string; rightLabel?: string;
  leftFmt?: Kind;                       // default "pct"
  threshold?: number | null;            // dashed markLine on the LEFT axis
  thresholdLabel?: string;
  highlightBeyondThreshold?: boolean;   // recolour the first line above the threshold
};

export function buildDualAxisBarLine(cfg: DualAxisTrend) {
  const t = T();
  const lf = tipFmt(cfg.leftFmt ?? "pct");

  const lineSeries = (cfg.lines ?? []).map((ln, i) => {
    const color = ln.color ?? CHART_CATEGORICAL[i % CHART_CATEGORICAL.length];
    // Threshold highlight without visualMap: style each point in place. A data
    // item's lineStyle colours the segment ENDING at it, so a point above the
    // target paints its incoming segment + marker + label in the alert colour.
    const data = (cfg.highlightBeyondThreshold && cfg.threshold != null && i === 0)
      ? ln.data.map(v => v == null ? null : {
          value: v,
          itemStyle: { color: v > cfg.threshold! ? t.bad : color },
          lineStyle: { color: v > cfg.threshold! ? t.bad : color, width: 2 },
        })
      : ln.data;

    const s: any = {
      name: ln.name, type: "line", yAxisIndex: 0, smooth: false,
      showSymbol: true, symbol: "circle", symbolSize: 6,
      lineStyle: { width: 2, color }, itemStyle: { color },
      emphasis: { focus: "series" }, z: 3, data,
    };
    // markLine must live on a series; attach to the first line so it inherits the left axis.
    if (cfg.threshold != null && i === 0) {
      s.markLine = {
        symbol: "none", silent: true,
        lineStyle: { type: "dashed", color: t.bad, width: 1.5 },
        label: { position: "insideEndTop", color: t.bad, fontSize: 10,
                 formatter: cfg.thresholdLabel ?? String(cfg.threshold) },
        data: [{ yAxis: cfg.threshold }],
      };
    }
    return s;
  });

  const barSeries = {
    name: cfg.bar.name, type: "bar", yAxisIndex: 1, data: cfg.bar.data, z: 1,
    itemStyle: { color: cfg.bar.color ?? t.accent,
                 opacity: cfg.bar.opacity ?? 0.55, borderRadius: [3, 3, 0, 0] },
    emphasis: { focus: "series" },
  };

  return {
    animation: false,
    // Per-series tooltip: the bar is a count, the lines are rates — one default
    // formatter cannot tell them apart.
    tooltip: tip(t, (ps: any[]) => {
      const head = `<b>${ps[0].axisValueLabel}</b>`;
      const rows = ps.map(p => {
        const v = p.seriesType === "bar" ? Number(p.value).toLocaleString() : lf(p.value);
        return `${p.marker} ${p.seriesName} &nbsp; <b>${v}</b>`;
      }).join("<br/>");
      return `${head}<br/>${rows}`;
    }),
    legend: { bottom: 0, textStyle: { color: t.muted, fontSize: 11 }, itemWidth: 14, itemHeight: 8 },
    grid: { left: 8, right: 12, top: 40, bottom: 60, containLabel: true },
    dataZoom: zoomWidgets(t),
    xAxis: { ...baseAxis(t), type: "category", data: cfg.x, boundaryGap: true },
    yAxis: [
      { ...baseAxis(t, cfg.leftLabel), type: "value", position: "left", min: 0,
        axisLabel: { color: t.muted, formatter: axisFmt(cfg.leftFmt ?? "pct") } },
      { ...baseAxis(t, cfg.rightLabel), type: "value", position: "right",
        splitLine: { show: false },
        axisLabel: { color: t.muted, formatter: axisFmt("int") } },
    ],
    series: [barSeries, ...lineSeries],
  };
}
```

`axisPointer: "cross"` is a good override here — readers trace a point to both axes.

---

## 2. `buildStackedBar` — composition over time

Handles four modes off one config: plain stack, 100%-normalised, share-in-tooltip, and
stack-total labels.

```ts
export type StackedDist = {
  x: string[];
  series: { name: string; data: (number | null)[]; color?: string }[];
  yLabel?: string;
  valueFormat?: Kind;      // default "int"
  normalize?: boolean;     // 100% stacked — mix over time
  showShare?: boolean;     // append each series' % of the hovered total (NOT with legendIsolate)
  showTotalLabel?: boolean;
};

export function buildStackedBar(cfg: StackedDist) {
  const t = T();
  let series = cfg.series;

  if (cfg.normalize) {
    const totals = cfg.x.map((_, i) => series.reduce((a, s) => a + (Number(s.data[i]) || 0), 0));
    series = series.map(s => ({ ...s,
      data: s.data.map((v, i) => totals[i] ? (Number(v) || 0) / totals[i] * 100 : 0) }));
  }
  const kind: Kind = cfg.normalize ? "pct" : (cfg.valueFormat ?? "int");
  const fmt = tipFmt(kind);

  // Opt-in share tooltip: each series' % of the hovered stack + a Total row.
  // Skipped when normalized (values already ARE shares).
  const tooltip = (cfg.showShare && !cfg.normalize)
    ? tip(t, (ps: any[]) => {
        const total = ps.reduce((a, p) => a + (Number(p.value) || 0), 0);
        const rows = ps.map(p => {
          const share = total ? (Number(p.value) / total * 100).toFixed(1) : "0.0";
          return `${p.marker} ${p.seriesName} &nbsp; <b>${fmt(p.value)}</b>` +
                 ` <span style="color:${t.muted}">${share}%</span>`;
        }).join("<br/>");
        return `<b>${ps[0].axisValueLabel}</b><br/>${rows}` +
               `<div style="margin-top:4px;padding-top:3px;border-top:1px solid ${t.border}">` +
               `Total &nbsp; <b>${fmt(total)}</b></div>`;
      })
    : { ...tip(t), formatter: undefined, valueFormatter: (v: number) => fmt(v) };

  const out: any = {
    animation: false,
    tooltip,
    legend: { bottom: 0, textStyle: { color: t.muted, fontSize: 11 },
              itemWidth: 12, itemHeight: 8, type: "scroll" },
    grid: { left: 8, right: 12, top: 16, bottom: 60, containLabel: true },
    dataZoom: zoomWidgets(t),
    xAxis: { ...baseAxis(t), type: "category", data: cfg.x,
             // Force EVERY category label (ECharts hides some by default, so days
             // go missing); rotate once crowded so full dates angle apart.
             axisLabel: { color: t.muted, interval: 0, rotate: cfg.x.length > 5 ? 35 : 0 } },
    yAxis: {
      ...baseAxis(t, cfg.yLabel), type: "value",
      // A 100% stack MUST cap at 100 — rounding noise otherwise pushes the top
      // tick to 120% and the chart looks broken. Ticks are whole numbers there,
      // independent of the decimal setting: "100%" reads better than "100.00%".
      ...(cfg.normalize
        ? { min: 0, max: 100,
            axisLabel: { color: t.muted, formatter: (v: number) => Math.round(v) + "%" } }
        : { axisLabel: { color: t.muted, formatter: axisFmt(kind) } }),
    },
    series: series.map((s, i) => ({
      name: s.name, type: "bar", stack: "s", emphasis: { focus: "series" },
      itemStyle: { color: s.color ?? CHART_CATEGORICAL[i % CHART_CATEGORICAL.length] },
      data: s.data,
    })),
  };

  // ECharts can only label a SERIES, not a stack. An invisible line series rides
  // on the totals and carries them as labels. symbolSize 0.1 (not symbol:"none",
  // which would suppress the label too), silent, out of the legend and tooltip.
  if (cfg.showTotalLabel && !cfg.normalize) {
    const totals = cfg.x.map((_, i) => series.reduce((a, s) => a + (Number(s.data[i]) || 0), 0));
    out.series.push({
      name: "__stack_total__", type: "line", data: totals,
      symbol: "circle", symbolSize: 0.1, silent: true,
      itemStyle: { color: "rgba(0,0,0,0)" }, lineStyle: { opacity: 0 },
      tooltip: { show: false }, legendHoverLink: false,
      label: { show: true, position: "top", distance: 4, fontSize: 10, fontWeight: 700,
               color: t.muted, formatter: (p: any) => tipFmt(kind)(p.value) },
    });
    out.legend.data = series.map(s => s.name);   // pin the carrier out of the legend
  }
  return out;
}
```

**Inside-segment labels** (opt-in): blank zero/near-empty slices, set ink per series from
its own fill via `labelInk`, and add `labelLayout: { hideOverlap: true }` so collisions
drop rather than overlap.

---

## 3. `buildHorizontalBar` — ranked categories

For "pass rate by card", "accuracy by question" — anything the reader scans top-down to
find the weak entries.

```ts
export type HBar = {
  labels: string[]; values: number[];
  xLabel?: string; color?: string; valueFormat?: Kind;   // default "pct"
  diverging?: boolean;                                   // colour by sign of the value
  posColor?: string; negColor?: string;
};

export function buildHorizontalBar(cfg: HBar) {
  const t = T();
  const kind = cfg.valueFormat ?? "pct";
  const fmt = tipFmt(kind);
  const pos = cfg.posColor ?? t.bad, neg = cfg.negColor ?? t.good;  // delta semantics: up = bad

  return {
    animation: false,
    tooltip: { ...tip(t), formatter: undefined, valueFormatter: (v: number) => fmt(v) },
    grid: { left: 8, right: 56, top: 8, bottom: 8, containLabel: true },
    xAxis: { ...baseAxis(t, cfg.xLabel), type: "value",
             axisLabel: { color: t.muted, formatter: axisFmt(kind) } },
    // ECharts draws category[0] at the BOTTOM by default — invert so the list
    // reads top-down in the order it was sorted.
    yAxis: { ...baseAxis(t), type: "category", data: cfg.labels, inverse: true,
             axisLabel: { color: t.text, fontSize: 11 } },
    series: [{
      type: "bar",
      data: cfg.diverging
        ? cfg.values.map(v => ({ value: v, itemStyle: { color: v >= 0 ? pos : neg } }))
        : cfg.values,
      itemStyle: { color: cfg.color ?? t.accent, borderRadius: [0, 3, 3, 0] },
      label: { show: true, position: "right", color: t.muted, fontSize: 10,
               formatter: (p: any) => fmt(p.value) },
    }],
  };
}
```

Sort descending before passing in; drop `null` values first — ECharts treats `NaN` as
max-extent and renders a full-width bar labelled `NaN%`.

---

## 4. `buildKpiTrend` — one KPI vs its target

```ts
export function buildKpiTrend(
  series: { label: string; v: number | null }[],
  target: number, unit: "usd" | "pct", lowerIsBetter = false,
) {
  const t = T();
  const fmt = unit === "usd"
    ? (v: number) => "$" + Number(v).toFixed(2)
    : (v: number) => Number(v).toFixed(DP()) + "%";

  return {
    animation: false,
    tooltip: { trigger: "axis", backgroundColor: t.card, borderColor: t.border,
               textStyle: { color: t.text, fontSize: 12 },
               formatter: (p: any[]) => `<b>${p[0].axisValueLabel}</b><br/>${p[0].marker}${fmt(p[0].value)}` },
    grid: { left: "3%", right: "9%", top: 18, bottom: 28, containLabel: true },
    xAxis: { ...baseAxis(t), type: "category", data: series.map(d => d.label), boundaryGap: false },
    yAxis: { ...baseAxis(t), type: "value", axisLabel: { color: t.muted, formatter: fmt } },
    series: [{
      type: "line", data: series.map(d => d.v), smooth: true, showSymbol: true, symbolSize: 5,
      lineStyle: { width: 2, color: t.accent }, itemStyle: { color: t.accent },
      areaStyle: { color: "rgba(245,158,11,0.08)" },
      markLine: {
        symbol: "none", silent: true,
        lineStyle: { type: "dashed", color: t.muted, width: 1.4 },
        label: { position: "insideEndTop", color: t.muted, fontSize: 10,
                 formatter: (lowerIsBetter ? "max " : "target ") + fmt(target) },
        data: [{ yAxis: target }],
      },
    }],
  };
}
```

---

## 5. `buildGauge` — one value against a healthy band

The hero read for a north-star metric. Three-zone dial: below-band, in-band, above-band.

```ts
export function buildGauge(value: number, band: { low: number; high: number }) {
  const t = T();
  // Adaptive ceiling keeps band.high at ~2/3 of the dial and the pointer in range
  // when the band or the basis pushes the value past a fixed maximum.
  const max = Math.max(0.30, band.high * 1.5, (value || 0) * 1.15);
  const seg = (x: number) => x / max;

  return {
    animation: false,
    series: [{
      type: "gauge", min: 0, max,
      startAngle: 210, endAngle: -30, radius: "94%", center: ["50%", "62%"],
      progress: { show: false },
      axisLine: { lineStyle: { width: 16, color: [
        [seg(band.low),  "#6EE7B7"],   // below band
        [seg(band.high), t.good],      // in band
        [1,              t.bad],       // above band
      ] } },
      axisTick:  { distance: -18, length: 5,  lineStyle: { color: t.muted, width: 1 } },
      splitLine: { distance: -20, length: 12, lineStyle: { color: t.muted, width: 2 } },
      axisLabel: { distance: -2, color: t.muted, fontSize: 9,
                   // label only the band edges, zero and the ceiling
                   formatter: (v: number) =>
                     (v === band.low || v === band.high || v === 0 || v >= max - 0.001)
                       ? "$" + v.toFixed(2) : "" },
      pointer: { length: "62%", width: 5, itemStyle: { color: t.text } },
      anchor: { show: true, size: 14, itemStyle: { color: t.text } },
      animationDuration: 0,
      detail: { valueAnimation: false, formatter: (v: number) => "$" + Number(v).toFixed(3),
                color: t.text, fontSize: 30, fontWeight: 700, offsetCenter: [0, "42%"] },
      title: { show: false },
      data: [{ value: Number(value.toFixed(3)) }],
    }],
  };
}
```

---

## 6. `buildSpark` — hero sparkline

Axis-less line with an optional shaded target band and goal line. Height 56–70.

```ts
export function buildSpark(
  series: { label: string; v: number }[],
  band: { low: number; high: number }, goal?: number,
) {
  const t = T();
  const ys = series.map(d => d.v);
  return {
    animation: false,
    grid: { left: 2, right: 2, top: 8, bottom: 2, containLabel: false },
    xAxis: { type: "category", data: series.map(d => d.label), show: false, boundaryGap: false },
    yAxis: { type: "value", show: false,
             min: Math.min(band.low * 0.9, ...ys), max: Math.max(band.high * 1.02, ...ys) },
    tooltip: { trigger: "axis", backgroundColor: t.card, borderColor: t.border,
               textStyle: { color: t.text, fontSize: 12 },
               formatter: (p: any[]) =>
                 `${p[0].axisValueLabel}<br/>${p[0].marker}$${Number(p[0].value).toFixed(3)}/min` },
    series: [{
      type: "line", data: ys, smooth: true, showSymbol: false,
      lineStyle: { width: 2.5, color: t.accent },
      areaStyle: { color: "rgba(245,158,11,0.10)" },
      markArea: { silent: true, itemStyle: { color: "rgba(30,142,62,0.08)" },
                  data: [[{ yAxis: band.low }, { yAxis: band.high }]] },
      markLine: goal != null ? {
        symbol: "none", silent: true, label: { show: false },
        lineStyle: { type: "dashed", color: t.muted, width: 1 },
        data: [{ yAxis: goal }],
      } : {},
    }],
  };
}
```

For a **tile sparkline with no interactivity**, prefer inline SVG over an ECharts
instance — with a handful of points there is nothing to interact with, and a real chart
component can fail to redraw after a remount, leaving the tile blank while the number
updates. Compute the path directly:

```ts
export function sparkPath(series: number[], width = 140, height = 56) {
  const lo = Math.min(...series), hi = Math.max(...series);
  const span = (hi - lo) || 1;
  const pts = series.length <= 1
    ? [[0, height / 2], [width, height / 2]] as [number, number][]
    : series.map((v, i) => [i * (width / (series.length - 1)),
                            height - ((v - lo) / span) * height] as [number, number]);
  const line = "M" + pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" L");
  const area = `${line} L${pts.at(-1)![0].toFixed(1)},${height} L${pts[0][0].toFixed(1)},${height} Z`;
  return { line, area };
}
```

---

## 7. `buildWaterfall` — additive decomposition

ECharts has no waterfall type. Build it as a stacked bar with a **transparent base
series** carrying the running sum, plus a final full-height total column.

```ts
export function buildWaterfall(
  steps: { name: string; value: number; color: string }[],
  totalName: string, totalValue: number,
  band?: { high: number },
) {
  const t = T();
  const cats = [...steps.map(s => s.name), totalName];
  const base: number[] = [], vis: number[] = [], colors: string[] = [];
  let acc = 0;
  for (const s of steps) { base.push(acc); vis.push(s.value || 0); colors.push(s.color); acc += s.value || 0; }
  base.push(0); vis.push(totalValue); colors.push(t.accent);   // total floats from zero

  return {
    animation: false,
    tooltip: {
      trigger: "axis", axisPointer: { type: "shadow" },
      backgroundColor: t.card, borderColor: t.border, textStyle: { color: t.text, fontSize: 12 },
      formatter: (p: any[]) => {
        const bar = p.find(x => x.seriesName === "v");
        // 3-decimal money: a waterfall of sub-cent unit-economics steps rounds to
        // identical 2-dp values and the decomposition stops adding up on screen.
        return `<b>${bar.axisValueLabel}</b><br/>${fmtUsd4(bar.value)}`;
      },
    },
    grid: { left: "3%", right: "7%", top: 48, bottom: 24, containLabel: true },
    xAxis: { ...baseAxis(t), type: "category", data: cats },
    // Sub-dollar domain — axisFmt("usd") is whole-dollar and would render every
    // tick on a $0–$0.40 axis as "$0".
    yAxis: { ...baseAxis(t), type: "value", axisLabel: { color: t.muted, formatter: axisFmtUsdUnit() } },
    series: [
      { name: "base", type: "bar", stack: "wf", data: base,
        itemStyle: { color: "transparent" }, emphasis: { itemStyle: { color: "transparent" } } },
      { name: "v", type: "bar", stack: "wf",
        data: vis.map((v, i) => ({ value: v, itemStyle: { color: colors[i] } })),
        label: { show: true, position: "top", color: t.text, fontWeight: 600, fontSize: 11,
                 formatter: (o: any) => fmtUsd4(o.value) },
        ...(band ? { markLine: {
          symbol: "none", silent: true,
          lineStyle: { type: "dashed", color: t.good, width: 1.2 },
          label: { position: "insideStartTop", color: t.good, fontSize: 10,
                   formatter: `band hi $${band.high.toFixed(2)}` },
          data: [{ yAxis: band.high }],
        } } : {}),
      },
    ],
  };
}
```

Build `cats` from `steps` so adding or removing a component needs no index bookkeeping.

---

## 8. `buildDonut` — composition right now

```ts
export function buildDonut(data: { name: string; value: number; color?: string }[], kind: Kind = "usd") {
  const t = T();
  return {
    animation: false,
    tooltip: {
      trigger: "item", backgroundColor: t.card, borderColor: t.border,
      textStyle: { color: t.text, fontSize: 12 },
      formatter: (p: any) =>
        `<b>${p.name}</b><br/>${p.marker}${tipFmt(kind)(p.value)} (${p.percent.toFixed(1)}%)`,
    },
    legend: { bottom: 0, textStyle: { color: t.text }, icon: "roundRect", itemWidth: 11, itemHeight: 11 },
    series: [{
      type: "pie", radius: ["56%", "80%"], center: ["50%", "44%"],
      avoidLabelOverlap: true, labelLine: { show: false },
      label: { show: false, position: "center" },
      // Hover writes the slice identity into the hole — no permanent label clutter.
      emphasis: { label: { show: true, fontSize: 15, fontWeight: 600, color: t.text,
                           formatter: (p: any) => `${p.name}\n${p.percent.toFixed(0)}%` } },
      data: data.map(d => ({ name: d.name, value: d.value,
                             ...(d.color ? { itemStyle: { color: d.color } } : {}) })),
    }],
  };
}
```

Pin `name_order` + a colour map so a component keeps the same hue and the same
clockwise-from-12 slot as it has in the stacked bar.

---

## 9. `buildFunnel` — stage drop-off

```ts
export function buildFunnel(
  stages: { label: string; reached: number; convFromPrev?: number | null;
            convFromTop?: number | null; color: string }[],
) {
  const t = T();
  const data = stages.map(s => ({
    value: s.reached, name: s.label, itemStyle: { color: s.color },
    _prev: s.convFromPrev, _top: s.convFromTop,
  }));
  return {
    animation: false,
    tooltip: {
      trigger: "item", backgroundColor: t.card, borderColor: t.border,
      textStyle: { color: t.text, fontSize: 12 },
      formatter: (p: any) => `<b>${p.name}</b><br/>${tipFmt("int")(p.value)} reached`
        + (p.data._top  != null ? `<br/>${Number(p.data._top).toFixed(DP())}% of total` : "")
        + (p.data._prev != null ? `<br/>${Number(p.data._prev).toFixed(DP())}% from previous stage` : ""),
    },
    series: [{
      type: "funnel", sort: "none",           // sort:"none" — stage order is the sequence
      gap: 2, top: 10, bottom: 10, left: "6%", right: "6%",
      minSize: "18%", maxSize: "100%", funnelAlign: "center",
      label: { show: true, position: "inside", color: "#fff",
               fontSize: 11, fontWeight: 600, lineHeight: 14,
               formatter: (p: any) => {
                 const meta = [
                   p.data._top  != null ? `${Number(p.data._top).toFixed(DP())}% of total` : "",
                   p.data._prev != null ? `${Number(p.data._prev).toFixed(DP())}% vs prev` : "",
                 ].filter(Boolean).join("  ·  ");
                 return `${p.name}  ${tipFmt("int")(p.value)}${meta ? "\n" + meta : ""}`;
               } },
      labelLine: { show: false },
      itemStyle: { borderColor: t.card, borderWidth: 1 },
      data,
    }],
  };
}
```

---

## 10. `buildFunnelTrend` — one line per stage

Two modes: `log` for absolute counts (so 750k and 100 stay readable on one axis), `pct`
for conversion rates on a linear axis.

```ts
export function buildFunnelTrend(cfg: {
  x: string[]; series: { name: string; data: (number | null)[]; color: string }[];
  log?: boolean; pct?: boolean;
}) {
  const t = T();
  const { log = false, pct = false } = cfg;
  return {
    animation: false,
    tooltip: { trigger: "axis", backgroundColor: t.card, borderColor: t.border,
               textStyle: { color: t.text, fontSize: 12 },
               valueFormatter: (v: number) => v == null ? "—"
                 : (pct ? Number(v).toFixed(DP()) + "%" : tipFmt("int")(v)) },
    legend: { data: cfg.series.map(s => s.name), top: 0, type: "scroll",
              textStyle: { color: t.muted, fontSize: 10 } },
    grid: { left: "3%", right: "4%", top: 40, bottom: 28, containLabel: true },
    xAxis: { ...baseAxis(t), type: "category", data: cfg.x, boundaryGap: false },
    yAxis: pct
      ? { ...baseAxis(t), type: "value", min: 0, axisLabel: { color: t.muted, formatter: axisFmt("pct") } }
      : { ...baseAxis(t), type: "log", minorTick: { show: false }, minorSplitLine: { show: false },
          axisLabel: { color: t.muted, formatter: (v: number) => Number(v).toLocaleString() } },
    series: cfg.series.map(s => ({
      type: "line", name: s.name,
      // A log axis cannot plot 0 or negatives — null them out, don't clamp.
      data: s.data.map(v => v == null ? null : (log && v <= 0 ? null : v)),
      smooth: false, showSymbol: true, symbolSize: 5, connectNulls: true,
      lineStyle: { width: 2, color: s.color }, itemStyle: { color: s.color },
    })),
  };
}
```

---

## 11. `buildRankedBar` — who is diluting the metric

Horizontal bars coloured by pass/fail against a band, with a reference line for the
portfolio average.

```ts
export function buildRankedBar(
  rows: { name: string; value: number }[],
  band: { high: number }, portfolioAvg: number, unit = "$ / unit",
) {
  const t = T();
  const r = [...rows].reverse();                  // render bottom-up so the biggest is on top
  const vals = r.map(d => d.value);
  // Adaptive x-max so a high outlier or a raised band never clips past a fixed ceiling.
  const xMax = Math.max(0.36, band.high * 1.3, ...(vals.length ? vals : [0])) * 1.05;

  return {
    animation: false,
    // 3 dp throughout: at 2 dp the entities this chart exists to separate
    // ($0.134 vs $0.138) round to the same string.
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" },
               backgroundColor: t.card, borderColor: t.border, textStyle: { color: t.text, fontSize: 12 },
               formatter: (p: any[]) => `<b>${p[0].axisValueLabel}</b><br/>${fmtUsd4(p[0].value)} ${unit}` },
    grid: { left: "3%", right: "13%", top: 28, bottom: 46, containLabel: true },
    // Sub-dollar domain — 2 dp ticks, not axisFmt("usd")'s whole dollars.
    xAxis: { ...baseAxis(t, unit), type: "value", nameLocation: "middle", nameGap: 30, max: xMax,
             axisLabel: { color: t.muted, formatter: axisFmtUsdUnit() } },
    yAxis: { ...baseAxis(t), type: "category", data: r.map(d => d.name),
             axisLabel: { color: t.text, fontSize: 11, fontFamily: "var(--mono)" } },
    series: [{
      type: "bar", barWidth: "62%",
      data: vals.map(v => ({ value: v, itemStyle: { color: v > band.high ? t.bad : t.good } })),
      label: { show: true, position: "right", color: t.muted, fontSize: 10,
               formatter: (o: any) => fmtUsd4(o.value) },
      markLine: { symbol: "none", silent: true, data: [
        { xAxis: band.high,    lineStyle: { type: "dashed", color: t.bad,    width: 1.2 }, label: { show: false } },
        { xAxis: portfolioAvg, lineStyle: { type: "solid",  color: t.accent, width: 1.4 }, label: { show: false } },
      ] },
    }],
  };
}
```

---

## 12. `buildCompareSeries` — us vs them, one metric

`kind: "bar"` for volumes/counts, `kind: "line"` for rates. `b` may be null to draw one
side alone (the competitor has no comparable series under some filters).

```ts
export function buildCompareSeries(cfg: {
  x: string[]; kind: "bar" | "line"; unit: Kind;
  a: { name: string; color: string; data: (number | null)[] };
  b?: { name: string; color: string; data: (number | null)[] } | null;
}) {
  const t = T();
  const isBar = cfg.kind === "bar";
  const vf = tipFmt(cfg.unit), af = axisFmt(cfg.unit);

  const mk = (s: NonNullable<typeof cfg.b>) => isBar
    ? { name: s.name, type: "bar", barGap: "8%", barMaxWidth: 22,
        itemStyle: { color: s.color, borderRadius: [3, 3, 0, 0] }, data: s.data }
    : { name: s.name, type: "line", smooth: false, showSymbol: true, symbolSize: 6,
        connectNulls: true, lineStyle: { width: 2, color: s.color },
        itemStyle: { color: s.color }, data: s.data };

  return {
    animation: false,
    tooltip: { trigger: "axis", axisPointer: { type: isBar ? "shadow" : "line" },
               backgroundColor: t.card, borderColor: t.border, textStyle: { color: t.text, fontSize: 12 },
               valueFormatter: (v: number) => v == null ? "—" : vf(v) },
    legend: { data: cfg.b ? [cfg.a.name, cfg.b.name] : [cfg.a.name], bottom: 0,
              textStyle: { color: t.muted, fontSize: 11 }, itemWidth: 12, itemHeight: 8 },
    // Line panels use boundaryGap:false, so the last category label is centred on
    // the right edge and gets half-clipped in a narrow card — give them room.
    grid: { left: 6, right: isBar ? 12 : 26, top: 14, bottom: 36, containLabel: true },
    xAxis: { ...baseAxis(t), type: "category", data: cfg.x, boundaryGap: isBar },
    // Anchor at 0 (no `scale`) so rate lines aren't stretched by a cropped range.
    yAxis: { ...baseAxis(t), type: "value", min: 0, axisLabel: { color: t.muted, formatter: af } },
    series: cfg.b ? [mk(cfg.a), mk(cfg.b)] : [mk(cfg.a)],
  };
}
```

---

## 13. `buildCompareStacked` — us vs them, each split into parts

Every entity's column is its own stack (`stack: entityName`), so the two stay
side-by-side. Within a column, later parts are progressively lighter shades of the
entity's colour, so the entity stays identifiable at a glance.

```ts
export function buildCompareStacked(cfg: {
  x: string[]; unit: Kind; parts: { key: string; label: string }[];
  a: { name: string; color: string; parts: (number | null)[][] };
  b?: { name: string; color: string; parts?: (number | null)[][]; whole?: (number | null)[] } | null;
}) {
  const t = T();
  const vf = tipFmt(cfg.unit), af = axisFmt(cfg.unit);
  const alphaFor = (i: number) => (i === 0 ? 1 : Math.max(0.22, 0.45 / i));  // 1, .45, .28…
  const series: any[] = [], names: string[] = [];

  for (const e of [cfg.a, cfg.b].filter(Boolean) as any[]) {
    if (e.whole && !e.parts) {                    // this side has no breakdown
      names.push(e.name);
      series.push({ name: e.name, type: "bar", stack: e.name, barGap: "8%", barMaxWidth: 22,
                    itemStyle: { color: e.color, borderRadius: [3, 3, 0, 0] }, data: e.whole });
      continue;
    }
    cfg.parts.forEach((p, i) => {
      const name = `${e.name} · ${p.label}`;
      names.push(name);
      series.push({
        name, type: "bar", stack: e.name, barGap: "8%", barMaxWidth: 22,
        itemStyle: { color: i === 0 ? e.color : hexToRgba(e.color, alphaFor(i)),
                     borderRadius: i === cfg.parts.length - 1 ? [3, 3, 0, 0] : 0 },
        data: e.parts[i] ?? [],
      });
    });
  }

  return {
    animation: false,
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" },
               backgroundColor: t.card, borderColor: t.border, textStyle: { color: t.text, fontSize: 12 },
               valueFormatter: (v: number) => v == null ? "—" : vf(v) },
    legend: { data: names, bottom: 0, textStyle: { color: t.muted, fontSize: 10 },
              itemWidth: 12, itemHeight: 8 },
    grid: { left: 6, right: 12, top: 14, bottom: 48, containLabel: true },   // 2 legend rows
    xAxis: { ...baseAxis(t), type: "category", data: cfg.x, boundaryGap: true },
    yAxis: { ...baseAxis(t), type: "value", min: 0, axisLabel: { color: t.muted, formatter: af } },
    series,
  };
}
```

---

## 14. `buildProjected` — actual + mid-period projection

Bars stack a solid **Actual** segment plus a light, diagonally-striped **Projected**
segment (the incomplete period's estimated remainder). **Rates are never projected** —
they render as one line with the partial-period point drawn hollow and labelled `(proj)`.

```ts
export function buildProjected(cfg: {
  x: string[]; kind: "bar" | "line"; unit: Kind; color: string;
  actual: (number | null)[];
  projected?: (number | null)[];   // bar mode: the remainder only
  projIdx?: number | null;         // line mode: index of the projected point
}) {
  const t = T();
  const vf = tipFmt(cfg.unit), af = axisFmt(cfg.unit), cf = compactFmt(cfg.unit);
  const color = cfg.color;

  if (cfg.kind === "line") {
    const data = cfg.actual.map((v, i) => i !== cfg.projIdx ? v : ({
      value: v, symbol: "circle", symbolSize: 9,
      itemStyle: { color: t.card, borderColor: color, borderWidth: 2.5 },   // hollow = estimate
      label: { formatter: (p: any) => p.value == null ? "" : `${cf(p.value)} (proj)` },
    }));
    return {
      animation: false,
      tooltip: { trigger: "axis", axisPointer: { type: "line" }, backgroundColor: t.card,
                 borderColor: t.border, textStyle: { color: t.text, fontSize: 12 },
                 valueFormatter: (v: number) => v == null ? "—" : vf(v) },
      grid: { left: 6, right: 30, top: 26, bottom: 22, containLabel: true },
      xAxis: { ...baseAxis(t), type: "category", data: cfg.x, boundaryGap: false,
               axisLabel: { color: t.text, interval: 0, fontSize: 11 } },
      yAxis: { ...baseAxis(t), type: "value", min: 0,
               axisLabel: { color: t.text, fontSize: 11, formatter: af } },
      series: [{
        type: "line", smooth: false, showSymbol: true, symbolSize: 6, connectNulls: true,
        lineStyle: { width: 2.5, color }, itemStyle: { color },
        label: { show: true, position: "top", color: t.text, fontSize: 11, fontWeight: 600,
                 formatter: (p: any) => p.value == null ? "" : cf(p.value) },
        data,
      }],
    };
  }

  const act = cfg.actual, prj = cfg.projected ?? [];
  const hasProj = prj.some(v => v != null);
  const lblBase = { show: true, position: "top", color: t.text, fontSize: 11, fontWeight: 600 };

  const series: any[] = [{
    name: "Actual", type: "bar", stack: "k", barMaxWidth: 30,
    itemStyle: { color, borderRadius: hasProj ? 0 : [3, 3, 0, 0] },
    // On the projected period the actual segment sits mid-stack, so suppress its
    // label there — the full-period total is labelled on the striped segment.
    label: { ...lblBase, formatter: (p: any) =>
      prj[p.dataIndex] != null ? "" : (p.value == null ? "" : cf(p.value)) },
    data: act,
  }];

  if (hasProj) series.push({
    name: "Projected (incomplete period)", type: "bar", stack: "k", barMaxWidth: 30,
    itemStyle: {
      color: hexToRgba(color, 0.30), borderRadius: [3, 3, 0, 0],
      decal: { symbol: "rect", color: hexToRgba(color, 0.55),
               dashArrayX: [1, 0], dashArrayY: [3, 4], rotation: -Math.PI / 4 },
    },
    label: { ...lblBase, color,
             formatter: (p: any) => p.value == null ? ""
               : cf((Number(act[p.dataIndex]) || 0) + (Number(p.value) || 0)) },
    data: prj,
  });

  return {
    animation: false,
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" },
      backgroundColor: t.card, borderColor: t.border, textStyle: { color: t.text, fontSize: 12 },
      formatter: (ps: any[]) => {
        let total = 0;
        const rows = ps.filter(p => p.value != null).map(p => {
          total += Number(p.value) || 0;
          return `${p.marker} ${p.seriesName} &nbsp; <b>${vf(p.value)}</b>`;
        });
        if (ps.some(p => String(p.seriesName).startsWith("Projected") && p.value != null))
          rows.push(`Full-period est. &nbsp; <b>${vf(total)}</b>`);
        return `<b>${ps[0].axisValueLabel}</b><br/>${rows.join("<br/>")}`;
      } },
    legend: { show: false },      // the stripe pattern + the shared caption explain it
    grid: { left: 6, right: 30, top: 26, bottom: 18, containLabel: true },
    xAxis: { ...baseAxis(t), type: "category", data: cfg.x,
             axisLabel: { color: t.text, interval: 0, fontSize: 11 } },
    yAxis: { ...baseAxis(t), type: "value", min: 0,
             axisLabel: { color: t.text, fontSize: 11, formatter: af } },
    series,
  };
}
```

Always ship a caption stating how many periods landed and what method produced the
estimate. An unlabelled projection reads as fact.

---

## 15. `buildRateOverVolume` — inverted dual axis (volume left, rates right)

The mirror image of recipe 1, and a genuinely different read. Use it when the **volume is
the context and the rates are the subject**: pastel bars sit behind (left axis, counts),
emphasised thick lines sit in front (right axis, %, capped at 100).

Choose between the two by asking which axis the reader's eye should trust:
- recipe 1 (bar right, lines left) — the rate is the KPI, volume is a sanity check
- recipe 15 (bar left, lines right) — several rates compared, volume explains their shape

```ts
export function buildRateOverVolume(
  x: string[],
  series: { name: string; data: (number | null)[]; color: string }[],
  volume: (number | null)[],
  volumeName = "Calls (connected)",
) {
  const t = T();
  return {
    animation: false, textStyle: chartTextStyle(),
    // confine: keep the tooltip inside the chart box — see the "Escape hatches" section of SKILL.md.
    tooltip: { trigger: "axis", confine: true, backgroundColor: t.card,
               borderColor: t.border, textStyle: { color: t.text, fontSize: 12 } },
    legend: { data: [volumeName, ...series.map(s => s.name)], top: 0, type: "scroll",
              textStyle: { color: t.muted, fontSize: 10 } },
    grid: { left: 12, right: 12, top: 44, bottom: 28, containLabel: true },
    xAxis: { ...baseAxis(t), type: "category", data: x, boundaryGap: true },
    yAxis: [
      { ...baseAxis(t, "Calls"), type: "value", position: "left",
        splitLine: { show: false },            // gridlines belong to the % axis only
        axisLabel: { color: t.muted, formatter: (v: number) => Number(v).toLocaleString() } },
      { ...baseAxis(t, "Rate %"), type: "value", position: "right", min: 0, max: 100,
        axisLabel: { color: t.muted, formatter: (v: number) => v + "%" } },
    ],
    series: [
      // Pastel, low-alpha bar so it reads as background, never as a competing series.
      { name: volumeName, type: "bar", yAxisIndex: 0, data: volume, z: 1, barMaxWidth: 42,
        itemStyle: { color: "rgba(99,102,241,0.18)" },
        tooltip: { valueFormatter: (v: number) => v == null ? "—" : Number(v).toLocaleString() } },
      // width 3 (not 2) — the lines must win the foreground against the bars.
      ...series.map(s => ({
        name: s.name, type: "line", yAxisIndex: 1, data: s.data, z: 3,
        smooth: false, showSymbol: true, symbolSize: 6, connectNulls: true,
        lineStyle: { width: 3, color: s.color }, itemStyle: { color: s.color },
        tooltip: { valueFormatter: (v: number) => v == null ? "—" : Number(v).toFixed(1) + "%" },
      })),
    ],
  };
}
```

Only ONE of the two axes draws `splitLine`. Two gridline sets on a dual axis produce a
plaid background and neither scale stays readable.

---

## 16. `buildGroupedBars` — side-by-side comparison across bands

Distribution comparison (two arms across covariate bands, two entities across categories).
Not a stack — the bars sit next to each other and the reader compares pairs.

```ts
export function buildGroupedBars(cfg: {
  x: string[];
  series: { name: string; data: (number | null)[]; color: string }[];
  yLabel?: string; unit?: Kind;
  showLabels?: boolean;
}) {
  const t = T();
  const kind = cfg.unit ?? "pct";
  const lbl = cfg.showLabels
    ? { show: true, position: "top", fontSize: 9, color: t.muted,
        formatter: (p: any) => tipFmt(kind)(p.value) }
    : { show: false };

  return {
    animation: false, textStyle: chartTextStyle(),
    legend: { data: cfg.series.map(s => s.name), top: 0,
              textStyle: { color: t.muted, fontSize: 11 }, itemWidth: 12, itemHeight: 8 },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" },
               backgroundColor: t.card, borderColor: t.border,
               textStyle: { color: t.text, fontSize: 12 },
               valueFormatter: (v: number) => v == null ? "—" : tipFmt(kind)(v) },
    grid: { left: 44, right: 12, top: 34, bottom: 26, containLabel: true },
    xAxis: { ...baseAxis(t), type: "category", data: cfg.x,
             axisLabel: { color: t.muted, fontSize: 10 } },
    yAxis: { ...baseAxis(t, cfg.yLabel), type: "value", min: 0,
             axisLabel: { color: t.muted, fontSize: 10, formatter: axisFmt(kind) } },
    series: cfg.series.map((s, i) => ({
      name: s.name, type: "bar",
      // Gaps are the whole point of a grouped bar: barGap is the space WITHIN a
      // group, barCategoryGap the space BETWEEN groups. Declare them on the first
      // series only — ECharts applies them to the whole group.
      ...(i === 0 ? { barGap: "12%", barCategoryGap: "40%" } : {}),
      // 1px border in the CARD colour hairlines adjacent bars apart without
      // introducing a fifth colour. Also works on donut slices.
      itemStyle: { color: s.color, borderColor: t.card, borderWidth: 1 },
      data: s.data, label: lbl,
    })),
  };
}
```

---

## 17. `buildScatter` — relationship between two measures, one dot per entity

Answers "does X drive Y, and does the relationship differ by group?" — the question a
trend line cannot answer because it hides the population. Each point carries its own
identifier for the tooltip.

```ts
export function buildScatter(cfg: {
  points: { x: number; y: number; label: string; group: string }[];
  groups: { name: string; color: string }[];
  xLabel: string; yLabel: string;
  xThreshold?: { value: number; label: string };   // vertical reference line
  xUnit?: string; yUnit?: string;
}) {
  const t = T();
  const series: any[] = cfg.groups.map(g => ({
    name: g.name, type: "scatter", symbolSize: 7,
    // Semi-transparent fill: overlapping dots must show density, and an opaque
    // cloud of 400 points reads as one blob.
    itemStyle: { color: g.color, opacity: 0.55, borderColor: g.color },
    emphasis: { itemStyle: { opacity: 1 } },
    // Third array slot rides along as the label — read as p.data[2] in the tooltip.
    data: cfg.points.filter(p => p.group === g.name).map(p => [p.x, p.y, p.label]),
  }));

  if (cfg.xThreshold && series.length) {
    series[0].markLine = {
      symbol: "none", silent: true,
      lineStyle: { type: "dashed", color: t.muted, width: 1.4 },
      label: { position: "insideEndTop", color: t.muted, fontSize: 10,
               formatter: cfg.xThreshold.label },
      data: [{ xAxis: cfg.xThreshold.value }],       // xAxis, not yAxis → vertical
    };
  }

  return {
    animation: false, textStyle: chartTextStyle(),
    tooltip: {
      trigger: "item", backgroundColor: t.card, borderColor: t.border,
      textStyle: { color: t.text, fontSize: 12 },
      formatter: (p: any) =>
        `<b>${p.data[2] ?? ""}</b> · ${p.seriesName}<br/>` +
        `${Number(p.data[0]).toLocaleString()}${cfg.xUnit ? " " + cfg.xUnit : ""}<br/>` +
        `${p.data[1]}${cfg.yUnit ? " " + cfg.yUnit : ""}`,
    },
    legend: { data: cfg.groups.map(g => g.name), bottom: 0,
              textStyle: { color: t.muted, fontSize: 11 }, itemWidth: 12, itemHeight: 8 },
    // Rotated axis names need fixed padding — see "Escape hatches" in SKILL.md on containLabel.
    grid: { left: 68, right: 24, top: 18, bottom: 72, containLabel: false },
    xAxis: { ...baseAxis(t, cfg.xLabel), type: "value",
             nameLocation: "middle", nameGap: 32,
             axisLabel: { color: t.muted } },
    yAxis: { ...baseAxis(t, cfg.yLabel), type: "value",
             nameLocation: "middle", nameGap: 46, nameRotate: 90,
             axisLabel: { color: t.muted } },
    series,
  };
}
```

---

## 18. HTML funnel — when NOT to use the ECharts funnel

For a **side-by-side funnel comparison** (two arms, two periods) the ECharts `funnel`
series is the wrong tool: its trapezoid widths are not comparable across two separate
chart instances, and the per-stage conversion chips have nowhere to live.

Build it as a CSS grid instead — four columns, one row per stage:

```
grid-template-columns: 116px 1fr 64px 46px
                       │      │    │     └ % of top stage
                       │      │    └────── % of previous stage (a coloured chip)
                       │      └─────────── centred bar, width = value ÷ top value
                       └────────────────── stage label
```

Each bar is centre-aligned inside a full-width track (`left: (100 - width) / 2 + "%"`), so
the funnel tapers symmetrically like the ECharts one but every row keeps its own numbers.

Two details that make it read as a comparison rather than two charts:

- **Head-to-head colouring on one side only.** The reference arm shows plain
  stage-over-stage retention; the compared arm colours its chip **against the reference at
  the same stage** — green ▲ better, red ▼ worse, grey when matched within ±1pp. Colouring
  both sides doubles the ink and says nothing.
- **A labelled divider** where the treatment starts. Stages above it are expected to
  match (they are the sanity check); the comparison that matters is below it. Draw it as a
  full-width row: hairline — uppercase label — hairline, in the arm's colour at ~45%
  opacity.

---

## Variant: banded component stack + volume line

Two useful mutations of `buildStackedBar` worth naming.

> **These two blocks are FRAGMENTS, not standalone functions.** They read `series`, `t` and
> `band` from the builder you are mutating, so they only compile inside it. Everything above
> this heading is a complete function you can paste; these two are not.

**Target band** — attach a `markArea` (and a goal `markLine`) to the **first** series, inside
the builder, after `series` is built:

```ts
// fragment — inside buildStackedBar, where `series`, `t` and `band` are in scope
series[0].markArea = {
  silent: true, itemStyle: { color: "rgba(30,142,62,0.07)" },
  label: { show: true, position: "insideTopLeft", color: t.good, fontSize: 10, fontWeight: 600,
           formatter: `target band $${band.low.toFixed(2)}–$${band.high.toFixed(2)}` },
  data: [[{ yAxis: band.low }, { yAxis: band.high }]],
};
```

**Volume overlay** — push a line series on a secondary right axis so a rising stack can be
read against rising volume ("the bars climb because we're doing more, not only because the
unit cost moved"). Use a high-contrast neutral (`t.text`) so it reads over a colourful
stack in both themes.
