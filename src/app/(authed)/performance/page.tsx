import { PERMISSIONS } from "@/lib/rbac/permissions";
import { can } from "@/lib/rbac/client";
import { requirePermission } from "@/lib/rbac/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { MemberPaymentTable } from "./MemberPaymentTable";
import { PerformanceChart } from "./PerformanceChart";

export const dynamic = "force-dynamic";

type HealthMartRow = {
  deal_name: string | null;
  carrier: string | null;
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
  reportMonth: string;
  policyCount: number;
  clientCount: number;
  agentReceived: number;
};

type PaymentStatusMonth = {
  reportMonth: string;
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
    paid: number;
    paidToDate: string | null;
  }[];
};

type PerformanceData = {
  scoreCards: ScoreCards;
  memberPayments: MemberPaymentRow[];
  memberPaymentMonthCount: number;
  chartMonths: PerformanceMonth[];
  policyPaymentStatus: PaymentStatusMonth[];
  clientPaymentStatus: PaymentStatusMonth[];
};

const HEALTH_MART_PAGE_SIZE = 1000;
const CHART_MONTH_LIMIT = 12;
const CHART_MIN_POLICY_COUNT = 100;
const PAYMENT_STATUS_MONTH_LIMIT = 5;
const PAYMENT_STATUS_MIN_TOTAL = 100;

export default async function PerformancePage() {
  const session = await requirePermission(PERMISSIONS.PERFORMANCE_OWN);
  const canViewAll = can(session.user.permissions, PERMISSIONS.PERFORMANCE_ALL);
  const agentName = normalizeAgentName(session.user.name ?? "");
  const performanceData =
    canViewAll || agentName
      ? await fetchPerformanceData(canViewAll ? null : agentName)
      : null;

  return (
    <div className="px-8 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-[#16233a]">
          Agent Performance
        </h1>
        <p className="mt-1 text-sm text-[#667085]">
          {canViewAll
            ? "Showing performance for all agents."
            : `Showing performance for ${agentName || "your account"}.`}
        </p>
      </header>

      {!performanceData ? (
        <div className="rounded-lg border border-dashed border-[#d8dee7] bg-white px-8 py-16 text-center text-sm text-[#667085]">
          Your account name is required to load performance data.
        </div>
      ) : (
        <div className="space-y-4">
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <ScoreCard
              label="Active Policies In Recent Month"
              value={formatInteger(performanceData.scoreCards.activePolicy.value)}
              changePercent={performanceData.scoreCards.activePolicy.changePercent}
            />
            <ScoreCard
              label="Active Clients In Recent Month"
              value={formatInteger(performanceData.scoreCards.activeClient.value)}
              changePercent={performanceData.scoreCards.activeClient.changePercent}
            />
            <ScoreCard
              label="Total Commission In Recent Month"
              value={formatCurrency(performanceData.scoreCards.totalCommission.value)}
              changePercent={performanceData.scoreCards.totalCommission.changePercent}
            />
            <ScoreCard
              label={`Total Commission In ${
                performanceData.scoreCards.totalCommissionInReportYear.reportYear ??
                "Report Year"
              }`}
              value={formatCurrency(
                performanceData.scoreCards.totalCommissionInReportYear.value
              )}
              footerText={`Avg ${formatCurrency(
                performanceData.scoreCards.totalCommissionInReportYear
                  .averageMonthlyCommission
              )} / month`}
            />
          </section>

          <PerformanceChart months={performanceData.chartMonths} />
          <PaymentStatusSection
            policyRows={performanceData.policyPaymentStatus}
            clientRows={performanceData.clientPaymentStatus}
          />
          <MemberPaymentTable
            rows={performanceData.memberPayments}
            visibleMonthCount={performanceData.memberPaymentMonthCount}
          />
        </div>
      )}
    </div>
  );
}

async function fetchPerformanceData(
  agentName: string | null
): Promise<PerformanceData> {
  const rows = (await fetchHealthMartRows(agentName)).filter(
    (row) => row.report_month
  );

  return {
    scoreCards: buildScoreCards(rows),
    memberPayments: buildMemberPayments(rows),
    memberPaymentMonthCount: getMemberPaymentMonthCount(rows),
    chartMonths: buildChartMonths(rows),
    policyPaymentStatus: buildPolicyPaymentStatus(rows),
    clientPaymentStatus: buildClientPaymentStatus(rows),
  };
}

