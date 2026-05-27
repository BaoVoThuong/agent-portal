"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

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
      <section className="flex flex-col">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-bold leading-tight text-slate-800">
            {getTrendLevelAdjective(trendLevel)} Sales Volume & Premium Trend
          </h3>
          <TrendLevelControl
            trendLevel={trendLevel}
            onChange={updateTrendLevel}
          />
        </div>
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-shadow duration-300 hover:shadow-md">
          {salesTrendByLevel[trendLevel]}
        </div>
      </section>
      {trendLevel === "month" && monthSections}
      {trendLevel === "quarter" && quarterSections}
      {trendLevel === "year" && yearSections}
    </>
  );
}

function TrendLevelControl({
  trendLevel,
  onChange,
}: {
  trendLevel: PcTrendLevel;
  onChange: (trendLevel: PcTrendLevel) => void;
}) {
  return (
    <div className="inline-flex h-10 overflow-hidden rounded-lg border border-[#cfd7e3] bg-white shadow-[0_1px_3px_rgba(22,35,58,0.08)]">
      {TREND_LEVELS.map((level) => {
        const isActive = level.value === trendLevel;

        return (
          <button
            key={level.value}
            type="button"
            onClick={() => onChange(level.value)}
            className={`min-w-[4.75rem] px-3 text-sm font-semibold transition ${
              isActive
                ? "bg-[#184e8a] text-white"
                : "text-[#344054] hover:bg-[#f3f6fa]"
            }`}
            aria-pressed={isActive}
          >
            {level.label}
          </button>
        );
      })}
    </div>
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
