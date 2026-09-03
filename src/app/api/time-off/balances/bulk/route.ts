import { NextResponse } from "next/server";
import { getTimeOffActor } from "@/lib/time-off/access";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const MONTH_KEY = /^20\d{2}-(0[1-9]|1[0-2])$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function responseError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function databaseMessage(message: string) {
  if (message.includes("TIME_OFF_INVALID_ADJUSTMENT")) return "Enter a credit or debit between -366 and 366 days, excluding 0.";
  if (message.includes("TIME_OFF_INVALID_EFFECTIVE_MONTH")) return "Choose a valid month in the selected leave year.";
  if (message.includes("TIME_OFF_POLICY_NOT_ADJUSTABLE")) return "Only balance-tracked time-off types can be adjusted.";
  if (message.includes("TIME_OFF_IDEMPOTENCY_KEY_REQUIRED")) return "Unable to safely create the team adjustment. Try again.";
  return message;
}

/** One deliberate, audited adjustment for every active employee. */
export async function POST(request: Request) {
  const actor = await getTimeOffActor();
  if (!actor) return responseError("Unauthorized", 401);
  if (!actor.canManage) return responseError("Time Off Admin permission is required to adjust team balances.", 403);

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const policyCode = typeof body?.policy_code === "string" ? body.policy_code.trim() : "";
  const month = typeof body?.month === "string" ? body.month.trim() : "";
  const delta = typeof body?.delta_days === "number" ? body.delta_days : Number(body?.delta_days);
  const note = typeof body?.note === "string" ? body.note.trim() : "";
  const idempotencyKey = typeof body?.idempotency_key === "string" ? body.idempotency_key.trim() : "";
  const leaveYear = Number(month.slice(0, 4));

  if (!policyCode || !MONTH_KEY.test(month) || !UUID.test(idempotencyKey)) {
    return responseError("Choose a leave type and month, then try again.");
  }
  if (!Number.isFinite(delta) || delta === 0 || delta < -366 || delta > 366 || Math.round(delta * 10) !== delta * 10) {
    return responseError("Enter a credit or debit between -366 and 366 days, excluding 0, with at most one decimal place.");
  }
  if (note.length > 500) return responseError("Note must be 500 characters or fewer.");

  const { data, error } = await getSupabaseAdmin().rpc("bulk_adjust_time_off_balances", {
    p_policy_code: policyCode,
    p_leave_year: leaveYear,
    p_delta_days: delta,
    p_effective_month: `${month}-01`,
    p_note: note || null,
    p_actor_id: actor.accountId,
    p_idempotency_key: idempotencyKey,
  });
  if (error) return responseError(databaseMessage(error.message), 400);
  return NextResponse.json({ adjustment: Array.isArray(data) ? data[0] : data });
}
