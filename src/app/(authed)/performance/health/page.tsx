import { PERMISSIONS } from "@/lib/rbac/permissions";
import { can } from "@/lib/rbac/client";
import { requirePermission } from "@/lib/rbac/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { unstable_cache } from "next/cache";
import { AgentHealthCarrierMultiSelectFilter } from "./AgentHealthCarrierMultiSelectFilter";
import {
  AgentHealthPerformanceContent,
  AgentHealthPerformanceFilterProvider,
} from "./AgentHealthPerformanceFilterState";
import { AgentHealthMemberPaymentTable } from "./AgentHealthMemberPaymentTable";
import { AgentHealthPerformanceTrendSection } from "./AgentHealthPerformanceTrendSection";
import { AgentHealthReportMonthRangeFilter } from "./AgentHealthReportMonthRangeFilter";

export const dynamic = "force-dynamic";

type HealthMartRow = {
  deal_name: string | null;
  carrier: string | null;
  state: string | null;
  primary_member_id: string | null;
  report_month: string | null;
  paid_to_date: string | null;
  agent_received: number | null;
  num_client: number | null;
};

type ScoreCards = {
  activePolicy: ScoreCardMetric;
  activeClient: ScoreCardMetric;
  totalCommission: ScoreCardMetric;
  totalCommissionInReportYear: ReportYearCommissionMetric;
};

type ScoreCardMetric = {
  value: number;
  changePercent: number | null;
};

type ReportYearCommissionMetric = {
  value: number;
  averageMonthlyCommission: number;
  reportYear: number | null;
};

type PerformanceMonth = {
  periodKey: string;
  periodLabel: string;
  policyCount: number;
  clientCount: number;
  agentReceived: number;
};

type ChartPeriodsByLevel = Record<ChartLevel, PerformanceMonth[]>;

type PaymentStatusMonth = {
  reportMonth: string;
  total: number;
  paid: number;
  unpaid: number;
  paidRate: number;
};

type CarrierPaymentStatusRow = {
  carrier: string;
  total: number;
  paid: number;
  unpaid: number;
  paidRate: number;
};

type MemberPaymentRow = {
  dealName: string;
  carrier: string;
  primaryMemberId: string;
  totalPaid: number;
  months: {
    hasRecord: boolean;
    paid: number;
    paidToDate: string | null;
  }[];
};

type MemberPaymentSummary = {
  rows: MemberPaymentRow[];
  visibleMonthCount: number;
};

type MixBreakdownRow = {
  label: string;
  sharePercent: number;
  policyCount: number;
  clientCount: number;
  totalCommission: number;
};

type LatestMonthMixBreakdown = {
  reportMonth: string | null;
  carrierRows: MixBreakdownRow[];
  stateRows: MixBreakdownRow[];
};

type CarrierPaymentStatusBreakdown = {
  reportMonth: string | null;
  policyRows: CarrierPaymentStatusRow[];
  clientRows: CarrierPaymentStatusRow[];
};

type PerformanceData = {
  scoreCards: ScoreCards;
  memberPayments: MemberPaymentRow[];
  memberPaymentMonthCount: number;
  chartPeriodsByLevel: ChartPeriodsByLevel;
  policyPaymentStatus: PaymentStatusMonth[];
  clientPaymentStatus: PaymentStatusMonth[];
  carrierPaymentStatus: CarrierPaymentStatusBreakdown;
  latestMonthMixBreakdown: LatestMonthMixBreakdown;
};

type PerformancePageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type ReportMonthRange = {
  start: string | null;
  end: string | null;
};

type ChartLevel = "month" | "quarter" | "year";

type HealthMartQueryFilters = {
  reportMonthRange: ReportMonthRange;
  carriers: string[];
};

type MonthlyPerformanceSummary = {
  reportMonth: string;
  policyIds: Set<string>;
  maxClientByMemberId: Map<string, number>;
  agentReceived: number;
};

const HEALTH_MART_PAGE_SIZE = 1000;
const CARRIER_OPTIONS_CACHE_SECONDS = 600;
const CHART_MONTH_LIMIT = 12;
const CHART_QUARTER_LIMIT = 8;
const CHART_YEAR_LIMIT = 5;
const CHART_MIN_POLICY_COUNT = 100;
const PAYMENT_STATUS_MONTH_LIMIT = 5;
const PAYMENT_STATUS_MIN_TOTAL = 100;
const MIX_BREAKDOWN_TOP_LIMIT = 5;
const CARRIER_PAYMENT_VISIBLE_ROW_COUNT = 6;
const CARRIER_PAYMENT_HEADER_HEIGHT_PX = 44;
const CARRIER_PAYMENT_ROW_HEIGHT_PX = 64;
const CARRIER_PAYMENT_TABLE_MAX_HEIGHT =
  CARRIER_PAYMENT_HEADER_HEIGHT_PX +
  CARRIER_PAYMENT_VISIBLE_ROW_COUNT * CARRIER_PAYMENT_ROW_HEIGHT_PX;

const fetchCachedCarrierOptions = unstable_cache(
  async (agentName: string | null, start: string | null, end: string | null) =>
    fetchCarrierOptions(agentName, { start, end }),
  ["agent-health-carrier-options"],
  { revalidate: CARRIER_OPTIONS_CACHE_SECONDS }
);

