import { NextResponse } from "next/server";
import { getTimeOffActor } from "@/lib/time-off/access";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const MONTH_KEY = /^20\d{2}-(0[1-9]|1[0-2])$/;

function responseError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function databaseMessage(message: string) {
  if (message.includes("TIME_OFF_INVALID_ADJUSTMENT")) return "Enter an adjustment between -366 and 366 days, excluding 0.";
  if (message.includes("TIME_OFF_INVALID_EFFECTIVE_MONTH")) return "Choose a valid month in the selected leave year.";
  if (message.includes("TIME_OFF_POLICY_NOT_ADJUSTABLE")) return "Only balance-tracked time-off types can be adjusted.";
  if (message.includes("TIME_OFF_ACCOUNT_NOT_FOUND")) return "That employee account is no longer active.";
  return message;
}

/** Managers credit or debit one employee's leave balance, retained by month for audit. */
export async function POST(request: Request) {
  const actor = await getTimeOffActor();
  if (!actor) return responseError("Unauthorized", 401);
  if (!actor.canManage) return responseError("Time Off Admin permission is required to manage leave balances.", 403);

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const accountId = typeof body?.account_id === "string" ? body.account_id.trim() : "";
  const policyCode = typeof body?.policy_code === "string" ? body.policy_code.trim() : "";
  const month = typeof body?.month === "string" ? body.month.trim() : "";
  const delta = typeof body?.delta_days === "number" ? body.delta_days : Number(body?.delta_days);
  const note = typeof body?.note === "string" ? body.note.trim() : "";
  const leaveYear = Number(month.slice(0, 4));

  if (!accountId || !policyCode || !MONTH_KEY.test(month)) {
    return responseError("Choose an employee, leave type, and effective month.");
  }
  if (!Number.isFinite(delta) || delta === 0 || delta < -366 || delta > 366) {
    return responseError("Enter a credit or debit between -366 and 366 days.");
  }
  if (Math.round(delta * 10) !== delta * 10) {
    return responseError("Adjustments can use at most one decimal place.");
  }
  if (note.length > 500) return responseError("Note must be 500 characters or fewer.");

  const { data, error } = await getSupabaseAdmin().rpc("adjust_time_off_balance", {
    p_account_id: accountId,
    p_policy_code: policyCode,
    p_leave_year: leaveYear,
    p_delta_days: delta,
    p_effective_month: `${month}-01`,
    p_note: note || null,
    p_actor_id: actor.accountId,
  });
  if (error) return responseError(databaseMessage(error.message), 400);
  return NextResponse.json({ adjustment: Array.isArray(data) ? data[0] : data });
}
