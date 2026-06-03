"use client";

import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { FileDown, Filter, Minus, Plus } from "lucide-react";
import * as XLSX from "xlsx";
import { PcCommissionMetricTrendChart } from "./PcCommissionMetricTrendChart";
import { PcSalesDashboardFilters } from "./PcSalesDashboardFilters";
import { PcSalesTrendSections } from "./PcSalesTrendSections";
import { PcStateHeatMap } from "./PcStateHeatMap";

export type PcSalesRow = {
  agent_name: string | null;
  agency_name: string | null;
  insured_name: string | null;
  type: string | null;
  company: string | null;
  policy_number: string | null;
  premium: number | null;
  effective_date: string | null;
  expired_date: string | null;
  carrier_commission: number | null;
  paid_producer: string | null;
  statement_number: string | null;
  true_premium: number | null;
  expired_month_year: string | null;
  effective_month_year: string | null;
  status: string | null;
  city: string | null;
  state: string | null;
  total_commission: number | null;
  agent_commission_amount: number | null;
  eps_commission_amount: number | null;
};

export type FilterValues = {
  policyNumber: string;
  agent: string;
  agency: string;
  reportMonthRange: ReportMonthRange;
};

type ReportMonthRange = {
  start: string | null;
  end: string | null;
};

type TrendLevel = "month" | "quarter" | "year";

export type FilterOptions = {
  agents: string[];
  agencies: string[];
};

type Summary = {
  policyCount: number;
  activePolicyCount: number;
  renewalPolicyCount: number;
  totalPremium: number;
  totalCommission: number;
  agentCommission: number;
  epsCommission: number;
};

type MonthlySummary = Summary & {
  monthKey: string;
  periodKey: string;
  policyChange: number | null;
  policyChangePercent: number | null;
  premiumChange: number | null;
  premiumChangePercent: number | null;
  commissionChange: number | null;
  commissionChangePercent: number | null;
  epsCommissionChange: number | null;
  epsCommissionChangePercent: number | null;
};

type AgencyMonthRow = Summary & {
  agency: string;
  isTotal: boolean;
  monthKey: string;
};

type AgentPivotGroup = {
  monthKey: string;
  rows: AgentPivotRow[];
  total: AgentPivotRow;
};

type AgentPivotRow = {
  agency: string;
  isTotal: boolean;
  valuesByAgent: Record<string, number>;
  grandTotal: number;
};

type AgentCommissionGroup = {
  monthKey: string;
  rows: AgentCommissionPivotRow[];
  monthlyTotal: AgentCommissionPivotRow;
};

type AgentCommissionPivotRow = {
  agency: string;
  statement: string;
  isTotal: boolean;
  valuesByAgent: Record<string, number>;
  grandTotal: number;
};

type CarrierRow = Summary & {
  company: string;
  policySharePercent: number;
  averageCommissionRate: number;
};

type AgentPerformanceRow = Summary & {
  agent: string;
  averageAgentCommissionPerMonth: number;
  averageCommissionRate: number;
  policySharePercent: number;
};

type StateCityRow = Summary & {
  state: string;
  city: string;
  isTotal: boolean;
  policySharePercent: number;
};

type StateGroup = {
  state: string;
  rows: StateCityRow[];
};

type ExpiredMonthRow = {
  monthKey: string;
  policyCount: number;
  totalPremium: number;
};

type PolicyDetailRow = {
  agent: string;
  agency: string;
  insuredName: string;
  policyNumber: string;
  state: string;
  city: string;
  company: string;
  truePremium: number;
  effectiveDate: string | null;
  expiredDate: string | null;
};

type DashboardData = {
  overview: Summary;
  monthlyRows: MonthlySummary[];
  trendRows: MonthlySummary[];
  agencyMonthRows: AgencyMonthRow[];
  agentNames: string[];
  agentPremiumGroups: AgentPivotGroup[];
  agentSalesGroups: AgentPivotGroup[];
  agentCommissionGroups: AgentCommissionGroup[];
  carrierRows: CarrierRow[];
  stateGroups: StateGroup[];
  statePolicyCounts: Record<string, number>;
  expiredRows: ExpiredMonthRow[];
  policyDetailRows: PolicyDetailRow[];
};

type SortDirection = "asc" | "desc";
type PolicySortKey =
  | "agent"
  | "agency"
  | "insuredName"
  | "policyNumber"
  | "state"
  | "city"
  | "company"
  | "truePremium"
  | "effectiveDate"
  | "expiredDate";
type PolicySortState = { key: PolicySortKey; direction: SortDirection };
type PolicyFilterOption = { label: string; value: string };
type DateRange = { from: string; to: string };

const TREND_MONTH_LIMIT = 17;
const CARRIER_ROW_LIMIT = 24;
const SALES_MOM_VISIBLE_ROW_COUNT = 6;
const SALES_MOM_HEADER_HEIGHT_PX = 44;
const SALES_MOM_ROW_HEIGHT_PX = 56;
const SALES_MOM_SCROLL_MAX_HEIGHT =
  SALES_MOM_HEADER_HEIGHT_PX + SALES_MOM_VISIBLE_ROW_COUNT * SALES_MOM_ROW_HEIGHT_PX;
const CARRIER_VISIBLE_ROW_COUNT = 5;
const CARRIER_HEADER_HEIGHT_PX = 54;
const CARRIER_ROW_HEIGHT_PX = 46;
const CARRIER_TABLE_MAX_HEIGHT =
  CARRIER_HEADER_HEIGHT_PX + CARRIER_VISIBLE_ROW_COUNT * CARRIER_ROW_HEIGHT_PX;
const AGENT_PERFORMANCE_VISIBLE_ROW_COUNT = 6;
const AGENT_PERFORMANCE_HEADER_HEIGHT_PX = 54;
const AGENT_PERFORMANCE_ROW_HEIGHT_PX = 46;
const AGENT_PERFORMANCE_TABLE_MAX_HEIGHT =
  AGENT_PERFORMANCE_HEADER_HEIGHT_PX +
  AGENT_PERFORMANCE_VISIBLE_ROW_COUNT * AGENT_PERFORMANCE_ROW_HEIGHT_PX;
const STATE_CITY_VISIBLE_ROW_COUNT = 5;
const STATE_CITY_HEADER_HEIGHT_PX = 54;
const STATE_CITY_ROW_HEIGHT_PX = 46;
const STATE_CITY_TABLE_MAX_HEIGHT =
  STATE_CITY_HEADER_HEIGHT_PX +
  STATE_CITY_VISIBLE_ROW_COUNT * STATE_CITY_ROW_HEIGHT_PX;
const EXPIRED_MONTH_LIMIT = 12;
const POLICY_DETAIL_VISIBLE_ROW_COUNT = 10;
const POLICY_DETAIL_HEADER_HEIGHT_PX = 48;
const POLICY_DETAIL_ROW_HEIGHT_PX = 48;
const POLICY_DETAIL_TABLE_MAX_HEIGHT =
  POLICY_DETAIL_HEADER_HEIGHT_PX +
  POLICY_DETAIL_VISIBLE_ROW_COUNT * POLICY_DETAIL_ROW_HEIGHT_PX;
const TREND_LIMIT_BY_LEVEL: Record<TrendLevel, number> = {
  month: TREND_MONTH_LIMIT,
  quarter: 8,
  year: 12,
};
type ClientFilterValues = Pick<FilterValues, "agency" | "agent" | "policyNumber">;

export function PcSalesDashboard({
  agentPerformanceSourceRows,
  expiredMonthKeys,
  expiredRows: expiredSourceRows,
  filterOptions,
  filters,
  initialTrendLevel,
  rows,
}: {
  agentPerformanceSourceRows: PcSalesRow[];
  expiredMonthKeys: string[];
  expiredRows: PcSalesRow[];
  filterOptions: FilterOptions;
  filters: FilterValues;
  initialTrendLevel: TrendLevel;
  rows: PcSalesRow[];
}) {
  const [clientFilters, setClientFilters] = useState<ClientFilterValues>(() => ({
    agency: filters.agency,
    agent: filters.agent,
    policyNumber: filters.policyNumber,
  }));
  const activeFilters = useMemo(
    () => ({
      ...filters,
      ...clientFilters,
    }),
    [clientFilters, filters]
  );
  const filteredRows = useMemo(
    () => applyClientFilters(rows, activeFilters),
    [activeFilters, rows]
  );
  const agentPerformanceMonthCount = useMemo(
    () => countDataMonths(filteredRows),
    [filteredRows]
  );
  const expiredChartRows = useMemo(
    () =>
      buildExpiredRows(
        applyClientFilters(expiredSourceRows, activeFilters),
        expiredMonthKeys
      ),
    [activeFilters, expiredMonthKeys, expiredSourceRows]
  );
  const agentPerformanceRows = useMemo(
    () =>
      buildAgentPerformanceRows(
        applyClientFilters(agentPerformanceSourceRows, activeFilters),
        agentPerformanceMonthCount
      ),
    [activeFilters, agentPerformanceMonthCount, agentPerformanceSourceRows]
  );
  const dataByLevel = useMemo<Record<TrendLevel, DashboardData>>(
    () => ({
      month: buildDashboardData(filteredRows, "month"),
      quarter: buildDashboardData(filteredRows, "quarter"),
      year: buildDashboardData(filteredRows, "year"),
    }),
    [filteredRows]
  );
  const data = dataByLevel.month;
  const latestMonth = data.monthlyRows[0] ?? null;

  function updateClientFilters(nextFilters: ClientFilterValues) {
    setClientFilters(nextFilters);
    syncClientFilterUrl(nextFilters);
  }

  return (
    <>
      <PcSalesDashboardFilters
        filters={activeFilters}
        onClientFiltersChange={updateClientFilters}
        options={filterOptions}
      />

      {filteredRows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-8 py-16 text-center text-sm font-medium text-slate-500 shadow-sm">
          No P&amp;C sales records match these filters.
        </div>
      ) : (
        <div className="space-y-8">
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">
            Portfolio Overview
          </h2>

          <section className="grid gap-8 md:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Written Premium"
              value={formatCurrencyCompact(data.overview.totalPremium)}
              footerText={formatLatestMonthMetric(
                latestMonth,
                latestMonth ? formatCurrencyShort(latestMonth.totalPremium) : "-"
              )}
            />
            <KpiCard
              label="Commission Revenue"
              value={formatCurrencyCompact(data.overview.totalCommission)}
              footerText={formatLatestMonthMetric(
                latestMonth,
                latestMonth ? formatCurrencyShort(latestMonth.totalCommission) : "-"
              )}
            />
            <KpiCard
              label="Agent Commission"
              value={formatCurrencyCompact(data.overview.agentCommission)}
              footerText={formatLatestMonthMetric(
                latestMonth,
                latestMonth ? formatCurrencyShort(latestMonth.agentCommission) : "-"
              )}
            />
            <KpiCard
              label="EPS Commission"
              value={formatCurrencyCompact(data.overview.epsCommission)}
              footerText={formatLatestMonthMetric(
                latestMonth,
                latestMonth ? formatCurrencyShort(latestMonth.epsCommission) : "-"
              )}
            />
          </section>

          <section className="grid gap-8 md:grid-cols-2 xl:grid-cols-5">
            <KpiCard
              compact
              muted
              label="Policies Sold"
              value={formatInteger(data.overview.policyCount)}
              footerText={formatLatestMonthMetric(
                latestMonth,
                latestMonth ? formatInteger(latestMonth.policyCount) : "-"
              )}
            />
            <KpiCard
              compact
              muted
              label="Active Policies"
              value={formatInteger(data.overview.activePolicyCount)}
              footerText={formatLatestMonthMetric(
                latestMonth,
                latestMonth ? formatInteger(latestMonth.activePolicyCount) : "-"
              )}
            />
            <KpiCard
              compact
              label="Renewal Rate"
              value={formatPercent(
                percentOf(data.overview.renewalPolicyCount, data.overview.policyCount)
              )}
              footerText={formatLatestMonthMetric(
                latestMonth,
                latestMonth
                  ? formatPercent(
                      percentOf(
                        latestMonth.renewalPolicyCount,
                        latestMonth.policyCount
                      )
                    )
                  : "-"
              )}
            />
            <KpiCard
              compact
              label="Commission Rate"
              value={formatPercent(
                percentOf(data.overview.totalCommission, data.overview.totalPremium)
              )}
              footerText={formatLatestMonthMetric(
                latestMonth,
                latestMonth
                  ? formatPercent(
                      percentOf(
                        latestMonth.totalCommission,
                        latestMonth.totalPremium
                      )
                    )
                  : "-"
              )}
            />
            <KpiCard
              compact
              label="EPS Comm Rate"
              value={formatPercent(
                percentOf(data.overview.epsCommission, data.overview.totalPremium)
              )}
              footerText={formatLatestMonthMetric(
                latestMonth,
                latestMonth
                  ? formatPercent(
                      percentOf(latestMonth.epsCommission, latestMonth.totalPremium)
                    )
                  : "-"
              )}
            />
          </section>

          <PcSalesTrendSections
            initialLevel={initialTrendLevel}
            monthSalesTrend={
              <MonthlySalesTrendChart
                rows={dataByLevel.month.trendRows}
                trendLevel="month"
              />
            }
            monthSections={
              <PcTrendLevelSections data={dataByLevel.month} trendLevel="month" />
            }
            quarterSalesTrend={
              <MonthlySalesTrendChart
                rows={dataByLevel.quarter.trendRows}
                trendLevel="quarter"
              />
            }
            quarterSections={
              <PcTrendLevelSections data={dataByLevel.quarter} trendLevel="quarter" />
            }
            yearSalesTrend={
              <MonthlySalesTrendChart
                rows={dataByLevel.year.trendRows}
                trendLevel="year"
              />
            }
            yearSections={
              <PcTrendLevelSections data={dataByLevel.year} trendLevel="year" />
            }
          />
          <AgentPerformanceTable
            averageMonthCount={agentPerformanceMonthCount}
            rows={agentPerformanceRows}
          />
          <section className="grid gap-8 xl:grid-cols-2">
            <CarrierDashboardTable rows={data.carrierRows} />
            <StateCityPerformanceTable groups={data.stateGroups} />
          </section>
          <PcStateHeatMap counts={data.statePolicyCounts} groups={data.stateGroups} />
          <ExpiredPolicyTrendChart rows={expiredChartRows} />
          <PolicyDetailsTable rows={data.policyDetailRows} />
        </div>
      )}
    </>
  );
}

function syncClientFilterUrl(filters: ClientFilterValues) {
  const params = new URLSearchParams(window.location.search);

  params.delete("policyNumber");
  params.delete("agent");
  params.delete("agency");

  if (filters.policyNumber) {
    params.set("policyNumber", filters.policyNumber);
  }

  if (filters.agent) {
    params.set("agent", filters.agent);
  }

  if (filters.agency) {
    params.set("agency", filters.agency);
  }

  const query = params.toString();
  window.history.replaceState(
    null,
    "",
    query ? `${window.location.pathname}?${query}` : window.location.pathname
  );
}

