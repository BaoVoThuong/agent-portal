/* =============================================================================
   format.ts — the number-formatter matrix for dashboard charts.

   Three kinds (usd | pct | int) × three contexts (axis tick | tooltip value |
   on-chart label). Recipes import from here; never inline a toFixed in a chart.

   PERCENT UNITS: everything here expects percent units (22.3 means 22.3%),
   never fractions. Convert at the assembler, not at the chart.
   ============================================================================= */

import { cssVar } from "./echarts-host";
// One-directional: echarts-host imports nothing from here, so no cycle.

export type Kind = "usd" | "pct" | "int";

// ---------------------------------------------------------------------------
// Reader-facing decimal precision for percentages.
//
// An app-level setting (2 or 4) applied to VALUES people read — tooltips,
// deltas, inline rates. Axis ticks stay adaptive regardless, because a tick
// row of "22.3000%" is unreadable. Wire this to your store/context; the
// constant below is the fallback.
// ---------------------------------------------------------------------------
let _dp = 2;
export const setDecimalPlaces = (dp: number) => { _dp = dp; };
export const DP = () => _dp;

// ---------------------------------------------------------------------------
// Axis ticks — short, and must not collapse into duplicates.
// ---------------------------------------------------------------------------
export const axisFmt = (kind: Kind) => {
  if (kind === "usd")
    // WHOLE-DOLLAR ticks. Correct for spend axes ($0–$40,000); WRONG for any
    // sub-dollar domain — a unit-economics axis running $0–$0.40 renders every
    // tick as "$0". Use axisFmtUsdUnit below for those.
    return (v: number) => "$" + Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (kind === "pct")
    // Adaptive: whole numbers render plain (0%, 10%); fractional rates keep one
    // decimal so small rates (0.5%, 1.5%, 2.4%) don't collapse to duplicates.
    return (v: number) => {
      const n = Math.round(Number(v) * 10) / 10;
      return (Number.isInteger(n) ? n : n.toFixed(1)) + "%";
    };
  return (v: number) => Number(v).toLocaleString();
};

