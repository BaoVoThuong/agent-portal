"use client";

import { createContext, useContext, useEffect, useRef } from "react";
import {
  AXIS_LABEL_STYLE,
  AXIS_NAME_STYLE,
  BAR_HEADROOM,
  CHART_NUMBER_COLOR,
  formatChartCount,
  formatChartMoney,
  GRID_LINE_STYLE,
  LEGEND_STYLE,
  LINE_HEADROOM,
  LINE_SERIES_COLOR,
  NUMBER_HALO,
  niceAxisScale,
  TOOLTIP_STYLE,
  tooltipRow,
} from "./combo-chart-format";
import { loadEchartsEngine } from "./echarts-engine";
import { PC_TREND_LINES, type PcPremiumTrendPoint } from "./pc-premium-trend";

// Màu theo thứ tự bảng đã kiểm của dataviz; mỗi line luôn giữ đúng một màu.
const LINE_COLORS: Record<string, string> = {
  Auto: "#2a78d6",
  Home: "#eb6834",
  Dwelling: "#1baf7a",
  Commercial: "#eda100",
  Flood: "#e87ba4",
  Renters: "#008300",
  Other: "#898781",
};
const TOTAL_ID = "total";

// Nút Premium/Volume nằm trên hàng tiêu đề của section, ngoài chart.
export const PcPremiumViewContext = createContext<PcPremiumView>("premium");

export type PcPremiumView = "premium" | "volume";
type LegendSelection = Record<string, boolean>;
type TooltipItem = {
  dataIndex: number;
  marker: string;
  seriesId: string;
  seriesName: string;
  value: number;
};

export const PC_PREMIUM_VIEW_OPTIONS: { label: string; value: PcPremiumView }[] = [
  { label: "Premium", value: "premium" },
  { label: "Volume", value: "volume" },
];

const VIEWS = {
  premium: {
    barName: "Total Premium",
    barsAreCounts: false,
    lineName: "Policies",
    barsByLine: (point: PcPremiumTrendPoint) => point.premiumByLine,
    lineValue: (point: PcPremiumTrendPoint) => point.policies,
    formatBar: formatChartMoney,
    formatLine: formatChartCount,
  },
  volume: {
    barName: "Policies",
    barsAreCounts: true,
    lineName: "Total Premium",
    barsByLine: (point: PcPremiumTrendPoint) => point.policiesByLine,
    lineValue: (point: PcPremiumTrendPoint) => point.premium,
    formatBar: formatChartCount,
    formatLine: formatChartMoney,
  },
};

type View = (typeof VIEWS)[PcPremiumView];

