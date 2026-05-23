"use client";

import { useMemo } from "react";
import type { ReactNode } from "react";
import {
  getChartLevelLabel,
  type ChartLevel,
  type PerformancePeriod,
  type PeriodsByLevel,
} from "./AgentHealthPerformanceChart";

type SalesPerformanceChangeRow = PerformancePeriod & {
  previousPolicyCount: number | null;
  previousClientCount: number | null;
  previousAgentReceived: number | null;
  policyChange: number | null;
  policyChangePercent: number | null;
  clientChange: number | null;
  clientChangePercent: number | null;
  earningsChange: number | null;
  earningsChangePercent: number | null;
};

const VISIBLE_ROW_COUNT = 6;
const HEADER_HEIGHT_PX = 44;
const ROW_HEIGHT_PX = 56;
const TABLE_SCROLL_MAX_HEIGHT =
  HEADER_HEIGHT_PX + VISIBLE_ROW_COUNT * ROW_HEIGHT_PX;

export function AgentHealthSalesPerformanceMoMTable({
  chartLevel,
  periodsByLevel,
}: {
  chartLevel: ChartLevel;
  periodsByLevel: PeriodsByLevel;
}) {
  const changeLabel = getChangeLabel(chartLevel);
  const rows = useMemo(() => {
    const periods = periodsByLevel[chartLevel];
    const changeRows = periods.map<SalesPerformanceChangeRow>((period, index) => {
      const previous = periods[index - 1];
      const previousPolicyCount = previous?.policyCount ?? null;
      const previousClientCount = previous?.clientCount ?? null;
      const previousAgentReceived = previous?.agentReceived ?? null;
      const policyChange =
        previousPolicyCount === null
          ? null
          : period.policyCount - previousPolicyCount;
      const clientChange =
        previousClientCount === null
          ? null
          : period.clientCount - previousClientCount;
      const earningsChange =
        previousAgentReceived === null
          ? null
          : period.agentReceived - previousAgentReceived;

      return {
        ...period,
        previousPolicyCount,
        previousClientCount,
        previousAgentReceived,
        policyChange,
        policyChangePercent: calculateDeltaPercent(
          policyChange,
          previousPolicyCount
        ),
        clientChange,
        clientChangePercent: calculateDeltaPercent(
          clientChange,
          previousClientCount
        ),
        earningsChange,
        earningsChangePercent: calculateDeltaPercent(
          earningsChange,
          previousAgentReceived
        ),
      };
    });

    return changeRows.reverse();
  }, [periodsByLevel, chartLevel]);

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-[#24272d]">
          Book &amp; Earnings Growth | {changeLabel}
        </h2>
      </div>

      <article className="overflow-hidden rounded-lg border border-[#d1d5db] bg-white shadow-[0_2px_8px_rgba(22,35,58,0.14)]">
        {rows.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-[#667085]">
            No report periods with more than 100 active policies.
          </div>
        ) : (
          <div
            className="overflow-y-auto overflow-x-hidden"
            style={{ maxHeight: TABLE_SCROLL_MAX_HEIGHT }}
          >
            <table className="w-full table-fixed text-xs text-[#3f444b]">
              <thead>
                <tr className="border-b border-[#d7dce3] bg-white text-left text-sm font-medium text-[#3f444b]">
                  <HeaderCell className="sticky left-0 top-0 z-30 w-[13%] bg-white">
                    {getChartLevelLabel(chartLevel)}
                  </HeaderCell>
                  <HeaderCell className="top-0 w-[14%] text-right">
                    Policies
                  </HeaderCell>
                  <HeaderCell className="top-0 w-[14%] text-right">
                    % Policies {changeLabel}
                  </HeaderCell>
                  <HeaderCell className="top-0 w-[14%] text-right">
                    Clients
                  </HeaderCell>
                  <HeaderCell className="top-0 w-[14%] text-right">
                    % Clients {changeLabel}
                  </HeaderCell>
                  <HeaderCell className="top-0 w-[17%] text-right">
                    Earnings
                  </HeaderCell>
                  <HeaderCell className="top-0 w-[14%] text-right">
                    % Earnings {changeLabel}
                  </HeaderCell>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const rowBg = index % 2 === 0 ? "bg-white" : "bg-[#f8fafc]";

                  return (
                    <tr
                      key={row.periodKey}
                      className={`h-14 border-b border-[#edf0f4] ${rowBg}`}
                    >
                      <td
                        className={`sticky left-0 z-10 border-r border-[#e3e8ef] px-3 py-3 text-sm ${rowBg}`}
                      >
                        {row.periodLabel}
                      </td>
                      <ValueChangeCell
                        value={formatInteger(row.policyCount)}
                        change={formatNullableInteger(row.policyChange)}
                        changeValue={row.policyChange}
                        changeLabel={changeLabel}
                      />
                      <HeatmapCell value={row.policyChangePercent}>
                        {formatNullablePercent(row.policyChangePercent)}
                      </HeatmapCell>
                      <ValueChangeCell
                        value={formatInteger(row.clientCount)}
                        change={formatNullableInteger(row.clientChange)}
                        changeValue={row.clientChange}
                        changeLabel={changeLabel}
                      />
                      <HeatmapCell value={row.clientChangePercent}>
                        {formatNullablePercent(row.clientChangePercent)}
                      </HeatmapCell>
                      <ValueChangeCell
                        value={formatCurrency(row.agentReceived)}
                        change={formatNullableCurrency(row.earningsChange)}
                        changeValue={row.earningsChange}
                        changeLabel={changeLabel}
                      />
                      <HeatmapCell value={row.earningsChangePercent}>
                        {formatNullablePercent(row.earningsChangePercent)}
                      </HeatmapCell>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </article>
    </section>
  );
}

function HeaderCell({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`sticky z-20 border-r border-[#e3e8ef] bg-white px-2 py-2.5 font-medium leading-tight last:border-r-0 ${className}`}
    >
      <span className="block whitespace-normal break-words">{children}</span>
    </th>
  );
}

function ValueChangeCell({
  value,
  change,
  changeValue,
  changeLabel,
}: {
  value: string;
  change: string;
  changeValue: number | null;
  changeLabel: string;
}) {
  return (
    <td className="border-r border-[#e3e8ef] px-2 py-2.5 text-right last:border-r-0">
      <div className="font-semibold text-[#24272d]">{value}</div>
      <div className={`mt-0.5 text-[11px] ${getSignedTextClassName(changeValue)}`}>
        {changeLabel} {change}
      </div>
    </td>
  );
}

function HeatmapCell({
  value,
  children,
}: {
  value: number | null;
  children: ReactNode;
}) {
  return (
    <td
      className={`border-r border-[#e3e8ef] px-2 py-3 text-right last:border-r-0 ${getHeatmapClassName(
        value
      )}`}
    >
      {children}
    </td>
  );
}

function getChangeLabel(chartLevel: ChartLevel) {
  if (chartLevel === "quarter") return "QoQ";
  if (chartLevel === "year") return "YoY";
  return "MoM";
}

function calculateDeltaPercent(delta: number | null, previousValue: number | null) {
  if (delta == null || previousValue == null || previousValue === 0) return null;
  return (delta / previousValue) * 100;
}

function getHeatmapClassName(value: number | null) {
  if (value == null || value === 0) return "bg-transparent";
  return value > 0 ? "bg-[#c9e8ca]" : "bg-[#f2c5c0]";
}

function getSignedTextClassName(value: number | null) {
  if (value == null || value === 0) return "text-[#667085]";
  return value > 0 ? "text-[#027a48]" : "text-[#c01048]";
}

function formatInteger(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(
    value
  );
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(value);
}

function formatNullableInteger(value: number | null) {
  if (value == null) return "-";
  return formatInteger(value);
}

function formatNullableCurrency(value: number | null) {
  if (value == null) return "-";
  return formatCurrency(value);
}

function formatNullablePercent(value: number | null) {
  if (value == null) return "-";

  return `${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(value)}%`;
}