// ---------------------------------------------------------------------------
// Tooltip / read values — full precision.
// ---------------------------------------------------------------------------
export const tipFmt = (kind: Kind) => {
  if (kind === "usd")
    return (v: number) => "$" + Number(v).toLocaleString(undefined,
      { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (kind === "pct")
    return (v: number) => Number(v).toFixed(DP()) + "%";
  return (v: number) => Number(v).toLocaleString();
};

/** Axis ticks for a SUB-DOLLAR domain — unit economics: $/minute, $/call, $/outcome.
 *  Two decimals, so a $0–$0.40 axis reads $0.00 · $0.10 · $0.20 …
 *  Pair with fmtUsd4 (3 dp) for the values and labels on the same chart: the axis
 *  needs round ticks, the values need the third digit to stay distinguishable. */
export const axisFmtUsdUnit = () => (v: number) => "$" + Number(v).toFixed(2);

/** Sub-cent unit economics ($/minute, $/call): 3 decimals.
 *  Named "4" after the source helper (fmtUSD4). It renders THREE decimals —
 *  $0.135 — which is deliberate. Do not "fix" the name or the precision. */
export const fmtUsd4 = (v: number | null) =>
  v == null ? "—" : "$" + Number(v).toLocaleString(undefined,
    { minimumFractionDigits: 3, maximumFractionDigits: 3 });

/** Magnitude-switching USD. Keeps cents below $10, drops them above.
 *
 *  Exists because whole-dollar rounding turns a real $0.34 average into "$0",
 *  which every reader reports as a data bug. Use for money columns whose rows
 *  span magnitudes (a $0.34 minimum-payment row next to a $26,400 total). */
export const fmtUsdSmart = (v: number | null) => {
  if (v == null) return "—";
  const n = Number(v);
  return Math.abs(n) < 10
    ? "$" + n.toFixed(2)
    : "$" + Math.round(n).toLocaleString();
};

/** Magnitude-adaptive percent: 2 dp at or above 1%, 3 dp below.
 *
 *  For a series whose values span magnitudes — a funnel's cumulative %-of-total
 *  runs ~4.6% at the first stage down to ~0.09% at the last. At a fixed 2 dp the
 *  small stages collapse into "0.09%" ties and stop being distinguishable. */
export const fmtPctAdaptive = (v: number | null) =>
  v == null ? "—" : Number(v).toFixed(Number(v) >= 1 ? 2 : 3) + "%";

export const fmtUsd = (v: number | null) =>
  v == null ? "—" : "$" + Number(v).toLocaleString(undefined,
    { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmtInt = (v: number | null) =>
  v == null ? "—" : Number(v).toLocaleString();

// ---------------------------------------------------------------------------
// On-chart data labels — compact, must not collide with neighbours.
// 466,121 → "466K" · 1.5e6 → "1.5M" · USD → "$26K" · rates → "1.9%"
// ---------------------------------------------------------------------------
export const compactFmt = (kind: Kind) => {
  const num = (v: number) => {
    const n = Number(v);
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
    if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
    return Math.round(n).toLocaleString();
  };
  if (kind === "usd") return (v: number) => "$" + num(v);
  if (kind === "pct") return (v: number) => {
    const n = Math.round(Number(v) * 10) / 10;
    return (Number.isInteger(n) ? n : n.toFixed(1)) + "%";
  };
  return num;
};

// ---------------------------------------------------------------------------
// Palettes
// ---------------------------------------------------------------------------

/** 22 categorical colours: 7 brand-leading anchors + 15 extended, picked to stay
 *  distinct after the first 7 cycle, on light AND dark backgrounds. */
export const CHART_CATEGORICAL = [
  "#059669", "#3B82F6", "#F59E0B", "#EF4444", "#8B5CF6", "#10B981", "#EC4899",
  "#0EA5E9", "#84CC16", "#F97316", "#A855F7", "#14B8A6", "#F43F5E", "#EAB308",
  "#6366F1", "#22C55E", "#D946EF", "#06B6D4", "#FB923C", "#7C3AED", "#16A34A", "#DB2777",
];

/** Emerald sequential ramp for heatmaps / gradient bars. */
export const CHART_SEQUENTIAL = [
  "#ECFDF5", "#D1FAE5", "#A7F3D0", "#6EE7B7", "#34D399",
  "#10B981", "#059669", "#047857", "#065F46", "#064E3B",
];

/** Frozen entity ORDER — part of the contract, not a colour: bottom-up in stacks,
 *  clockwise-from-12 in donuts, left-to-right in waterfalls. Same entity, same
 *  slot, on every chart in the product.
 *
 *  REPLACE these placeholder keys with your product's entity vocabulary, and
 *  rename the matching `--entity-*` custom properties in tokens.css in the same
 *  commit — the lookup below derives the variable name from the key.
 *
 *    export const ENTITY_ORDER = ["compute", "storage", "network"] as const;
 *    // reads --entity-compute, --entity-storage, --entity-network
 */
export const ENTITY_ORDER = ["a", "b", "c", "d", "e", "f", "g"] as const;
export type Entity = (typeof ENTITY_ORDER)[number];

/** Frozen entity COLOURS, read from tokens.css at build time.
 *
 *  Deliberately NOT a literal map. tokens.css owns these hexes; a second copy
 *  here would be kept in sync only by a comment, and a comment is not a
 *  mechanism. These are the colours the design system calls "frozen — must
 *  render the same hue in every chart, legend, table and dot", so they get
 *  exactly one definition.
 *
 *  Call inside a build function, never at module scope. */
export const entityColors = (): Record<Entity, string> =>
  Object.fromEntries(
    ENTITY_ORDER.map(k => [k, cssVar(`--entity-${k}`)]),
  ) as Record<Entity, string>;

/** Head-to-head comparison pair. Fixed, not accent-derived, so the two sides
 *  never collide with a themed accent. */
export const COMPARE_COLORS = { us: "#3B82F6", them: "#EF4444" };

// ---------------------------------------------------------------------------
// Root text style.
//
// REQUIRED on every option. ECharts renders to canvas and does NOT inherit the
// page font — without this, charts fall back to the browser default sans while
// the surrounding UI is Inter, and the seam is visible in every screenshot.
//
// A FUNCTION, not a constant, and it reads `--font` rather than the literal
// string "Inter". `next/font` does not expose the family under its real name —
// it emits a hashed family (`__Inter_abc123`) and publishes it through the CSS
// variable. Hardcoding "Inter" therefore matches nothing and silently renders
// the fallback, which is the exact seam this exists to prevent.
//
// Call it inside a build function (like T()), never at module scope — there is
// no computed style to read before the document exists.
// ---------------------------------------------------------------------------
const FONT_FALLBACK = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

export const chartTextStyle = () => ({
  fontFamily: cssVar("--font") || FONT_FALLBACK,
});

// ---------------------------------------------------------------------------
// Ink on a coloured fill.
// ---------------------------------------------------------------------------

/** Readable text colour to print ON TOP OF `hex`. Inside-bar labels hardcoded to
 *  white disappear on the light end of a sequential ramp and on grey "Other"
 *  slices — relative luminance picks dark ink on light fills. */
export function labelInk(hex: string, textColor: string): string {
  const c = hex.replace("#", "");
  if (c.length !== 6) return "#fff";
  const [r, g, b] = [0, 2, 4].map(i => parseInt(c.slice(i, i + 2), 16) / 255);
  if ([r, g, b].some(Number.isNaN)) return "#fff";
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) > 0.55 ? textColor : "#fff";
}

/** hex (#rgb / #rrggbb) → rgba at the given alpha. Used to derive lighter stack
 *  segments and striped projection fills from a solid entity colour. */
export function hexToRgba(hex: string, a: number): string {
  const h = String(hex).replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map(c => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
