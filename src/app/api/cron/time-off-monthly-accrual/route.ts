import { NextResponse } from "next/server";
import { checkCronAuthorization } from "@/lib/cron-auth";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

function centralMonthKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const value = new Map(parts.map((part) => [part.type, part.value]));
  return `${value.get("year")}-${value.get("month")}`;
}

/**
 * Runs daily shortly after midnight Central Time. The SQL routine is idempotent
 * per policy + month, so repeat calls or retries can never double-credit leave.
 */
export async function GET(request: Request) {
  const authResult = checkCronAuthorization(request);
  if (authResult === "misconfigured") return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  if (authResult === "unauthorized") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const month = centralMonthKey();
  const { data, error } = await getSupabaseAdmin().rpc("apply_time_off_monthly_accruals", {
    p_effective_month: `${month}-01`,
    p_actor_id: null,
  });
  if (error) return NextResponse.json({ error: error.message, month }, { status: 500 });
  return NextResponse.json({ ok: true, month, results: data ?? [] });
}