export default async function PerformancePage({
  searchParams,
}: PerformancePageProps) {
  const session = await requirePermission(
    PERMISSIONS.AGENT_PERFORMANCE_HEALTH_OWN
  );
  const params = searchParams ? await searchParams : {};
  const reportMonthRange = parseReportMonthRange(params);
  const chartLevel = parseChartLevel(params.chartLevel);
  const canViewAll = can(
    session.user.permissions,
    PERMISSIONS.AGENT_PERFORMANCE_HEALTH_ALL
  );
  const agentName = normalizeAgentName(session.user.name ?? "");
  const selectedCarriers = parseCarrierParams(params.carrier);
  const queryFilters = {
    reportMonthRange,
    carriers: selectedCarriers,
  };
  const canLoadPerformance = canViewAll || Boolean(agentName);
  const scopedAgentName = canViewAll ? null : agentName;
  const [performanceData, carrierOptions]: [PerformanceData | null, string[]] =
    canLoadPerformance
      ? await Promise.all([
          fetchPerformanceData(scopedAgentName, queryFilters),
          fetchCachedCarrierOptions(
            scopedAgentName,
            reportMonthRange.start,
            reportMonthRange.end
          ),
        ])
      : [null, []];

  return (
    <AgentHealthPerformanceFilterProvider>
      <div className="min-h-screen bg-slate-50 px-6 py-8 md:px-10 text-slate-900">
        <div className="mx-auto max-w-[1536px]">
          <header className="mb-8 flex flex-wrap items-start justify-between gap-6">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-slate-900">
                Health Agent Performance
              </h1>
              <p className="mt-2 text-sm text-slate-500">
                {canViewAll
                  ? "Showing performance for all agents."
                  : `Showing performance for ${agentName || "your account"}.`}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-3">
              <AgentHealthCarrierMultiSelectFilter
                key={selectedCarriers.join("\u001f")}
                options={carrierOptions}
                selectedCarriers={selectedCarriers}
              />
              <AgentHealthReportMonthRangeFilter
                key={`${reportMonthRange.start ?? ""}:${reportMonthRange.end ?? ""}`}
                startDate={reportMonthRange.start}
                endDate={reportMonthRange.end}
              />
            </div>
          </header>

          {!performanceData ? (
            <div className="rounded-xl border border-slate-200 bg-white px-8 py-16 text-center text-sm font-medium text-slate-500 shadow-sm">
              Your account name is required to load performance data.
            </div>
          ) : (
            <AgentHealthPerformanceContent>
              <div className="space-y-6">
                <section className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
                <ScoreCard
                  label="Latest Active Policies"
                  value={formatInteger(performanceData.scoreCards.activePolicy.value)}
                  changePercent={
                    performanceData.scoreCards.activePolicy.changePercent
                  }
                />
                <ScoreCard
                  label="Latest Active Clients"
                  value={formatInteger(performanceData.scoreCards.activeClient.value)}
                  changePercent={
                    performanceData.scoreCards.activeClient.changePercent
                  }
                />
                <ScoreCard
                  label="Latest Month Commission"
                  value={formatCurrency(
                    performanceData.scoreCards.totalCommission.value
                  )}
                  changePercent={
                    performanceData.scoreCards.totalCommission.changePercent
                  }
                />
                <ScoreCard
                  label={`${
                    performanceData.scoreCards.totalCommissionInReportYear
                      .reportYear ?? "Report Year"
                  } Commission`}
                  value={formatCurrency(
                    performanceData.scoreCards.totalCommissionInReportYear.value
                  )}
                  footerText={`Avg ${formatCurrency(
                    performanceData.scoreCards.totalCommissionInReportYear
                      .averageMonthlyCommission
                  )} / month`}
                />
              </section>

              <AgentHealthPerformanceTrendSection
                initialChartLevel={chartLevel}
                periodsByLevel={performanceData.chartPeriodsByLevel}
              />
              <PaymentStatusSection
                policyRows={performanceData.policyPaymentStatus}
                clientRows={performanceData.clientPaymentStatus}
              />
              <CarrierPaymentStatusSection
                reportMonth={performanceData.carrierPaymentStatus.reportMonth}
                policyRows={performanceData.carrierPaymentStatus.policyRows}
                clientRows={performanceData.carrierPaymentStatus.clientRows}
              />
              <MixBreakdownSection
                reportMonth={performanceData.latestMonthMixBreakdown.reportMonth}
                carrierRows={performanceData.latestMonthMixBreakdown.carrierRows}
                stateRows={performanceData.latestMonthMixBreakdown.stateRows}
              />
              <AgentHealthMemberPaymentTable
                rows={performanceData.memberPayments}
                visibleMonthCount={performanceData.memberPaymentMonthCount}
              />
            </div>
          </AgentHealthPerformanceContent>
        )}
        </div>
      </div>
    </AgentHealthPerformanceFilterProvider>
  );
}

async function fetchPerformanceData(
  agentName: string | null,
  queryFilters: HealthMartQueryFilters
): Promise<PerformanceData> {
  const rows = (await fetchHealthMartRows(agentName, queryFilters)).filter(
    (row) => row.report_month
  );
  const monthlySummaries = buildMonthlyPerformanceSummaries(rows);
  const memberPaymentSummary = buildMemberPaymentSummary(rows);

  return {
    scoreCards: buildScoreCards(monthlySummaries),
    memberPayments: memberPaymentSummary.rows,
    memberPaymentMonthCount: memberPaymentSummary.visibleMonthCount,
    chartPeriodsByLevel: {
      month: buildChartPeriods(monthlySummaries, "month"),
      quarter: buildChartPeriods(monthlySummaries, "quarter"),
      year: buildChartPeriods(monthlySummaries, "year"),
    },
    policyPaymentStatus: buildPolicyPaymentStatus(rows),
    clientPaymentStatus: buildClientPaymentStatus(rows),
    carrierPaymentStatus: buildCarrierPaymentStatusBreakdown(
      rows,
      monthlySummaries
    ),
    latestMonthMixBreakdown: buildLatestMonthMixBreakdown(
      rows,
      monthlySummaries
    ),
  };
}