function buildScoreCards(rows: HealthMartRow[]): ScoreCards {
  const [latestReportMonth, previousReportMonth] = [
    ...new Set(
      rows
        .map((row) => row.report_month)
        .filter((reportMonth): reportMonth is string => Boolean(reportMonth))
    ),
  ]
    .sort()
    .reverse()
    .filter((reportMonth) => countPoliciesForReportMonth(rows, reportMonth) > 100)
    .slice(0, 2);

  const latest = summarizeScoreCardMonth(rows, latestReportMonth);
  const previous = summarizeScoreCardMonth(rows, previousReportMonth);
  const reportYearCommission = summarizeReportYearCommission(rows);

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

function summarizeScoreCardMonth(
  rows: HealthMartRow[],
  reportMonth: string | null | undefined
) {
  const policyIds = new Set<string>();
  const maxClientByMemberId = new Map<string, number>();
  let agentReceived = 0;

  for (const row of rows) {
    if (!reportMonth || row.report_month !== reportMonth) continue;

    if (row.primary_member_id) {
      policyIds.add(row.primary_member_id);
      maxClientByMemberId.set(
        row.primary_member_id,
        Math.max(
          maxClientByMemberId.get(row.primary_member_id) ?? 0,
          row.num_client ?? 0
        )
      );
    }

    agentReceived += row.agent_received ?? 0;
  }

  const policyCount = policyIds.size;
  const clientCount = [...maxClientByMemberId.values()].reduce(
    (total, clients) => total + clients,
    0
  );

  return {
    policyCount,
    clientCount,
    agentReceived,
  };
}

function summarizeReportYearCommission(
  rows: HealthMartRow[]
): ReportYearCommissionMetric {
  const latestReportMonth = rows
    .map((row) => row.report_month)
    .filter((reportMonth): reportMonth is string => Boolean(reportMonth))
    .sort()
    .at(-1);

  if (!latestReportMonth) {
    return {
      value: 0,
      averageMonthlyCommission: 0,
      reportYear: null,
    };
  }

  const reportYear = new Date(`${latestReportMonth}T00:00:00`).getFullYear();
  const reportYearRows = rows.filter(
    (row) =>
      row.report_month &&
      new Date(`${row.report_month}T00:00:00`).getFullYear() === reportYear
  );
  const totalCommission = reportYearRows.reduce(
    (total, row) => total + (row.agent_received ?? 0),
    0
  );
  const qualifyingMonthCommissions = [
    ...new Set(
      reportYearRows
        .map((row) => row.report_month)
        .filter((reportMonth): reportMonth is string => Boolean(reportMonth))
    ),
  ]
    .filter((reportMonth) => countPoliciesForReportMonth(rows, reportMonth) > 100)
    .map((reportMonth) =>
      reportYearRows
        .filter((row) => row.report_month === reportMonth)
        .reduce((total, row) => total + (row.agent_received ?? 0), 0)
    );

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

function countPoliciesForReportMonth(rows: HealthMartRow[], reportMonth: string) {
  return new Set(
    rows
      .filter((row) => row.report_month === reportMonth)
      .map((row) => row.primary_member_id)
      .filter((memberId): memberId is string => Boolean(memberId))
  ).size;
}

function toScoreCardMetric(value: number, previousValue: number): ScoreCardMetric {
  return {
    value,
    changePercent:
      previousValue === 0 ? null : ((value - previousValue) / previousValue) * 100,
  };
}

function buildChartMonths(rows: HealthMartRow[]) {
  const monthlyData = new Map<
    string,
    {
      policyIds: Set<string>;
      clientCount: number;
      agentReceived: number;
    }
  >();

  for (const row of rows) {
    if (!row.report_month) continue;
    const current = monthlyData.get(row.report_month) ?? {
      policyIds: new Set<string>(),
      clientCount: 0,
      agentReceived: 0,
    };

    if (row.primary_member_id) {
      current.policyIds.add(row.primary_member_id);
    }
    current.clientCount += row.num_client ?? 0;
    current.agentReceived += row.agent_received ?? 0;
    monthlyData.set(row.report_month, current);
  }

  return [...monthlyData.entries()]
    .map(([reportMonth, data]) => ({
      reportMonth,
      policyCount: data.policyIds.size,
      clientCount: data.clientCount,
      agentReceived: data.agentReceived,
    }))
    .filter((month) => month.policyCount > CHART_MIN_POLICY_COUNT)
    .sort((a, b) => b.reportMonth.localeCompare(a.reportMonth))
    .slice(0, CHART_MONTH_LIMIT);
}

async function fetchHealthMartRows(agentName: string | null) {
  const supabase = getSupabaseAdmin();
  const rows: HealthMartRow[] = [];

  for (let from = 0; ; from += HEALTH_MART_PAGE_SIZE) {
    let query = supabase
      .from("health_mart")
      .select(
        "deal_name,carrier,primary_member_id,report_month,paid_to_date,agent_received,num_client"
      )
      .order("report_month", { ascending: true })
      .range(from, from + HEALTH_MART_PAGE_SIZE - 1);

    if (agentName) {
      query = query.eq("agent", agentName);
    }

    const { data, error } = await query;

    if (error) throw new Error(error.message);

    rows.push(...(((data ?? []) as unknown) as HealthMartRow[]));

    if (!data || data.length < HEALTH_MART_PAGE_SIZE) {
      return rows;
    }
  }
}

function buildMemberPayments(rows: HealthMartRow[]) {
  const latestYear = rows.reduce<number | null>((year, row) => {
    if (!row.report_month) return year;
    const rowYear = new Date(`${row.report_month}T00:00:00`).getFullYear();

    return year === null || rowYear > year ? rowYear : year;
  }, null);

  if (latestYear === null) return [];

  const rowsByMember = new Map<string, MemberPaymentRow>();

  for (const row of rows) {
    if (!row.report_month) continue;
    const reportDate = new Date(`${row.report_month}T00:00:00`);
    if (reportDate.getFullYear() !== latestYear) continue;

    const monthIndex = reportDate.getMonth();
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
          paid: 0,
          paidToDate: null,
        })),
      } satisfies MemberPaymentRow);
    const paid = row.agent_received ?? 0;

    current.totalPaid += paid;
    current.months[monthIndex].paid += paid;
    current.months[monthIndex].paidToDate = maxDateString(
      current.months[monthIndex].paidToDate,
      row.paid_to_date
    );
    rowsByMember.set(key, current);
  }

  return [...rowsByMember.values()].sort((a, b) => b.totalPaid - a.totalPaid);
}

