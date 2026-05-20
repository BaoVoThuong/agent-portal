import { Fragment, type ReactNode } from "react";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { requirePermission } from "@/lib/rbac/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { HealthSalesPerformanceFilters } from "./HealthSalesPerformanceFilters";

export const dynamic = "force-dynamic";

type HealthSalesPerformancePageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

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

type FilterValues = {
  agent: string;
  carrier: string;
  reportMonth: string;
  messerStatement: string;
  primaryMemberId: string;
};

type FilterOptions = {
  agents: string[];
  carriers: string[];
  reportMonths: string[];
  messerStatements: string[];
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
};

type MonthlySummary = Summary & {
  monthKey: string;
};

type SalesMomRow = MonthlySummary & {
  policyChange: number | null;
  policyChangePercent: number | null;
  clientChange: number | null;
  clientChangePercent: number | null;
  messerPaidChange: number | null;
  messerPaidChangePercent: number | null;
};

type QuarterSummary = Summary & {
  periodKey: string;
  periodLabel: string;
};

type AgentPerformanceRow = Summary & {
  agent: string;
  policySharePercent: number;
  clientSharePercent: number;
};

type MonthlyAgentGroup = {
  monthKey: string;
  rows: AgentPerformanceRow[];
  total: AgentPerformanceRow;
};

type AgentMonthPivotRow = {
  agent: string;
  months: {
    monthKey: string;
    policyCount: number;
    policyChangePercent: number | null;
    agentReceived: number;
    agentReceivedChangePercent: number | null;
  }[];
};

type CarrierPerformanceRow = Summary & {
  carrier: string;
  paidPolicyPercent: number;
  epsCommissionPercent: number;
  epsOverridePercent: number;
  epsSplitPercent: number;
};

type MonthlyCarrierGroup = {
  monthKey: string;
  rows: MonthlyCarrierRow[];
};

type MonthlyCarrierRow = Summary & {
  carrier: string;
  statement: string;
  isTotal: boolean;
};

type StatePerformanceRow = Summary & {
  state: string;
  policySharePercent: number;
  clientSharePercent: number;
};

type PolicyInfoRow = {
  month: string;
  agent: string;
  dealName: string;
  primaryMemberId: string;
  carrier: string;
  messerPaid: number | null;
  effectiveDate: string | null;
};

type DashboardData = {
  overview: Summary;
  monthlyRows: MonthlySummary[];
  trendRows: MonthlySummary[];
  salesMomRows: SalesMomRow[];
  quarterRows: QuarterSummary[];
  agentRows: AgentPerformanceRow[];
  monthlyAgentGroups: MonthlyAgentGroup[];
  agentMomPivotRows: AgentMonthPivotRow[];
  agentMomMonthKeys: string[];
  carrierRows: CarrierPerformanceRow[];
  monthlyCarrierGroups: MonthlyCarrierGroup[];
  stateRows: StatePerformanceRow[];
  policyInfoRows: PolicyInfoRow[];
};

const HEALTH_SALES_PAGE_SIZE = 1000;
const TREND_MONTH_LIMIT = 12;
const TREND_MIN_POLICY_COUNT = 100;
const TABLE_MONTH_LIMIT = 14;
const QUARTER_LIMIT = 6;
const AGENT_ROW_LIMIT = 16;
const MONTHLY_AGENT_MONTH_LIMIT = 3;
const MONTHLY_AGENT_ROW_LIMIT = 12;
const CARRIER_ROW_LIMIT = 28;
const MONTHLY_CARRIER_MONTH_LIMIT = 2;
const MONTHLY_CARRIER_ROW_LIMIT = 34;
const STATE_ROW_LIMIT = 29;
const POLICY_INFO_LIMIT = 100;

export default async function HealthSalesPerformancePage({
  searchParams,
}: HealthSalesPerformancePageProps) {
  await requirePermission(PERMISSIONS.SALES_PERFORMANCE_ACCESS);

  const params = searchParams ? await searchParams : {};
  const filters = parseFilters(params);
  const allRows = await fetchHealthSalesRows();
  const filteredRows = applyFilters(allRows, filters);
  const filterOptions = buildFilterOptions(allRows);
  const data = buildDashboardData(filteredRows);
  const dateRangeLabel = buildDateRangeLabel(allRows);

  return (
    <div className="min-h-screen bg-slate-50 px-6 py-8 md:px-10 text-slate-900">
      <div className="mx-auto max-w-[1536px]">
        <header className="mb-8 flex flex-wrap items-start justify-between gap-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">
              Health Sales Performance
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              Overview of sales volume, agent commissions, and EPS performance.
            </p>
          </div>
          <div className="flex h-10 items-center justify-between rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-600 shadow-sm transition-shadow hover:shadow-md">
            <span>{dateRangeLabel}</span>
          </div>
        </header>

        <HealthSalesPerformanceFilters
          filters={filters}
          options={filterOptions}
        />

        {filteredRows.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white px-8 py-16 text-center text-sm font-medium text-slate-500 shadow-sm">
            No Health sales performance records match these filters.
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
              />
              <KpiCard
                label="Total EPS Comm"
                value={formatCurrencyCompact(data.overview.epsCommission)}
              />
              <KpiCard
                accent="red"
                label="Total EPS Split"
                value={formatCurrencyCompact(data.overview.epsSplit)}
              />
              <KpiCard
                accent="red"
                label="Total EPS Override"
                value={formatCurrencyCompact(data.overview.epsOverride)}
              />
              <KpiCard
                label="Agent Comm / Carrier Paid"
                value={formatPercent(
                  percentOf(data.overview.agentReceived, data.overview.totalMesserPaid)
                )}
              />
              <KpiCard
                label="EPS Comm / Carrier Paid"
                value={formatPercent(
                  percentOf(data.overview.epsCommission, data.overview.totalMesserPaid)
                )}
              />
              <KpiCard
                accent="red"
                label="EPS Split / Carrier Paid"
                value={formatPercent(
                  percentOf(data.overview.epsSplit, data.overview.totalMesserPaid)
                )}
              />
              <KpiCard
                accent="red"
                label="EPS Override / Carrier Paid"
                value={formatPercent(
                  percentOf(data.overview.epsOverride, data.overview.totalMesserPaid)
                )}
              />
            </section>

            <TrendComparisonChart rows={data.trendRows} />
            <SalesMomGrowthTable rows={data.salesMomRows} />
            <section className="grid gap-10 xl:grid-cols-2">
              <PaymentStatusTable
                rows={data.monthlyRows.slice(0, TABLE_MONTH_LIMIT)}
                title="Policy Payment Status by Month | Paid Rate"
                totalLabel="# Policies"
                paidLabel="Paid Policies"
                unpaidLabel="Unpaid Policies"
                rateLabel="% Paid Policies"
                totalValue={(row) => row.policyCount}
                paidValue={(row) => row.paidPolicyCount}
                unpaidValue={(row) => row.unpaidPolicyCount}
              />
              <PaymentStatusTable
                rows={data.monthlyRows.slice(0, TABLE_MONTH_LIMIT)}
                title="Client Payment Status by Month | Paid Rate"
                totalLabel="# Clients"
                paidLabel="Paid Clients"
                unpaidLabel="Unpaid Clients"
                rateLabel="% Paid Client"
                totalValue={(row) => row.clientCount}
                paidValue={(row) => row.paidClientCount}
                unpaidValue={(row) => row.unpaidClientCount}
              />
            </section>
            <CommissionBreakdownTable rows={data.monthlyRows.slice(0, TABLE_MONTH_LIMIT)} />
            <QuarterMetricCharts rows={data.quarterRows} />
            <AllTimeAgentPerformanceTable rows={data.agentRows} />
            <MonthlyAgentPerformanceTable groups={data.monthlyAgentGroups} />
            <AgentMomPivotTable
              monthKeys={data.agentMomMonthKeys}
              rows={data.agentMomPivotRows}
            />
            <CarrierPerformanceTable rows={data.carrierRows} />
            <MonthlyCarrierPerformanceTable groups={data.monthlyCarrierGroups} />
            <StatePerformanceTable rows={data.stateRows} />
            <PoliciesInformationTable
              rows={data.policyInfoRows.slice(0, POLICY_INFO_LIMIT)}
              totalCount={data.policyInfoRows.length}
            />
          </div>
        )}
      </div>
    </div>
  );
}

