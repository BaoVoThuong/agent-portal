"use client";

import { useMemo, useState, type ReactNode } from "react";
import { HealthSalesPoliciesInformationTable } from "./HealthSalesPoliciesInformationTable";
import { HealthSalesDashboardFilters } from "./HealthSalesDashboardFilters";
import {
  type TrendComparisonChartLevel,
  type TrendComparisonPeriod,
  type TrendComparisonPeriodsByLevel,
} from "./HealthSalesTrendComparisonChart";
import { HealthSalesTrendSections } from "./HealthSalesTrendSections";

type HealthSalesRow = {
  deal_name: string | null;
  state: string | null;
  carrier: string | null;
  plan_name: string | null;
  primary_member_id: string | null;
  agent: string | null;
  broker_effective_date: string | null;
  paid_to_date: string | null;
  report_month: string | null;
  carriers_messer_paid: number | null;
  agent_received: number | null;
  eps_override: number | null;
  eps_override_received: number | null;
  eps_split: number | null;
  messer_statement: string | null;
  num_client: number | null;
};

type ReportMonthRange = {
  start: string | null;
  end: string | null;
};

type FilterValues = {
  agent: string[];
  carrier: string[];
  reportMonthRange: ReportMonthRange;
  messerStatement: string[];
  primaryMemberId: string;
};

type ClientFilterValues = Pick<FilterValues, "agent" | "carrier" | "primaryMemberId">;

type FilterOptions = {
  agents: string[];
  carriers: string[];
};

type Summary = {
  policyCount: number;
  paidPolicyCount: number;
  unpaidPolicyCount: number;
  clientCount: number;
  paidClientCount: number;
  unpaidClientCount: number;
  totalMesserPaid: number;
  agentReceived: number;
  epsCommission: number;
  epsOverride: number;
  epsSplit: number;
  activeAgentCount: number;
};

type MonthlySummary = Summary & {
  monthKey: string;
};

type SalesPeriodSummary = Summary & {
  periodKey: string;
  periodLabel: string;
};

type SalesMomRow = SalesPeriodSummary & {
  policyChange: number | null;
  policyChangePercent: number | null;
  clientChange: number | null;
  clientChangePercent: number | null;
  messerPaidChange: number | null;
  messerPaidChangePercent: number | null;
  epsCommissionChange: number | null;
  epsCommissionChangePercent: number | null;
};

type CombinedPaymentStatusMonth = {
  reportMonth: string;
  policyTotal: number;
  policyPaid: number;
  policyPaidRate: number;
  clientTotal: number;
  clientPaid: number;
  clientPaidRate: number;
};

type CombinedCarrierPaymentStatusRow = {
  carrier: string;
  policyTotal: number;
  policyPaid: number;
  policyPaidRate: number;
  clientTotal: number;
  clientPaid: number;
  clientPaidRate: number;
};

type CarrierPaidRateBreakdown = {
  reportMonth: string | null;
  rows: CombinedCarrierPaymentStatusRow[];
};

type AgentDashboardRow = Summary & {
  agent: string;
  avgAgentCommissionPerMonth: number;
  paidPolicyPercent: number;
  revenueSharePercent: number;
};

type CarrierDashboardRow = Summary & {
  carrier: string;
  paidPolicyPercent: number;
  revenueSharePercent: number;
  epsCommissionPercent: number;
  epsOverridePercent: number;
  epsSplitPercent: number;
};

type StateDashboardRow = Summary & {
  state: string;
  policySharePercent: number;
  clientSharePercent: number;
  revenueSharePercent: number;
};

type PolicyInfoRow = {
  dealName: string;
  agentName: string;
  carrier: string;
  primaryMemberId: string;
  totalPaid: number;
  months: {
    hasRecord: boolean;
    paid: number;
    paidToDate: string | null;
  }[];
};

type PolicyInfoSummary = {
  rows: PolicyInfoRow[];
  visibleMonthCount: number;
};

type DashboardData = {
  overview: Summary;
  monthlyRows: MonthlySummary[];
  trendPeriodsByLevel: TrendComparisonPeriodsByLevel;
  commissionRowsByLevel: Record<TrendComparisonChartLevel, SalesPeriodSummary[]>;
  salesMomRowsByLevel: Record<TrendComparisonChartLevel, SalesMomRow[]>;
  carrierPaidRateBreakdown: CarrierPaidRateBreakdown;
  agentRows: AgentDashboardRow[];
  carrierRows: CarrierDashboardRow[];
  stateRows: StateDashboardRow[];
  policyInfoRows: PolicyInfoRow[];
  policyInfoMonthCount: number;
};

const TREND_MONTH_LIMIT = 12;
const TREND_QUARTER_LIMIT = 8;
const TREND_YEAR_LIMIT = 5;
const TABLE_MONTH_LIMIT = 14;
const CARRIER_ROW_LIMIT = 28;
const STATE_TOP_LIMIT = 5;
const PAID_RATE_VISIBLE_ROW_COUNT = 6;
const PAID_RATE_HEADER_HEIGHT_PX = 72;
const PAID_RATE_ROW_HEIGHT_PX = 64;
const PAID_RATE_TABLE_MAX_HEIGHT =
  PAID_RATE_HEADER_HEIGHT_PX + PAID_RATE_VISIBLE_ROW_COUNT * PAID_RATE_ROW_HEIGHT_PX;
const SALES_MOM_VISIBLE_ROW_COUNT = 6;
const SALES_MOM_HEADER_HEIGHT_PX = 44;
const SALES_MOM_ROW_HEIGHT_PX = 56;
const SALES_MOM_SCROLL_MAX_HEIGHT =
  SALES_MOM_HEADER_HEIGHT_PX + SALES_MOM_VISIBLE_ROW_COUNT * SALES_MOM_ROW_HEIGHT_PX;

