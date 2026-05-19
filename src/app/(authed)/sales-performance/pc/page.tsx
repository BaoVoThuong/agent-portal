import type { ReactNode } from "react";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { requirePermission } from "@/lib/rbac/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { PcSalesPerformanceFilters } from "./PcSalesPerformanceFilters";

export const dynamic = "force-dynamic";

type PcSalesPerformancePageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type PcSalesRow = {
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

type FilterValues = {
  policyNumber: string;
  agent: string;
  agency: string;
};

type FilterOptions = {
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
  policyChangePercent: number | null;
  premiumChangePercent: number | null;
  commissionChangePercent: number | null;
};

type QuarterSummary = Summary & {
  periodKey: string;
  periodLabel: string;
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

type RegionRow = Summary & {
  state: string;
  city: string;
  policySharePercent: number;
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
  quarterRows: QuarterSummary[];
  agencyMonthRows: AgencyMonthRow[];
  agentNames: string[];
  agentSalesGroups: AgentPivotGroup[];
  agentCommissionGroups: AgentCommissionGroup[];
  carrierRows: CarrierRow[];
  regionRows: RegionRow[];
  expiredRows: ExpiredMonthRow[];
  policyDetailRows: PolicyDetailRow[];
};

const PC_PAGE_SIZE = 1000;
const TREND_MONTH_LIMIT = 17;
const TABLE_MONTH_LIMIT = 16;
const QUARTER_LIMIT = 6;
const AGENCY_MONTH_LIMIT = 6;
const AGENT_PIVOT_MONTH_LIMIT = 5;
const AGENT_COMMISSION_MONTH_LIMIT = 4;
const CARRIER_ROW_LIMIT = 24;
const REGION_ROW_LIMIT = 24;
const EXPIRED_MONTH_LIMIT = 10;
const POLICY_DETAIL_LIMIT = 100;

export default async function PcSalesPerformancePage({
  searchParams,
}: PcSalesPerformancePageProps) {
  await requirePermission(PERMISSIONS.SALES_PERFORMANCE_ACCESS);

  const params = searchParams ? await searchParams : {};
  const filters = parseFilters(params);
  const allRows = await fetchPcSalesRows();
  const filteredRows = applyFilters(allRows, filters);
  const filterOptions = buildFilterOptions(allRows);
  const data = buildDashboardData(filteredRows);
  const dateRangeLabel = buildDateRangeLabel(allRows);

  return (
    <div className="bg-[#f1f1f1] px-4 py-5 text-[#2c2f34]">
      <div className="mx-auto max-w-[1480px]">
        <header className="mb-8 flex flex-wrap items-center justify-between gap-4 bg-[#e8edf4] px-3 py-3 shadow-sm">
          <h1 className="text-[2.45rem] font-bold leading-none tracking-normal text-[#20242b]">
            P&amp;C Performance Dashboard
          </h1>
          <div className="flex h-12 min-w-[280px] items-center justify-between rounded-sm border-2 border-[#9d9d9d] bg-[#eef2f6] px-6 text-sm font-semibold text-[#30343a] shadow-[0_2px_4px_rgba(0,0,0,0.22)]">
            <span>{dateRangeLabel}</span>
            <span aria-hidden="true" className="text-xs text-[#333]">
              v
            </span>
          </div>
        </header>

        <PcSalesPerformanceFilters filters={filters} options={filterOptions} />

        {filteredRows.length === 0 ? (
          <div className="rounded-sm border border-[#b8b8b8] bg-white px-8 py-16 text-center text-sm font-semibold text-[#667085] shadow-[0_2px_4px_rgba(0,0,0,0.18)]">
            No P&amp;C sales performance records match these filters.
          </div>
        ) : (
          <div className="space-y-9">
            <h2 className="text-[2.55rem] font-bold leading-tight text-[#1164c7]">
              Section 1: Business Overview
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

            <MonthlySalesTrendChart rows={data.trendRows} />
            <MonthlySalesSummaryTable rows={data.monthlyRows.slice(0, TABLE_MONTH_LIMIT)} />

            <section className="grid gap-10 xl:grid-cols-2">
              <QuarterMetricChart
                barLabel="Total Commission"
                percentLabel="Total Commission / Total Premium"
                rows={data.quarterRows}
                title="Total Commission & Yield Trend"
                value={(row) => row.totalCommission}
                percent={(row) => percentOf(row.totalCommission, row.totalPremium)}
              />
              <QuarterMetricChart
                barLabel="EPS Commission"
                percentLabel="EPS Commission / Total Premium"
                rows={data.quarterRows}
                title="EPS Commission & Margin Trend"
                value={(row) => row.epsCommission}
                percent={(row) => percentOf(row.epsCommission, row.totalPremium)}
              />
            </section>

            <MonthlyAgentCommissionTrendChart rows={data.trendRows} />
            <AgencyMonthSummaryTable rows={data.agencyMonthRows} />
            <AgentSalesVolumeTable
              agentNames={data.agentNames}
              groups={data.agentSalesGroups}
            />
            <AgentCommissionEarningsTable
              agentNames={data.agentNames}
              groups={data.agentCommissionGroups}
            />
            <CarrierPerformanceTable rows={data.carrierRows} />
            <RegionMapPanel rows={data.regionRows} />
            <RegionPolicyTable rows={data.regionRows} />
            <ExpiredPolicyTrendChart rows={data.expiredRows} />
            <PolicyDetailsTable
              rows={data.policyDetailRows.slice(0, POLICY_DETAIL_LIMIT)}
              totalCount={data.policyDetailRows.length}
            />
          </div>
        )}
      </div>
    </div>
  );
}

async function fetchPcSalesRows() {
  const supabase = getSupabaseAdmin();
  const rows: PcSalesRow[] = [];

  for (let from = 0; ; from += PC_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("pc_mart")
      .select(
        [
          "agent_name",
          "agency_name",
          "insured_name",
          "type",
          "company",
          "policy_number",
          "premium",
          "effective_date",
          "expired_date",
          "carrier_commission",
          "paid_producer",
          "statement_number",
          "true_premium",
          "expired_month_year",
          "effective_month_year",
          "status",
          "city",
          "state",
          "total_commission",
          "agent_commission_amount",
          "eps_commission_amount",
        ].join(",")
      )
      .order("effective_date", { ascending: false })
      .range(from, from + PC_PAGE_SIZE - 1);

    if (error) throw new Error(error.message);

    rows.push(...(((data ?? []) as unknown) as PcSalesRow[]));

    if (!data || data.length < PC_PAGE_SIZE) {
      return rows;
    }
  }
}

function buildDashboardData(rows: PcSalesRow[]): DashboardData {
  const overview = summarizeRows(rows);
  const monthlyRows = buildMonthlySummaries(rows);
  const trendRows = [...monthlyRows].reverse().slice(-TREND_MONTH_LIMIT);
  const agentNames = buildAgentNames(rows);

  return {
    overview,
    monthlyRows,
    trendRows,
    quarterRows: buildQuarterSummaries(rows),
    agencyMonthRows: buildAgencyMonthRows(rows),
    agentNames,
    agentSalesGroups: buildAgentSalesGroups(rows, agentNames),
    agentCommissionGroups: buildAgentCommissionGroups(rows, agentNames),
    carrierRows: buildCarrierRows(rows, overview).slice(0, CARRIER_ROW_LIMIT),
    regionRows: buildRegionRows(rows, overview).slice(0, REGION_ROW_LIMIT),
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

function buildMonthlySummaries(rows: PcSalesRow[]): MonthlySummary[] {
  const chronological = [...groupRows(rows, (row) => getEffectiveMonth(row)).entries()]
    .filter(([monthKey]) => Boolean(monthKey))
    .map(([monthKey, group]) => ({
      monthKey,
      ...summarizeRows(group),
    }))
    .sort((a, b) => a.monthKey.localeCompare(b.monthKey));

  const rowsWithChange = chronological.map<MonthlySummary>((row, index) => {
    const previous = chronological[index - 1] ?? null;

    return {
      ...row,
      policyChangePercent: calculateChangePercent(
        previous ? row.policyCount - previous.policyCount : null,
        previous?.policyCount ?? null
      ),
      premiumChangePercent: calculateChangePercent(
        previous ? row.totalPremium - previous.totalPremium : null,
        previous?.totalPremium ?? null
      ),
      commissionChangePercent: calculateChangePercent(
        previous ? row.totalCommission - previous.totalCommission : null,
        previous?.totalCommission ?? null
      ),
    };
  });

  return rowsWithChange.reverse();
}

function buildQuarterSummaries(rows: PcSalesRow[]): QuarterSummary[] {
  return [...groupRows(rows, (row) => getQuarterKey(getEffectiveMonth(row))).entries()]
    .filter(([periodKey]) => Boolean(periodKey))
    .map(([periodKey, group]) => ({
      periodKey,
      periodLabel: formatQuarterLabel(periodKey),
      ...summarizeRows(group),
    }))
    .sort((a, b) => a.periodKey.localeCompare(b.periodKey))
    .slice(-QUARTER_LIMIT);
}

function buildAgencyMonthRows(rows: PcSalesRow[]): AgencyMonthRow[] {
  const monthGroups = [...groupRows(rows, (row) => getEffectiveMonth(row)).entries()]
    .filter(([monthKey]) => Boolean(monthKey))
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, AGENCY_MONTH_LIMIT);
  const result: AgencyMonthRow[] = [];

  for (const [monthKey, monthRows] of monthGroups) {
    const agencyRows = [...groupRows(monthRows, (row) => cleanGroupLabel(row.agency_name)).entries()]
      .map(([agency, group]) => ({
        agency,
        isTotal: false,
        monthKey,
        ...summarizeRows(group),
      }))
      .sort((a, b) => b.policyCount - a.policyCount || a.agency.localeCompare(b.agency));

    result.push(...agencyRows);
    result.push({
      agency: "Total",
      isTotal: true,
      monthKey,
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
  agentNames: string[]
): AgentPivotGroup[] {
  return [...groupRows(rows, (row) => getEffectiveMonth(row)).entries()]
    .filter(([monthKey]) => Boolean(monthKey))
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, AGENT_PIVOT_MONTH_LIMIT)
    .map(([monthKey, monthRows]) => {
      const agencyRows = [...groupRows(monthRows, (row) => cleanGroupLabel(row.agency_name)).entries()]
        .map(([agency, agencyRows]) =>
          buildAgentPolicyPivotRow(agency, agencyRows, agentNames, false)
        )
        .sort((a, b) => b.grandTotal - a.grandTotal || a.agency.localeCompare(b.agency));

      return {
        monthKey,
        rows: agencyRows,
        total: buildAgentPolicyPivotRow("Monthly Policies Count", monthRows, agentNames, true),
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
  agentNames: string[]
): AgentCommissionGroup[] {
  return [...groupRows(rows, (row) => getEffectiveMonth(row)).entries()]
    .filter(([monthKey]) => Boolean(monthKey))
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, AGENT_COMMISSION_MONTH_LIMIT)
    .map(([monthKey, monthRows]) => {
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
        monthKey,
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

function buildRegionRows(rows: PcSalesRow[], overview: Summary): RegionRow[] {
  return [...groupRows(rows, (row) =>
    `${cleanGroupLabel(row.state)}\u001f${cleanGroupLabel(row.city)}`
  ).entries()]
    .map(([key, group]) => {
      const [state, city] = key.split("\u001f");
      const summary = summarizeRows(group);

      return {
        state,
        city,
        ...summary,
        policySharePercent: percentOf(summary.policyCount, overview.policyCount),
      };
    })
    .sort(
      (a, b) =>
        b.policyCount - a.policyCount ||
        b.totalPremium - a.totalPremium ||
        a.state.localeCompare(b.state) ||
        a.city.localeCompare(b.city)
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
      className={`flex flex-col items-center justify-center rounded-sm border border-[#cdcdcd] bg-white px-5 text-center shadow-[3px_3px_4px_rgba(0,0,0,0.28)] ${
        compact ? "min-h-[104px] py-4" : "min-h-[122px] py-5"
      }`}
    >
      <div
        className={`font-semibold leading-tight ${
          compact ? "text-[1.25rem]" : "text-[1.35rem]"
        } ${muted ? "text-[#858991]" : "text-[#5d6068]"}`}
      >
        {label}
      </div>
      <div
        className={`mt-1 font-semibold leading-tight text-[#111] ${
          compact ? "text-[2.35rem]" : "text-[2.55rem]"
        }`}
      >
        {value}
      </div>
    </article>
  );
}

function MonthlySalesTrendChart({ rows }: { rows: MonthlySummary[] }) {
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

  return (
    <ReportPanel title="Monthly Sales Volume & Premium Trend">
      <div className="overflow-x-auto">
        <svg className="min-w-[1120px]" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Monthly sales volume and premium trend">
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
            <g key={point.monthKey}>
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
            <g key={`${point.monthKey}-policy`}>
              <circle cx={point.centerX} cy={point.policyY} fill="#347cf4" r="5" />
              <text x={point.centerX} y={point.policyY - 12} textAnchor="middle" className="fill-[#347cf4] text-[15px] font-bold">
                {formatInteger(point.policyCount)}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </ReportPanel>
  );
}

function MonthlySalesSummaryTable({ rows }: { rows: MonthlySummary[] }) {
  return (
    <ReportPanel title="Monthly Sales Performance Summary">
      <div className="overflow-auto">
        <table className="min-w-[1260px] w-full table-fixed text-[12px]">
          <thead>
            <tr className="bg-[#edf3fb] text-left font-bold">
              <HeaderCell width="15%">Month</HeaderCell>
              <HeaderCell align="right" width="14%">Policies Count</HeaderCell>
              <HeaderCell align="right" width="16%">Policy MoM %</HeaderCell>
              <HeaderCell align="right" width="18%">Total Premium</HeaderCell>
              <HeaderCell align="right" width="16%">Premium MoM %</HeaderCell>
              <HeaderCell align="right" width="16%">Total Commission</HeaderCell>
              <HeaderCell align="right" width="15%">Commission MoM %</HeaderCell>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.monthKey} className={index % 2 === 0 ? "bg-white" : "bg-[#f7f8fa]"}>
                <BodyCell strong>{row.monthKey}</BodyCell>
                <BodyCell align="right">{formatInteger(row.policyCount)}</BodyCell>
                <BarDeltaCell value={row.policyChangePercent} />
                <BodyCell align="right">{formatCurrencyShort(row.totalPremium)}</BodyCell>
                <BarDeltaCell color="orange" value={row.premiumChangePercent} />
                <BodyCell align="right">{formatCurrency(row.totalCommission)}</BodyCell>
                <BarDeltaCell color="pink" value={row.commissionChangePercent} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ReportPanel>
  );
}

function QuarterMetricChart({
  barLabel,
  percentLabel,
  rows,
  title,
  value,
  percent,
}: {
  barLabel: string;
  percentLabel: string;
  rows: QuarterSummary[];
  title: string;
  value: (row: QuarterSummary) => number;
  percent: (row: QuarterSummary) => number;
}) {
  const width = 620;
  const height = 360;
  const left = 72;
  const right = 74;
  const top = 54;
  const bottom = 56;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const maxAmount = roundAxisMax(maxValue(rows, value));
  const maxPercent = Math.max(20, roundAxisMax(maxValue(rows, percent)));
  const groupWidth = plotWidth / Math.max(rows.length, 1);
  const barWidth = Math.min(64, groupWidth * 0.55);
  const points = rows.map((row, index) => {
    const centerX = left + index * groupWidth + groupWidth / 2;
    const amount = value(row);
    const rate = percent(row);
    const barHeight = (amount / maxAmount) * plotHeight;

    return {
      amount,
      barHeight,
      barY: top + plotHeight - barHeight,
      centerX,
      lineY: top + plotHeight - (rate / maxPercent) * plotHeight,
      rate,
      row,
    };
  });

  return (
    <ReportPanel title={title}>
      <div className="overflow-x-auto">
        <svg className="min-w-[560px]" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
          <g transform="translate(78, 18)">
            <rect width="30" height="12" fill="#d6d6d6" />
            <text x="40" y="12" className="fill-[#4a4f58] text-[13px] font-semibold">
              {barLabel}
            </text>
            <line x1="240" x2="272" y1="7" y2="7" stroke="#d94242" strokeWidth="2" />
            <circle cx="256" cy="7" r="4" fill="#d94242" />
            <text x="282" y="12" className="fill-[#4a4f58] text-[13px] font-semibold">
              {percentLabel}
            </text>
          </g>

          {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
            const y = top + plotHeight - tick * plotHeight;

            return (
              <g key={tick}>
                <line x1={left} x2={width - right} y1={y} y2={y} stroke="#d4d4d4" />
                <text x={left - 12} y={y + 4} textAnchor="end" className="fill-[#4a4f58] text-[12px]">
                  {formatAxisMoney(maxAmount * tick)}
                </text>
                <text x={width - right + 12} y={y + 4} className="fill-[#4a4f58] text-[12px]">
                  {formatPercent(maxPercent * tick)}
                </text>
              </g>
            );
          })}

          {points.map((point) => (
            <g key={point.row.periodKey}>
              <rect
                fill="#d6d6d6"
                height={Math.max(point.barHeight, 2)}
                width={barWidth}
                x={point.centerX - barWidth / 2}
                y={point.barY}
              />
              <text x={point.centerX} y={Math.max(point.barY - 8, top + 16)} textAnchor="middle" className="fill-[#333840] text-[12px] font-bold">
                {formatCurrencyShort(point.amount)}
              </text>
              <text x={point.centerX} y={top + plotHeight + 28} textAnchor="middle" className="fill-[#30343a] text-[13px] font-semibold">
                {point.row.periodLabel}
              </text>
            </g>
          ))}

          <path
            d={points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.centerX} ${point.lineY}`).join(" ")}
            fill="none"
            stroke="#d94242"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
          />

          {points.map((point) => (
            <g key={`${point.row.periodKey}-rate`}>
              <circle cx={point.centerX} cy={point.lineY} fill="#d94242" r="4" />
              <text x={point.centerX} y={point.lineY - 12} textAnchor="middle" className="fill-[#d94242] text-[12px] font-bold">
                {formatPercent(point.rate)}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </ReportPanel>
  );
}

function MonthlyAgentCommissionTrendChart({ rows }: { rows: MonthlySummary[] }) {
  const width = 1280;
  const height = 380;
  const left = 76;
  const right = 86;
  const top = 54;
  const bottom = 62;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const maxCommission = roundAxisMax(maxValue(rows, (row) => row.agentCommission));
  const maxRate = Math.max(15, roundAxisMax(maxValue(rows, (row) => percentOf(row.agentCommission, row.totalPremium))));
  const groupWidth = plotWidth / Math.max(rows.length, 1);
  const barWidth = Math.min(54, Math.max(24, groupWidth * 0.55));
  const points = rows.map((row, index) => {
    const centerX = left + index * groupWidth + groupWidth / 2;
    const rate = percentOf(row.agentCommission, row.totalPremium);
    const barHeight = (row.agentCommission / maxCommission) * plotHeight;

    return {
      ...row,
      barHeight,
      barY: top + plotHeight - barHeight,
      centerX,
      lineY: top + plotHeight - (rate / maxRate) * plotHeight,
      rate,
    };
  });

  return (
    <ReportPanel title="Agent Commission Payout Trend">
      <div className="overflow-x-auto">
        <svg className="min-w-[1120px]" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Agent commission payout trend">
          <g transform="translate(78, 18)">
            <rect width="30" height="12" fill="#d6d6d6" />
            <text x="40" y="12" className="fill-[#4a4f58] text-[13px] font-semibold">
              Agent Commission
            </text>
            <line x1="238" x2="270" y1="7" y2="7" stroke="#d94242" strokeWidth="2" />
            <circle cx="254" cy="7" r="4" fill="#d94242" />
            <text x="280" y="12" className="fill-[#4a4f58] text-[13px] font-semibold">
              Total Agent Commission / Total Premium
            </text>
          </g>

          {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
            const y = top + plotHeight - tick * plotHeight;

            return (
              <g key={tick}>
                <line x1={left} x2={width - right} y1={y} y2={y} stroke="#d4d4d4" />
                <text x={left - 12} y={y + 4} textAnchor="end" className="fill-[#4a4f58] text-[12px]">
                  {formatAxisMoney(maxCommission * tick)}
                </text>
                <text x={width - right + 12} y={y + 4} className="fill-[#4a4f58] text-[12px]">
                  {formatPercent(maxRate * tick)}
                </text>
              </g>
            );
          })}

          {points.map((point) => (
            <g key={point.monthKey}>
              <rect
                fill="#d6d6d6"
                height={Math.max(point.barHeight, 2)}
                width={barWidth}
                x={point.centerX - barWidth / 2}
                y={point.barY}
              />
              <text x={point.centerX} y={Math.max(point.barY - 10, top + 16)} textAnchor="middle" className="fill-[#252a31] text-[15px] font-bold">
                {formatCurrencyShort(point.agentCommission)}
              </text>
              <text x={point.centerX} y={top + plotHeight + 22} textAnchor="middle" className="fill-[#3e444d] text-[12px] font-semibold">
                {formatMonthShort(point.monthKey)}
              </text>
            </g>
          ))}

          <path
            d={points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.centerX} ${point.lineY}`).join(" ")}
            fill="none"
            stroke="#d94242"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
          />

          {points.map((point) => (
            <g key={`${point.monthKey}-rate`}>
              <circle cx={point.centerX} cy={point.lineY} fill="#d94242" r="4" />
              <text x={point.centerX} y={point.lineY - 12} textAnchor="middle" className="fill-[#d94242] text-[13px] font-bold">
                {formatPercent(point.rate)}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </ReportPanel>
  );
}

function AgencyMonthSummaryTable({ rows }: { rows: AgencyMonthRow[] }) {
  return (
    <ReportPanel title="Monthly Sales Performance Summary">
      <div className="max-h-[520px] overflow-auto">
        <table className="min-w-[1120px] w-full table-fixed text-[12px]">
          <thead>
            <tr className="bg-[#edf3fb] text-left font-bold">
              <HeaderCell width="13%">Report Month</HeaderCell>
              <HeaderCell width="14%">Agency</HeaderCell>
              <HeaderCell align="right" width="14%">Total Policies</HeaderCell>
              <HeaderCell align="right" width="18%">Total Premium</HeaderCell>
              <HeaderCell align="right" width="18%">Total Commission</HeaderCell>
              <HeaderCell align="right" width="18%">EPS Commission</HeaderCell>
              <HeaderCell align="right" width="18%">Total Agent Commission</HeaderCell>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${row.monthKey}-${row.agency}-${index}`} className={`${row.isTotal ? "bg-white font-bold" : index % 2 === 0 ? "bg-white" : "bg-[#f7f8fa]"}`}>
                <BodyCell>{row.monthKey ? row.monthKey : ""}</BodyCell>
                <BodyCell strong={row.isTotal}>{row.agency}</BodyCell>
                <BodyCell align="right">{formatInteger(row.policyCount)}</BodyCell>
                <BodyCell align="right">{formatCurrencyShort(row.totalPremium)}</BodyCell>
                <BodyCell align="right">{formatCurrency(row.totalCommission)}</BodyCell>
                <BodyCell align="right">{formatCurrency(row.epsCommission)}</BodyCell>
                <BodyCell align="right">{formatCurrency(row.agentCommission)}</BodyCell>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ReportPanel>
  );
}

function AgentSalesVolumeTable({
  agentNames,
  groups,
}: {
  agentNames: string[];
  groups: AgentPivotGroup[];
}) {
  const grandTotals = totalAgentPivotRows(
    groups.flatMap((group) => [...group.rows]),
    agentNames,
    "Grand total"
  );

  return (
    <ReportPanel title="Agent Sales Volume by Month">
      <div className="max-h-[620px] overflow-auto">
        <table className="min-w-[1120px] w-full table-fixed text-[12px]">
          <thead>
            <tr className="bg-[#bfe3fb] text-right font-bold">
              <HeaderCell width="13%">Total Policies</HeaderCell>
              <HeaderCell width="16%">Agency</HeaderCell>
              <HeaderCell align="right" colSpan={agentNames.length + 1}>
                Agent Name / Policies Count
              </HeaderCell>
            </tr>
            <tr className="bg-white text-left font-bold">
              <HeaderCell>Report Month</HeaderCell>
              <HeaderCell>Agency</HeaderCell>
              {agentNames.map((agent) => (
                <HeaderCell key={agent} align="right">
                  {agent}
                </HeaderCell>
              ))}
              <HeaderCell align="right">Grand total</HeaderCell>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <AgentPivotRows
                agentNames={agentNames}
                group={group}
                key={group.monthKey}
              />
            ))}
            <tr className="bg-white font-bold">
              <BodyCell>Grand total</BodyCell>
              <BodyCell />
              {agentNames.map((agent) => (
                <BodyCell align="right" key={agent}>
                  {formatInteger(grandTotals.valuesByAgent[agent] ?? 0)}
                </BodyCell>
              ))}
              <BodyCell align="right">{formatInteger(grandTotals.grandTotal)}</BodyCell>
            </tr>
          </tbody>
        </table>
      </div>
    </ReportPanel>
  );
}

function AgentPivotRows({
  agentNames,
  group,
}: {
  agentNames: string[];
  group: AgentPivotGroup;
}) {
  const rows = [...group.rows, group.total];

  return (
    <>
      {rows.map((row, index) => (
        <tr
          className={`${row.isTotal ? "bg-white font-bold" : index % 2 === 0 ? "bg-white" : "bg-[#f7f8fa]"}`}
          key={`${group.monthKey}-${row.agency}-${index}`}
        >
          <BodyCell>{index === 0 ? group.monthKey : ""}</BodyCell>
          <BodyCell strong={row.isTotal}>{row.agency}</BodyCell>
          {agentNames.map((agent) => (
            <BodyCell align="right" key={agent}>
              {formatInteger(row.valuesByAgent[agent] ?? 0)}
            </BodyCell>
          ))}
          <BodyCell align="right">{formatInteger(row.grandTotal)}</BodyCell>
        </tr>
      ))}
    </>
  );
}

function AgentCommissionEarningsTable({
  agentNames,
  groups,
}: {
  agentNames: string[];
  groups: AgentCommissionGroup[];
}) {
  const grandTotals = totalCommissionPivotRows(
    groups.flatMap((group) => group.rows),
    agentNames,
    "Grand total"
  );

  return (
    <ReportPanel title="Agent Commission Earnings by Month">
      <div className="max-h-[640px] overflow-auto">
        <table className="min-w-[1220px] w-full table-fixed text-[12px]">
          <thead>
            <tr className="bg-[#fdeba9] text-right font-bold">
              <HeaderCell width="12%">Month Report</HeaderCell>
              <HeaderCell width="14%">Agency</HeaderCell>
              <HeaderCell width="20%">Statement Number</HeaderCell>
              <HeaderCell align="right" colSpan={agentNames.length + 1}>
                Agent Name / Commission Amount
              </HeaderCell>
            </tr>
            <tr className="bg-white text-left font-bold">
              <HeaderCell>Month Report</HeaderCell>
              <HeaderCell>Agency</HeaderCell>
              <HeaderCell>Statement Number</HeaderCell>
              {agentNames.map((agent) => (
                <HeaderCell align="right" key={agent}>
                  {agent}
                </HeaderCell>
              ))}
              <HeaderCell align="right">Grand total</HeaderCell>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <AgentCommissionRows
                agentNames={agentNames}
                group={group}
                key={group.monthKey}
              />
            ))}
            <tr className="bg-white font-bold">
              <BodyCell>Grand total</BodyCell>
              <BodyCell />
              <BodyCell />
              {agentNames.map((agent) => (
                <BodyCell align="right" key={agent}>
                  {formatCurrency(grandTotals.valuesByAgent[agent] ?? 0)}
                </BodyCell>
              ))}
              <BodyCell align="right">{formatCurrency(grandTotals.grandTotal)}</BodyCell>
            </tr>
          </tbody>
        </table>
      </div>
    </ReportPanel>
  );
}

function AgentCommissionRows({
  agentNames,
  group,
}: {
  agentNames: string[];
  group: AgentCommissionGroup;
}) {
  const rows = [...group.rows, group.monthlyTotal];

  return (
    <>
      {rows.map((row, index) => (
        <tr
          className={`${row.isTotal ? "bg-white font-bold" : index % 2 === 0 ? "bg-white" : "bg-[#f7f8fa]"}`}
          key={`${group.monthKey}-${row.agency}-${row.statement}-${index}`}
        >
          <BodyCell>{index === 0 ? group.monthKey : ""}</BodyCell>
          <BodyCell strong={row.isTotal}>{row.agency}</BodyCell>
          <BodyCell>{row.statement}</BodyCell>
          {agentNames.map((agent) => (
            <BodyCell align="right" key={agent}>
              {formatCurrency(row.valuesByAgent[agent] ?? 0)}
            </BodyCell>
          ))}
          <BodyCell align="right">{formatCurrency(row.grandTotal)}</BodyCell>
        </tr>
      ))}
    </>
  );
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

  return (
    <ReportPanel title="Carrier Performance Overview">
      <div className="max-h-[620px] overflow-auto">
        <table className="min-w-[1220px] w-full table-fixed text-[12px]">
          <thead>
            <tr className="bg-[#edf3fb] text-left font-bold">
              <HeaderCell width="20%">Company</HeaderCell>
              <HeaderCell align="right" width="14%">Policies Count</HeaderCell>
              <HeaderCell align="right" width="15%">% Policies Count</HeaderCell>
              <HeaderCell align="right" width="19%">Total Premium</HeaderCell>
              <HeaderCell align="right" width="17%">Total Commission</HeaderCell>
              <HeaderCell align="right" width="15%">Average Commission Rate</HeaderCell>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.company} className={index % 2 === 0 ? "bg-white" : "bg-[#f7f8fa]"}>
                <BodyCell strong>{row.company}</BodyCell>
                <BarBodyCell color="blue" maxValue={maxValue(rows, (item) => item.policyCount)} value={row.policyCount}>
                  {formatInteger(row.policyCount)}
                </BarBodyCell>
                <BarBodyCell color="orange" maxValue={100} value={row.policySharePercent}>
                  {formatPercent(row.policySharePercent)}
                </BarBodyCell>
                <BarBodyCell color="purple" maxValue={maxValue(rows, (item) => item.totalPremium)} value={row.totalPremium}>
                  {formatCurrency(row.totalPremium)}
                </BarBodyCell>
                <BarBodyCell color="olive" maxValue={maxValue(rows, (item) => item.totalCommission)} value={row.totalCommission}>
                  {formatCurrency(row.totalCommission)}
                </BarBodyCell>
                <BarBodyCell color="cyan" maxValue={Math.max(20, maxValue(rows, (item) => item.averageCommissionRate))} value={row.averageCommissionRate}>
                  {formatPercent(row.averageCommissionRate)}
                </BarBodyCell>
              </tr>
            ))}
            <tr className="bg-white font-bold">
              <BodyCell>Grand total</BodyCell>
              <BodyCell align="right">{formatInteger(total.policyCount)}</BodyCell>
              <BodyCell align="right">100%</BodyCell>
              <BodyCell align="right">{formatCurrency(total.totalPremium)}</BodyCell>
              <BodyCell align="right">{formatCurrency(total.totalCommission)}</BodyCell>
              <BodyCell align="right">{formatPercent(percentOf(total.totalCommission, total.totalPremium))}</BodyCell>
            </tr>
          </tbody>
        </table>
      </div>
    </ReportPanel>
  );
}

function RegionMapPanel({ rows }: { rows: RegionRow[] }) {
  const maxPolicies = maxValue(rows, (row) => row.policyCount);

  return (
    <ReportPanel title="Client Distribution by Region">
      <div className="h-[520px] bg-[#edf0f2]">
        <svg className="h-full w-full" viewBox="0 0 1280 520" role="img" aria-label="Client distribution by region">
          <rect fill="#eef0f1" height="520" width="1280" />
          {Array.from({ length: 14 }, (_, index) => (
            <line
              key={`h-${index}`}
              stroke="#d2d5d7"
              strokeWidth="1"
              x1="0"
              x2="1280"
              y1={40 + index * 35}
              y2={40 + index * 35}
            />
          ))}
          {Array.from({ length: 16 }, (_, index) => (
            <line
              key={`v-${index}`}
              stroke="#d8dbdd"
              strokeWidth="1"
              x1={40 + index * 80}
              x2={40 + index * 80}
              y1="0"
              y2="520"
            />
          ))}
          <path
            d="M34 412 C130 330 176 292 266 326 C368 364 406 304 496 262 C600 212 724 196 818 234 C940 282 1008 244 1194 170"
            fill="none"
            stroke="#c0c6cb"
            strokeWidth="5"
          />
          <path
            d="M100 162 C210 98 328 100 442 132 C546 162 610 122 706 106 C826 86 906 138 1002 126 C1106 112 1160 68 1240 44"
            fill="none"
            stroke="#cbd1d5"
            strokeWidth="4"
          />
          {rows.slice(0, 60).map((row, index) => {
            const point = getRegionPoint(row, index);
            const radius = 10 + (row.policyCount / maxPolicies) * 28;

            return (
              <g key={`${row.state}-${row.city}-${index}`}>
                <circle cx={point.x} cy={point.y} fill="rgba(39, 174, 96, 0.34)" r={radius + 14} />
                <circle cx={point.x} cy={point.y} fill="rgba(248, 196, 66, 0.48)" r={Math.max(radius - 3, 6)} />
                <circle cx={point.x} cy={point.y} fill="rgba(255, 86, 71, 0.55)" r={Math.max(radius * 0.35, 3)} />
              </g>
            );
          })}
          <text className="fill-[#8a8f95] text-[28px] font-bold" x="658" y="278">
            Houston
          </text>
          <text className="fill-[#8a8f95] text-[26px] font-bold" x="226" y="358">
            San Antonio
          </text>
          <text className="fill-[#8a8f95] text-[20px] font-semibold" x="496" y="250">
            Austin
          </text>
          <rect fill="rgba(255,255,255,0.82)" height="28" width="132" x="22" y="476" />
          <text className="fill-[#6b7280] text-[13px] font-semibold" x="32" y="495">
            Region heat view
          </text>
        </svg>
      </div>
    </ReportPanel>
  );
}

function RegionPolicyTable({ rows }: { rows: RegionRow[] }) {
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

  return (
    <ReportPanel title="Region Policy & Premium Performance">
      <div className="max-h-[620px] overflow-auto">
        <table className="min-w-[1140px] w-full table-fixed text-[12px]">
          <thead>
            <tr className="bg-[#edf3fb] text-left font-bold">
              <HeaderCell width="12%">State</HeaderCell>
              <HeaderCell width="18%">City</HeaderCell>
              <HeaderCell align="right" width="16%">Policies Count</HeaderCell>
              <HeaderCell align="right" width="16%">% Policies Count</HeaderCell>
              <HeaderCell align="right" width="19%">Total Premium</HeaderCell>
              <HeaderCell align="right" width="19%">Total Commission</HeaderCell>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${row.state}-${row.city}`} className={index % 2 === 0 ? "bg-white" : "bg-[#f7f8fa]"}>
                <BodyCell strong>{row.state}</BodyCell>
                <BodyCell>{row.city}</BodyCell>
                <BarBodyCell color="blue" maxValue={maxValue(rows, (item) => item.policyCount)} value={row.policyCount}>
                  {formatInteger(row.policyCount)}
                </BarBodyCell>
                <BarBodyCell color="orange" maxValue={100} value={row.policySharePercent}>
                  {formatPercent(row.policySharePercent)}
                </BarBodyCell>
                <BarBodyCell color="purple" maxValue={maxValue(rows, (item) => item.totalPremium)} value={row.totalPremium}>
                  {formatCurrency(row.totalPremium)}
                </BarBodyCell>
                <BarBodyCell color="olive" maxValue={maxValue(rows, (item) => item.totalCommission)} value={row.totalCommission}>
                  {formatCurrency(row.totalCommission)}
                </BarBodyCell>
              </tr>
            ))}
            <tr className="bg-white font-bold">
              <BodyCell>Grand total</BodyCell>
              <BodyCell />
              <BodyCell align="right">{formatInteger(total.policyCount)}</BodyCell>
              <BodyCell align="right">100%</BodyCell>
              <BodyCell align="right">{formatCurrency(total.totalPremium)}</BodyCell>
              <BodyCell align="right">{formatCurrency(total.totalCommission)}</BodyCell>
            </tr>
          </tbody>
        </table>
      </div>
    </ReportPanel>
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
      <div className="overflow-auto">
        <table className="min-w-[1200px] w-full table-fixed text-[12px]">
          <thead>
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
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <section>
      <h3 className="mb-2 text-[1.45rem] font-bold leading-tight text-[#2b2e33]">
        {title}
      </h3>
      <div className="overflow-hidden rounded-sm border border-[#b8b8b8] bg-white shadow-[2px_2px_4px_rgba(0,0,0,0.26)]">
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
      className={`border-b border-[#d7dce3] px-3 py-2 align-middle font-bold ${
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
      className={`border-b border-[#eef0f3] px-3 py-2 align-middle text-[#333840] ${
        align === "right" ? "text-right" : "text-left"
      } ${strong ? "font-bold" : ""}`}
    >
      {children}
    </td>
  );
}

function BarDeltaCell({
  color = "blue",
  value,
}: {
  color?: "blue" | "orange" | "pink";
  value: number | null;
}) {
  const width = value === null ? 0 : Math.min(Math.abs(value), 100);

  return (
    <td className="border-b border-[#eef0f3] px-3 py-2 text-right align-middle text-[#333840]">
      <div className="grid grid-cols-[1fr_6rem] items-center gap-2">
        <div className="relative h-4">
          <div
            className={`absolute top-1/2 h-3 -translate-y-1/2 ${value !== null && value < 0 ? "right-1/2" : "left-1/2"} ${deltaColorClassName(color)}`}
            style={{ width: `${width / 2}%` }}
          />
          <span className="absolute left-1/2 top-0 h-full w-px bg-[#c7cbd1]" />
        </div>
        <span>{formatNullablePercent(value)}</span>
      </div>
    </td>
  );
}

function BarBodyCell({
  children,
  color,
  maxValue,
  value,
}: {
  children: ReactNode;
  color: "blue" | "orange" | "purple" | "olive" | "cyan";
  maxValue: number;
  value: number;
}) {
  const width = maxValue === 0 ? 0 : Math.min(Math.abs(value / maxValue) * 100, 100);

  return (
    <td className="border-b border-[#eef0f3] px-3 py-2 text-right align-middle text-[#333840]">
      <div className="relative h-5">
        <div
          className={`absolute right-0 top-1/2 h-3 -translate-y-1/2 ${barColorClassName(color)}`}
          style={{ width: `${width}%` }}
        />
        <span className="relative z-10 font-semibold">{children}</span>
      </div>
    </td>
  );
}

function buildFilterOptions(rows: PcSalesRow[]): FilterOptions {
  return {
    agencies: uniqueSorted(
      rows.map((row) => cleanGroupLabel(row.agency_name)).filter((value) => value !== "null")
    ),
    agents: uniqueSorted(
      rows.map((row) => cleanGroupLabel(row.agent_name)).filter((value) => value !== "null")
    ),
  };
}

function applyFilters(rows: PcSalesRow[], filters: FilterValues) {
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

function parseFilters(params: Record<string, string | string[] | undefined>): FilterValues {
  return {
    agency: parseStringParam(params.agency),
    agent: parseStringParam(params.agent),
    policyNumber: parseStringParam(params.policyNumber),
  };
}

function parseStringParam(value: string | string[] | undefined) {
  const rawValue = Array.isArray(value) ? value[0] : value;

  return rawValue?.trim() ?? "";
}

function buildDateRangeLabel(rows: PcSalesRow[]) {
  const monthKeys = rows.map((row) => getEffectiveMonth(row)).filter(Boolean).sort();
  const firstMonth = monthKeys[0];

  if (!firstMonth) return "No effective dates";

  return `${formatFullDate(`${firstMonth}-01`)} - ${formatFullDate(new Date())}`;
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

function getQuarterKey(monthKey: string) {
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

function deltaColorClassName(color: "blue" | "orange" | "pink") {
  if (color === "orange") return "bg-[#ff9e4a]";
  if (color === "pink") return "bg-[#eb4f8f]";

  return "bg-[#2f80ed]";
}

function barColorClassName(color: "blue" | "orange" | "purple" | "olive" | "cyan") {
  if (color === "blue") return "bg-[#2f80ed]";
  if (color === "orange") return "bg-[#ff9e4a]";
  if (color === "purple") return "bg-[#b27be7]";
  if (color === "olive") return "bg-[#b1c454]";

  return "bg-[#28b8c7]";
}

function getRegionPoint(row: RegionRow, index: number) {
  const city = row.city.toUpperCase();
  const known: Record<string, { x: number; y: number }> = {
    AUSTIN: { x: 478, y: 242 },
    BEAUMONT: { x: 1110, y: 278 },
    CONROE: { x: 806, y: 216 },
    CYPRESS: { x: 712, y: 268 },
    FULSHEAR: { x: 682, y: 310 },
    GEORGETOWN: { x: 486, y: 198 },
    HOUSTON: { x: 766, y: 296 },
    KATY: { x: 690, y: 304 },
    MISSOURI: { x: 742, y: 332 },
    PFLUGERVILLE: { x: 504, y: 226 },
    RICHMOND: { x: 708, y: 326 },
    "SAN ANTONIO": { x: 280, y: 360 },
    SPRING: { x: 762, y: 236 },
    "SUGAR LAND": { x: 744, y: 320 },
    TOMBALL: { x: 724, y: 232 },
  };

  const exact = known[city];
  if (exact) return exact;

  const contains = Object.entries(known).find(([name]) => city.includes(name));
  if (contains) return contains[1];

  return {
    x: 180 + ((index * 137) % 930),
    y: 120 + ((index * 83) % 280),
  };
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

  if (absValue >= 1000000) {
    return `$${new Intl.NumberFormat("en-US", {
      maximumFractionDigits: 2,
      minimumFractionDigits: 0,
    }).format(value / 1000000)}M`;
  }

  if (absValue >= 1000) {
    return `$${new Intl.NumberFormat("en-US", {
      maximumFractionDigits: 1,
      minimumFractionDigits: 0,
    }).format(value / 1000)}K`;
  }

  return formatCurrency(value);
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

function formatMonthShort(monthKey: string) {
  if (!monthKey) return "";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
  }).format(toDate(`${monthKey}-01`));
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(toDate(value));
}

function formatFullDate(value: string | Date) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(value instanceof Date ? value : toDate(value));
}

function toDate(value: string) {
  return new Date(`${value}T00:00:00`);
}
