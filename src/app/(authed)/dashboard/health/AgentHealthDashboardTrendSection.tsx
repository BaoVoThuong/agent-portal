"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import { AgentHealthDashboardChart } from "./AgentHealthDashboardChart";
import { AgentHealthSalesDashboardMoMTable } from "./AgentHealthSalesDashboardMoMTable";
import type { ChartLevel, PeriodsByLevel } from "./AgentHealthDashboardChart";

export function AgentHealthDashboardTrendSection({
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
      <AgentHealthDashboardChart
        key={chartLevel}
        chartLevel={chartLevel}
        onChartLevelChange={updateChartLevel}
        periodsByLevel={periodsByLevel}
      />
      <AgentHealthSalesDashboardMoMTable
        chartLevel={chartLevel}
        periodsByLevel={periodsByLevel}
      />
    </>
  );
}
