"use client";

import { useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

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
const WIDTH = 1280;
const HEIGHT = 410;
const LEFT = 76;
const RIGHT = 116;
const TOP = 70;
const BOTTOM = 58;
const RIGHT_AXIS_LABEL_X = WIDTH - 36;
const GRID_TICKS = [0, 0.25, 0.5, 0.75, 1];

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
  const chartLevelLabel = getChartLevelLabel(chartLevel);

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
    <section className="flex flex-col">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-bold leading-tight text-slate-800">
          Revenue vs Agent Earnings by {chartLevelLabel} | Trend Comparison
        </h3>
        <div className="inline-flex overflow-hidden rounded-lg border border-[#cfd7e3] bg-white shadow-[0_1px_2px_rgba(22,35,58,0.08)]">
          {CHART_LEVELS.map((level) => {
            const isActive = level.value === chartLevel;

            return (
              <button
                key={level.value}
                type="button"
                onClick={() => updateChartLevel(level.value)}
                className={`h-8 px-3 text-xs font-semibold transition ${
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
      </div>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-shadow duration-300 hover:shadow-md">
        {rows.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm font-medium text-slate-500">
            No trend data with more than 100 policies.
          </div>
        ) : (
          <TrendChartSvg rows={rows} />
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

function TrendChartSvg({ rows }: { rows: TrendComparisonPeriod[] }) {
  const plotWidth = WIDTH - LEFT - RIGHT;
  const plotHeight = HEIGHT - TOP - BOTTOM;
  const maxMoney = roundAxisMax(maxValue(rows, (row) => row.totalMesserPaid));
  const maxCount = roundAxisMax(
    maxValue(rows, (row) => Math.max(row.policyCount, row.clientCount))
  );
  const groupWidth = plotWidth / Math.max(rows.length, 1);
  const barWidth = Math.min(54, Math.max(26, groupWidth * 0.52));
  const points = rows.map((row, index) => {
    const centerX = LEFT + index * groupWidth + groupWidth / 2;
    const moneyHeight = (row.totalMesserPaid / maxMoney) * plotHeight;
    const policyY = TOP + plotHeight - (row.policyCount / maxCount) * plotHeight;
    const clientY = TOP + plotHeight - (row.clientCount / maxCount) * plotHeight;

    return {
      ...row,
      centerX,
      moneyHeight,
      moneyY: TOP + plotHeight - moneyHeight,
      policyY,
      clientY,
    };
  });

  return (
    <div className="overflow-x-auto">
      <svg
        className="min-w-[1120px]"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label="Revenue, policies, and clients by period"
      >
        <g transform="translate(78, 22)">
          <rect width="34" height="14" fill="#d6d6d6" />
          <text x="44" y="13" className="fill-[#40444b] text-[15px] font-semibold">
            Total Messer Paid
          </text>
          <line x1="210" x2="244" y1="8" y2="8" stroke="#4186f5" strokeWidth="3" />
          <circle cx="227" cy="8" r="5" fill="#4186f5" />
          <text x="254" y="13" className="fill-[#40444b] text-[15px] font-semibold">
            # Policies
          </text>
          <line x1="372" x2="406" y1="8" y2="8" stroke="#ff453f" strokeWidth="3" />
          <circle cx="389" cy="8" r="5" fill="#ff453f" />
          <text x="416" y="13" className="fill-[#40444b] text-[15px] font-semibold">
            # Clients
          </text>
        </g>

        {GRID_TICKS.map((tick) => {
          const y = TOP + plotHeight - tick * plotHeight;

          return (
            <g key={tick}>
              <line
                x1={LEFT}
                x2={WIDTH - RIGHT}
                y1={y}
                y2={y}
                stroke="#d6d6d6"
                strokeWidth="1"
              />
              <text
                x={LEFT - 14}
                y={y + 5}
                textAnchor="end"
                className="fill-[#4a4f58] text-[13px]"
              >
                {formatAxisNumber(maxMoney * tick)}
              </text>
              <text x={WIDTH - RIGHT + 16} y={y + 5} className="fill-[#4a4f58] text-[13px]">
                {formatAxisNumber(maxCount * tick)}
              </text>
            </g>
          );
        })}

        <text
          x={22}
          y={TOP + plotHeight / 2}
          textAnchor="middle"
          transform={`rotate(-90 22 ${TOP + plotHeight / 2})`}
          className="fill-[#4d545f] text-[13px] font-semibold"
        >
          Total Messer Paid
        </text>
        <text
          x={RIGHT_AXIS_LABEL_X}
          y={TOP + plotHeight / 2}
          textAnchor="middle"
          transform={`rotate(-90 ${RIGHT_AXIS_LABEL_X} ${TOP + plotHeight / 2})`}
          className="fill-[#4d545f] text-[13px] font-semibold"
        >
          # Policies | # Clients
        </text>

        {points.map((point) => (
          <g key={point.periodKey}>
            <rect
              x={point.centerX - barWidth / 2}
              y={point.moneyY}
              width={barWidth}
              height={Math.max(point.moneyHeight, 2)}
              fill="#d6d6d6"
            />
            <text
              x={point.centerX}
              y={Math.max(point.moneyY - 14, TOP + 14)}
              textAnchor="middle"
              className="fill-[#20242b] text-[15px] font-bold"
            >
              {formatCurrencyShort(point.totalMesserPaid)}
            </text>
            <text
              x={point.centerX}
              y={TOP + plotHeight + 30}
              textAnchor="middle"
              className="fill-[#3e444d] text-[13px] font-semibold"
            >
              {point.periodLabel}
            </text>
          </g>
        ))}

        <path
          d={points
            .map((point, index) => `${index === 0 ? "M" : "L"} ${point.centerX} ${point.policyY}`)
            .join(" ")}
          fill="none"
          stroke="#4186f5"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="3"
        />
        <path
          d={points
            .map((point, index) => `${index === 0 ? "M" : "L"} ${point.centerX} ${point.clientY}`)
            .join(" ")}
          fill="none"
          stroke="#ff453f"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="3"
        />

        {points.map((point) => (
          <g key={`${point.periodKey}-points`}>
            <circle cx={point.centerX} cy={point.policyY} r="5" fill="#4186f5" />
            <text
              x={point.centerX}
              y={point.policyY + 24}
              textAnchor="middle"
              className="fill-[#4186f5] text-[15px] font-bold"
            >
              {formatInteger(point.policyCount)}
            </text>
            <circle cx={point.centerX} cy={point.clientY} r="5" fill="#ff453f" />
            <text
              x={point.centerX}
              y={point.clientY - 14}
              textAnchor="middle"
              className="fill-[#ff453f] text-[15px] font-bold"
            >
              {formatInteger(point.clientCount)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function parseChartLevel(value: string | null): TrendComparisonChartLevel {
  return value === "quarter" || value === "year" ? value : "month";
}

function getChartLevelLabel(chartLevel: TrendComparisonChartLevel) {
  return CHART_LEVELS.find((level) => level.value === chartLevel)?.label ?? "Month";
}

function maxValue<T>(rows: T[], getValue: (row: T) => number) {
  if (rows.length === 0) return 1;

  return Math.max(...rows.map((row) => Math.max(getValue(row), 0)), 1);
}

function roundAxisMax(value: number) {
  if (value <= 10) return 10;

  const magnitude = 10 ** Math.floor(Math.log10(value));

  return Math.ceil(value / magnitude) * magnitude;
}

function formatInteger(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2,
    minimumFractionDigits: 0,
    style: "currency",
  }).format(value);
}

function formatCurrencyShort(value: number) {
  const absValue = Math.abs(value);

  if (absValue >= 1000000) {
    return `$${new Intl.NumberFormat("en-US", {
      maximumFractionDigits: 2,
      minimumFractionDigits: 0,
    }).format(value / 1000000)}M`;
  }

  if (absValue >= 1000) {
    return `$${new Intl.NumberFormat("en-US", {
      maximumFractionDigits: 2,
      minimumFractionDigits: 0,
    }).format(value / 1000)}K`;
  }

  return formatCurrency(value);
}

function formatAxisNumber(value: number) {
  if (value >= 1000) return `${formatInteger(value / 1000)}K`;

  return formatInteger(value);
}