function buildMonthlyPerformanceSummaries(
  rows: HealthMartRow[]
): MonthlyPerformanceSummary[] {
  const monthlyData = new Map<string, MonthlyPerformanceSummary>();

  for (const row of rows) {
    if (!row.report_month) continue;
    const current = monthlyData.get(row.report_month) ?? {
      reportMonth: row.report_month,
      policyIds: new Set<string>(),
      maxClientByMemberId: new Map<string, number>(),
      agentReceived: 0,
    };

    if (row.primary_member_id) {
      current.policyIds.add(row.primary_member_id);
      current.maxClientByMemberId.set(
        row.primary_member_id,
        Math.max(
          current.maxClientByMemberId.get(row.primary_member_id) ?? 0,
          row.num_client ?? 0
        )
      );
    }

    current.agentReceived += row.agent_received ?? 0;
    monthlyData.set(row.report_month, current);
  }

  return [...monthlyData.values()].sort((a, b) =>
    a.reportMonth.localeCompare(b.reportMonth)
  );
}

function buildScoreCards(
  monthlySummaries: MonthlyPerformanceSummary[]
): ScoreCards {
  const qualifyingSummaries = monthlySummaries.filter(
    (summary) => summary.policyIds.size > CHART_MIN_POLICY_COUNT
  );
  const latest = toScoreCardSummary(qualifyingSummaries.at(-1));
  const previous = toScoreCardSummary(qualifyingSummaries.at(-2));
  const reportYearCommission =
    summarizeReportYearCommission(monthlySummaries);

  return {
    activePolicy: toScoreCardMetric(latest.policyCount, previous.policyCount),
    activeClient: toScoreCardMetric(latest.clientCount, previous.clientCount),
    totalCommission: toScoreCardMetric(
      latest.agentReceived,
      previous.agentReceived
    ),
    totalCommissionInReportYear: reportYearCommission,
  };
}

function toScoreCardSummary(summary: MonthlyPerformanceSummary | undefined) {
  if (!summary) {
    return {
      policyCount: 0,
      clientCount: 0,
      agentReceived: 0,
    };
  }

  return {
    policyCount: summary.policyIds.size,
    clientCount: sumMapValues(summary.maxClientByMemberId),
    agentReceived: summary.agentReceived,
  };
}

function summarizeReportYearCommission(
  monthlySummaries: MonthlyPerformanceSummary[]
): ReportYearCommissionMetric {
  const latestSummary = monthlySummaries.at(-1);

  if (!latestSummary) {
    return {
      value: 0,
      averageMonthlyCommission: 0,
      reportYear: null,
    };
  }

  const reportYear = Number(latestSummary.reportMonth.slice(0, 4));
  const reportYearSummaries = monthlySummaries.filter(
    (summary) => Number(summary.reportMonth.slice(0, 4)) === reportYear
  );
  const totalCommission = reportYearSummaries.reduce(
    (total, summary) => total + summary.agentReceived,
    0
  );
  const qualifyingMonthCommissions = reportYearSummaries
    .filter((summary) => summary.policyIds.size > CHART_MIN_POLICY_COUNT)
    .map((summary) => summary.agentReceived);

  return {
    value: totalCommission,
    averageMonthlyCommission:
      qualifyingMonthCommissions.length === 0
        ? 0
        : qualifyingMonthCommissions.reduce((total, value) => total + value, 0) /
          qualifyingMonthCommissions.length,
    reportYear,
  };
}

function toScoreCardMetric(value: number, previousValue: number): ScoreCardMetric {
  return {
    value,
    changePercent: calculatePercentChange(value, previousValue),
  };
}

function calculatePercentChange(value: number, previousValue: number) {
  if (previousValue === 0) return null;
  return ((value - previousValue) / previousValue) * 100;
}

function buildChartPeriods(
  monthlySummaries: MonthlyPerformanceSummary[],
  chartLevel: ChartLevel
) {
  const periodData = new Map<
    string,
    {
      label: string;
      policyIds: Set<string>;
      maxClientByMemberId: Map<string, number>;
      agentReceived: number;
    }
  >();

  for (const summary of monthlySummaries) {
    const period = getChartPeriod(summary.reportMonth, chartLevel);
    const current = periodData.get(period.key) ?? {
      label: period.label,
      policyIds: new Set<string>(),
      maxClientByMemberId: new Map<string, number>(),
      agentReceived: 0,
    };

    for (const policyId of summary.policyIds) {
      current.policyIds.add(policyId);
    }

    for (const [memberId, clients] of summary.maxClientByMemberId) {
      current.maxClientByMemberId.set(
        memberId,
        Math.max(current.maxClientByMemberId.get(memberId) ?? 0, clients)
      );
    }

    current.agentReceived += summary.agentReceived;
    periodData.set(period.key, current);
  }

  return [...periodData.entries()]
    .map(([periodKey, data]) => ({
      periodKey,
      periodLabel: data.label,
      policyCount: data.policyIds.size,
      clientCount: sumMapValues(data.maxClientByMemberId),
      agentReceived: data.agentReceived,
    }))
    .filter((month) => month.policyCount > CHART_MIN_POLICY_COUNT)
    .sort((a, b) => b.periodKey.localeCompare(a.periodKey))
    .slice(0, getChartPeriodLimit(chartLevel))
    .reverse();
}

