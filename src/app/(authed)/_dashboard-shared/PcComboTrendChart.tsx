"use client";

import { useEffect, useRef } from "react";
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

export type PcComboTrendPoint = {
  label: string;
  bar: number;
  line: number;
};

type LineKind = "percent" | "count";

type ComboConfig = {
  barColor: string;
  barName: string;
  lineKind: LineKind;
  lineName: string;
  xAxisName: string;
};

type TooltipItem = {
  dataIndex: number;
  marker: string;
  seriesName: string;
  value: number;
};

// Cột là số tiền ở trục trái, đường là tỉ lệ hoặc số lượng ở trục phải.
export function PcComboTrendChart({
  ariaLabel,
  barColor,
  barName,
  lineKind,
  lineName,
  points,
  xAxisName,
}: ComboConfig & {
  ariaLabel: string;
  points: PcComboTrendPoint[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = containerRef.current;
    if (!element || points.length === 0) return;

    let disposed = false;
    let cleanup = () => {};

    loadEchartsEngine()
      .then((core) => {
        if (disposed) return;

        const chart = core.init(element);
        chart.setOption(
          buildOption(points, { barColor, barName, lineKind, lineName, xAxisName })
        );

        const observer = new ResizeObserver(() => chart.resize());
        observer.observe(element);
        cleanup = () => {
          observer.disconnect();
          chart.dispose();
        };
      })
      // Tải chart lỗi thì các bảng số trên trang vẫn dùng được.
      .catch(() => {});

    return () => {
      disposed = true;
      cleanup();
    };
  }, [barColor, barName, lineKind, lineName, points, xAxisName]);

  return (
    <div
      aria-label={ariaLabel}
      className="h-[380px] w-full max-md:h-[340px]"
      ref={containerRef}
      role="img"
    />
  );
}

function formatLine(kind: LineKind, value: number) {
  return kind === "percent" ? `${value.toFixed(2)}%` : formatChartCount(value);
}

function buildOption(points: PcComboTrendPoint[], config: ComboConfig) {
  const { barColor, barName, lineKind, lineName, xAxisName } = config;
  const barMax = Math.max(...points.map((point) => point.bar), 1) * BAR_HEADROOM;
  const lineMax = Math.max(...points.map((point) => point.line), 1) * LINE_HEADROOM;

  return {
    animationDuration: 400,
    legend: { ...LEGEND_STYLE, data: [barName, lineName] },
    grid: { left: 16, right: 16, top: 36, bottom: 62, containLabel: true },
    xAxis: {
      type: "category" as const,
      data: points.map((point) => point.label),
      axisTick: { show: false },
      axisLine: { lineStyle: { color: "#cbd5e1" } },
      axisLabel: { ...AXIS_LABEL_STYLE, hideOverlap: true },
      name: xAxisName,
      nameLocation: "middle" as const,
      nameGap: 28,
      nameTextStyle: AXIS_NAME_STYLE,
    },
    yAxis: [
      {
        type: "value" as const,
        name: barName.toLowerCase(),
        nameTextStyle: { ...AXIS_NAME_STYLE, align: "left" as const },
        min: 0,
        ...niceAxisScale(barMax),
        axisLabel: {
          ...AXIS_LABEL_STYLE,
          formatter: (value: number) => formatChartMoney(value),
        },
        splitLine: { lineStyle: GRID_LINE_STYLE },
      },
      {
        type: "value" as const,
        name: lineName.toLowerCase(),
        nameTextStyle: { ...AXIS_NAME_STYLE, align: "right" as const },
        min: 0,
        ...niceAxisScale(lineMax, lineKind === "count"),
        axisLabel: {
          ...AXIS_LABEL_STYLE,
          formatter: (value: number) =>
            lineKind === "percent" ? `${value}%` : formatChartCount(value),
        },
        splitLine: { show: false },
      },
    ],
    tooltip: {
      ...TOOLTIP_STYLE,
      formatter: (params: unknown) => {
        const items = params as TooltipItem[];
        const label = items[0] ? points[items[0].dataIndex].label : "";

        return [
          `<div style="margin-bottom:4px;font-weight:600">${label}</div>`,
          ...items.map((item) =>
            tooltipRow(
              item.marker,
              item.seriesName,
              item.seriesName === barName
                ? formatChartMoney(Number(item.value))
                : formatLine(lineKind, Number(item.value))
            )
          ),
        ].join("");
      },
    },
    series: [
      {
        name: barName,
        type: "bar" as const,
        yAxisIndex: 0,
        barMaxWidth: 44,
        data: points.map((point) => point.bar),
        itemStyle: { color: barColor, borderRadius: [4, 4, 0, 0] },
        label: {
          show: true,
          position: "top" as const,
          color: "#0f172a",
          fontSize: 12,
          fontWeight: 600 as const,
          ...NUMBER_HALO,
          formatter: (item: { value: unknown }) => formatChartMoney(Number(item.value)),
        },
        labelLayout: { hideOverlap: true },
      },
      {
        name: lineName,
        type: "line" as const,
        yAxisIndex: 1,
        smooth: 0.2,
        symbol: "emptyCircle",
        symbolSize: 7,
        z: 5,
        data: points.map((point) => point.line),
        lineStyle: { width: 2, color: LINE_SERIES_COLOR },
        itemStyle: { color: LINE_SERIES_COLOR, borderWidth: 2 },
        label: {
          show: true,
          position: "top" as const,
          color: CHART_NUMBER_COLOR,
          fontSize: 12,
          fontWeight: 600 as const,
          ...NUMBER_HALO,
          formatter: (item: { value: unknown }) => formatLine(lineKind, Number(item.value)),
        },
        labelLayout: { hideOverlap: true },
      },
    ],
  };
}
