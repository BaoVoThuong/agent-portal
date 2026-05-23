import { Fragment, type ReactNode } from "react";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { requirePermission } from "@/lib/rbac/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  HealthSalesHeaderFilters,
  HealthSalesPerformanceFilters,
} from "./HealthSalesPerformanceFilters";
import {
  HealthSalesTrendComparisonChart,
  type TrendComparisonPeriod,
  type TrendComparisonPeriodsByLevel,
} from "./HealthSalesTrendComparisonChart";

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
  agent: string[];
  carrier: string[];
  reportMonthRange: ReportMonthRange;
  messerStatement: string[];
  primaryMemberId: string;
};

type ReportMonthRange = {
  start: string | null;
  end: string | null;
};

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
  trendPeriodsByLevel: TrendComparisonPeriodsByLevel;
  salesMomRows: SalesMomRow[];
  quarterRows: QuarterSummary[];
  agentRows: AgentPerformanceRow[];
  monthlyAgentGroups: MonthlyAgentGroup[];
  agentMomPivotRows: AgentMonthPivotRow[];
  agentMomMonthKeys: string[];
  carrierRows: CarrierPerformanceRow[];
  stateRows: StatePerformanceRow[];
  policyInfoRows: PolicyInfoRow[];
};

const HEALTH_SALES_PAGE_SIZE = 1000;
const TREND_MONTH_LIMIT = 12;
const TREND_QUARTER_LIMIT = 8;
const TREND_YEAR_LIMIT = 5;
const TREND_MIN_POLICY_COUNT = 100;
const TABLE_MONTH_LIMIT = 14;
const QUARTER_LIMIT = 6;
const AGENT_ROW_LIMIT = 16;
const MONTHLY_AGENT_MONTH_LIMIT = 3;
const MONTHLY_AGENT_ROW_LIMIT = 12;
const CARRIER_ROW_LIMIT = 28;
const STATE_TOP_LIMIT = 5;
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
          <HealthSalesHeaderFilters filters={filters} />
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

            <HealthSalesTrendComparisonChart
              periodsByLevel={data.trendPeriodsByLevel}
            />
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

  return {
    overview,
    monthlyRows,
    trendPeriodsByLevel: buildTrendPeriodsByLevel(rows, monthlyRows),
    salesMomRows: buildSalesMomRows(monthlyRows),
    quarterRows: buildQuarterSummaries(rows),
    agentRows: buildAgentRows(rows, overview).slice(0, AGENT_ROW_LIMIT),
    monthlyAgentGroups: buildMonthlyAgentGroups(rows),
    ...buildAgentMomPivot(rows),
    carrierRows: buildCarrierRows(rows).slice(0, CARRIER_ROW_LIMIT),
    stateRows: buildStateRows(rows, overview),
    policyInfoRows: buildPolicyInfoRows(rows),
  };
}

