"use client";

import { Fragment, useMemo, useState, type ReactNode } from "react";
import { PcCommissionMetricTrendChart } from "./PcCommissionMetricTrendChart";
import { PcSalesPerformanceFilters } from "./PcSalesPerformanceFilters";
import { PcSalesTrendSections } from "./PcSalesTrendSections";

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
  agentSalesGroups: AgentPivotGroup[];
  agentCommissionGroups: AgentCommissionGroup[];
  carrierRows: CarrierRow[];
  expiredRows: ExpiredMonthRow[];
  policyDetailRows: PolicyDetailRow[];
};

const TREND_MONTH_LIMIT = 17;
const CARRIER_ROW_LIMIT = 24;
const EXPIRED_MONTH_LIMIT = 10;
const POLICY_DETAIL_LIMIT = 100;
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
const AGENT_TABLE_PALETTES = [
  {
    commission: "bg-[#fffaf0]",
    commissionHeader: "bg-[#fff5df] text-[#7a4a0c]",
    group: "bg-[#eaf4ff] text-[#234a72]",
    policies: "bg-[#f8fbff]",
    policiesHeader: "bg-[#f3f9ff] text-[#245b8f]",
  },
  {
    commission: "bg-[#fff9f2]",
    commissionHeader: "bg-[#fff1e4] text-[#7c3f1d]",
    group: "bg-[#eef8f1] text-[#285b37]",
    policies: "bg-[#fbfefc]",
    policiesHeader: "bg-[#f5fbf6] text-[#2e6b40]",
  },
  {
    commission: "bg-[#fff8fb]",
    commissionHeader: "bg-[#fff0f6] text-[#8a2450]",
    group: "bg-[#f4f0ff] text-[#4b3b7a]",
    policies: "bg-[#fcfbff]",
    policiesHeader: "bg-[#f8f5ff] text-[#51408a]",
  },
  {
    commission: "bg-[#fffaf0]",
    commissionHeader: "bg-[#fff4dc] text-[#7b4a08]",
    group: "bg-[#eef7fb] text-[#23576d]",
    policies: "bg-[#fbfdff]",
    policiesHeader: "bg-[#f3fafc] text-[#286273]",
  },
];

type ClientFilterValues = Pick<FilterValues, "agency" | "agent" | "policyNumber">;

