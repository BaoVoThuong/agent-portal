// Phần dùng chung của các combo chart ECharts trên dashboard P&C.

export const AXIS_LABEL_STYLE = { color: "#64748b", fontSize: 12 };
export const AXIS_NAME_STYLE = { color: "#475569", fontSize: 12, fontWeight: 600 as const };
export const NUMBER_HALO = { textBorderColor: "#fff", textBorderWidth: 3 };
export const GRID_LINE_STYLE = { color: "#e5e7eb", type: "dashed" as const };
export const LINE_SERIES_COLOR = "#e34948";
export const CHART_NUMBER_COLOR = "#0f172a";
// Chừa khoảng trên cột để số trên cột và đường ít đè lên nhau.
export const BAR_HEADROOM = 1.6;
export const LINE_HEADROOM = 1.1;

export const TOOLTIP_STYLE = {
  trigger: "axis" as const,
  confine: true,
  backgroundColor: "#fff",
  borderColor: "#e2e8f0",
  padding: [8, 12],
  textStyle: { color: "#0f172a", fontSize: 12 },
  extraCssText: "box-shadow:0 4px 12px rgba(15,23,42,.12);",
  axisPointer: { type: "line" as const, lineStyle: { color: "#94a3b8" } },
};

export const LEGEND_STYLE = {
  left: "center",
  bottom: 4,
  icon: "roundRect",
  itemWidth: 12,
  itemHeight: 12,
  itemGap: 16,
  inactiveColor: "#cbd5e1",
  textStyle: { color: "#475569", fontSize: 12 },
};

export function tooltipRow(marker: string, name: string, value: string) {
  return `<div style="display:flex;justify-content:space-between;gap:20px"><span>${marker}${name}</span><b>${value}</b></div>`;
}

// Trong mỗi kỳ, số của đường cao hơn nằm trên, đường thấp hơn nằm dưới.
export function twoLineLabelPositions(first: number, second: number) {
  return first >= second
    ? ({ first: "top", second: "bottom" } as const)
    : ({ first: "bottom", second: "top" } as const);
}

const AXIS_TICK_COUNT = 4;
const NICE_STEPS = [1, 1.2, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 8, 10];

// Hai trục y cùng số vạch nên đường lưới khớp nhau, và mỗi vạch là một số tròn.
export function niceAxisScale(value: number, wholeNumbers = false) {
  const target = Math.max(value, 1) / AXIS_TICK_COUNT;
  const magnitude = 10 ** Math.floor(Math.log10(target));
  const step =
    NICE_STEPS.map((nice) => nice * magnitude).find(
      (candidate) =>
        candidate >= target - 1e-9 && (!wholeNumbers || Number.isInteger(candidate))
    ) ?? magnitude * 10;

  return { max: step * AXIS_TICK_COUNT, interval: step };
}

export function formatChartMoney(value: number) {
  const absValue = Math.abs(value);
  const short = (amount: number) =>
    new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(amount);

  if (absValue >= 1000000) return `$${short(value / 1000000)}M`;
  if (absValue >= 1000) return `$${short(value / 1000)}K`;

  return `$${short(value)}`;
}

export function formatChartCount(value: number) {
  return Math.round(value).toLocaleString("en-US");
}
