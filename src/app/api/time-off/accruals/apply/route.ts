import { NextResponse } from "next/server";
import { getTimeOffActor } from "@/lib/time-off/access";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const MONTH_KEY = /^20\d{2}-(0[1-9]|1[0-2])$/;

function responseError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/** Admin-triggered, idempotent run for one calendar month. */
export async function POST(request: Request) {
  const actor = await getTimeOffActor();
  if (!actor) return responseError("Unauthorized", 401);
  if (!actor.canManage) return responseError("Time Off Admin permission is required to apply monthly accruals.", 403);

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const month = typeof body?.month === "string" ? body.month.trim() : "";
  if (!MONTH_KEY.test(month)) return responseError("Choose a valid month.");

  const { data, error } = await getSupabaseAdmin().rpc("apply_time_off_monthly_accruals", {
    p_effective_month: `${month}-01`,
    p_actor_id: actor.accountId,
  });
  if (error) return responseError(error.message, 400);
  return NextResponse.json({ results: data ?? [] });
}
