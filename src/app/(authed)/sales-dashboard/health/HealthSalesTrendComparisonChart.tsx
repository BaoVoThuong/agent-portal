"use client";

import { useState } from "react";
import type { MouseEvent } from "react";
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
const TOOLTIP_WIDTH = 296;
const TOOLTIP_HEIGHT = 132;
const TOOLTIP_GAP = 16;

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
          Carrier Paid &amp; Agent Commission by {chartLevelLabel} | Trend
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
            No trend data matched these filters.
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
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState({ left: 0, top: 0 });
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
  const activePoint =
    activeIndex === null ? null : points[activeIndex] ?? null;

  function updateTooltipPosition(event: MouseEvent<HTMLDivElement>) {
    if (activeIndex === null) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const cursorX = event.clientX - rect.left;
    const cursorY = event.clientY - rect.top;
    const hasRoomOnRight =
      cursorX + TOOLTIP_GAP + TOOLTIP_WIDTH <= rect.width - 8;
    const left = hasRoomOnRight
      ? cursorX + TOOLTIP_GAP
      : cursorX - TOOLTIP_WIDTH - TOOLTIP_GAP;
    const top = cursorY + TOOLTIP_GAP;

    setTooltipPosition({
      left: clamp(left, 8, rect.width - TOOLTIP_WIDTH - 8),
      top: clamp(top, 8, rect.height - TOOLTIP_HEIGHT - 8),
    });
  }

  return (
    <div className="overflow-x-auto overflow-y-visible">
      <div
        className="relative min-w-[1120px]"
        onMouseLeave={() => setActiveIndex(null)}
        onMouseMove={updateTooltipPosition}
      >
        {activePoint ? (
          <div
            className="pointer-events-none absolute z-10 w-[296px] rounded-lg border border-[#d8dee7] bg-white px-4 py-3 text-xs shadow-[0_6px_18px_rgba(22,35,58,0.16)]"
            style={{
              left: tooltipPosition.left,
              top: tooltipPosition.top,
            }}
          >
            <div className="mb-3 font-semibold text-[#24272d]">
              {activePoint.periodLabel}
            </div>
            <TooltipRow
              color="#d6d6d6"
              label="Carrier Paid"
              value={formatCurrency(activePoint.totalMesserPaid)}
            />
            <TooltipRow
              color="#4186f5"
              label="Policies"
              value={formatInteger(activePoint.policyCount)}
            />
            <TooltipRow
              color="#ff453f"
              label="Clients"
              value={formatInteger(activePoint.clientCount)}
            />
          </div>
        ) : null}

        <svg
          className="block w-full"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label="Carrier paid, policies, and clients trend by period"
        >
        <g transform="translate(78, 22)">
          <rect width="34" height="14" fill="#d6d6d6" />
          <text x="44" y="13" className="fill-[#40444b] text-[15px] font-semibold">
            Carrier Paid
          </text>
          <line x1="210" x2="244" y1="8" y2="8" stroke="#4186f5" strokeWidth="3" />
          <circle cx="227" cy="8" r="5" fill="#4186f5" />
          <text x="254" y="13" className="fill-[#40444b] text-[15px] font-semibold">
            Policies
          </text>
          <line x1="352" x2="386" y1="8" y2="8" stroke="#ff453f" strokeWidth="3" />
          <circle cx="369" cy="8" r="5" fill="#ff453f" />
          <text x="396" y="13" className="fill-[#40444b] text-[15px] font-semibold">
            Clients
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
          Carrier Paid
        </text>
        <text
          x={RIGHT_AXIS_LABEL_X}
          y={TOP + plotHeight / 2}
          textAnchor="middle"
          transform={`rotate(-90 ${RIGHT_AXIS_LABEL_X} ${TOP + plotHeight / 2})`}
          className="fill-[#4d545f] text-[13px] font-semibold"
        >
          Policies &amp; Clients
        </text>

        {points.map((point, index) => {
          const isActive = activeIndex === index;

          return (
            <g
              key={point.periodKey}
              className="cursor-pointer outline-none"
              onBlur={() => setActiveIndex(null)}
              onClick={() => setActiveIndex(index)}
              onFocus={() => setActiveIndex(index)}
              onMouseEnter={() => setActiveIndex(index)}
              tabIndex={0}
            >
              <rect
                x={point.centerX - groupWidth / 2}
                y={TOP}
                width={groupWidth}
                height={plotHeight + 48}
                fill="transparent"
              />
              <line
                x1={point.centerX}
                x2={point.centerX}
                y1={TOP}
                y2={TOP + plotHeight}
                stroke={isActive ? "#9a9a9a" : "transparent"}
                strokeWidth="1.2"
              />
              <rect
                x={point.centerX - barWidth / 2}
                y={point.moneyY}
                width={barWidth}
                height={Math.max(point.moneyHeight, 2)}
                fill="#d6d6d6"
                stroke={isActive ? "#b8b8b8" : "transparent"}
                strokeWidth="1.2"
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
          );
        })}

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

        {points.map((point, index) => {
          const isActive = activeIndex === index;

          return (
            <g
              key={`${point.periodKey}-points`}
              className="cursor-pointer"
              onClick={() => setActiveIndex(index)}
              onMouseEnter={() => setActiveIndex(index)}
            >
              <circle
                cx={point.centerX}
                cy={point.policyY}
                r={isActive ? 6 : 5}
                fill="#4186f5"
                stroke={isActive ? "#225ea8" : "#4186f5"}
                strokeWidth="1.5"
              />
              <text
                x={point.centerX}
                y={point.policyY + 24}
                textAnchor="middle"
                className="fill-[#4186f5] text-[15px] font-bold"
              >
                {formatInteger(point.policyCount)}
              </text>
              <circle
                cx={point.centerX}
                cy={point.clientY}
                r={isActive ? 6 : 5}
                fill="#ff453f"
                stroke={isActive ? "#b42318" : "#ff453f"}
                strokeWidth="1.5"
              />
              <text
                x={point.centerX}
                y={point.clientY - 14}
                textAnchor="middle"
                className="fill-[#ff453f] text-[15px] font-bold"
              >
                {formatInteger(point.clientCount)}
              </text>
            </g>
          );
        })}
        </svg>
      </div>
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

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function TooltipRow({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value: string;
}) {
  return (
    <div className="grid grid-cols-[20px_1fr_auto] items-center gap-2 py-1">
      <span className="h-3 w-4 rounded-sm" style={{ backgroundColor: color }} />
      <span className="text-[#3f444b]">{label}</span>
      <span className="font-semibold text-[#24272d]">{value}</span>
    </div>
  );
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