function buildDashboardData(rows: PcSalesRow[], trendLevel: TrendLevel): DashboardData {
  const overview = summarizeRows(rows);
  const monthlyRows = buildPeriodSummaries(rows, trendLevel);
  const trendRows = [...monthlyRows]
    .reverse()
    .slice(-TREND_LIMIT_BY_LEVEL[trendLevel]);
  const agentNames = buildAgentNames(rows);
  const stateGroups = buildStateGroups(rows, overview);

  return {
    overview,
    monthlyRows,
    trendRows,
    agencyMonthRows: buildAgencyMonthRows(rows, trendLevel),
    agentNames,
    agentPremiumGroups: buildAgentPremiumGroups(rows, agentNames, trendLevel),
    agentSalesGroups: buildAgentSalesGroups(rows, agentNames, trendLevel),
    agentCommissionGroups: buildAgentCommissionGroups(rows, agentNames, trendLevel),
    carrierRows: buildCarrierRows(rows, overview).slice(0, CARRIER_ROW_LIMIT),
    stateGroups,
    statePolicyCounts: buildStatePolicyCounts(stateGroups),
    expiredRows: buildExpiredRows(rows),
    policyDetailRows: buildPolicyDetailRows(rows),
  };
}

function buildStateGroups(rows: PcSalesRow[], overview: Summary): StateGroup[] {
  const byState = groupRows(rows, (row) => cleanGroupLabel(row.state));

  return [...byState.entries()]
    .filter(([state]) => state !== "null")
    .map(([state, stateRows]) => {
      const cityRows = [
        ...groupRows(stateRows, (row) => cleanGroupLabel(row.city)).entries(),
      ]
        .map(([city, group]) => {
          const summary = summarizeRows(group);
          return {
            ...summary,
            state,
            city: city === "null" ? "Unknown" : city,
            isTotal: false,
            policySharePercent: percentOf(summary.policyCount, overview.policyCount),
          };
        })
        .sort(
          (a, b) =>
            b.policyCount - a.policyCount || a.city.localeCompare(b.city)
        );

      const stateSummary = summarizeRows(stateRows);
      const totalRow: StateCityRow = {
        ...stateSummary,
        state,
        city: "All cities",
        isTotal: true,
        policySharePercent: percentOf(
          stateSummary.policyCount,
          overview.policyCount
        ),
      };

      return { state, rows: [...cityRows, totalRow] };
    })
    .sort((a, b) => {
      const aTotal = a.rows[a.rows.length - 1].policyCount;
      const bTotal = b.rows[b.rows.length - 1].policyCount;
      return bTotal - aTotal || a.state.localeCompare(b.state);
    });
}

function buildStatePolicyCounts(groups: StateGroup[]): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const group of groups) {
    const totalRow = group.rows[group.rows.length - 1];
    counts[group.state] = totalRow.policyCount;
  }

  return counts;
}

function summarizeRows(rows: PcSalesRow[]): Summary {
  const currentDate = new Date();
  const policies = new Map<
    string,
    {
      active: boolean;
      renewal: boolean;
      positivePremium: boolean;
    }
  >();
  let totalPremium = 0;
  let totalCommission = 0;
  let agentCommission = 0;
  let epsCommission = 0;

  rows.forEach((row, index) => {
    const truePremium = moneyValue(row.true_premium ?? row.premium);
    const isPositivePolicy = truePremium > 0;
    const policyId = getPolicyId(row, index);
    const current = policies.get(policyId) ?? {
      active: false,
      positivePremium: false,
      renewal: false,
    };

    const isActivePolicy =
      isPositivePolicy &&
      row.expired_date !== null &&
      toDate(row.expired_date) >= currentDate;

    current.active = current.active || isActivePolicy;
    current.positivePremium = current.positivePremium || isPositivePolicy;
    current.renewal = current.renewal || cleanGroupLabel(row.status) === "RENEWAL";
    policies.set(policyId, current);

    if (isPositivePolicy) {
      totalPremium += truePremium;
    }

    totalCommission += moneyValue(row.total_commission);
    agentCommission += moneyValue(row.agent_commission_amount);
    epsCommission += moneyValue(row.eps_commission_amount);
  });

  const policyValues = [...policies.values()].filter((policy) => policy.positivePremium);

  return {
    policyCount: policyValues.length,
    activePolicyCount: policyValues.filter((policy) => policy.active).length,
    renewalPolicyCount: policyValues.filter((policy) => policy.renewal).length,
    totalPremium,
    totalCommission,
    agentCommission,
    epsCommission,
  };
}

function buildPeriodSummaries(
  rows: PcSalesRow[],
  trendLevel: TrendLevel
): MonthlySummary[] {
  const chronological = [
    ...groupRows(rows, (row) => getTrendPeriodKey(getEffectiveMonth(row), trendLevel)).entries(),
  ]
    .filter(([periodKey]) => Boolean(periodKey))
    .map(([periodKey, group]) => ({
      monthKey: formatTrendPeriodLabel(periodKey, trendLevel),
      periodKey,
      ...summarizeRows(group),
    }))
    .sort((a, b) => a.periodKey.localeCompare(b.periodKey));

  const rowsWithChange = chronological.map<MonthlySummary>((row, index) => {
    const previous = chronological[index - 1] ?? null;
    const policyChange = previous ? row.policyCount - previous.policyCount : null;
    const premiumChange = previous ? row.totalPremium - previous.totalPremium : null;
    const commissionChange = previous
      ? row.totalCommission - previous.totalCommission
      : null;
    const epsCommissionChange = previous
      ? row.epsCommission - previous.epsCommission
      : null;

    return {
      ...row,
      policyChange,
      policyChangePercent: calculateChangePercent(
        policyChange,
        previous?.policyCount ?? null
      ),
      premiumChange,
      premiumChangePercent: calculateChangePercent(
        premiumChange,
        previous?.totalPremium ?? null
      ),
      commissionChange,
      commissionChangePercent: calculateChangePercent(
        commissionChange,
        previous?.totalCommission ?? null
      ),
      epsCommissionChange,
      epsCommissionChangePercent: calculateChangePercent(
        epsCommissionChange,
        previous?.epsCommission ?? null
      ),
    };
  });

  return rowsWithChange.reverse();
}

function buildAgencyMonthRows(
  rows: PcSalesRow[],
  trendLevel: TrendLevel
): AgencyMonthRow[] {
  const monthGroups = [
    ...groupRows(rows, (row) => getTrendPeriodKey(getEffectiveMonth(row), trendLevel)).entries(),
  ]
    .filter(([periodKey]) => Boolean(periodKey))
    .sort((a, b) => b[0].localeCompare(a[0]));
  const result: AgencyMonthRow[] = [];

  for (const [periodKey, monthRows] of monthGroups) {
    const periodLabel = formatTrendPeriodLabel(periodKey, trendLevel);
    const agencyRows = [...groupRows(monthRows, (row) => cleanGroupLabel(row.agency_name)).entries()]
      .map(([agency, group]) => ({
        agency,
        isTotal: false,
        monthKey: periodLabel,
        ...summarizeRows(group),
      }))
      .sort((a, b) => b.policyCount - a.policyCount || a.agency.localeCompare(b.agency));

    result.push(...agencyRows);
    result.push({
      agency: "Total",
      isTotal: true,
      monthKey: periodLabel,
      ...summarizeRows(monthRows),
    });
  }

  const grandTotal = summarizeRows(rows);
  result.push({
    agency: "Grand total",
    isTotal: true,
    monthKey: "",
    ...grandTotal,
  });

  return result;
}

function buildAgentNames(rows: PcSalesRow[]) {
  return [...groupRows(rows, (row) => cleanGroupLabel(row.agent_name)).entries()]
    .filter(([agent]) => agent !== "null")
    .map(([agent, agentRows]) => ({
      agent,
      policyCount: summarizeRows(agentRows).policyCount,
    }))
    .sort((a, b) => b.policyCount - a.policyCount || a.agent.localeCompare(b.agent))
    .map((row) => row.agent);
}

function buildAgentSalesGroups(
  rows: PcSalesRow[],
  agentNames: string[],
  trendLevel: TrendLevel
): AgentPivotGroup[] {
  return [
    ...groupRows(rows, (row) => getTrendPeriodKey(getEffectiveMonth(row), trendLevel)).entries(),
  ]
    .filter(([periodKey]) => Boolean(periodKey))
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([periodKey, monthRows]) => {
      const periodLabel = formatTrendPeriodLabel(periodKey, trendLevel);
      const agencyRows = [...groupRows(monthRows, (row) => cleanGroupLabel(row.agency_name)).entries()]
        .map(([agency, agencyRows]) =>
          buildAgentPolicyPivotRow(agency, agencyRows, agentNames, false)
        )
        .sort((a, b) => b.grandTotal - a.grandTotal || a.agency.localeCompare(b.agency));

      return {
        monthKey: periodLabel,
        rows: agencyRows,
        total: buildAgentPolicyPivotRow("Total Policies", monthRows, agentNames, true),
      };
    });
}

function buildAgentPolicyPivotRow(
  agency: string,
  rows: PcSalesRow[],
  agentNames: string[],
  isTotal: boolean
): AgentPivotRow {
  const valuesByAgent: Record<string, number> = {};

  for (const agent of agentNames) {
    valuesByAgent[agent] = summarizeRows(
      rows.filter((row) => cleanGroupLabel(row.agent_name) === agent)
    ).policyCount;
  }

  return {
    agency,
    isTotal,
    valuesByAgent,
    grandTotal: Object.values(valuesByAgent).reduce((total, value) => total + value, 0),
  };
}

function buildAgentPremiumGroups(
  rows: PcSalesRow[],
  agentNames: string[],
  trendLevel: TrendLevel
): AgentPivotGroup[] {
  return [
    ...groupRows(rows, (row) => getTrendPeriodKey(getEffectiveMonth(row), trendLevel)).entries(),
  ]
    .filter(([periodKey]) => Boolean(periodKey))
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([periodKey, monthRows]) => {
      const periodLabel = formatTrendPeriodLabel(periodKey, trendLevel);
      const agencyRows = [...groupRows(monthRows, (row) => cleanGroupLabel(row.agency_name)).entries()]
        .map(([agency, agencyRows]) =>
          buildAgentPremiumPivotRow(agency, agencyRows, agentNames, false)
        )
        .sort((a, b) => b.grandTotal - a.grandTotal || a.agency.localeCompare(b.agency));

      return {
        monthKey: periodLabel,
        rows: agencyRows,
        total: buildAgentPremiumPivotRow("Total Premium", monthRows, agentNames, true),
      };
    });
}

function buildAgentPremiumPivotRow(
  agency: string,
  rows: PcSalesRow[],
  agentNames: string[],
  isTotal: boolean
): AgentPivotRow {
  const valuesByAgent: Record<string, number> = {};

  for (const agent of agentNames) {
    valuesByAgent[agent] = rows
      .filter((row) => cleanGroupLabel(row.agent_name) === agent)
      .reduce(
        (total, row) =>
          total + Math.max(moneyValue(row.true_premium ?? row.premium), 0),
        0
      );
  }

  return {
    agency,
    grandTotal: Object.values(valuesByAgent).reduce((total, value) => total + value, 0),
    isTotal,
    valuesByAgent,
  };
}

function buildAgentCommissionGroups(
  rows: PcSalesRow[],
  agentNames: string[],
  trendLevel: TrendLevel
): AgentCommissionGroup[] {
  return [
    ...groupRows(rows, (row) => getTrendPeriodKey(getEffectiveMonth(row), trendLevel)).entries(),
  ]
    .filter(([periodKey]) => Boolean(periodKey))
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([periodKey, monthRows]) => {
      const periodLabel = formatTrendPeriodLabel(periodKey, trendLevel);
      const rowsByAgencyStatement = [...groupRows(monthRows, (row) =>
        `${cleanGroupLabel(row.agency_name)}\u001f${cleanGroupLabel(row.statement_number)}`
      ).entries()]
        .map(([key, group]) => {
          const [agency, statement] = key.split("\u001f");

          return buildAgentCommissionPivotRow(agency, statement, group, agentNames, false);
        })
        .sort(
          (a, b) =>
            b.grandTotal - a.grandTotal ||
            a.agency.localeCompare(b.agency) ||
            a.statement.localeCompare(b.statement)
        );

      return {
        monthKey: periodLabel,
        rows: rowsByAgencyStatement,
        monthlyTotal: buildAgentCommissionPivotRow(
          "Monthly Commission",
          "",
          monthRows,
          agentNames,
          true
        ),
      };
    });
}

function buildAgentCommissionPivotRow(
  agency: string,
  statement: string,
  rows: PcSalesRow[],
  agentNames: string[],
  isTotal: boolean
): AgentCommissionPivotRow {
  const valuesByAgent: Record<string, number> = {};

  for (const agent of agentNames) {
    valuesByAgent[agent] = rows
      .filter((row) => cleanGroupLabel(row.agent_name) === agent)
      .reduce((total, row) => total + moneyValue(row.agent_commission_amount), 0);
  }

  return {
    agency,
    grandTotal: Object.values(valuesByAgent).reduce((total, value) => total + value, 0),
    isTotal,
    statement,
    valuesByAgent,
  };
}

function buildCarrierRows(rows: PcSalesRow[], overview: Summary): CarrierRow[] {
  return [...groupRows(rows, (row) => cleanGroupLabel(row.company)).entries()]
    .map(([company, group]) => {
      const summary = summarizeRows(group);

      return {
        company,
        ...summary,
        averageCommissionRate: percentOf(summary.totalCommission, summary.totalPremium),
        policySharePercent: percentOf(summary.policyCount, overview.policyCount),
      };
    })
    .sort(
      (a, b) =>
        b.policyCount - a.policyCount ||
        b.totalPremium - a.totalPremium ||
        a.company.localeCompare(b.company)
    );
}

function buildAgentPerformanceRows(
  rows: PcSalesRow[],
  averageMonthCount: number
): AgentPerformanceRow[] {
  const overview = summarizeRows(rows);

  return [...groupRows(rows, (row) => cleanGroupLabel(row.agent_name)).entries()]
    .filter(([agent]) => agent !== "null")
    .map(([agent, group]) => {
      const summary = summarizeRows(group);

      return {
        agent,
        ...summary,
        averageAgentCommissionPerMonth:
          averageMonthCount > 0 ? summary.agentCommission / averageMonthCount : 0,
        averageCommissionRate: percentOf(
          summary.totalCommission,
          summary.totalPremium
        ),
        policySharePercent: percentOf(
          summary.policyCount,
          overview.policyCount
        ),
      };
    })
    .sort(
      (a, b) =>
        b.policyCount - a.policyCount ||
        b.totalPremium - a.totalPremium ||
        a.agent.localeCompare(b.agent)
    );
}

function countDataMonths(rows: PcSalesRow[]) {
  return new Set(
    rows
      .map((row) => getEffectiveMonth(row))
      .filter(Boolean)
  ).size;
}

function buildExpiredRows(
  rows: PcSalesRow[],
  monthKeys: string[] = []
): ExpiredMonthRow[] {
  const rowsByMonth = groupRows(
    rows,
    (row) => getMonthKey(row.expired_date) || row.expired_month_year || ""
  );

  if (monthKeys.length > 0) {
    return monthKeys.map((monthKey) => {
      const group = rowsByMonth.get(monthKey) ?? [];

      return {
        monthKey,
        policyCount: summarizeRows(group).policyCount,
        totalPremium: group.reduce(
          (total, row) =>
            total + Math.max(moneyValue(row.true_premium ?? row.premium), 0),
          0
        ),
      };
    });
  }

  return [...rowsByMonth.entries()]
    .filter(([monthKey]) => Boolean(monthKey))
    .map(([monthKey, group]) => ({
      monthKey,
      policyCount: summarizeRows(group).policyCount,
      totalPremium: group.reduce(
        (total, row) => total + Math.max(moneyValue(row.true_premium ?? row.premium), 0),
        0
      ),
    }))
    .sort((a, b) => b.monthKey.localeCompare(a.monthKey))
    .slice(0, EXPIRED_MONTH_LIMIT)
    .reverse();
}