async function fetchHealthSalesRows() {
  const supabase = getSupabaseAdmin();
  const rows: HealthSalesRow[] = [];

  for (let from = 0; ; from += HEALTH_SALES_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("health_mart")
      .select(
        [
          "deal_name",
          "state",
          "carrier",
          "plan_name",
          "primary_member_id",
          "agent",
          "broker_effective_date",
          "paid_to_date",
          "report_month",
          "carriers_messer_paid",
          "agent_received",
          "eps_override",
          "eps_override_received",
          "eps_split",
          "messer_statement",
          "num_client",
        ].join(",")
      )
      .order("report_month", { ascending: false })
      .range(from, from + HEALTH_SALES_PAGE_SIZE - 1);

    if (error) throw new Error(error.message);

    rows.push(...(((data ?? []) as unknown) as HealthSalesRow[]));

    if (!data || data.length < HEALTH_SALES_PAGE_SIZE) {
      return rows;
    }
  }
}

function buildDashboardData(rows: HealthSalesRow[]): DashboardData {
  const overview = summarizeRows(rows);
  const monthlyRows = buildMonthlySummaries(rows);
  const trendRows = monthlyRows
    .filter((row) => row.policyCount > TREND_MIN_POLICY_COUNT)
    .slice(0, TREND_MONTH_LIMIT);

  return {
    overview,
    monthlyRows,
    trendRows,
    salesMomRows: buildSalesMomRows(monthlyRows),
    quarterRows: buildQuarterSummaries(rows),
    agentRows: buildAgentRows(rows, overview).slice(0, AGENT_ROW_LIMIT),
    monthlyAgentGroups: buildMonthlyAgentGroups(rows),
    ...buildAgentMomPivot(rows),
    carrierRows: buildCarrierRows(rows).slice(0, CARRIER_ROW_LIMIT),
    monthlyCarrierGroups: buildMonthlyCarrierGroups(rows),
    stateRows: buildStateRows(rows, overview).slice(0, STATE_ROW_LIMIT),
    policyInfoRows: buildPolicyInfoRows(rows),
  };
}