function getChartPeriod(reportMonth: string, chartLevel: ChartLevel) {
  const year = reportMonth.slice(0, 4);
  const month = Number(reportMonth.slice(5, 7));

  if (chartLevel === "year") {
    return {
      key: year,
      label: year,
    };
  }

  if (chartLevel === "quarter") {
    const quarter = Math.floor((month - 1) / 3) + 1;

    return {
      key: `${year}-Q${quarter}`,
      label: `${year} Q${quarter}`,
    };
  }

  return {
    key: reportMonth.slice(0, 7),
    label: reportMonth.slice(0, 7),
  };
}

function getChartPeriodLimit(chartLevel: ChartLevel) {
  if (chartLevel === "year") return CHART_YEAR_LIMIT;
  if (chartLevel === "quarter") return CHART_QUARTER_LIMIT;
  return CHART_MONTH_LIMIT;
}

async function fetchHealthMartRows(
  agentName: string | null,
  queryFilters: HealthMartQueryFilters
) {
  const supabase = getSupabaseAdmin();
  const rows: HealthMartRow[] = [];

  for (let from = 0; ; from += HEALTH_MART_PAGE_SIZE) {
    let query = supabase
      .from("health_mart")
      .select(
        "deal_name,carrier,state,primary_member_id,report_month,paid_to_date,agent_received,num_client"
      )
      .order("report_month", { ascending: true })
      .range(from, from + HEALTH_MART_PAGE_SIZE - 1);

    if (agentName) {
      query = query.eq("agent", agentName);
    }

    if (queryFilters.reportMonthRange.start) {
      query = query.gte(
        "report_month",
        getReportMonthStart(queryFilters.reportMonthRange.start)
      );
    }

    if (queryFilters.reportMonthRange.end) {
      query = query.lte("report_month", queryFilters.reportMonthRange.end);
    }

    if (queryFilters.carriers.length > 0) {
      query = query.in("carrier", queryFilters.carriers);
    }

    const { data, error } = await query;

    if (error) throw new Error(error.message);

    rows.push(...(((data ?? []) as unknown) as HealthMartRow[]));

    if (!data || data.length < HEALTH_MART_PAGE_SIZE) {
      return rows;
    }
  }
}

async function fetchCarrierOptions(
  agentName: string | null,
  reportMonthRange: ReportMonthRange
) {
  const supabase = getSupabaseAdmin();
  const carriers = new Set<string>();

  for (let from = 0; ; from += HEALTH_MART_PAGE_SIZE) {
    let query = supabase
      .from("health_mart")
      .select("carrier")
      .order("carrier", { ascending: true })
      .range(from, from + HEALTH_MART_PAGE_SIZE - 1);

    if (agentName) {
      query = query.eq("agent", agentName);
    }

    if (reportMonthRange.start) {
      query = query.gte("report_month", getReportMonthStart(reportMonthRange.start));
    }

    if (reportMonthRange.end) {
      query = query.lte("report_month", reportMonthRange.end);
    }

    const { data, error } = await query;

    if (error) throw new Error(error.message);

    for (const row of ((data ?? []) as { carrier: string | null }[])) {
      const carrier = row.carrier?.trim();
      if (carrier) carriers.add(carrier);
    }

    if (!data || data.length < HEALTH_MART_PAGE_SIZE) {
      return [...carriers].sort((a, b) => a.localeCompare(b));
    }
  }
}

function buildMemberPaymentSummary(rows: HealthMartRow[]): MemberPaymentSummary {
  const latestYear = rows.reduce<number | null>((year, row) => {
    if (!row.report_month) return year;
    const rowYear = new Date(`${row.report_month}T00:00:00`).getFullYear();

    return year === null || rowYear > year ? rowYear : year;
  }, null);

  if (latestYear === null) {
    return {
      rows: [],
      visibleMonthCount: 0,
    };
  }

  const rowsByMember = new Map<string, MemberPaymentRow>();
  let visibleMonthCount = 0;

  for (const row of rows) {
    if (!row.report_month) continue;
    const reportDate = new Date(`${row.report_month}T00:00:00`);
    if (reportDate.getFullYear() !== latestYear) continue;

    const monthIndex = reportDate.getMonth();
    visibleMonthCount = Math.max(visibleMonthCount, monthIndex + 1);
    const dealName = row.deal_name?.trim() || "Unknown";
    const carrier = row.carrier?.trim() || "Unknown";
    const primaryMemberId = row.primary_member_id?.trim() || "Unknown";
    const key = `${dealName}\u001f${carrier}\u001f${primaryMemberId}`;
    const current =
      rowsByMember.get(key) ??
      ({
        dealName,
        carrier,
        primaryMemberId,
        totalPaid: 0,
        months: Array.from({ length: 12 }, () => ({
          hasRecord: false,
          paid: 0,
          paidToDate: null,
        })),
      } satisfies MemberPaymentRow);
    const paid = row.agent_received ?? 0;

    current.totalPaid += paid;
    current.months[monthIndex].hasRecord = true;
    current.months[monthIndex].paid += paid;
    current.months[monthIndex].paidToDate = maxDateString(
      current.months[monthIndex].paidToDate,
      row.paid_to_date
    );
    rowsByMember.set(key, current);
  }

  return {
    rows: [...rowsByMember.values()].sort((a, b) => b.totalPaid - a.totalPaid),
    visibleMonthCount,
  };
}

