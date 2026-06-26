import { can } from "@/lib/rbac/client";
import {
  DASHBOARD_FILTER_KEYS,
  fetchDashboardMonthDefault,
  resolveDashboardMonthDefaultRange,
} from "@/lib/dashboard-filter-defaults";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { requireAnyPermission } from "@/lib/rbac/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  DashboardViewSwitch,
  type DashboardView,
} from "../../_dashboard-shared/DashboardViewSwitch";
import {
  DashboardNavigationContent,
  DashboardNavigationProvider,
} from "../../_dashboard-shared/DashboardNavigationState";
import { DashboardViewSkeleton } from "../../_dashboard-shared/DashboardViewSkeleton";
import { AiChatWidget } from "../../_dashboard-shared/AiChatWidget";
import {
  AgentPcDashboard,
  UNPAID_PAID_DATE_LABEL,
  type AgentPcFilterOptions,
  type AgentPcFilterValues,
  type AgentPcRow,
} from "./AgentPcDashboard";
import { PcSalesHeaderFilters } from "../../sales-dashboard/pc/PcSalesDashboardFilters";
import PcSalesDashboardPage from "../../sales-dashboard/pc/page";

export const dynamic = "force-dynamic";

type PcDashboardPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const PC_DASHBOARD_PERMISSIONS = [
  PERMISSIONS.AGENT_DASHBOARD_PC,
  PERMISSIONS.COMPANY_DASHBOARD_PC,
];
const PC_AGENT_PAGE_SIZE = 1000;
const EXPIRED_POLICY_MONTH_COUNT = 12;

type ReportMonthRange = {
  start: string | null;
  end: string | null;
};

export default async function PcDashboardPage({
  searchParams,
}: PcDashboardPageProps) {
  const params = searchParams ? await searchParams : {};
  const session = await requireAnyPermission(PC_DASHBOARD_PERMISSIONS);
  const canViewAgent = can(session.user.permissions, PERMISSIONS.AGENT_DASHBOARD_PC);
  const canViewSales = can(session.user.permissions, PERMISSIONS.COMPANY_DASHBOARD_PC);
  const canViewAllAgents = can(session.user.permissions, PERMISSIONS.COMPANY_VIEW_ALL);
  const activeView = resolveDashboardView(
    parseDashboardView(params.view),
    canViewAgent,
    canViewSales
  );

  if (activeView === "sales") {
    return <PcSalesDashboardPage searchParams={Promise.resolve(params)} />;
  }

  const monthDefaultConfig = await fetchDashboardMonthDefault(
    DASHBOARD_FILTER_KEYS.DASHBOARD_PC
  );
  const defaultReportMonthRange =
    resolveDashboardMonthDefaultRange(monthDefaultConfig);
  const reportMonthRange = parseReportMonthRange(
    params,
    defaultReportMonthRange
  );
  const agentName = normalizeAgentName(session.user.name ?? "");
  const scopedAgentName = canViewAllAgents ? null : agentName;
  const expiredPolicyWindow = getExpiredPolicyWindow();
  const rows = scopedAgentName || canViewAllAgents
    ? await fetchAgentPcRows(scopedAgentName, reportMonthRange)
    : null;
  const expiredRows = scopedAgentName || canViewAllAgents
    ? await fetchAgentPcExpiredRows(
        scopedAgentName,
        expiredPolicyWindow.startDate,
        expiredPolicyWindow.endDate
      )
    : [];
  const filters = parseFilters(params);
  const filterOptions = rows ? buildFilterOptions(rows) : emptyFilterOptions();

  return (
    <DashboardNavigationProvider>
      <div className="min-h-screen bg-slate-50 px-6 py-8 md:px-10 text-slate-900">
        <div className="mx-auto max-w-[1536px]">
          <header className="mb-6 flex flex-wrap items-start justify-between gap-6">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-slate-900">
                P&amp;C Sales Dashboard
              </h1>
              <p className="mt-2 text-sm text-slate-500">
                Agent-facing P&amp;C production, policies, and commission.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-3">
              <DashboardViewSwitch
                activeView="agent"
                basePath="/dashboard/pc"
                canViewAgent={canViewAgent}
                canViewSales={canViewSales}
                searchParams={params}
              />
              <PcSalesHeaderFilters
                defaultConfig={monthDefaultConfig}
                filters={{
                  agency: filters.agency,
                  agent: "",
                  policyNumber: filters.policyNumber,
                  paidProducer: [],
                  statementNumber: [],
                  reportMonthRange,
                }}
              />
            </div>
          </header>

          <DashboardNavigationContent fallback={<DashboardViewSkeleton />}>
            <AgentPcDashboard
              agentName={agentName}
              canViewAll={canViewAllAgents}
              filterOptions={filterOptions}
              filters={filters}
              expiredMonthKeys={expiredPolicyWindow.monthKeys}
              expiredRows={expiredRows}
              rows={rows}
            />
          </DashboardNavigationContent>
        </div>
      </div>
      <AiChatWidget context="pc" />
    </DashboardNavigationProvider>
  );
}

