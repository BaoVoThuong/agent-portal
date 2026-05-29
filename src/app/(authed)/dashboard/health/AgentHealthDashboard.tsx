"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  AgentHealthDashboardContent,
} from "./AgentHealthDashboardFilterState";
import { AgentHealthCarrierMultiSelectFilter } from "./AgentHealthCarrierMultiSelectFilter";
import { AgentHealthMemberPaymentTable } from "./AgentHealthMemberPaymentTable";
import { AgentHealthDashboardTrendSection } from "./AgentHealthDashboardTrendSection";
import { AgentHealthReportMonthRangeFilter } from "./AgentHealthReportMonthRangeFilter";
import type { ChartLevel } from "./AgentHealthDashboardChart";
import type { ReportMonthDefaultConfig } from "../../_components/ReportMonthDefaultEditor";

export type HealthMartRow = {
  deal_name: string | null;
  carrier: string | null;
  state: string | null;
  primary_member_id: string | null;
  broker_effective_date: string | null;
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

type DashboardMonth = {
  periodKey: string;
  periodLabel: string;
  policyCount: number;
  clientCount: number;
  agentReceived: number;
};

type ChartPeriodsByLevel = Record<ChartLevel, DashboardMonth[]>;

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

type MemberPaymentRow = {
  dealName: string;
  carrier: string;
  primaryMemberId: string;
  totalPaid: number;
  months: {
    reportMonth: string;
    hasRecord: boolean;
    paid: number;
    paidToDate: string | null;
  }[];
};

type MemberPaymentSummary = {
  rows: MemberPaymentRow[];
  reportMonths: string[];
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

type DashboardData = {
  scoreCards: ScoreCards;
  memberPayments: MemberPaymentRow[];
  memberPaymentReportMonths: string[];
  chartPeriodsByLevel: ChartPeriodsByLevel;
  policyPaymentStatus: PaymentStatusMonth[];
  clientPaymentStatus: PaymentStatusMonth[];
  carrierPaymentStatus: CarrierPaymentStatusBreakdown;
  latestMonthMixBreakdown: LatestMonthMixBreakdown;
};

export type ReportMonthRange = {
  start: string | null;
  end: string | null;
};

type MonthlyDashboardSummary = {
  reportMonth: string;
  policyIds: Set<string>;
  maxClientByMemberId: Map<string, number>;
  agentReceived: number;
};

const CHART_MONTH_LIMIT = 12;
const CHART_QUARTER_LIMIT = 8;
const CHART_YEAR_LIMIT = 5;
const MEMBER_PAYMENT_REPORT_YEAR = "2026";
const MIX_BREAKDOWN_TOP_LIMIT = 5;
const PAID_RATE_VISIBLE_ROW_COUNT = 6;
const PAID_RATE_HEADER_HEIGHT_PX = 72;
const PAID_RATE_ROW_HEIGHT_PX = 64;
const PAID_RATE_TABLE_MAX_HEIGHT =
  PAID_RATE_HEADER_HEIGHT_PX + PAID_RATE_VISIBLE_ROW_COUNT * PAID_RATE_ROW_HEIGHT_PX;

export function AgentHealthDashboard({
  agentName,
  canViewAll,
  defaultConfig,
  initialChartLevel,
  reportMonthRange,
  rows,
  selectedCarriers,
  selectedPrimaryMemberId,
  viewSwitcher,
}: {
  agentName: string;
  canViewAll: boolean;
  defaultConfig: ReportMonthDefaultConfig;
  initialChartLevel: ChartLevel;
  reportMonthRange: ReportMonthRange;
  rows: HealthMartRow[] | null;
  selectedCarriers: string[];
  selectedPrimaryMemberId: string;
  viewSwitcher?: ReactNode;
}) {
  const [clientCarriers, setClientCarriers] = useState(selectedCarriers);
  const [clientPrimaryMemberId, setClientPrimaryMemberId] = useState(
    selectedPrimaryMemberId
  );
  const [draftPrimaryMemberId, setDraftPrimaryMemberId] = useState(
    selectedPrimaryMemberId
  );
  const carrierOptions = useMemo(
    () => buildCarrierOptions(rows ?? []),
    [rows]
  );
  const filteredRows = useMemo(
    () =>
      applyClientFilters(rows ?? [], {
        carriers: clientCarriers,
        primaryMemberId: clientPrimaryMemberId,
      }),
    [clientCarriers, clientPrimaryMemberId, rows]
  );
  const dashboardData = useMemo(
    () => (rows ? buildDashboardData(filteredRows) : null),
    [filteredRows, rows]
  );

  function updateClientCarriers(nextCarriers: string[]) {
    setClientCarriers(nextCarriers);
    syncClientFilterUrl({
      carriers: nextCarriers,
      primaryMemberId: clientPrimaryMemberId,
    });
  }

  function applyPrimaryMemberIdFilter() {
    const nextPrimaryMemberId = draftPrimaryMemberId.trim();

    setClientPrimaryMemberId(nextPrimaryMemberId);
    syncClientFilterUrl({
      carriers: clientCarriers,
      primaryMemberId: nextPrimaryMemberId,
    });
  }

  return (
    <div className="agent-health-dashboard min-h-screen bg-slate-50 px-6 py-8 font-sans text-slate-900 md:px-10">
      <div className="mx-auto max-w-[1536px]">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-6">
          <div>
            <h1 className="text-[28px] font-semibold leading-tight text-[#16233a]">
              Health Sales Dashboard
            </h1>
            <p className="mt-2 text-sm font-normal text-[#667085]">
              {canViewAll
                ? "Showing dashboard for all agents."
                : `Showing dashboard for ${agentName || "your account"}.`}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            {viewSwitcher}
            <AgentHealthReportMonthRangeFilter
              key={`${reportMonthRange.start ?? ""}:${reportMonthRange.end ?? ""}`}
              defaultConfig={defaultConfig}
              startDate={reportMonthRange.start}
              endDate={reportMonthRange.end}
            />
          </div>
        </header>
        <div className="mb-8 flex flex-wrap items-center justify-end gap-3">
          <AgentHealthCarrierMultiSelectFilter
            options={carrierOptions}
            onSelectedCarriersChange={updateClientCarriers}
            selectedCarriers={clientCarriers}
          />
          <label className="block w-[15rem] shrink-0">
            <span className="sr-only">Primary member id</span>
            <input
              aria-label="Primary member id"
              className="dashboard-filter-input"
              onBlur={applyPrimaryMemberIdFilter}
              onChange={(event) => setDraftPrimaryMemberId(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  applyPrimaryMemberIdFilter();
                }
              }}
              placeholder="Primary member id"
              type="search"
              value={draftPrimaryMemberId}
            />
          </label>
        </div>

        {!dashboardData ? (
          <div className="agent-health-panel px-8 py-16 text-center text-sm font-medium text-slate-500">
            Your account name is required to load dashboard data.
          </div>
        ) : (
          <AgentHealthDashboardContent>
            <div className="space-y-6">
              <section className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
                <ScoreCard
                  label="Latest Active Policies"
                  value={formatInteger(dashboardData.scoreCards.activePolicy.value)}
                  changePercent={
                    dashboardData.scoreCards.activePolicy.changePercent
                  }
                />
                <ScoreCard
                  label="Latest Active Clients"
                  value={formatInteger(dashboardData.scoreCards.activeClient.value)}
                  changePercent={
                    dashboardData.scoreCards.activeClient.changePercent
                  }
                />
                <ScoreCard
                  label="Latest Month Commission"
                  value={formatCurrency(
                    dashboardData.scoreCards.totalCommission.value
                  )}
                  changePercent={
                    dashboardData.scoreCards.totalCommission.changePercent
                  }
                />
                <ScoreCard
                  label={`${
                    dashboardData.scoreCards.totalCommissionInReportYear
                      .reportYear ?? "Report Year"
                  } Commission`}
                  value={formatCurrency(
                    dashboardData.scoreCards.totalCommissionInReportYear.value
                  )}
                  footerText={`Avg ${formatCurrency(
                    dashboardData.scoreCards.totalCommissionInReportYear
                      .averageMonthlyCommission
                  )} / month`}
                />
              </section>

              <AgentHealthDashboardTrendSection
                initialChartLevel={initialChartLevel}
                periodsByLevel={dashboardData.chartPeriodsByLevel}
              />
              <PaidRateOverviewSection
                policyRows={dashboardData.policyPaymentStatus}
                clientRows={dashboardData.clientPaymentStatus}
                reportMonth={dashboardData.carrierPaymentStatus.reportMonth}
                carrierPolicyRows={dashboardData.carrierPaymentStatus.policyRows}
                carrierClientRows={dashboardData.carrierPaymentStatus.clientRows}
              />
              <MixBreakdownSection
                reportMonth={dashboardData.latestMonthMixBreakdown.reportMonth}
                carrierRows={dashboardData.latestMonthMixBreakdown.carrierRows}
                stateRows={dashboardData.latestMonthMixBreakdown.stateRows}
              />
              <AgentHealthMemberPaymentTable
                rows={dashboardData.memberPayments}
                reportMonths={dashboardData.memberPaymentReportMonths}
              />
            </div>
          </AgentHealthDashboardContent>
        )}
      </div>
    </div>
  );
}

function buildDashboardData(rows: HealthMartRow[]): DashboardData {
  const filteredRows = rows.filter((row) => row.report_month);
  const eligibleRows = buildEligibleHealthRows(filteredRows);
  const monthlySummaries = buildMonthlyDashboardSummaries(eligibleRows);
  const memberPaymentSummary = buildMemberPaymentSummary(eligibleRows);

  return {
    scoreCards: buildScoreCards(monthlySummaries),
    memberPayments: memberPaymentSummary.rows,
    memberPaymentReportMonths: memberPaymentSummary.reportMonths,
    chartPeriodsByLevel: {
      month: buildChartPeriods(monthlySummaries, "month"),
      quarter: buildChartPeriods(monthlySummaries, "quarter"),
      year: buildChartPeriods(monthlySummaries, "year"),
    },
    policyPaymentStatus: buildPolicyPaymentStatus(eligibleRows),
    clientPaymentStatus: buildClientPaymentStatus(eligibleRows),
    carrierPaymentStatus: buildCarrierPaymentStatusBreakdown(
      eligibleRows,
      monthlySummaries
    ),
    latestMonthMixBreakdown: buildLatestMonthMixBreakdown(
      eligibleRows,
      monthlySummaries
    ),
  };
}

function buildEligibleHealthRows(rows: HealthMartRow[]) {
  const selectedRows = new Map<string, HealthMartRow>();

  for (const row of rows) {
    const reportMonth = getHealthMonthKey(row.report_month);
    const effectiveMonth = getHealthMonthKey(row.broker_effective_date);
    const primaryMemberId = row.primary_member_id?.trim().toUpperCase();

    if (!reportMonth || !effectiveMonth || !primaryMemberId) continue;
    if (effectiveMonth.localeCompare(reportMonth) > 0) continue;

    const key = `${reportMonth}\u001f${primaryMemberId}`;
    const current = selectedRows.get(key);

    if (!current || compareHealthEffectiveRow(row, current) > 0) {
      selectedRows.set(key, row);
    }
  }

  return [...selectedRows.values()];
}

function compareHealthEffectiveRow(a: HealthMartRow, b: HealthMartRow) {
  const aEffectiveDate = a.broker_effective_date?.trim() ?? "";
  const bEffectiveDate = b.broker_effective_date?.trim() ?? "";

  if (aEffectiveDate !== bEffectiveDate) {
    return aEffectiveDate.localeCompare(bEffectiveDate);
  }

  return (a.agent_received ?? 0) - (b.agent_received ?? 0);
}

function buildCarrierOptions(rows: HealthMartRow[]) {
  return [
    ...new Set(
      rows
        .map((row) => row.carrier?.trim())
        .filter((carrier): carrier is string => Boolean(carrier))
    ),
  ].sort((a, b) => a.localeCompare(b));
}

function applyClientFilters(
  rows: HealthMartRow[],
  filters: {
    carriers: string[];
    primaryMemberId: string;
  }
) {
  const primaryMemberId = filters.primaryMemberId.trim().toUpperCase();
  const carrierSet = new Set(filters.carriers);

  return rows.filter((row) => {
    if (
      filters.carriers.length > 0 &&
      !carrierSet.has(row.carrier?.trim() || "")
    ) {
      return false;
    }

    if (
      primaryMemberId &&
      !(row.primary_member_id?.trim() ?? "")
        .toUpperCase()
        .includes(primaryMemberId)
    ) {
      return false;
    }

    return true;
  });
}

function syncClientFilterUrl(filters: {
  carriers: string[];
  primaryMemberId: string;
}) {
  const params = new URLSearchParams(window.location.search);

  params.delete("carrier");
  params.delete("primaryMemberId");

  for (const carrier of filters.carriers) {
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

function buildMonthlyDashboardSummaries(
  rows: HealthMartRow[]
): MonthlyDashboardSummary[] {
  const monthlyData = new Map<string, MonthlyDashboardSummary>();

  for (const row of rows) {
    const reportMonth = getHealthMonthKey(row.report_month);
    if (!reportMonth) continue;

    const current = monthlyData.get(reportMonth) ?? {
      reportMonth,
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
    monthlyData.set(reportMonth, current);
  }

  return [...monthlyData.values()].sort((a, b) =>
    a.reportMonth.localeCompare(b.reportMonth)
  );
}

function buildScoreCards(
  monthlySummaries: MonthlyDashboardSummary[]
): ScoreCards {
  const qualifyingSummaries = monthlySummaries.filter(hasPolicies);
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

function toScoreCardSummary(summary: MonthlyDashboardSummary | undefined) {
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
  monthlySummaries: MonthlyDashboardSummary[]
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
    .filter(hasPolicies)
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
  monthlySummaries: MonthlyDashboardSummary[],
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
    .filter((month) => month.policyCount > 0)
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

function buildMemberPaymentSummary(rows: HealthMartRow[]): MemberPaymentSummary {
  const reportYearRows = rows.filter((row) =>
    row.report_month?.startsWith(`${MEMBER_PAYMENT_REPORT_YEAR}-`)
  );
  const reportMonths = [
    ...new Set(
      reportYearRows
        .map((row) => row.report_month?.slice(0, 7))
        .filter((reportMonth): reportMonth is string => Boolean(reportMonth))
    ),
  ].sort((a, b) => a.localeCompare(b));

  if (reportMonths.length === 0) {
    return {
      rows: [],
      reportMonths: [],
    };
  }

  const reportMonthIndex = new Map(
    reportMonths.map((reportMonth, index) => [reportMonth, index])
  );
  const rowsByMember = new Map<string, MemberPaymentRow>();

  for (const row of reportYearRows) {
    if (!row.report_month) continue;
    const reportMonth = row.report_month.slice(0, 7);
    const monthIndex = reportMonthIndex.get(reportMonth);
    if (monthIndex === undefined) continue;

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
        months: reportMonths.map((month) => ({
          reportMonth: month,
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
    reportMonths,
  };
}

function buildPolicyPaymentStatus(rows: HealthMartRow[]) {
  const monthlyMemberStatus = new Map<string, Map<string, boolean>>();

  for (const row of rows) {
    const reportMonth = getHealthMonthKey(row.report_month);
    if (!reportMonth || !row.primary_member_id) continue;

    const month = monthlyMemberStatus.get(reportMonth) ?? new Map<string, boolean>();
    const wasPaid = month.get(row.primary_member_id) ?? false;

    month.set(row.primary_member_id, wasPaid || Boolean(row.paid_to_date));
    monthlyMemberStatus.set(reportMonth, month);
  }

  return [...monthlyMemberStatus.entries()]
    .map(([reportMonth, memberStatus]) => {
      const paid = [...memberStatus.values()].filter(Boolean).length;
      const total = memberStatus.size;

      return toPaymentStatusMonth(reportMonth, total, paid);
    })
    .filter((month) => month.total > 0)
    .sort((a, b) => b.reportMonth.localeCompare(a.reportMonth));
}

function buildClientPaymentStatus(rows: HealthMartRow[]) {
  const monthlyStatus = new Map<string, { paid: number; unpaid: number }>();

  for (const row of rows) {
    const reportMonth = getHealthMonthKey(row.report_month);
    if (!reportMonth) continue;

    const current = monthlyStatus.get(reportMonth) ?? { paid: 0, unpaid: 0 };
    const clients = row.num_client ?? 0;

    if (row.paid_to_date) {
      current.paid += clients;
    } else {
      current.unpaid += clients;
    }

    monthlyStatus.set(reportMonth, current);
  }

  return [...monthlyStatus.entries()]
    .map(([reportMonth, status]) =>
      toPaymentStatusMonth(reportMonth, status.paid + status.unpaid, status.paid)
    )
    .filter((month) => month.total > 0)
    .sort((a, b) => b.reportMonth.localeCompare(a.reportMonth));
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
  monthlySummaries: MonthlyDashboardSummary[]
): CarrierPaymentStatusBreakdown {
  const latestCompleteMonth = monthlySummaries
    .filter(hasPolicies)
    .at(-1);

  if (!latestCompleteMonth) {
    return {
      reportMonth: null,
      policyRows: [],
      clientRows: [],
    };
  }

  return buildCarrierPaymentStatusRows(
    rows.filter(
      (row) => getHealthMonthKey(row.report_month) === latestCompleteMonth.reportMonth
    ),
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
  monthlySummaries: MonthlyDashboardSummary[]
): LatestMonthMixBreakdown {
  const latestCompleteMonth = monthlySummaries
    .filter(hasPolicies)
    .at(-1);

  if (!latestCompleteMonth) {
    return {
      reportMonth: null,
      carrierRows: [],
      stateRows: [],
    };
  }

  const monthRows = rows.filter(
    (row) => getHealthMonthKey(row.report_month) === latestCompleteMonth.reportMonth
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

function PaidRateOverviewSection({
  policyRows,
  clientRows,
  reportMonth,
  carrierPolicyRows,
  carrierClientRows,
}: {
  policyRows: PaymentStatusMonth[];
  clientRows: PaymentStatusMonth[];
  reportMonth: string | null;
  carrierPolicyRows: CarrierPaymentStatusRow[];
  carrierClientRows: CarrierPaymentStatusRow[];
}) {
  const monthRows = combinePaymentStatusMonths(policyRows, clientRows);
  const carrierRows = combineCarrierPaymentStatusRows(
    carrierPolicyRows,
    carrierClientRows
  );

  return (
    <section className="grid gap-5 xl:grid-cols-2">
      <CombinedPaymentStatusTable
        labelHeader="Month"
        rows={monthRows}
        title="Paid Rate | Recent Months"
      />
      <CombinedCarrierPaymentStatusTable
        reportMonth={reportMonth}
        rows={carrierRows}
        title="Carrier Paid Rate | Latest Complete Month"
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

function combinePaymentStatusMonths(
  policyRows: PaymentStatusMonth[],
  clientRows: PaymentStatusMonth[]
): CombinedPaymentStatusMonth[] {
  const rowMap = new Map<string, CombinedPaymentStatusMonth>();

  for (const row of policyRows) {
    rowMap.set(row.reportMonth, {
      reportMonth: row.reportMonth,
      policyTotal: row.total,
      policyPaid: row.paid,
      policyPaidRate: row.paidRate,
      clientTotal: 0,
      clientPaid: 0,
      clientPaidRate: 0,
    });
  }

  for (const row of clientRows) {
    const current =
      rowMap.get(row.reportMonth) ??
      ({
        reportMonth: row.reportMonth,
        policyTotal: 0,
        policyPaid: 0,
        policyPaidRate: 0,
        clientTotal: 0,
        clientPaid: 0,
        clientPaidRate: 0,
      } satisfies CombinedPaymentStatusMonth);

    current.clientTotal = row.total;
    current.clientPaid = row.paid;
    current.clientPaidRate = row.paidRate;
    rowMap.set(row.reportMonth, current);
  }

  return [...rowMap.values()]
    .sort((a, b) => b.reportMonth.localeCompare(a.reportMonth));
}

function combineCarrierPaymentStatusRows(
  policyRows: CarrierPaymentStatusRow[],
  clientRows: CarrierPaymentStatusRow[]
): CombinedCarrierPaymentStatusRow[] {
  const rowMap = new Map<string, CombinedCarrierPaymentStatusRow>();

  for (const row of policyRows) {
    rowMap.set(row.carrier, {
      carrier: row.carrier,
      policyTotal: row.total,
      policyPaid: row.paid,
      policyPaidRate: row.paidRate,
      clientTotal: 0,
      clientPaid: 0,
      clientPaidRate: 0,
    });
  }

  for (const row of clientRows) {
    const current =
      rowMap.get(row.carrier) ??
      ({
        carrier: row.carrier,
        policyTotal: 0,
        policyPaid: 0,
        policyPaidRate: 0,
        clientTotal: 0,
        clientPaid: 0,
        clientPaidRate: 0,
      } satisfies CombinedCarrierPaymentStatusRow);

    current.clientTotal = row.total;
    current.clientPaid = row.paid;
    current.clientPaidRate = row.paidRate;
    rowMap.set(row.carrier, current);
  }

  return [...rowMap.values()].sort(
    (a, b) =>
      b.policyTotal - a.policyTotal ||
      b.clientTotal - a.clientTotal ||
      b.policyPaidRate - a.policyPaidRate ||
      a.carrier.localeCompare(b.carrier)
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
                      {formatPercent(row.policyPaidRate)}
                    </td>
                    <td className="border-l border-[#edf0f4] px-2 py-3 text-right text-sm font-semibold text-emerald-600">
                      <PaidCountValue paid={row.clientPaid} total={row.clientTotal} />
                    </td>
                    <td className={getPaidRateCellClass(row.clientPaidRate, clientAveragePaidRate, "px-4")}>
                      {formatPercent(row.clientPaidRate)}
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
        <h2 className="text-xl font-semibold leading-tight text-[#16233a]">{title}</h2>
        {reportMonth ? (
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {formatReportMonth(reportMonth)}
          </span>
        ) : null}
      </div>
      <article className="agent-health-panel">
        <div className="overflow-hidden">
          <table className="w-full table-fixed text-[12px] tabular-nums">
            <colgroup>
              <col className="w-[24%]" />
              <col className="w-[14%]" />
              <col className="w-[14%]" />
              <col className="w-[21%]" />
              <col className="w-[27%]" />
            </colgroup>
            <thead>
              <tr className="border-b border-[#d8dee7] bg-[#f8fafc] text-left text-[10px] font-semibold uppercase tracking-normal text-[#667085]">
                <th className="border-r border-[#d8dee7] px-4 py-3.5">{labelHeader}</th>
                <th className="border-r border-[#d8dee7] px-2 py-3.5 text-right">Policies</th>
                <th className="border-r border-[#d8dee7] px-2 py-3.5 text-right">Clients</th>
                <th className="border-r border-[#d8dee7] px-3 py-3.5 text-right">Commission</th>
                <th className="px-3 py-3.5 text-center">% of Total</th>
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
                    className="group border-b border-[#edf0f4] transition-colors hover:bg-[#f8fafc] last:border-b-0"
                  >
                    <td className="break-words border-r border-[#edf0f4] px-4 py-3.5 font-semibold text-slate-900">
                      {row.label}
                    </td>
                    <td className="border-r border-[#edf0f4] px-2 py-3.5 text-right text-sm font-semibold text-slate-700">
                      {formatInteger(row.policyCount)}
                    </td>
                    <td className="border-r border-[#edf0f4] px-2 py-3.5 text-right text-sm font-semibold text-slate-700">
                      {formatInteger(row.clientCount)}
                    </td>
                    <td className="whitespace-nowrap border-r border-[#edf0f4] px-3 py-3.5 text-right font-semibold text-slate-900">
                      {formatCurrency(row.totalCommission)}
                    </td>
                    <td className="px-3 py-3.5 align-middle">
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
                      {formatPercent(row.policyPaidRate)}
                    </td>
                    <td className="border-l border-[#edf0f4] px-2 py-3 text-right text-sm font-semibold text-emerald-600">
                      <PaidCountValue paid={row.clientPaid} total={row.clientTotal} />
                    </td>
                    <td className={getPaidRateCellClass(row.clientPaidRate, clientAveragePaidRate, "px-4")}>
                      {formatPercent(row.clientPaidRate)}
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
    <article className="agent-health-panel-soft flex min-h-[124px] flex-col px-5 py-4 text-center">
      <div className="flex min-h-8 items-center justify-center text-[12px] font-semibold uppercase leading-snug text-slate-500">
        {label}
      </div>
      <div className="flex flex-1 items-center justify-center py-2">
        <div className="w-full break-words text-center text-[2rem] font-semibold leading-none text-slate-950 tabular-nums">
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

function sumMapValues(map: Map<string, number>) {
  let total = 0;

  for (const value of map.values()) {
    total += value;
  }

  return total;
}

function hasPolicies(summary: MonthlyDashboardSummary) {
  return summary.policyIds.size > 0;
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

function getHealthMonthKey(value: string | null | undefined) {
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