function getMemberPaymentMonthCount(rows: HealthMartRow[]) {
  const latestYear = rows.reduce<number | null>((year, row) => {
    if (!row.report_month) return year;
    const rowYear = new Date(`${row.report_month}T00:00:00`).getFullYear();

    return year === null || rowYear > year ? rowYear : year;
  }, null);

  if (latestYear === null) return 0;

  return rows.reduce((monthCount, row) => {
    if (!row.report_month) return monthCount;
    const reportDate = new Date(`${row.report_month}T00:00:00`);
    if (reportDate.getFullYear() !== latestYear) return monthCount;

    return Math.max(monthCount, reportDate.getMonth() + 1);
  }, 0);
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
        title="Policy Payment Status | Paid Rate"
        totalLabel="Policies"
        rows={policyRows}
      />
      <PaymentStatusTable
        title="Client Payment Status | Paid Rate"
        totalLabel="Clients"
        rows={clientRows}
      />
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
    <section>
      <h2 className="mb-2 text-xl font-semibold text-[#24272d]">{title}</h2>
      <article className="overflow-hidden rounded-lg border border-[#d8dee7] bg-white shadow-[0_2px_8px_rgba(22,35,58,0.08)]">
        <div className="overflow-x-auto">
          <table className="min-w-full table-fixed text-sm">
            <thead>
              <tr className="border-b border-[#edf0f4] text-left text-xs font-semibold uppercase tracking-wide text-[#667085]">
                <th className="w-[20%] px-5 py-3">Month</th>
                <th className="w-[18%] px-4 py-3 text-right">{totalLabel}</th>
                <th className="w-[17%] px-4 py-3 text-right text-[#159277]">
                  Paid
                </th>
                <th className="w-[17%] px-4 py-3 text-right text-[#d92d5c]">
                  Unpaid
                </th>
                <th className="w-[28%] px-5 py-3 text-right">Paid Rate</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td className="px-6 py-10 text-center text-[#667085]" colSpan={5}>
                    No months with more than 100 records.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr
                    key={row.reportMonth}
                    className="border-b border-[#f1f3f7] transition-colors hover:bg-[#f8fafc] last:border-b-0"
                  >
                    <td className="whitespace-nowrap px-5 py-3 text-sm font-semibold text-[#16233a]">
                      {formatReportMonth(row.reportMonth)}
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-[#667085]">
                      {formatInteger(row.total)}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-semibold text-[#159277]">
                      {formatInteger(row.paid)}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-semibold text-[#d92d5c]">
                      {formatInteger(row.unpaid)}
                    </td>
                    <td className="px-5 py-3">
                      <div className="ml-auto flex w-32 items-center justify-end">
                        <div className="relative h-6 w-full overflow-hidden rounded border border-[#d7f8ec] bg-[#e9fff6]">
                          <div
                            className="h-full rounded bg-[#8ee8c8]"
                            style={{ width: `${Math.min(row.paidRate, 100)}%` }}
                          />
                          <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-[#136852]">
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
  const trendClassName =
    changePercent === undefined || changePercent === null || changePercent === 0
      ? "text-[#667085]"
      : changePercent > 0
        ? "text-[#027a48]"
        : "text-[#c01048]";
  const footer = footerText ?? formatTrendText(changePercent ?? null);

  return (
    <article className="grid min-h-20 grid-rows-[1.35rem_2.35rem_1rem] items-center rounded-lg border border-[#d8dee7] bg-white px-3 py-2.5 text-center shadow-[0_1px_3px_rgba(22,35,58,0.06)]">
      <div className="self-start text-[11px] font-semibold uppercase leading-4 tracking-[0.03em] text-[#667085]">
        {label}
      </div>
      <div className="truncate text-[1.85rem] font-semibold leading-none text-[#16233a]">
        {value}
      </div>
      <div className={`truncate text-xs font-semibold ${trendClassName}`}>
        {footer}
      </div>
    </article>
  );
}

function normalizeAgentName(value: string) {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
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

function formatTrendText(value: number | null) {
  if (value === null) return "No previous month";

  const formatted = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  }).format(Math.abs(value));

  if (value > 0) return `Up ${formatted}% vs previous month`;
  if (value < 0) return `Down ${formatted}% vs previous month`;

  return "No change vs previous month";
}

function maxDateString(current: string | null, next: string | null) {
  if (!next) return current;
  if (!current) return next;

  return next > current ? next : current;
}