function summarizeRows(rows: HealthSalesRow[]): Summary {
  const policies = new Map<string, { paid: boolean; clients: number }>();
  let totalMesserPaid = 0;
  let agentReceived = 0;
  let epsOverride = 0;
  let epsSplit = 0;

  rows.forEach((row, index) => {
    totalMesserPaid += moneyValue(row.carriers_messer_paid);
    agentReceived += moneyValue(row.agent_received);
    epsOverride += getEpsOverride(row);
    epsSplit += moneyValue(row.eps_split);

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

function buildSalesMomRows(monthlyRows: MonthlySummary[]): SalesMomRow[] {
  const chronological = [...monthlyRows].reverse();
  const rows = chronological.map<SalesMomRow>((row, index) => {
    const previous = chronological[index - 1] ?? null;
    const policyChange = previous ? row.policyCount - previous.policyCount : null;
    const clientChange = previous ? row.clientCount - previous.clientCount : null;
    const messerPaidChange = previous
      ? row.totalMesserPaid - previous.totalMesserPaid
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
    };
  });

  return rows.reverse().slice(0, TABLE_MONTH_LIMIT);
}

function buildQuarterSummaries(rows: HealthSalesRow[]) {
  return [...groupRows(rows, (row) => getQuarterKey(row.report_month)).entries()]
    .filter(([periodKey]) => Boolean(periodKey))
    .map(([periodKey, groupRows]) => ({
      periodKey,
      periodLabel: formatQuarterLabel(periodKey),
      ...summarizeRows(groupRows),
    }))
    .sort((a, b) => a.periodKey.localeCompare(b.periodKey))
    .slice(-QUARTER_LIMIT);
}

function buildAgentRows(rows: HealthSalesRow[], overview: Summary) {
  const grouped = groupRows(rows, (row) => cleanGroupLabel(row.agent));

  return [...grouped.entries()]
    .map(([agent, groupRows]) => {
      const summary = summarizeRows(groupRows);

      return {
        agent,
        ...summary,
        policySharePercent: percentOf(summary.policyCount, overview.policyCount),
        clientSharePercent: percentOf(summary.clientCount, overview.clientCount),
      };
    })
    .sort(
      (a, b) =>
        b.policyCount - a.policyCount ||
        b.agentReceived - a.agentReceived ||
        a.agent.localeCompare(b.agent)
    );
}

function buildMonthlyAgentGroups(rows: HealthSalesRow[]): MonthlyAgentGroup[] {
  const monthGroups = [...groupRows(rows, (row) => getMonthKey(row.report_month)).entries()]
    .filter(([monthKey]) => Boolean(monthKey))
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, MONTHLY_AGENT_MONTH_LIMIT);

  return monthGroups.map(([monthKey, monthRows]) => {
    const totalSummary = summarizeRows(monthRows);
    const rows = buildAgentRows(monthRows, totalSummary).slice(
      0,
      MONTHLY_AGENT_ROW_LIMIT
    );

    return {
      monthKey,
      rows,
      total: {
        agent: "Total",
        ...totalSummary,
        policySharePercent: 100,
        clientSharePercent: 100,
      },
    };
  });
}

function buildAgentMomPivot(rows: HealthSalesRow[]) {
  const monthKeys = [...groupRows(rows, (row) => getMonthKey(row.report_month)).keys()]
    .filter(Boolean)
    .sort((a, b) => b.localeCompare(a))
    .slice(0, 2);
  const allMonthKeys = [...groupRows(rows, (row) => getMonthKey(row.report_month)).keys()]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  const previousByMonth = new Map<string, string | null>();

  allMonthKeys.forEach((monthKey, index) => {
    previousByMonth.set(monthKey, allMonthKeys[index - 1] ?? null);
  });

  const agentNames = [...groupRows(rows, (row) => cleanGroupLabel(row.agent)).keys()].sort(
    (a, b) => a.localeCompare(b)
  );
  const monthAgentSummary = new Map<string, Summary>();

  for (const monthKey of [...new Set([...monthKeys, ...previousByMonth.values()].filter(Boolean))]) {
    const monthRows = rows.filter(
      (row) => getMonthKey(row.report_month) === monthKey
    );
    const groups = groupRows(monthRows, (row) => cleanGroupLabel(row.agent));

    for (const agent of agentNames) {
      monthAgentSummary.set(
        `${monthKey}\u001f${agent}`,
        summarizeRows(groups.get(agent) ?? [])
      );
    }
  }

  const pivotRows = agentNames
    .map<AgentMonthPivotRow>((agent) => ({
      agent,
      months: monthKeys.map((monthKey) => {
        const current = monthAgentSummary.get(`${monthKey}\u001f${agent}`) ?? summarizeRows([]);
        const previousMonthKey = previousByMonth.get(monthKey) ?? null;
        const previous =
          previousMonthKey === null
            ? null
            : monthAgentSummary.get(`${previousMonthKey}\u001f${agent}`) ??
              summarizeRows([]);

        return {
          monthKey,
          policyCount: current.policyCount,
          policyChangePercent: calculateChangePercent(
            previous ? current.policyCount - previous.policyCount : null,
            previous?.policyCount ?? null
          ),
          agentReceived: current.agentReceived,
          agentReceivedChangePercent: calculateChangePercent(
            previous ? current.agentReceived - previous.agentReceived : null,
            previous?.agentReceived ?? null
          ),
        };
      }),
    }))
    .sort((a, b) => {
      const aPolicies = a.months[0]?.policyCount ?? 0;
      const bPolicies = b.months[0]?.policyCount ?? 0;

      return bPolicies - aPolicies || a.agent.localeCompare(b.agent);
    })
    .slice(0, AGENT_ROW_LIMIT);

  const totalRow: AgentMonthPivotRow = {
    agent: "Grand total",
    months: monthKeys.map((monthKey) => {
      const current = summarizeRows(
        rows.filter((row) => getMonthKey(row.report_month) === monthKey)
      );
      const previousMonthKey = previousByMonth.get(monthKey) ?? null;
      const previous =
        previousMonthKey === null
          ? null
          : summarizeRows(
              rows.filter((row) => getMonthKey(row.report_month) === previousMonthKey)
            );

      return {
        monthKey,
        policyCount: current.policyCount,
        policyChangePercent: calculateChangePercent(
          previous ? current.policyCount - previous.policyCount : null,
          previous?.policyCount ?? null
        ),
        agentReceived: current.agentReceived,
        agentReceivedChangePercent: calculateChangePercent(
          previous ? current.agentReceived - previous.agentReceived : null,
          previous?.agentReceived ?? null
        ),
      };
    }),
  };

  return {
    agentMomMonthKeys: monthKeys,
    agentMomPivotRows: [...pivotRows, totalRow],
  };
}

function buildCarrierRows(rows: HealthSalesRow[]): CarrierPerformanceRow[] {
  return [...groupRows(rows, (row) => cleanGroupLabel(row.carrier)).entries()]
    .map(([carrier, groupRows]) => {
      const summary = summarizeRows(groupRows);

      return {
        carrier,
        ...summary,
        paidPolicyPercent: percentOf(summary.paidPolicyCount, summary.policyCount),
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

function buildMonthlyCarrierGroups(rows: HealthSalesRow[]): MonthlyCarrierGroup[] {
  const monthGroups = [...groupRows(rows, (row) => getMonthKey(row.report_month)).entries()]
    .filter(([monthKey]) => Boolean(monthKey))
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, MONTHLY_CARRIER_MONTH_LIMIT);

  return monthGroups.map(([monthKey, monthRows]) => {
    const carrierGroups = [...groupRows(monthRows, (row) => cleanGroupLabel(row.carrier)).entries()]
      .sort((a, b) => summarizeRows(b[1]).policyCount - summarizeRows(a[1]).policyCount);
    const monthlyRows: MonthlyCarrierRow[] = [];

    for (const [carrier, carrierRows] of carrierGroups) {
      const statementRows = [...groupRows(carrierRows, (row) => cleanGroupLabel(row.messer_statement)).entries()]
        .map(([statement, statementGroupRows]) => ({
          carrier,
          statement,
          isTotal: false,
          ...summarizeRows(statementGroupRows),
        }))
        .sort((a, b) => b.policyCount - a.policyCount || a.statement.localeCompare(b.statement));

      monthlyRows.push(...statementRows);
      monthlyRows.push({
        carrier,
        statement: "Total",
        isTotal: true,
        ...summarizeRows(carrierRows),
      });

      if (monthlyRows.length >= MONTHLY_CARRIER_ROW_LIMIT) break;
    }

    return {
      monthKey,
      rows: monthlyRows.slice(0, MONTHLY_CARRIER_ROW_LIMIT),
    };
  });
}

function buildStateRows(rows: HealthSalesRow[], overview: Summary): StatePerformanceRow[] {
  return [...groupRows(rows, (row) => cleanGroupLabel(row.state)).entries()]
    .map(([state, groupRows]) => {
      const summary = summarizeRows(groupRows);

      return {
        state,
        ...summary,
        policySharePercent: percentOf(summary.policyCount, overview.policyCount),
        clientSharePercent: percentOf(summary.clientCount, overview.clientCount),
      };
    })
    .sort(
      (a, b) =>
        b.policyCount - a.policyCount ||
        b.totalMesserPaid - a.totalMesserPaid ||
        a.state.localeCompare(b.state)
    );
}

function buildPolicyInfoRows(rows: HealthSalesRow[]): PolicyInfoRow[] {
  return [...rows]
    .sort((a, b) => {
      const monthCompare = (b.report_month ?? "").localeCompare(a.report_month ?? "");
      if (monthCompare !== 0) return monthCompare;

      return cleanGroupLabel(a.agent).localeCompare(cleanGroupLabel(b.agent));
    })
    .map((row) => ({
      month: getMonthKey(row.report_month),
      agent: cleanGroupLabel(row.agent),
      dealName: cleanText(row.deal_name),
      primaryMemberId: cleanText(row.primary_member_id),
      carrier: cleanGroupLabel(row.carrier),
      messerPaid: row.carriers_messer_paid,
      effectiveDate: row.broker_effective_date,
    }));
}

function KpiCard({
  accent = "dark",
  label,
  value,
}: {
  accent?: "dark" | "red";
  label: string;
  value: string;
}) {
  const isRed = accent === "red";

  return (
    <article className="flex flex-col justify-center min-h-[128px] rounded-xl border border-slate-200/60 bg-white p-6 shadow-sm transition-shadow duration-300 hover:shadow-md">
      <div
        className={`text-sm font-medium uppercase tracking-wide ${
          isRed ? "text-rose-500" : "text-slate-500"
        }`}
      >
        {label}
      </div>
      <div
        className={`mt-2 text-3xl font-bold ${
          isRed ? "text-rose-600" : "text-slate-900"
        }`}
      >
        {value}
      </div>
    </article>
  );
}

function TrendComparisonChart({ rows }: { rows: MonthlySummary[] }) {
  const width = 1280;
  const height = 410;
  const left = 76;
  const right = 78;
  const top = 70;
  const bottom = 58;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const maxMoney = roundAxisMax(maxValue(rows, (row) => row.totalMesserPaid));
  const maxCount = roundAxisMax(maxValue(rows, (row) => Math.max(row.policyCount, row.clientCount)));
  const groupWidth = plotWidth / Math.max(rows.length, 1);
  const barWidth = Math.min(54, Math.max(26, groupWidth * 0.52));
  const points = rows.map((row, index) => {
    const centerX = left + index * groupWidth + groupWidth / 2;
    const moneyHeight = (row.totalMesserPaid / maxMoney) * plotHeight;
    const policyY = top + plotHeight - (row.policyCount / maxCount) * plotHeight;
    const clientY = top + plotHeight - (row.clientCount / maxCount) * plotHeight;

    return {
      ...row,
      centerX,
      moneyHeight,
      moneyY: top + plotHeight - moneyHeight,
      policyY,
      clientY,
    };
  });

  return (
    <ReportPanel title="Revenue vs Agent Earnings by Month | Trend Comparison">
      {rows.length === 0 ? (
        <EmptyPanel>No monthly trend data with more than 100 policies.</EmptyPanel>
      ) : (
        <div className="overflow-x-auto">
          <svg
            className="min-w-[1120px]"
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label="Revenue, policies, and clients by month"
          >
            <g transform="translate(78, 22)">
              <rect width="34" height="14" fill="#d6d6d6" />
              <text x="44" y="13" className="fill-[#40444b] text-[15px] font-semibold">
                Total Messer Paid
              </text>
              <line x1="210" x2="244" y1="8" y2="8" stroke="#4186f5" strokeWidth="3" />
              <circle cx="227" cy="8" r="5" fill="#4186f5" />
              <text x="254" y="13" className="fill-[#40444b] text-[15px] font-semibold">
                # Policies
              </text>
              <line x1="372" x2="406" y1="8" y2="8" stroke="#ff453f" strokeWidth="3" />
              <circle cx="389" cy="8" r="5" fill="#ff453f" />
              <text x="416" y="13" className="fill-[#40444b] text-[15px] font-semibold">
                # Clients
              </text>
            </g>

            {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
              const y = top + plotHeight - tick * plotHeight;

              return (
                <g key={tick}>
                  <line
                    x1={left}
                    x2={width - right}
                    y1={y}
                    y2={y}
                    stroke="#d6d6d6"
                    strokeWidth="1"
                  />
                  <text x={left - 14} y={y + 5} textAnchor="end" className="fill-[#4a4f58] text-[13px]">
                    {formatAxisNumber(maxMoney * tick)}
                  </text>
                  <text x={width - right + 14} y={y + 5} className="fill-[#4a4f58] text-[13px]">
                    {formatAxisNumber(maxCount * tick)}
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
              Total Messer Paid
            </text>
            <text
              x={width - 22}
              y={top + plotHeight / 2}
              textAnchor="middle"
              transform={`rotate(-90 ${width - 22} ${top + plotHeight / 2})`}
              className="fill-[#4d545f] text-[13px] font-semibold"
            >
              # Policies | # Clients
            </text>

            {points.map((point) => (
              <g key={point.monthKey}>
                <rect
                  x={point.centerX - barWidth / 2}
                  y={point.moneyY}
                  width={barWidth}
                  height={Math.max(point.moneyHeight, 2)}
                  fill="#d6d6d6"
                />
                <text
                  x={point.centerX}
                  y={Math.max(point.moneyY - 14, top + 14)}
                  textAnchor="middle"
                  className="fill-[#20242b] text-[15px] font-bold"
                >
                  {formatCurrencyShort(point.totalMesserPaid)}
                </text>
                <text
                  x={point.centerX}
                  y={top + plotHeight + 30}
                  textAnchor="middle"
                  className="fill-[#3e444d] text-[13px] font-semibold"
                >
                  {point.monthKey}
                </text>
              </g>
            ))}

            <path
              d={points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.centerX} ${point.policyY}`).join(" ")}
              fill="none"
              stroke="#4186f5"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="3"
            />
            <path
              d={points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.centerX} ${point.clientY}`).join(" ")}
              fill="none"
              stroke="#ff453f"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="3"
            />

            {points.map((point) => (
              <g key={`${point.monthKey}-points`}>
                <circle cx={point.centerX} cy={point.policyY} r="5" fill="#4186f5" />
                <text
                  x={point.centerX}
                  y={point.policyY + 24}
                  textAnchor="middle"
                  className="fill-[#4186f5] text-[15px] font-bold"
                >
                  {formatInteger(point.policyCount)}
                </text>
                <circle cx={point.centerX} cy={point.clientY} r="5" fill="#ff453f" />
                <text
                  x={point.centerX}
                  y={point.clientY - 14}
                  textAnchor="middle"
                  className="fill-[#ff453f] text-[15px] font-bold"
                >
                  {formatInteger(point.clientCount)}
                </text>
              </g>
            ))}
          </svg>
        </div>
      )}
    </ReportPanel>
  );
}

function SalesMomGrowthTable({ rows }: { rows: SalesMomRow[] }) {
  const totals = rows.reduce(
    (total, row) => ({
      policyChange: total.policyChange + (row.policyChange ?? 0),
      clientChange: total.clientChange + (row.clientChange ?? 0),
      messerPaidChange: total.messerPaidChange + (row.messerPaidChange ?? 0),
    }),
    { policyChange: 0, clientChange: 0, messerPaidChange: 0 }
  );

  return (
    <ReportPanel title="Sales Performance by Month | Policies & Earnings MoM Growth">
      <div className="overflow-auto">
        <table className="min-w-[1180px] w-full table-fixed text-[12px]">
          <thead>
            <tr className="bg-[#f0f4fb] text-left font-bold text-[#333840]">
              <HeaderCell width="13%">report_month_label</HeaderCell>
              <HeaderCell align="right" width="14%"># Policies MoM Changed</HeaderCell>
              <HeaderCell align="right" width="16%">% Policies MoM Changed</HeaderCell>
              <HeaderCell align="right" width="14%"># Clients MoM Changed</HeaderCell>
              <HeaderCell align="right" width="16%">% Clients MoM Changed</HeaderCell>
              <HeaderCell align="right" width="15%">Total Messer Paid MoM Changed</HeaderCell>
              <HeaderCell align="right" width="12%">% Messer Paid MoM Changed</HeaderCell>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.monthKey} className={index % 2 === 0 ? "bg-white" : "bg-[#f7f8fa]"}>
                <BodyCell>{row.monthKey}</BodyCell>
                <BodyCell align="right">{formatNullableInteger(row.policyChange)}</BodyCell>
                <HeatBodyCell value={row.policyChangePercent}>
                  {formatNullablePercent(row.policyChangePercent)}
                </HeatBodyCell>
                <BodyCell align="right">{formatNullableInteger(row.clientChange)}</BodyCell>
                <HeatBodyCell value={row.clientChangePercent}>
                  {formatNullablePercent(row.clientChangePercent)}
                </HeatBodyCell>
                <BodyCell align="right">{formatNullableCurrency(row.messerPaidChange)}</BodyCell>
                <HeatBodyCell value={row.messerPaidChangePercent}>
                  {formatNullablePercent(row.messerPaidChangePercent)}
                </HeatBodyCell>
              </tr>
            ))}
            <tr className="border-t border-[#a9a9a9] bg-white font-bold">
              <BodyCell>Grand total</BodyCell>
              <BodyCell align="right">{formatInteger(totals.policyChange)}</BodyCell>
              <BodyCell align="right">{formatPercent(percentOf(totals.policyChange, rows.at(-1)?.policyCount ?? 0))}</BodyCell>
              <BodyCell align="right">{formatInteger(totals.clientChange)}</BodyCell>
              <BodyCell align="right">{formatPercent(percentOf(totals.clientChange, rows.at(-1)?.clientCount ?? 0))}</BodyCell>
              <BodyCell align="right">{formatCurrency(totals.messerPaidChange)}</BodyCell>
              <BodyCell align="right">{formatPercent(percentOf(totals.messerPaidChange, rows.at(-1)?.totalMesserPaid ?? 0))}</BodyCell>
            </tr>
          </tbody>
        </table>
      </div>
    </ReportPanel>
  );
}

