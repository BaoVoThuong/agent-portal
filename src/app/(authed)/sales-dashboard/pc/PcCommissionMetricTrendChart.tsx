"use client";

import { useState } from "react";

type CommissionTrendRow = {
  monthKey: string;
  periodKey: string;
  totalPremium: number;
  totalCommission: number;
  epsCommission: number;
  agentCommission: number;
};

type MetricKey = "totalCommission" | "epsCommission" | "agentCommission";
type TrendLevel = "month" | "quarter" | "year";

const METRICS: {
  barLabel: string;
  key: MetricKey;
  percentLabel: string;
  title: string;
}[] = [
  {
    barLabel: "Total Commission",
    key: "totalCommission",
    percentLabel: "Commission Rate",
    title: "Total Commission",
  },
  {
    barLabel: "EPS Commission",
    key: "epsCommission",
    percentLabel: "EPS Comm Rate",
    title: "EPS Commission",
  },
  {
    barLabel: "Agent Commission",
    key: "agentCommission",
    percentLabel: "Agent Comm Rate",
    title: "Agent Commission",
  },
];

export function PcCommissionMetricTrendChart({
  rows,
  trendLevel,
}: {
  rows: CommissionTrendRow[];
  trendLevel: TrendLevel;
}) {
  const [selectedMetric, setSelectedMetric] = useState<MetricKey>("totalCommission");
  const metric = METRICS.find((item) => item.key === selectedMetric) ?? METRICS[0];
  const periodLabel = getTrendLevelLabel(trendLevel);

  return (
    <section className="flex flex-col">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-bold leading-tight text-slate-800">
          Commission Trend by {periodLabel} | {metric.title}
        </h3>
        <div className="inline-flex overflow-hidden rounded-lg border border-[#cfd7e3] bg-white shadow-[0_1px_2px_rgba(22,35,58,0.08)]">
          {METRICS.map((item) => {
            const isActive = item.key === selectedMetric;

            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setSelectedMetric(item.key)}
                className={`h-8 px-3 text-xs font-semibold transition ${
                  isActive
                    ? "bg-[#184e8a] text-white"
                    : "text-[#344054] hover:bg-[#f3f6fa]"
                }`}
                aria-pressed={isActive}
              >
                {item.title}
              </button>
            );
          })}
        </div>
      </div>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-shadow duration-300 hover:shadow-md">
        {rows.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm font-medium text-slate-500">
            No commission trend data.
          </div>
        ) : (
          <CommissionTrendSvg metric={metric} periodLabel={periodLabel} rows={rows} />
        )}
      </div>
    </section>
  );
}