function buildPolicyPaymentStatus(rows: HealthMartRow[]) {
  const monthlyMemberStatus = new Map<string, Map<string, boolean>>();

  for (const row of rows) {
    if (!row.report_month || !row.primary_member_id) continue;
    const month = monthlyMemberStatus.get(row.report_month) ?? new Map<string, boolean>();
    const wasPaid = month.get(row.primary_member_id) ?? false;

    month.set(row.primary_member_id, wasPaid || Boolean(row.paid_to_date));
    monthlyMemberStatus.set(row.report_month, month);
  }

  return [...monthlyMemberStatus.entries()]
    .map(([reportMonth, memberStatus]) => {
      const paid = [...memberStatus.values()].filter(Boolean).length;
      const total = memberStatus.size;

      return toPaymentStatusMonth(reportMonth, total, paid);
    })
    .filter((month) => month.total > PAYMENT_STATUS_MIN_TOTAL)
    .sort((a, b) => b.reportMonth.localeCompare(a.reportMonth))
    .slice(0, PAYMENT_STATUS_MONTH_LIMIT);
}

function buildClientPaymentStatus(rows: HealthMartRow[]) {
  const monthlyStatus = new Map<string, { paid: number; unpaid: number }>();

  for (const row of rows) {
    if (!row.report_month) continue;
    const current = monthlyStatus.get(row.report_month) ?? { paid: 0, unpaid: 0 };
    const clients = row.num_client ?? 0;

    if (row.paid_to_date) {
      current.paid += clients;
    } else {
      current.unpaid += clients;
    }

    monthlyStatus.set(row.report_month, current);
  }

  return [...monthlyStatus.entries()]
    .map(([reportMonth, status]) =>
      toPaymentStatusMonth(reportMonth, status.paid + status.unpaid, status.paid)
    )
    .filter((month) => month.total > PAYMENT_STATUS_MIN_TOTAL)
    .sort((a, b) => b.reportMonth.localeCompare(a.reportMonth))
    .slice(0, PAYMENT_STATUS_MONTH_LIMIT);
}

function toPaymentStatusMonth(reportMonth: string, total: number, paid: number) {
  const unpaid = Math.max(total - paid, 0);

  return {
    reportMonth,
    total,
    paid,
    unpaid,
    paidRate: total === 0 ? 0 : (paid / total) * 100,
  };
}

function buildCarrierPaymentStatusBreakdown(
  rows: HealthMartRow[],
  monthlySummaries: MonthlyPerformanceSummary[]
): CarrierPaymentStatusBreakdown {
  const latestCompleteMonth = monthlySummaries
    .filter((summary) => summary.policyIds.size > CHART_MIN_POLICY_COUNT)
    .at(-1);

  if (!latestCompleteMonth) {
    return {
      reportMonth: null,
      policyRows: [],
      clientRows: [],
    };
  }

  return buildCarrierPaymentStatusRows(
    rows.filter((row) => row.report_month === latestCompleteMonth.reportMonth),
    latestCompleteMonth.reportMonth
  );
}

function buildCarrierPaymentStatusRows(
  rows: HealthMartRow[],
  reportMonth: string
): CarrierPaymentStatusBreakdown {
  const carriers = new Map<
    string,
    {
      memberStatus: Map<string, { paid: boolean; clients: number }>;
    }
  >();

  for (const row of rows) {
    const carrier = row.carrier?.trim() || "Unknown";
    const current =
      carriers.get(carrier) ??
      ({
        memberStatus: new Map<string, { paid: boolean; clients: number }>(),
      });
    const memberId = row.primary_member_id?.trim();

    if (memberId) {
      const member = current.memberStatus.get(memberId) ?? {
        paid: false,
        clients: 0,
      };

      member.paid = member.paid || Boolean(row.paid_to_date);
      member.clients = Math.max(member.clients, row.num_client ?? 0);
      current.memberStatus.set(memberId, member);
    }

    carriers.set(carrier, current);
  }

  const policyRows: CarrierPaymentStatusRow[] = [];
  const clientRows: CarrierPaymentStatusRow[] = [];

  for (const [carrier, data] of carriers.entries()) {
    const members = [...data.memberStatus.values()];
    const policyTotal = members.length;
    const policyPaid = members.filter((member) => member.paid).length;
    const clientTotal = members.reduce(
      (total, member) => total + member.clients,
      0
    );
    const clientPaid = members.reduce(
      (total, member) => total + (member.paid ? member.clients : 0),
      0
    );

    if (policyTotal > 0) {
      policyRows.push(toCarrierPaymentStatusRow(carrier, policyTotal, policyPaid));
    }

    if (clientTotal > 0) {
      clientRows.push(toCarrierPaymentStatusRow(carrier, clientTotal, clientPaid));
    }
  }

  return {
    reportMonth,
    policyRows: sortCarrierPaymentStatusRows(policyRows),
    clientRows: sortCarrierPaymentStatusRows(clientRows),
  };
}

function toCarrierPaymentStatusRow(
  carrier: string,
  total: number,
  paid: number
): CarrierPaymentStatusRow {
  const unpaid = Math.max(total - paid, 0);

  return {
    carrier,
    total,
    paid,
    unpaid,
    paidRate: total === 0 ? 0 : (paid / total) * 100,
  };
}

function sortCarrierPaymentStatusRows(rows: CarrierPaymentStatusRow[]) {
  return rows.sort(
    (a, b) =>
      b.total - a.total ||
      b.paidRate - a.paidRate ||
      a.carrier.localeCompare(b.carrier)
  );
}

