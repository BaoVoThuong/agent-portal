import {
  DASHBOARD_FILTER_KEYS,
  fetchDashboardMonthDefault,
  resolveDashboardMonthDefaultRange,
} from "@/lib/dashboard-filter-defaults";
import { canAny } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { requirePermission } from "@/lib/rbac/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { DashboardViewSwitch } from "../../dashboard/DashboardViewSwitch";
import {
  PcSalesDashboard,
  type FilterOptions,
  type FilterValues,
  type PcSalesRow,
} from "./PcSalesDashboard";
import { PcSalesHeaderFilters } from "./PcSalesDashboardFilters";

export const dynamic = "force-dynamic";

type PcSalesDashboardPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type ReportMonthRange = {
  start: string | null;
  end: string | null;
};

type TrendLevel = "month" | "quarter" | "year";

const PC_PAGE_SIZE = 1000;

export default async function PcSalesDashboardPage({
  searchParams,
}: PcSalesDashboardPageProps) {
  const session = await requirePermission(PERMISSIONS.SALES_DASHBOARD_ACCESS);
  const params = searchParams ? await searchParams : {};
  const canViewAgent = canAny(session.user.permissions, [
    PERMISSIONS.AGENT_DASHBOARD_PC_OWN,
    PERMISSIONS.AGENT_DASHBOARD_PC_ALL,
  ]);
  const monthDefaultConfig = await fetchDashboardMonthDefault(
    DASHBOARD_FILTER_KEYS.SALES_DASHBOARD_PC
  );
  const defaultReportMonthRange =
    resolveDashboardMonthDefaultRange(monthDefaultConfig);
  const filters = parseFilters(params, defaultReportMonthRange);
  const trendLevel = parseTrendLevel(params.trendLevel);
  const currentMonthKey = getCurrentMonthKey();
  const rows = await fetchPcSalesRows(filters.reportMonthRange, currentMonthKey);
  const filterOptions = buildFilterOptions(rows);

  return (
    <div className="min-h-screen bg-slate-50 px-6 py-8 md:px-10 text-slate-900">
      <div className="mx-auto max-w-[1536px]">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">
              P&amp;C Sales Dashboard
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              Overview of P&amp;C sales volume, agent commissions, and EPS metrics.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <DashboardViewSwitch
              activeView="sales"
              basePath="/dashboard/pc"
              canViewAgent={canViewAgent}
              canViewSales
              searchParams={params}
            />
            <PcSalesHeaderFilters
              defaultConfig={monthDefaultConfig}
              filters={filters}
            />
          </div>
        </header>

        <PcSalesDashboard
          key={`${filters.reportMonthRange.start ?? "all"}:${
            filters.reportMonthRange.end ?? "all"
          }`}
          filterOptions={filterOptions}
          filters={filters}
          initialTrendLevel={trendLevel}
          rows={rows}
        />
      </div>
    </div>
  );
}

async function fetchPcSalesRows(
  reportMonthRange: ReportMonthRange,
  maxMonthKey: string
) {
  const supabase = getSupabaseAdmin();
  const rows: PcSalesRow[] = [];
  const startMonth = dateToMonthKey(reportMonthRange.start);
  const requestedEndMonth = dateToMonthKey(reportMonthRange.end);
  const endMonth =
    requestedEndMonth && requestedEndMonth.localeCompare(maxMonthKey) < 0
      ? requestedEndMonth
      : maxMonthKey;

  for (let from = 0; ; from += PC_PAGE_SIZE) {
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

    if (startMonth) {
      query = query.gte("effective_date", monthValueToDate(startMonth));
    }

    if (endMonth) {
      query = query.lte("effective_date", monthValueToEndDate(endMonth));
    }

    const { data, error } = await query;

    if (error) throw new Error(error.message);

    rows.push(...(((data ?? []) as unknown) as PcSalesRow[]));

    if (!data || data.length < PC_PAGE_SIZE) {
      return rows;
    }
  }
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

function parseFilters(
  params: Record<string, string | string[] | undefined>,
  defaultReportMonthRange: ReportMonthRange
): FilterValues {
  return {
    agency: parseStringParam(params.agency),
    agent: parseStringParam(params.agent),
    policyNumber: parseStringParam(params.policyNumber),
    reportMonthRange: parseReportMonthRange(params, defaultReportMonthRange),
  };
}

function parseTrendLevel(value: string | string[] | undefined): TrendLevel {
  const rawValue = Array.isArray(value) ? value[0] : value;

  return rawValue === "quarter" || rawValue === "year" ? rawValue : "month";
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

function parseMonthDateParam(value: string | string[] | undefined) {
  const rawValue = parseStringParam(value);

  if (/^\d{4}-\d{2}$/.test(rawValue)) return monthValueToDate(rawValue);
  if (/^\d{4}-\d{2}-\d{2}$/.test(rawValue)) return rawValue;

  return null;
}

function getCurrentMonthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
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

function cleanGroupLabel(value: string | null) {
  const cleanValue = cleanText(value);

  return cleanValue || "null";
}

function cleanText(value: string | null) {
  return value?.trim() || "";
}

function uniqueSorted(values: string[]) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}
