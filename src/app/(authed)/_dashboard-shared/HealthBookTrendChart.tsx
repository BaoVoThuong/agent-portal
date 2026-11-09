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
  NUMBER_HALO,
  niceAxisScale,
  TOOLTIP_STYLE,
  tooltipRow,
  twoLineLabelPositions,
} from "./combo-chart-format";
import { loadEchartsEngine } from "./echarts-engine";

export type HealthBookTrendPoint = {
  label: string;
  bar: number;
  policies: number;
  clients: number;
};

type TooltipItem = {
  dataIndex: number;
  marker: string;
  seriesName: string;
  value: number;
};

// Cột tím nhạt làm nền, mỗi cột có số; hai đường xanh dương và cam nổi lên trên.
const BAR_COLOR = "#c9c2f3";
const POLICIES_COLOR = "#2a78d6";
const CLIENTS_COLOR = "#eb6834";
const POLICIES_NAME = "Policies";
const CLIENTS_NAME = "Clients";

// Cột là số tiền ở trục trái, hai đường Policies và Clients ở trục phải.
export function HealthBookTrendChart({
  ariaLabel,
  barName,
  points,
}: {
  ariaLabel: string;
  barName: string;
  points: HealthBookTrendPoint[];
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
        chart.setOption(buildOption(points, barName));

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
  }, [barName, points]);

  return (
    <div
      aria-label={ariaLabel}
      className="h-[380px] w-full max-md:h-[340px]"
      ref={containerRef}
      role="img"
    />
  );
}

function lineSeries(
  name: string,
  color: string,
  data: { value: number; label: { position: "top" | "bottom" } }[]
) {
  return {
    name,
    type: "line" as const,
    yAxisIndex: 1,
    smooth: 0.2,
    symbol: "emptyCircle",
    symbolSize: 7,
    z: 5,
    data,
    lineStyle: { width: 2, color },
    itemStyle: { color, borderWidth: 2 },
    label: {
      show: true,
      color: CHART_NUMBER_COLOR,
      fontSize: 12,
      fontWeight: 600 as const,
      ...NUMBER_HALO,
      formatter: (item: { value: unknown }) => formatChartCount(Number(item.value)),
    },
    labelLayout: { hideOverlap: true },
  };
}

function buildOption(points: HealthBookTrendPoint[], barName: string) {
  const barMax = Math.max(...points.map((point) => point.bar), 1) * BAR_HEADROOM;
  const lineMax =
    Math.max(...points.flatMap((point) => [point.policies, point.clients]), 1) * LINE_HEADROOM;
  const labelPositions = points.map((point) =>
    twoLineLabelPositions(point.policies, point.clients)
  );

  return {
    animationDuration: 400,
    legend: { ...LEGEND_STYLE, data: [barName, POLICIES_NAME, CLIENTS_NAME] },
    grid: { left: 16, right: 16, top: 36, bottom: 62, containLabel: true },
    xAxis: {
      type: "category" as const,
      data: points.map((point) => point.label),
      axisTick: { show: false },
      axisLine: { lineStyle: { color: "#cbd5e1" } },
      axisLabel: { ...AXIS_LABEL_STYLE, hideOverlap: true },
      name: "Report Month",
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
        name: "policies & clients",
        nameTextStyle: { ...AXIS_NAME_STYLE, align: "right" as const },
        min: 0,
        ...niceAxisScale(lineMax, true),
        axisLabel: {
          ...AXIS_LABEL_STYLE,
          formatter: (value: number) => formatChartCount(value),
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
                : formatChartCount(Number(item.value))
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
        itemStyle: { color: BAR_COLOR, borderRadius: [4, 4, 0, 0] },
        label: {
          show: true,
          // Số tiền nằm trong cột để không đè số của đường Clients ngay trên cột.
          position: "insideTop" as const,
          color: "#0f172a",
          fontSize: 12,
          fontWeight: 600 as const,
          formatter: (item: { value: unknown }) => formatChartMoney(Number(item.value)),
        },
        labelLayout: { hideOverlap: true },
      },
      lineSeries(
        POLICIES_NAME,
        POLICIES_COLOR,
        points.map((point, index) => ({
          value: point.policies,
          label: { position: labelPositions[index].first },
        }))
      ),
      lineSeries(
        CLIENTS_NAME,
        CLIENTS_COLOR,
        points.map((point, index) => ({
          value: point.clients,
          label: { position: labelPositions[index].second },
        }))
      ),
    ],
  };
}
