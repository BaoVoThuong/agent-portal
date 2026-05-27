import {
  DASHBOARD_FILTER_KEYS,
  fetchDashboardMonthDefault,
  resolveDashboardMonthDefaultRange,
} from "@/lib/dashboard-filter-defaults";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { requirePermission } from "@/lib/rbac/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { HealthSalesHeaderFilters } from "./HealthSalesDashboardFilters";
import { HealthSalesDashboard } from "./HealthSalesDashboard";
import { type TrendComparisonChartLevel } from "./HealthSalesTrendComparisonChart";

export const dynamic = "force-dynamic";

type HealthSalesDashboardPageProps = {
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

type ReportMonthRange = {
  start: string | null;
  end: string | null;
};

type FilterValues = {
  agent: string[];
  carrier: string[];
  reportMonthRange: ReportMonthRange;
  messerStatement: string[];
  primaryMemberId: string;
};

type FilterOptions = {
  agents: string[];
  carriers: string[];
};

const HEALTH_SALES_PAGE_SIZE = 1000;

export default async function HealthSalesDashboardPage({
  searchParams,
}: HealthSalesDashboardPageProps) {
  await requirePermission(PERMISSIONS.SALES_DASHBOARD_ACCESS);

  const params = searchParams ? await searchParams : {};
  const monthDefaultConfig = await fetchDashboardMonthDefault(
    DASHBOARD_FILTER_KEYS.SALES_DASHBOARD_HEALTH
  );
  const defaultReportMonthRange =
    resolveDashboardMonthDefaultRange(monthDefaultConfig);
  const filters = parseFilters(params, defaultReportMonthRange);
  const trendLevel = parseTrendLevel(params.trendLevel);
  const allRows = await fetchHealthSalesRows();
  const reportMonthRows = applyReportMonthRangeFilter(
    allRows,
    filters.reportMonthRange
  );
  const filterOptions = buildFilterOptions(reportMonthRows);

  return (
    <div className="min-h-screen bg-slate-50 px-6 py-8 text-slate-900 md:px-10">
      <div className="mx-auto max-w-[1536px]">
        <header className="mb-8 flex flex-wrap items-start justify-between gap-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">
              Health Sales Dashboard
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              Overview of sales volume, agent commissions, and EPS metrics.
            </p>
          </div>
          <HealthSalesHeaderFilters
            defaultConfig={monthDefaultConfig}
            filters={filters}
          />
        </header>

        <HealthSalesDashboard
          key={`${filters.reportMonthRange.start ?? "all"}:${
            filters.reportMonthRange.end ?? "all"
          }`}
          filterOptions={filterOptions}
          filters={filters}
          initialTrendLevel={trendLevel}
          rows={reportMonthRows}
        />
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

function buildFilterOptions(rows: HealthSalesRow[]): FilterOptions {
  return {
    agents: uniqueSorted(
      rows.map((row) => cleanGroupLabel(row.agent)).filter((value) => value !== "null")
    ),
    carriers: uniqueSorted(
      rows
        .map((row) => cleanGroupLabel(row.carrier))
        .filter((value) => value !== "null")
    ),
  };
}

function applyReportMonthRangeFilter(
  rows: HealthSalesRow[],
  reportMonthRange: ReportMonthRange
) {
  const startMonth = dateToMonthKey(reportMonthRange.start);
  const endMonth = dateToMonthKey(reportMonthRange.end);

  if (!startMonth && !endMonth) {
    return rows;
  }

  return rows.filter((row) => {
    const rowMonth = getMonthKey(row.report_month);

    if (!rowMonth) return false;
    if (startMonth && rowMonth.localeCompare(startMonth) < 0) return false;
    if (endMonth && rowMonth.localeCompare(endMonth) > 0) return false;

    return true;
  });
}

function parseFilters(
  params: Record<string, string | string[] | undefined>,
  defaultReportMonthRange: ReportMonthRange
): FilterValues {
  return {
    agent: parseStringListParam(params.agent),
    carrier: parseStringListParam(params.carrier),
    reportMonthRange: parseReportMonthRange(params, defaultReportMonthRange),
    messerStatement: parseStringListParam(params.messerStatement),
    primaryMemberId: parseStringParam(params.primaryMemberId),
  };
}

function parseTrendLevel(value: string | string[] | undefined): TrendComparisonChartLevel {
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

  if (legacyReportMonths.length === 0) {
    return normalizeReportMonthRange(defaultRange);
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

function getMonthKey(value: string | null) {
  return value?.slice(0, 7) ?? "";
}

function dateToMonthKey(value: string | null) {
  return value?.slice(0, 7) ?? "";
}

function monthValueToDate(value: string) {
  return `${value}-01`;
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