function buildPolicyDetailRows(rows: PcSalesRow[]): PolicyDetailRow[] {
  return [...rows]
    .filter((row) => moneyValue(row.true_premium ?? row.premium) > 0)
    .sort((a, b) => {
      const dateCompare = (b.effective_date ?? "").localeCompare(a.effective_date ?? "");
      if (dateCompare !== 0) return dateCompare;

      return cleanGroupLabel(a.agent_name).localeCompare(cleanGroupLabel(b.agent_name));
    })
    .map((row) => ({
      agency: cleanGroupLabel(row.agency_name),
      agent: cleanGroupLabel(row.agent_name),
      city: cleanGroupLabel(row.city),
      company: cleanGroupLabel(row.company),
      effectiveDate: row.effective_date,
      expiredDate: row.expired_date,
      insuredName: cleanText(row.insured_name),
      policyNumber: cleanText(row.policy_number),
      state: cleanGroupLabel(row.state),
      truePremium: Math.max(moneyValue(row.true_premium ?? row.premium), 0),
    }));
}

function KpiCard({
  compact = false,
  footerText,
  label,
  muted = false,
  value,
}: {
  compact?: boolean;
  footerText?: string;
  label: string;
  muted?: boolean;
  value: string;
}) {
  return (
    <article
      className={`flex flex-col rounded-xl border border-slate-200/70 bg-white text-center shadow-[0_6px_18px_rgba(15,23,42,0.06)] transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgba(15,23,42,0.1)] ${
        compact ? "min-h-[112px] px-4 py-4" : "min-h-[124px] px-5 py-4"
      }`}
    >
      <div
        className={`flex min-h-8 items-center justify-center text-[12px] font-semibold uppercase leading-snug tracking-[0.08em] ${
          muted ? "text-slate-400" : "text-slate-500"
        }`}
      >
        {label}
      </div>
      <div className="flex flex-1 items-center justify-center py-2">
        <div
          className={`w-full break-words text-center font-bold leading-none tracking-normal tabular-nums ${
            compact ? "text-[1.75rem] text-slate-900" : "text-[2rem] text-slate-950"
          }`}
        >
          {value}
        </div>
      </div>
      <div
        className={`min-h-5 truncate font-medium text-slate-500 ${
          compact ? "text-xs" : "text-sm"
        }`}
      >
        {footerText}
      </div>
    </article>
  );
}

function formatLatestMonthMetric(
  latestMonth: MonthlySummary | null,
  value: string
) {
  return latestMonth
    ? `${value} in ${formatMonthYear(latestMonth.monthKey)}`
    : `Latest month ${value}`;
}

function PcTrendLevelSections({
  data,
  trendLevel,
}: {
  data: DashboardData;
  trendLevel: TrendLevel;
}) {
  return (
    <>
      <PcCommissionMetricTrendChart
        rows={data.trendRows}
        trendLevel={trendLevel}
      />
      <MonthlySalesMomGrowthTable
        rows={data.monthlyRows}
        trendLevel={trendLevel}
      />
      <AgencyMonthSummaryTable
        rows={data.agencyMonthRows}
        trendLevel={trendLevel}
      />
      <AgentMonthlyDashboardTable
        agentNames={data.agentNames}
        commissionGroups={data.agentCommissionGroups}
        premiumGroups={data.agentPremiumGroups}
        salesGroups={data.agentSalesGroups}
        trendLevel={trendLevel}
      />
    </>
  );
}

function MonthlySalesTrendChart({
  rows,
  trendLevel,
}: {
  rows: MonthlySummary[];
  trendLevel: TrendLevel;
}) {
  const width = 1280;
  const height = 410;
  const left = 76;
  const right = 86;
  const top = 62;
  const bottom = 58;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const maxPremium = roundAxisMax(maxValue(rows, (row) => row.totalPremium));
  const maxPolicies = roundAxisMax(maxValue(rows, (row) => row.policyCount));
  const groupWidth = plotWidth / Math.max(rows.length, 1);
  const barWidth = Math.min(54, Math.max(24, groupWidth * 0.55));
  const points = rows.map((row, index) => {
    const centerX = left + index * groupWidth + groupWidth / 2;
    const barHeight = (row.totalPremium / maxPremium) * plotHeight;

    return {
      ...row,
      barHeight,
      barY: top + plotHeight - barHeight,
      centerX,
      policyY: top + plotHeight - (row.policyCount / maxPolicies) * plotHeight,
    };
  });
  const trendLabel = getTrendLevelAdjective(trendLevel);

  return (
    <div className="overflow-x-auto">
      <svg
        className="min-w-[1120px]"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${trendLabel} sales volume and premium trend`}
      >
          <g transform="translate(86, 22)">
            <line x1="0" x2="34" y1="8" y2="8" stroke="#347cf4" strokeWidth="3" />
            <circle cx="17" cy="8" r="5" fill="#347cf4" />
            <text x="44" y="13" className="fill-[#40444b] text-[15px] font-semibold">
              Policies Count
            </text>
            <rect x="178" width="34" height="16" fill="#fa9d4a" />
            <text x="222" y="13" className="fill-[#40444b] text-[15px] font-semibold">
              Total Premium
            </text>
          </g>

          {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
            const y = top + plotHeight - tick * plotHeight;

            return (
              <g key={tick}>
                <line x1={left} x2={width - right} y1={y} y2={y} stroke="#d6d6d6" />
                <text x={left - 14} y={y + 5} textAnchor="end" className="fill-[#4a4f58] text-[13px]">
                  {formatAxisMoney(maxPremium * tick)}
                </text>
                <text x={width - right + 14} y={y + 5} className="fill-[#4a4f58] text-[13px]">
                  {formatInteger(maxPolicies * tick)}
                </text>
              </g>
            );
          })}

          <text
            x={22}
            y={top + plotHeight / 2}
            textAnchor="middle"
            transform={`rotate(-90 22 ${top + plotHeight / 2})`}
            className="fill-[#4d545f] text-[13px] font-semibold"
          >
            Total Premium
          </text>
          <text
            x={width - 24}
            y={top + plotHeight / 2}
            textAnchor="middle"
            transform={`rotate(-90 ${width - 24} ${top + plotHeight / 2})`}
            className="fill-[#4d545f] text-[13px] font-semibold"
          >
            Policies Count
          </text>

          {points.map((point) => (
            <g key={point.periodKey}>
              <rect
                fill="#fa9d4a"
                height={Math.max(point.barHeight, 2)}
                width={barWidth}
                x={point.centerX - barWidth / 2}
                y={point.barY}
              />
              <text x={point.centerX} y={Math.max(point.barY - 10, top + 16)} textAnchor="middle" className="fill-[#252a31] text-[15px] font-bold">
                {formatCurrencyShort(point.totalPremium)}
              </text>
              <text x={point.centerX} y={top + plotHeight + 30} textAnchor="middle" className="fill-[#3e444d] text-[13px] font-semibold">
                {point.monthKey}
              </text>
            </g>
          ))}

          <path
            d={points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.centerX} ${point.policyY}`).join(" ")}
            fill="none"
            stroke="#347cf4"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="3"
          />

          {points.map((point) => (
            <g key={`${point.periodKey}-policy`}>
              <circle cx={point.centerX} cy={point.policyY} fill="#347cf4" r="5" />
              <text x={point.centerX} y={point.policyY - 12} textAnchor="middle" className="fill-[#347cf4] text-[15px] font-bold">
                {formatInteger(point.policyCount)}
              </text>
            </g>
          ))}
      </svg>
    </div>
  );
}

