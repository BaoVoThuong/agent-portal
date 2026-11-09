"use client";

import { useMemo, type ReactNode } from "react";
import {
  buildPcLineRows,
  buildPcScoreCards,
  percentOf,
  type PcChangeMetric,
  type PcLineRow,
  type PcLineSourceRow,
} from "./pc-line-of-service";

type Audience = "company" | "agent";
type HeatMode = "blue" | "lavender" | "pink" | "magenta";

// Khung cao vừa 5 line, line thứ 6 trở đi cuộn bên trong.
const LINE_VISIBLE_ROW_COUNT = 5;
const LINE_HEADER_HEIGHT_PX = 54;
const LINE_ROW_HEIGHT_PX = 46;
const LINE_TABLE_MAX_HEIGHT =
  LINE_HEADER_HEIGHT_PX + LINE_VISIBLE_ROW_COUNT * LINE_ROW_HEIGHT_PX;

export function PcScoreCards({
  rows,
  showPremiumPerPolicy,
}: {
  rows: PcLineSourceRow[];
  showPremiumPerPolicy: boolean;
}) {
  const cards = useMemo(() => buildPcScoreCards(rows), [rows]);
  const monthLabel = cards.latestMonthKey
    ? formatMonthKey(cards.latestMonthKey)
    : "";

  return (
    <section
      className={`grid gap-8 max-md:grid-cols-2 max-md:gap-2 md:grid-cols-3 xl:gap-4 ${
        showPremiumPerPolicy ? "xl:grid-cols-6" : "xl:grid-cols-5"
      }`}
    >
      <ScoreCard
        footerText={formatChangeFooter(cards.newBusiness, monthLabel)}
        label="New Business"
        value={formatInteger(cards.newBusiness.total)}
      />
      <ScoreCard
        footerText={formatChangeFooter(cards.renewals, monthLabel)}
        label="Renewals"
        value={formatInteger(cards.renewals.total)}
      />
      <ScoreCard
        footerText={formatChangeFooter(cards.cancellations, monthLabel)}
        label="Cancellation"
        value={formatInteger(cards.cancellations.total)}
      />
      {showPremiumPerPolicy ? (
        <ScoreCard
          footerText={`${formatCurrencyShort(cards.premiumPerPolicy.latest)} in ${monthLabel}`}
          label="Premium per Policy"
          value={formatCurrencyShort(cards.premiumPerPolicy.total)}
        />
      ) : null}
      <ScoreCard
        footerText={`${formatInteger(cards.carriers.latest)} in ${monthLabel}`}
        label="Carrier"
        value={formatInteger(cards.carriers.total)}
      />
      <ScoreCard
        footerText={`${formatInteger(cards.lines.latest)} in ${monthLabel}`}
        label="Line of Service"
        value={formatInteger(cards.lines.total)}
      />
    </section>
  );
}

