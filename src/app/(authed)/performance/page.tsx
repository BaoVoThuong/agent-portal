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
  activePolicy: number;
  activeClient: number;
  totalCommissionYtd: number;
  averageCommissionByMonth: number;
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
  chartMonths: PerformanceMonth[];
  policyPaymentStatus: PaymentStatusMonth[];
  clientPaymentStatus: PaymentStatusMonth[];
};

const HEALTH_MART_PAGE_SIZE = 1000;
const CHART_MONTH_LIMIT = 12;
const CHART_MIN_POLICY_COUNT = 100;
const PAYMENT_STATUS_MONTH_LIMIT = 12;
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
              label="Active Policy"
              value={formatInteger(performanceData.scoreCards.activePolicy)}
              helper="Latest 2 report months"
            />
            <ScoreCard
              label="Active Client"
              value={formatInteger(performanceData.scoreCards.activeClient)}
              helper="Latest 2 report months"
            />
            <ScoreCard
              label="Total Commission YTD"
              value={formatCurrency(performanceData.scoreCards.totalCommissionYtd)}
              helper={`${new Date().getFullYear()} report year`}
            />
            <ScoreCard
              label="Average Commission / Month"
              value={formatCurrency(
                performanceData.scoreCards.averageCommissionByMonth
              )}
              helper="Months with more than 200 active policies"
            />
          </section>

          <PerformanceChart months={performanceData.chartMonths} />
          <PaymentStatusSection
            policyRows={performanceData.policyPaymentStatus}
            clientRows={performanceData.clientPaymentStatus}
          />
          <MemberPaymentTable rows={performanceData.memberPayments} />
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
    chartMonths: buildChartMonths(rows),
    policyPaymentStatus: buildPolicyPaymentStatus(rows),
    clientPaymentStatus: buildClientPaymentStatus(rows),
  };
}

function buildScoreCards(rows: HealthMartRow[]): ScoreCards {
  const currentYear = new Date().getFullYear();
  const latestReportMonths = [...new Set(rows.map((row) => row.report_month))]
    .sort()
    .reverse()
    .slice(0, 2);
  const latestRows = rows.filter((row) =>
    latestReportMonths.includes(row.report_month)
  );
  const activePolicy = new Set(
    latestRows
      .map((row) => row.primary_member_id)
      .filter((memberId): memberId is string => Boolean(memberId))
  ).size;
  const maxClientByMemberId = new Map<string, number>();

  for (const row of latestRows) {
    if (!row.primary_member_id) continue;
    maxClientByMemberId.set(
      row.primary_member_id,
      Math.max(maxClientByMemberId.get(row.primary_member_id) ?? 0, row.num_client ?? 0)
    );
  }

  const currentYearRows = rows.filter(
    (row) => new Date(`${row.report_month}T00:00:00`).getFullYear() === currentYear
  );
  const totalCommissionYtd = currentYearRows.reduce(
    (total, row) => total + (row.agent_received ?? 0),
    0
  );
  const monthlyData = new Map<
    string,
    { policyIds: Set<string>; agentReceived: number }
  >();

  for (const row of currentYearRows) {
    if (!row.report_month) continue;
    const current = monthlyData.get(row.report_month) ?? {
      policyIds: new Set<string>(),
      agentReceived: 0,
    };

    if (row.primary_member_id) current.policyIds.add(row.primary_member_id);
    current.agentReceived += row.agent_received ?? 0;
    monthlyData.set(row.report_month, current);
  }

  const qualifyingMonths = [...monthlyData.values()].filter(
    (month) => month.policyIds.size > 200
  );
  const averageCommissionByMonth =
    qualifyingMonths.length === 0
      ? 0
      : qualifyingMonths.reduce((total, month) => total + month.agentReceived, 0) /
        qualifyingMonths.length;

  return {
    activePolicy,
    activeClient: [...maxClientByMemberId.values()].reduce(
      (total, clients) => total + clients,
      0
    ),
    totalCommissionYtd,
    averageCommissionByMonth,
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
    <article className="overflow-hidden rounded-lg border border-[#d8dee7] bg-white shadow-[0_2px_8px_rgba(22,35,58,0.08)]">
      <header className="border-b border-[#edf0f4] px-6 py-5">
        <h2 className="text-lg font-semibold text-[#16233a]">{title}</h2>
      </header>
      <div className="overflow-x-auto">
        <table className="min-w-full table-fixed text-sm">
          <thead>
            <tr className="border-b border-[#edf0f4] text-left text-xs font-semibold uppercase tracking-wide text-[#667085]">
              <th className="w-[23%] px-6 py-4">Month</th>
              <th className="w-[18%] px-4 py-4 text-right">{totalLabel}</th>
              <th className="w-[18%] bg-[#f4fffb] px-4 py-4 text-right text-[#159277]">
                Paid
              </th>
              <th className="w-[18%] bg-[#fff7fa] px-4 py-4 text-right text-[#d92d5c]">
                Unpaid
              </th>
              <th className="w-[23%] px-6 py-4 text-right">Paid Rate</th>
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
                  className="border-b border-[#f1f3f7] last:border-b-0"
                >
                  <td className="px-6 py-5 text-base font-semibold text-[#16233a]">
                    {formatReportMonth(row.reportMonth)}
                  </td>
                  <td className="px-4 py-5 text-right text-base text-[#667085]">
                    {formatInteger(row.total)}
                  </td>
                  <td className="bg-[#f7fffc] px-4 py-5 text-right text-base font-semibold text-[#159277]">
                    {formatInteger(row.paid)}
                  </td>
                  <td className="bg-[#fff9fb] px-4 py-5 text-right text-base font-semibold text-[#d92d5c]">
                    {formatInteger(row.unpaid)}
                  </td>
                  <td className="px-6 py-5">
                    <div className="ml-auto flex w-36 items-center justify-end">
                      <div className="relative h-8 w-full overflow-hidden rounded-md border border-[#d7f8ec] bg-[#e9fff6]">
                        <div
                          className="h-full rounded-md bg-[#8ee8c8]"
                          style={{ width: `${Math.min(row.paidRate, 100)}%` }}
                        />
                        <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-[#136852]">
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
  );
}

function ScoreCard({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper: string;
}) {
  return (
    <article className="rounded-lg border border-[#d8dee7] bg-white p-6">
      <div className="text-sm font-medium text-[#667085]">{label}</div>
      <div className="mt-3 text-3xl font-semibold text-[#16233a]">{value}</div>
      <div className="mt-2 text-xs text-[#667085]">{helper}</div>
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

function maxDateString(current: string | null, next: string | null) {
  if (!next) return current;
  if (!current) return next;

  return next > current ? next : current;
}
