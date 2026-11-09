"use client";

import { useMemo } from "react";
import { HealthBookTrendChart } from "../../_dashboard-shared/HealthBookTrendChart";
import { PcToolbarOptions } from "../../_dashboard-shared/PcToolbarOptions";

export type ChartLevel = "month" | "quarter" | "year";

export type DashboardPeriod = {
  periodKey: string;
  periodLabel: string;
  policyCount: number;
  clientCount: number;
  agentReceived: number;
};

export type PeriodsByLevel = Record<ChartLevel, DashboardPeriod[]>;

export const CHART_LEVELS: { value: ChartLevel; label: string }[] = [
  { value: "month", label: "Month" },
  { value: "quarter", label: "Quarter" },
  { value: "year", label: "Year" },
];

export function AgentHealthDashboardChart({
  chartLevel,
  onChartLevelChange,
  periodsByLevel,
}: {
  chartLevel: ChartLevel;
  onChartLevelChange: (chartLevel: ChartLevel) => void;
  periodsByLevel: PeriodsByLevel;
}) {
  const periods = periodsByLevel[chartLevel];
  const points = useMemo(
    () =>
      periods.map((period) => ({
        label: period.periodLabel,
        bar: period.agentReceived,
        policies: period.policyCount,
        clients: period.clientCount,
      })),
    [periods]
  );

  return (
    <section className="pc-section">
      <div className="pc-section-head mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-xl font-bold tracking-tight text-slate-900">
          Agent commission, policies &amp; clients
        </h3>
        <div className="pc-section-toolbar">
          <PcToolbarOptions
            label="Period"
            onChange={onChartLevelChange}
            options={CHART_LEVELS}
            value={chartLevel}
          />
        </div>
      </div>
      <p className="pc-section-note">
        {getChartLevelAdjective(chartLevel)} agent commission, with policies and clients on the lines. Dates are Report Month. Click a name in the legend to hide it.
      </p>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {periods.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm font-medium text-slate-500">
            No report periods matched these filters.
          </div>
        ) : (
          <HealthBookTrendChart
            ariaLabel="Commission, policies, and clients trend by period"
            barName="Agent Commission"
            points={points}
          />
        )}
      </div>
    </section>
  );
}

function getChartLevelAdjective(chartLevel: ChartLevel) {
  if (chartLevel === "quarter") return "Quarterly";
  if (chartLevel === "year") return "Yearly";
  return "Monthly";
}

export function getChartLevelLabel(chartLevel: ChartLevel) {
  return CHART_LEVELS.find((level) => level.value === chartLevel)?.label ?? "Month";
}