function PaymentStatusTable({
  rows,
  title,
  totalLabel,
  paidLabel,
  unpaidLabel,
  rateLabel,
  totalValue,
  paidValue,
  unpaidValue,
}: {
  rows: MonthlySummary[];
  title: string;
  totalLabel: string;
  paidLabel: string;
  unpaidLabel: string;
  rateLabel: string;
  totalValue: (row: MonthlySummary) => number;
  paidValue: (row: MonthlySummary) => number;
  unpaidValue: (row: MonthlySummary) => number;
}) {
  return (
    <ReportPanel title={title}>
      <div className="max-h-[480px] overflow-auto">
        <table className="w-full min-w-[560px] table-fixed text-[12px]">
          <thead>
            <tr className="bg-white text-left font-semibold">
              <HeaderCell width="21%">Month</HeaderCell>
              <HeaderCell align="right" width="19%">{totalLabel}</HeaderCell>
              <HeaderCell align="right" width="19%">{paidLabel}</HeaderCell>
              <HeaderCell align="right" width="19%">{unpaidLabel}</HeaderCell>
              <HeaderCell align="right" width="22%">{rateLabel}</HeaderCell>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const total = totalValue(row);
              const paid = paidValue(row);
              const rate = percentOf(paid, total);

              return (
                <tr key={row.monthKey} className={index % 2 === 0 ? "bg-white" : "bg-[#f6f7f9]"}>
                  <BodyCell>{row.monthKey}</BodyCell>
                  <BodyCell align="right">{formatInteger(total)}</BodyCell>
                  <BodyCell align="right">{formatInteger(paid)}</BodyCell>
                  <BodyCell align="right">{formatInteger(unpaidValue(row))}</BodyCell>
                  <HeatBodyCell mode="green" value={rate}>
                    {formatPercent(rate)}
                  </HeatBodyCell>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </ReportPanel>
  );
}

function CommissionBreakdownTable({ rows }: { rows: MonthlySummary[] }) {
  return (
    <ReportPanel title="Commission Breakdown by Month | Revenue Distribution & Yield">
      <div className="overflow-auto">
        <table className="min-w-[1260px] w-full table-fixed text-[12px]">
          <thead>
            <tr className="bg-[#edf3fb] text-left font-bold">
              <HeaderCell width="10%">Month</HeaderCell>
              <HeaderCell align="right" width="11%">Messer Paid</HeaderCell>
              <HeaderCell align="right" width="12%">Agent Comm</HeaderCell>
              <HeaderCell align="right" width="12%">% Agent Comm</HeaderCell>
              <HeaderCell align="right" width="12%">EPS Commission</HeaderCell>
              <HeaderCell align="right" width="11%">% EPS Commission</HeaderCell>
              <HeaderCell align="right" width="11%">EPS Override</HeaderCell>
              <HeaderCell align="right" width="10%">% EPS Override</HeaderCell>
              <HeaderCell align="right" width="10%">EPS Split</HeaderCell>
              <HeaderCell align="right" width="9%">% EPS Split</HeaderCell>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.monthKey} className={index % 2 === 0 ? "bg-white" : "bg-[#f7f8fa]"}>
                <BodyCell>{row.monthKey}</BodyCell>
                <BodyCell align="right">{formatCurrencyShort(row.totalMesserPaid)}</BodyCell>
                <HeatBodyCell mode="blue" value={row.agentReceived} maxValue={maxValue(rows, (item) => item.agentReceived)}>
                  {formatCurrency(row.agentReceived)}
                </HeatBodyCell>
                <HeatBodyCell mode="blue" value={percentOf(row.agentReceived, row.totalMesserPaid)}>
                  {formatPercent(percentOf(row.agentReceived, row.totalMesserPaid))}
                </HeatBodyCell>
                <HeatBodyCell mode="lavender" value={row.epsCommission} maxValue={maxValue(rows, (item) => item.epsCommission)}>
                  {formatCurrency(row.epsCommission)}
                </HeatBodyCell>
                <HeatBodyCell mode="lavender" value={percentOf(row.epsCommission, row.totalMesserPaid)}>
                  {formatPercent(percentOf(row.epsCommission, row.totalMesserPaid))}
                </HeatBodyCell>
                <HeatBodyCell mode="pink" value={row.epsOverride} maxValue={maxValue(rows, (item) => item.epsOverride)}>
                  {formatCurrency(row.epsOverride)}
                </HeatBodyCell>
                <HeatBodyCell mode="pink" value={percentOf(row.epsOverride, row.totalMesserPaid)}>
                  {formatPercent(percentOf(row.epsOverride, row.totalMesserPaid))}
                </HeatBodyCell>
                <HeatBodyCell mode="magenta" value={row.epsSplit} maxValue={maxValue(rows, (item) => item.epsSplit)}>
                  {formatCurrency(row.epsSplit)}
                </HeatBodyCell>
                <HeatBodyCell mode="magenta" value={percentOf(row.epsSplit, row.totalMesserPaid)}>
                  {formatPercent(percentOf(row.epsSplit, row.totalMesserPaid))}
                </HeatBodyCell>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ReportPanel>
  );
}

