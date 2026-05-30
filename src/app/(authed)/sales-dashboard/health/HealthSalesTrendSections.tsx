"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import {
  HealthSalesTrendComparisonChart,
  type TrendComparisonChartLevel,
  type TrendComparisonPeriodsByLevel,
} from "./HealthSalesTrendComparisonChart";

export function HealthSalesTrendSections({
  afterMonthSections,
  afterQuarterSections,
  afterYearSections,
  initialLevel,
  monthSections,
  periodsByLevel,
  quarterSections,
  yearSections,
}: {
  afterMonthSections?: ReactNode;
  afterQuarterSections?: ReactNode;
  afterYearSections?: ReactNode;
  initialLevel: TrendComparisonChartLevel;
  monthSections: ReactNode;
  periodsByLevel: TrendComparisonPeriodsByLevel;
  quarterSections: ReactNode;
  yearSections: ReactNode;
}) {
  const pathname = usePathname();
  const [chartLevel, setChartLevel] =
    useState<TrendComparisonChartLevel>(initialLevel);

  useEffect(() => {
    function syncLevelFromUrl() {
      setChartLevel(parseChartLevel(new URLSearchParams(window.location.search).get("trendLevel")));
    }

    window.addEventListener("popstate", syncLevelFromUrl);

    return () => window.removeEventListener("popstate", syncLevelFromUrl);
  }, []);

  function updateChartLevel(nextChartLevel: TrendComparisonChartLevel) {
    setChartLevel(nextChartLevel);
    updateTrendLevelUrl(pathname, nextChartLevel);
  }

  return (
    <>
      <HealthSalesTrendComparisonChart
        chartLevel={chartLevel}
        onChartLevelChange={updateChartLevel}
        periodsByLevel={periodsByLevel}
      />
      {chartLevel === "month" && monthSections}
      {chartLevel === "quarter" && quarterSections}
      {chartLevel === "year" && yearSections}
      {chartLevel === "month" && afterMonthSections}
      {chartLevel === "quarter" && afterQuarterSections}
      {chartLevel === "year" && afterYearSections}
    </>
  );
}

function parseChartLevel(value: string | null): TrendComparisonChartLevel {
  return value === "quarter" || value === "year" ? value : "month";
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
