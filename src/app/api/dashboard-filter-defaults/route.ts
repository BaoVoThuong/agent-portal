import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  DASHBOARD_FILTER_KEYS,
  type DashboardFilterKey,
  type DashboardMonthDefaultType,
  normalizeMonthDate,
  normalizeReportMonthRange,
} from "@/lib/dashboard-filter-defaults";
import { can } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { getSupabaseAdmin } from "@/lib/supabase";

type Payload = {
  dashboardKey?: unknown;
  defaultType?: unknown;
  start?: unknown;
  end?: unknown;
  rollingMonths?: unknown;
};

const REPORT_MONTH_FILTER_KEY = "report_month_range";

export async function PATCH(req: Request) {
  const session = await auth();
  const permissions = session?.user?.permissions ?? [];

  try {
    const payload = normalizePayload((await req.json()) as Payload);

    if (!canEditDashboardDefault(permissions, payload.dashboardKey)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("dashboard_filter_defaults")
      .upsert(
        {
          dashboard_key: payload.dashboardKey,
          filter_key: REPORT_MONTH_FILTER_KEY,
          default_type: payload.defaultType,
          start_month: payload.start,
          end_month: payload.end,
          rolling_months: payload.rollingMonths,
          updated_by: session?.user?.email ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "dashboard_key,filter_key" }
      )
      .select("dashboard_key,default_type,start_month,end_month,rolling_months")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      defaultConfig: {
        dashboardKey: data.dashboard_key,
        defaultType: data.default_type,
        start: data.start_month,
        end: data.end_month,
        rollingMonths: data.rolling_months,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unable to update default." },
      { status: 400 }
    );
  }
}

function normalizePayload(payload: Payload) {
  const dashboardKey = parseDashboardKey(payload.dashboardKey);
  const defaultType = parseDefaultType(payload.defaultType);
  const rollingMonths = parseRollingMonths(payload.rollingMonths);
  const range = normalizeReportMonthRange({
    start: normalizeMonthDate(asString(payload.start)),
    end: normalizeMonthDate(asString(payload.end)),
  });

  if (defaultType === "fixed_range" && !range.start && !range.end) {
    throw new Error("Select at least one month for a fixed default.");
  }

  return {
    dashboardKey,
    defaultType,
    start: defaultType === "fixed_range" ? range.start : null,
    end: defaultType === "fixed_range" ? range.end : null,
    rollingMonths: defaultType === "latest_n_months" ? rollingMonths : null,
  };
}

function parseDashboardKey(value: unknown): DashboardFilterKey {
  if (
    value === DASHBOARD_FILTER_KEYS.DASHBOARD_HEALTH ||
    value === DASHBOARD_FILTER_KEYS.DASHBOARD_PC ||
    value === DASHBOARD_FILTER_KEYS.COMPANY_DASHBOARD_HEALTH ||
    value === DASHBOARD_FILTER_KEYS.COMPANY_DASHBOARD_PC
  ) {
    return value;
  }

  throw new Error("Invalid dashboard key.");
}

function parseDefaultType(value: unknown): DashboardMonthDefaultType {
  if (
    value === "all" ||
    value === "current_year" ||
    value === "fixed_range" ||
    value === "latest_n_months"
  ) {
    return value;
  }

  throw new Error("Invalid default type.");
}

function parseRollingMonths(value: unknown) {
  const numberValue = typeof value === "number" ? value : Number(value);

  if (!Number.isInteger(numberValue) || numberValue < 1 || numberValue > 120) {
    return 12;
  }

  return numberValue;
}

function canEditDashboardDefault(
  permissions: string[],
  dashboardKey: DashboardFilterKey
) {
  if (can(permissions, PERMISSIONS.ROLE_MANAGER)) return true;

  if (dashboardKey === DASHBOARD_FILTER_KEYS.COMPANY_DASHBOARD_HEALTH) {
    return can(permissions, PERMISSIONS.COMPANY_DASHBOARD_HEALTH);
  }

  if (dashboardKey === DASHBOARD_FILTER_KEYS.COMPANY_DASHBOARD_PC) {
    return can(permissions, PERMISSIONS.COMPANY_DASHBOARD_PC);
  }

  // Agent dashboard defaults — only managers (company.view_all) or role_manager can edit
  return can(permissions, PERMISSIONS.COMPANY_VIEW_ALL);
}

function asString(value: unknown) {
  return typeof value === "string" && value ? value : null;
}
