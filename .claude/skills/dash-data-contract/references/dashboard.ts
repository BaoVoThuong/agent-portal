/* =============================================================================
   dashboard.ts — the payload contract.

   Copy to types/dashboard.ts. Import from BOTH sides: the assembler produces
   these shapes, the chart and section components consume them. One definition,
   so a rename is a compile error rather than a runtime surprise.

   THREE RULES THAT LIVE IN THESE TYPES
   1. Percent units end-to-end. 22.3 means 22.3%, never 0.223. A percentage
      DIFFERENCE is in percentage points and is labelled "pp", never "%".
   2. null means "not measured / undefined / below the volume floor" and renders
      as a GAP. 0 means "measured, and it was zero". Never NaN, never Infinity.
   3. Every array in a section is index-aligned to that section's `x` spine.
      Never ship parallel arrays of different lengths.

   For each field you add, record: the unit, the grain (what one row counts), and
   the null semantics. If you change a field, change the comment.
   ============================================================================= */

/** Number formatting family. Drives axis / tooltip / label formatter selection. */
export type Kind = "usd" | "pct" | "int";

/** Direction of a delta. Independent of whether that direction is good. */
export type Dir = "up" | "down" | null;

// ---------------------------------------------------------------------------
// KPI
// ---------------------------------------------------------------------------

/**
 * A KPI tile.
 *
 * `value` and `delta` are DISPLAY STRINGS, already formatted server-side — the
 * component renders, it does not format. That keeps one formatting decision per
 * metric instead of one per render site.
 *
 * `dir` is the sign; `inverse` is the meaning. Keep them independent:
 *   inverse: true  → cost semantics.   up = red,   down = green   (the default)
 *   inverse: false → volume/quality.   up = green, down = red
 * The same `dir: "up"` is green on a throughput metric and red on a cost metric.
 */
export type Kpi = {
  label: string;
  value: string;
  delta?: string | null;   // e.g. "+2.4% vs prior", "−0.12 pp vs prior"
  dir?: Dir;
  inverse?: boolean;       // default true
  sub?: string | null;     // small muted line under the value
  help?: string | null;    // "?" glyph tooltip: definition, target, caveat
};

// ---------------------------------------------------------------------------
// Chart payloads — one per chart shape in dash-charts
// ---------------------------------------------------------------------------

/**
 * Rate line(s) over a volume bar. The most-used chart shape.
 * Bar = the denominator, on the right axis. Lines = rates, on the left axis.
 */
export type DualAxisTrend = {
  x: string[];                                   // shared category spine (display labels)
  bar: {
    name: string;
    data: (number | null)[];
    color?: string;
    opacity?: number;                            // default 0.55 — it is background
  };
  lines: { name: string; data: (number | null)[]; color?: string }[];
  leftLabel?: string;
  rightLabel?: string;
  leftFmt?: Kind;                                // default "pct"
  threshold?: number | null;                     // dashed target/limit, LEFT axis, percent units
  thresholdLabel?: string;                       // e.g. "3.80% Target", "2% Threshold"
};

/**
 * Composition over time.
 *
 * The SAME payload feeds a plain stack and a 100% stack — normalisation is a
 * client-side view toggle, not a second payload. Ship one shape, toggle in the UI.
 */
export type StackedDist = {
  x: string[];
  series: { name: string; data: (number | null)[]; color?: string }[];
  valueFormat?: Kind;
  yLabel?: string;
};

/** Ranked categories. Pre-sorted by the server, descending. */
export type HBar = {
  labels: string[];
  values: number[];
  color?: string;
  valueFormat?: Kind;
  xLabel?: string;
};

/** Funnel stages, in sequence order (not sorted by size). */
export type FunnelStages = {
  order: number;
  label: string;
  reached: number;
  convFromPrev: number | null;   // % of the previous stage; null on stage 0
  convFromTop: number | null;    // % of stage 0
  color: string;
}[];

/** One dot on a scatter: two measures plus the identity to name in the tooltip. */
export type ScatterPoint = { x: number; y: number; label: string; group: string };

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

/**
 * One row of a detail table. Columns are declared by the component
 * (dash-design-system primitive 11), so the payload stays a plain record: the
 * assembler decides which keys exist, the column list decides what renders.
 */
export type TableRow = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Generated prose
// ---------------------------------------------------------------------------

/**
 * A generated insight. The server emits STRUCTURE; the client renders it. That
 * keeps wording consistent across sections and makes sanitisation unnecessary.
 *
 * The delta badge picks its ARROW BY SIGN and its COLOUR BY `improving` — never
 * colour by sign. That separation is what lets one component narrate a cost
 * metric and a quality metric correctly with no per-metric branching.
 */
export type Insight = {
  metric: string;                 // "Transfer rate"
  label?: string;                 // "for connected sessions"
  periodTo?: string;              // the period this describes
  delta?: {
    pts: number;                  // signed; percentage points when unit is "pp"
    unit?: string;                // "pp", "%", "$"
    improving: boolean;           // drives the COLOUR
    periodFrom?: string;          // what it is measured against — always name it
  };
  dominant?: { label: string; color: string; share: number };  // biggest contributor
  rising?: { label: string; deltaPts: number; periodFrom?: string };
  trends?: {
    label: string;
    pct?: number | null;
    story?: {
      word: "rising" | "easing" | "flat";
      tone: string;
      first: number;
      last: number;
      improving: boolean;
    };
  }[];
  trendsLabel?: string;
  lines?: string[];               // free-text supporting points
};

// ---------------------------------------------------------------------------
// Section + page envelopes
// ---------------------------------------------------------------------------

/** A section of a report page. Every section is some subset of this. */
export type SectionPayload = {
  kpis?: Kpi[];
  trend?: DualAxisTrend;
  dist?: StackedDist;
  byCategory?: HBar;
  table?: TableRow[];
  insight?: Insight;
  coverage?: string | null;       // caveat banner text; null when clean
};

/** One tile of the glance hero. `status` drives the coloured rail and pill. */
export type GlanceTile = {
  label: string;
  value: string;
  delta?: string | null;
  dir?: Dir;
  inverse?: boolean;
  target?: string | null;         // display string, e.g. "≥ 3.80%"
  status?: "pass" | "fail" | null; // null = no target, render `note` instead
  note?: string | null;
};

export type GlanceSummary = {
  targetsMet: number;
  targetsTotal: number;           // count only tiles that HAVE a target
  tiles: GlanceTile[];
};

/**
 * Provenance, rendered in the page footer. Every value comes from here — a
 * hardcoded footer goes stale silently and is worse than none.
 */
export type PageMeta = {
  window: string;                 // resolved, e.g. "2026-05-21 → 2026-06-03"
  grain: string;                  // what one row counts
  base?: string;                  // source table / view / endpoint
  filters?: string;               // filters applied, in words
  formula?: string;               // how the headline metric is computed
  asOf?: string;                  // data freshness, NOT the render time
  caveats?: string[];
};
