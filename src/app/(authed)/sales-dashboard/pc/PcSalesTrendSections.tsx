"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import {
  PC_PREMIUM_VIEW_OPTIONS,
  PcPremiumViewContext,
  type PcPremiumView,
} from "../../_dashboard-shared/PcPremiumTrendChart";
import { PcToolbarOptions } from "../../_dashboard-shared/PcToolbarOptions";

export type PcTrendLevel = "month" | "quarter" | "year";

const TREND_LEVELS: { label: string; value: PcTrendLevel }[] = [
  { label: "Month", value: "month" },
  { label: "Quarter", value: "quarter" },
  { label: "Year", value: "year" },
];

export function PcSalesTrendSections({
  initialLevel,
  monthSalesTrend,
  monthSections,
  quarterSalesTrend,
  quarterSections,
  yearSalesTrend,
  yearSections,
}: {
  initialLevel: PcTrendLevel;
  monthSalesTrend: ReactNode;
  monthSections: ReactNode;
  quarterSalesTrend: ReactNode;
  quarterSections: ReactNode;
  yearSalesTrend: ReactNode;
  yearSections: ReactNode;
}) {
  const pathname = usePathname();
  const [trendLevel, setTrendLevel] = useState<PcTrendLevel>(initialLevel);
  const [premiumView, setPremiumView] = useState<PcPremiumView>("premium");
  const salesTrendByLevel = {
    month: monthSalesTrend,
    quarter: quarterSalesTrend,
    year: yearSalesTrend,
  };

  useEffect(() => {
    function syncLevelFromUrl() {
      setTrendLevel(parseTrendLevel(new URLSearchParams(window.location.search).get("trendLevel")));
    }

    window.addEventListener("popstate", syncLevelFromUrl);

    return () => window.removeEventListener("popstate", syncLevelFromUrl);
  }, []);

  function updateTrendLevel(nextTrendLevel: PcTrendLevel) {
    setTrendLevel(nextTrendLevel);
    updateTrendLevelUrl(pathname, nextTrendLevel);
  }

  return (
    <>
      <section className="pc-section flex flex-col">
        <div className="pc-section-head mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-bold leading-tight text-slate-800">
            Premium &amp; policies by line of service
          </h3>
          <div className="pc-section-toolbar">
            <PcToolbarOptions
              label="Period"
              onChange={updateTrendLevel}
              options={TREND_LEVELS}
              value={trendLevel}
            />
            <PcToolbarOptions
              label="View"
              onChange={setPremiumView}
              options={PC_PREMIUM_VIEW_OPTIONS}
              value={premiumView}
            />
          </div>
        </div>
        <p className="pc-section-note">
          {getTrendLevelAdjective(trendLevel)} written premium stacked by line of service, with policy count on the line. Dates are Policy Effective Date. Click a name in the legend to hide it.
        </p>
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-shadow duration-300 hover:shadow-md">
          <PcPremiumViewContext.Provider value={premiumView}>
            {salesTrendByLevel[trendLevel]}
          </PcPremiumViewContext.Provider>
        </div>
      </section>
      {trendLevel === "month" && monthSections}
      {trendLevel === "quarter" && quarterSections}
      {trendLevel === "year" && yearSections}
    </>
  );
}

function parseTrendLevel(value: string | null): PcTrendLevel {
  return value === "quarter" || value === "year" ? value : "month";
}

function updateTrendLevelUrl(pathname: string, nextTrendLevel: PcTrendLevel) {
  const params = new URLSearchParams(window.location.search);

  if (nextTrendLevel === "month") {
    params.delete("trendLevel");
  } else {
    params.set("trendLevel", nextTrendLevel);
  }

  const query = params.toString();
  window.history.replaceState(null, "", query ? `${pathname}?${query}` : pathname);
}

function getTrendLevelAdjective(trendLevel: PcTrendLevel) {
  if (trendLevel === "quarter") return "Quarterly";
  if (trendLevel === "year") return "Yearly";
  return "Monthly";
}
