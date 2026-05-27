import { getSupabaseAdmin } from "@/lib/supabase";

export const DASHBOARD_FILTER_KEYS = {
  AGENT_DASHBOARD_HEALTH: "agent_dashboard_health",
  SALES_DASHBOARD_HEALTH: "sales_dashboard_health",
  SALES_DASHBOARD_PC: "sales_dashboard_pc",
} as const;

export type DashboardFilterKey =
  (typeof DASHBOARD_FILTER_KEYS)[keyof typeof DASHBOARD_FILTER_KEYS];

export type DashboardMonthDefaultType =
  | "all"
  | "current_year"
  | "fixed_range"
  | "latest_n_months";

export type ReportMonthRange = {
  start: string | null;
  end: string | null;
};

export type DashboardMonthRangeDefault = {
  dashboardKey: DashboardFilterKey;
  defaultType: DashboardMonthDefaultType;
  start: string | null;
  end: string | null;
  rollingMonths: number | null;
};

type DashboardDefaultRow = {
  dashboard_key: string;
  default_type: DashboardMonthDefaultType | null;
  start_month: string | null;
  end_month: string | null;
  rolling_months: number | null;
};

const REPORT_MONTH_FILTER_KEY = "report_month_range";
const FALLBACK_ROLLING_MONTHS = 12;

export function fallbackDashboardMonthDefault(
  dashboardKey: DashboardFilterKey
): DashboardMonthRangeDefault {
  return {
    dashboardKey,
    defaultType: "latest_n_months",
    start: null,
    end: null,
    rollingMonths: FALLBACK_ROLLING_MONTHS,
  };
}

export async function fetchDashboardMonthDefault(
  dashboardKey: DashboardFilterKey
): Promise<DashboardMonthRangeDefault> {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("dashboard_filter_defaults")
      .select("dashboard_key,default_type,start_month,end_month,rolling_months")
      .eq("dashboard_key", dashboardKey)
      .eq("filter_key", REPORT_MONTH_FILTER_KEY)
      .maybeSingle();

    if (error || !data) {
      return fallbackDashboardMonthDefault(dashboardKey);
    }

    return normalizeDashboardMonthDefault(dashboardKey, data as DashboardDefaultRow);
  } catch {
    return fallbackDashboardMonthDefault(dashboardKey);
  }
}

export function resolveDashboardMonthDefaultRange(
  defaultConfig: DashboardMonthRangeDefault,
  date = new Date()
): ReportMonthRange {
  if (defaultConfig.defaultType === "all") {
    return { start: null, end: null };
  }

  if (defaultConfig.defaultType === "fixed_range") {
    return normalizeReportMonthRange({
      start: normalizeMonthDate(defaultConfig.start),
      end: normalizeMonthDate(defaultConfig.end),
    });
  }

  const currentMonth = dateToMonthValue(date);

  if (defaultConfig.defaultType === "current_year") {
    return {
      start: `${currentMonth.slice(0, 4)}-01-01`,
      end: monthValueToDate(currentMonth),
    };
  }

  const rollingMonths = Math.max(defaultConfig.rollingMonths ?? FALLBACK_ROLLING_MONTHS, 1);
  const startMonth = addMonths(currentMonth, -(rollingMonths - 1));

  return {
    start: monthValueToDate(startMonth),
    end: monthValueToDate(currentMonth),
  };
}

export function normalizeReportMonthRange(range: ReportMonthRange): ReportMonthRange {
  const startMonth = dateToMonthKey(range.start);
  const endMonth = dateToMonthKey(range.end);

  if (startMonth && endMonth && startMonth.localeCompare(endMonth) > 0) {
    return {
      start: monthValueToDate(endMonth),
      end: monthValueToDate(startMonth),
    };
  }

  return {
    start: startMonth ? monthValueToDate(startMonth) : null,
    end: endMonth ? monthValueToDate(endMonth) : null,
  };
}

export function normalizeMonthDate(value: string | null | undefined) {
  if (!value) return null;
  if (/^\d{4}-\d{2}$/.test(value)) return monthValueToDate(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return monthValueToDate(value.slice(0, 7));

  return null;
}

export function dateToMonthKey(value: string | null) {
  return value?.slice(0, 7) ?? "";
}

export function monthValueToDate(value: string) {
  return `${value}-01`;
}

function normalizeDashboardMonthDefault(
  dashboardKey: DashboardFilterKey,
  row: DashboardDefaultRow
): DashboardMonthRangeDefault {
  const defaultType = isDashboardMonthDefaultType(row.default_type)
    ? row.default_type
    : "latest_n_months";

  return {
    dashboardKey,
    defaultType,
    start: normalizeMonthDate(row.start_month),
    end: normalizeMonthDate(row.end_month),
    rollingMonths:
      Number.isInteger(row.rolling_months) && row.rolling_months
        ? row.rolling_months
        : FALLBACK_ROLLING_MONTHS,
  };
}

function isDashboardMonthDefaultType(
  value: string | null
): value is DashboardMonthDefaultType {
  return (
    value === "all" ||
    value === "current_year" ||
    value === "fixed_range" ||
    value === "latest_n_months"
  );
}

function dateToMonthValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function addMonths(monthValue: string, amount: number) {
  const year = Number(monthValue.slice(0, 4));
  const monthIndex = Number(monthValue.slice(5, 7)) - 1;
  const date = new Date(year, monthIndex + amount, 1);

  return dateToMonthValue(date);
}