export function HealthSalesDashboard({
  filterOptions,
  filters,
  initialTrendLevel,
  rows,
}: {
  filterOptions: FilterOptions;
  filters: FilterValues;
  initialTrendLevel: TrendComparisonChartLevel;
  rows: HealthSalesRow[];
}) {
  const [clientFilters, setClientFilters] = useState<ClientFilterValues>(() => ({
    agent: filters.agent,
    carrier: filters.carrier,
    primaryMemberId: filters.primaryMemberId,
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
  const data = useMemo(() => buildDashboardData(filteredRows), [filteredRows]);
  const latestMonth = data.monthlyRows[0] ?? null;

  function updateClientFilters(nextFilters: ClientFilterValues) {
    setClientFilters(nextFilters);
    syncClientFilterUrl(nextFilters);
  }

  return (
    <>
      <HealthSalesDashboardFilters
        filters={activeFilters}
        onClientFiltersChange={updateClientFilters}
        options={filterOptions}
      />

      {filteredRows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-8 py-16 text-center text-sm font-medium text-slate-500 shadow-sm">
          No Health sales records match these filters.
        </div>
      ) : (
        <div className="space-y-8">
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">
            Business Overview
          </h2>

          <section className="grid gap-8 md:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Total Agent Commission"
              value={formatCurrencyCompact(data.overview.agentReceived)}
              footerText={formatLatestMonthMetric(
                latestMonth,
                latestMonth ? formatCurrencyShort(latestMonth.agentReceived) : "-"
              )}
            />
            <KpiCard
              label="Total EPS Comm"
              value={formatCurrencyCompact(data.overview.epsCommission)}
              footerText={formatLatestMonthMetric(
                latestMonth,
                latestMonth ? formatCurrencyShort(latestMonth.epsCommission) : "-"
              )}
            />
            <KpiCard
              label="Total EPS Split"
              value={formatCurrencyCompact(data.overview.epsSplit)}
              footerText={formatLatestMonthMetric(
                latestMonth,
                latestMonth ? formatCurrencyShort(latestMonth.epsSplit) : "-"
              )}
            />
            <KpiCard
              label="Total EPS Override"
              value={formatCurrencyCompact(data.overview.epsOverride)}
              footerText={formatLatestMonthMetric(
                latestMonth,
                latestMonth ? formatCurrencyShort(latestMonth.epsOverride) : "-"
              )}
            />
            <KpiCard
              label="Agent Comm / Carrier Paid"
              value={formatPercent(
                percentOf(data.overview.agentReceived, data.overview.totalMesserPaid)
              )}
              footerText={formatLatestMonthMetric(
                latestMonth,
                latestMonth
                  ? formatPercent(
                      percentOf(
                        latestMonth.agentReceived,
                        latestMonth.totalMesserPaid
                      )
                    )
                  : "-"
              )}
            />
            <KpiCard
              label="EPS Comm / Carrier Paid"
              value={formatPercent(
                percentOf(data.overview.epsCommission, data.overview.totalMesserPaid)
              )}
              footerText={formatLatestMonthMetric(
                latestMonth,
                latestMonth
                  ? formatPercent(
                      percentOf(
                        latestMonth.epsCommission,
                        latestMonth.totalMesserPaid
                      )
                    )
                  : "-"
              )}
            />
            <KpiCard
              label="EPS Split / Carrier Paid"
              value={formatPercent(
                percentOf(data.overview.epsSplit, data.overview.totalMesserPaid)
              )}
              footerText={formatLatestMonthMetric(
                latestMonth,
                latestMonth
                  ? formatPercent(
                      percentOf(latestMonth.epsSplit, latestMonth.totalMesserPaid)
                    )
                  : "-"
              )}
            />
            <KpiCard
              label="EPS Override / Carrier Paid"
              value={formatPercent(
                percentOf(data.overview.epsOverride, data.overview.totalMesserPaid)
              )}
              footerText={formatLatestMonthMetric(
                latestMonth,
                latestMonth
                  ? formatPercent(
                      percentOf(
                        latestMonth.epsOverride,
                        latestMonth.totalMesserPaid
                      )
                    )
                  : "-"
              )}
            />
          </section>

          <HealthSalesTrendSections
            initialLevel={initialTrendLevel}
            monthSections={<SalesTrendLevelTables data={data} level="month" />}
            periodsByLevel={data.trendPeriodsByLevel}
            quarterSections={<SalesTrendLevelTables data={data} level="quarter" />}
            yearSections={<SalesTrendLevelTables data={data} level="year" />}
          />
          <section className="grid gap-5 xl:grid-cols-2">
            <CombinedPaymentStatusTable
              labelHeader="Month"
              rows={combinePaymentStatusMonths(data.monthlyRows)}
              title="Paid Rate | Recent Months"
            />
            <CombinedCarrierPaymentStatusTable
              reportMonth={data.carrierPaidRateBreakdown.reportMonth}
              rows={data.carrierPaidRateBreakdown.rows}
              title="Carrier Paid Rate | Latest Complete Month"
            />
          </section>
          <AgentDashboardTable rows={data.agentRows} />
          <CarrierDashboardTable rows={data.carrierRows} />
          <StateDashboardTable rows={data.stateRows} />
          <HealthSalesPoliciesInformationTable
            rows={data.policyInfoRows}
            visibleMonthCount={data.policyInfoMonthCount}
          />
        </div>
      )}
    </>
  );
}

function syncClientFilterUrl(filters: ClientFilterValues) {
  const params = new URLSearchParams(window.location.search);

  params.delete("agent");
  params.delete("carrier");
  params.delete("primaryMemberId");

  for (const agent of filters.agent) {
    params.append("agent", agent);
  }

  for (const carrier of filters.carrier) {
    params.append("carrier", carrier);
  }

  if (filters.primaryMemberId) {
    params.set("primaryMemberId", filters.primaryMemberId);
  }

  const query = params.toString();
  window.history.replaceState(
    null,
    "",
    query ? `${window.location.pathname}?${query}` : window.location.pathname
  );
}

function applyClientFilters(rows: HealthSalesRow[], filters: FilterValues) {
  const primaryMemberId = filters.primaryMemberId.trim().toUpperCase();

  return rows.filter((row) => {
    if (
      filters.agent.length > 0 &&
      !filters.agent.includes(cleanGroupLabel(row.agent))
    ) {
      return false;
    }

    if (
      filters.carrier.length > 0 &&
      !filters.carrier.includes(cleanGroupLabel(row.carrier))
    ) {
      return false;
    }

    if (
      filters.messerStatement.length > 0 &&
      !filters.messerStatement.includes(cleanGroupLabel(row.messer_statement))
    ) {
      return false;
    }

    if (
      primaryMemberId &&
      !cleanText(row.primary_member_id).toUpperCase().includes(primaryMemberId)
    ) {
      return false;
    }

    return true;
  });
}

function buildDashboardData(rows: HealthSalesRow[]): DashboardData {
  const eligibleRows = buildEligiblePolicyRows(rows);
  const overview = summarizeRows(eligibleRows);
  const monthlyRows = buildMonthlySummaries(eligibleRows);
  const commissionRowsByLevel = buildCommissionRowsByLevel(
    eligibleRows,
    monthlyRows
  );
  const policyInfoSummary = buildPolicyInfoSummary(eligibleRows);

  return {
    overview,
    monthlyRows,
    trendPeriodsByLevel: buildTrendPeriodsByLevel(eligibleRows, monthlyRows),
    commissionRowsByLevel,
    salesMomRowsByLevel: {
      month: buildSalesMomRows(commissionRowsByLevel.month),
      quarter: buildSalesMomRows(commissionRowsByLevel.quarter),
      year: buildSalesMomRows(commissionRowsByLevel.year),
    },
    carrierPaidRateBreakdown: buildCarrierPaidRateBreakdown(
      eligibleRows,
      monthlyRows
    ),
    agentRows: buildAgentRows(eligibleRows, overview),
    carrierRows: buildCarrierRows(eligibleRows, overview).slice(0, CARRIER_ROW_LIMIT),
    stateRows: buildStateRows(eligibleRows, overview),
    policyInfoRows: policyInfoSummary.rows,
    policyInfoMonthCount: policyInfoSummary.visibleMonthCount,
  };
}

function buildEligiblePolicyRows(rows: HealthSalesRow[]) {
  const selectedRows = new Map<string, HealthSalesRow>();

  for (const row of rows) {
    const reportMonth = getMonthKey(row.report_month);
    const effectiveMonth = getMonthKey(row.broker_effective_date);
    const primaryMemberId = cleanText(row.primary_member_id).toUpperCase();

    if (!reportMonth || !effectiveMonth || !primaryMemberId) continue;
    if (effectiveMonth.localeCompare(reportMonth) > 0) continue;

    const key = `${reportMonth}\u001f${primaryMemberId}`;
    const current = selectedRows.get(key);

    if (!current || compareEffectiveDate(row, current) > 0) {
      selectedRows.set(key, row);
    }
  }

  return [...selectedRows.values()];
}

function compareEffectiveDate(a: HealthSalesRow, b: HealthSalesRow) {
  const aEffectiveDate = cleanText(a.broker_effective_date);
  const bEffectiveDate = cleanText(b.broker_effective_date);

  if (aEffectiveDate !== bEffectiveDate) {
    return aEffectiveDate.localeCompare(bEffectiveDate);
  }

  return moneyValue(a.carriers_messer_paid) - moneyValue(b.carriers_messer_paid);
}

function summarizeRows(rows: HealthSalesRow[]): Summary {
  const summaryRows = buildEligiblePolicyRows(rows);
  const policies = new Map<string, { paid: boolean; clients: number }>();
  const activeAgents = new Set<string>();
  let totalMesserPaid = 0;
  let agentReceived = 0;
  let epsOverride = 0;
  let epsSplit = 0;

  summaryRows.forEach((row) => {
    totalMesserPaid += moneyValue(row.carriers_messer_paid);
    agentReceived += moneyValue(row.agent_received);
    epsOverride += getEpsOverride(row);
    epsSplit += moneyValue(row.eps_split);

    const agentName = cleanGroupLabel(row.agent);
    if (agentName !== "null") activeAgents.add(agentName);
  });

  summaryRows.forEach((row, index) => {
    const agentName = cleanGroupLabel(row.agent);
    if (agentName !== "null") activeAgents.add(agentName);

    const policyId = getPolicyId(row, index);
    const current = policies.get(policyId) ?? { paid: false, clients: 0 };

    current.paid = current.paid || Boolean(row.paid_to_date);
    current.clients = Math.max(current.clients, row.num_client ?? 0);
    policies.set(policyId, current);
  });

  const policyValues = [...policies.values()];
  const paidPolicyCount = policyValues.filter((policy) => policy.paid).length;
  const clientCount = policyValues.reduce(
    (total, policy) => total + policy.clients,
    0
  );
  const paidClientCount = policyValues.reduce(
    (total, policy) => total + (policy.paid ? policy.clients : 0),
    0
  );

  return {
    policyCount: policies.size,
    paidPolicyCount,
    unpaidPolicyCount: Math.max(policies.size - paidPolicyCount, 0),
    clientCount,
    paidClientCount,
    unpaidClientCount: Math.max(clientCount - paidClientCount, 0),
    totalMesserPaid,
    agentReceived,
    epsCommission: totalMesserPaid - agentReceived,
    epsOverride,
    epsSplit,
    activeAgentCount: activeAgents.size,
  };
}

function buildMonthlySummaries(rows: HealthSalesRow[]) {
  return [...groupRows(rows, (row) => getMonthKey(row.report_month)).entries()]
    .filter(([monthKey]) => Boolean(monthKey))
    .map(([monthKey, groupRows]) => ({
      monthKey,
      ...summarizeRows(groupRows),
    }))
    .sort((a, b) => b.monthKey.localeCompare(a.monthKey));
}

function buildTrendPeriodsByLevel(
  rows: HealthSalesRow[],
  monthlyRows: MonthlySummary[]
): TrendComparisonPeriodsByLevel {
  return {
    month: monthlyRows
      .filter(hasTrendPeriodActivity)
      .slice(0, TREND_MONTH_LIMIT)
      .map((row) => ({
        periodKey: row.monthKey,
        periodLabel: row.monthKey,
        policyCount: row.policyCount,
        clientCount: row.clientCount,
        totalMesserPaid: row.totalMesserPaid,
      }))
      .reverse(),
    quarter: buildTrendPeriodSummaries(
      rows,
      (row) => getQuarterKey(row.report_month),
      formatQuarterLabel,
      TREND_QUARTER_LIMIT
    ),
    year: buildTrendPeriodSummaries(
      rows,
      (row) => getYearKey(row.report_month),
      (periodKey) => periodKey,
      TREND_YEAR_LIMIT
    ),
  };
}

function buildTrendPeriodSummaries(
  rows: HealthSalesRow[],
  getPeriodKey: (row: HealthSalesRow) => string,
  getPeriodLabel: (periodKey: string) => string,
  limit: number
): TrendComparisonPeriod[] {
  return [...groupRows(rows, getPeriodKey).entries()]
    .filter(([periodKey]) => Boolean(periodKey))
    .map(([periodKey, periodRows]) => {
      const summary = summarizeRows(periodRows);

      return {
        periodKey,
        periodLabel: getPeriodLabel(periodKey),
        policyCount: summary.policyCount,
        clientCount: summary.clientCount,
        totalMesserPaid: summary.totalMesserPaid,
      };
    })
    .filter(hasTrendPeriodActivity)
    .sort((a, b) => b.periodKey.localeCompare(a.periodKey))
    .slice(0, limit)
    .reverse();
}

function buildCommissionRowsByLevel(
  rows: HealthSalesRow[],
  monthlyRows: MonthlySummary[]
): Record<TrendComparisonChartLevel, SalesPeriodSummary[]> {
  return {
    month: monthlyRows.slice(0, TABLE_MONTH_LIMIT).map((row) => ({
      ...row,
      periodKey: row.monthKey,
      periodLabel: row.monthKey,
    })),
    quarter: buildSalesPeriodSummaries(
      rows,
      (row) => getQuarterKey(row.report_month),
      formatQuarterLabel,
      TREND_QUARTER_LIMIT
    ),
    year: buildSalesPeriodSummaries(
      rows,
      (row) => getYearKey(row.report_month),
      (periodKey) => periodKey,
      TREND_YEAR_LIMIT
    ),
  };
}

function buildSalesPeriodSummaries(
  rows: HealthSalesRow[],
  getPeriodKey: (row: HealthSalesRow) => string,
  getPeriodLabel: (periodKey: string) => string,
  limit: number
): SalesPeriodSummary[] {
  return [...groupRows(rows, getPeriodKey).entries()]
    .filter(([periodKey]) => Boolean(periodKey))
    .map(([periodKey, periodRows]) => ({
      periodKey,
      periodLabel: getPeriodLabel(periodKey),
      ...summarizeRows(periodRows),
    }))
    .sort((a, b) => b.periodKey.localeCompare(a.periodKey))
    .slice(0, limit);
}

function buildSalesMomRows(periodRows: SalesPeriodSummary[]): SalesMomRow[] {
  const chronological = [...periodRows].reverse();
  const rows = chronological.map<SalesMomRow>((row, index) => {
    const previous = chronological[index - 1] ?? null;
    const policyChange = previous ? row.policyCount - previous.policyCount : null;
    const clientChange = previous ? row.clientCount - previous.clientCount : null;
    const messerPaidChange = previous
      ? row.totalMesserPaid - previous.totalMesserPaid
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
      clientChange,
      clientChangePercent: calculateChangePercent(
        clientChange,
        previous?.clientCount ?? null
      ),
      messerPaidChange,
      messerPaidChangePercent: calculateChangePercent(
        messerPaidChange,
        previous?.totalMesserPaid ?? null
      ),
      epsCommissionChange,
      epsCommissionChangePercent: calculateChangePercent(
        epsCommissionChange,
        previous?.epsCommission ?? null
      ),
    };
  });

  return rows.reverse();
}

function hasTrendPeriodActivity(period: {
  policyCount: number;
  clientCount: number;
  totalMesserPaid: number;
}) {
  return (
    period.policyCount > 0 ||
    period.clientCount > 0 ||
    period.totalMesserPaid !== 0
  );
}

function hasPaidRateActivity(period: {
  policyCount: number;
  clientCount: number;
}) {
  return period.policyCount > 0 || period.clientCount > 0;
}

function combinePaymentStatusMonths(rows: MonthlySummary[]): CombinedPaymentStatusMonth[] {
  return rows
    .filter(hasPaidRateActivity)
    .map((row) => ({
      reportMonth: row.monthKey,
      policyTotal: row.policyCount,
      policyPaid: row.paidPolicyCount,
      policyPaidRate: percentOf(row.paidPolicyCount, row.policyCount),
      clientTotal: row.clientCount,
      clientPaid: row.paidClientCount,
      clientPaidRate: percentOf(row.paidClientCount, row.clientCount),
    }));
}

function buildCarrierPaidRateBreakdown(
  rows: HealthSalesRow[],
  monthlyRows: MonthlySummary[]
): CarrierPaidRateBreakdown {
  const latestCompleteMonth = monthlyRows.find(
    hasPaidRateActivity
  );

  if (!latestCompleteMonth) {
    return {
      reportMonth: null,
      rows: [],
    };
  }

  const monthRows = rows.filter(
    (row) => getMonthKey(row.report_month) === latestCompleteMonth.monthKey
  );

  return {
    reportMonth: latestCompleteMonth.monthKey,
    rows: [...groupRows(monthRows, (row) => cleanGroupLabel(row.carrier)).entries()]
      .map(([carrier, carrierRows]) => {
        const summary = summarizeRows(carrierRows);

        return {
          carrier,
          policyTotal: summary.policyCount,
          policyPaid: summary.paidPolicyCount,
          policyPaidRate: percentOf(summary.paidPolicyCount, summary.policyCount),
          clientTotal: summary.clientCount,
          clientPaid: summary.paidClientCount,
          clientPaidRate: percentOf(summary.paidClientCount, summary.clientCount),
        };
      })
      .filter((row) => row.policyTotal > 0 || row.clientTotal > 0)
      .sort(
        (a, b) =>
          b.policyTotal - a.policyTotal ||
          b.clientTotal - a.clientTotal ||
          b.policyPaidRate - a.policyPaidRate ||
          a.carrier.localeCompare(b.carrier)
      ),
  };
}

function buildCarrierRows(
  rows: HealthSalesRow[],
  overview: Summary
): CarrierDashboardRow[] {
  return [...groupRows(rows, (row) => cleanGroupLabel(row.carrier)).entries()]
    .map(([carrier, groupRows]) => {
      const summary = summarizeRows(groupRows);

      return {
        carrier,
        ...summary,
        paidPolicyPercent: percentOf(summary.paidPolicyCount, summary.policyCount),
        revenueSharePercent: percentOf(
          summary.totalMesserPaid,
          overview.totalMesserPaid
        ),
        epsCommissionPercent: percentOf(
          summary.epsCommission,
          summary.totalMesserPaid
        ),
        epsOverridePercent: percentOf(summary.epsOverride, summary.totalMesserPaid),
        epsSplitPercent: percentOf(summary.epsSplit, summary.totalMesserPaid),
      };
    })
    .sort(
      (a, b) =>
        b.policyCount - a.policyCount ||
        b.totalMesserPaid - a.totalMesserPaid ||
        a.carrier.localeCompare(b.carrier)
    );
}

function buildAgentRows(
  rows: HealthSalesRow[],
  overview: Summary
): AgentDashboardRow[] {
  return [...groupRows(rows, (row) => cleanGroupLabel(row.agent)).entries()]
    .map(([agent, groupRows]) => {
      const summary = summarizeRows(groupRows);
      const monthCount = new Set(
        groupRows.map((row) => getMonthKey(row.report_month)).filter(Boolean)
      ).size;

      return {
        agent,
        ...summary,
        avgAgentCommissionPerMonth:
          monthCount > 0 ? summary.agentReceived / monthCount : 0,
        paidPolicyPercent: percentOf(summary.paidPolicyCount, summary.policyCount),
        revenueSharePercent: percentOf(
          summary.totalMesserPaid,
          overview.totalMesserPaid
        ),
      };
    })
    .sort(
      (a, b) =>
        b.policyCount - a.policyCount ||
        b.totalMesserPaid - a.totalMesserPaid ||
        a.agent.localeCompare(b.agent)
    );
}

function buildStateRows(rows: HealthSalesRow[], overview: Summary): StateDashboardRow[] {
  const groups = [...groupRows(rows, (row) => cleanGroupLabel(row.state)).entries()]
    .map(([state, groupRows]) => ({
      groupRows,
      state,
      summary: summarizeRows(groupRows),
    }))
    .sort(
      (a, b) =>
        b.summary.policyCount - a.summary.policyCount ||
        b.summary.totalMesserPaid - a.summary.totalMesserPaid ||
        a.state.localeCompare(b.state)
    );
  const rankedStateGroups = groups.filter((group) => group.state !== "null");
  const topGroups = rankedStateGroups.slice(0, STATE_TOP_LIMIT);
  const otherRows = [
    ...groups.filter((group) => group.state === "null"),
    ...rankedStateGroups.slice(STATE_TOP_LIMIT),
  ].flatMap((group) => group.groupRows);

  const stateRows = topGroups.map(({ state, summary }) =>
    toStateDashboardRow(state, summary, overview)
  );

  if (otherRows.length > 0) {
    stateRows.push(toStateDashboardRow("Other", summarizeRows(otherRows), overview));
  }

  return stateRows;
}

function toStateDashboardRow(
  state: string,
  summary: Summary,
  overview: Summary
): StateDashboardRow {
  return {
    state,
    ...summary,
    policySharePercent: percentOf(summary.policyCount, overview.policyCount),
    clientSharePercent: percentOf(summary.clientCount, overview.clientCount),
    revenueSharePercent: percentOf(summary.totalMesserPaid, overview.totalMesserPaid),
  };
}

function buildPolicyInfoSummary(rows: HealthSalesRow[]): PolicyInfoSummary {
  const latestYear = rows.reduce<number | null>((year, row) => {
    const monthKey = getMonthKey(row.report_month);
    if (!monthKey) return year;

    const rowYear = Number(monthKey.slice(0, 4));

    return year === null || rowYear > year ? rowYear : year;
  }, null);

  if (latestYear === null) {
    return {
      rows: [],
      visibleMonthCount: 0,
    };
  }

  const rowsByPolicy = new Map<string, PolicyInfoRow>();
  let visibleMonthCount = 0;

  for (const row of rows) {
    const monthKey = getMonthKey(row.report_month);
    if (!monthKey) continue;
    if (Number(monthKey.slice(0, 4)) !== latestYear) continue;

    const monthIndex = Number(monthKey.slice(5, 7)) - 1;
    if (monthIndex < 0 || monthIndex > 11) continue;

    visibleMonthCount = Math.max(visibleMonthCount, monthIndex + 1);

    const dealName = cleanText(row.deal_name) || "Unknown";
    const agentName = cleanText(row.agent) || "Unknown";
    const carrier = cleanText(row.carrier) || "Unknown";
    const primaryMemberId = cleanText(row.primary_member_id) || "Unknown";
    const key = `${dealName}\u001f${agentName}\u001f${carrier}\u001f${primaryMemberId}`;
    const current =
      rowsByPolicy.get(key) ??
      ({
        dealName,
        agentName,
        carrier,
        primaryMemberId,
        totalPaid: 0,
        months: Array.from({ length: 12 }, () => ({
          hasRecord: false,
          paid: 0,
          paidToDate: null,
        })),
      } satisfies PolicyInfoRow);
    const paid = moneyValue(row.carriers_messer_paid);

    current.totalPaid += paid;
    current.months[monthIndex].hasRecord = true;
    current.months[monthIndex].paid += paid;
    current.months[monthIndex].paidToDate = maxDateString(
      current.months[monthIndex].paidToDate,
      row.paid_to_date
    );
    rowsByPolicy.set(key, current);
  }

  return {
    rows: [...rowsByPolicy.values()].sort((a, b) => b.totalPaid - a.totalPaid),
    visibleMonthCount,
  };
}

function KpiCard({
  accent = "dark",
  footerText,
  label,
  value,
}: {
  accent?: "dark" | "red";
  footerText?: string;
  label: string;
  value: string;
}) {
  const isRed = accent === "red";

  return (
    <article className="flex min-h-[140px] flex-col rounded-xl border border-slate-200/70 bg-white px-5 py-4 text-center shadow-[0_6px_18px_rgba(15,23,42,0.06)] transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgba(15,23,42,0.1)]">
      <div
        className={`flex min-h-8 items-center justify-center text-[12px] font-semibold uppercase leading-snug tracking-[0.08em] ${
          isRed ? "text-rose-500" : "text-slate-500"
        }`}
      >
        {label}
      </div>
      <div className="flex flex-1 items-center justify-center py-2">
        <div
          className={`w-full break-words text-center text-[2rem] font-bold leading-none tracking-normal tabular-nums ${
            isRed ? "text-rose-600" : "text-slate-950"
          }`}
        >
          {value}
        </div>
      </div>
      <div className="min-h-5 truncate text-sm font-medium text-slate-500">
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

function SalesTrendLevelTables({
  data,
  level,
}: {
  data: DashboardData;
  level: TrendComparisonChartLevel;
}) {
  const periodLabel = getTrendLevelLabel(level);

  return (
    <>
      <CommissionBreakdownTable
        periodLabel={periodLabel}
        rows={data.commissionRowsByLevel[level]}
      />
      <SalesMomGrowthTable
        changeLabel={getTrendChangeLabel(level)}
        periodLabel={periodLabel}
        rows={data.salesMomRowsByLevel[level]}
      />
    </>
  );
}

function SalesMomGrowthTable({
  changeLabel,
  periodLabel,
  rows,
}: {
  changeLabel: string;
  periodLabel: string;
  rows: SalesMomRow[];
}) {
  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold leading-tight text-[#16233a]">
          Sales Dashboard by {periodLabel} | Policies &amp; Messer Paid {changeLabel} Growth
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
                    Clients
                  </MoMHeaderCell>
                  <MoMHeaderCell className="top-0 w-[11%] text-right">
                    % Clients {changeLabel}
                  </MoMHeaderCell>
                  <MoMHeaderCell className="top-0 w-[13%] text-right">
                    Messer Paid
                  </MoMHeaderCell>
                  <MoMHeaderCell className="top-0 w-[11%] text-right">
                    % Messer Paid {changeLabel}
                  </MoMHeaderCell>
                  <MoMHeaderCell className="top-0 w-[12%] text-right">
                    EPS Comm
                  </MoMHeaderCell>
                  <MoMHeaderCell className="top-0 w-[10%] text-right">
                    % EPS Comm {changeLabel}
                  </MoMHeaderCell>
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
                      <MoMMetricCell
                        changeLabel={changeLabel}
                        delta={row.policyChange}
                        value={formatInteger(row.policyCount)}
                      />
                      <MoMPercentCell value={row.policyChangePercent} />
                      <MoMMetricCell
                        changeLabel={changeLabel}
                        delta={row.clientChange}
                        value={formatInteger(row.clientCount)}
                      />
                      <MoMPercentCell value={row.clientChangePercent} />
                      <MoMMetricCell
                        changeLabel={changeLabel}
                        delta={row.messerPaidChange}
                        deltaType="currency"
                        value={formatCurrencyShort(row.totalMesserPaid)}
                      />
                      <MoMPercentCell value={row.messerPaidChangePercent} />
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

function CompactHeaderCell({
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

function CompactBodyCell({
  align = "left",
  bordered = false,
  children,
}: {
  align?: "left" | "right";
  bordered?: boolean;
  children: ReactNode;
}) {
  return (
    <td
      className={`border-b border-slate-100 px-2 py-3 align-middle text-sm text-slate-700 tabular-nums transition-colors group-hover:bg-slate-50/50 ${
        bordered ? "border-r last:border-r-0" : ""
      } ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {children}
    </td>
  );
}

function CompactHeatCell({
  bordered = false,
  children,
  maxValue = 100,
  mode = "delta",
  value,
}: {
  bordered?: boolean;
  children: ReactNode;
  maxValue?: number;
  mode?: "delta" | "green" | "blue" | "lavender" | "pink" | "magenta";
  value: number | null;
}) {
  return (
    <td
      className={`border-b border-slate-100 px-2 py-3 align-middle text-right text-sm tabular-nums text-slate-700 transition-colors group-hover:bg-slate-50/50 ${
        bordered ? "border-r last:border-r-0" : ""
      }`}
      style={{ backgroundColor: heatColor(value, maxValue, mode) }}
    >
      {children}
    </td>
  );
}

function CombinedPaymentStatusTable({
  title,
  labelHeader,
  rows,
}: {
  title: string;
  labelHeader: string;
  rows: CombinedPaymentStatusMonth[];
}) {
  const policyAveragePaidRate = calculateWeightedPaidRate(
    rows,
    (row) => row.policyPaid,
    (row) => row.policyTotal
  );
  const clientAveragePaidRate = calculateWeightedPaidRate(
    rows,
    (row) => row.clientPaid,
    (row) => row.clientTotal
  );

  return (
    <section className="flex flex-col">
      <h2 className="mb-4 text-xl font-semibold leading-tight text-[#16233a]">{title}</h2>
      <article className="agent-health-panel">
        <div
          className="overflow-y-auto overflow-x-hidden"
          style={{ maxHeight: PAID_RATE_TABLE_MAX_HEIGHT }}
        >
          <table className="w-full table-fixed text-[12px] tabular-nums">
            <colgroup>
              <col className="w-[19%]" />
              <col className="w-[17%]" />
              <col className="w-[22%]" />
              <col className="w-[19%]" />
              <col className="w-[23%]" />
            </colgroup>
            <thead className="sticky top-0 z-10 bg-[#f8fafc]">
              <tr className="border-b border-[#d8dee7] text-left text-[11px] font-semibold uppercase tracking-wider text-[#667085]">
                <th className="px-4 py-3 align-middle" rowSpan={2}>{labelHeader}</th>
                <th className="border-l border-[#d8dee7] px-2 py-2 text-center" colSpan={2}>Policies</th>
                <th className="border-l border-[#d8dee7] px-2 py-2 text-center" colSpan={2}>Clients</th>
              </tr>
              <tr className="border-b border-[#d8dee7] text-[10px] font-semibold uppercase tracking-wider text-[#667085]">
                <th className="border-l border-[#d8dee7] px-2 py-2 text-right text-emerald-600"># Paid</th>
                <th className="px-2 py-2 text-right">% Paid Rate</th>
                <th className="border-l border-[#d8dee7] px-2 py-2 text-right text-emerald-600"># Paid</th>
                <th className="px-4 py-2 text-right">% Paid Rate</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td className="px-6 py-12 text-center text-sm font-medium text-slate-500" colSpan={5}>
                    No months matched these filters.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr
                    key={row.reportMonth}
                    className="group h-16 border-b border-[#edf0f4] transition-colors hover:bg-[#f8fafc] last:border-b-0"
                  >
                    <td className="whitespace-nowrap px-5 py-3 text-sm font-semibold text-slate-900">
                      {formatReportMonth(row.reportMonth)}
                    </td>
                    <td className="border-l border-[#edf0f4] px-2 py-3 text-right text-sm font-semibold text-emerald-600">
                      <PaidCountValue paid={row.policyPaid} total={row.policyTotal} />
                    </td>
                    <td className={getPaidRateCellClass(row.policyPaidRate, policyAveragePaidRate)}>
                      {formatPaidRatePercent(row.policyPaidRate)}
                    </td>
                    <td className="border-l border-[#edf0f4] px-2 py-3 text-right text-sm font-semibold text-emerald-600">
                      <PaidCountValue paid={row.clientPaid} total={row.clientTotal} />
                    </td>
                    <td className={getPaidRateCellClass(row.clientPaidRate, clientAveragePaidRate, "px-4")}>
                      {formatPaidRatePercent(row.clientPaidRate)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  );
}

function CombinedCarrierPaymentStatusTable({
  title,
  reportMonth,
  rows,
}: {
  title: string;
  reportMonth: string | null;
  rows: CombinedCarrierPaymentStatusRow[];
}) {
  const policyAveragePaidRate = calculateWeightedPaidRate(
    rows,
    (row) => row.policyPaid,
    (row) => row.policyTotal
  );
  const clientAveragePaidRate = calculateWeightedPaidRate(
    rows,
    (row) => row.clientPaid,
    (row) => row.clientTotal
  );

  return (
    <section className="flex flex-col">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <h2 className="text-xl font-semibold leading-tight text-[#16233a]">{title}</h2>
        {reportMonth ? (
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {formatReportMonth(reportMonth)}
          </span>
        ) : null}
      </div>
      <article className="agent-health-panel">
        <div
          className="overflow-y-auto overflow-x-hidden"
          style={{ maxHeight: PAID_RATE_TABLE_MAX_HEIGHT }}
        >
          <table className="w-full table-fixed text-[12px] tabular-nums">
            <colgroup>
              <col className="w-[25%]" />
              <col className="w-[15%]" />
              <col className="w-[21%]" />
              <col className="w-[17%]" />
              <col className="w-[22%]" />
            </colgroup>
            <thead className="sticky top-0 z-10 bg-[#f8fafc]">
              <tr className="border-b border-[#d8dee7] text-left text-[11px] font-semibold uppercase tracking-wider text-[#667085]">
                <th className="px-4 py-3 align-middle" rowSpan={2}>Carrier</th>
                <th className="border-l border-[#d8dee7] px-2 py-2 text-center" colSpan={2}>Policies</th>
                <th className="border-l border-[#d8dee7] px-2 py-2 text-center" colSpan={2}>Clients</th>
              </tr>
              <tr className="border-b border-[#d8dee7] text-[10px] font-semibold uppercase tracking-wider text-[#667085]">
                <th className="border-l border-[#d8dee7] px-2 py-2 text-right text-emerald-600"># Paid</th>
                <th className="px-2 py-2 text-right">% Paid Rate</th>
                <th className="border-l border-[#d8dee7] px-2 py-2 text-right text-emerald-600"># Paid</th>
                <th className="px-4 py-2 text-right">% Paid Rate</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td className="px-6 py-12 text-center text-sm font-medium text-slate-500" colSpan={5}>
                    No complete month matched these filters.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr
                    key={row.carrier}
                    className="group h-16 border-b border-[#edf0f4] transition-colors hover:bg-[#f8fafc] last:border-b-0"
                  >
                    <td className="break-words px-5 py-3 text-sm font-semibold text-slate-900">
                      {row.carrier}
                    </td>
                    <td className="border-l border-[#edf0f4] px-2 py-3 text-right text-sm font-semibold text-emerald-600">
                      <PaidCountValue paid={row.policyPaid} total={row.policyTotal} />
                    </td>
                    <td className={getPaidRateCellClass(row.policyPaidRate, policyAveragePaidRate)}>
                      {formatPaidRatePercent(row.policyPaidRate)}
                    </td>
                    <td className="border-l border-[#edf0f4] px-2 py-3 text-right text-sm font-semibold text-emerald-600">
                      <PaidCountValue paid={row.clientPaid} total={row.clientTotal} />
                    </td>
                    <td className={getPaidRateCellClass(row.clientPaidRate, clientAveragePaidRate, "px-4")}>
                      {formatPaidRatePercent(row.clientPaidRate)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  );
}

function PaidCountValue({ paid, total }: { paid: number; total: number }) {
  return (
    <span className="flex flex-col items-end leading-tight">
      <span className="font-semibold text-emerald-600">{formatInteger(paid)}</span>
      <span className="mt-1 text-[11px] font-medium text-slate-500">
        Total {formatInteger(total)}
      </span>
    </span>
  );
}

function getPaidRateCellClass(
  value: number,
  average: number | null,
  paddingClass = "px-2"
) {
  const baseClass = `border-l border-[#edf0f4] ${paddingClass} py-3 text-right text-sm font-semibold text-[#24272d]`;

  if (average === null || value === average) {
    return baseClass;
  }

  return value > average
    ? `${baseClass} bg-[#c9e8ca]`
    : `${baseClass} bg-[#f2c5c0]`;
}

function calculateWeightedPaidRate<T>(
  rows: T[],
  getPaid: (row: T) => number,
  getTotal: (row: T) => number
) {
  const totals = rows.reduce(
    (current, row) => ({
      paid: current.paid + getPaid(row),
      total: current.total + getTotal(row),
    }),
    { paid: 0, total: 0 }
  );

  return totals.total === 0 ? null : (totals.paid / totals.total) * 100;
}

function CommissionBreakdownTable({
  periodLabel,
  rows,
}: {
  periodLabel: string;
  rows: SalesPeriodSummary[];
}) {
  return (
    <ReportPanel title={`Commission Breakdown by ${periodLabel} | Revenue Distribution & Yield`}>
      <div className="max-h-[300px] overflow-y-auto">
        <table className="w-full table-fixed text-[11px]">
          <thead>
            <tr className="bg-[#edf3fb] text-left font-bold">
              <CompactHeaderCell bordered width="8%">{periodLabel}</CompactHeaderCell>
              <CompactHeaderCell bordered align="right" width="10%">Messer Paid</CompactHeaderCell>
              <CompactHeaderCell bordered align="right" width="11%">Agent Comm</CompactHeaderCell>
              <CompactHeaderCell bordered align="right" width="10%">% Agent</CompactHeaderCell>
              <CompactHeaderCell bordered align="right" width="11%">EPS Comm</CompactHeaderCell>
              <CompactHeaderCell bordered align="right" width="10%">% EPS Comm</CompactHeaderCell>
              <CompactHeaderCell bordered align="right" width="11%">EPS Override</CompactHeaderCell>
              <CompactHeaderCell bordered align="right" width="10%">% EPS Override</CompactHeaderCell>
              <CompactHeaderCell bordered align="right" width="10%">EPS Split</CompactHeaderCell>
              <CompactHeaderCell bordered align="right" width="9%">% EPS Split</CompactHeaderCell>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.periodKey} className={index % 2 === 0 ? "bg-white" : "bg-[#f7f8fa]"}>
                <CompactBodyCell bordered>{row.periodLabel}</CompactBodyCell>
                <CompactBodyCell bordered align="right">{formatCurrencyShort(row.totalMesserPaid)}</CompactBodyCell>
                <CompactHeatCell bordered mode="blue" value={row.agentReceived} maxValue={maxValue(rows, (item) => item.agentReceived)}>
                  {formatCurrencyShort(row.agentReceived)}
                </CompactHeatCell>
                <CompactHeatCell bordered mode="blue" value={percentOf(row.agentReceived, row.totalMesserPaid)}>
                  {formatPercent(percentOf(row.agentReceived, row.totalMesserPaid))}
                </CompactHeatCell>
                <CompactHeatCell bordered mode="lavender" value={row.epsCommission} maxValue={maxValue(rows, (item) => item.epsCommission)}>
                  {formatCurrencyShort(row.epsCommission)}
                </CompactHeatCell>
                <CompactHeatCell bordered mode="lavender" value={percentOf(row.epsCommission, row.totalMesserPaid)}>
                  {formatPercent(percentOf(row.epsCommission, row.totalMesserPaid))}
                </CompactHeatCell>
                <CompactHeatCell bordered mode="pink" value={row.epsOverride} maxValue={maxValue(rows, (item) => item.epsOverride)}>
                  {formatCurrencyShort(row.epsOverride)}
                </CompactHeatCell>
                <CompactHeatCell bordered mode="pink" value={percentOf(row.epsOverride, row.totalMesserPaid)}>
                  {formatPercent(percentOf(row.epsOverride, row.totalMesserPaid))}
                </CompactHeatCell>
                <CompactHeatCell bordered mode="magenta" value={row.epsSplit} maxValue={maxValue(rows, (item) => item.epsSplit)}>
                  {formatCurrencyShort(row.epsSplit)}
                </CompactHeatCell>
                <CompactHeatCell bordered mode="magenta" value={percentOf(row.epsSplit, row.totalMesserPaid)}>
                  {formatPercent(percentOf(row.epsSplit, row.totalMesserPaid))}
                </CompactHeatCell>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ReportPanel>
  );
}

function AgentDashboardTable({ rows }: { rows: AgentDashboardRow[] }) {
  const maxes = {
    agentReceived: maxValue(rows, (row) => row.agentReceived),
    avgAgentCommissionPerMonth: maxValue(
      rows,
      (row) => row.avgAgentCommissionPerMonth
    ),
    clientCount: maxValue(rows, (row) => row.clientCount),
    epsCommission: maxValue(rows, (row) => row.epsCommission),
    epsOverride: maxValue(rows, (row) => row.epsOverride),
    epsSplit: maxValue(rows, (row) => row.epsSplit),
    policyCount: maxValue(rows, (row) => row.policyCount),
    totalMesserPaid: maxValue(rows, (row) => row.totalMesserPaid),
  };

  return (
    <ReportPanel title="Agent Dashboard | Policies, Revenue & Commission Breakdown">
      <div className="max-h-[300px] overflow-y-auto overflow-x-hidden">
        <table className="w-full table-fixed text-[11px]">
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#edf3fb] text-left font-bold">
              <CompactHeaderCell bordered width="14%">Agent</CompactHeaderCell>
              <CompactHeaderCell bordered align="right" width="9.5556%">Share</CompactHeaderCell>
              <CompactHeaderCell bordered align="right" width="9.5556%">Policies</CompactHeaderCell>
              <CompactHeaderCell bordered align="right" width="9.5556%">Clients</CompactHeaderCell>
              <CompactHeaderCell bordered align="right" width="9.5556%">Messer Paid</CompactHeaderCell>
              <CompactHeaderCell bordered align="right" width="9.5556%">Agent Comm</CompactHeaderCell>
              <CompactHeaderCell bordered align="right" width="9.5556%">Avg Per Month</CompactHeaderCell>
              <CompactHeaderCell bordered align="right" width="9.5556%">EPS Comm</CompactHeaderCell>
              <CompactHeaderCell bordered align="right" width="9.5556%">EPS Override</CompactHeaderCell>
              <CompactHeaderCell bordered align="right" width="9.5556%">EPS Split</CompactHeaderCell>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.agent} className={`group ${index % 2 === 0 ? "bg-white" : "bg-[#f7f8fa]"}`}>
                <td className="border-b border-r border-slate-200 px-2 py-3 align-middle font-semibold text-slate-900 transition-colors group-hover:bg-slate-50/70">
                  <span className="block truncate" title={row.agent}>
                    {row.agent}
                  </span>
                </td>
                <CompactHeatCell bordered mode="green" value={row.revenueSharePercent}>
                  {formatPercent(row.revenueSharePercent)}
                </CompactHeatCell>
                <CompactHeatCell bordered mode="blue" maxValue={maxes.policyCount} value={row.policyCount}>
                  {formatInteger(row.policyCount)}
                </CompactHeatCell>
                <CompactHeatCell bordered mode="pink" maxValue={maxes.clientCount} value={row.clientCount}>
                  {formatInteger(row.clientCount)}
                </CompactHeatCell>
                <CompactHeatCell bordered mode="lavender" maxValue={maxes.totalMesserPaid} value={row.totalMesserPaid}>
                  {formatCurrencyShort(row.totalMesserPaid)}
                </CompactHeatCell>
                <CompactHeatCell bordered mode="blue" maxValue={maxes.agentReceived} value={row.agentReceived}>
                  {formatCurrencyShort(row.agentReceived)}
                </CompactHeatCell>
                <CompactHeatCell bordered mode="blue" maxValue={maxes.avgAgentCommissionPerMonth} value={row.avgAgentCommissionPerMonth}>
                  {formatCurrencyShort(row.avgAgentCommissionPerMonth)}
                </CompactHeatCell>
                <CompactHeatCell bordered mode="lavender" maxValue={maxes.epsCommission} value={row.epsCommission}>
                  {formatCurrencyShort(row.epsCommission)}
                </CompactHeatCell>
                <CompactHeatCell bordered mode="pink" maxValue={maxes.epsOverride} value={row.epsOverride}>
                  {formatCurrencyShort(row.epsOverride)}
                </CompactHeatCell>
                <CompactHeatCell bordered mode="magenta" maxValue={maxes.epsSplit} value={row.epsSplit}>
                  {formatCurrencyShort(row.epsSplit)}
                </CompactHeatCell>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ReportPanel>
  );
}

function CarrierDashboardTable({ rows }: { rows: CarrierDashboardRow[] }) {
  const maxes = {
    epsCommission: maxValue(rows, (row) => row.epsCommission),
    epsOverride: maxValue(rows, (row) => row.epsOverride),
    epsSplit: maxValue(rows, (row) => row.epsSplit),
    policyCount: maxValue(rows, (row) => row.policyCount),
    totalMesserPaid: maxValue(rows, (row) => row.totalMesserPaid),
  };

  return (
    <ReportPanel title="Carrier Dashboard | Policies, Revenue & Commission Breakdown">
      <div className="max-h-[300px] overflow-y-auto overflow-x-hidden">
        <table className="w-full table-fixed text-[11px]">
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#edf3fb] text-left font-bold">
              <CompactHeaderCell bordered width="11%">Carrier</CompactHeaderCell>
              <CompactHeaderCell bordered align="right" width="8%">Share</CompactHeaderCell>
              <CompactHeaderCell bordered align="right" width="8%">Policies</CompactHeaderCell>
              <CompactHeaderCell bordered align="right" width="9%">Paid %</CompactHeaderCell>
              <CompactHeaderCell bordered align="right" width="11%">Messer Paid</CompactHeaderCell>
              <CompactHeaderCell bordered align="right" width="10%">EPS Over.</CompactHeaderCell>
              <CompactHeaderCell bordered align="right" width="9%">Over. %</CompactHeaderCell>
              <CompactHeaderCell bordered align="right" width="9%">EPS Split</CompactHeaderCell>
              <CompactHeaderCell bordered align="right" width="8%">Split %</CompactHeaderCell>
              <CompactHeaderCell bordered align="right" width="10%">EPS Comm</CompactHeaderCell>
              <CompactHeaderCell bordered align="right" width="7%">Comm %</CompactHeaderCell>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.carrier} className={`group ${index % 2 === 0 ? "bg-white" : "bg-[#f7f8fa]"}`}>
                <td className="border-b border-r border-slate-200 px-2 py-3 align-middle font-semibold text-slate-900 transition-colors group-hover:bg-slate-50/70">
                  <span className="block truncate" title={row.carrier}>
                    {row.carrier}
                  </span>
                </td>
                <CompactHeatCell bordered mode="green" value={row.revenueSharePercent}>
                  {formatPercent(row.revenueSharePercent)}
                </CompactHeatCell>
                <CompactHeatCell bordered mode="blue" maxValue={maxes.policyCount} value={row.policyCount}>
                  {formatInteger(row.policyCount)}
                </CompactHeatCell>
                <CompactHeatCell bordered mode="green" value={row.paidPolicyPercent}>
                  {formatPercent(row.paidPolicyPercent)}
                </CompactHeatCell>
                <CompactHeatCell bordered mode="lavender" maxValue={maxes.totalMesserPaid} value={row.totalMesserPaid}>
                  {formatCurrencyShort(row.totalMesserPaid)}
                </CompactHeatCell>
                <CompactHeatCell bordered mode="pink" maxValue={maxes.epsOverride} value={row.epsOverride}>
                  {formatCurrencyShort(row.epsOverride)}
                </CompactHeatCell>
                <CompactHeatCell bordered mode="pink" value={row.epsOverridePercent}>
                  {formatPercent(row.epsOverridePercent)}
                </CompactHeatCell>
                <CompactHeatCell bordered mode="magenta" maxValue={maxes.epsSplit} value={row.epsSplit}>
                  {formatCurrencyShort(row.epsSplit)}
                </CompactHeatCell>
                <CompactHeatCell bordered mode="magenta" value={row.epsSplitPercent}>
                  {formatPercent(row.epsSplitPercent)}
                </CompactHeatCell>
                <CompactHeatCell bordered mode="blue" maxValue={maxes.epsCommission} value={row.epsCommission}>
                  {formatCurrencyShort(row.epsCommission)}
                </CompactHeatCell>
                <CompactHeatCell bordered mode="blue" value={row.epsCommissionPercent}>
                  {formatPercent(row.epsCommissionPercent)}
                </CompactHeatCell>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ReportPanel>
  );
}

function StateDashboardTable({ rows }: { rows: StateDashboardRow[] }) {
  const maxes = {
    policyCount: maxValue(rows, (row) => row.policyCount),
    clientCount: maxValue(rows, (row) => row.clientCount),
    totalMesserPaid: maxValue(rows, (row) => row.totalMesserPaid),
    epsCommission: maxValue(rows, (row) => row.epsCommission),
  };

  return (
    <ReportPanel title="State Dashboard | Policies, Revenue & Commission Breakdown">
      <div className="max-h-[300px] overflow-y-auto">
        <table className="w-full table-fixed text-[12px]">
          <thead>
            <tr className="bg-[#edf3fb] text-left font-bold">
              <CompactHeaderCell bordered width="12%">State</CompactHeaderCell>
              <CompactHeaderCell bordered align="right" width="10%">Share</CompactHeaderCell>
              <CompactHeaderCell bordered align="right" width="10%">Policies</CompactHeaderCell>
              <CompactHeaderCell bordered align="right" width="10%">Policy %</CompactHeaderCell>
              <CompactHeaderCell bordered align="right" width="11%">Clients</CompactHeaderCell>
              <CompactHeaderCell bordered align="right" width="10%">Client %</CompactHeaderCell>
              <CompactHeaderCell bordered align="right" width="17%">Messer Paid</CompactHeaderCell>
              <CompactHeaderCell bordered align="right" width="20%">EPS Commission</CompactHeaderCell>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.state} className={`group ${index % 2 === 0 ? "bg-white" : "bg-[#f7f8fa]"}`}>
                <td className="border-b border-r border-slate-200 px-3 py-3 align-middle font-semibold text-slate-900 transition-colors group-hover:bg-slate-50/70">
                  {row.state}
                </td>
                <CompactHeatCell bordered mode="green" value={row.revenueSharePercent}>
                  {formatPercent(row.revenueSharePercent)}
                </CompactHeatCell>
                <CompactHeatCell bordered mode="blue" maxValue={maxes.policyCount} value={row.policyCount}>
                  {formatInteger(row.policyCount)}
                </CompactHeatCell>
                <CompactHeatCell bordered mode="blue" value={row.policySharePercent}>
                  {formatPercent(row.policySharePercent)}
                </CompactHeatCell>
                <CompactHeatCell bordered mode="pink" maxValue={maxes.clientCount} value={row.clientCount}>
                  {formatInteger(row.clientCount)}
                </CompactHeatCell>
                <CompactHeatCell bordered mode="pink" value={row.clientSharePercent}>
                  {formatPercent(row.clientSharePercent)}
                </CompactHeatCell>
                <CompactHeatCell bordered mode="lavender" maxValue={maxes.totalMesserPaid} value={row.totalMesserPaid}>
                  {formatCurrencyShort(row.totalMesserPaid)}
                </CompactHeatCell>
                <CompactHeatCell bordered mode="blue" maxValue={maxes.epsCommission} value={row.epsCommission}>
                  {formatCurrencyShort(row.epsCommission)}
                </CompactHeatCell>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ReportPanel>
  );
}

function ReportPanel({
  children,
  title,
  titleClassName = "",
}: {
  children: ReactNode;
  title: string;
  titleClassName?: string;
}) {
  return (
    <section className="flex flex-col">
      <h3 className={`mb-4 text-lg font-bold leading-tight text-slate-800 ${titleClassName}`}>
        {title}
      </h3>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-shadow duration-300 hover:shadow-md">
        {children}
      </div>
    </section>
  );
}

function getTrendLevelLabel(trendLevel: TrendComparisonChartLevel) {
  if (trendLevel === "quarter") return "Quarter";
  if (trendLevel === "year") return "Year";
  return "Month";
}

function getTrendChangeLabel(trendLevel: TrendComparisonChartLevel) {
  if (trendLevel === "quarter") return "QoQ";
  if (trendLevel === "year") return "YoY";
  return "MoM";
}

function groupRows(
  rows: HealthSalesRow[],
  getKey: (row: HealthSalesRow) => string
) {
  const grouped = new Map<string, HealthSalesRow[]>();

  for (const row of rows) {
    const key = getKey(row);
    const group = grouped.get(key) ?? [];

    group.push(row);
    grouped.set(key, group);
  }

  return grouped;
}

function getPolicyId(row: HealthSalesRow, index: number) {
  return cleanText(row.primary_member_id) || `__row_${index}`;
}

function getMonthKey(value: string | null) {
  const textValue = value?.trim();
  if (!textValue) return "";

  const monthMatch = textValue.match(/^(\d{4})-(\d{2})/);
  if (monthMatch) return `${monthMatch[1]}-${monthMatch[2]}`;

  const slashDateMatch = textValue.match(/^(\d{1,2})\/\d{1,2}\/(\d{4})$/);
  if (slashDateMatch) {
    return `${slashDateMatch[2]}-${slashDateMatch[1].padStart(2, "0")}`;
  }

  const slashMonthMatch = textValue.match(/^(\d{1,2})\/(\d{4})$/);
  if (slashMonthMatch) {
    return `${slashMonthMatch[2]}-${slashMonthMatch[1].padStart(2, "0")}`;
  }

  return "";
}

function getYearKey(value: string | null) {
  return getMonthKey(value).slice(0, 4);
}

function getQuarterKey(value: string | null) {
  const monthKey = getMonthKey(value);
  if (!monthKey) return "";

  const year = monthKey.slice(0, 4);
  const month = Number(monthKey.slice(5, 7));
  const quarter = Math.floor((month - 1) / 3) + 1;

  return `${year}-Q${quarter}`;
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

function getEpsOverride(row: HealthSalesRow) {
  return moneyValue(row.eps_override ?? row.eps_override_received);
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

function heatColor(
  value: number | null,
  maxValue: number,
  mode: "delta" | "green" | "blue" | "lavender" | "pink" | "magenta"
) {
  if (value === null || !Number.isFinite(value) || value === 0) return "transparent";

  const intensity = Math.min(Math.abs(value) / Math.max(Math.abs(maxValue), 1), 1);

  if (mode === "delta") {
    return value > 0
      ? rgba(157, 214, 165, 0.35 + intensity * 0.28)
      : rgba(237, 154, 148, 0.35 + intensity * 0.28);
  }

  if (mode === "green") return rgba(71, 181, 82, 0.12 + intensity * 0.55);
  if (mode === "blue") return rgba(73, 150, 232, 0.12 + intensity * 0.5);
  if (mode === "lavender") return rgba(137, 146, 204, 0.16 + intensity * 0.44);
  if (mode === "pink") return rgba(214, 109, 211, 0.12 + intensity * 0.5);

  return rgba(231, 60, 130, 0.12 + intensity * 0.5);
}

function rgba(red: number, green: number, blue: number, alpha: number) {
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function formatInteger(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatCurrencyExact(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: "currency",
  }).format(value);
}

function formatCurrencyCompact(value: number) {
  const amount = value / 1000;

  return `$${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(amount)}K`;
}

function formatCurrencyShort(value: number) {
  const absValue = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  const compactFormatter = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });

  if (absValue >= 1000000) {
    return `${sign}$${compactFormatter.format(absValue / 1000000)}M`;
  }

  if (absValue >= 1000) {
    return `${sign}$${compactFormatter.format(absValue / 1000)}K`;
  }

  return `${sign}${formatCurrencyExact(absValue)}`;
}

function formatPercent(value: number) {
  return `${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: Math.abs(value) >= 10 ? 1 : 0,
  }).format(value)}%`;
}

function formatPaidRatePercent(value: number) {
  return `${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  }).format(value)}%`;
}

function formatNullablePercent(value: number | null) {
  if (value == null) return "-";
  return formatPercent(value);
}

function formatMonthYear(monthKey: string) {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) return monthKey;

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(`${monthKey}-01T00:00:00Z`));
}

function formatReportMonth(value: string) {
  return value.slice(0, 7);
}

function maxDateString(current: string | null, next: string | null) {
  if (!next) return current;
  if (!current) return next;

  return next > current ? next : current;
}