export function PcLineOfServiceSection({
  audience,
  rows,
}: {
  audience: Audience;
  rows: PcLineSourceRow[];
}) {
  const lineRows = useMemo(() => buildPcLineRows(rows), [rows]);
  const isCompany = audience === "company";
  const maxes = {
    agentCommission: maxOf(lineRows, (row) => row.agentCommission),
    epsCommission: maxOf(lineRows, (row) => row.epsCommission),
    policyCount: maxOf(lineRows, (row) => row.policyCount),
    totalCommission: maxOf(lineRows, (row) => row.totalCommission),
    totalPremium: maxOf(lineRows, (row) => row.totalPremium),
  };
  const commissionMax = isCompany ? maxes.totalCommission : maxes.agentCommission;

  return (
    <section className="flex flex-col">
      <h3 className="mb-4 text-lg font-bold leading-tight text-slate-800">
        Line of Service
      </h3>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-shadow duration-300 hover:shadow-md">
        <div className="overflow-auto" style={{ maxHeight: LINE_TABLE_MAX_HEIGHT }}>
          <table className="w-full table-fixed text-[11px] max-md:min-w-[880px]">
            <thead className="sticky top-0 z-10">
              <tr style={{ height: LINE_HEADER_HEIGHT_PX }}>
                <HeaderCell align="left" className="max-md:w-[120px]">Line</HeaderCell>
                <HeaderCell>Policies</HeaderCell>
                <HeaderCell>% Policies</HeaderCell>
                <HeaderCell>Premium</HeaderCell>
                <HeaderCell>% Premium</HeaderCell>
                <HeaderCell>Prem / Policy</HeaderCell>
                {isCompany ? (
                  <>
                    <HeaderCell>Total Comm</HeaderCell>
                    <HeaderCell>Comm Rate</HeaderCell>
                    <HeaderCell>EPS Comm</HeaderCell>
                    <HeaderCell>EPS Rate</HeaderCell>
                  </>
                ) : (
                  <>
                    <HeaderCell>Agent Comm</HeaderCell>
                    <HeaderCell>Agent Rate</HeaderCell>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {lineRows.map((row, index) => {
                const commission = isCompany
                  ? row.totalCommission
                  : row.agentCommission;
                const commissionRate = percentOf(commission, row.totalPremium);
                const epsRate = percentOf(row.epsCommission, row.totalPremium);

                return (
                  <tr
                    className={index % 2 === 0 ? "bg-white" : "bg-[#f7f8fa]"}
                    key={row.label}
                    style={{ height: LINE_ROW_HEIGHT_PX }}
                  >
                    <td
                      className="truncate border-b border-r border-slate-100 px-3 py-2 align-middle text-sm font-semibold text-slate-900"
                      title={row.label}
                    >
                      {row.label}
                    </td>
                    <HeatCell maxValue={maxes.policyCount} mode="blue" value={row.policyCount}>
                      {formatInteger(row.policyCount)}
                    </HeatCell>
                    <HeatCell mode="blue" value={row.policySharePercent}>
                      {formatPercent(row.policySharePercent)}
                    </HeatCell>
                    <HeatCell maxValue={maxes.totalPremium} mode="lavender" value={row.totalPremium}>
                      {formatCurrencyShort(row.totalPremium)}
                    </HeatCell>
                    <HeatCell mode="lavender" value={row.premiumSharePercent}>
                      {formatPercent(row.premiumSharePercent)}
                    </HeatCell>
                    <td className="border-b border-r border-slate-100 px-3 py-2 text-right align-middle text-sm tabular-nums text-slate-700">
                      {formatCurrencyShort(row.premiumPerPolicy)}
                    </td>
                    <HeatCell maxValue={commissionMax} mode="pink" value={commission}>
                      {formatCurrencyShort(commission)}
                    </HeatCell>
                    <HeatCell mode="pink" value={commissionRate}>
                      {formatPercent(commissionRate)}
                    </HeatCell>
                    {isCompany ? (
                      <>
                        <HeatCell maxValue={maxes.epsCommission} mode="magenta" value={row.epsCommission}>
                          {formatCurrencyShort(row.epsCommission)}
                        </HeatCell>
                        <HeatCell mode="magenta" value={epsRate}>
                          {formatPercent(epsRate)}
                        </HeatCell>
                      </>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function ScoreCard({
  footerText,
  label,
  value,
}: {
  footerText: string;
  label: string;
  value: string;
}) {
  return (
    <article className="flex min-h-[112px] flex-col rounded-xl border border-slate-200/70 bg-white px-4 py-4 text-center shadow-[0_6px_18px_rgba(15,23,42,0.06)] transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgba(15,23,42,0.1)]">
      <div className="flex min-h-8 items-center justify-center text-[12px] font-semibold uppercase leading-snug tracking-[0.08em] text-slate-500">
        {label}
      </div>
      <div className="flex flex-1 items-center justify-center py-2">
        <div className="w-full break-words text-center text-[1.75rem] font-bold leading-none tabular-nums tracking-normal text-slate-900">
          {value}
        </div>
      </div>
      <div className="min-h-5 truncate text-xs font-medium text-slate-500">
        {footerText}
      </div>
    </article>
  );
}

function HeaderCell({
  align = "right",
  children,
  className = "",
}: {
  align?: "left" | "right";
  children: ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`border-b border-r border-slate-200 bg-slate-50 px-3 py-2 align-middle text-[11px] font-semibold uppercase leading-snug tracking-[0.04em] text-slate-500 last:border-r-0 ${
        align === "right" ? "text-right" : "text-left"
      } ${className}`}
    >
      {children}
    </th>
  );
}

function HeatCell({
  children,
  maxValue = 100,
  mode,
  value,
}: {
  children: ReactNode;
  maxValue?: number;
  mode: HeatMode;
  value: number;
}) {
  return (
    <td
      className="border-b border-r border-slate-100 px-3 py-2 text-right align-middle text-sm tabular-nums text-slate-700 last:border-r-0"
      style={{ backgroundColor: heatColor(value, maxValue, mode) }}
    >
      {children}
    </td>
  );
}

// Cùng thang màu với bảng Revenue & Commission của Health dashboard.
function heatColor(value: number, maxValue: number, mode: HeatMode) {
  if (!Number.isFinite(value) || value === 0) return "transparent";

  const intensity = Math.min(Math.abs(value) / Math.max(Math.abs(maxValue), 1), 1);

  if (mode === "blue") return `rgba(73, 150, 232, ${0.12 + intensity * 0.5})`;
  if (mode === "lavender") return `rgba(137, 146, 204, ${0.16 + intensity * 0.44})`;
  if (mode === "pink") return `rgba(214, 109, 211, ${0.12 + intensity * 0.5})`;

  return `rgba(231, 60, 130, ${0.12 + intensity * 0.5})`;
}

function maxOf(rows: PcLineRow[], getValue: (row: PcLineRow) => number) {
  return Math.max(...rows.map((row) => Math.max(getValue(row), 0)), 1);
}

function formatChangeFooter(metric: PcChangeMetric, monthLabel: string) {
  const base = `${formatInteger(metric.latest)} in ${monthLabel}`;

  if (metric.change === null) return base;

  return `${base} (${metric.change > 0 ? "+" : ""}${formatInteger(metric.change)})`;
}

function formatMonthKey(monthKey: string) {
  return lineMonthFormatter.format(new Date(`${monthKey}-01T00:00:00Z`));
}

const lineMonthFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short", timeZone: "UTC", year: "numeric",
});
const lineIntegerFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const linePercentFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const lineCurrencyFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2, minimumFractionDigits: 2,
});

function formatInteger(value: number) {
  return lineIntegerFormatter.format(value);
}

function formatPercent(value: number) {
  return `${linePercentFormatter.format(value)}%`;
}

function formatCurrencyShort(value: number) {
  const absValue = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  const fixed = (amount: number) => lineCurrencyFormatter.format(amount);

  if (absValue >= 1000000) return `${sign}$${fixed(absValue / 1000000)}M`;
  if (absValue >= 1000) return `${sign}$${fixed(absValue / 1000)}K`;

  return `${sign}$${fixed(absValue)}`;
}
