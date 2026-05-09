"use client";

import { useMemo, useState } from "react";

type PerformanceMonth = {
  reportMonth: string;
  policyCount: number;
  clientCount: number;
  agentReceived: number;
};

const WIDTH = 1120;
const HEIGHT = 460;
const LEFT = 78;
const RIGHT = 92;
const TOP = 78;
const BOTTOM = 64;
const PLOT_WIDTH = WIDTH - LEFT - RIGHT;
const PLOT_HEIGHT = HEIGHT - TOP - BOTTOM;
const GRID_TICKS = [0, 0.25, 0.5, 0.75, 1];
const LABEL_GAP = 20;

export function PerformanceChart({ months }: { months: PerformanceMonth[] }) {
  const [activeIndex, setActiveIndex] = useState(0);

  const chart = useMemo(() => {
    const maxMoney = roundAxisMax(
      Math.max(...months.map((month) => Math.max(month.agentReceived, 0)), 1)
    );
    const maxCount = roundAxisMax(
      Math.max(
        ...months.map((month) => Math.max(month.policyCount, month.clientCount)),
        1
      )
    );
    const groupWidth = PLOT_WIDTH / Math.max(months.length, 1);
    const barWidth = Math.min(56, Math.max(34, groupWidth * 0.58));
    const points = months.map((month, index) => {
      const centerX = LEFT + index * groupWidth + groupWidth / 2;
      const moneyHeight = (Math.max(month.agentReceived, 0) / maxMoney) * PLOT_HEIGHT;
      const policyY = countToY(month.policyCount, maxCount);
      const clientY = countToY(month.clientCount, maxCount);
      const labelYs = resolveLineLabelYs(policyY, clientY);

      return {
        ...month,
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
  }, [months]);

  if (months.length === 0) {
    return (
      <section className="rounded-lg border border-[#d8dee7] bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold text-[#16233a]">
          Revenue vs Agent Earnings by Month | Trend Comparison
        </h2>
        <div className="mt-6 rounded-lg border border-dashed border-[#d8dee7] px-6 py-12 text-center text-sm text-[#667085]">
          No report months with more than 100 active policies.
        </div>
      </section>
    );
  }

  const activePoint = chart.points[activeIndex] ?? chart.points[0];
  const tooltipLeft = Math.min(
    Math.max(activePoint.centerX - 148, LEFT),
    WIDTH - RIGHT - 296
  );
  const tooltipTop =
    activePoint.moneyY > TOP + PLOT_HEIGHT * 0.45
      ? activePoint.moneyY - 150
      : activePoint.moneyY + 22;

  return (
    <section>
      <h2 className="mb-3 text-2xl font-semibold text-[#24272d]">
        Revenue vs Agent Earnings by Month | Trend Comparison
      </h2>

      <div className="rounded-lg border border-[#d1d5db] bg-white p-5 shadow-[0_2px_8px_rgba(22,35,58,0.18)]">
        <div className="overflow-x-auto">
          <div className="relative min-w-[980px]">
            <div
              className="pointer-events-none absolute z-10 w-[296px] rounded border border-[#d1d5db] bg-white px-4 py-3 text-xs shadow-[0_6px_18px_rgba(22,35,58,0.24)]"
              style={{ left: tooltipLeft, top: tooltipTop }}
            >
              <div className="mb-3 font-semibold text-[#24272d]">
                {formatDateLabel(activePoint.reportMonth)}
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

            <svg
              viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
              role="img"
              aria-label="Revenue, policies, and clients trend comparison by month"
            >
              <g transform={`translate(${LEFT}, 20)`}>
                <LegendSwatch color="#d9d9d9" x={0} label="Agent Received" />
                <LegendLine color="#2f80ed" x={192} label="# Policies" />
                <LegendLine color="#ff3b30" x={332} label="# Clients" />
              </g>

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

              <text
                x={22}
                y={TOP + PLOT_HEIGHT / 2}
                textAnchor="middle"
                transform={`rotate(-90 22 ${TOP + PLOT_HEIGHT / 2})`}
                className="fill-[#24272d] text-[14px]"
              >
                Agent Received
              </text>
              <text
                x={WIDTH - 22}
                y={TOP + PLOT_HEIGHT / 2}
                textAnchor="middle"
                transform={`rotate(-90 ${WIDTH - 22} ${TOP + PLOT_HEIGHT / 2})`}
                className="fill-[#24272d] text-[14px]"
              >
                # Policies | # Clients
              </text>

              {chart.points.map((point, index) => {
                const isActive = index === activeIndex;
                const barX = point.centerX - chart.barWidth / 2;
                const barLabelY = Math.max(point.moneyY - 14, TOP + 18);

                return (
                  <g
                    key={point.reportMonth}
                    className="cursor-pointer outline-none"
                    onMouseEnter={() => setActiveIndex(index)}
                    onFocus={() => setActiveIndex(index)}
                    onClick={() => setActiveIndex(index)}
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
                      y={TOP + PLOT_HEIGHT + 28}
                      textAnchor="middle"
                      className="fill-[#3f444b] text-[13px]"
                    >
                      {formatDateLabel(point.reportMonth)}
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
                    key={`${point.reportMonth}-lines`}
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
                      className="fill-[#2f80ed] text-[14px] font-semibold"
                    >
                      {formatInteger(point.policyCount)}
                    </text>
                    <text
                      x={point.centerX}
                      y={point.clientLabelY}
                      textAnchor="middle"
                      className="fill-[#ff3b30] text-[14px] font-semibold"
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

function formatDateLabel(value: string) {
  return value.slice(0, 7);
}
