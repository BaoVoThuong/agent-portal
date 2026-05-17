"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import { AgentHealthPerformanceChart } from "./AgentHealthPerformanceChart";
import { AgentHealthSalesPerformanceMoMTable } from "./AgentHealthSalesPerformanceMoMTable";
import type { ChartLevel, PeriodsByLevel } from "./AgentHealthPerformanceChart";

export function AgentHealthPerformanceTrendSection({
  initialChartLevel,
  periodsByLevel,
}: {
  initialChartLevel: ChartLevel;
  periodsByLevel: PeriodsByLevel;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [chartState, setChartState] = useState({
    initialChartLevel,
    chartLevel: initialChartLevel,
  });
  const chartLevel =
    chartState.initialChartLevel === initialChartLevel
      ? chartState.chartLevel
      : initialChartLevel;

  function updateChartLevel(nextChartLevel: ChartLevel) {
    if (nextChartLevel === chartLevel) return;

    setChartState({ initialChartLevel, chartLevel: nextChartLevel });

    const params = new URLSearchParams(searchParams.toString());

    if (nextChartLevel === "month") {
      params.delete("chartLevel");
    } else {
      params.set("chartLevel", nextChartLevel);
    }

    const query = params.toString();
    const nextHref = query ? `${pathname}?${query}` : pathname;
    const currentQuery = searchParams.toString();
    const currentHref = currentQuery ? `${pathname}?${currentQuery}` : pathname;

    if (nextHref !== currentHref) {
      window.history.replaceState(null, "", nextHref);
    }
  }

  return (
    <>
      <AgentHealthPerformanceChart
        key={chartLevel}
        chartLevel={chartLevel}
        onChartLevelChange={updateChartLevel}
        periodsByLevel={periodsByLevel}
      />
      <AgentHealthSalesPerformanceMoMTable
        chartLevel={chartLevel}
        periodsByLevel={periodsByLevel}
      />
    </>
  );
}