function QuarterMetricCharts({ rows }: { rows: QuarterSummary[] }) {
  return (
    <section className="grid gap-10 xl:grid-cols-2">
      <QuarterMetricChart
        barLabel="Agent Received"
        percentLabel="% Agent Commission"
        rows={rows}
        title="Agent Commission by Quarter | Commission Rate Trend"
        value={(row) => row.agentReceived}
        percent={(row) => percentOf(row.agentReceived, row.totalMesserPaid)}
      />
      <QuarterMetricChart
        barLabel="EPS Commission"
        percentLabel="% EPS Commission"
        rows={rows}
        title="EPS Commission by Quarter | Commission Rate Trend"
        value={(row) => row.epsCommission}
        percent={(row) => percentOf(row.epsCommission, row.totalMesserPaid)}
      />
      <QuarterMetricChart
        barLabel="EPS Override"
        percentLabel="% EPS Override"
        redTitle
        rows={rows}
        title="EPS Override by Quarter | Commission Rate Trend"
        value={(row) => row.epsOverride}
        percent={(row) => percentOf(row.epsOverride, row.totalMesserPaid)}
      />
      <QuarterMetricChart
        barLabel="EPS Split"
        percentLabel="% EPS Split"
        redTitle
        rows={rows}
        title="EPS Split by Quarter | Commission Rate Trend"
        value={(row) => row.epsSplit}
        percent={(row) => percentOf(row.epsSplit, row.totalMesserPaid)}
      />
    </section>
  );
}

function QuarterMetricChart({
  barLabel,
  percentLabel,
  redTitle = false,
  rows,
  title,
  value,
  percent,
}: {
  barLabel: string;
  percentLabel: string;
  redTitle?: boolean;
  rows: QuarterSummary[];
  title: string;
  value: (row: QuarterSummary) => number;
  percent: (row: QuarterSummary) => number;
}) {
  const width = 620;
  const height = 360;
  const left = 74;
  const right = 72;
  const top = 54;
  const bottom = 58;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const maxAmount = roundAxisMax(maxValue(rows, value));
  const maxPercent = Math.max(100, roundAxisMax(maxValue(rows, percent)));
  const groupWidth = plotWidth / Math.max(rows.length, 1);
  const barWidth = Math.min(64, groupWidth * 0.52);
  const points = rows.map((row, index) => {
    const centerX = left + index * groupWidth + groupWidth / 2;
    const amount = value(row);
    const rate = percent(row);
    const barHeight = (amount / maxAmount) * plotHeight;

    return {
      row,
      centerX,
      amount,
      rate,
      barHeight,
      barY: top + plotHeight - barHeight,
      lineY: top + plotHeight - (rate / maxPercent) * plotHeight,
    };
  });

  return (
    <ReportPanel title={title} titleClassName={redTitle ? "text-[#ff3f38]" : ""}>
      {rows.length === 0 ? (
        <EmptyPanel>No quarterly data.</EmptyPanel>
      ) : (
        <div className="overflow-x-auto">
          <svg className="min-w-[560px]" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
            <g transform="translate(78, 18)">
              <rect width="30" height="12" fill="#d6d6d6" />
              <text x="40" y="12" className="fill-[#4a4f58] text-[13px] font-semibold">
                {barLabel}
              </text>
              <line x1="210" x2="242" y1="7" y2="7" stroke="#d82f2f" strokeWidth="2" />
              <circle cx="226" cy="7" r="4" fill="#d82f2f" />
              <text x="252" y="12" className="fill-[#4a4f58] text-[13px] font-semibold">
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
                  x={point.centerX - barWidth / 2}
                  y={point.barY}
                  width={barWidth}
                  height={Math.max(point.barHeight, 2)}
                  fill="#d6d6d6"
                />
                <text
                  x={point.centerX}
                  y={Math.max(point.barY + 22, top + 18)}
                  textAnchor="middle"
                  className="fill-[#4a4f58] text-[12px] font-bold"
                >
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
              stroke="#d82f2f"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
            />
            {points.map((point) => (
              <g key={`${point.row.periodKey}-rate`}>
                <circle cx={point.centerX} cy={point.lineY} r="4" fill="#d82f2f" />
                <text x={point.centerX} y={point.lineY - 12} textAnchor="middle" className="fill-[#d82f2f] text-[12px] font-bold">
                  {formatPercent(point.rate)}
                </text>
              </g>
            ))}
          </svg>
        </div>
      )}
    </ReportPanel>
  );
}

