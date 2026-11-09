import {
  DASHBOARD_FILTER_KEYS,
  fetchDashboardMonthDefault,
  resolveDashboardMonthDefaultRange,
} from "@/lib/dashboard-filter-defaults";
import { can } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { requirePermission } from "@/lib/rbac/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { DashboardViewSwitch } from "../../_dashboard-shared/DashboardViewSwitch";
import {
  DashboardNavigationContent,
  DashboardNavigationProvider,
} from "../../_dashboard-shared/DashboardNavigationState";
import { DashboardViewSkeleton } from "../../_dashboard-shared/DashboardViewSkeleton";
import { AiChatWidget } from "../../_dashboard-shared/AiChatWidget";
import {
  PcSalesDashboard,
  type FilterOptions,
  type FilterValues,
  type PcSalesRow,
} from "./PcSalesDashboard";
import { PcSalesHeaderFilters } from "./PcSalesDashboardFilters";
import { selectPcRowsInRange } from "./pc-sales-rows";

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
const PC_PAGE_CONCURRENCY = 3;
const EXPIRED_POLICY_MONTH_COUNT = 12;
const PC_SALES_ROW_SELECT = [
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
].join(",");

export default async function PcSalesDashboardPage({
  searchParams,
}: PcSalesDashboardPageProps) {
  const session = await requirePermission(PERMISSIONS.COMPANY_DASHBOARD_PC);
  const params = searchParams ? await searchParams : {};
  const canViewAgent = can(session.user.permissions, PERMISSIONS.AGENT_DASHBOARD_PC);
  const monthDefaultConfig = await fetchDashboardMonthDefault(
    DASHBOARD_FILTER_KEYS.COMPANY_DASHBOARD_PC
  );
  const defaultReportMonthRange =
    resolveDashboardMonthDefaultRange(monthDefaultConfig);
  const filters = parseFilters(params, defaultReportMonthRange);
  const trendLevel = parseTrendLevel(params.trendLevel);
  const currentMonthKey = getCurrentMonthKey();
  const expiredPolicyWindow = getExpiredPolicyWindow();
  const sourceRows = await fetchPcSourceRows();
  const filterOptions = buildFilterOptions(
    selectPcRowsInRange(sourceRows, filters.reportMonthRange, currentMonthKey)
  );

  return (
    <DashboardNavigationProvider>
      <div className="min-h-screen bg-slate-50 px-6 py-8 md:px-10 text-slate-900">
        <div className="mx-auto max-w-[1536px]">
          <header className="mb-6 flex flex-wrap items-start justify-between gap-6">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-slate-900">
                P&amp;C Sales Dashboard
              </h1>
              <p className="mt-2 text-sm text-slate-500 max-md:hidden">
                Overview of P&amp;C sales volume, agent commissions, and EPS
                metrics.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-3 max-md:justify-start max-md:[&>*]:w-full">
              <DashboardViewSwitch
                activeView="sales"
                basePath="/dashboard/pc"
                canViewAgent={canViewAgent}
                canViewSales
                searchParams={params}
              />
            </div>
          </header>

          <DashboardNavigationContent fallback={<DashboardViewSkeleton />}>
            <PcSalesDashboard
              key={`${filters.reportMonthRange.start ?? "all"}:${
                filters.reportMonthRange.end ?? "all"
              }`}
              currentMonthKey={currentMonthKey}
              monthFilter={
                <PcSalesHeaderFilters
                  defaultConfig={monthDefaultConfig}
                  filters={filters}
                />
              }
              expiredMonthKeys={expiredPolicyWindow.monthKeys}
              expiredWindow={{
                endDate: expiredPolicyWindow.endDate,
                startDate: expiredPolicyWindow.startDate,
              }}
              filterOptions={filterOptions}
              filters={filters}
              initialTrendLevel={trendLevel}
              sourceRows={sourceRows}
            />
          </DashboardNavigationContent>
        </div>
      </div>
      <AiChatWidget context="pc" scope="company" />
    </DashboardNavigationProvider>
  );
}

function selectPcPage(from: number) {
  return getSupabaseAdmin()
    .from("pc_mart")
    .select(PC_SALES_ROW_SELECT)
    .order("effective_date", { ascending: false })
    // effective_date trùng rất nhiều: thứ tự phải cố định thì các trang mới
    // không lặp hay sót dòng.
    .order("policy_number")
    .order("statement_number")
    .order("paid_producer")
    .order("type")
    .order("company")
    .range(from, from + PC_PAGE_SIZE - 1);
}

async function fetchPcSourceRows() {
  const firstPage = await selectPcPage(0);

  if (firstPage.error) throw new Error(firstPage.error.message);

  const rows = ((firstPage.data ?? []) as unknown) as PcSalesRow[];
  if (rows.length < PC_PAGE_SIZE) return rows;

  for (let from = PC_PAGE_SIZE; ; from += PC_PAGE_SIZE * PC_PAGE_CONCURRENCY) {
    const pages = await Promise.all(
      Array.from({ length: PC_PAGE_CONCURRENCY }, (_, index) =>
        selectPcPage(from + index * PC_PAGE_SIZE)
      )
    );

    for (const page of pages) {
      if (page.error) throw new Error(page.error.message);

      rows.push(...(((page.data ?? []) as unknown) as PcSalesRow[]));
    }

    // Trang cuối ngắn hơn page size; không cần query COUNT(*) trên toàn mart.
    if (pages.some((page) => (page.data?.length ?? 0) < PC_PAGE_SIZE)) {
      return rows;
    }
  }
}

const UNPAID_PRODUCER_LABEL = "Unpaid";

function buildPaidProducerOptions(rows: PcSalesRow[]) {
  const dates = uniqueSortedDesc(
    rows
      .map((row) => cleanGroupLabel(row.paid_producer))
      .filter((value) => value !== "null")
  );
  const hasUnpaid = rows.some(
    (row) => cleanGroupLabel(row.paid_producer) === "null"
  );

  return hasUnpaid ? [UNPAID_PRODUCER_LABEL, ...dates] : dates;
}

function buildFilterOptions(rows: PcSalesRow[]): FilterOptions {
  return {
    agencies: uniqueSorted(
      rows.map((row) => cleanGroupLabel(row.agency_name)).filter((value) => value !== "null")
    ),
    agents: uniqueSorted(
      rows.map((row) => cleanGroupLabel(row.agent_name)).filter((value) => value !== "null")
    ),
    paidProducers: buildPaidProducerOptions(rows),
    statementNumbers: uniqueSortedDesc(
      rows.map((row) => cleanGroupLabel(row.statement_number)).filter((value) => value !== "null")
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
    paidProducer: parseStringListParam(params.paidProducer),
    statementNumber: parseStringListParam(params.statementNumber),
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

function uniqueSortedDesc(values: string[]) {
  return [...new Set(values)].sort((a, b) => {
    const aTime = parseSortableDate(a);
    const bTime = parseSortableDate(b);

    if (aTime !== null && bTime !== null) {
      return bTime - aTime;
    }

    return b.localeCompare(a);
  });
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