function MonthlySalesMomGrowthTable({
  rows,
  trendLevel,
}: {
  rows: MonthlySummary[];
  trendLevel: TrendLevel;
}) {
  const periodLabel = getTrendLevelLabel(trendLevel);
  const changeLabel = getTrendChangeLabel(trendLevel);

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold leading-tight text-[#16233a]">
          Portfolio Growth by {periodLabel} | Policies &amp; Premium {changeLabel}
        </h2>
      </div>

      <article className="agent-health-panel">
        {rows.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-[#667085]">
            No sales periods.
          </div>
        ) : (
          <div
            className="overflow-y-auto overflow-x-hidden"
            style={{ maxHeight: SALES_MOM_SCROLL_MAX_HEIGHT }}
          >
            <table className="w-full table-fixed text-[13px] text-[#344054]">
              <thead>
                <tr className="border-b border-[#d8dee7] bg-[#f8fafc] text-left text-xs font-semibold uppercase text-[#667085]">
                  <MoMHeaderCell className="sticky left-0 top-0 z-30 w-[10%] bg-[#f8fafc]">
                    {periodLabel}
                  </MoMHeaderCell>
                  <MoMHeaderCell className="top-0 w-[11%] text-right">
                    Policies
                  </MoMHeaderCell>
                  <MoMHeaderCell className="top-0 w-[11%] text-right">
                    % Policies {changeLabel}
                  </MoMHeaderCell>
                  <MoMHeaderCell className="top-0 w-[11%] text-right">
                    Total Premium
                  </MoMHeaderCell>
                  <MoMHeaderCell className="top-0 w-[11%] text-right">
                    % Premium {changeLabel}
                  </MoMHeaderCell>
                  <MoMHeaderCell className="top-0 w-[13%] text-right">
                    Total Comm
                  </MoMHeaderCell>
                  <MoMHeaderCell className="top-0 w-[11%] text-right">
                    % Comm {changeLabel}
                  </MoMHeaderCell>
                  <MoMHeaderCell className="top-0 w-[12%] text-right">
                    EPS Comm
                  </MoMHeaderCell>
                  <MoMHeaderCell className="top-0 w-[10%] text-right">
                    % EPS {changeLabel}
                  </MoMHeaderCell>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const rowBg = index % 2 === 0 ? "bg-white" : "bg-[#f8fafc]";

                  return (
                    <tr
                      className={`h-14 border-b border-[#edf0f4] ${rowBg}`}
                      key={row.periodKey}
                    >
                      <td
                        className={`sticky left-0 z-10 border-r border-[#e3e8ef] px-3 py-3 text-sm ${rowBg}`}
                      >
                        {row.monthKey}
                      </td>
                      <MoMMetricCell
                        changeLabel={changeLabel}
                        delta={row.policyChange}
                        value={formatInteger(row.policyCount)}
                      />
                      <MoMPercentCell value={row.policyChangePercent} />
                      <MoMMetricCell
                        changeLabel={changeLabel}
                        delta={row.premiumChange}
                        deltaType="currency"
                        value={formatCurrencyShort(row.totalPremium)}
                      />
                      <MoMPercentCell value={row.premiumChangePercent} />
                      <MoMMetricCell
                        changeLabel={changeLabel}
                        delta={row.commissionChange}
                        deltaType="currency"
                        value={formatCurrencyShort(row.totalCommission)}
                      />
                      <MoMPercentCell value={row.commissionChangePercent} />
                      <MoMMetricCell
                        changeLabel={changeLabel}
                        delta={row.epsCommissionChange}
                        deltaType="currency"
                        value={formatCurrencyShort(row.epsCommission)}
                      />
                      <MoMPercentCell value={row.epsCommissionChangePercent} />
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

function MoMHeaderCell({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`sticky z-20 border-r border-[#d8dee7] bg-[#f8fafc] px-2 py-2.5 font-semibold leading-tight last:border-r-0 ${className}`}
    >
      <span className="block whitespace-normal break-words">{children}</span>
    </th>
  );
}

function MoMMetricCell({
  changeLabel,
  delta,
  deltaType = "integer",
  value,
}: {
  changeLabel: string;
  delta: number | null;
  deltaType?: "integer" | "currency";
  value: string;
}) {
  const formattedDelta =
    delta == null
      ? "-"
      : deltaType === "currency"
        ? formatCurrencyShort(delta)
        : formatInteger(delta);

  return (
    <td className="border-r border-[#edf0f4] px-2 py-2.5 text-right last:border-r-0">
      <div className="font-semibold text-[#24272d]">{value}</div>
      <div className={`mt-0.5 text-[11px] ${deltaTextClassName(delta)}`}>
        {changeLabel} {formattedDelta}
      </div>
    </td>
  );
}

function MoMPercentCell({ value }: { value: number | null }) {
  return (
    <td
      className={`border-r border-[#edf0f4] px-2 py-3 text-right last:border-r-0 ${salesMomHeatmapClassName(
        value
      )}`}
    >
      {formatNullablePercent(value)}
    </td>
  );
}

function AgencyMonthSummaryTable({
  rows,
  trendLevel,
}: {
  rows: AgencyMonthRow[];
  trendLevel: TrendLevel;
}) {
  const [areAgencyRowsExpanded, setAreAgencyRowsExpanded] = useState(false);
  const monthGroups = groupAgencyMonthRows(rows);
  const heatRows = rows.filter((row) => row.monthKey);
  const heatMaxes = {
    agentCommission: maxValue(heatRows, (row) => row.agentCommission),
    agentRate: maxValue(heatRows, (row) =>
      percentOf(row.agentCommission, row.totalPremium)
    ),
    epsCommission: maxValue(heatRows, (row) => row.epsCommission),
    epsRate: maxValue(heatRows, (row) =>
      percentOf(row.epsCommission, row.totalPremium)
    ),
    totalCommission: maxValue(heatRows, (row) => row.totalCommission),
    totalRate: maxValue(heatRows, (row) =>
      percentOf(row.totalCommission, row.totalPremium)
    ),
  };
  const periodLabel = getTrendLevelLabel(trendLevel);
  const hasAgencyRows = monthGroups.some((group) =>
    group.rows.some((row) => !row.isTotal)
  );

  return (
    <ReportPanel title={`${getTrendLevelAdjective(trendLevel)} Sales Summary`}>
      <div className="max-h-[300px] overflow-y-auto">
        <table className="w-full table-fixed text-[11px]">
          <thead>
            <tr className="bg-[#edf3fb] text-left font-bold">
              <AgencySummaryHeaderCell bordered width="8%">
                {periodLabel}
              </AgencySummaryHeaderCell>
              <AgencySummaryHeaderCell bordered width="11%">
                <div className="flex items-center justify-between gap-2">
                  <span>Agency</span>
                  {hasAgencyRows ? (
                    <button
                      aria-expanded={areAgencyRowsExpanded}
                      aria-label={`${
                        areAgencyRowsExpanded ? "Collapse" : "Expand"
                      } agency rows`}
                      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-[#cfd7e3] bg-white text-[#184e8a] transition hover:bg-[#edf4ff]"
                      onClick={() =>
                        setAreAgencyRowsExpanded((current) => !current)
                      }
                      type="button"
                    >
                      {areAgencyRowsExpanded ? (
                        <Minus aria-hidden="true" size={12} strokeWidth={2.4} />
                      ) : (
                        <Plus aria-hidden="true" size={12} strokeWidth={2.4} />
                      )}
                    </button>
                  ) : null}
                </div>
              </AgencySummaryHeaderCell>
              <AgencySummaryHeaderCell bordered align="right" width="8%">
                Policies
              </AgencySummaryHeaderCell>
              <AgencySummaryHeaderCell bordered align="right" width="10%">
                Premium
              </AgencySummaryHeaderCell>
              <AgencySummaryHeaderCell bordered align="right" width="11%">
                Total Comm
              </AgencySummaryHeaderCell>
              <AgencySummaryHeaderCell bordered align="right" width="9%">
                % Total
              </AgencySummaryHeaderCell>
              <AgencySummaryHeaderCell bordered align="right" width="11%">
                Agent Comm
              </AgencySummaryHeaderCell>
              <AgencySummaryHeaderCell bordered align="right" width="9%">
                % Agent
              </AgencySummaryHeaderCell>
              <AgencySummaryHeaderCell bordered align="right" width="11%">
                EPS Comm
              </AgencySummaryHeaderCell>
              <AgencySummaryHeaderCell bordered align="right" width="12%">
                % EPS Comm
              </AgencySummaryHeaderCell>
            </tr>
          </thead>
          <tbody>
            {monthGroups.map((group, groupIndex) => {
              const visibleRows =
                hasAgencyRows && !areAgencyRowsExpanded
                  ? group.rows.filter((row) => row.isTotal)
                  : group.rows;

              return visibleRows.map((row, rowIndex) => (
                  <tr
                    key={`${group.monthKey}-${row.agency}-${rowIndex}`}
                    className={`${
                      row.isTotal
                        ? "bg-white"
                        : (groupIndex + rowIndex) % 2 === 0
                          ? "bg-white"
                          : "bg-[#f7f8fa]"
                    }`}
                  >
                    {rowIndex === 0 ? (
                      <td
                        className="border-r border-b border-slate-100 px-2 py-3 align-top text-sm font-semibold text-slate-700 tabular-nums"
                        rowSpan={visibleRows.length}
                      >
                        {group.monthKey}
                      </td>
                    ) : null}
                    <AgencySummaryCell bordered labelStrong={row.isTotal}>
                      {row.agency}
                    </AgencySummaryCell>
                    <AgencySummaryCell bordered align="right">
                      {formatInteger(row.policyCount)}
                    </AgencySummaryCell>
                    <AgencySummaryCell bordered align="right">
                      {formatCurrencyShort(row.totalPremium)}
                    </AgencySummaryCell>
                    <AgencySummaryHeatCell
                      bordered
                      maxValue={heatMaxes.totalCommission}
                      mode="blue"
                      value={row.totalCommission}
                    >
                      {formatCurrencyShort(row.totalCommission)}
                    </AgencySummaryHeatCell>
                    <AgencySummaryHeatCell
                      bordered
                      maxValue={heatMaxes.totalRate}
                      mode="blue"
                      value={percentOf(row.totalCommission, row.totalPremium)}
                    >
                      {formatPercent(percentOf(row.totalCommission, row.totalPremium))}
                    </AgencySummaryHeatCell>
                    <AgencySummaryHeatCell
                      bordered
                      maxValue={heatMaxes.agentCommission}
                      mode="lavender"
                      value={row.agentCommission}
                    >
                      {formatCurrencyShort(row.agentCommission)}
                    </AgencySummaryHeatCell>
                    <AgencySummaryHeatCell
                      bordered
                      maxValue={heatMaxes.agentRate}
                      mode="lavender"
                      value={percentOf(row.agentCommission, row.totalPremium)}
                    >
                      {formatPercent(percentOf(row.agentCommission, row.totalPremium))}
                    </AgencySummaryHeatCell>
                    <AgencySummaryHeatCell
                      bordered
                      maxValue={heatMaxes.epsCommission}
                      mode="pink"
                      value={row.epsCommission}
                    >
                      {formatCurrencyShort(row.epsCommission)}
                    </AgencySummaryHeatCell>
                    <AgencySummaryHeatCell
                      bordered
                      maxValue={heatMaxes.epsRate}
                      mode="pink"
                      value={percentOf(row.epsCommission, row.totalPremium)}
                    >
                      {formatPercent(percentOf(row.epsCommission, row.totalPremium))}
                    </AgencySummaryHeatCell>
                  </tr>
                ));
            })}
          </tbody>
        </table>
      </div>
    </ReportPanel>
  );
}

function groupAgencyMonthRows(rows: AgencyMonthRow[]) {
  const groups: { monthKey: string; rows: AgencyMonthRow[] }[] = [];
  const groupByMonth = new Map<string, { monthKey: string; rows: AgencyMonthRow[] }>();

  for (const row of rows) {
    const monthKey = row.monthKey || "Grand total";
    let group = groupByMonth.get(monthKey);

    if (!group) {
      group = { monthKey, rows: [] };
      groupByMonth.set(monthKey, group);
      groups.push(group);
    }

    group.rows.push(row.monthKey ? row : { ...row, agency: "All agencies" });
  }

  return groups;
}

function AgencySummaryHeaderCell({
  align = "left",
  bordered = false,
  children,
  width,
}: {
  align?: "left" | "right";
  bordered?: boolean;
  children: ReactNode;
  width: string;
}) {
  return (
    <th
      className={`border-b border-slate-200 bg-slate-50/80 px-2 py-3 align-middle text-[11px] font-semibold uppercase leading-snug tracking-[0.04em] text-slate-500 ${
        bordered ? "border-r last:border-r-0" : ""
      } ${
        align === "right" ? "text-right" : "text-left"
      }`}
      style={{ width }}
    >
      {children}
    </th>
  );
}

function AgencySummaryCell({
  align = "left",
  bordered = false,
  children,
  labelStrong = false,
}: {
  align?: "left" | "right";
  bordered?: boolean;
  children: ReactNode;
  labelStrong?: boolean;
}) {
  return (
    <td
      className={`border-b border-slate-100 px-2 py-3 align-middle text-sm text-slate-700 tabular-nums transition-colors group-hover:bg-slate-50/50 ${
        bordered ? "border-r last:border-r-0" : ""
      } ${
        align === "right" ? "text-right" : "text-left"
      } ${labelStrong ? "font-semibold text-slate-900" : ""}`}
    >
      {children}
    </td>
  );
}

function AgencySummaryHeatCell({
  bordered = false,
  children,
  maxValue,
  mode,
  value,
}: {
  bordered?: boolean;
  children: ReactNode;
  maxValue: number;
  mode: "blue" | "lavender" | "pink";
  value: number;
}) {
  return (
    <td
      className={`border-b border-slate-100 px-2 py-3 align-middle text-right text-sm tabular-nums text-slate-700 transition-colors group-hover:bg-slate-50/50 ${
        bordered ? "border-r last:border-r-0" : ""
      }`}
      style={{ backgroundColor: agencySummaryHeatColor(value, maxValue, mode) }}
    >
      {children}
    </td>
  );
}

function AgentMonthlyDashboardTable({
  agentNames,
  commissionGroups,
  premiumGroups,
  salesGroups,
  trendLevel,
}: {
  agentNames: string[];
  commissionGroups: AgentCommissionGroup[];
  premiumGroups: AgentPivotGroup[];
  salesGroups: AgentPivotGroup[];
  trendLevel: TrendLevel;
}) {
  const [areAgencyRowsExpanded, setAreAgencyRowsExpanded] = useState(false);
  const salesGroupsByMonth = new Map(
    salesGroups.map((group) => [group.monthKey, group])
  );
  const premiumGroupsByMonth = new Map(
    premiumGroups.map((group) => [group.monthKey, group])
  );
  const hasAgencyRows =
    salesGroups.some((group) => group.rows.length > 0) ||
    premiumGroups.some((group) => group.rows.length > 0) ||
    commissionGroups.some((group) => group.rows.length > 0);
  const policyGrandTotals = totalAgentPivotRows(
    salesGroups.flatMap((group) => group.rows),
    agentNames,
    "Grand total policies"
  );
  const premiumGrandTotals = totalAgentPivotRows(
    premiumGroups.flatMap((group) => group.rows),
    agentNames,
    "Grand total premium"
  );
  const commissionGrandTotals = totalCommissionPivotRows(
    commissionGroups.flatMap((group) => group.rows),
    agentNames,
    "Grand total commission"
  );
  const agentPolicyRows = salesGroups.flatMap((group) => [
    group.total,
    ...group.rows,
  ]);
  const agentPremiumRows = premiumGroups.flatMap((group) => [
    group.total,
    ...group.rows,
  ]);
  const agentCommissionRows = commissionGroups.flatMap((group) => [
    group.monthlyTotal,
    ...group.rows,
  ]);
  const agentMaxes = {
    commission: maxValue(
      [
        ...agentCommissionRows.flatMap((row) =>
          agentNames.map((agent) => row.valuesByAgent[agent] ?? 0)
        ),
        ...agentNames.map((agent) => commissionGrandTotals.valuesByAgent[agent] ?? 0),
      ],
      (value) => value
    ),
    policies: maxValue(
      [
        ...agentPolicyRows.flatMap((row) =>
          agentNames.map((agent) => row.valuesByAgent[agent] ?? 0)
        ),
        ...agentNames.map((agent) => policyGrandTotals.valuesByAgent[agent] ?? 0),
      ],
      (value) => value
    ),
    premium: maxValue(
      [
        ...agentPremiumRows.flatMap((row) =>
          agentNames.map((agent) => row.valuesByAgent[agent] ?? 0)
        ),
        ...agentNames.map((agent) => premiumGrandTotals.valuesByAgent[agent] ?? 0),
      ],
      (value) => value
    ),
  };
  const tableWidth = Math.max(760, 240 + agentNames.length * 300);

  return (
    <ReportPanel
      title={`Agent Dashboard by ${getTrendLevelLabel(trendLevel)} | Policies & Commission`}
    >
      <div className="max-h-[420px] overflow-auto">
        <table
          className="table-fixed text-[11px] tabular-nums"
          style={{ minWidth: tableWidth, width: tableWidth }}
        >
          <thead className="sticky top-0 z-20">
            <tr>
              <AgentDashboardHeaderCell
                className="border-r-2 border-slate-300 bg-slate-50"
                size="group"
                rowSpan={2}
                stickyLeft="0px"
                width="120px"
              >
                {getTrendLevelLabel(trendLevel)}
              </AgentDashboardHeaderCell>
              <AgentDashboardHeaderCell
                className="border-r-2 border-slate-300 bg-slate-50"
                rowSpan={2}
                size="group"
                stickyDivider
                stickyLeft="120px"
                width="120px"
              >
                <div className="flex items-center justify-between gap-2">
                  <span>Agency</span>
                  {hasAgencyRows ? (
                    <button
                      aria-expanded={areAgencyRowsExpanded}
                      aria-label={`${
                        areAgencyRowsExpanded ? "Collapse" : "Expand"
                      } agency rows`}
                      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-[#cfd7e3] bg-white text-[#184e8a] transition hover:bg-[#edf4ff]"
                      onClick={() =>
                        setAreAgencyRowsExpanded((current) => !current)
                      }
                      type="button"
                    >
                      {areAgencyRowsExpanded ? (
                        <Minus aria-hidden="true" size={12} strokeWidth={2.4} />
                      ) : (
                        <Plus aria-hidden="true" size={12} strokeWidth={2.4} />
                      )}
                    </button>
                  ) : null}
                </div>
              </AgentDashboardHeaderCell>
              {agentNames.map((agent) => (
                <AgentDashboardHeaderCell
                  align="center"
                  className="border-r-2 border-slate-300 bg-[#e9f2fb] text-slate-700"
                  colSpan={3}
                  groupEnd
                  key={agent}
                  size="group"
                  width="300px"
                >
                  <span className="block truncate" title={agent}>
                    {agent}
                  </span>
                </AgentDashboardHeaderCell>
              ))}
            </tr>
            <tr>
              {agentNames.map((agent) => (
                <Fragment key={agent}>
                  <AgentDashboardHeaderCell
                    align="right"
                    key={`${agent}-policies`}
                    width="100px"
                  >
                    Policies
                  </AgentDashboardHeaderCell>
                  <AgentDashboardHeaderCell
                    align="right"
                    key={`${agent}-premium`}
                    width="100px"
                  >
                    Total Premium
                  </AgentDashboardHeaderCell>
                  <AgentDashboardHeaderCell
                    align="right"
                    groupEnd
                    key={`${agent}-commission`}
                    width="100px"
                  >
                    Commission
                  </AgentDashboardHeaderCell>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {commissionGroups.map((commissionGroup, groupIndex) => (
              <AgentMonthlyDashboardRows
                agentNames={agentNames}
                commissionGroup={commissionGroup}
                groupIndex={groupIndex}
                isExpanded={areAgencyRowsExpanded}
                key={commissionGroup.monthKey}
                maxes={agentMaxes}
                premiumGroup={premiumGroupsByMonth.get(commissionGroup.monthKey)}
                salesGroup={salesGroupsByMonth.get(commissionGroup.monthKey)}
              />
            ))}
            <tr className="bg-white">
              <AgentDashboardCell
                className="border-r-2 border-slate-300 bg-white"
                labelStrong
                stickyLeft="0px"
              >
                Grand total
              </AgentDashboardCell>
              <AgentDashboardCell
                className="border-r-2 border-slate-300 bg-white"
                labelStrong
                stickyDivider
                stickyLeft="120px"
              >
                All agencies
              </AgentDashboardCell>
              {agentNames.map((agent) => (
                <Fragment key={agent}>
                  <AgentDashboardHeatCell
                    maxValue={agentMaxes.policies}
                    mode="green"
                    value={policyGrandTotals.valuesByAgent[agent] ?? 0}
                    key={`${agent}-policies`}
                  >
                    {formatInteger(policyGrandTotals.valuesByAgent[agent] ?? 0)}
                  </AgentDashboardHeatCell>
                  <AgentDashboardHeatCell
                    maxValue={agentMaxes.premium}
                    mode="blue"
                    value={premiumGrandTotals.valuesByAgent[agent] ?? 0}
                    key={`${agent}-premium`}
                  >
                    {formatCurrencyShort(
                      premiumGrandTotals.valuesByAgent[agent] ?? 0
                    )}
                  </AgentDashboardHeatCell>
                  <AgentDashboardHeatCell
                    groupEnd
                    maxValue={agentMaxes.commission}
                    mode="pink"
                    value={commissionGrandTotals.valuesByAgent[agent] ?? 0}
                    key={`${agent}-commission`}
                  >
                    {formatCurrencyShort(
                      commissionGrandTotals.valuesByAgent[agent] ?? 0
                    )}
                  </AgentDashboardHeatCell>
                </Fragment>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </ReportPanel>
  );
}

function AgentMonthlyDashboardRows({
  agentNames,
  commissionGroup,
  groupIndex,
  isExpanded,
  maxes,
  premiumGroup,
  salesGroup,
}: {
  agentNames: string[];
  commissionGroup: AgentCommissionGroup;
  groupIndex: number;
  isExpanded: boolean;
  maxes: {
    commission: number;
    policies: number;
    premium: number;
  };
  premiumGroup: AgentPivotGroup | undefined;
  salesGroup: AgentPivotGroup | undefined;
}) {
  const policyTotalRow = salesGroup?.total ?? {
    agency: "Total Policies",
    grandTotal: 0,
    isTotal: true,
    valuesByAgent: emptyAgentValues(agentNames),
  };
  const premiumTotalRow = premiumGroup?.total ?? {
    agency: "Total Premium",
    grandTotal: 0,
    isTotal: true,
    valuesByAgent: emptyAgentValues(agentNames),
  };
  const commissionRowsByAgency = totalCommissionRowsByAgency(
    commissionGroup.rows,
    agentNames
  );
  const agencies = uniqueSorted([
    ...(salesGroup?.rows.map((row) => row.agency) ?? []),
    ...(premiumGroup?.rows.map((row) => row.agency) ?? []),
    ...commissionRowsByAgency.keys(),
  ]);
  const rows = [
    ...agencies.map((agency) => ({
      agency,
      commission:
        commissionRowsByAgency.get(agency) ?? emptyAgentCommissionRow(agency, agentNames),
      isTotal: false,
      policies:
        salesGroup?.rows.find((row) => row.agency === agency) ??
        emptyAgentPolicyRow(agency, agentNames),
      premium:
        premiumGroup?.rows.find((row) => row.agency === agency) ??
        emptyAgentPolicyRow(agency, agentNames),
    })),
    {
      agency: "Total",
      commission: commissionGroup.monthlyTotal,
      isTotal: true,
      policies: policyTotalRow,
      premium: premiumTotalRow,
    },
  ];
  const visibleRows = isExpanded ? rows : rows.filter((row) => row.isTotal);

  return (
    <>
      {visibleRows.map((row, index) => {
        const rowBackgroundClass =
          (groupIndex + index) % 2 === 0 ? "bg-white" : "bg-[#f7f8fa]";

        return (
          <tr
            className={rowBackgroundClass}
            key={`${commissionGroup.monthKey}-${row.agency}-${index}`}
          >
            {index === 0 ? (
              <td
                className="sticky left-0 z-10 border-b border-r-2 border-slate-300 border-b-slate-200 bg-white px-3 py-3 align-top text-sm font-semibold text-slate-900"
                rowSpan={visibleRows.length}
              >
                {commissionGroup.monthKey}
              </td>
            ) : null}
            <AgentDashboardCell
              className={
                rowBackgroundClass === "bg-white"
                  ? "border-r-2 border-slate-300 bg-white"
                  : "border-r-2 border-slate-300 bg-[#f7f8fa]"
              }
              labelStrong={row.isTotal}
              stickyDivider
              stickyLeft="120px"
            >
              {row.agency}
            </AgentDashboardCell>
            {agentNames.map((agent) => (
              <Fragment key={agent}>
                <AgentDashboardHeatCell
                  key={`${agent}-policies`}
                  maxValue={maxes.policies}
                  mode="green"
                  value={row.policies.valuesByAgent[agent] ?? 0}
                >
                  {formatInteger(row.policies.valuesByAgent[agent] ?? 0)}
                </AgentDashboardHeatCell>
                <AgentDashboardHeatCell
                  key={`${agent}-premium`}
                  maxValue={maxes.premium}
                  mode="blue"
                  value={row.premium.valuesByAgent[agent] ?? 0}
                >
                  {formatCurrencyShort(row.premium.valuesByAgent[agent] ?? 0)}
                </AgentDashboardHeatCell>
                <AgentDashboardHeatCell
                  groupEnd
                  key={`${agent}-commission`}
                  maxValue={maxes.commission}
                  mode="pink"
                  value={row.commission.valuesByAgent[agent] ?? 0}
                >
                  {formatCurrencyShort(row.commission.valuesByAgent[agent] ?? 0)}
                </AgentDashboardHeatCell>
              </Fragment>
            ))}
          </tr>
        );
      })}
    </>
  );
}

function AgentDashboardHeaderCell({
  align = "left",
  children,
  className = "",
  colSpan,
  groupEnd = false,
  rowSpan,
  size = "metric",
  stickyDivider = false,
  stickyLeft,
  width,
}: {
  align?: "center" | "left" | "right";
  children: ReactNode;
  className?: string;
  colSpan?: number;
  groupEnd?: boolean;
  rowSpan?: number;
  size?: "group" | "metric";
  stickyDivider?: boolean;
  stickyLeft?: string;
  width?: string;
}) {
  return (
    <th
      className={`border-b border-b-slate-200 font-semibold uppercase tracking-[0.04em] text-slate-500 ${
        size === "group" ? "px-3 py-3 text-[11px]" : "px-2 py-2.5 text-[10px]"
      } ${
        groupEnd || stickyDivider
          ? "border-r-2 border-slate-300"
          : "border-r border-slate-200"
      } ${
        stickyLeft ? "sticky z-30" : ""
      } ${className || "bg-slate-50"} ${
        align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left"
      }`}
      colSpan={colSpan}
      rowSpan={rowSpan}
      style={{ ...(stickyLeft ? { left: stickyLeft } : {}), ...(width ? { width } : {}) }}
    >
      {children}
    </th>
  );
}

function AgentDashboardCell({
  align = "left",
  children,
  className = "",
  colSpan,
  labelStrong = false,
  stickyDivider = false,
  stickyLeft,
}: {
  align?: "left" | "right";
  children?: ReactNode;
  className?: string;
  colSpan?: number;
  labelStrong?: boolean;
  stickyDivider?: boolean;
  stickyLeft?: string;
}) {
  return (
    <td
      className={`border-b border-b-slate-200 px-3 py-3 align-middle text-sm tabular-nums text-slate-700 ${
        stickyDivider ? "border-r-2 border-slate-300" : "border-r border-slate-100"
      } ${
        stickyLeft ? "sticky z-20" : ""
      } ${className} ${
        align === "right" ? "text-right" : "text-left"
      } ${labelStrong ? "font-semibold text-slate-900" : ""}`}
      colSpan={colSpan}
      style={stickyLeft ? { left: stickyLeft } : undefined}
    >
      {children}
    </td>
  );
}

function AgentDashboardHeatCell({
  children,
  groupEnd = false,
  maxValue,
  mode,
  value,
}: {
  children: ReactNode;
  groupEnd?: boolean;
  maxValue: number;
  mode: "blue" | "green" | "pink";
  value: number;
}) {
  return (
    <td
      className={`border-b border-b-slate-200 px-2 py-3 text-right text-sm tabular-nums text-slate-700 ${
        groupEnd ? "border-r-2 border-slate-300" : "border-r border-slate-100"
      }`}
      style={{ backgroundColor: agentDashboardHeatColor(value, maxValue, mode) }}
    >
      {children}
    </td>
  );
}

function AgentPerformanceTable({
  averageMonthCount,
  rows,
}: {
  averageMonthCount: number;
  rows: AgentPerformanceRow[];
}) {
  const total = rows.reduce(
    (result, row) => ({
      activePolicyCount: result.activePolicyCount + row.activePolicyCount,
      agentCommission: result.agentCommission + row.agentCommission,
      epsCommission: result.epsCommission + row.epsCommission,
      policyCount: result.policyCount + row.policyCount,
      renewalPolicyCount: result.renewalPolicyCount + row.renewalPolicyCount,
      totalCommission: result.totalCommission + row.totalCommission,
      totalPremium: result.totalPremium + row.totalPremium,
    }),
    emptySummary()
  );
  const totalAverageAgentCommissionPerMonth =
    averageMonthCount > 0
      ? total.agentCommission / averageMonthCount
      : 0;
  const maxes = {
    agentCommission: maxValue(rows, (row) => row.agentCommission),
    averageAgentCommissionPerMonth: Math.max(
      totalAverageAgentCommissionPerMonth,
      maxValue(rows, (row) => row.averageAgentCommissionPerMonth)
    ),
    commission: maxValue(rows, (row) => row.totalCommission),
    epsCommission: maxValue(rows, (row) => row.epsCommission),
    policies: maxValue(rows, (row) => row.policyCount),
    premium: maxValue(rows, (row) => row.totalPremium),
    rate: Math.max(
      percentOf(total.totalCommission, total.totalPremium),
      maxValue(rows, (row) => row.averageCommissionRate)
    ),
    share: maxValue(rows, (row) => row.policySharePercent),
  };

  return (
    <ReportPanel
      action={
        <span className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-500 shadow-sm">
          {formatInteger(total.policyCount)} historical policies /{" "}
          {formatInteger(averageMonthCount)} data months
        </span>
      }
      title="Agent Performance | All History"
    >
      {rows.length === 0 ? (
        <div className="px-6 py-12 text-center text-sm font-medium text-slate-500">
          No agent performance data.
        </div>
      ) : (
        <div
          className="overflow-y-auto overflow-x-hidden"
          style={{ maxHeight: AGENT_PERFORMANCE_TABLE_MAX_HEIGHT }}
        >
          <table className="w-full table-fixed text-[11px] tabular-nums">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#edf3fb] text-left font-bold">
                <CarrierHeaderCell width="15%">Agent</CarrierHeaderCell>
                <CarrierHeaderCell align="right" tone="green" width="8%">Share</CarrierHeaderCell>
                <CarrierHeaderCell align="right" tone="green" width="8%">Policies</CarrierHeaderCell>
                <CarrierHeaderCell align="right" tone="amber" width="13%">Premium</CarrierHeaderCell>
                <CarrierHeaderCell align="right" tone="blue" width="13%">Commission</CarrierHeaderCell>
                <CarrierHeaderCell align="right" tone="lavender" width="11%">Agent Comm</CarrierHeaderCell>
                <CarrierHeaderCell align="right" tone="lavender" width="11%">Avg Comm / Mo</CarrierHeaderCell>
                <CarrierHeaderCell align="right" tone="blue" width="10%">EPS Comm</CarrierHeaderCell>
                <CarrierHeaderCell align="right" tone="lavender" width="11%">Avg Rate</CarrierHeaderCell>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr
                  className={index % 2 === 0 ? "bg-white" : "bg-[#f7f8fa]"}
                  key={row.agent}
                >
                  <CarrierBodyCell strong>{row.agent}</CarrierBodyCell>
                  <CarrierHeatCell
                    maxValue={maxes.share}
                    mode="green"
                    value={row.policySharePercent}
                  >
                    {formatPercent(row.policySharePercent)}
                  </CarrierHeatCell>
                  <CarrierHeatCell
                    maxValue={maxes.policies}
                    mode="green"
                    value={row.policyCount}
                  >
                    {formatInteger(row.policyCount)}
                  </CarrierHeatCell>
                  <CarrierHeatCell
                    maxValue={maxes.premium}
                    mode="amber"
                    value={row.totalPremium}
                  >
                    {formatCurrencyShort(row.totalPremium)}
                  </CarrierHeatCell>
                  <CarrierHeatCell
                    maxValue={maxes.commission}
                    mode="blue"
                    value={row.totalCommission}
                  >
                    {formatCurrencyShort(row.totalCommission)}
                  </CarrierHeatCell>
                  <CarrierHeatCell
                    maxValue={maxes.agentCommission}
                    mode="lavender"
                    value={row.agentCommission}
                  >
                    {formatCurrencyShort(row.agentCommission)}
                  </CarrierHeatCell>
                  <CarrierHeatCell
                    maxValue={maxes.averageAgentCommissionPerMonth}
                    mode="lavender"
                    value={row.averageAgentCommissionPerMonth}
                  >
                    {formatCurrencyShort(row.averageAgentCommissionPerMonth)}
                  </CarrierHeatCell>
                  <CarrierHeatCell
                    maxValue={maxes.epsCommission}
                    mode="blue"
                    value={row.epsCommission}
                  >
                    {formatCurrencyShort(row.epsCommission)}
                  </CarrierHeatCell>
                  <CarrierHeatCell
                    maxValue={maxes.rate}
                    mode="lavender"
                    value={row.averageCommissionRate}
                  >
                    {formatPercent(row.averageCommissionRate)}
                  </CarrierHeatCell>
                </tr>
              ))}
              <tr className="bg-[#f8fafc] font-bold">
                <CarrierBodyCell strong>Grand total</CarrierBodyCell>
                <CarrierHeatCell maxValue={100} mode="green" strong value={100}>
                  100%
                </CarrierHeatCell>
                <CarrierHeatCell
                  maxValue={maxes.policies}
                  mode="green"
                  strong
                  value={total.policyCount}
                >
                  {formatInteger(total.policyCount)}
                </CarrierHeatCell>
                <CarrierHeatCell
                  maxValue={maxes.premium}
                  mode="amber"
                  strong
                  value={total.totalPremium}
                >
                  {formatCurrencyShort(total.totalPremium)}
                </CarrierHeatCell>
                <CarrierHeatCell
                  maxValue={maxes.commission}
                  mode="blue"
                  strong
                  value={total.totalCommission}
                >
                  {formatCurrencyShort(total.totalCommission)}
                </CarrierHeatCell>
                <CarrierHeatCell
                  maxValue={maxes.agentCommission}
                  mode="lavender"
                  strong
                  value={total.agentCommission}
                >
                  {formatCurrencyShort(total.agentCommission)}
                </CarrierHeatCell>
                <CarrierHeatCell
                  maxValue={maxes.averageAgentCommissionPerMonth}
                  mode="lavender"
                  strong
                  value={totalAverageAgentCommissionPerMonth}
                >
                  {formatCurrencyShort(totalAverageAgentCommissionPerMonth)}
                </CarrierHeatCell>
                <CarrierHeatCell
                  maxValue={maxes.epsCommission}
                  mode="blue"
                  strong
                  value={total.epsCommission}
                >
                  {formatCurrencyShort(total.epsCommission)}
                </CarrierHeatCell>
                <CarrierHeatCell
                  maxValue={maxes.rate}
                  mode="lavender"
                  strong
                  value={percentOf(total.totalCommission, total.totalPremium)}
                >
                  {formatPercent(percentOf(total.totalCommission, total.totalPremium))}
                </CarrierHeatCell>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </ReportPanel>
  );
}

function CarrierDashboardTable({ rows }: { rows: CarrierRow[] }) {
  const total = rows.reduce(
    (result, row) => ({
      activePolicyCount: 0,
      agentCommission: result.agentCommission + row.agentCommission,
      epsCommission: result.epsCommission + row.epsCommission,
      policyCount: result.policyCount + row.policyCount,
      renewalPolicyCount: 0,
      totalCommission: result.totalCommission + row.totalCommission,
      totalPremium: result.totalPremium + row.totalPremium,
    }),
    emptySummary()
  );
  const maxCommission = maxValue(rows, (row) => row.totalCommission);
  const maxPolicyCount = maxValue(rows, (row) => row.policyCount);
  const maxPolicyShare = maxValue(rows, (row) => row.policySharePercent);
  const maxPremium = maxValue(rows, (row) => row.totalPremium);
  const maxRate = Math.max(
    percentOf(total.totalCommission, total.totalPremium),
    maxValue(rows, (row) => row.averageCommissionRate)
  );

  return (
    <ReportPanel title="Carrier Performance">
      <div
        className="overflow-y-auto overflow-x-hidden"
        style={{ maxHeight: CARRIER_TABLE_MAX_HEIGHT }}
      >
        <table className="w-full table-fixed text-[11px] tabular-nums">
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#edf3fb] text-left font-bold">
              <CarrierHeaderCell width="21%">Company</CarrierHeaderCell>
              <CarrierHeaderCell align="right" tone="green" width="12%">Share</CarrierHeaderCell>
              <CarrierHeaderCell align="right" tone="green" width="13%">Policies</CarrierHeaderCell>
              <CarrierHeaderCell align="right" tone="amber" width="18%">Premium</CarrierHeaderCell>
              <CarrierHeaderCell align="right" tone="blue" width="20%">Commission</CarrierHeaderCell>
              <CarrierHeaderCell align="right" tone="lavender" width="16%">Avg Rate</CarrierHeaderCell>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.company} className={index % 2 === 0 ? "bg-white" : "bg-[#f7f8fa]"}>
                <CarrierBodyCell strong>{row.company}</CarrierBodyCell>
                <CarrierHeatCell
                  maxValue={maxPolicyShare}
                  mode="green"
                  value={row.policySharePercent}
                >
                  {formatPercent(row.policySharePercent)}
                </CarrierHeatCell>
                <CarrierHeatCell
                  maxValue={maxPolicyCount}
                  mode="green"
                  value={row.policyCount}
                >
                  {formatInteger(row.policyCount)}
                </CarrierHeatCell>
                <CarrierHeatCell
                  maxValue={maxPremium}
                  mode="amber"
                  value={row.totalPremium}
                >
                  {formatCurrency(row.totalPremium)}
                </CarrierHeatCell>
                <CarrierHeatCell
                  maxValue={maxCommission}
                  mode="blue"
                  value={row.totalCommission}
                >
                  {formatCurrency(row.totalCommission)}
                </CarrierHeatCell>
                <CarrierHeatCell
                  maxValue={maxRate}
                  mode="lavender"
                  value={row.averageCommissionRate}
                >
                  {formatPercent(row.averageCommissionRate)}
                </CarrierHeatCell>
              </tr>
            ))}
            <tr className="bg-[#f8fafc] font-bold">
              <CarrierBodyCell strong>Grand total</CarrierBodyCell>
              <CarrierHeatCell
                maxValue={100}
                mode="green"
                strong
                value={100}
              >
                100%
              </CarrierHeatCell>
              <CarrierHeatCell
                maxValue={maxPolicyCount}
                mode="green"
                strong
                value={total.policyCount}
              >
                {formatInteger(total.policyCount)}
              </CarrierHeatCell>
              <CarrierHeatCell
                maxValue={maxPremium}
                mode="amber"
                strong
                value={total.totalPremium}
              >
                {formatCurrency(total.totalPremium)}
              </CarrierHeatCell>
              <CarrierHeatCell
                maxValue={maxCommission}
                mode="blue"
                strong
                value={total.totalCommission}
              >
                {formatCurrency(total.totalCommission)}
              </CarrierHeatCell>
              <CarrierHeatCell
                maxValue={maxRate}
                mode="lavender"
                strong
                value={percentOf(total.totalCommission, total.totalPremium)}
              >
                {formatPercent(percentOf(total.totalCommission, total.totalPremium))}
              </CarrierHeatCell>
            </tr>
          </tbody>
        </table>
      </div>
    </ReportPanel>
  );
}

function StateCityPerformanceTable({ groups }: { groups: StateGroup[] }) {
  const cityRows = groups
    .flatMap((group) => group.rows.filter((row) => !row.isTotal))
    .sort(
      (left, right) =>
        right.policyCount - left.policyCount ||
        right.totalPremium - left.totalPremium ||
        left.state.localeCompare(right.state) ||
        left.city.localeCompare(right.city)
    );
  const maxes = {
    commission: maxValue(cityRows, (row) => row.totalCommission),
    policyCount: maxValue(cityRows, (row) => row.policyCount),
    premium: maxValue(cityRows, (row) => row.totalPremium),
    share: maxValue(cityRows, (row) => row.policySharePercent),
  };

  return (
    <ReportPanel title="State & City Performance">
      <div
        className="overflow-y-auto overflow-x-hidden"
        style={{ maxHeight: STATE_CITY_TABLE_MAX_HEIGHT }}
      >
        <table className="w-full table-fixed text-[11px] tabular-nums">
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#edf3fb] text-left font-bold">
              <CarrierHeaderCell width="9%">State</CarrierHeaderCell>
              <CarrierHeaderCell width="27%">City</CarrierHeaderCell>
              <CarrierHeaderCell align="right" tone="green" width="14%">Policies</CarrierHeaderCell>
              <CarrierHeaderCell align="right" tone="green" width="13%">Share</CarrierHeaderCell>
              <CarrierHeaderCell align="right" tone="amber" width="16%">Premium</CarrierHeaderCell>
              <CarrierHeaderCell align="right" tone="blue" width="21%">Commission</CarrierHeaderCell>
            </tr>
          </thead>
          <tbody>
            {cityRows.map((row, index) => (
              <tr
                key={`${row.state}-${row.city}-${index}`}
                className={index % 2 === 0 ? "bg-white" : "bg-[#f7f8fa]"}
              >
                  <CarrierBodyCell strong>{row.state}</CarrierBodyCell>
                  <CarrierBodyCell>{row.city}</CarrierBodyCell>
                  <CarrierHeatCell
                    maxValue={maxes.policyCount}
                    mode="green"
                    value={row.policyCount}
                  >
                    {formatInteger(row.policyCount)}
                  </CarrierHeatCell>
                  <CarrierHeatCell
                    maxValue={maxes.share}
                    mode="green"
                    value={row.policySharePercent}
                  >
                    {formatPercent(row.policySharePercent)}
                  </CarrierHeatCell>
                  <CarrierHeatCell
                    maxValue={maxes.premium}
                    mode="amber"
                    value={row.totalPremium}
                  >
                    {formatCurrencyShort(row.totalPremium)}
                  </CarrierHeatCell>
                  <CarrierHeatCell
                    maxValue={maxes.commission}
                    mode="blue"
                    value={row.totalCommission}
                  >
                    {formatCurrencyShort(row.totalCommission)}
                  </CarrierHeatCell>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ReportPanel>
  );
}

function CarrierHeaderCell({
  align = "left",
  children,
  tone = "base",
  width,
}: {
  align?: "left" | "right";
  children: ReactNode;
  tone?: "amber" | "base" | "blue" | "green" | "lavender";
  width: string;
}) {
  return (
    <th
      className={`border-r border-b border-slate-300 px-2 py-3 align-middle text-[11px] font-semibold uppercase leading-tight tracking-[0.02em] text-slate-600 last:border-r-0 ${carrierHeaderToneClassName(
        tone
      )} ${align === "right" ? "text-right" : "text-left"}`}
      style={{ width }}
    >
      {children}
    </th>
  );
}

function CarrierBodyCell({
  align = "left",
  children,
  strong = false,
}: {
  align?: "left" | "right";
  children: ReactNode;
  strong?: boolean;
}) {
  return (
    <td
      className={`border-r border-b border-slate-200 bg-[#f8fafc] px-3 py-3 align-middle text-[13px] text-slate-700 last:border-r-0 ${
        align === "right" ? "text-right" : "text-left"
      } ${strong ? "font-semibold text-slate-900" : ""}`}
    >
      {children}
    </td>
  );
}

function CarrierHeatCell({
  children,
  maxValue,
  mode,
  strong = false,
  value,
}: {
  children: ReactNode;
  maxValue: number;
  mode: "amber" | "blue" | "green" | "lavender";
  strong?: boolean;
  value: number;
}) {
  return (
    <td
      className={`border-r border-b border-slate-200 px-3 py-3 align-middle text-right text-[13px] text-slate-700 last:border-r-0 ${
        strong ? "font-semibold text-slate-900" : ""
      }`}
      style={{ backgroundColor: carrierHeatColor(value, maxValue, mode) }}
    >
      {children}
    </td>
  );
}

function ExpiredPolicyTrendChart({ rows }: { rows: ExpiredMonthRow[] }) {
  const width = 1280;
  const height = 360;
  const left = 76;
  const right = 86;
  const top = 56;
  const bottom = 56;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const maxPremium = roundAxisMax(maxValue(rows, (row) => row.totalPremium));
  const maxPolicies = roundAxisMax(maxValue(rows, (row) => row.policyCount));
  const groupWidth = plotWidth / Math.max(rows.length, 1);
  const barWidth = Math.min(80, groupWidth * 0.7);
  const points = rows.map((row, index) => {
    const centerX = left + index * groupWidth + groupWidth / 2;
    const barHeight = (row.totalPremium / maxPremium) * plotHeight;

    return {
      ...row,
      barHeight,
      barY: top + plotHeight - barHeight,
      centerX,
      policyY: top + plotHeight - (row.policyCount / maxPolicies) * plotHeight,
    };
  });

  return (
    <ReportPanel title="Monthly Expired Policy">
      <div className="overflow-x-auto">
        <svg className="min-w-[1120px]" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Monthly expired policy">
          <g transform="translate(86, 20)">
            <rect x="0" width="34" height="16" fill="#ff8a00" />
            <text x="44" y="13" className="fill-[#40444b] text-[15px] font-semibold">
              Total Premium
            </text>
            <line x1="196" x2="230" y1="8" y2="8" stroke="#347cf4" strokeWidth="3" />
            <circle cx="213" cy="8" r="5" fill="#347cf4" />
            <text x="240" y="13" className="fill-[#40444b] text-[15px] font-semibold">
              # Policy
            </text>
          </g>

          {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
            const y = top + plotHeight - tick * plotHeight;

            return (
              <g key={tick}>
                <line x1={left} x2={width - right} y1={y} y2={y} stroke="#d6d6d6" />
                <text x={left - 14} y={y + 5} textAnchor="end" className="fill-[#4a4f58] text-[13px]">
                  {formatAxisMoney(maxPremium * tick)}
                </text>
                <text x={width - right + 14} y={y + 5} className="fill-[#4a4f58] text-[13px]">
                  {formatInteger(maxPolicies * tick)}
                </text>
              </g>
            );
          })}

          {points.map((point) => (
            <g key={point.monthKey}>
              <rect fill="#ff8a00" height={Math.max(point.barHeight, 2)} width={barWidth} x={point.centerX - barWidth / 2} y={point.barY} />
              <text x={point.centerX} y={Math.max(point.barY + 24, top + 20)} textAnchor="middle" className="fill-white text-[16px] font-bold">
                {formatCurrencyShort(point.totalPremium)}
              </text>
              <text x={point.centerX} y={top + plotHeight + 30} textAnchor="middle" className="fill-[#3e444d] text-[13px] font-semibold">
                {point.monthKey}
              </text>
            </g>
          ))}

          <path
            d={points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.centerX} ${point.policyY}`).join(" ")}
            fill="none"
            stroke="#347cf4"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="3"
          />
          {points.map((point) => (
            <g key={`${point.monthKey}-policy`}>
              <circle cx={point.centerX} cy={point.policyY} fill="#347cf4" r="5" />
              <text x={point.centerX} y={point.policyY - 12} textAnchor="middle" className="fill-[#347cf4] text-[16px] font-bold">
                {formatInteger(point.policyCount)}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </ReportPanel>
  );
}

function PolicyDetailsTable({ rows }: { rows: PolicyDetailRow[] }) {
  const [agentFilter, setAgentFilter] = useState<string[]>([]);
  const [agencyFilter, setAgencyFilter] = useState<string[]>([]);
  const [insuredFilter, setInsuredFilter] = useState<string[]>([]);
  const [policyFilter, setPolicyFilter] = useState<string[]>([]);
  const [stateFilter, setStateFilter] = useState<string[]>([]);
  const [cityFilter, setCityFilter] = useState<string[]>([]);
  const [companyFilter, setCompanyFilter] = useState<string[]>([]);
  const [effectiveDateRange, setEffectiveDateRange] = useState<DateRange | null>(null);
  const [expiredDateRange, setExpiredDateRange] = useState<DateRange | null>(null);
  const [sortState, setPolicySortState] = useState<PolicySortState | null>(null);
  const [activePanel, setActivePanel] = useState<PolicySortKey | null>(null);

  const agentOptions = useMemo(() => getPolicyFilterOptions(rows.map((r) => r.agent)), [rows]);
  const agencyOptions = useMemo(() => getPolicyFilterOptions(rows.map((r) => r.agency)), [rows]);
  const insuredOptions = useMemo(() => getPolicyFilterOptions(rows.map((r) => r.insuredName)), [rows]);
  const policyOptions = useMemo(() => getPolicyFilterOptions(rows.map((r) => r.policyNumber)), [rows]);
  const stateOptions = useMemo(() => getPolicyFilterOptions(rows.map((r) => r.state)), [rows]);
  const cityOptions = useMemo(() => getPolicyFilterOptions(rows.map((r) => r.city)), [rows]);
  const companyOptions = useMemo(() => getPolicyFilterOptions(rows.map((r) => r.company)), [rows]);

  const hasActiveFilters =
    agentFilter.length > 0 || agencyFilter.length > 0 || insuredFilter.length > 0 ||
    policyFilter.length > 0 || stateFilter.length > 0 || cityFilter.length > 0 ||
    companyFilter.length > 0 || effectiveDateRange !== null || expiredDateRange !== null ||
    Boolean(sortState);

  const filteredRows = useMemo(() => {
    const result = rows.filter((row) => {
      if (agentFilter.length > 0 && !agentFilter.includes(row.agent)) return false;
      if (agencyFilter.length > 0 && !agencyFilter.includes(row.agency)) return false;
      if (insuredFilter.length > 0 && !insuredFilter.includes(row.insuredName)) return false;
      if (policyFilter.length > 0 && !policyFilter.includes(row.policyNumber)) return false;
      if (stateFilter.length > 0 && !stateFilter.includes(row.state)) return false;
      if (cityFilter.length > 0 && !cityFilter.includes(row.city)) return false;
      if (companyFilter.length > 0 && !companyFilter.includes(row.company)) return false;
      if (effectiveDateRange) {
        const d = row.effectiveDate ?? "";
        if (effectiveDateRange.from && d < effectiveDateRange.from) return false;
        if (effectiveDateRange.to && d > effectiveDateRange.to) return false;
      }
      if (expiredDateRange) {
        const d = row.expiredDate ?? "";
        if (expiredDateRange.from && d < expiredDateRange.from) return false;
        if (expiredDateRange.to && d > expiredDateRange.to) return false;
      }
      return true;
    });

    if (sortState) {
      result.sort((a, b) => {
        const aVal = getSalesPolicySortValue(a, sortState.key);
        const bVal = getSalesPolicySortValue(b, sortState.key);
        const mult = sortState.direction === "asc" ? 1 : -1;
        if (typeof aVal === "number" && typeof bVal === "number") return (aVal - bVal) * mult;
        return String(aVal).localeCompare(String(bVal)) * mult;
      });
    }

    return result;
  }, [rows, agentFilter, agencyFilter, insuredFilter, policyFilter, stateFilter, cityFilter, companyFilter, effectiveDateRange, expiredDateRange, sortState]);

  useEffect(() => {
    if (!activePanel) return;

    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Element && event.target.closest("[data-pc-sales-policy-filter]")) return;
      setActivePanel(null);
    }

    function closeEsc(event: KeyboardEvent) {
      if (event.key === "Escape") setActivePanel(null);
    }

    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeEsc);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeEsc);
    };
  }, [activePanel]);

  function toggle(key: PolicySortKey) {
    setActivePanel((cur) => (cur === key ? null : key));
  }

  function doSort(key: PolicySortKey, dir: SortDirection) {
    setPolicySortState({ key, direction: dir });
    setActivePanel(null);
  }

  function clearAll() {
    setAgentFilter([]); setAgencyFilter([]); setInsuredFilter([]);
    setPolicyFilter([]); setStateFilter([]); setCityFilter([]);
    setCompanyFilter([]); setEffectiveDateRange(null); setExpiredDateRange(null);
    setPolicySortState(null); setActivePanel(null);
  }

  function exportFilteredRows() {
    exportPolicyDetailsRows(filteredRows);
  }

  return (
    <ReportPanel title="Policy Detail">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <p className="text-xs text-slate-500">
          Showing {formatInteger(filteredRows.length)} of {formatInteger(rows.length)} policies
        </p>
        <div className="flex items-center gap-2">
          <button
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#cfd7e3] bg-white px-3 text-xs font-semibold text-[#344054] transition hover:bg-[#f3f6fa] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={filteredRows.length === 0}
            onClick={exportFilteredRows}
            type="button"
          >
            <FileDown aria-hidden="true" size={14} strokeWidth={2.2} />
            Export XLSX
          </button>
          <button
            className="h-8 rounded-md border border-[#cfd7e3] bg-white px-3 text-xs font-semibold text-[#344054] transition hover:bg-[#f3f6fa] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!hasActiveFilters}
            onClick={clearAll}
            type="button"
          >
            Clear Filters
          </button>
        </div>
      </div>
      <div className="overflow-auto" style={{ maxHeight: POLICY_DETAIL_TABLE_MAX_HEIGHT }}>
        <table className="text-[12px] tabular-nums">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="whitespace-nowrap border-b border-slate-200 bg-slate-50 px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500" style={{ width: 44 }}>
                #
              </th>
              <HeaderCell width={100}>
                <PolicyFilterableHeader active={agentFilter.length > 0 || sortState?.key === "agent"} isOpen={activePanel === "agent"} label="Agent" onToggle={() => toggle("agent")}>
                  <PolicyExcelFilterPanel label="Agent" options={agentOptions} selectedValues={agentFilter} onApply={setAgentFilter} onCancel={() => setActivePanel(null)} onClearFilter={() => setAgentFilter([])} onSort={(d) => doSort("agent", d)} />
                </PolicyFilterableHeader>
              </HeaderCell>
              <HeaderCell width={100}>
                <PolicyFilterableHeader active={agencyFilter.length > 0 || sortState?.key === "agency"} isOpen={activePanel === "agency"} label="Agency" onToggle={() => toggle("agency")}>
                  <PolicyExcelFilterPanel label="Agency" options={agencyOptions} selectedValues={agencyFilter} onApply={setAgencyFilter} onCancel={() => setActivePanel(null)} onClearFilter={() => setAgencyFilter([])} onSort={(d) => doSort("agency", d)} />
                </PolicyFilterableHeader>
              </HeaderCell>
              <HeaderCell width={160}>
                <PolicyFilterableHeader active={insuredFilter.length > 0 || sortState?.key === "insuredName"} isOpen={activePanel === "insuredName"} label="Insured Name" onToggle={() => toggle("insuredName")}>
                  <PolicyExcelFilterPanel label="Insured Name" options={insuredOptions} selectedValues={insuredFilter} onApply={setInsuredFilter} onCancel={() => setActivePanel(null)} onClearFilter={() => setInsuredFilter([])} onSort={(d) => doSort("insuredName", d)} />
                </PolicyFilterableHeader>
              </HeaderCell>
              <HeaderCell width={130}>
                <PolicyFilterableHeader active={policyFilter.length > 0 || sortState?.key === "policyNumber"} isOpen={activePanel === "policyNumber"} label="Policy Number" onToggle={() => toggle("policyNumber")}>
                  <PolicyExcelFilterPanel label="Policy Number" options={policyOptions} selectedValues={policyFilter} onApply={setPolicyFilter} onCancel={() => setActivePanel(null)} onClearFilter={() => setPolicyFilter([])} onSort={(d) => doSort("policyNumber", d)} />
                </PolicyFilterableHeader>
              </HeaderCell>
              <HeaderCell width={75}>
                <PolicyFilterableHeader active={stateFilter.length > 0 || sortState?.key === "state"} isOpen={activePanel === "state"} label="State" onToggle={() => toggle("state")}>
                  <PolicyExcelFilterPanel label="State" options={stateOptions} selectedValues={stateFilter} onApply={setStateFilter} onCancel={() => setActivePanel(null)} onClearFilter={() => setStateFilter([])} onSort={(d) => doSort("state", d)} />
                </PolicyFilterableHeader>
              </HeaderCell>
              <HeaderCell width={110}>
                <PolicyFilterableHeader active={cityFilter.length > 0 || sortState?.key === "city"} isOpen={activePanel === "city"} label="City" onToggle={() => toggle("city")}>
                  <PolicyExcelFilterPanel label="City" options={cityOptions} selectedValues={cityFilter} onApply={setCityFilter} onCancel={() => setActivePanel(null)} onClearFilter={() => setCityFilter([])} onSort={(d) => doSort("city", d)} />
                </PolicyFilterableHeader>
              </HeaderCell>
              <HeaderCell width={120}>
                <PolicyFilterableHeader active={companyFilter.length > 0 || sortState?.key === "company"} isOpen={activePanel === "company"} label="Company" onToggle={() => toggle("company")}>
                  <PolicyExcelFilterPanel label="Company" options={companyOptions} selectedValues={companyFilter} onApply={setCompanyFilter} onCancel={() => setActivePanel(null)} onClearFilter={() => setCompanyFilter([])} onSort={(d) => doSort("company", d)} />
                </PolicyFilterableHeader>
              </HeaderCell>
              <HeaderCell align="right" width={120}>
                <PolicyFilterableHeader active={sortState?.key === "truePremium"} align="right" isOpen={activePanel === "truePremium"} label="True Premium" onToggle={() => toggle("truePremium")}>
                  <PolicyExcelFilterPanel label="True Premium" options={[]} selectedValues={[]} onApply={() => {}} onCancel={() => setActivePanel(null)} onClearFilter={() => {}} onSort={(d) => doSort("truePremium", d)} sortAscLabel="Sort smallest to largest" sortDescLabel="Sort largest to smallest" />
                </PolicyFilterableHeader>
              </HeaderCell>
              <HeaderCell width={110}>
                <PolicyFilterableHeader active={effectiveDateRange !== null || sortState?.key === "effectiveDate"} align="right" isOpen={activePanel === "effectiveDate"} label="Effective" onToggle={() => toggle("effectiveDate")}>
                  <PolicyDateFilterPanel onApply={setEffectiveDateRange} onCancel={() => setActivePanel(null)} onClear={() => setEffectiveDateRange(null)} onSort={(d) => doSort("effectiveDate", d)} presets={effectiveDatePresets()} value={effectiveDateRange} />
                </PolicyFilterableHeader>
              </HeaderCell>
              <HeaderCell width={110}>
                <PolicyFilterableHeader active={expiredDateRange !== null || sortState?.key === "expiredDate"} align="right" isOpen={activePanel === "expiredDate"} label="Expired" onToggle={() => toggle("expiredDate")}>
                  <PolicyDateFilterPanel onApply={setExpiredDateRange} onCancel={() => setActivePanel(null)} onClear={() => setExpiredDateRange(null)} onSort={(d) => doSort("expiredDate", d)} presets={expiredDatePresets()} value={expiredDateRange} />
                </PolicyFilterableHeader>
              </HeaderCell>
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <tr>
                <td className="px-4 py-10 text-center text-sm text-slate-500" colSpan={11}>
                  No policies matched these filters.
                </td>
              </tr>
            ) : (
              filteredRows.map((row, index) => (
                <tr key={`${row.policyNumber}-${index}`} className={index % 2 === 0 ? "bg-white" : "bg-[#f7f8fa]"}>
                  <td className="border-b border-slate-100 px-3 py-3 text-right text-xs font-semibold text-slate-400 whitespace-nowrap">
                    {index + 1}
                  </td>
                  <BodyCell strong>{row.agent}</BodyCell>
                  <BodyCell>{row.agency}</BodyCell>
                  <BodyCell>{row.insuredName}</BodyCell>
                  <BodyCell>{row.policyNumber}</BodyCell>
                  <BodyCell>{row.state}</BodyCell>
                  <BodyCell>{row.city}</BodyCell>
                  <BodyCell>{row.company}</BodyCell>
                  <BodyCell align="right">{formatCurrency(row.truePremium)}</BodyCell>
                  <BodyCell>{row.effectiveDate ? formatShortDate(row.effectiveDate) : "-"}</BodyCell>
                  <BodyCell>{row.expiredDate ? formatShortDate(row.expiredDate) : "-"}</BodyCell>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </ReportPanel>
  );
}

function exportPolicyDetailsRows(rows: PolicyDetailRow[]) {
  const headers = [
    "#",
    "Agent",
    "Agency",
    "Insured Name",
    "Policy Number",
    "State",
    "City",
    "Company",
    "True Premium",
    "Effective Date",
    "Expired Date",
  ];
  const exportRows = rows.map((row, index) => [
    index + 1,
    row.agent,
    row.agency,
    row.insuredName,
    row.policyNumber,
    row.state,
    row.city,
    row.company,
    row.truePremium,
    row.effectiveDate ?? "",
    row.expiredDate ?? "",
  ]);
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...exportRows]);

  sheet["!cols"] = headers.map((header) => ({
    wch: getPolicyDetailExportColumnWidth(header),
  }));
  applyPolicyDetailExportFormats(sheet, exportRows.length);

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Policy Detail");
  XLSX.writeFile(
    workbook,
    `pc-policy-detail-${new Date().toISOString().slice(0, 10)}.xlsx`,
    { compression: true }
  );
}

function getPolicyDetailExportColumnWidth(header: string) {
  if (header === "#") return 8;
  if (header === "Insured Name") return 28;
  if (header === "Policy Number") return 22;
  if (header === "True Premium") return 16;
  if (header.endsWith("Date")) return 16;
  if (header === "Company") return 22;
  if (header === "City") return 18;
  return 14;
}

function applyPolicyDetailExportFormats(sheet: XLSX.WorkSheet, rowCount: number) {
  const truePremiumColumnIndex = 8;

  for (let rowIndex = 1; rowIndex <= rowCount; rowIndex += 1) {
    const cellAddress = XLSX.utils.encode_cell({
      c: truePremiumColumnIndex,
      r: rowIndex,
    });
    const cell = sheet[cellAddress];

    if (cell && cell.t === "n") {
      cell.z = "$#,##0.00";
    }
  }
}

function ReportPanel({
  action,
  children,
  title,
}: {
  action?: ReactNode;
  children: ReactNode;
  title: string;
}) {
  return (
    <section className="flex flex-col">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-bold leading-tight text-slate-800">
          {title}
        </h3>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-shadow duration-300 hover:shadow-md">
        {children}
      </div>
    </section>
  );
}

function PolicyFilterableHeader({
  active,
  align = "left",
  children,
  isOpen,
  label,
  onToggle,
}: {
  active: boolean;
  align?: "left" | "right";
  children: ReactNode;
  isOpen: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <div className="relative" data-pc-sales-policy-filter>
      <div className="flex items-center gap-1">
        <span className="whitespace-nowrap">{label}</span>
        <button
          aria-label={`Filter ${label}`}
          aria-pressed={active}
          className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded transition hover:bg-[#e9eef6] hover:text-[#184e8a] ${active ? "bg-[#dbeafe] text-[#184e8a]" : "text-slate-400"}`}
          onClick={onToggle}
          type="button"
        >
          <Filter aria-hidden="true" size={12} strokeWidth={2.4} />
        </button>
      </div>
      {isOpen ? (
        <div className={`absolute top-full z-50 mt-2 w-72 rounded-lg border border-[#cfd7e3] bg-white p-3 text-left text-sm normal-case font-normal tracking-normal text-[#16233a] shadow-xl ${align === "right" ? "right-0" : "left-0"}`}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

function PolicyExcelFilterPanel({
  label, onApply, onCancel, onClearFilter, onSort, options, selectedValues,
  sortAscLabel = "Sort A to Z", sortDescLabel = "Sort Z to A",
}: {
  label: string;
  onApply: (values: string[]) => void;
  onCancel: () => void;
  onClearFilter: () => void;
  onSort: (direction: SortDirection) => void;
  options: PolicyFilterOption[];
  selectedValues: string[];
  sortAscLabel?: string;
  sortDescLabel?: string;
}) {
  const optionValues = useMemo(() => options.map((o) => o.value), [options]);
  const [searchValue, setSearchValue] = useState("");
  const [draftValues, setDraftValues] = useState<string[]>(selectedValues.length > 0 ? selectedValues : optionValues);
  const draftValueSet = useMemo(() => new Set(draftValues), [draftValues]);
  const visibleOptions = useMemo(() => {
    const search = searchValue.trim().toLowerCase();
    if (!search) return options;
    return options.filter((o) => o.label.toLowerCase().includes(search));
  }, [options, searchValue]);
  const selectedVisibleCount = visibleOptions.reduce((n, o) => n + (draftValueSet.has(o.value) ? 1 : 0), 0);
  const areAllVisibleSelected = visibleOptions.length > 0 && selectedVisibleCount === visibleOptions.length;

  function toggleValue(value: string) {
    setDraftValues((cur) => {
      const next = new Set(cur);

      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }

      return [...next];
    });
  }

  function toggleVisible() {
    const visibleVals = visibleOptions.map((o) => o.value);
    const visibleSet = new Set(visibleVals);
    setDraftValues((cur) => areAllVisibleSelected ? cur.filter((v) => !visibleSet.has(v)) : [...new Set([...cur, ...visibleVals])]);
  }

  function clearFilter() { setDraftValues(optionValues); onClearFilter(); onCancel(); }

  function apply() {
    onApply(draftValues.length === optionValues.length ? [] : [...draftValues].sort((a, b) => a.localeCompare(b)));
    onCancel();
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1 border-b border-[#edf0f4] pb-2">
        <button className="block w-full rounded px-2 py-1.5 text-left text-sm font-medium text-[#344054] transition hover:bg-[#f3f6fa]" onClick={() => onSort("asc")} type="button">{sortAscLabel}</button>
        <button className="block w-full rounded px-2 py-1.5 text-left text-sm font-medium text-[#344054] transition hover:bg-[#f3f6fa]" onClick={() => onSort("desc")} type="button">{sortDescLabel}</button>
      </div>
      {options.length > 0 ? (
        <>
          <div className="flex items-center gap-2 text-xs">
            <button className="font-semibold text-[#184e8a] hover:underline" onClick={() => setDraftValues(optionValues)} type="button">Select all</button>
            <button className="font-semibold text-[#184e8a] hover:underline" onClick={clearFilter} type="button">Clear filter</button>
            <span className="ml-auto text-[#667085]">{visibleOptions.length} items</span>
          </div>
          <label className="block">
            <span className="sr-only">Search {label}</span>
            <input className="h-9 w-full rounded-md border border-[#cfd7e3] bg-white px-3 text-sm font-normal text-[#16233a] outline-none transition focus:border-[#184e8a] focus:ring-2 focus:ring-[#184e8a]/10" onChange={(e) => setSearchValue(e.target.value)} placeholder="Search values" type="search" value={searchValue} />
          </label>
          <div className="max-h-44 overflow-auto border-y border-[#edf0f4] py-1">
            {visibleOptions.length === 0 ? (
              <div className="px-2 py-3 text-sm text-[#667085]">No values found.</div>
            ) : (
              <>
                <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm font-medium text-[#344054] transition hover:bg-[#f3f6fa]">
                  <input checked={areAllVisibleSelected} className="h-4 w-4 rounded border-[#cfd7e3] text-[#184e8a] focus:ring-[#184e8a]" onChange={toggleVisible} type="checkbox" />
                  <span>(Select visible)</span>
                </label>
                {visibleOptions.map((option) => (
                  <label key={option.value} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm font-medium text-[#344054] transition hover:bg-[#f3f6fa]">
                    <input checked={draftValueSet.has(option.value)} className="h-4 w-4 rounded border-[#cfd7e3] text-[#184e8a] focus:ring-[#184e8a]" onChange={() => toggleValue(option.value)} type="checkbox" />
                    <span className="truncate" title={option.label}>{option.label}</span>
                  </label>
                ))}
              </>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button className="h-9 rounded-md border border-[#cfd7e3] bg-white px-4 text-sm font-semibold text-[#344054] transition hover:bg-[#f3f6fa]" onClick={onCancel} type="button">Cancel</button>
            <button className="h-9 rounded-md bg-[#15803d] px-4 text-sm font-semibold text-white transition hover:bg-[#166534] disabled:cursor-not-allowed disabled:bg-[#94a3b8]" disabled={draftValues.length === 0} onClick={apply} type="button">OK</button>
          </div>
        </>
      ) : (
        <div className="flex justify-end pt-1">
          <button className="h-9 rounded-md border border-[#cfd7e3] bg-white px-4 text-sm font-semibold text-[#344054] transition hover:bg-[#f3f6fa]" onClick={onCancel} type="button">Cancel</button>
        </div>
      )}
    </div>
  );
}

function PolicyDateFilterPanel({
  onApply, onCancel, onClear, onSort, presets, value,
}: {
  onApply: (range: DateRange | null) => void;
  onCancel: () => void;
  onClear: () => void;
  onSort: (direction: SortDirection) => void;
  presets: { label: string; from: string; to: string }[];
  value: DateRange | null;
}) {
  const [from, setFrom] = useState(value?.from ?? "");
  const [to, setTo] = useState(value?.to ?? "");

  function apply() { onApply(from || to ? { from, to } : null); onCancel(); }
  function clear() { setFrom(""); setTo(""); onClear(); onCancel(); }

  return (
    <div className="space-y-3">
      <div className="space-y-1 border-b border-[#edf0f4] pb-2">
        <button className="block w-full rounded px-2 py-1.5 text-left text-sm font-medium text-[#344054] transition hover:bg-[#f3f6fa]" onClick={() => onSort("asc")} type="button">Sort oldest to newest</button>
        <button className="block w-full rounded px-2 py-1.5 text-left text-sm font-medium text-[#344054] transition hover:bg-[#f3f6fa]" onClick={() => onSort("desc")} type="button">Sort newest to oldest</button>
      </div>
      {presets.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#667085]">Quick select</p>
          {presets.map((preset) => (
            <button key={preset.label} className="block w-full rounded px-2 py-1.5 text-left text-sm font-medium text-[#344054] transition hover:bg-[#f3f6fa]" onClick={() => { setFrom(preset.from); setTo(preset.to); }} type="button">{preset.label}</button>
          ))}
        </div>
      )}
      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[#667085]">Date range</p>
        <div className="space-y-1.5">
          <input className="block h-8 w-full min-w-0 rounded-md border border-[#cfd7e3] bg-white px-2 text-sm text-[#16233a] outline-none transition focus:border-[#184e8a] focus:ring-2 focus:ring-[#184e8a]/10" onChange={(e) => setFrom(e.target.value)} type="date" value={from} />
          <input className="block h-8 w-full min-w-0 rounded-md border border-[#cfd7e3] bg-white px-2 text-sm text-[#16233a] outline-none transition focus:border-[#184e8a] focus:ring-2 focus:ring-[#184e8a]/10" onChange={(e) => setTo(e.target.value)} type="date" value={to} />
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 pt-1">
        <button className="text-xs font-semibold text-[#184e8a] hover:underline" onClick={clear} type="button">Clear</button>
        <div className="flex gap-2">
          <button className="h-8 rounded-md border border-[#cfd7e3] bg-white px-3 text-sm font-semibold text-[#344054] transition hover:bg-[#f3f6fa]" onClick={onCancel} type="button">Cancel</button>
          <button className="h-8 rounded-md bg-[#15803d] px-3 text-sm font-semibold text-white transition hover:bg-[#166534]" onClick={apply} type="button">Apply</button>
        </div>
      </div>
    </div>
  );
}

function getPolicyFilterOptions(values: string[]): PolicyFilterOption[] {
  return [...new Set(values)].sort((a, b) => (a || "").localeCompare(b || "")).map((value) => ({ label: value || "(Blank)", value }));
}

function getSalesPolicySortValue(row: PolicyDetailRow, key: PolicySortKey): string | number {
  if (key === "agent") return row.agent;
  if (key === "agency") return row.agency;
  if (key === "insuredName") return row.insuredName;
  if (key === "policyNumber") return row.policyNumber;
  if (key === "state") return row.state;
  if (key === "city") return row.city;
  if (key === "company") return row.company;
  if (key === "truePremium") return row.truePremium;
  if (key === "effectiveDate") return row.effectiveDate ?? "";
  return row.expiredDate ?? "";
}

function policyToISODate(date: Date) { return date.toISOString().slice(0, 10); }
function policyAddDays(date: Date, days: number) { const r = new Date(date); r.setDate(r.getDate() + days); return r; }

function effectiveDatePresets() {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  return [
    { label: "This month", from: `${y}-${m}-01`, to: policyToISODate(new Date(y, today.getMonth() + 1, 0)) },
    { label: "Last 3 months", from: policyToISODate(policyAddDays(today, -90)), to: policyToISODate(today) },
    { label: "This year", from: `${y}-01-01`, to: `${y}-12-31` },
  ];
}

function expiredDatePresets() {
  const today = new Date();
  return [
    { label: "Already expired", from: "", to: policyToISODate(policyAddDays(today, -1)) },
    { label: "Next 30 days", from: policyToISODate(today), to: policyToISODate(policyAddDays(today, 30)) },
    { label: "Next 60 days", from: policyToISODate(today), to: policyToISODate(policyAddDays(today, 60)) },
    { label: "Next 90 days", from: policyToISODate(today), to: policyToISODate(policyAddDays(today, 90)) },
  ];
}

function HeaderCell({
  align = "left",
  children,
  colSpan,
  width,
}: {
  align?: "left" | "right";
  children?: ReactNode;
  colSpan?: number;
  width?: number;
}) {
  return (
    <th
      className={`whitespace-nowrap border-b border-slate-200 bg-slate-50 px-3 py-3 align-middle text-[11px] font-semibold uppercase tracking-wider text-slate-500 ${align === "right" ? "text-right" : "text-left"}`}
      colSpan={colSpan}
      style={width !== undefined ? { width } : undefined}
    >
      {children}
    </th>
  );
}

function BodyCell({
  align = "left",
  children,
  strong = false,
}: {
  align?: "left" | "right";
  children?: ReactNode;
  strong?: boolean;
}) {
  return (
    <td
      className={`border-b border-slate-100 px-4 py-3 align-middle text-sm text-slate-700 transition-colors group-hover:bg-slate-50/50 ${
        align === "right" ? "text-right" : "text-left"
      } ${strong ? "font-semibold text-slate-900" : ""}`}
    >
      {children}
    </td>
  );
}

function applyClientFilters(rows: PcSalesRow[], filters: FilterValues) {
  const policyNumber = filters.policyNumber.trim().toUpperCase();

  return rows.filter((row) => {
    if (
      policyNumber &&
      !cleanText(row.policy_number).toUpperCase().includes(policyNumber)
    ) {
      return false;
    }

    if (filters.agent && cleanGroupLabel(row.agent_name) !== filters.agent) {
      return false;
    }

    if (filters.agency && cleanGroupLabel(row.agency_name) !== filters.agency) {
      return false;
    }

    return true;
  });
}

function getTrendLevelLabel(trendLevel: TrendLevel) {
  if (trendLevel === "quarter") return "Quarter";
  if (trendLevel === "year") return "Year";
  return "Month";
}

function getTrendLevelAdjective(trendLevel: TrendLevel) {
  if (trendLevel === "quarter") return "Quarterly";
  if (trendLevel === "year") return "Yearly";
  return "Monthly";
}

function getTrendChangeLabel(trendLevel: TrendLevel) {
  if (trendLevel === "quarter") return "QoQ";
  if (trendLevel === "year") return "YoY";
  return "MoM";
}

function groupRows(
  rows: PcSalesRow[],
  getKey: (row: PcSalesRow) => string
) {
  const grouped = new Map<string, PcSalesRow[]>();

  for (const row of rows) {
    const key = getKey(row);
    const group = grouped.get(key) ?? [];

    group.push(row);
    grouped.set(key, group);
  }

  return grouped;
}

function groupGenericRows<T>(rows: T[], getKey: (row: T) => string) {
  const grouped = new Map<string, T[]>();

  for (const row of rows) {
    const key = getKey(row);
    const group = grouped.get(key) ?? [];

    group.push(row);
    grouped.set(key, group);
  }

  return grouped;
}

function totalAgentPivotRows(
  rows: AgentPivotRow[],
  agentNames: string[],
  agency: string
): AgentPivotRow {
  const valuesByAgent: Record<string, number> = {};

  for (const agent of agentNames) {
    valuesByAgent[agent] = rows.reduce(
      (total, row) => total + (row.valuesByAgent[agent] ?? 0),
      0
    );
  }

  return {
    agency,
    grandTotal: Object.values(valuesByAgent).reduce((total, value) => total + value, 0),
    isTotal: true,
    valuesByAgent,
  };
}

function emptyAgentValues(agentNames: string[]) {
  return Object.fromEntries(agentNames.map((agent) => [agent, 0]));
}

function emptyAgentPolicyRow(agency: string, agentNames: string[]): AgentPivotRow {
  const valuesByAgent = emptyAgentValues(agentNames);

  return {
    agency,
    grandTotal: 0,
    isTotal: false,
    valuesByAgent,
  };
}

function emptyAgentCommissionRow(
  agency: string,
  agentNames: string[]
): AgentCommissionPivotRow {
  const valuesByAgent = emptyAgentValues(agentNames);

  return {
    agency,
    grandTotal: 0,
    isTotal: false,
    statement: "",
    valuesByAgent,
  };
}

function totalCommissionRowsByAgency(
  rows: AgentCommissionPivotRow[],
  agentNames: string[]
) {
  const rowsByAgency = new Map<string, AgentCommissionPivotRow>();

  for (const [agency, agencyRows] of groupGenericRows(rows, (row) => row.agency)) {
    rowsByAgency.set(
      agency,
      totalCommissionPivotRows(agencyRows, agentNames, agency)
    );
  }

  return rowsByAgency;
}

function totalCommissionPivotRows(
  rows: AgentCommissionPivotRow[],
  agentNames: string[],
  agency: string
): AgentCommissionPivotRow {
  const valuesByAgent: Record<string, number> = {};

  for (const agent of agentNames) {
    valuesByAgent[agent] = rows.reduce(
      (total, row) => total + (row.valuesByAgent[agent] ?? 0),
      0
    );
  }

  return {
    agency,
    grandTotal: Object.values(valuesByAgent).reduce((total, value) => total + value, 0),
    isTotal: true,
    statement: "",
    valuesByAgent,
  };
}

function emptySummary(): Summary {
  return {
    activePolicyCount: 0,
    agentCommission: 0,
    epsCommission: 0,
    policyCount: 0,
    renewalPolicyCount: 0,
    totalCommission: 0,
    totalPremium: 0,
  };
}

function getPolicyId(row: PcSalesRow, index: number) {
  return cleanText(row.policy_number) || `__row_${index}`;
}

function getEffectiveMonth(row: PcSalesRow) {
  return row.effective_month_year ?? getMonthKey(row.effective_date);
}

function getMonthKey(value: string | null) {
  return value?.slice(0, 7) ?? "";
}

function getTrendPeriodKey(monthKey: string, trendLevel: TrendLevel) {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) return "";
  if (trendLevel === "year") return monthKey.slice(0, 4);
  if (trendLevel === "quarter") return getQuarterKey(monthKey);

  return monthKey;
}

function getQuarterKey(monthKey: string) {
  const year = monthKey.slice(0, 4);
  const month = Number(monthKey.slice(5, 7));
  const quarter = Math.floor((month - 1) / 3) + 1;

  return `${year}-Q${quarter}`;
}

function formatTrendPeriodLabel(periodKey: string, trendLevel: TrendLevel) {
  if (trendLevel === "quarter") return formatQuarterLabel(periodKey);

  return periodKey;
}

function formatQuarterLabel(periodKey: string) {
  const [year, quarter] = periodKey.split("-Q");

  return `Q${quarter}, ${year}`;
}



function cleanGroupLabel(value: string | null) {
  const cleanValue = cleanText(value);

  return cleanValue || "null";
}

function cleanText(value: string | null) {
  return value?.trim() || "";
}

function moneyValue(value: number | null) {
  return Number.isFinite(value ?? NaN) ? value ?? 0 : 0;
}

function uniqueSorted(values: string[]) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function percentOf(value: number, total: number) {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total === 0) return 0;

  return (value / total) * 100;
}

function calculateChangePercent(delta: number | null, previous: number | null) {
  if (delta === null || previous === null || previous === 0) return null;

  return (delta / previous) * 100;
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

function formatCurrencyCompact(value: number) {
  const absValue = Math.abs(value);

  if (absValue >= 1000000) {
    return `$${new Intl.NumberFormat("en-US", {
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
    }).format(value / 1000000)}M`;
  }

  return `$${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(value / 1000)}K`;
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

  return `${sign}${formatCurrency(absValue)}`;
}

function formatAxisMoney(value: number) {
  if (value >= 1000000) return `${formatInteger(value / 1000000)}M`;
  if (value >= 1000) return `${formatInteger(value / 1000)}K`;

  return formatInteger(value);
}

function formatPercent(value: number) {
  return `${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: Math.abs(value) >= 10 ? 1 : 0,
  }).format(value)}%`;
}

function formatNullablePercent(value: number | null) {
  return value === null ? "-" : formatPercent(value);
}

function formatMonthYear(monthKey: string) {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) return monthKey;

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(`${monthKey}-01T00:00:00Z`));
}

function deltaTextClassName(value: number | null) {
  if (value == null || value === 0) return "text-[#667085]";
  if (value > 0) return "text-[#027a48]";
  if (value < 0) return "text-[#c01048]";

  return "text-[#667085]";
}

function salesMomHeatmapClassName(value: number | null) {
  if (value == null || value === 0) return "bg-transparent";
  return value > 0 ? "bg-[#c9e8ca]" : "bg-[#f2c5c0]";
}

function agencySummaryHeatColor(
  value: number,
  maxValue: number,
  mode: "blue" | "lavender" | "pink"
) {
  if (!Number.isFinite(value) || value === 0) return "transparent";

  const intensity = Math.min(Math.abs(value) / Math.max(Math.abs(maxValue), 1), 1);

  if (mode === "blue") return rgba(73, 150, 232, 0.12 + intensity * 0.5);
  if (mode === "lavender") return rgba(137, 146, 204, 0.16 + intensity * 0.44);

  return rgba(214, 109, 211, 0.12 + intensity * 0.5);
}

function agentDashboardHeatColor(
  value: number,
  maxValue: number,
  mode: "blue" | "green" | "pink"
) {
  if (!Number.isFinite(value) || value === 0) return "transparent";

  const intensity = Math.min(Math.abs(value) / Math.max(Math.abs(maxValue), 1), 1);

  if (mode === "green") return rgba(71, 181, 82, 0.12 + intensity * 0.55);
  if (mode === "blue") return rgba(73, 150, 232, 0.12 + intensity * 0.5);

  return rgba(214, 109, 211, 0.12 + intensity * 0.5);
}

function carrierHeaderToneClassName(
  tone: "amber" | "base" | "blue" | "green" | "lavender"
) {
  if (tone === "green") return "bg-[#eef8f1] text-[#285b37]";
  if (tone === "amber") return "bg-[#fff4dc] text-[#7b4a08]";
  if (tone === "blue") return "bg-[#edf6ff] text-[#234a72]";
  if (tone === "lavender") return "bg-[#f4f0ff] text-[#4b3b7a]";

  return "bg-slate-50 text-slate-600";
}

function carrierHeatColor(
  value: number,
  maxValue: number,
  mode: "amber" | "blue" | "green" | "lavender"
) {
  if (!Number.isFinite(value) || value === 0) return "transparent";

  const intensity = Math.min(Math.abs(value) / Math.max(Math.abs(maxValue), 1), 1);

  if (mode === "green") return rgba(71, 181, 82, 0.1 + intensity * 0.42);
  if (mode === "amber") return rgba(245, 158, 11, 0.1 + intensity * 0.38);
  if (mode === "blue") return rgba(73, 150, 232, 0.12 + intensity * 0.5);

  return rgba(137, 146, 204, 0.16 + intensity * 0.44);
}

function rgba(red: number, green: number, blue: number, alpha: number) {
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(toDate(value));
}

function toDate(value: string) {
  return new Date(`${value}T00:00:00`);
}