function AllTimeAgentPerformanceTable({ rows }: { rows: AgentPerformanceRow[] }) {
  const maxes = {
    policyCount: maxValue(rows, (row) => row.policyCount),
    clientCount: maxValue(rows, (row) => row.clientCount),
    totalMesserPaid: maxValue(rows, (row) => row.totalMesserPaid),
    agentReceived: maxValue(rows, (row) => row.agentReceived),
    epsOverride: maxValue(rows, (row) => row.epsOverride),
    epsSplit: maxValue(rows, (row) => row.epsSplit),
  };

  return (
    <ReportPanel title="All Time Agent Performance | Policies, Clients & Revenue Contribution">
      <div className="overflow-auto">
        <table className="min-w-[1260px] w-full table-fixed text-[12px]">
          <thead>
            <tr className="bg-[#f0f4fb] text-left font-bold">
              <HeaderCell width="18%">Agent</HeaderCell>
              <HeaderCell align="right" width="10%"># Policies</HeaderCell>
              <HeaderCell align="right" width="11%">% Policies</HeaderCell>
              <HeaderCell align="right" width="10%"># Clients</HeaderCell>
              <HeaderCell align="right" width="15%">Messer Paid</HeaderCell>
              <HeaderCell align="right" width="14%">Agent Received</HeaderCell>
              <HeaderCell align="right" width="11%">EPS Override</HeaderCell>
              <HeaderCell align="right" width="11%">EPS Split</HeaderCell>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.agent} className={index % 2 === 0 ? "bg-white" : "bg-[#f7f8fa]"}>
                <BodyCell strong>{row.agent}</BodyCell>
                <BarBodyCell color="blue" maxValue={maxes.policyCount} value={row.policyCount}>{formatInteger(row.policyCount)}</BarBodyCell>
                <BarBodyCell color="orange" maxValue={100} value={row.policySharePercent}>{formatPercent(row.policySharePercent)}</BarBodyCell>
                <BarBodyCell color="red" maxValue={maxes.clientCount} value={row.clientCount}>{formatInteger(row.clientCount)}</BarBodyCell>
                <BarBodyCell color="purple" maxValue={maxes.totalMesserPaid} value={row.totalMesserPaid}>{formatCurrency(row.totalMesserPaid)}</BarBodyCell>
                <BarBodyCell color="cyan" maxValue={maxes.agentReceived} value={row.agentReceived}>{formatCurrency(row.agentReceived)}</BarBodyCell>
                <BarBodyCell color="yellow" maxValue={maxes.epsOverride} value={row.epsOverride}>{formatCurrency(row.epsOverride)}</BarBodyCell>
                <BarBodyCell color="magenta" maxValue={maxes.epsSplit} value={row.epsSplit}>{formatCurrency(row.epsSplit)}</BarBodyCell>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ReportPanel>
  );
}

function MonthlyAgentPerformanceTable({ groups }: { groups: MonthlyAgentGroup[] }) {
  return (
    <ReportPanel title="Monthly Agent Performance | Policies & Revenue Breakdown">
      <div className="max-h-[720px] overflow-auto">
        <table className="min-w-[1180px] w-full table-fixed text-[12px]">
          <thead>
            <tr className="bg-[#edf3fb] text-left font-bold">
              <HeaderCell width="10%">Month</HeaderCell>
              <HeaderCell width="16%">Agent</HeaderCell>
              <HeaderCell align="right" width="10%"># Policies</HeaderCell>
              <HeaderCell align="right" width="12%"># Paid Policies</HeaderCell>
              <HeaderCell align="right" width="12%"># Unpaid Policies</HeaderCell>
              <HeaderCell align="right" width="10%"># Clients</HeaderCell>
              <HeaderCell align="right" width="15%">Total Messer Paid</HeaderCell>
              <HeaderCell align="right" width="15%">Total Agent Received</HeaderCell>
            </tr>
          </thead>
          <tbody>
            {groups.flatMap((group) => {
              const rows = [...group.rows, group.total];
              const maxPolicies = maxValue(rows, (row) => row.policyCount);
              const maxPaid = maxValue(rows, (row) => row.paidPolicyCount);
              const maxUnpaid = maxValue(rows, (row) => row.unpaidPolicyCount);
              const maxClients = maxValue(rows, (row) => row.clientCount);
              const maxMesser = maxValue(rows, (row) => row.totalMesserPaid);
              const maxAgent = maxValue(rows, (row) => row.agentReceived);

              return rows.map((row, index) => (
                <tr
                  key={`${group.monthKey}-${row.agent}-${index}`}
                  className={`${row.agent === "Total" ? "bg-white font-bold" : index % 2 === 0 ? "bg-white" : "bg-[#f7f8fa]"}`}
                >
                  <BodyCell>{index === 0 ? formatMonthDate(group.monthKey) : ""}</BodyCell>
                  <BodyCell strong={row.agent === "Total"}>{row.agent}</BodyCell>
                  <BarBodyCell color="blue" maxValue={maxPolicies} value={row.policyCount}>{formatInteger(row.policyCount)}</BarBodyCell>
                  <BarBodyCell color="orange" maxValue={maxPaid} value={row.paidPolicyCount}>{formatInteger(row.paidPolicyCount)}</BarBodyCell>
                  <BarBodyCell color="red" maxValue={maxUnpaid} value={row.unpaidPolicyCount}>{formatInteger(row.unpaidPolicyCount)}</BarBodyCell>
                  <BarBodyCell color="purple" maxValue={maxClients} value={row.clientCount}>{formatInteger(row.clientCount)}</BarBodyCell>
                  <BarBodyCell color="cyan" maxValue={maxMesser} value={row.totalMesserPaid}>{formatCurrency(row.totalMesserPaid)}</BarBodyCell>
                  <BarBodyCell color="yellow" maxValue={maxAgent} value={row.agentReceived}>{formatCurrency(row.agentReceived)}</BarBodyCell>
                </tr>
              ));
            })}
          </tbody>
        </table>
      </div>
    </ReportPanel>
  );
}

