"use client";

/* =============================================================================
   echarts-host.tsx — the single ECharts mount point for dashboards.

   Ported from the ECharts wrapper in assets/_shared/charts.jsx. Owns:
     · init / dispose / resize (ResizeObserver)
     · high-DPI rendering
     · optional additive legend selection (`legendIsolate`)

   Every chart in the app goes through this component. Do not call echarts.init
   anywhere else.
   ============================================================================= */

import { useEffect, useRef, useState } from "react";
import * as echarts from "echarts";
import type { EChartsOption } from "echarts";

export type Theme = ReturnType<typeof T>;

/** Read a CSS custom property off <html>. Charts render to canvas and cannot use
 *  CSS classes, so the palette is resolved to concrete hex at option-build time. */
export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Theme colour bundle, pulled live so charts recolour on theme switch.
 *  Call this INSIDE a build function, never at module scope. */
export function T() {
  return {
    text:    cssVar("--text"),
    muted:   cssVar("--muted"),
    border:  cssVar("--border"),
    grid:    cssVar("--grid"),
    card:    cssVar("--card"),
    surface: cssVar("--surface"),
    good:    cssVar("--good"),
    bad:     cssVar("--bad"),
    accent:  cssVar("--accent"),
  };
}

/** Shared axis chrome — spread into every axis. */
export function baseAxis(t: Theme, name = "") {
  return {
    name,
    nameGap: 18,
    nameTextStyle: { color: t.muted },
    splitLine: { lineStyle: { color: t.grid } },
    axisLabel: { color: t.muted },
    axisLine:  { lineStyle: { color: t.border } },
    axisTick:  { show: false },
  };
}

/** Shared tooltip chrome. Pass a formatter, or omit and set valueFormatter later. */
export function tip(t: Theme, formatter?: (params: any) => string) {
  return {
    trigger: "axis" as const,
    axisPointer: { type: "shadow" as const },
    backgroundColor: t.card,
    borderColor: t.border,
    textStyle: { color: t.text, fontSize: 12 },
    formatter,
  };
}

/** Standard dataZoom pair. `horizontal` = category axis is y (horizontal bars). */
export function zoomWidgets(t: Theme, horizontal = false) {
  return horizontal
    ? [
        { type: "inside", yAxisIndex: 0 },
        { type: "slider", yAxisIndex: 0, width: 14, right: 8,
          borderColor: t.border, fillerColor: "rgba(5,150,105,0.10)" },
      ]
    : [
        { type: "inside" },
        { type: "slider", height: 16, bottom: 28,
          borderColor: t.border, fillerColor: "rgba(5,150,105,0.10)" },
      ];
}

// ---------------------------------------------------------------------------

export type EChartsProps = {
  option: EChartsOption | null;
  height?: number;
  style?: React.CSSProperties;
  /** Additive legend selection. MUST be a compile-time constant — the prop is
   *  read once on mount, so a state-driven value silently never takes effect.
   *  Do NOT combine with a stacked-bar tooltip that shows per-series share:
   *  that tooltip totals only VISIBLE series, so shares would re-base on the
   *  selection — the one thing this feature promises not to do. */
  legendIsolate?: boolean;
};

/**
 * `legendIsolate` flips legend clicks from ECharts' subtractive default (a click
 * hides the clicked series) to additive selection: from the all-shown default the
 * first click isolates the clicked series, further clicks add or remove series,
 * and emptying the selection returns to all-shown. Series are only ever hidden —
 * never filtered out of the option — so every legend entry keeps its colour and
 * stays clickable, and no plotted value is recomputed. Meant for high-cardinality
 * stacks (25+ codes) where isolating one otherwise costs one click per code the
 * reader does NOT want.
 */