function summarizeRows(rows: HealthSalesRow[]): Summary {
  const policies = new Map<string, { paid: boolean; clients: number }>();
  const activeAgents = new Set<string>();
  let totalMesserPaid = 0;
  let agentReceived = 0;
  let epsOverride = 0;
  let epsSplit = 0;

  rows.forEach((row, index) => {
    totalMesserPaid += moneyValue(row.carriers_messer_paid);
    agentReceived += moneyValue(row.agent_received);
    epsOverride += getEpsOverride(row);
    epsSplit += moneyValue(row.eps_split);

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
      .filter((row) => row.policyCount > TREND_MIN_POLICY_COUNT)
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
    .filter((period) => period.policyCount > TREND_MIN_POLICY_COUNT)
    .sort((a, b) => b.periodKey.localeCompare(a.periodKey))
    .slice(0, limit)
    .reverse();
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

function buildStateRows(rows: HealthSalesRow[], overview: Summary): StatePerformanceRow[] {
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
    toStatePerformanceRow(state, summary, overview)
  );

  if (otherRows.length > 0) {
    stateRows.push(toStatePerformanceRow("Other", summarizeRows(otherRows), overview));
  }

  return stateRows;
}

function toStatePerformanceRow(
  state: string,
  summary: Summary,
  overview: Summary
): StatePerformanceRow {
  return {
    state,
    ...summary,
    policySharePercent: percentOf(summary.policyCount, overview.policyCount),
    clientSharePercent: percentOf(summary.clientCount, overview.clientCount),
  };
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
    <article className="flex min-h-[124px] flex-col rounded-xl border border-slate-200/70 bg-white px-5 py-4 text-center shadow-[0_6px_18px_rgba(15,23,42,0.06)] transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgba(15,23,42,0.1)]">
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
    </article>
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
      <div className="max-h-[300px] overflow-y-auto">
        <table className="w-full table-fixed text-[11px]">
          <thead>
            <tr className="bg-[#f0f4fb] text-left font-bold text-[#333840]">
              <CompactHeaderCell width="12%">Report Month</CompactHeaderCell>
              <CompactHeaderCell align="right" width="13%"># Policies MoM</CompactHeaderCell>
              <CompactHeaderCell align="right" width="14%">% Policies MoM</CompactHeaderCell>
              <CompactHeaderCell align="right" width="13%"># Clients MoM</CompactHeaderCell>
              <CompactHeaderCell align="right" width="14%">% Clients MoM</CompactHeaderCell>
              <CompactHeaderCell align="right" width="18%">Messer Paid MoM</CompactHeaderCell>
              <CompactHeaderCell align="right" width="16%">% Messer Paid MoM</CompactHeaderCell>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.monthKey} className={index % 2 === 0 ? "bg-white" : "bg-[#f7f8fa]"}>
                <CompactBodyCell>{row.monthKey}</CompactBodyCell>
                <CompactBodyCell align="right">{formatNullableInteger(row.policyChange)}</CompactBodyCell>
                <CompactHeatCell value={row.policyChangePercent}>
                  {formatNullablePercent(row.policyChangePercent)}
                </CompactHeatCell>
                <CompactBodyCell align="right">{formatNullableInteger(row.clientChange)}</CompactBodyCell>
                <CompactHeatCell value={row.clientChangePercent}>
                  {formatNullablePercent(row.clientChangePercent)}
                </CompactHeatCell>
                <CompactBodyCell align="right">{formatNullableCurrency(row.messerPaidChange)}</CompactBodyCell>
                <CompactHeatCell value={row.messerPaidChangePercent}>
                  {formatNullablePercent(row.messerPaidChangePercent)}
                </CompactHeatCell>
              </tr>
            ))}
            <tr className="border-t border-[#a9a9a9] bg-white font-bold">
              <CompactBodyCell>Grand total</CompactBodyCell>
              <CompactBodyCell align="right">{formatInteger(totals.policyChange)}</CompactBodyCell>
              <CompactBodyCell align="right">{formatPercent(percentOf(totals.policyChange, rows.at(-1)?.policyCount ?? 0))}</CompactBodyCell>
              <CompactBodyCell align="right">{formatInteger(totals.clientChange)}</CompactBodyCell>
              <CompactBodyCell align="right">{formatPercent(percentOf(totals.clientChange, rows.at(-1)?.clientCount ?? 0))}</CompactBodyCell>
              <CompactBodyCell align="right">{formatCurrency(totals.messerPaidChange)}</CompactBodyCell>
              <CompactBodyCell align="right">{formatPercent(percentOf(totals.messerPaidChange, rows.at(-1)?.totalMesserPaid ?? 0))}</CompactBodyCell>
            </tr>
          </tbody>
        </table>
      </div>
    </ReportPanel>
  );
}

