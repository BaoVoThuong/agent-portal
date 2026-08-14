# Escape hatches — the four invariants that have real exceptions

Each overrides an invariant in `SKILL.md` §4. They are legitimate, they exist in production,
and **every one needs a comment at the call site saying why** — otherwise the next reader
"fixes" it back.

---

## `tooltip.confine: true` — always, on any chart inside a card

Not an exception so much as a missing default. Without it a tooltip near the right or
bottom edge is clipped by the container. Add it to every chart. When the series names are
long (long category names, reason buckets), also let the tooltip wrap:

```ts
tooltip: {
  ...tip(t), confine: true,
  extraCssText: "max-width:460px;white-space:normal;line-height:1.35;",
}
```

## `containLabel: false` + explicit `grid.left` — when an axis name is rotated

A rotated y-axis name (`nameRotate: 90, nameLocation: "middle", nameGap: 46`) is not
measured by `containLabel`, so the automatic inset clips it. Switch to manual padding:

```ts
grid: { left: 68, right: 24, top: 18, bottom: 72, containLabel: false },
yAxis: { ...baseAxis(t, "Δ VM vs baseline (pp)"), nameLocation: "middle", nameGap: 46, nameRotate: 90 },
```

Reserve ~58–70px of `grid.left` for a rotated name plus its tick labels.

## A cropped percentage axis — when every value clusters at one end

Invariant 4 exists so a 0.3pp move cannot be dramatised into a cliff. But a metric whose
entire real range is 55–100% (deliverability, uptime, pass rate on a healthy
scorecard) wastes 55% of the plot on empty space and flattens the signal that matters.

```ts
yAxis: { ...baseAxis(t, "deliverability %"), type: "value", min: 55, max: 100 }
```

The test: **is zero a value this metric could plausibly take in the window shown?** If yes,
anchor at 0. If not, crop — and set an explicit `min`/`max`, never `scale: true`, so the
axis is stable across re-renders instead of breathing with the data.

## `dataZoom: []` and `legend: { show: false }` — stripping a default

- **Remove the zoom** when the category count is small and fixed (≤ ~12 periods). The
  slider then consumes 46px of the bottom band for nothing — and remember to shrink
  `grid.bottom` back to ~16 when you do.
- **Suppress the legend and draw your own** when each entry needs more than a name:
  a definition tooltip, a long label that would wrap the legend to three rows, a count.
  Render swatch + label + `ⓘ` below the chart instead.

```ts
const o = buildStackedBar({ ... });
o.legend = { show: false };            // custom key below carries the ⓘ definitions
o.dataZoom = [];                       // 6 periods — nothing to zoom
o.grid = { ...o.grid, bottom: 16 };    // reclaim the band the slider and legend held
```

Post-mutating a builder's output like this is fine and intended — the builders return plain
objects. Do it in the `useMemo`, not on every render.

---