export function ECharts({ option, height = 320, style, legendIsolate }: EChartsProps) {
  const ref  = useRef<HTMLDivElement>(null);
  const inst = useRef<echarts.ECharts | null>(null);

  const sel      = useRef<Set<string> | null>(null); // null = all shown
  const names    = useRef<string[]>([]);             // every series name in the current option
  const applying = useRef(false);                    // defensive re-entrancy guard

  useEffect(() => {
    // Bind to a local: TypeScript drops narrowing on `ref.current` after any
    // intervening call (echarts.init below), so a later `ro.observe(ref.current)`
    // would be `HTMLDivElement | null` under strict mode.
    const el = ref.current;
    if (!el) return;

    inst.current = echarts.init(el, undefined, {
      renderer: "canvas",
      devicePixelRatio: Math.max(window.devicePixelRatio || 1, 2),
    });

    // Read once on mount: a static per-chart opt-in, so the handler is either
    // attached for this chart's lifetime or never attached at all.
    if (legendIsolate) {
      inst.current.on("legendselectchanged", (e: any) => {
        if (applying.current) return;

        // String-coerce: object keys are always strings, so the `selected` map
        // below would silently disagree with a Set holding a non-string name —
        // the series could then be added but never removed.
        const name = String(e.name);
        const prev = sel.current;
        let next: Set<string> | null;

        if (prev === null) {
          next = new Set([name]);                 // default → isolate the clicked one
        } else {
          next = new Set(prev);
          if (next.has(name)) next.delete(name);
          else next.add(name);
          if (!next.size) next = null;            // emptied → back to all-shown
        }
        sel.current = next;

        const selected: Record<string, boolean> = {};
        names.current.forEach(n => { selected[n] = next === null || next.has(n); });

        // MERGE mode (not setOption(option, true)) so dataZoom pan/zoom survives.
        // ECharts has already applied its own subtractive toggle by the time this
        // fires; the whole map is overwritten so that never shows through, and the
        // intermediate state never paints because the flush happens here.
        //
        // Calling setOption from inside an ECharts handler is legal by a narrow
        // margin: it is a silent no-op while ECharts is mid-update, and that flag
        // clears one line before this event is emitted. Re-verify on any ECharts
        // upgrade — if the order changes, the feature stops working silently.
        // The price is two full chart updates per click, inherent to intercepting
        // after the fact; do not "optimise" it by moving the re-assert elsewhere.
        //
        // `applying` is defensive (a merge setOption raises no legendselectchanged
        // of its own); the `finally` is not — a throw would strand it at true and
        // every later click would fall back to subtractive.
        applying.current = true;
        try {
          inst.current?.setOption({ legend: { selected } });
        } finally {
          applying.current = false;
        }
      });
    }

    const ro = new ResizeObserver(() => inst.current?.resize());
    ro.observe(el);
    return () => { ro.disconnect(); inst.current?.dispose(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!inst.current || !option) return;
    inst.current.setOption(option, true);

    // A rebuilt option (theme, code set, share/volume toggle) starts all-shown.
    // Guarded so charts that never opted in execute exactly the one setOption
    // above: this is the only code here that could throw on an unusual `series`
    // shape, and a throw in a passive effect unmounts the whole tree.
    if (legendIsolate) {
      const series = Array.isArray(option.series)
        ? option.series
        : option.series ? [option.series] : [];

      // Keep an empty-string name IN the map rather than filtering it out:
      // ECharts treats any name absent from `legend.selected` as selected, so
      // dropping it would leave an unlabelled band with no legend entry to click.
      names.current = series
        .map((s: any) => (s && s.name != null ? String(s.name) : null))
        .filter((n): n is string => n !== null);
      sel.current = null;
    }
  }, [option, legendIsolate]);

  return <div ref={ref} style={{ width: "100%", height: `${height}px`, ...style }} />;
}

// ---------------------------------------------------------------------------
// Theme key — every memoised option must depend on this, or charts keep the old
// palette after a theme switch.
//
// Initialised by READING THE DOM, not from a constant: an effect-only initial
// value means the very first option is built against the light palette and only
// recolours on the second render. The source app applies theme attributes
// synchronously before children render for exactly this reason.
// ---------------------------------------------------------------------------

function readThemeKey(): string {
  if (typeof document === "undefined") return "light:compact";   // SSR
  const el = document.documentElement;
  return `${el.dataset.theme ?? "light"}:${el.dataset.density ?? "compact"}`;
}

export function useThemeKey(): string {
  const [key, setKey] = useState(readThemeKey);
  useEffect(() => {
    setKey(readThemeKey());          // reconcile after hydration
    const mo = new MutationObserver(() => setKey(readThemeKey()));
    mo.observe(document.documentElement, {
      attributes: true, attributeFilter: ["data-theme", "data-density"],
    });
    return () => mo.disconnect();
  }, []);
  return key;
}
