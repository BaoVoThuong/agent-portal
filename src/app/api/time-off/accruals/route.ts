import { NextResponse } from "next/server";
import { getTimeOffActor } from "@/lib/time-off/access";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const MONTH_KEY = /^20\d{2}-(0[1-9]|1[0-2])$/;

function responseError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function databaseMessage(message: string) {
  if (message.includes("TIME_OFF_INVALID_MONTHLY_CREDIT")) return "Enter a monthly credit between 0.1 and 31 days.";
  if (message.includes("TIME_OFF_INVALID_EFFECTIVE_MONTH")) return "Choose a valid start month.";
  if (message.includes("TIME_OFF_POLICY_NOT_ADJUSTABLE")) return "Only balance-tracked time-off types can receive monthly credits.";
  if (message.includes("TIME_OFF_ACCOUNT_NOT_FOUND")) return "Your account is no longer active.";
  return message;
}

/** Create, update, or pause a recurring monthly credit for every active employee. */
export async function POST(request: Request) {
  const actor = await getTimeOffActor();
  if (!actor) return responseError("Unauthorized", 401);
  if (!actor.canManage) return responseError("Time Off Admin permission is required to manage monthly accruals.", 403);

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const policyCode = typeof body?.policy_code === "string" ? body.policy_code.trim() : "";
  const startMonth = typeof body?.start_month === "string" ? body.start_month.trim() : "";
  const creditDays = typeof body?.credit_days === "number" ? body.credit_days : Number(body?.credit_days);
  const isActive = typeof body?.is_active === "boolean" ? body.is_active : true;

  if (!policyCode || !MONTH_KEY.test(startMonth)) {
    return responseError("Choose a leave type and a valid start month.");
  }
  if (!Number.isFinite(creditDays) || creditDays <= 0 || creditDays > 31 || Math.round(creditDays * 10) !== creditDays * 10) {
    return responseError("Enter a monthly credit between 0.1 and 31 days, with at most one decimal place.");
  }

  const { data, error } = await getSupabaseAdmin().rpc("configure_time_off_monthly_accrual", {
    p_policy_code: policyCode,
    p_credit_days: creditDays,
    p_start_month: `${startMonth}-01`,
    p_is_active: isActive,
    p_actor_id: actor.accountId,
  });
  if (error) return responseError(databaseMessage(error.message), 400);
  return NextResponse.json({ rule: Array.isArray(data) ? data[0] : data });
}