async function fetchAgentPcRows(
  agentName: string | null,
  reportMonthRange: ReportMonthRange
) {
  const supabase = getSupabaseAdmin();
  const rows: AgentPcRow[] = [];
  const startMonth = dateToMonthKey(reportMonthRange.start);
  const endMonth = dateToMonthKey(reportMonthRange.end);

  for (let from = 0; ; from += PC_AGENT_PAGE_SIZE) {
    let query = supabase
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
          "true_premium",
          "carrier_commission",
          "effective_date",
          "expired_date",
          "status",
          "paid_producer",
          "statement_number",
          "agent_commission_amount",
          "state",
          "city",
        ].join(",")
      )
      .order("effective_date", { ascending: false })
      .range(from, from + PC_AGENT_PAGE_SIZE - 1);

    if (agentName) {
      query = query.eq("agent_name", agentName);
    }

    if (startMonth) {
      query = query.gte("effective_date", monthValueToDate(startMonth));
    }

    if (endMonth) {
      query = query.lte("effective_date", monthValueToEndDate(endMonth));
    }

    const { data, error } = await query;

    if (error) throw new Error(error.message);

    rows.push(...(((data ?? []) as unknown) as AgentPcRow[]));

    if (!data || data.length < PC_AGENT_PAGE_SIZE) {
      return rows;
    }
  }
}

async function fetchAgentPcExpiredRows(
  agentName: string | null,
  startDate: string,
  endDate: string
) {
  const supabase = getSupabaseAdmin();
  const rows: AgentPcRow[] = [];

  for (let from = 0; ; from += PC_AGENT_PAGE_SIZE) {
    let query = supabase
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
          "true_premium",
          "carrier_commission",
          "effective_date",
          "expired_date",
          "status",
          "paid_producer",
          "statement_number",
          "agent_commission_amount",
        ].join(",")
      )
      .not("expired_date", "is", null)
      .gte("expired_date", startDate)
      .lte("expired_date", endDate)
      .order("expired_date", { ascending: true })
      .range(from, from + PC_AGENT_PAGE_SIZE - 1);

    if (agentName) {
      query = query.eq("agent_name", agentName);
    }

    const { data, error } = await query;

    if (error) throw new Error(error.message);

    rows.push(...(((data ?? []) as unknown) as AgentPcRow[]));

    if (!data || data.length < PC_AGENT_PAGE_SIZE) {
      return rows;
    }
  }
}

function buildFilterOptions(rows: AgentPcRow[]): AgentPcFilterOptions {
  return {
    agencies: uniqueSorted(
      rows
        .map((row) => cleanGroupLabel(row.agency_name))
        .filter((value) => value !== "null")
    ),
    paidDates: buildPaidDateOptions(rows),
  };
}

