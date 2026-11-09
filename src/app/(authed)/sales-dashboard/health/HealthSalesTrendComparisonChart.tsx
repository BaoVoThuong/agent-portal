"use client";

import { useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { HealthBookTrendChart } from "../../_dashboard-shared/HealthBookTrendChart";
import { PcToolbarOptions } from "../../_dashboard-shared/PcToolbarOptions";

export type TrendComparisonChartLevel = "month" | "quarter" | "year";

export type TrendComparisonPeriod = {
  periodKey: string;
  periodLabel: string;
  policyCount: number;
  clientCount: number;
  totalMesserPaid: number;
};

export type TrendComparisonPeriodsByLevel = Record<
  TrendComparisonChartLevel,
  TrendComparisonPeriod[]
>;

const CHART_LEVELS: { value: TrendComparisonChartLevel; label: string }[] = [
  { value: "month", label: "Month" },
  { value: "quarter", label: "Quarter" },
  { value: "year", label: "Year" },
];

export function HealthSalesTrendComparisonChart({
  chartLevel: controlledChartLevel,
  onChartLevelChange,
  periodsByLevel,
}: {
  chartLevel?: TrendComparisonChartLevel;
  onChartLevelChange?: (chartLevel: TrendComparisonChartLevel) => void;
  periodsByLevel: TrendComparisonPeriodsByLevel;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [localChartLevel, setLocalChartLevel] = useState<TrendComparisonChartLevel>(
    () => parseChartLevel(searchParams.get("trendLevel"))
  );
  const chartLevel = controlledChartLevel ?? localChartLevel;
  const rows = periodsByLevel[chartLevel];
  const chartLevelAdjective = getChartLevelAdjective(chartLevel);
  const points = useMemo(
    () =>
      rows.map((row) => ({
        label: row.periodLabel,
        bar: row.totalMesserPaid,
        policies: row.policyCount,
        clients: row.clientCount,
      })),
    [rows]
  );

  function updateChartLevel(nextChartLevel: TrendComparisonChartLevel) {
    if (nextChartLevel === chartLevel) return;

    if (onChartLevelChange) {
      onChartLevelChange(nextChartLevel);
      return;
    }

    setLocalChartLevel(nextChartLevel);
    updateTrendLevelUrl(pathname, nextChartLevel);
  }

  return (
    <section className="pc-section flex flex-col">
      <div className="pc-section-head mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-bold leading-tight text-slate-800">
          Carrier paid, policies &amp; clients
        </h3>
        <div className="pc-section-toolbar">
          <PcToolbarOptions
            label="Period"
            onChange={updateChartLevel}
            options={CHART_LEVELS}
            value={chartLevel}
          />
        </div>
      </div>
      <p className="pc-section-note">
        {chartLevelAdjective} carrier paid, with policies and clients on the lines. Dates are Report Month. Click a name in the legend to hide it.
      </p>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-shadow duration-300 hover:shadow-md">
        {rows.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm font-medium text-slate-500">
            No trend data matched these filters.
          </div>
        ) : (
          <HealthBookTrendChart
            ariaLabel="Carrier paid, policies, and clients trend by period"
            barName="Carrier Paid"
            points={points}
          />
        )}
      </div>
    </section>
  );
}

function updateTrendLevelUrl(
  pathname: string,
  nextChartLevel: TrendComparisonChartLevel
) {
  const params = new URLSearchParams(window.location.search);

  if (nextChartLevel === "month") {
    params.delete("trendLevel");
  } else {
    params.set("trendLevel", nextChartLevel);
  }

  const query = params.toString();
  window.history.replaceState(null, "", query ? `${pathname}?${query}` : pathname);
}

function parseChartLevel(value: string | null): TrendComparisonChartLevel {
  return value === "quarter" || value === "year" ? value : "month";
}

function getChartLevelAdjective(chartLevel: TrendComparisonChartLevel) {
  if (chartLevel === "quarter") return "Quarterly";
  if (chartLevel === "year") return "Yearly";
  return "Monthly";
}
