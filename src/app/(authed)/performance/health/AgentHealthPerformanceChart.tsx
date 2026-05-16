"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import type { MouseEvent } from "react";

type ChartLevel = "month" | "quarter" | "year";

type PerformancePeriod = {
  periodKey: string;
  periodLabel: string;
  policyCount: number;
  clientCount: number;
  agentReceived: number;
};

type PeriodsByLevel = Record<ChartLevel, PerformancePeriod[]>;

const WIDTH = 1120;
const HEIGHT = 360;
const LEFT = 96;
const RIGHT = 112;
const TOP = 52;
const BOTTOM = 48;
const PLOT_WIDTH = WIDTH - LEFT - RIGHT;
const PLOT_HEIGHT = HEIGHT - TOP - BOTTOM;
const GRID_TICKS = [0, 0.25, 0.5, 0.75, 1];
const LABEL_GAP = 20;
const CHART_LEVELS: { value: ChartLevel; label: string }[] = [
  { value: "month", label: "Month" },
  { value: "quarter", label: "Quarter" },
  { value: "year", label: "Year" },
];

export function AgentHealthPerformanceChart({
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
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState({ left: 0, top: 0 });
  const chartLevel =
    chartState.initialChartLevel === initialChartLevel
      ? chartState.chartLevel
      : initialChartLevel;
  const periods = periodsByLevel[chartLevel];

  const chart = useMemo(() => {
    const maxMoney = roundAxisMax(
      Math.max(...periods.map((period) => Math.max(period.agentReceived, 0)), 1)
    );
    const maxCount = roundAxisMax(
      Math.max(
        ...periods.map((period) =>
          Math.max(period.policyCount, period.clientCount)
        ),
        1
      ) + 200
    );
    const groupWidth = PLOT_WIDTH / Math.max(periods.length, 1);
    const barWidth = Math.min(56, Math.max(34, groupWidth * 0.58));
    const points = periods.map((period, index) => {
      const centerX = LEFT + index * groupWidth + groupWidth / 2;
      const moneyHeight =
        (Math.max(period.agentReceived, 0) / maxMoney) * PLOT_HEIGHT;
      const policyY = countToY(period.policyCount, maxCount);
      const clientY = countToY(period.clientCount, maxCount);
      const labelYs = resolveLineLabelYs(policyY, clientY);

      return {
        ...period,
        centerX,
        moneyHeight,
        moneyY: TOP + PLOT_HEIGHT - moneyHeight,
        policyY,
        clientY,
        policyLabelY: labelYs.policy,
        clientLabelY: labelYs.client,
      };
    });

    return {
      maxMoney,
      maxCount,
      groupWidth,
      barWidth,
      points,
      policyPath: points
        .map((point, index) => pathPoint(index, point.centerX, point.policyY))
        .join(" "),
      clientPath: points
        .map((point, index) => pathPoint(index, point.centerX, point.clientY))
        .join(" "),
    };
  }, [periods]);

  function updateChartLevel(nextChartLevel: ChartLevel) {
    if (nextChartLevel === chartLevel) return;

    setChartState({ initialChartLevel, chartLevel: nextChartLevel });
    setActiveIndex(null);

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

  if (periods.length === 0) {
    return (
      <section className="rounded-lg border border-[#d8dee7] bg-white p-6 shadow-sm">
        <ChartHeader
          chartLevel={chartLevel}
          onChartLevelChange={updateChartLevel}
        />
        <div className="mt-6 rounded-lg border border-dashed border-[#d8dee7] px-6 py-12 text-center text-sm text-[#667085]">
          No report periods with more than 100 active policies.
        </div>
      </section>
    );
  }

  const activePoint =
    activeIndex === null ? null : chart.points[activeIndex] ?? null;

  function updateTooltipPosition(event: MouseEvent<HTMLDivElement>) {
    if (activeIndex === null) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const left = event.clientX - rect.left + 14;
    const top = event.clientY - rect.top + 14;

    setTooltipPosition({
      left: clamp(left, 8, rect.width - 304),
      top: clamp(top, 8, rect.height - 132),
    });
  }

  return (
    <section>
      <ChartHeader
        chartLevel={chartLevel}
        onChartLevelChange={updateChartLevel}
      />

      <div className="rounded-lg border border-[#d1d5db] bg-white p-3 shadow-[0_2px_8px_rgba(22,35,58,0.18)]">
        <div className="overflow-x-auto">
          <div
            className="relative min-w-[980px]"
            onMouseMove={updateTooltipPosition}
            onMouseLeave={() => setActiveIndex(null)}
          >
            {activePoint ? (
              <div
                className="pointer-events-none absolute z-10 w-[296px] rounded border border-[#d1d5db] bg-white px-4 py-3 text-xs shadow-[0_6px_18px_rgba(22,35,58,0.24)]"
                style={{
                  left: tooltipPosition.left,
                  top: tooltipPosition.top,
                }}
              >
                <div className="mb-3 font-semibold text-[#24272d]">
                  {activePoint.periodLabel}
                </div>
                <TooltipRow
                  color="#d9d9d9"
                  label="Agent Received"
                  value={formatCurrency(activePoint.agentReceived)}
                />
                <TooltipRow
                  color="#2f80ed"
                  label="# Policies"
                  value={formatInteger(activePoint.policyCount)}
                />
                <TooltipRow
                  color="#ff3b30"
                  label="# Clients"
                  value={formatInteger(activePoint.clientCount)}
                />
              </div>
            ) : null}

            <svg
              viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
              role="img"
              aria-label="Revenue, policies, and clients trend comparison by period"
            >
              <g transform={`translate(${LEFT}, 14)`}>
                <LegendSwatch color="#d9d9d9" x={0} label="Agent Received" />
                <LegendLine color="#2f80ed" x={192} label="# Policies" />
                <LegendLine color="#ff3b30" x={332} label="# Clients" />
              </g>

              <text
                x={22}
                y={TOP + PLOT_HEIGHT / 2}
                textAnchor="middle"
                transform={`rotate(-90 22 ${TOP + PLOT_HEIGHT / 2})`}
                className="fill-[#667085] text-[12px] font-semibold"
              >
                Agent Received
              </text>
              <text
                x={WIDTH - 22}
                y={TOP + PLOT_HEIGHT / 2}
                textAnchor="middle"
                transform={`rotate(-90 ${WIDTH - 22} ${TOP + PLOT_HEIGHT / 2})`}
                className="fill-[#667085] text-[12px] font-semibold"
              >
                Policies / Clients
              </text>

              {GRID_TICKS.map((tick) => {
                const y = TOP + PLOT_HEIGHT - tick * PLOT_HEIGHT;
                return (
                  <g key={tick}>
                    <line
                      x1={LEFT}
                      x2={WIDTH - RIGHT}
                      y1={y}
                      y2={y}
                      stroke={tick === 0 ? "#b6b6b6" : "#d8d8d8"}
                      strokeWidth={tick === 0 ? 1.4 : 1}
                    />
                    <text
                      x={LEFT - 16}
                      y={y + 5}
                      textAnchor="end"
                      className="fill-[#3f444b] text-[13px]"
                    >
                      {formatAxisNumber(chart.maxMoney * tick)}
                    </text>
                    <text
                      x={WIDTH - RIGHT + 12}
                      y={y + 5}
                      textAnchor="start"
                      className="fill-[#3f444b] text-[13px]"
                    >
                      {formatCompactCount(chart.maxCount * tick)}
                    </text>
                  </g>
                );
              })}

              {chart.points.map((point, index) => {
                const isActive = index === activeIndex;
                const barX = point.centerX - chart.barWidth / 2;
                const barLabelY = Math.max(point.moneyY - 14, TOP + 18);

                return (
                  <g
                    key={point.periodKey}
                    className="cursor-pointer outline-none"
                    onMouseEnter={() => setActiveIndex(index)}
                    onFocus={() => setActiveIndex(index)}
                    onClick={() => setActiveIndex(index)}
                    onBlur={() => setActiveIndex(null)}
                    tabIndex={0}
                  >
                    <rect
                      x={point.centerX - chart.groupWidth / 2}
                      y={TOP}
                      width={chart.groupWidth}
                      height={PLOT_HEIGHT + 40}
                      fill="transparent"
                    />
                    <line
                      x1={point.centerX}
                      x2={point.centerX}
                      y1={TOP}
                      y2={TOP + PLOT_HEIGHT}
                      stroke={isActive ? "#9a9a9a" : "transparent"}
                      strokeWidth="1.2"
                    />
                    <rect
                      x={barX}
                      y={point.moneyY}
                      width={chart.barWidth}
                      height={Math.max(point.moneyHeight, 2)}
                      fill="#d9d9d9"
                      stroke={isActive ? "#b8b8b8" : "transparent"}
                      strokeWidth="1.2"
                    />
                    <text
                      x={point.centerX}
                      y={barLabelY}
                      textAnchor="middle"
                      className="fill-[#111827] text-[15px] font-semibold"
                    >
                      {formatCurrencyK(point.agentReceived)}
                    </text>
                    <text
                      x={point.centerX}
                      y={TOP + PLOT_HEIGHT + 24}
                      textAnchor="middle"
                      className="fill-[#3f444b] text-[13px]"
                    >
                      {point.periodLabel}
                    </text>
                  </g>
                );
              })}

              <path
                d={chart.policyPath}
                fill="none"
                stroke="#2f80ed"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
              />
              <path
                d={chart.clientPath}
                fill="none"
                stroke="#ff3b30"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
              />

              {chart.points.map((point, index) => {
                const isActive = index === activeIndex;
                return (
                  <g
                    key={`${point.periodKey}-lines`}
                    className="cursor-pointer"
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => setActiveIndex(index)}
                  >
                    <circle
                      cx={point.centerX}
                      cy={point.policyY}
                      r={isActive ? 6 : 4}
                      fill="#2f80ed"
                      stroke={isActive ? "#225ea8" : "#2f80ed"}
                      strokeWidth="1.5"
                    />
                    <circle
                      cx={point.centerX}
                      cy={point.clientY}
                      r={isActive ? 6 : 4}
                      fill="#ff3b30"
                      stroke={isActive ? "#b42318" : "#ff3b30"}
                      strokeWidth="1.5"
                    />
                    <text
                      x={point.centerX}
                      y={point.policyLabelY}
                      textAnchor="middle"
                      className="fill-[#2f80ed] text-[12px] font-semibold"
                    >
                      {formatInteger(point.policyCount)}
                    </text>
                    <text
                      x={point.centerX}
                      y={point.clientLabelY}
                      textAnchor="middle"
                      className="fill-[#ff3b30] text-[12px] font-semibold"
                    >
                      {formatInteger(point.clientCount)}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
      </div>
    </section>
  );
}

function countToY(value: number, maxCount: number) {
  return TOP + PLOT_HEIGHT - (value / maxCount) * PLOT_HEIGHT;
}

function ChartHeader({
  chartLevel,
  onChartLevelChange,
}: {
  chartLevel: ChartLevel;
  onChartLevelChange: (chartLevel: ChartLevel) => void;
}) {
  return (
    <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-xl font-semibold text-[#24272d]">
        Revenue vs Agent Earnings by {getChartLevelLabel(chartLevel)} | Trend
        Comparison
      </h2>
      <div className="inline-flex overflow-hidden rounded-lg border border-[#cfd7e3] bg-white shadow-[0_1px_2px_rgba(22,35,58,0.08)]">
        {CHART_LEVELS.map((level) => {
          const isActive = level.value === chartLevel;

          return (
            <button
              key={level.value}
              type="button"
              onClick={() => onChartLevelChange(level.value)}
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
  );
}

function getChartLevelLabel(chartLevel: ChartLevel) {
  return CHART_LEVELS.find((level) => level.value === chartLevel)?.label ?? "Month";
}

function resolveLineLabelYs(policyY: number, clientY: number) {
  let policy = policyY - 16;
  let client = clientY - 16;

  if (Math.abs(policy - client) < LABEL_GAP) {
    if (policyY < clientY) {
      policy = policyY - 20;
      client = clientY + 22;
    } else {
      policy = policyY + 22;
      client = clientY - 20;
    }
  }

  return {
    policy: clamp(policy, TOP + 14, TOP + PLOT_HEIGHT - 8),
    client: clamp(client, TOP + 14, TOP + PLOT_HEIGHT - 8),
  };
}

function pathPoint(index: number, x: number, y: number) {
  return `${index === 0 ? "M" : "L"} ${x} ${y}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function roundAxisMax(value: number) {
  if (value <= 10) return 10;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / magnitude) * magnitude;
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

function LegendSwatch({
  color,
  x,
  label,
}: {
  color: string;
  x: number;
  label: string;
}) {
  return (
    <g transform={`translate(${x}, 0)`}>
      <rect x={0} y={0} width={32} height={15} rx={2} fill={color} />
      <text x={42} y={13} className="fill-[#24272d] text-[15px] font-semibold">
        {label}
      </text>
    </g>
  );
}

function LegendLine({
  color,
  x,
  label,
}: {
  color: string;
  x: number;
  label: string;
}) {
  return (
    <g transform={`translate(${x}, 0)`}>
      <line x1={0} x2={30} y1={8} y2={8} stroke={color} strokeWidth={2} />
      <circle cx={15} cy={8} r={5} fill={color} />
      <text x={42} y={13} className="fill-[#24272d] text-[15px] font-semibold">
        {label}
      </text>
    </g>
  );
}

function formatInteger(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatCurrencyK(value: number) {
  const amount = value / 1000;
  return `$${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: amount >= 10 ? 2 : 1,
  }).format(amount)}K`;
}

function formatAxisNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(value);
}

function formatCompactCount(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: value >= 1000 ? 1 : 0,
    notation: "compact",
  })
    .format(value)
    .toUpperCase();
}
