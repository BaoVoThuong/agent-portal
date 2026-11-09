"use client";

import { useMemo, useState } from "react";
import { PcComboTrendChart } from "../../_dashboard-shared/PcComboTrendChart";
import { PcToolbarOptions } from "../../_dashboard-shared/PcToolbarOptions";

export type CommissionTrendRow = {
  monthKey: string;
  periodKey: string;
  totalPremium: number;
  totalCommission: number;
  epsCommission: number;
  agentCommission: number;
};

type MetricKey = "totalCommission" | "epsCommission" | "agentCommission";
type PaymentView = "paid" | "unpaid";
type TrendLevel = "month" | "quarter" | "year";

const METRICS: {
  barLabel: string;
  key: MetricKey;
  percentLabel: string;
  title: string;
}[] = [
  {
    barLabel: "Total Commission",
    key: "totalCommission",
    percentLabel: "Commission Rate",
    title: "Total Commission",
  },
  {
    barLabel: "EPS Commission",
    key: "epsCommission",
    percentLabel: "EPS Comm Rate",
    title: "EPS Commission",
  },
  {
    barLabel: "Agent Commission",
    key: "agentCommission",
    percentLabel: "Agent Comm Rate",
    title: "Agent Commission",
  },
];

const PAYMENT_VIEW_OPTIONS: { label: string; value: PaymentView }[] = [
  { label: "Paid", value: "paid" },
  { label: "Unpaid", value: "unpaid" },
];

export function PcCommissionMetricTrendChart({
  rows,
  unpaidRows,
  trendLevel,
}: {
  rows: CommissionTrendRow[];
  unpaidRows?: CommissionTrendRow[];
  trendLevel: TrendLevel;
}) {
  const [selectedMetric, setSelectedMetric] = useState<MetricKey>("totalCommission");
  const [paymentView, setPaymentView] = useState<PaymentView>("paid");
  const metric = METRICS.find((item) => item.key === selectedMetric) ?? METRICS[0];
  const periodLabel = getTrendLevelLabel(trendLevel);
  const activeRows =
    paymentView === "unpaid" ? unpaidRows ?? [] : rows;

  return (
    <section className="pc-section flex flex-col">
      <div className="pc-section-head mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-bold leading-tight text-slate-800">
          {paymentView === "unpaid"
            ? `Estimated unpaid ${metric.title.toLowerCase()}`
            : metric.title.charAt(0) + metric.title.slice(1).toLowerCase()}{" "}
          &amp; rate
        </h3>
        <div className="pc-section-toolbar">
          <PcToolbarOptions
            label="Show"
            onChange={setPaymentView}
            options={PAYMENT_VIEW_OPTIONS}
            value={paymentView}
          />
          <PcToolbarOptions
            label="Metric"
            onChange={setSelectedMetric}
            options={METRICS.map((item) => ({ label: item.title, value: item.key }))}
            value={selectedMetric}
          />
        </div>
      </div>
      <p className="pc-section-note">
        {getTrendLevelAdjective(trendLevel)} {metric.title.toLowerCase()}, with {metric.percentLabel.toLowerCase()} on the line. Dates are Policy Effective Date.
      </p>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-shadow duration-300 hover:shadow-md">
        {activeRows.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm font-medium text-slate-500">
            {paymentView === "unpaid"
              ? "No unpaid commission trend data."
              : "No commission trend data."}
          </div>
        ) : (
          <CommissionTrendCombo
            metric={metric}
            periodLabel={periodLabel}
            rows={activeRows}
          />
        )}
      </div>
    </section>
  );
}

function CommissionTrendCombo({
  metric,
  periodLabel,
  rows,
}: {
  metric: (typeof METRICS)[number];
  periodLabel: string;
  rows: CommissionTrendRow[];
}) {
  const points = useMemo(
    () =>
      rows.map((row) => ({
        label: row.monthKey,
        bar: row[metric.key],
        line: percentOf(row[metric.key], row.totalPremium),
      })),
    [metric.key, rows]
  );

  return (
    <PcComboTrendChart
      ariaLabel={`${periodLabel} ${metric.title} trend by policy effective date`}
      barColor="#6250d6"
      barName={metric.barLabel}
      lineKind="percent"
      lineName={metric.percentLabel}
      points={points}
      xAxisName="Policy Effective Date"
    />
  );
}

function getTrendLevelAdjective(trendLevel: TrendLevel) {
  if (trendLevel === "quarter") return "Quarterly";
  if (trendLevel === "year") return "Yearly";
  return "Monthly";
}

function getTrendLevelLabel(trendLevel: TrendLevel) {
  if (trendLevel === "quarter") return "Quarter";
  if (trendLevel === "year") return "Year";
  return "Month";
}

function percentOf(value: number, total: number) {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total === 0) return 0;

  return (value / total) * 100;
}
