import { PERMISSIONS } from "@/lib/rbac/permissions";
import { can, canAny } from "@/lib/rbac/client";
import { requireAnyPermission } from "@/lib/rbac/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  DASHBOARD_FILTER_KEYS,
  fetchDashboardMonthDefault,
  resolveDashboardMonthDefaultRange,
} from "@/lib/dashboard-filter-defaults";
import {
  AgentHealthDashboard,
  type HealthMartRow,
  type ReportMonthRange,
} from "./AgentHealthDashboard";
import { AgentHealthDashboardFilterProvider } from "./AgentHealthDashboardFilterState";
import {
  DashboardViewSwitch,
  type DashboardView,
} from "../../_dashboard-shared/DashboardViewSwitch";
import { DashboardNavigationProvider } from "../../_dashboard-shared/DashboardNavigationState";
import { AiChatWidget } from "../../_dashboard-shared/AiChatWidget";
import HealthSalesDashboardPage from "../../sales-dashboard/health/page";

export const dynamic = "force-dynamic";

type DashboardPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type ChartLevel = "month" | "quarter" | "year";

const HEALTH_MART_PAGE_SIZE = 1000;
const HEALTH_DASHBOARD_PERMISSIONS = [
  PERMISSIONS.AGENT_DASHBOARD_HEALTH,
  PERMISSIONS.COMPANY_DASHBOARD_HEALTH,
];

export default async function DashboardPage({
  searchParams,
}: DashboardPageProps) {
  const params = searchParams ? await searchParams : {};
  const session = await requireAnyPermission(HEALTH_DASHBOARD_PERMISSIONS);
  const canViewAgent = can(session.user.permissions, PERMISSIONS.AGENT_DASHBOARD_HEALTH);
  const canViewSales = can(session.user.permissions, PERMISSIONS.COMPANY_DASHBOARD_HEALTH);
  const activeView = resolveDashboardView(
    parseDashboardView(params.view),
    canViewAgent,
    canViewSales
  );

  if (activeView === "sales") {
    return <HealthSalesDashboardPage searchParams={Promise.resolve(params)} />;
  }

  const monthDefaultConfig = await fetchDashboardMonthDefault(
    DASHBOARD_FILTER_KEYS.DASHBOARD_HEALTH
  );
  const defaultReportMonthRange =
    resolveDashboardMonthDefaultRange(monthDefaultConfig);
  const reportMonthRange = parseReportMonthRange(
    params,
    defaultReportMonthRange
  );
  const chartLevel = parseChartLevel(params.chartLevel);
  const canViewAll = can(session.user.permissions, PERMISSIONS.COMPANY_VIEW_ALL);
  const agentName = normalizeAgentName(session.user.name ?? "");
  const selectedCarriers = parseCarrierParams(params.carrier);
  const selectedPrimaryMemberId = parseRawParam(params.primaryMemberId);
  const canLoadDashboard = canViewAll || Boolean(agentName);
  const scopedAgentName = canViewAll ? null : agentName;
  const rows = canLoadDashboard
    ? await fetchHealthMartRows(scopedAgentName, reportMonthRange)
    : null;

  return (
    <DashboardNavigationProvider>
      <AgentHealthDashboardFilterProvider>
        <AgentHealthDashboard
          agentName={agentName}
          canViewAll={canViewAll}
          defaultConfig={monthDefaultConfig}
          initialChartLevel={chartLevel}
          reportMonthRange={reportMonthRange}
          rows={rows}
          selectedCarriers={selectedCarriers}
          selectedPrimaryMemberId={selectedPrimaryMemberId}
          viewSwitcher={
            <DashboardViewSwitch
              activeView="agent"
              basePath="/dashboard/health"
              canViewAgent={canViewAgent}
              canViewSales={canViewSales}
              key="dashboard-view-switch"
              searchParams={params}
            />
          }
        />
      </AgentHealthDashboardFilterProvider>
      <AiChatWidget context="health" scope="agent" />
    </DashboardNavigationProvider>
  );
}

function parseDashboardView(value: string | string[] | undefined) {
  const rawValue = parseRawParam(value);

  return rawValue === "agent" || rawValue === "sales" ? rawValue : null;
}

function resolveDashboardView(
  requestedView: DashboardView | null,
  canViewAgent: boolean,
  canViewSales: boolean
): DashboardView {
  if (requestedView === "agent" && canViewAgent) return "agent";
  if (requestedView === "sales" && canViewSales) return "sales";
  if (canViewAgent) return "agent";
  if (canViewSales) return "sales";
  return "agent";
}

async function fetchHealthMartRows(
  agentName: string | null,
  reportMonthRange: ReportMonthRange
) {
  const supabase = getSupabaseAdmin();
  const rows: HealthMartRow[] = [];

  for (let from = 0; ; from += HEALTH_MART_PAGE_SIZE) {
    let query = supabase
      .from("health_mart")
      .select(
        "deal_name,carrier,state,primary_member_id,broker_effective_date,report_month,paid_to_date,paid_to_date_raw,agent_received,num_client"
      )
      .order("report_month", { ascending: true })
      .range(from, from + HEALTH_MART_PAGE_SIZE - 1);

    if (agentName) {
      query = query.eq("agent", agentName);
    }

    if (reportMonthRange.start) {
      query = query.gte(
        "report_month",
        getReportMonthStart(reportMonthRange.start)
      );
    }

    if (reportMonthRange.end) {
      query = query.lte("report_month", reportMonthRange.end);
    }

    const { data, error } = await query;

    if (error) throw new Error(error.message);

    rows.push(...(((data ?? []) as unknown) as HealthMartRow[]));

    if (!data || data.length < HEALTH_MART_PAGE_SIZE) {
      return rows;
    }
  }
}

function normalizeAgentName(value: string) {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

function parseReportMonthRange(
  params: Record<string, string | string[] | undefined>,
  defaultRange: ReportMonthRange
): ReportMonthRange {
  if (parseRawParam(params.reportMonthRange) === "all") {
    return { start: null, end: null };
  }

  let start = parseReportMonthParam(params.start);
  let end = parseReportMonthParam(params.end);

  if (!start && !end) {
    start = parseReportMonthParam(defaultRange.start ?? undefined);
    end = parseReportMonthParam(defaultRange.end ?? undefined);
  }

  if (start && end && start.localeCompare(end) > 0) {
    [start, end] = [end, start];
  }

  return { start, end };
}

function parseRawParam(value: string | string[] | undefined) {
  const rawValue = Array.isArray(value) ? value[0] : value;

  return rawValue?.trim() ?? "";
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
  return value.slice(0, 7) + "-01";
}