export function PcPremiumTrendChart({
  ariaLabel,
  points,
}: {
  ariaLabel: string;
  points: PcPremiumTrendPoint[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mode = useContext(PcPremiumViewContext);

  useEffect(() => {
    const element = containerRef.current;
    if (!element || points.length === 0) return;

    let disposed = false;
    let cleanup = () => {};

    loadEchartsEngine()
      .then((core) => {
        if (disposed) return;

        const chart = core.init(element);
        const view = VIEWS[mode];
        const lines = linesWithData(points);

        chart.setOption(buildOption(points, lines, view));
        // Ẩn một line thì tổng trên đầu cột và thang cột phải tính lại.
        chart.on("legendselectchanged", (event) => {
          const { selected } = event as { selected: LegendSelection };
          const totals = visibleTotals(points, lines, view, selected);

          chart.setOption({
            yAxis: [{ id: "bars", ...barAxisScale(totals, view) }],
            series: [{ id: TOTAL_ID, data: totals }],
          });
        });

        const observer = new ResizeObserver(() => chart.resize());
        observer.observe(element);
        cleanup = () => {
          observer.disconnect();
          chart.dispose();
        };
      })
      // Tải chart lỗi thì các bảng số bên dưới vẫn dùng được.
      .catch(() => {});

    return () => {
      disposed = true;
      cleanup();
    };
  }, [mode, points]);

  return (
    <div
      aria-label={ariaLabel}
      className="h-[400px] w-full max-md:h-[360px]"
      ref={containerRef}
      role="img"
    />
  );
}

function linesWithData(points: PcPremiumTrendPoint[]) {
  return PC_TREND_LINES.filter((line) =>
    points.some((point) => (point.premiumByLine[line] ?? 0) > 0)
  );
}

function visibleTotals(
  points: PcPremiumTrendPoint[],
  lines: readonly string[],
  view: View,
  selected: LegendSelection
) {
  return points.map((point) =>
    lines.reduce(
      (total, line) =>
        selected[line] === false ? total : total + (view.barsByLine(point)[line] ?? 0),
      0
    )
  );
}

function barAxisScale(totals: number[], view: View) {
  return niceAxisScale(Math.max(...totals, 1) * BAR_HEADROOM, view.barsAreCounts);
}

function buildOption(points: PcPremiumTrendPoint[], lines: readonly string[], view: View) {
  const totals = visibleTotals(points, lines, view, {});
  const lineMax = Math.max(...points.map(view.lineValue), 1) * LINE_HEADROOM;

  return {
    animationDuration: 400,
    legend: { ...LEGEND_STYLE, type: "scroll" as const, data: [...lines, view.lineName] },
    grid: { left: 16, right: 16, top: 36, bottom: 62, containLabel: true },
    xAxis: {
      type: "category" as const,
      data: points.map((point) => point.label),
      axisTick: { show: false },
      axisLine: { lineStyle: { color: "#cbd5e1" } },
      axisLabel: { ...AXIS_LABEL_STYLE, hideOverlap: true },
      name: "Policy Effective Date",
      nameLocation: "middle" as const,
      nameGap: 28,
      nameTextStyle: AXIS_NAME_STYLE,
    },
    yAxis: [
      {
        id: "bars",
        type: "value" as const,
        name: view.barName.toLowerCase(),
        nameTextStyle: { ...AXIS_NAME_STYLE, align: "left" as const },
        min: 0,
        ...barAxisScale(totals, view),
        axisLabel: { ...AXIS_LABEL_STYLE, formatter: (value: number) => view.formatBar(value) },
        splitLine: { lineStyle: GRID_LINE_STYLE },
      },
      {
        id: "line",
        type: "value" as const,
        name: view.lineName.toLowerCase(),
        nameTextStyle: { ...AXIS_NAME_STYLE, align: "right" as const },
        min: 0,
        ...niceAxisScale(lineMax, !view.barsAreCounts),
        axisLabel: { ...AXIS_LABEL_STYLE, formatter: (value: number) => view.formatLine(value) },
        splitLine: { show: false },
      },
    ],
    tooltip: {
      ...TOOLTIP_STYLE,
      formatter: (params: unknown) => formatTooltip(points, view, params as TooltipItem[]),
    },
    series: [
      ...lines.map((line) => ({
        name: line,
        type: "bar" as const,
        stack: "bars",
        yAxisIndex: 0,
        barMaxWidth: 44,
        data: points.map((point) => view.barsByLine(point)[line] ?? 0),
        itemStyle: { color: LINE_COLORS[line], borderColor: "#fff", borderWidth: 1 },
      })),
      {
        id: TOTAL_ID,
        name: "Total",
        type: "line" as const,
        yAxisIndex: 0,
        data: totals,
        symbol: "circle",
        symbolSize: 0,
        showSymbol: true,
        silent: true,
        lineStyle: { opacity: 0 },
        label: {
          show: true,
          position: "top" as const,
          color: "#0f172a",
          fontSize: 12,
          fontWeight: 600 as const,
          ...NUMBER_HALO,
          formatter: (item: { value: unknown }) =>
            Number(item.value) > 0 ? view.formatBar(Number(item.value)) : "",
        },
        labelLayout: { hideOverlap: true },
      },
      {
        name: view.lineName,
        type: "line" as const,
        yAxisIndex: 1,
        smooth: 0.2,
        symbol: "emptyCircle",
        symbolSize: 7,
        z: 5,
        data: points.map(view.lineValue),
        lineStyle: { width: 2, color: LINE_SERIES_COLOR },
        itemStyle: { color: LINE_SERIES_COLOR, borderWidth: 2 },
        label: {
          show: true,
          position: "top" as const,
          color: CHART_NUMBER_COLOR,
          fontSize: 12,
          fontWeight: 600 as const,
          ...NUMBER_HALO,
          formatter: (item: { value: unknown }) => view.formatLine(Number(item.value)),
        },
        labelLayout: { hideOverlap: true },
      },
    ],
  };
}

function formatTooltip(points: PcPremiumTrendPoint[], view: View, items: TooltipItem[]) {
  const total = items.find((item) => item.seriesId === TOTAL_ID);
  const line = items.find((item) => item.seriesName === view.lineName);
  const label = items[0] ? points[items[0].dataIndex].label : "";
  const lineRows = items
    .filter((item) => item !== total && item !== line && Number(item.value) > 0)
    .map((item) => tooltipRow(item.marker, item.seriesName, view.formatBar(Number(item.value))));

  return [
    `<div style="margin-bottom:4px;font-weight:600">${label}</div>`,
    ...lineRows,
    total ? tooltipRow("", `Total ${view.barName.replace("Total ", "")}`, view.formatBar(Number(total.value))) : "",
    line ? tooltipRow(line.marker, view.lineName, view.formatLine(Number(line.value))) : "",
  ].join("");
}