function AgentMomPivotTable({
  monthKeys,
  rows,
}: {
  monthKeys: string[];
  rows: AgentMonthPivotRow[];
}) {
  return (
    <ReportPanel title="Agent Performance by Month | Policies & Earnings MoM Growth">
      <div className="overflow-auto">
        <table className="min-w-[1280px] w-full table-fixed text-[12px]">
          <thead>
            <tr className="bg-[#edf3fb] text-center font-bold">
              <HeaderCell width="15%">Report Month / Policies Count / % Policies MoM / Agent Received / % Agent Received MoM</HeaderCell>
              {monthKeys.map((monthKey) => (
                <HeaderCell key={monthKey} align="center" colSpan={4}>
                  {monthKey}
                </HeaderCell>
              ))}
            </tr>
            <tr className="bg-white text-left font-semibold">
              <HeaderCell>Agent</HeaderCell>
              {monthKeys.flatMap((monthKey) => [
                <HeaderCell key={`${monthKey}-policy`} align="right">Policies Count</HeaderCell>,
                <HeaderCell key={`${monthKey}-policy-mom`} align="right">% Policies MoM</HeaderCell>,
                <HeaderCell key={`${monthKey}-agent`} align="right">Agent Received</HeaderCell>,
                <HeaderCell key={`${monthKey}-agent-mom`} align="right">% Agent Received MoM</HeaderCell>,
              ])}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.agent} className={`${row.agent === "Grand total" ? "bg-white font-bold" : index % 2 === 0 ? "bg-white" : "bg-[#f7f8fa]"}`}>
                <BodyCell strong={row.agent === "Grand total"}>{row.agent}</BodyCell>
                {row.months.map((month) => (
                  <Fragment key={`${row.agent}-${month.monthKey}`}>
                    <BodyCell align="right">{formatInteger(month.policyCount)}</BodyCell>
                    <HeatBodyCell value={month.policyChangePercent}>
                      {formatNullablePercent(month.policyChangePercent)}
                    </HeatBodyCell>
                    <BodyCell align="right">{formatCurrency(month.agentReceived)}</BodyCell>
                    <HeatBodyCell value={month.agentReceivedChangePercent}>
                      {formatNullablePercent(month.agentReceivedChangePercent)}
                    </HeatBodyCell>
                  </Fragment>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ReportPanel>
  );
}

function CarrierPerformanceTable({ rows }: { rows: CarrierPerformanceRow[] }) {
  return (
    <ReportPanel title="Carrier Performance | Policies, Revenue & Commission Breakdown">
      <div className="max-h-[620px] overflow-auto">
        <table className="min-w-[1240px] w-full table-fixed text-[12px]">
          <thead>
            <tr className="bg-[#edf3fb] text-left font-bold">
              <HeaderCell width="12%">carrier</HeaderCell>
              <HeaderCell align="right" width="10%"># Policies</HeaderCell>
              <HeaderCell align="right" width="11%">% Paid Policies</HeaderCell>
              <HeaderCell align="right" width="13%">Messer Paid</HeaderCell>
              <HeaderCell align="right" width="12%">EPS Override</HeaderCell>
              <HeaderCell align="right" width="12%">% EPS Override</HeaderCell>
              <HeaderCell align="right" width="10%">EPS Split</HeaderCell>
              <HeaderCell align="right" width="10%">% EPS Split</HeaderCell>
              <HeaderCell align="right" width="10%">EPS Comm</HeaderCell>
              <HeaderCell align="right" width="10%">% EPS Comm</HeaderCell>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.carrier} className={index % 2 === 0 ? "bg-white" : "bg-[#f7f8fa]"}>
                <BodyCell strong>{row.carrier}</BodyCell>
                <BodyCell align="right">{formatInteger(row.policyCount)}</BodyCell>
                <HeatBodyCell mode="green" value={row.paidPolicyPercent}>{formatPercent(row.paidPolicyPercent)}</HeatBodyCell>
                <BodyCell align="right">{formatCurrency(row.totalMesserPaid)}</BodyCell>
                <BodyCell align="right">{formatCurrency(row.epsOverride)}</BodyCell>
                <HeatBodyCell mode="green" value={row.epsOverridePercent}>{formatPercent(row.epsOverridePercent)}</HeatBodyCell>
                <BodyCell align="right">{formatCurrency(row.epsSplit)}</BodyCell>
                <HeatBodyCell mode="green" value={row.epsSplitPercent}>{formatPercent(row.epsSplitPercent)}</HeatBodyCell>
                <BodyCell align="right">{formatCurrency(row.epsCommission)}</BodyCell>
                <HeatBodyCell mode="green" value={row.epsCommissionPercent}>{formatPercent(row.epsCommissionPercent)}</HeatBodyCell>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ReportPanel>
  );
}

function MonthlyCarrierPerformanceTable({ groups }: { groups: MonthlyCarrierGroup[] }) {
  return (
    <ReportPanel title="Monthly Carrier Performance | Policies, Revenue & Commission Breakdown">
      <div className="max-h-[720px] overflow-auto">
        <table className="min-w-[1160px] w-full table-fixed text-[12px]">
          <thead>
            <tr className="bg-[#edf3fb] text-left font-bold">
              <HeaderCell width="12%">Month</HeaderCell>
              <HeaderCell width="14%">Carrier</HeaderCell>
              <HeaderCell width="18%">Statement</HeaderCell>
              <HeaderCell align="right" width="11%"># Policies</HeaderCell>
              <HeaderCell align="right" width="12%">% Paid Policies</HeaderCell>
              <HeaderCell align="right" width="12%">Messer Paid</HeaderCell>
              <HeaderCell align="right" width="11%">EPS Override</HeaderCell>
              <HeaderCell align="right" width="10%">EPS Split</HeaderCell>
              <HeaderCell align="right" width="10%">EPS Comm</HeaderCell>
            </tr>
          </thead>
          <tbody>
            {groups.flatMap((group) =>
              group.rows.map((row, index) => (
                <tr key={`${group.monthKey}-${row.carrier}-${row.statement}-${index}`} className={`${row.isTotal ? "bg-white font-bold" : index % 2 === 0 ? "bg-white" : "bg-[#f7f8fa]"}`}>
                  <BodyCell>{index === 0 ? formatMonthDate(group.monthKey) : ""}</BodyCell>
                  <BodyCell strong={row.isTotal}>{row.carrier}</BodyCell>
                  <BodyCell strong={row.isTotal}>{row.statement}</BodyCell>
                  <HeatBodyCell mode="blue" value={row.policyCount} maxValue={maxValue(group.rows, (item) => item.policyCount)}>
                    {formatInteger(row.policyCount)}
                  </HeatBodyCell>
                  <HeatBodyCell mode="green" value={percentOf(row.paidPolicyCount, row.policyCount)}>
                    {formatPercent(percentOf(row.paidPolicyCount, row.policyCount))}
                  </HeatBodyCell>
                  <BodyCell align="right">{formatCurrency(row.totalMesserPaid)}</BodyCell>
                  <BodyCell align="right">{formatCurrency(row.epsOverride)}</BodyCell>
                  <BodyCell align="right">{formatCurrency(row.epsSplit)}</BodyCell>
                  <BodyCell align="right">{formatCurrency(row.epsCommission)}</BodyCell>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </ReportPanel>
  );
}

function StatePerformanceTable({ rows }: { rows: StatePerformanceRow[] }) {
  const maxes = {
    policyCount: maxValue(rows, (row) => row.policyCount),
    clientCount: maxValue(rows, (row) => row.clientCount),
    totalMesserPaid: maxValue(rows, (row) => row.totalMesserPaid),
    epsOverride: maxValue(rows, (row) => row.epsOverride),
  };

  return (
    <ReportPanel title="State Performance | Policies, Revenue & Commission Breakdown">
      <div className="max-h-[620px] overflow-auto">
        <table className="min-w-[1120px] w-full table-fixed text-[12px]">
          <thead>
            <tr className="bg-[#edf3fb] text-left font-bold">
              <HeaderCell width="12%">state</HeaderCell>
              <HeaderCell align="right" width="12%"># Policies</HeaderCell>
              <HeaderCell align="right" width="12%">% Policies</HeaderCell>
              <HeaderCell align="right" width="14%">Clients Count</HeaderCell>
              <HeaderCell align="right" width="12%">% Client</HeaderCell>
              <HeaderCell align="right" width="19%">Total Messer Paid</HeaderCell>
              <HeaderCell align="right" width="19%">Total EPS Override</HeaderCell>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.state} className={index % 2 === 0 ? "bg-white" : "bg-[#f7f8fa]"}>
                <BodyCell strong>{row.state}</BodyCell>
                <BarBodyCell color="blue" maxValue={maxes.policyCount} value={row.policyCount}>{formatInteger(row.policyCount)}</BarBodyCell>
                <BarBodyCell color="orange" maxValue={100} value={row.policySharePercent}>{formatPercent(row.policySharePercent)}</BarBodyCell>
                <BarBodyCell color="red" maxValue={maxes.clientCount} value={row.clientCount}>{formatInteger(row.clientCount)}</BarBodyCell>
                <BarBodyCell color="purple" maxValue={100} value={row.clientSharePercent}>{formatPercent(row.clientSharePercent)}</BarBodyCell>
                <BarBodyCell color="cyan" maxValue={maxes.totalMesserPaid} value={row.totalMesserPaid}>{formatCurrency(row.totalMesserPaid)}</BarBodyCell>
                <BarBodyCell color="yellow" maxValue={maxes.epsOverride} value={row.epsOverride}>{formatCurrency(row.epsOverride)}</BarBodyCell>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ReportPanel>
  );
}

function PoliciesInformationTable({
  rows,
  totalCount,
}: {
  rows: PolicyInfoRow[];
  totalCount: number;
}) {
  return (
    <ReportPanel title="Policies Information">
      <div className="overflow-auto">
        <table className="min-w-[1180px] w-full table-fixed text-[12px]">
          <thead>
            <tr className="bg-[#edf3fb] text-left font-bold">
              <HeaderCell width="12%">Month</HeaderCell>
              <HeaderCell width="15%">Agent</HeaderCell>
              <HeaderCell width="32%">Deal Name</HeaderCell>
              <HeaderCell width="15%">Primary Member ID</HeaderCell>
              <HeaderCell width="10%">Carrier</HeaderCell>
              <HeaderCell align="right" width="8%">Messer Paid</HeaderCell>
              <HeaderCell width="8%">Effective date</HeaderCell>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${row.primaryMemberId}-${row.dealName}-${index}`} className={index % 2 === 0 ? "bg-white" : "bg-[#f7f8fa]"}>
                <BodyCell>{formatMonthDate(row.month)}</BodyCell>
                <BodyCell strong>{row.agent}</BodyCell>
                <BodyCell>{row.dealName}</BodyCell>
                <BodyCell>{row.primaryMemberId}</BodyCell>
                <BodyCell>{row.carrier}</BodyCell>
                <BodyCell align="right">{row.messerPaid == null ? "null" : formatCurrency(row.messerPaid)}</BodyCell>
                <BodyCell>{row.effectiveDate ? formatShortDate(row.effectiveDate) : "null"}</BodyCell>
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

function HeaderCell({
  align = "left",
  children,
  colSpan,
  width,
}: {
  align?: "left" | "right" | "center";
  children: ReactNode;
  colSpan?: number;
  width?: string;
}) {
  return (
    <th
      className={`bg-slate-50/80 backdrop-blur-sm border-b border-slate-200 px-4 py-3 align-middle text-xs font-semibold uppercase tracking-wider text-slate-500 ${
        align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left"
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
  children: ReactNode;
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

function HeatBodyCell({
  children,
  maxValue = 100,
  mode = "delta",
  value,
}: {
  children: ReactNode;
  maxValue?: number;
  mode?: "delta" | "green" | "blue" | "lavender" | "pink" | "magenta";
  value: number | null;
}) {
  return (
    <td
      className="border-b border-slate-100 px-4 py-3 align-middle text-sm text-slate-700 text-right transition-colors group-hover:bg-slate-50/50"
      style={{ backgroundColor: heatColor(value, maxValue, mode) }}
    >
      {children}
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
  color: "blue" | "orange" | "red" | "purple" | "cyan" | "yellow" | "magenta";
  maxValue: number;
  value: number;
}) {
  const width = maxValue === 0 ? 0 : Math.min(Math.abs(value / maxValue) * 100, 100);

  return (
    <td className="border-b border-slate-100 px-4 py-3 align-middle text-right transition-colors group-hover:bg-slate-50/50">
      <div className="ml-auto flex w-full items-center justify-end">
        <div className="relative h-6 w-full overflow-hidden rounded border bg-slate-50 border-slate-200">
          <div
            className={`h-full rounded opacity-70 ${barColorClassName(color)}`}
            style={{ width: `${width}%` }}
          />
          <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-slate-800">
            {children}
          </span>
        </div>
      </div>
    </td>
  );
}

function EmptyPanel({ children }: { children: ReactNode }) {
  return <div className="px-6 py-12 text-center text-sm font-medium text-slate-500">{children}</div>;
}

function buildFilterOptions(rows: HealthSalesRow[]): FilterOptions {
  return {
    agents: uniqueSorted(rows.map((row) => cleanGroupLabel(row.agent)).filter((value) => value !== "null")),
    carriers: uniqueSorted(rows.map((row) => cleanGroupLabel(row.carrier)).filter((value) => value !== "null")),
    reportMonths: uniqueSorted(
      rows.map((row) => getMonthKey(row.report_month)).filter(Boolean)
    ).reverse(),
    messerStatements: uniqueSorted(
      rows.map((row) => cleanGroupLabel(row.messer_statement)).filter((value) => value !== "null")
    ),
  };
}

function applyFilters(rows: HealthSalesRow[], filters: FilterValues) {
  const primaryMemberId = filters.primaryMemberId.trim().toUpperCase();

  return rows.filter((row) => {
    if (filters.agent && cleanGroupLabel(row.agent) !== filters.agent) return false;
    if (filters.carrier && cleanGroupLabel(row.carrier) !== filters.carrier) return false;
    if (filters.reportMonth && getMonthKey(row.report_month) !== filters.reportMonth) return false;
    if (
      filters.messerStatement &&
      cleanGroupLabel(row.messer_statement) !== filters.messerStatement
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

function parseFilters(params: Record<string, string | string[] | undefined>): FilterValues {
  return {
    agent: parseStringParam(params.agent),
    carrier: parseStringParam(params.carrier),
    reportMonth: parseMonthParam(params.reportMonth),
    messerStatement: parseStringParam(params.messerStatement),
    primaryMemberId: parseStringParam(params.primaryMemberId),
  };
}

function parseStringParam(value: string | string[] | undefined) {
  const rawValue = Array.isArray(value) ? value[0] : value;

  return rawValue?.trim() ?? "";
}

function parseMonthParam(value: string | string[] | undefined) {
  const rawValue = parseStringParam(value);

  return /^\d{4}-\d{2}$/.test(rawValue) ? rawValue : "";
}

function buildDateRangeLabel(rows: HealthSalesRow[]) {
  const monthKeys = rows.map((row) => getMonthKey(row.report_month)).filter(Boolean).sort();
  const firstMonth = monthKeys[0];

  if (!firstMonth) return "No report dates";

  return `${formatFullDate(`${firstMonth}-01`)} - ${formatFullDate(new Date())}`;
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
  return value?.slice(0, 7) ?? "";
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

function barColorClassName(color: "blue" | "orange" | "red" | "purple" | "cyan" | "yellow" | "magenta") {
  if (color === "blue") return "bg-[#2f80ed]";
  if (color === "orange") return "bg-[#ff9e4a]";
  if (color === "red") return "bg-[#ff3f38]";
  if (color === "purple") return "bg-[#a56be8]";
  if (color === "cyan") return "bg-[#25b8c9]";
  if (color === "yellow") return "bg-[#e5bf30]";

  return "bg-[#df5aa7]";
}

function formatInteger(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatNullableInteger(value: number | null) {
  return value === null ? "-" : formatInteger(value);
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2,
    minimumFractionDigits: 0,
    style: "currency",
  }).format(value);
}

function formatNullableCurrency(value: number | null) {
  return value === null ? "-" : formatCurrency(value);
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

function formatAxisMoney(value: number) {
  if (value >= 1000) return `${formatInteger(value / 1000)}K`;

  return formatInteger(value);
}

function formatAxisNumber(value: number) {
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

function formatMonthDate(monthKey: string) {
  if (!monthKey) return "";

  return formatShortDate(`${monthKey}-01`);
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
