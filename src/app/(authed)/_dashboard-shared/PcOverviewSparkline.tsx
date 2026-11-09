"use client";

import { useEffect, useRef } from "react";
import { loadEchartsEngine } from "./echarts-engine";
import {
  formatPcMetric,
  type PcMetricKind,
  type PcMetricPoint,
} from "./pc-overview-metrics";

export function PcOverviewSparkline({
  className,
  color,
  kind,
  label,
  points,
  variant,
}: {
  className: string;
  color: string;
  kind: PcMetricKind;
  label: string;
  points: PcMetricPoint[];
  // calm: trục từ 0 và có nền; spark: trục theo dữ liệu, cho các tỉ lệ.
  variant: "calm" | "spark";
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
        chart.setOption(buildOption({ color, kind, points, variant }));

        const observer = new ResizeObserver(() => chart.resize());
        observer.observe(element);
        cleanup = () => {
          observer.disconnect();
          chart.dispose();
        };
      })
      // Tải chart lỗi thì thẻ vẫn còn đủ số; lần mở sau sẽ thử lại.
      .catch(() => {});

    return () => {
      disposed = true;
      cleanup();
    };
  }, [color, kind, points, variant]);

  return (
    <div
      aria-label={`${label} by month`}
      className={className}
      ref={containerRef}
      role="img"
    />
  );
}

function buildOption({
  color,
  kind,
  points,
  variant,
}: {
  color: string;
  kind: PcMetricKind;
  points: PcMetricPoint[];
  variant: "calm" | "spark";
}) {
  const calm = variant === "calm";
  const values = points.map((point) => point.value);
  const peakIndex = values.indexOf(Math.max(...values));
  const lastIndex = points.length - 1;

  return {
    grid: { left: 6, right: 8, top: 8, bottom: 6 },
    xAxis: {
      type: "category" as const,
      data: points.map((point) => point.label),
      show: false,
      boundaryGap: false,
    },
    yAxis: calm
      ? { type: "value" as const, show: false, min: 0 }
      : { type: "value" as const, show: false, scale: true },
    tooltip: {
      trigger: "axis" as const,
      confine: true,
      backgroundColor: "#fff",
      borderColor: "#e2e8f0",
      padding: [6, 10],
      textStyle: { color: "#0f172a", fontSize: 12 },
      extraCssText: "box-shadow:0 4px 12px rgba(15,23,42,.12);",
      axisPointer: { type: "line" as const, lineStyle: { color: "#94a3b8" } },
      formatter: (items: unknown) => {
        const [item] = items as { axisValue: string; value: number }[];

        return `${item.axisValue}<br><b>${formatPcMetric(kind, item.value)}</b>`;
      },
    },
    series: [
      {
        type: "line" as const,
        smooth: 0.2,
        symbol: "none",
        showAllSymbol: true,
        lineStyle: { width: 2, color },
        areaStyle: calm ? { color: `${color}1c` } : undefined,
        data: values.map((value, index) => {
          if (index === peakIndex) {
            return {
              value,
              symbol: "circle",
              symbolSize: 9,
              itemStyle: { color, borderColor: "#fff", borderWidth: 2 },
            };
          }

          if (index === lastIndex) {
            return {
              value,
              symbol: "circle",
              symbolSize: 8,
              itemStyle: { color: "#fff", borderColor: color, borderWidth: 2 },
            };
          }

          return value;
        }),
      },
    ],
  };
}