function buildPaidDateOptions(rows: AgentPcRow[]): string[] {
  const hasUnpaid = rows.some(
    (row) => cleanGroupLabel(row.paid_producer) === "null"
  );
  const dates = [
    ...new Set(
      rows
        .map((row) => cleanGroupLabel(row.paid_producer))
        .filter((value) => value !== "null")
    ),
  ].sort((a, b) => {
    const aTime = parseSortableDate(a);
    const bTime = parseSortableDate(b);

    if (aTime !== null && bTime !== null) {
      return bTime - aTime;
    }

    return b.localeCompare(a);
  });

  return hasUnpaid ? [UNPAID_PAID_DATE_LABEL, ...dates] : dates;
}

function parseSortableDate(value: string) {
  const mdy = value.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (mdy) {
    return Date.UTC(Number(mdy[3]), Number(mdy[1]) - 1, Number(mdy[2]));
  }

  const ymd = value.match(/^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})$/);
  if (ymd) {
    return Date.UTC(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
  }

  return null;
}

function emptyFilterOptions(): AgentPcFilterOptions {
  return {
    agencies: [],
    paidDates: [],
  };
}

function parseFilters(
  params: Record<string, string | string[] | undefined>
): AgentPcFilterValues {
  return {
    agency: parseStringParam(params.agency),
    paidDate: parseStringParam(params.paidDate),
    policyNumber: parseStringParam(params.policyNumber),
  };
}

function parseReportMonthRange(
  params: Record<string, string | string[] | undefined>,
  defaultRange: ReportMonthRange
): ReportMonthRange {
  if (parseStringParam(params.reportMonthRange) === "all") {
    return { start: null, end: null };
  }

  const start = parseMonthDateParam(params.start);
  const end = parseMonthDateParam(params.end);

  if (start || end) {
    return normalizeReportMonthRange({ start, end });
  }

  const legacyReportMonths = parseMonthListParam(params.reportMonth).sort();

  if (legacyReportMonths.length > 0) {
    return normalizeReportMonthRange({
      start: monthValueToDate(legacyReportMonths[0]),
      end: monthValueToDate(legacyReportMonths[legacyReportMonths.length - 1]),
    });
  }

  return normalizeReportMonthRange(defaultRange);
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

function parseMonthDateParam(value: string | string[] | undefined) {
  const rawValue = parseStringParam(value);

  if (/^\d{4}-\d{2}$/.test(rawValue)) return monthValueToDate(rawValue);
  if (/^\d{4}-\d{2}-\d{2}$/.test(rawValue)) return rawValue;

  return null;
}

function normalizeAgentName(value: string) {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

function cleanGroupLabel(value: string | null) {
  const cleanValue = value?.trim() ?? "";

  return cleanValue || "null";
}

function uniqueSorted(values: string[]) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}


function getExpiredPolicyWindow(date = new Date()) {
  const start = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 3, 1)
  );
  const end = new Date(
    Date.UTC(
      start.getUTCFullYear(),
      start.getUTCMonth() + EXPIRED_POLICY_MONTH_COUNT,
      0
    )
  );
  const monthKeys = Array.from(
    { length: EXPIRED_POLICY_MONTH_COUNT },
    (_, index) => {
      const monthDate = new Date(
        Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + index, 1)
      );

      return `${monthDate.getUTCFullYear()}-${String(
        monthDate.getUTCMonth() + 1
      ).padStart(2, "0")}`;
    }
  );

  return {
    endDate: end.toISOString().slice(0, 10),
    monthKeys,
    startDate: start.toISOString().slice(0, 10),
  };
}

function dateToMonthKey(value: string | null) {
  return value?.slice(0, 7) ?? "";
}

function monthValueToDate(value: string) {
  return `${value}-01`;
}

function monthValueToEndDate(value: string) {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));

  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

function parseDashboardView(value: string | string[] | undefined) {
  const rawValue = Array.isArray(value) ? value[0] : value;

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
