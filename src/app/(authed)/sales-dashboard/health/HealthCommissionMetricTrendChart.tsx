"use client";

import { useMemo, useState } from "react";
import type { TrendComparisonChartLevel } from "./HealthSalesTrendComparisonChart";
import { PcComboTrendChart } from "../../_dashboard-shared/PcComboTrendChart";
import { PcToolbarOptions } from "../../_dashboard-shared/PcToolbarOptions";

export type HealthCommissionTrendRow = {
  periodKey: string;
  periodLabel: string;
  totalMesserPaid: number;
  agentReceived: number;
  epsCommission: number;
  epsOverride: number;
  epsSplit: number;
};

type MetricKey =
  | "agentReceived"
  | "epsCommission"
  | "epsOverride"
  | "epsSplit";

const METRICS: {
  barLabel: string;
  key: MetricKey;
  percentLabel: string;
  sentenceName: string;
  title: string;
}[] = [
  {
    barLabel: "Agent Commission",
    key: "agentReceived",
    percentLabel: "Agent Comm Rate",
    sentenceName: "agent commission",
    title: "Agent Commission",
  },
  {
    barLabel: "EPS Commission",
    key: "epsCommission",
    percentLabel: "EPS Comm Rate",
    sentenceName: "EPS commission",
    title: "EPS Commission",
  },
  {
    barLabel: "EPS Override",
    key: "epsOverride",
    percentLabel: "EPS Override Rate",
    sentenceName: "EPS override",
    title: "EPS Override",
  },
  {
    barLabel: "EPS Split",
    key: "epsSplit",
    percentLabel: "EPS Split Rate",
    sentenceName: "EPS split",
    title: "EPS Split",
  },
];

export function HealthCommissionMetricTrendChart({
  rows,
  trendLevel,
}: {
  rows: HealthCommissionTrendRow[];
  trendLevel: TrendComparisonChartLevel;
}) {
  const [selectedMetric, setSelectedMetric] =
    useState<MetricKey>("agentReceived");
  const metric = METRICS.find((item) => item.key === selectedMetric) ?? METRICS[0];
  const periodLabel = getTrendLevelLabel(trendLevel);
  // Đảo ngược thứ tự cột trên trục X.
  const points = useMemo(
    () =>
      [...rows].reverse().map((row) => ({
        label: row.periodLabel,
        bar: row[metric.key],
        line: percentOf(row[metric.key], row.totalMesserPaid),
      })),
    [metric.key, rows]
  );

  return (
    <section className="pc-section flex flex-col">
      <div className="pc-section-head mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-bold leading-tight text-slate-800">
          {metric.sentenceName.charAt(0).toUpperCase() + metric.sentenceName.slice(1)} &amp; rate
        </h3>
        <div className="pc-section-toolbar">
          <PcToolbarOptions
            label="Metric"
            onChange={setSelectedMetric}
            options={METRICS.map((item) => ({ label: item.title, value: item.key }))}
            value={selectedMetric}
          />
        </div>
      </div>
      <p className="pc-section-note">
        {getTrendLevelAdjective(trendLevel)} {metric.sentenceName}, with {metric.percentLabel.toLowerCase()} on the line. Dates are Report Month.
      </p>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-shadow duration-300 hover:shadow-md">
        {rows.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm font-medium text-slate-500">
            No commission trend data.
          </div>
        ) : (
          <PcComboTrendChart
            ariaLabel={`${periodLabel} ${metric.title} trend`}
            barColor="#6250d6"
            barName={metric.barLabel}
            lineKind="percent"
            lineName={metric.percentLabel}
            points={points}
            xAxisName="Report Month"
          />
        )}
      </div>
    </section>
  );
}

function getTrendLevelAdjective(trendLevel: TrendComparisonChartLevel) {
  if (trendLevel === "quarter") return "Quarterly";
  if (trendLevel === "year") return "Yearly";
  return "Monthly";
}

function getTrendLevelLabel(trendLevel: TrendComparisonChartLevel) {
  if (trendLevel === "quarter") return "Quarter";
  if (trendLevel === "year") return "Year";
  return "Month";
}

function percentOf(value: number, total: number) {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total === 0) return 0;

  return (value / total) * 100;
}