function CompactHeaderCell({
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
      className={`border-b border-slate-200 bg-slate-50/80 px-2 py-3 align-middle text-[11px] font-semibold uppercase leading-snug tracking-[0.04em] text-slate-500 ${
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
  children,
}: {
  align?: "left" | "right";
  children: ReactNode;
}) {
  return (
    <td
      className={`border-b border-slate-100 px-2 py-3 align-middle text-sm text-slate-700 tabular-nums transition-colors group-hover:bg-slate-50/50 ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {children}
    </td>
  );
}

function CompactHeatCell({
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
      className="border-b border-slate-100 px-2 py-3 align-middle text-right text-sm tabular-nums text-slate-700 transition-colors group-hover:bg-slate-50/50"
      style={{ backgroundColor: heatColor(value, maxValue, mode) }}
    >
      {children}
    </td>
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
      <div className="max-h-[300px] overflow-y-auto">
        <table className="w-full table-fixed text-[11px]">
          <thead>
            <tr className="bg-white text-left font-semibold">
              <CompactHeaderCell width="20%">Month</CompactHeaderCell>
              <CompactHeaderCell align="right" width="18%">{totalLabel}</CompactHeaderCell>
              <CompactHeaderCell align="right" width="18%">{paidLabel}</CompactHeaderCell>
              <CompactHeaderCell align="right" width="18%">{unpaidLabel}</CompactHeaderCell>
              <CompactHeaderCell align="right" width="26%">{rateLabel}</CompactHeaderCell>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const total = totalValue(row);
              const paid = paidValue(row);
              const rate = percentOf(paid, total);

              return (
                <tr key={row.monthKey} className={index % 2 === 0 ? "bg-white" : "bg-[#f6f7f9]"}>
                  <CompactBodyCell>{row.monthKey}</CompactBodyCell>
                  <CompactBodyCell align="right">{formatInteger(total)}</CompactBodyCell>
                  <CompactBodyCell align="right">{formatInteger(paid)}</CompactBodyCell>
                  <CompactBodyCell align="right">{formatInteger(unpaidValue(row))}</CompactBodyCell>
                  <CompactHeatCell mode="green" value={rate}>
                    {formatPercent(rate)}
                  </CompactHeatCell>
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
      <div className="max-h-[300px] overflow-y-auto">
        <table className="w-full table-fixed text-[11px]">
          <thead>
            <tr className="bg-[#edf3fb] text-left font-bold">
              <CompactHeaderCell width="8%">Month</CompactHeaderCell>
              <CompactHeaderCell align="right" width="10%">Messer Paid</CompactHeaderCell>
              <CompactHeaderCell align="right" width="11%">Agent Comm</CompactHeaderCell>
              <CompactHeaderCell align="right" width="10%">% Agent</CompactHeaderCell>
              <CompactHeaderCell align="right" width="11%">EPS Comm</CompactHeaderCell>
              <CompactHeaderCell align="right" width="10%">% EPS Comm</CompactHeaderCell>
              <CompactHeaderCell align="right" width="11%">EPS Override</CompactHeaderCell>
              <CompactHeaderCell align="right" width="10%">% EPS Override</CompactHeaderCell>
              <CompactHeaderCell align="right" width="10%">EPS Split</CompactHeaderCell>
              <CompactHeaderCell align="right" width="9%">% EPS Split</CompactHeaderCell>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.monthKey} className={index % 2 === 0 ? "bg-white" : "bg-[#f7f8fa]"}>
                <CompactBodyCell>{row.monthKey}</CompactBodyCell>
                <CompactBodyCell align="right">{formatCurrencyShort(row.totalMesserPaid)}</CompactBodyCell>
                <CompactHeatCell mode="blue" value={row.agentReceived} maxValue={maxValue(rows, (item) => item.agentReceived)}>
                  {formatCurrency(row.agentReceived)}
                </CompactHeatCell>
                <CompactHeatCell mode="blue" value={percentOf(row.agentReceived, row.totalMesserPaid)}>
                  {formatPercent(percentOf(row.agentReceived, row.totalMesserPaid))}
                </CompactHeatCell>
                <CompactHeatCell mode="lavender" value={row.epsCommission} maxValue={maxValue(rows, (item) => item.epsCommission)}>
                  {formatCurrency(row.epsCommission)}
                </CompactHeatCell>
                <CompactHeatCell mode="lavender" value={percentOf(row.epsCommission, row.totalMesserPaid)}>
                  {formatPercent(percentOf(row.epsCommission, row.totalMesserPaid))}
                </CompactHeatCell>
                <CompactHeatCell mode="pink" value={row.epsOverride} maxValue={maxValue(rows, (item) => item.epsOverride)}>
                  {formatCurrency(row.epsOverride)}
                </CompactHeatCell>
                <CompactHeatCell mode="pink" value={percentOf(row.epsOverride, row.totalMesserPaid)}>
                  {formatPercent(percentOf(row.epsOverride, row.totalMesserPaid))}
                </CompactHeatCell>
                <CompactHeatCell mode="magenta" value={row.epsSplit} maxValue={maxValue(rows, (item) => item.epsSplit)}>
                  {formatCurrency(row.epsSplit)}
                </CompactHeatCell>
                <CompactHeatCell mode="magenta" value={percentOf(row.epsSplit, row.totalMesserPaid)}>
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
  const width = 660;
  const height = 380;
  const left = 74;
  const right = 100;
  const top = 62;
  const bottom = 62;
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
    const barY = top + plotHeight - barHeight;
    const lineY = top + plotHeight - (rate / maxPercent) * plotHeight;
    const labelYs = resolveQuarterMetricLabelYs({
      barHeight,
      barY,
      lineY,
      plotBottom: top + plotHeight,
      plotTop: top,
    });

    return {
      row,
      centerX,
      amount,
      rate,
      barHeight,
      barLabelY: labelYs.bar,
      barY,
      lineLabelY: labelYs.line,
      lineY,
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
                  <text x={width - 12} y={y + 4} textAnchor="end" className="fill-[#4a4f58] text-[12px]">
                    {formatAxisPercent(maxPercent * tick)}
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
                  y={point.barLabelY}
                  textAnchor="middle"
                  className="fill-[#4a4f58] text-[11px] font-bold"
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
                <text x={point.centerX} y={point.lineLabelY} textAnchor="middle" className="fill-[#d82f2f] text-[11px] font-bold">
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

function resolveQuarterMetricLabelYs({
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
  const minY = plotTop + 16;
  const maxY = plotBottom - 8;
  let bar = clamp(barHeight >= 52 ? barY + 38 : barY - 10, minY, maxY);
  let line = chooseSeparatedLabelY(
    [lineY - 16, lineY + 22, lineY - 32, lineY + 36],
    bar,
    minY,
    maxY
  );

  if (Math.abs(bar - line) < 18) {
    bar = chooseSeparatedLabelY(
      barHeight >= 52
        ? [barY + 52, barY + 28, barY - 12]
        : [barY - 24, barY + 18, barY - 10],
      line,
      minY,
      maxY
    );
  }

  if (Math.abs(bar - line) < 18) {
    line = clamp(lineY - 38, minY, maxY);
  }

  return { bar, line };
}

function chooseSeparatedLabelY(
  candidates: number[],
  avoidY: number,
  minY: number,
  maxY: number
) {
  return candidates
    .map((candidate) => clamp(candidate, minY, maxY))
    .sort((a, b) => Math.abs(b - avoidY) - Math.abs(a - avoidY))[0];
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function AllTimeAgentPerformanceTable({ rows }: { rows: AgentPerformanceRow[] }) {
  const maxes = {
    policyCount: maxValue(rows, (row) => row.policyCount),
    policySharePercent: maxValue(rows, (row) => row.policySharePercent),
    clientCount: maxValue(rows, (row) => row.clientCount),
    totalMesserPaid: maxValue(rows, (row) => row.totalMesserPaid),
    agentReceived: maxValue(rows, (row) => row.agentReceived),
    epsOverride: maxValue(rows, (row) => row.epsOverride),
    epsSplit: maxValue(rows, (row) => row.epsSplit),
  };

  return (
    <ReportPanel title="All Time Agent Performance | Policies, Clients & Revenue Contribution">
      <div className="max-h-[300px] overflow-y-auto">
        <table className="w-full table-fixed text-[12px]">
          <thead>
            <tr className="bg-[#f0f4fb] text-left font-bold text-slate-600">
              <CompactHeaderCell width="17%">Agent</CompactHeaderCell>
              <CompactHeaderCell align="right" width="8%">Policies</CompactHeaderCell>
              <CompactHeaderCell align="right" width="9%">Policy %</CompactHeaderCell>
              <CompactHeaderCell align="right" width="9%">Clients</CompactHeaderCell>
              <CompactHeaderCell align="right" width="14%">Messer Paid</CompactHeaderCell>
              <CompactHeaderCell align="right" width="14%">Agent Rec.</CompactHeaderCell>
              <CompactHeaderCell align="right" width="14%">EPS Over.</CompactHeaderCell>
              <CompactHeaderCell align="right" width="15%">EPS Split</CompactHeaderCell>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.agent} className={`group ${index % 2 === 0 ? "bg-white" : "bg-[#f7f8fa]"}`}>
                <td className="border-b border-slate-100 px-3 py-3 align-middle font-semibold text-slate-900 transition-colors group-hover:bg-slate-50/70">
                  <span className="block truncate" title={row.agent}>
                    {row.agent}
                  </span>
                </td>
                <CompactHeatCell mode="blue" value={row.policyCount} maxValue={maxes.policyCount}>
                  {formatInteger(row.policyCount)}
                </CompactHeatCell>
                <CompactHeatCell mode="blue" value={row.policySharePercent} maxValue={maxes.policySharePercent}>
                  {formatPercent(row.policySharePercent)}
                </CompactHeatCell>
                <CompactHeatCell mode="green" value={row.clientCount} maxValue={maxes.clientCount}>
                  {formatInteger(row.clientCount)}
                </CompactHeatCell>
                <CompactHeatCell mode="lavender" value={row.totalMesserPaid} maxValue={maxes.totalMesserPaid}>
                  {formatCurrencyShort(row.totalMesserPaid)}
                </CompactHeatCell>
                <CompactHeatCell mode="blue" value={row.agentReceived} maxValue={maxes.agentReceived}>
                  {formatCurrencyShort(row.agentReceived)}
                </CompactHeatCell>
                <CompactHeatCell mode="pink" value={row.epsOverride} maxValue={maxes.epsOverride}>
                  {formatCurrencyShort(row.epsOverride)}
                </CompactHeatCell>
                <CompactHeatCell mode="magenta" value={row.epsSplit} maxValue={maxes.epsSplit}>
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

function MonthlyAgentPerformanceTable({ groups }: { groups: MonthlyAgentGroup[] }) {
  return (
    <ReportPanel title="Monthly Agent Performance | Policies & Revenue Breakdown">
      <div className="max-h-[300px] overflow-y-auto overflow-x-hidden">
        <table className="w-full table-fixed text-[12px]">
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#edf3fb] text-left font-bold">
              <CompactHeaderCell width="10%">Month</CompactHeaderCell>
              <CompactHeaderCell width="17%">Agent</CompactHeaderCell>
              <CompactHeaderCell align="right" width="10%">Policies</CompactHeaderCell>
              <CompactHeaderCell align="right" width="11%">Paid</CompactHeaderCell>
              <CompactHeaderCell align="right" width="11%">Unpaid</CompactHeaderCell>
              <CompactHeaderCell align="right" width="10%">Clients</CompactHeaderCell>
              <CompactHeaderCell align="right" width="15%">Messer Paid</CompactHeaderCell>
              <CompactHeaderCell align="right" width="16%">Agent Rec.</CompactHeaderCell>
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
                  className={`group ${index === 0 ? "border-t border-slate-200" : ""} ${
                    row.agent === "Total" ? "bg-white font-bold" : index % 2 === 0 ? "bg-white" : "bg-[#f7f8fa]"
                  }`}
                >
                  <CompactBodyCell>{index === 0 ? formatMonthDate(group.monthKey) : ""}</CompactBodyCell>
                  <td className="border-b border-slate-100 px-2 py-3 align-middle text-sm text-slate-700 transition-colors group-hover:bg-slate-50/50">
                    <span className={`block truncate ${row.agent === "Total" ? "font-bold text-slate-900" : ""}`} title={row.agent}>
                      {row.agent}
                    </span>
                  </td>
                  <CompactHeatCell mode="blue" maxValue={maxPolicies} value={row.policyCount}>
                    {formatInteger(row.policyCount)}
                  </CompactHeatCell>
                  <CompactHeatCell mode="green" maxValue={maxPaid} value={row.paidPolicyCount}>
                    {formatInteger(row.paidPolicyCount)}
                  </CompactHeatCell>
                  <CompactHeatCell mode="pink" maxValue={maxUnpaid} value={row.unpaidPolicyCount}>
                    {formatInteger(row.unpaidPolicyCount)}
                  </CompactHeatCell>
                  <CompactHeatCell mode="lavender" maxValue={maxClients} value={row.clientCount}>
                    {formatInteger(row.clientCount)}
                  </CompactHeatCell>
                  <CompactHeatCell mode="blue" maxValue={maxMesser} value={row.totalMesserPaid}>
                    {formatCurrencyShort(row.totalMesserPaid)}
                  </CompactHeatCell>
                  <CompactHeatCell mode="magenta" maxValue={maxAgent} value={row.agentReceived}>
                    {formatCurrencyShort(row.agentReceived)}
                  </CompactHeatCell>
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
  const dataRows = rows.filter((row) => row.agent !== "Grand total");
  const monthMaxes = new Map(
    monthKeys.map((monthKey) => {
      const monthRows = dataRows
        .map((row) => row.months.find((month) => month.monthKey === monthKey))
        .filter((month): month is AgentMonthPivotRow["months"][number] => Boolean(month));

      return [
        monthKey,
        {
          agentReceived: maxValue(monthRows, (month) => month.agentReceived),
          policyCount: maxValue(monthRows, (month) => month.policyCount),
        },
      ];
    })
  );

  return (
    <ReportPanel title="Agent Performance by Month | Policies & Earnings MoM Growth">
      <div className="max-h-[300px] overflow-y-auto overflow-x-hidden">
        <table className="w-full table-fixed text-[12px]">
          <thead>
            <tr className="sticky top-0 z-20 bg-[#edf3fb] text-center font-bold">
              <th
                className="border-b border-slate-200 bg-[#edf3fb] px-3 py-3 text-left text-xs font-semibold uppercase tracking-[0.06em] text-slate-500"
                rowSpan={2}
                style={{ width: "16%" }}
              >
                Agent
              </th>
              {monthKeys.map((monthKey) => (
                <th
                  key={monthKey}
                  className="border-b border-l border-slate-200 bg-[#edf3fb] px-3 py-3 text-center text-sm font-bold text-slate-700"
                  colSpan={4}
                >
                  {monthKey}
                </th>
              ))}
            </tr>
            <tr className="sticky top-[42px] z-20 bg-white text-left font-semibold">
              {monthKeys.flatMap((monthKey) => [
                <PivotHeaderCell key={`${monthKey}-policy`} groupStart>
                  Policies
                </PivotHeaderCell>,
                <PivotHeaderCell key={`${monthKey}-policy-mom`}>
                  Policy MoM
                </PivotHeaderCell>,
                <PivotHeaderCell key={`${monthKey}-agent`}>
                  Agent Rec.
                </PivotHeaderCell>,
                <PivotHeaderCell key={`${monthKey}-agent-mom`}>
                  Agent MoM
                </PivotHeaderCell>,
              ])}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={row.agent}
                className={`group ${row.agent === "Grand total" ? "bg-white font-bold" : index % 2 === 0 ? "bg-white" : "bg-[#f7f8fa]"}`}
              >
                <td className="border-b border-slate-100 px-3 py-3 align-middle font-semibold text-slate-900 transition-colors group-hover:bg-slate-50/70">
                  <span className="block truncate" title={row.agent}>
                    {row.agent}
                  </span>
                </td>
                {row.months.map((month) => {
                  const maxes = monthMaxes.get(month.monthKey);

                  return (
                    <Fragment key={`${row.agent}-${month.monthKey}`}>
                      <PivotHeatCell
                        groupStart
                        maxValue={maxes?.policyCount ?? 1}
                        mode="blue"
                        value={month.policyCount}
                      >
                        {formatInteger(month.policyCount)}
                      </PivotHeatCell>
                      <PivotHeatCell value={month.policyChangePercent}>
                        {formatNullablePercent(month.policyChangePercent)}
                      </PivotHeatCell>
                      <PivotHeatCell
                        maxValue={maxes?.agentReceived ?? 1}
                        mode="lavender"
                        value={month.agentReceived}
                      >
                        {formatCurrencyShort(month.agentReceived)}
                      </PivotHeatCell>
                      <PivotHeatCell value={month.agentReceivedChangePercent}>
                        {formatNullablePercent(month.agentReceivedChangePercent)}
                      </PivotHeatCell>
                    </Fragment>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ReportPanel>
  );
}

function PivotHeaderCell({
  children,
  groupStart = false,
}: {
  children: ReactNode;
  groupStart?: boolean;
}) {
  return (
    <th
      className={`border-b border-slate-200 bg-white px-2 py-3 text-right text-[11px] font-semibold uppercase leading-snug tracking-[0.04em] text-slate-500 ${
        groupStart ? "border-l border-slate-200" : ""
      }`}
    >
      {children}
    </th>
  );
}

function PivotHeatCell({
  children,
  groupStart = false,
  maxValue = 100,
  mode = "delta",
  value,
}: {
  children: ReactNode;
  groupStart?: boolean;
  maxValue?: number;
  mode?: "delta" | "green" | "blue" | "lavender" | "pink" | "magenta";
  value: number | null;
}) {
  return (
    <td
      className={`border-b border-slate-100 px-2 py-3 align-middle text-right text-sm tabular-nums text-slate-700 transition-colors group-hover:bg-slate-50/50 ${
        groupStart ? "border-l border-slate-200" : ""
      }`}
      style={{ backgroundColor: heatColor(value, maxValue, mode) }}
    >
      {children}
    </td>
  );
}

function CarrierPerformanceTable({ rows }: { rows: CarrierPerformanceRow[] }) {
  const maxes = {
    epsCommission: maxValue(rows, (row) => row.epsCommission),
    epsOverride: maxValue(rows, (row) => row.epsOverride),
    epsSplit: maxValue(rows, (row) => row.epsSplit),
    policyCount: maxValue(rows, (row) => row.policyCount),
    totalMesserPaid: maxValue(rows, (row) => row.totalMesserPaid),
  };

  return (
    <ReportPanel title="Carrier Performance | Policies, Revenue & Commission Breakdown">
      <div className="max-h-[300px] overflow-y-auto overflow-x-hidden">
        <table className="w-full table-fixed text-[11px]">
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#edf3fb] text-left font-bold">
              <CompactHeaderCell width="12%">Carrier</CompactHeaderCell>
              <CompactHeaderCell align="right" width="8%">Policies</CompactHeaderCell>
              <CompactHeaderCell align="right" width="10%">Paid %</CompactHeaderCell>
              <CompactHeaderCell align="right" width="12%">Messer Paid</CompactHeaderCell>
              <CompactHeaderCell align="right" width="11%">EPS Over.</CompactHeaderCell>
              <CompactHeaderCell align="right" width="10%">Over. %</CompactHeaderCell>
              <CompactHeaderCell align="right" width="10%">EPS Split</CompactHeaderCell>
              <CompactHeaderCell align="right" width="9%">Split %</CompactHeaderCell>
              <CompactHeaderCell align="right" width="10%">EPS Comm</CompactHeaderCell>
              <CompactHeaderCell align="right" width="8%">Comm %</CompactHeaderCell>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.carrier} className={`group ${index % 2 === 0 ? "bg-white" : "bg-[#f7f8fa]"}`}>
                <td className="border-b border-slate-100 px-2 py-3 align-middle font-semibold text-slate-900 transition-colors group-hover:bg-slate-50/70">
                  <span className="block truncate" title={row.carrier}>
                    {row.carrier}
                  </span>
                </td>
                <CompactHeatCell mode="blue" maxValue={maxes.policyCount} value={row.policyCount}>
                  {formatInteger(row.policyCount)}
                </CompactHeatCell>
                <CompactHeatCell mode="green" value={row.paidPolicyPercent}>
                  {formatPercent(row.paidPolicyPercent)}
                </CompactHeatCell>
                <CompactHeatCell mode="lavender" maxValue={maxes.totalMesserPaid} value={row.totalMesserPaid}>
                  {formatCurrencyShort(row.totalMesserPaid)}
                </CompactHeatCell>
                <CompactHeatCell mode="pink" maxValue={maxes.epsOverride} value={row.epsOverride}>
                  {formatCurrencyShort(row.epsOverride)}
                </CompactHeatCell>
                <CompactHeatCell mode="pink" value={row.epsOverridePercent}>
                  {formatPercent(row.epsOverridePercent)}
                </CompactHeatCell>
                <CompactHeatCell mode="magenta" maxValue={maxes.epsSplit} value={row.epsSplit}>
                  {formatCurrencyShort(row.epsSplit)}
                </CompactHeatCell>
                <CompactHeatCell mode="magenta" value={row.epsSplitPercent}>
                  {formatPercent(row.epsSplitPercent)}
                </CompactHeatCell>
                <CompactHeatCell mode="blue" maxValue={maxes.epsCommission} value={row.epsCommission}>
                  {formatCurrencyShort(row.epsCommission)}
                </CompactHeatCell>
                <CompactHeatCell mode="blue" value={row.epsCommissionPercent}>
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

function StatePerformanceTable({ rows }: { rows: StatePerformanceRow[] }) {
  const maxes = {
    policyCount: maxValue(rows, (row) => row.policyCount),
    clientCount: maxValue(rows, (row) => row.clientCount),
    totalMesserPaid: maxValue(rows, (row) => row.totalMesserPaid),
    epsOverride: maxValue(rows, (row) => row.epsOverride),
  };

  return (
    <ReportPanel title="State Performance | Policies, Revenue & Commission Breakdown">
      <div className="max-h-[300px] overflow-y-auto">
        <table className="w-full table-fixed text-[12px]">
          <thead>
            <tr className="bg-[#edf3fb] text-left font-bold">
              <CompactHeaderCell width="12%">State</CompactHeaderCell>
              <CompactHeaderCell align="right" width="12%">Policies</CompactHeaderCell>
              <CompactHeaderCell align="right" width="12%">Policy %</CompactHeaderCell>
              <CompactHeaderCell align="right" width="14%">Clients</CompactHeaderCell>
              <CompactHeaderCell align="right" width="12%">Client %</CompactHeaderCell>
              <CompactHeaderCell align="right" width="19%">Messer Paid</CompactHeaderCell>
              <CompactHeaderCell align="right" width="19%">EPS Override</CompactHeaderCell>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.state} className={`group ${index % 2 === 0 ? "bg-white" : "bg-[#f7f8fa]"}`}>
                <td className="border-b border-slate-100 px-3 py-3 align-middle font-semibold text-slate-900 transition-colors group-hover:bg-slate-50/70">
                  {row.state}
                </td>
                <CompactHeatCell mode="blue" maxValue={maxes.policyCount} value={row.policyCount}>
                  {formatInteger(row.policyCount)}
                </CompactHeatCell>
                <CompactHeatCell mode="blue" value={row.policySharePercent}>
                  {formatPercent(row.policySharePercent)}
                </CompactHeatCell>
                <CompactHeatCell mode="pink" maxValue={maxes.clientCount} value={row.clientCount}>
                  {formatInteger(row.clientCount)}
                </CompactHeatCell>
                <CompactHeatCell mode="pink" value={row.clientSharePercent}>
                  {formatPercent(row.clientSharePercent)}
                </CompactHeatCell>
                <CompactHeatCell mode="lavender" maxValue={maxes.totalMesserPaid} value={row.totalMesserPaid}>
                  {formatCurrencyShort(row.totalMesserPaid)}
                </CompactHeatCell>
                <CompactHeatCell mode="magenta" maxValue={maxes.epsOverride} value={row.epsOverride}>
                  {formatCurrencyShort(row.epsOverride)}
                </CompactHeatCell>
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
      <div className="max-h-[300px] overflow-auto">
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

function EmptyPanel({ children }: { children: ReactNode }) {
  return <div className="px-6 py-12 text-center text-sm font-medium text-slate-500">{children}</div>;
}

function buildFilterOptions(rows: HealthSalesRow[]): FilterOptions {
  return {
    agents: uniqueSorted(rows.map((row) => cleanGroupLabel(row.agent)).filter((value) => value !== "null")),
    carriers: uniqueSorted(rows.map((row) => cleanGroupLabel(row.carrier)).filter((value) => value !== "null")),
  };
}

function applyFilters(rows: HealthSalesRow[], filters: FilterValues) {
  const primaryMemberId = filters.primaryMemberId.trim().toUpperCase();
  const startMonth = dateToMonthKey(filters.reportMonthRange.start);
  const endMonth = dateToMonthKey(filters.reportMonthRange.end);

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

    if (startMonth || endMonth) {
      const rowMonth = getMonthKey(row.report_month);

      if (!rowMonth) return false;
      if (startMonth && rowMonth.localeCompare(startMonth) < 0) return false;
      if (endMonth && rowMonth.localeCompare(endMonth) > 0) return false;
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

function parseFilters(params: Record<string, string | string[] | undefined>): FilterValues {
  return {
    agent: parseStringListParam(params.agent),
    carrier: parseStringListParam(params.carrier),
    reportMonthRange: parseReportMonthRange(params),
    messerStatement: parseStringListParam(params.messerStatement),
    primaryMemberId: parseStringParam(params.primaryMemberId),
  };
}

function parseStringParam(value: string | string[] | undefined) {
  const rawValue = Array.isArray(value) ? value[0] : value;

  return rawValue?.trim() ?? "";
}

function parseStringListParam(value: string | string[] | undefined) {
  const values = Array.isArray(value) ? value : value ? [value] : [];

  return values.map((item) => item.trim()).filter(Boolean);
}

function parseMonthListParam(value: string | string[] | undefined) {
  return parseStringListParam(value).filter((item) => /^\d{4}-\d{2}$/.test(item));
}

function parseReportMonthRange(
  params: Record<string, string | string[] | undefined>
): ReportMonthRange {
  const start = parseMonthDateParam(params.start);
  const end = parseMonthDateParam(params.end);

  if (start || end) {
    return normalizeReportMonthRange({ start, end });
  }

  const legacyReportMonths = parseMonthListParam(params.reportMonth).sort();

  if (legacyReportMonths.length === 0) {
    return { start: null, end: null };
  }

  return normalizeReportMonthRange({
    start: monthValueToDate(legacyReportMonths[0]),
    end: monthValueToDate(legacyReportMonths[legacyReportMonths.length - 1]),
  });
}

function normalizeReportMonthRange(range: ReportMonthRange): ReportMonthRange {
  const startMonth = dateToMonthKey(range.start);
  const endMonth = dateToMonthKey(range.end);

  if (startMonth && endMonth && startMonth.localeCompare(endMonth) > 0) {
    return {
      start: monthValueToDate(endMonth),
      end: monthValueToDate(startMonth),
    };
  }

  return range;
}

function parseMonthDateParam(value: string | string[] | undefined) {
  const rawValue = parseStringParam(value);

  if (/^\d{4}-\d{2}$/.test(rawValue)) return monthValueToDate(rawValue);
  if (/^\d{4}-\d{2}-\d{2}$/.test(rawValue)) return rawValue;

  return null;
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

function dateToMonthKey(value: string | null) {
  return value?.slice(0, 7) ?? "";
}

function monthValueToDate(value: string) {
  return `${value}-01`;
}

function getYearKey(value: string | null) {
  return value?.slice(0, 4) ?? "";
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

function formatAxisPercent(value: number) {
  return `${formatInteger(value)}%`;
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

function toDate(value: string) {
  return new Date(`${value}T00:00:00`);
}