export function PcSalesPerformanceDashboard({
  filterOptions,
  filters,
  initialTrendLevel,
  rows,
}: {
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
  const dataByLevel = useMemo<Record<TrendLevel, DashboardData>>(
    () => ({
      month: buildDashboardData(filteredRows, "month"),
      quarter: buildDashboardData(filteredRows, "quarter"),
      year: buildDashboardData(filteredRows, "year"),
    }),
    [filteredRows]
  );
  const data = dataByLevel.month;

  function updateClientFilters(nextFilters: ClientFilterValues) {
    setClientFilters(nextFilters);
    syncClientFilterUrl(nextFilters);
  }

  return (
    <>
      <PcSalesPerformanceFilters
        filters={activeFilters}
        onClientFiltersChange={updateClientFilters}
        options={filterOptions}
      />

      {filteredRows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-8 py-16 text-center text-sm font-medium text-slate-500 shadow-sm">
          No P&amp;C sales performance records match these filters.
        </div>
      ) : (
        <div className="space-y-8">
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">
            Business Overview
          </h2>

          <section className="grid gap-8 md:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Total Written Premium"
              value={formatCurrencyCompact(data.overview.totalPremium)}
            />
            <KpiCard
              label="Total Commission Revenue"
              value={formatCurrencyCompact(data.overview.totalCommission)}
            />
            <KpiCard
              label="Agent Commission Payout"
              value={formatCurrencyCompact(data.overview.agentCommission)}
            />
            <KpiCard
              label="EPS Gross Commission"
              value={formatCurrencyCompact(data.overview.epsCommission)}
            />
          </section>

          <section className="grid gap-8 md:grid-cols-2 xl:grid-cols-5">
            <KpiCard
              compact
              muted
              label="Total Policies Sold"
              value={formatInteger(data.overview.policyCount)}
            />
            <KpiCard
              compact
              muted
              label="Active Policies"
              value={formatInteger(data.overview.activePolicyCount)}
            />
            <KpiCard
              compact
              label="Renewal Rate"
              value={formatPercent(
                percentOf(data.overview.renewalPolicyCount, data.overview.policyCount)
              )}
            />
            <KpiCard
              compact
              label="Total Commission / Premium"
              value={formatPercent(
                percentOf(data.overview.totalCommission, data.overview.totalPremium)
              )}
            />
            <KpiCard
              compact
              label="EPS Commission / Premium"
              value={formatPercent(
                percentOf(data.overview.epsCommission, data.overview.totalPremium)
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
          <CarrierPerformanceTable rows={data.carrierRows} />
          <ExpiredPolicyTrendChart rows={data.expiredRows} />
          <PolicyDetailsTable
            rows={data.policyDetailRows.slice(0, POLICY_DETAIL_LIMIT)}
            totalCount={data.policyDetailRows.length}
          />
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

  return {
    overview,
    monthlyRows,
    trendRows,
    agencyMonthRows: buildAgencyMonthRows(rows, trendLevel),
    agentNames,
    agentSalesGroups: buildAgentSalesGroups(rows, agentNames, trendLevel),
    agentCommissionGroups: buildAgentCommissionGroups(rows, agentNames, trendLevel),
    carrierRows: buildCarrierRows(rows, overview).slice(0, CARRIER_ROW_LIMIT),
    expiredRows: buildExpiredRows(rows),
    policyDetailRows: buildPolicyDetailRows(rows),
  };
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
  return uniqueSorted(
    rows.map((row) => cleanGroupLabel(row.agent_name)).filter((agent) => agent !== "null")
  );
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

function buildExpiredRows(rows: PcSalesRow[]): ExpiredMonthRow[] {
  return [...groupRows(rows, (row) => row.expired_month_year ?? getMonthKey(row.expired_date)).entries()]
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
  label,
  muted = false,
  value,
}: {
  compact?: boolean;
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
    </article>
  );
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
      <AgentMonthlyPerformanceTable
        agentNames={data.agentNames}
        commissionGroups={data.agentCommissionGroups}
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
  const maxPolicyChange = maxAbsValue(rows, (row) => row.policyChangePercent);
  const maxPremiumChange = maxAbsValue(rows, (row) => row.premiumChangePercent);
  const maxCommissionChange = maxAbsValue(rows, (row) => row.commissionChangePercent);
  const maxEpsCommissionChange = maxAbsValue(
    rows,
    (row) => row.epsCommissionChangePercent
  );
  const periodLabel = getTrendLevelLabel(trendLevel);
  const changeLabel = getTrendChangeLabel(trendLevel);

  return (
    <ReportPanel
      title={`Sales Performance by ${periodLabel} | Policies & Premium ${changeLabel} Growth`}
    >
      <div className="max-h-[440px] overflow-y-auto overflow-x-hidden">
        <table className="w-full table-fixed text-[12px] tabular-nums">
          <thead>
            <tr className="bg-[#edf3fb] text-left font-bold">
              <SummaryHeaderCell width="9%">{periodLabel}</SummaryHeaderCell>
              <SummaryHeaderCell align="right" width="10%">Policies</SummaryHeaderCell>
              <SummaryHeaderCell align="right" width="11%">% Policies {changeLabel}</SummaryHeaderCell>
              <SummaryHeaderCell align="right" width="13%">Total Premium</SummaryHeaderCell>
              <SummaryHeaderCell align="right" width="11%">% Premium {changeLabel}</SummaryHeaderCell>
              <SummaryHeaderCell align="right" width="14%">Total Comm</SummaryHeaderCell>
              <SummaryHeaderCell align="right" width="12%">% Comm {changeLabel}</SummaryHeaderCell>
              <SummaryHeaderCell align="right" width="10%">EPS Comm</SummaryHeaderCell>
              <SummaryHeaderCell align="right" width="10%">% EPS {changeLabel}</SummaryHeaderCell>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.periodKey} className={index % 2 === 0 ? "bg-white" : "bg-[#f7f8fa]"}>
                <SummaryBodyCell strong>{row.monthKey}</SummaryBodyCell>
                <SummaryMetricCell
                  changeLabel={changeLabel}
                  delta={row.policyChange}
                  value={formatInteger(row.policyCount)}
                />
                <SummaryDeltaCell maxValue={maxPolicyChange} value={row.policyChangePercent} />
                <SummaryMetricCell
                  changeLabel={changeLabel}
                  delta={row.premiumChange}
                  deltaType="currency"
                  value={formatCurrencyShort(row.totalPremium)}
                />
                <SummaryDeltaCell maxValue={maxPremiumChange} value={row.premiumChangePercent} />
                <SummaryMetricCell
                  changeLabel={changeLabel}
                  delta={row.commissionChange}
                  deltaType="currency"
                  value={formatCurrencyShort(row.totalCommission)}
                />
                <SummaryDeltaCell maxValue={maxCommissionChange} value={row.commissionChangePercent} />
                <SummaryMetricCell
                  changeLabel={changeLabel}
                  delta={row.epsCommissionChange}
                  deltaType="currency"
                  value={formatCurrencyShort(row.epsCommission)}
                />
                <SummaryDeltaCell maxValue={maxEpsCommissionChange} value={row.epsCommissionChangePercent} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ReportPanel>
  );
}

function SummaryHeaderCell({
  align = "left",
  children,
  width,
}: {
  align?: "left" | "right";
  children: ReactNode;
  width: string;
}) {
  return (
    <th
      className={`sticky top-0 z-10 border-r border-b border-slate-200 bg-slate-50 px-3 py-4 align-middle text-xs font-semibold uppercase tracking-wider text-slate-500 last:border-r-0 ${
        align === "right" ? "text-right" : "text-left"
      }`}
      style={{ width }}
    >
      {children}
    </th>
  );
}

function SummaryBodyCell({
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
      className={`border-r border-b border-slate-100 px-3 py-4 align-middle text-sm text-slate-700 transition-colors group-hover:bg-slate-50/50 last:border-r-0 ${
        align === "right" ? "text-right" : "text-left"
      } ${strong ? "font-semibold text-slate-900" : ""}`}
    >
      {children}
    </td>
  );
}

function SummaryDeltaCell({
  maxValue,
  value,
}: {
  maxValue: number;
  value: number | null;
}) {
  return (
    <td
      className={`border-r border-b border-slate-100 px-3 py-4 align-middle text-right text-sm font-semibold last:border-r-0 ${deltaTextClassName(
        value
      )}`}
      style={{ backgroundColor: deltaHeatColor(value, maxValue) }}
    >
      {formatNullablePercent(value)}
    </td>
  );
}

function SummaryMetricCell({
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
    delta === null
      ? "-"
      : deltaType === "currency"
        ? formatCurrencyShort(delta)
        : formatInteger(delta);

  return (
    <td className="border-r border-b border-slate-100 px-3 py-3 align-middle text-right last:border-r-0">
      <div className="font-semibold text-slate-800">{value}</div>
      <div className={`mt-1 text-[11px] ${deltaTextClassName(delta)}`}>
        {changeLabel} {formattedDelta}
      </div>
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

  return (
    <ReportPanel title={`${getTrendLevelAdjective(trendLevel)} Sales Performance Summary`}>
      <div className="max-h-[520px] overflow-y-auto overflow-x-hidden">
        <table className="w-full table-fixed text-[11px] tabular-nums">
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#edf3fb] text-left font-bold">
              <AgencySummaryHeaderCell width="9%">{periodLabel}</AgencySummaryHeaderCell>
              <AgencySummaryHeaderCell width="11%">Agency</AgencySummaryHeaderCell>
              <AgencySummaryHeaderCell align="right" width="8%">Policies</AgencySummaryHeaderCell>
              <AgencySummaryHeaderCell align="right" width="11%">Premium</AgencySummaryHeaderCell>
              <AgencySummaryHeaderCell align="right" width="11%">Total Comm</AgencySummaryHeaderCell>
              <AgencySummaryHeaderCell align="right" width="8%">Total Rate</AgencySummaryHeaderCell>
              <AgencySummaryHeaderCell align="right" width="11%">Agent Comm</AgencySummaryHeaderCell>
              <AgencySummaryHeaderCell align="right" width="8%">Agent Rate</AgencySummaryHeaderCell>
              <AgencySummaryHeaderCell align="right" width="11%">EPS Comm</AgencySummaryHeaderCell>
              <AgencySummaryHeaderCell align="right" width="12%">EPS Rate</AgencySummaryHeaderCell>
            </tr>
          </thead>
          <tbody>
            {monthGroups.map((group, groupIndex) =>
              group.rows.map((row, rowIndex) => (
                <tr
                  key={`${group.monthKey}-${row.agency}-${rowIndex}`}
                  className={`${row.isTotal ? "bg-white font-bold" : (groupIndex + rowIndex) % 2 === 0 ? "bg-white" : "bg-[#f7f8fa]"}`}
                >
                  {rowIndex === 0 ? (
                    <td
                      className="border-r border-b border-slate-200 px-2 py-3 align-top text-xs font-semibold text-slate-900"
                      rowSpan={group.rows.length}
                    >
                      {group.monthKey}
                    </td>
                  ) : null}
                  <AgencySummaryCell strong={row.isTotal}>{row.agency}</AgencySummaryCell>
                  <AgencySummaryCell align="right">{formatInteger(row.policyCount)}</AgencySummaryCell>
                  <AgencySummaryCell align="right">{formatCurrencyShort(row.totalPremium)}</AgencySummaryCell>
                  <AgencySummaryHeatCell
                    maxValue={heatMaxes.totalCommission}
                    mode="blue"
                    strong={row.isTotal}
                    value={row.totalCommission}
                  >
                    {formatCurrencyShort(row.totalCommission)}
                  </AgencySummaryHeatCell>
                  <AgencySummaryHeatCell
                    maxValue={heatMaxes.totalRate}
                    mode="blue"
                    strong={row.isTotal}
                    value={percentOf(row.totalCommission, row.totalPremium)}
                  >
                    {formatPercent(percentOf(row.totalCommission, row.totalPremium))}
                  </AgencySummaryHeatCell>
                  <AgencySummaryHeatCell
                    maxValue={heatMaxes.agentCommission}
                    mode="lavender"
                    strong={row.isTotal}
                    value={row.agentCommission}
                  >
                    {formatCurrencyShort(row.agentCommission)}
                  </AgencySummaryHeatCell>
                  <AgencySummaryHeatCell
                    maxValue={heatMaxes.agentRate}
                    mode="lavender"
                    strong={row.isTotal}
                    value={percentOf(row.agentCommission, row.totalPremium)}
                  >
                    {formatPercent(percentOf(row.agentCommission, row.totalPremium))}
                  </AgencySummaryHeatCell>
                  <AgencySummaryHeatCell
                    maxValue={heatMaxes.epsCommission}
                    mode="pink"
                    strong={row.isTotal}
                    value={row.epsCommission}
                  >
                    {formatCurrencyShort(row.epsCommission)}
                  </AgencySummaryHeatCell>
                  <AgencySummaryHeatCell
                    maxValue={heatMaxes.epsRate}
                    mode="pink"
                    strong={row.isTotal}
                    value={percentOf(row.epsCommission, row.totalPremium)}
                  >
                    {formatPercent(percentOf(row.epsCommission, row.totalPremium))}
                  </AgencySummaryHeatCell>
                </tr>
              ))
            )}
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
  children,
  width,
}: {
  align?: "left" | "right";
  children: ReactNode;
  width: string;
}) {
  return (
    <th
      className={`border-r border-b border-slate-200 bg-slate-50 px-2 py-3 align-middle text-[11px] font-semibold uppercase tracking-wider text-slate-500 last:border-r-0 ${
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
  children,
  strong = false,
}: {
  align?: "left" | "right";
  children: ReactNode;
  strong?: boolean;
}) {
  return (
    <td
      className={`border-r border-b border-slate-100 px-2 py-3 align-middle text-xs text-slate-700 transition-colors group-hover:bg-slate-50/50 last:border-r-0 ${
        align === "right" ? "text-right" : "text-left"
      } ${strong ? "font-semibold text-slate-900" : ""}`}
    >
      {children}
    </td>
  );
}

function AgencySummaryHeatCell({
  children,
  maxValue,
  mode,
  strong = false,
  value,
}: {
  children: ReactNode;
  maxValue: number;
  mode: "blue" | "lavender" | "pink";
  strong?: boolean;
  value: number;
}) {
  return (
    <td
      className={`border-r border-b border-slate-100 px-2 py-3 align-middle text-right text-xs text-slate-700 transition-colors group-hover:bg-slate-50/50 last:border-r-0 ${
        strong ? "font-semibold text-slate-900" : ""
      }`}
      style={{ backgroundColor: agencySummaryHeatColor(value, maxValue, mode) }}
    >
      {children}
    </td>
  );
}

function AgentMonthlyPerformanceTable({
  agentNames,
  commissionGroups,
  salesGroups,
  trendLevel,
}: {
  agentNames: string[];
  commissionGroups: AgentCommissionGroup[];
  salesGroups: AgentPivotGroup[];
  trendLevel: TrendLevel;
}) {
  const salesGroupsByMonth = new Map(
    salesGroups.map((group) => [group.monthKey, group])
  );
  const policyGrandTotals = totalAgentPivotRows(
    salesGroups.flatMap((group) => group.rows),
    agentNames,
    "Grand total policies"
  );
  const commissionGrandTotals = totalCommissionPivotRows(
    commissionGroups.flatMap((group) => group.rows),
    agentNames,
    "Grand total commission"
  );
  const agentGroupWidth = "220px";
  const tableMinWidth = Math.max(1180, 420 + agentNames.length * 220 + 210);

  return (
    <ReportPanel
      title={`Agent Performance by ${getTrendLevelLabel(trendLevel)} | Policies & Commission`}
    >
      <div className="max-h-[680px] overflow-auto">
        <table
          className="w-full table-fixed text-[12px] tabular-nums"
          style={{ minWidth: tableMinWidth }}
        >
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#edf3fb] text-left font-bold">
              <AgentPerformanceHeaderCell rowSpan={2} stickyLeft="0px" width="120px">
                {getTrendLevelLabel(trendLevel)}
              </AgentPerformanceHeaderCell>
              <AgentPerformanceHeaderCell rowSpan={2} stickyDivider stickyLeft="120px" width="170px">Agency</AgentPerformanceHeaderCell>
              {agentNames.map((agent, agentIndex) => {
                const palette = agentTablePalette(agentIndex);

                return (
                <AgentPerformanceHeaderCell
                  align="center"
                  className={palette.group}
                  colSpan={2}
                  groupStart
                  key={agent}
                  width={agentGroupWidth}
                >
                  {agent}
                </AgentPerformanceHeaderCell>
                );
              })}
              <AgentPerformanceHeaderCell align="center" className="bg-[#e7eefb] text-[#2d3c63]" colSpan={2} groupStart width="210px">
                Grand Total
              </AgentPerformanceHeaderCell>
            </tr>
            <tr className="bg-[#f8fafc] text-right font-bold">
              {agentNames.map((agent, agentIndex) => {
                const palette = agentTablePalette(agentIndex);

                return (
                <Fragment key={agent}>
                  <AgentPerformanceHeaderCell align="right" className={palette.policiesHeader} groupStart key={`${agent}-policies`}>
                    Policies
                  </AgentPerformanceHeaderCell>
                  <AgentPerformanceHeaderCell align="right" className={palette.commissionHeader} key={`${agent}-commission`}>
                    Commission
                  </AgentPerformanceHeaderCell>
                </Fragment>
                );
              })}
              <AgentPerformanceHeaderCell align="right" className="bg-[#f4f7ff] text-[#33446e]" groupStart>Policies</AgentPerformanceHeaderCell>
              <AgentPerformanceHeaderCell align="right" className="bg-[#f4f7ff] text-[#33446e]">Commission</AgentPerformanceHeaderCell>
            </tr>
          </thead>
          <tbody>
            {commissionGroups.map((commissionGroup, groupIndex) => (
              <AgentMonthlyPerformanceRows
                agentNames={agentNames}
                commissionGroup={commissionGroup}
                groupIndex={groupIndex}
                key={commissionGroup.monthKey}
                salesGroup={salesGroupsByMonth.get(commissionGroup.monthKey)}
              />
            ))}
            <tr className="bg-[#eaf3ff] font-bold">
              <AgentPerformanceCell className="bg-[#e8f2ff]" stickyLeft="0px" strong>
                Grand total
              </AgentPerformanceCell>
              <AgentPerformanceCell className="bg-[#e8f2ff]" stickyDivider stickyLeft="120px" strong>
                All agencies
              </AgentPerformanceCell>
              {agentNames.map((agent, agentIndex) => {
                const palette = agentTablePalette(agentIndex);

                return (
                <Fragment key={agent}>
                  <AgentPerformanceCell align="right" className={palette.policies} groupStart key={`${agent}-policies`} strong>
                    {formatInteger(policyGrandTotals.valuesByAgent[agent] ?? 0)}
                  </AgentPerformanceCell>
                  <AgentPerformanceCell align="right" className={palette.commission} key={`${agent}-commission`} strong>
                    {formatCurrencyShort(
                      commissionGrandTotals.valuesByAgent[agent] ?? 0
                    )}
                  </AgentPerformanceCell>
                </Fragment>
                );
              })}
              <AgentPerformanceCell align="right" className="bg-[#eef3ff]" groupStart strong>
                {formatInteger(policyGrandTotals.grandTotal)}
              </AgentPerformanceCell>
              <AgentPerformanceCell align="right" className="bg-[#eef3ff]" strong>
                {formatCurrencyShort(commissionGrandTotals.grandTotal)}
              </AgentPerformanceCell>
            </tr>
          </tbody>
        </table>
      </div>
    </ReportPanel>
  );
}

function AgentMonthlyPerformanceRows({
  agentNames,
  commissionGroup,
  groupIndex,
  salesGroup,
}: {
  agentNames: string[];
  commissionGroup: AgentCommissionGroup;
  groupIndex: number;
  salesGroup: AgentPivotGroup | undefined;
}) {
  const policyTotalRow = salesGroup?.total ?? {
    agency: "Total Policies",
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
    })),
    {
      agency: "Total",
      commission: commissionGroup.monthlyTotal,
      isTotal: true,
      policies: policyTotalRow,
    },
  ];

  return (
    <>
      {rows.map((row, index) => {
        return (
          <tr
            className={`${index === 0 ? "border-t-2 border-t-slate-300" : ""} ${
              row.isTotal
                ? "bg-[#e8f2ff] font-bold"
                : (groupIndex + index) % 2 === 0
                  ? "bg-white"
                  : "bg-[#f7f8fa]"
            }`}
            key={`${commissionGroup.monthKey}-${row.agency}-${index}`}
          >
            {index === 0 ? (
              <td
                className={`sticky left-0 z-20 border-r border-b border-slate-300 px-4 py-4 align-top text-[13px] font-semibold text-slate-900 ${
                  groupIndex % 2 === 0 ? "bg-[#f1f5fb]" : "bg-[#eef4f8]"
                }`}
                rowSpan={rows.length}
              >
                {commissionGroup.monthKey}
              </td>
            ) : null}
            <AgentPerformanceCell
              className={
                row.isTotal
                  ? "bg-[#e8f2ff]"
                  : (groupIndex + index) % 2 === 0
                    ? "bg-white"
                    : "bg-[#f7f8fa]"
              }
              stickyDivider
              stickyLeft="120px"
              strong={row.isTotal}
            >
              {row.agency}
            </AgentPerformanceCell>
            {agentNames.map((agent, agentIndex) => {
              const palette = agentTablePalette(agentIndex);

              return (
              <Fragment key={agent}>
                <AgentPerformanceCell align="right" className={palette.policies} groupStart key={`${agent}-policies`} strong={row.isTotal}>
                  {formatInteger(row.policies.valuesByAgent[agent] ?? 0)}
                </AgentPerformanceCell>
                <AgentPerformanceCell align="right" className={palette.commission} key={`${agent}-commission`} strong={row.isTotal}>
                  {formatCurrencyShort(row.commission.valuesByAgent[agent] ?? 0)}
                </AgentPerformanceCell>
              </Fragment>
              );
            })}
            <AgentPerformanceCell align="right" className="bg-[#eef3ff]" groupStart strong={row.isTotal}>
              {formatInteger(row.policies.grandTotal)}
            </AgentPerformanceCell>
            <AgentPerformanceCell align="right" className="bg-[#eef3ff]" strong={row.isTotal}>
              {formatCurrencyShort(row.commission.grandTotal)}
            </AgentPerformanceCell>
          </tr>
        );
      })}
    </>
  );
}

function AgentPerformanceHeaderCell({
  align = "left",
  children,
  className = "",
  colSpan,
  groupStart = false,
  rowSpan,
  stickyDivider = false,
  stickyLeft,
  width,
}: {
  align?: "center" | "left" | "right";
  children: ReactNode;
  className?: string;
  colSpan?: number;
  groupStart?: boolean;
  rowSpan?: number;
  stickyDivider?: boolean;
  stickyLeft?: string;
  width?: string;
}) {
  return (
    <th
      className={`border-r border-b border-slate-200 px-3 py-3 align-middle text-[11px] font-semibold uppercase leading-tight tracking-[0.04em] text-slate-500 last:border-r-0 ${
        groupStart ? "border-l-2 border-l-slate-300" : ""
      } ${
        stickyLeft ? "sticky z-30" : ""
      } ${
        stickyDivider ? "shadow-[8px_0_12px_-12px_rgba(15,23,42,0.55)]" : ""
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

function AgentPerformanceCell({
  align = "left",
  children,
  className = "",
  colSpan,
  groupStart = false,
  stickyDivider = false,
  stickyLeft,
  strong = false,
}: {
  align?: "left" | "right";
  children?: ReactNode;
  className?: string;
  colSpan?: number;
  groupStart?: boolean;
  stickyDivider?: boolean;
  stickyLeft?: string;
  strong?: boolean;
}) {
  return (
    <td
      className={`border-r border-b border-slate-200 px-3 py-3 align-middle text-[13px] text-slate-700 last:border-r-0 ${
        groupStart ? "border-l-2 border-l-slate-300" : ""
      } ${
        stickyLeft ? "sticky z-20" : ""
      } ${
        stickyDivider ? "shadow-[8px_0_12px_-12px_rgba(15,23,42,0.55)]" : ""
      } ${className} ${
        align === "right" ? "text-right" : "text-left"
      } ${strong ? "font-semibold text-slate-900" : ""}`}
      colSpan={colSpan}
      style={stickyLeft ? { left: stickyLeft } : undefined}
    >
      {children}
    </td>
  );
}

function agentTablePalette(index: number) {
  return AGENT_TABLE_PALETTES[index % AGENT_TABLE_PALETTES.length];
}

function CarrierPerformanceTable({ rows }: { rows: CarrierRow[] }) {
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
    <ReportPanel title="Carrier Performance Overview">
      <div className="max-h-[620px] overflow-y-auto overflow-x-hidden">
        <table className="w-full table-fixed text-[11px] tabular-nums">
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#edf3fb] text-left font-bold">
              <CarrierHeaderCell width="20%">Company</CarrierHeaderCell>
              <CarrierHeaderCell align="right" tone="green" width="14%">Policies Count</CarrierHeaderCell>
              <CarrierHeaderCell align="right" tone="green" width="15%">% Policies Count</CarrierHeaderCell>
              <CarrierHeaderCell align="right" tone="amber" width="19%">Total Premium</CarrierHeaderCell>
              <CarrierHeaderCell align="right" tone="blue" width="17%">Total Commission</CarrierHeaderCell>
              <CarrierHeaderCell align="right" tone="lavender" width="15%">Average Commission Rate</CarrierHeaderCell>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.company} className={index % 2 === 0 ? "bg-white" : "bg-[#f7f8fa]"}>
                <CarrierBodyCell strong>{row.company}</CarrierBodyCell>
                <CarrierHeatCell
                  maxValue={maxPolicyCount}
                  mode="green"
                  value={row.policyCount}
                >
                  {formatInteger(row.policyCount)}
                </CarrierHeatCell>
                <CarrierHeatCell
                  maxValue={maxPolicyShare}
                  mode="green"
                  value={row.policySharePercent}
                >
                  {formatPercent(row.policySharePercent)}
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
                maxValue={maxPolicyCount}
                mode="green"
                strong
                value={total.policyCount}
              >
                {formatInteger(total.policyCount)}
              </CarrierHeatCell>
              <CarrierHeatCell
                maxValue={100}
                mode="green"
                strong
                value={100}
              >
                100%
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
      className={`border-r border-b border-slate-300 px-3 py-3 align-middle text-[11px] font-semibold uppercase leading-tight tracking-[0.04em] text-slate-600 last:border-r-0 ${carrierHeaderToneClassName(
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

function PolicyDetailsTable({
  rows,
  totalCount,
}: {
  rows: PolicyDetailRow[];
  totalCount: number;
}) {
  return (
    <ReportPanel title="Insurance Policy Details">
      <div
        className="overflow-auto"
        style={{ maxHeight: POLICY_DETAIL_TABLE_MAX_HEIGHT }}
      >
        <table className="min-w-[1200px] w-full table-fixed text-[12px]">
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#edf3fb] text-left font-bold">
              <HeaderCell width="9%">Agent</HeaderCell>
              <HeaderCell width="9%">Agency</HeaderCell>
              <HeaderCell width="19%">Insured Name</HeaderCell>
              <HeaderCell width="15%">Policy Number</HeaderCell>
              <HeaderCell width="7%">State</HeaderCell>
              <HeaderCell width="12%">City</HeaderCell>
              <HeaderCell width="13%">Company</HeaderCell>
              <HeaderCell align="right" width="10%">True Premium</HeaderCell>
              <HeaderCell width="9%">Effective Date</HeaderCell>
              <HeaderCell width="9%">Expired Date</HeaderCell>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${row.policyNumber}-${index}`} className={index % 2 === 0 ? "bg-white" : "bg-[#f7f8fa]"}>
                <BodyCell strong>{row.agent}</BodyCell>
                <BodyCell>{row.agency}</BodyCell>
                <BodyCell>{row.insuredName}</BodyCell>
                <BodyCell>{row.policyNumber}</BodyCell>
                <BodyCell>{row.state}</BodyCell>
                <BodyCell>{row.city}</BodyCell>
                <BodyCell>{row.company}</BodyCell>
                <BodyCell align="right">{formatCurrency(row.truePremium)}</BodyCell>
                <BodyCell>{row.effectiveDate ? formatShortDate(row.effectiveDate) : "null"}</BodyCell>
                <BodyCell>{row.expiredDate ? formatShortDate(row.expiredDate) : "null"}</BodyCell>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex justify-end border-t border-[#d9d9d9] px-4 py-2 text-[12px] font-semibold text-[#4d535c]">
        1 - {formatInteger(rows.length)} / {formatInteger(totalCount)}
      </div>
    </ReportPanel>
  );
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

function HeaderCell({
  align = "left",
  children,
  colSpan,
  width,
}: {
  align?: "left" | "right";
  children?: ReactNode;
  colSpan?: number;
  width?: string;
}) {
  return (
    <th
      className={`bg-slate-50/80 backdrop-blur-sm border-b border-slate-200 px-4 py-3 align-middle text-xs font-semibold uppercase tracking-wider text-slate-500 ${
        align === "right" ? "text-right" : "text-left"
      }`}
      colSpan={colSpan}
      style={width ? { width } : undefined}
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

function maxAbsValue<T>(rows: T[], getValue: (row: T) => number | null) {
  if (rows.length === 0) return 1;

  return Math.max(
    ...rows.map((row) => Math.abs(getValue(row) ?? 0)),
    1
  );
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

function deltaTextClassName(value: number | null) {
  if (value === null || value === 0) return "text-slate-500";
  return value > 0 ? "text-emerald-700" : "text-rose-600";
}

function deltaHeatColor(value: number | null, maxValue: number) {
  if (value === null || value === 0) return "transparent";

  const intensity = Math.min(Math.abs(value) / Math.max(maxValue, 1), 1);

  return value > 0
    ? rgba(157, 214, 165, 0.34 + intensity * 0.3)
    : rgba(237, 154, 148, 0.34 + intensity * 0.3);
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