function CommissionTrendSvg({
  metric,
  periodLabel,
  rows,
}: {
  metric: (typeof METRICS)[number];
  periodLabel: string;
  rows: CommissionTrendRow[];
}) {
  const width = 1280;
  const height = 360;
  const left = 76;
  const right = 96;
  const top = 62;
  const bottom = 58;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const maxAmount = roundAxisMax(maxValue(rows, (row) => row[metric.key]));
  const maxRate = Math.max(
    10,
    roundAxisMax(maxValue(rows, (row) => percentOf(row[metric.key], row.totalPremium)))
  );
  const groupWidth = plotWidth / Math.max(rows.length, 1);
  const barWidth = Math.min(48, Math.max(20, groupWidth * 0.52));
  const points = rows.map((row, index) => {
    const amount = row[metric.key];
    const rate = percentOf(amount, row.totalPremium);
    const centerX = left + index * groupWidth + groupWidth / 2;
    const barHeight = (amount / maxAmount) * plotHeight;
    const barY = top + plotHeight - barHeight;
    const lineY = top + plotHeight - (rate / maxRate) * plotHeight;
    const amountLabelY = resolveAmountLabelY({
      barHeight,
      barY,
      lineY,
      plotBottom: top + plotHeight,
      plotTop: top,
    });

    return {
      ...row,
      amount,
      barHeight,
      barY,
      amountLabelY,
      centerX,
      lineY,
      rate,
    };
  });

  return (
    <div className="overflow-x-auto">
      <svg
        className="min-w-[1120px]"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${periodLabel} ${metric.title} trend`}
      >
        <g transform="translate(86, 22)">
          <rect width="34" height="14" fill="#d6d6d6" />
          <text x="44" y="13" className="fill-[#40444b] text-[14px] font-semibold">
            {metric.barLabel}
          </text>
          <line x1="236" x2="270" y1="8" y2="8" stroke="#d94242" strokeWidth="3" />
          <circle cx="253" cy="8" r="5" fill="#d94242" />
          <text x="280" y="13" className="fill-[#40444b] text-[14px] font-semibold">
            {metric.percentLabel}
          </text>
        </g>

        {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
          const y = top + plotHeight - tick * plotHeight;

          return (
            <g key={tick}>
              <line x1={left} x2={width - right} y1={y} y2={y} stroke="#d6d6d6" />
              <text x={left - 14} y={y + 5} textAnchor="end" className="fill-[#4a4f58] text-[12px]">
                {formatAxisMoney(maxAmount * tick)}
              </text>
              <text x={width - right + 14} y={y + 5} className="fill-[#4a4f58] text-[12px]">
                {formatPercent(maxRate * tick)}
              </text>
            </g>
          );
        })}

        {points.map((point) => (
          <g key={point.periodKey}>
            <rect
              fill="#d6d6d6"
              height={Math.max(point.barHeight, 2)}
              width={barWidth}
              x={point.centerX - barWidth / 2}
              y={point.barY}
            />
            <text
              x={point.centerX}
              y={point.amountLabelY}
              textAnchor="middle"
              className="fill-[#252a31] text-[13px] font-bold"
            >
              {formatCurrencyShort(point.amount)}
            </text>
            <text
              x={point.centerX}
              y={top + plotHeight + 28}
              textAnchor="middle"
              className="fill-[#3e444d] text-[12px] font-semibold"
            >
              {point.monthKey}
            </text>
          </g>
        ))}

        <path
          d={points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.centerX} ${point.lineY}`).join(" ")}
          fill="none"
          stroke="#d94242"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2.5"
        />

        {points.map((point) => (
          <g key={`${point.periodKey}-rate`}>
            <circle cx={point.centerX} cy={point.lineY} fill="#d94242" r="4" />
            <text
              x={point.centerX}
              y={point.lineY - 12}
              textAnchor="middle"
              className="fill-[#d94242] text-[12px] font-bold"
            >
              {formatPercent(point.rate)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function getTrendLevelLabel(trendLevel: TrendLevel) {
  if (trendLevel === "quarter") return "Quarter";
  if (trendLevel === "year") return "Year";
  return "Month";
}

function resolveAmountLabelY({
  barHeight,
  barY,
  lineY,
  plotBottom,
  plotTop,
}: {
  barHeight: number;
  barY: number;
  lineY: number;
  plotBottom: number;
  plotTop: number;
}) {
  const outsideY = Math.max(barY - 9, plotTop + 16);

  if (Math.abs(outsideY - lineY) >= 18) return outsideY;
  if (barHeight >= 34) return Math.min(barY + 24, plotBottom - 8);

  return Math.max(lineY + 20, plotTop + 16);
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

function percentOf(value: number, total: number) {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total === 0) return 0;

  return (value / total) * 100;
}

function formatCurrencyShort(value: number) {
  const absValue = Math.abs(value);
  const sign = value < 0 ? "-" : "";

  if (absValue >= 1000000) {
    return `${sign}$${new Intl.NumberFormat("en-US", {
      maximumFractionDigits: 2,
      minimumFractionDigits: 0,
    }).format(absValue / 1000000)}M`;
  }

  if (absValue >= 1000) {
    return `${sign}$${new Intl.NumberFormat("en-US", {
      maximumFractionDigits: 1,
      minimumFractionDigits: 0,
    }).format(absValue / 1000)}K`;
  }

  return `${sign}${new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: absValue >= 1000 ? 0 : 2,
    minimumFractionDigits: 0,
    style: "currency",
  }).format(absValue)}`;
}

function formatAxisMoney(value: number) {
  if (value >= 1000000) return `${formatInteger(value / 1000000)}M`;
  if (value >= 1000) return `${formatInteger(value / 1000)}K`;

  return formatInteger(value);
}

function formatInteger(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatPercent(value: number) {
  return `${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: Math.abs(value) >= 10 ? 1 : 0,
  }).format(value)}%`;
}