function buildLatestMonthMixBreakdown(
  rows: HealthMartRow[],
  monthlySummaries: MonthlyPerformanceSummary[]
): LatestMonthMixBreakdown {
  const latestCompleteMonth = monthlySummaries
    .filter((summary) => summary.policyIds.size > CHART_MIN_POLICY_COUNT)
    .at(-1);

  if (!latestCompleteMonth) {
    return {
      reportMonth: null,
      carrierRows: [],
      stateRows: [],
    };
  }

  const monthRows = rows.filter(
    (row) => row.report_month === latestCompleteMonth.reportMonth
  );

  return {
    reportMonth: latestCompleteMonth.reportMonth,
    carrierRows: buildMixBreakdownRows(
      monthRows,
      (row) => row.carrier?.trim() || "Unknown",
      latestCompleteMonth.policyIds.size
    ),
    stateRows: buildMixBreakdownRows(
      monthRows,
      (row) => row.state?.trim().toUpperCase() || "Unknown",
      latestCompleteMonth.policyIds.size
    ),
  };
}

function buildMixBreakdownRows(
  rows: HealthMartRow[],
  getLabel: (row: HealthMartRow) => string,
  totalPolicyCount: number
): MixBreakdownRow[] {
  const groups = new Map<
    string,
    {
      policyIds: Set<string>;
      maxClientByMemberId: Map<string, number>;
      totalCommission: number;
    }
  >();

  for (const row of rows) {
    const label = getLabel(row);
    const current =
      groups.get(label) ??
      ({
        policyIds: new Set<string>(),
        maxClientByMemberId: new Map<string, number>(),
        totalCommission: 0,
      });
    const memberId = row.primary_member_id?.trim();

    if (memberId) {
      current.policyIds.add(memberId);
      current.maxClientByMemberId.set(
        memberId,
        Math.max(
          current.maxClientByMemberId.get(memberId) ?? 0,
          row.num_client ?? 0
        )
      );
    }

    current.totalCommission += row.agent_received ?? 0;
    groups.set(label, current);
  }

  return [...groups.entries()]
    .map(([label, group]) => {
      const policyCount = group.policyIds.size;

      return {
        label,
        sharePercent:
          totalPolicyCount === 0 ? 0 : (policyCount / totalPolicyCount) * 100,
        policyCount,
        clientCount: sumMapValues(group.maxClientByMemberId),
        totalCommission: group.totalCommission,
      };
    })
    .filter((row) => row.policyCount > 0)
    .sort(
      (a, b) =>
        b.policyCount - a.policyCount ||
        b.totalCommission - a.totalCommission ||
        a.label.localeCompare(b.label)
    )
    .reduce<MixBreakdownRow[]>((limitedRows, row, index) => {
      if (index < MIX_BREAKDOWN_TOP_LIMIT) {
        limitedRows.push(row);
        return limitedRows;
      }

      const otherRow =
        limitedRows[MIX_BREAKDOWN_TOP_LIMIT] ??
        ({
          label: "Other",
          sharePercent: 0,
          policyCount: 0,
          clientCount: 0,
          totalCommission: 0,
        } satisfies MixBreakdownRow);

      otherRow.policyCount += row.policyCount;
      otherRow.clientCount += row.clientCount;
      otherRow.totalCommission += row.totalCommission;
      otherRow.sharePercent =
        totalPolicyCount === 0
          ? 0
          : (otherRow.policyCount / totalPolicyCount) * 100;

      if (!limitedRows[MIX_BREAKDOWN_TOP_LIMIT]) {
        limitedRows.push(otherRow);
      }

      return limitedRows;
    }, []);
}

function PaymentStatusSection({
  policyRows,
  clientRows,
}: {
  policyRows: PaymentStatusMonth[];
  clientRows: PaymentStatusMonth[];
}) {
  return (
    <section className="grid gap-5 xl:grid-cols-2">
      <PaymentStatusTable
        title="Policy Paid Rate | Recent Months"
        totalLabel="Policies"
        rows={policyRows}
      />
      <PaymentStatusTable
        title="Client Paid Rate | Recent Months"
        totalLabel="Clients"
        rows={clientRows}
      />
    </section>
  );
}

function CarrierPaymentStatusSection({
  reportMonth,
  policyRows,
  clientRows,
}: {
  reportMonth: string | null;
  policyRows: CarrierPaymentStatusRow[];
  clientRows: CarrierPaymentStatusRow[];
}) {
  return (
    <section className="grid gap-5 xl:grid-cols-2">
      <CarrierPaymentStatusTable
        title="Carrier Policy Paid Rate | Latest Complete Month"
        reportMonth={reportMonth}
        totalLabel="Policies"
        rows={policyRows}
      />
      <CarrierPaymentStatusTable
        title="Carrier Client Paid Rate | Latest Complete Month"
        reportMonth={reportMonth}
        totalLabel="Clients"
        rows={clientRows}
      />
    </section>
  );
}

function MixBreakdownSection({
  reportMonth,
  carrierRows,
  stateRows,
}: {
  reportMonth: string | null;
  carrierRows: MixBreakdownRow[];
  stateRows: MixBreakdownRow[];
}) {
  return (
    <section className="grid gap-5 xl:grid-cols-2">
      <MixBreakdownTable
        title="Carrier Share | Latest Complete Month"
        labelHeader="Carrier"
        reportMonth={reportMonth}
        rows={carrierRows}
      />
      <MixBreakdownTable
        title="State Share | Latest Complete Month"
        labelHeader="State"
        reportMonth={reportMonth}
        rows={stateRows}
      />
    </section>
  );
}

function CarrierPaymentStatusTable({
  title,
  reportMonth,
  totalLabel,
  rows,
}: {
  title: string;
  reportMonth: string | null;
  totalLabel: string;
  rows: CarrierPaymentStatusRow[];
}) {
  return (
    <section className="flex flex-col">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <h2 className="text-lg font-bold leading-tight text-slate-800">{title}</h2>
        {reportMonth ? (
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {formatReportMonth(reportMonth)}
          </span>
        ) : null}
      </div>
      <article className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-shadow duration-300 hover:shadow-md">
        <div
          className="overflow-y-auto overflow-x-hidden"
          style={{ maxHeight: CARRIER_PAYMENT_TABLE_MAX_HEIGHT }}
        >
          <table className="w-full table-fixed text-sm">
            <thead>
              <tr className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50/90 backdrop-blur-sm text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                <th className="w-[24%] px-5 py-3">Carrier</th>
                <th className="w-[18%] px-4 py-3 text-right">{totalLabel}</th>
                <th className="w-[17%] px-4 py-3 text-right text-emerald-600">
                  Paid
                </th>
                <th className="w-[17%] px-4 py-3 text-right text-rose-600">
                  Unpaid
                </th>
                <th className="w-[24%] px-5 py-3 text-right">Paid Rate</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td className="px-6 py-12 text-center text-sm font-medium text-slate-500" colSpan={5}>
                    No complete month with more than 100 policies.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr
                    key={row.carrier}
                    className="group h-16 border-b border-slate-100 transition-colors hover:bg-slate-50/50 last:border-b-0"
                  >
                    <td className="break-words px-5 py-3 text-sm font-semibold text-slate-900">
                      {row.carrier}
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-slate-600">
                      {formatInteger(row.total)}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-semibold text-emerald-600">
                      {formatInteger(row.paid)}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-semibold text-rose-500">
                      {formatInteger(row.unpaid)}
                    </td>
                    <td className="px-5 py-3 align-middle">
                      <div className="ml-auto flex w-full items-center justify-end">
                        <div className="relative h-6 w-full overflow-hidden rounded border border-emerald-100 bg-emerald-50">
                          <div
                            className="h-full rounded bg-emerald-400 opacity-70"
                            style={{ width: `${Math.min(row.paidRate, 100)}%` }}
                          />
                          <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-emerald-700">
                            {formatPercent(row.paidRate)}
                          </span>
                        </div>
                      </div>
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

function MixBreakdownTable({
  title,
  labelHeader,
  reportMonth,
  rows,
}: {
  title: string;
  labelHeader: string;
  reportMonth: string | null;
  rows: MixBreakdownRow[];
}) {
  return (
    <section className="flex flex-col">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <h2 className="text-lg font-bold leading-tight text-slate-800">{title}</h2>
        {reportMonth ? (
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {formatReportMonth(reportMonth)}
          </span>
        ) : null}
      </div>
      <article className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-shadow duration-300 hover:shadow-md">
        <div className="overflow-hidden">
          <table className="w-full table-fixed text-[13px]">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/90 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                <th className="w-[21%] px-4 py-3">{labelHeader}</th>
                <th className="w-[13%] px-3 py-3 text-right">Policies</th>
                <th className="w-[12%] px-3 py-3 text-right">Clients</th>
                <th className="w-[25%] px-4 py-3 text-right">Commission</th>
                <th className="w-[29%] px-3 py-3 text-right">% of Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td className="px-6 py-12 text-center text-sm font-medium text-slate-500" colSpan={5}>
                    No complete month with more than 100 policies.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr
                    key={row.label}
                    className="group border-b border-slate-100 transition-colors hover:bg-slate-50/50 last:border-b-0"
                  >
                    <td className="break-words px-4 py-3 font-semibold text-slate-900">
                      {row.label}
                    </td>
                    <td className="px-3 py-3 text-right font-semibold text-slate-700">
                      {formatInteger(row.policyCount)}
                    </td>
                    <td className="px-3 py-3 text-right text-slate-500">
                      {formatInteger(row.clientCount)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-900">
                      {formatCurrency(row.totalCommission)}
                    </td>
                    <td className="px-3 py-3 align-middle">
                      <div className="ml-auto flex w-full items-center justify-end">
                        <div className="relative h-6 w-full overflow-hidden rounded border border-blue-100 bg-blue-50">
                          <div
                            className="h-full rounded bg-blue-400 opacity-70"
                            style={{ width: `${Math.min(row.sharePercent, 100)}%` }}
                          />
                          <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-blue-700">
                            {formatPercent(row.sharePercent)}
                          </span>
                        </div>
                      </div>
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

function PaymentStatusTable({
  title,
  totalLabel,
  rows,
}: {
  title: string;
  totalLabel: string;
  rows: PaymentStatusMonth[];
}) {
  return (
    <section className="flex flex-col">
      <h2 className="mb-4 text-lg font-bold leading-tight text-slate-800">{title}</h2>
      <article className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-shadow duration-300 hover:shadow-md">
        <div className="overflow-x-auto">
          <table className="min-w-full table-fixed text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/90 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                <th className="w-[20%] px-5 py-3">Month</th>
                <th className="w-[18%] px-4 py-3 text-right">{totalLabel}</th>
                <th className="w-[17%] px-4 py-3 text-right text-emerald-600">
                  Paid
                </th>
                <th className="w-[17%] px-4 py-3 text-right text-rose-600">
                  Unpaid
                </th>
                <th className="w-[28%] px-5 py-3 text-right">Paid Rate</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td className="px-6 py-12 text-center text-sm font-medium text-slate-500" colSpan={5}>
                    No months with more than 100 records.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr
                    key={row.reportMonth}
                    className="group border-b border-slate-100 transition-colors hover:bg-slate-50/50 last:border-b-0"
                  >
                    <td className="whitespace-nowrap px-5 py-3 text-sm font-semibold text-slate-900">
                      {formatReportMonth(row.reportMonth)}
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-slate-600">
                      {formatInteger(row.total)}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-semibold text-emerald-600">
                      {formatInteger(row.paid)}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-semibold text-rose-500">
                      {formatInteger(row.unpaid)}
                    </td>
                    <td className="px-5 py-3 align-middle">
                      <div className="ml-auto flex w-32 items-center justify-end">
                        <div className="relative h-6 w-full overflow-hidden rounded border border-emerald-100 bg-emerald-50">
                          <div
                            className="h-full rounded bg-emerald-400 opacity-70"
                            style={{ width: `${Math.min(row.paidRate, 100)}%` }}
                          />
                          <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-emerald-700">
                            {formatPercent(row.paidRate)}
                          </span>
                        </div>
                      </div>
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

function ScoreCard({
  label,
  value,
  changePercent,
  footerText,
}: {
  label: string;
  value: string;
  changePercent?: number | null;
  footerText?: string;
}) {
  const hasTrend = changePercent !== undefined && changePercent !== null;
  const isUp = hasTrend && changePercent > 0;
  const isDown = hasTrend && changePercent < 0;
  
  let trendColorClass = "text-slate-500 bg-slate-50";
  if (isUp) {
    trendColorClass = "text-emerald-600 bg-emerald-50";
  } else if (isDown) {
    trendColorClass = "text-rose-600 bg-rose-50";
  }

  const footer = footerText ?? formatTrendContextText(changePercent ?? null);

  return (
    <article className="flex min-h-[124px] flex-col rounded-xl border border-slate-200/70 bg-white px-5 py-4 text-center shadow-[0_6px_18px_rgba(15,23,42,0.06)] transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgba(15,23,42,0.1)]">
      <div className="flex min-h-8 items-center justify-center text-[12px] font-semibold uppercase leading-snug tracking-[0.08em] text-slate-500">
        {label}
      </div>
      <div className="flex flex-1 items-center justify-center py-2">
        <div className="w-full break-words text-center text-[2rem] font-bold leading-none tracking-normal text-slate-950 tabular-nums">
          {value}
        </div>
      </div>
      <div className="flex min-h-7 items-center justify-center gap-2">
        {hasTrend ? (
          <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${trendColorClass}`}>
            {isUp && <span className="mr-1">↑</span>}
            {isDown && <span className="mr-1">↓</span>}
            {formatTrendBadgePercent(Math.abs(changePercent))}
          </span>
        ) : null}
        <span className={`min-w-0 truncate text-xs font-medium ${hasTrend ? "text-slate-600" : "text-slate-500"}`}>
          {footer}
        </span>
      </div>
    </article>
  );
}

function normalizeAgentName(value: string) {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

function parseReportMonthRange(
  params: Record<string, string | string[] | undefined>
): ReportMonthRange {
  let start = parseReportMonthParam(params.start);
  let end = parseReportMonthParam(params.end);

  if (start && end && start.localeCompare(end) > 0) {
    [start, end] = [end, start];
  }

  return { start, end };
}

function parseReportMonthParam(value: string | string[] | undefined) {
  const rawValue = Array.isArray(value) ? value[0] : value;
  if (!rawValue) return null;

  const dateMatch = rawValue.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
  if (!dateMatch) return null;

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3] ?? "01");
  if (month < 1 || month > 12) return null;

  const dayCount = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > dayCount) return null;

  return `${dateMatch[1]}-${dateMatch[2]}-${String(day).padStart(2, "0")}`;
}

function parseCarrierParams(value: string | string[] | undefined) {
  const rawValues = Array.isArray(value) ? value : value ? [value] : [];

  return [
    ...new Set(
      rawValues
        .flatMap((item) => item.split(","))
        .map((item) => item.trim())
        .filter(Boolean)
    ),
  ];
}

function parseChartLevel(value: string | string[] | undefined): ChartLevel {
  const rawValue = Array.isArray(value) ? value[0] : value;

  if (
    rawValue === "month" ||
    rawValue === "quarter" ||
    rawValue === "year"
  ) {
    return rawValue;
  }

  return "month";
}

function getReportMonthStart(value: string) {
  return `${value.slice(0, 7)}-01`;
}

function sumMapValues(map: Map<string, number>) {
  let total = 0;

  for (const value of map.values()) {
    total += value;
  }

  return total;
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

function formatReportMonth(value: string) {
  return value.slice(0, 7);
}

function formatPercent(value: number) {
  return `${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  }).format(value)}%`;
}

function formatTrendBadgePercent(value: number) {
  return `${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 0,
  }).format(value)}%`;
}

function formatTrendContextText(value: number | null) {
  if (value === null) return "No previous month";
  if (value !== 0) return "vs previous month";

  return "No change vs previous month";
}

function maxDateString(current: string | null, next: string | null) {
  if (!next) return current;
  if (!current) return next;

  return next > current ? next : current;
}
