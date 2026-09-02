import { NextResponse } from "next/server";
import { countLeaveBusinessDays, isDateKey } from "@/lib/time-off/business-days";
import { getTimeOffActor } from "@/lib/time-off/access";
import { getUsFederalHolidaysInRange } from "@/lib/time-off/us-holidays";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

function text(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= maxLength ? trimmed : null;
}

function error(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

async function availableDays(
  accountId: string,
  policyCode: string,
  year: number,
  defaultAllowance: number | null
): Promise<number | null> {
  if (defaultAllowance === null) return null;
  const supabase = getSupabaseAdmin();
  const [balanceResult, usedResult] = await Promise.all([
    supabase
      .from("time_off_balances")
      .select("entitlement_days,adjustment_days")
      .eq("account_id", accountId)
      .eq("policy_code", policyCode)
      .eq("leave_year", year)
      .maybeSingle(),
    supabase
      .from("time_off_requests")
      .select("total_days")
      .eq("requester_id", accountId)
      .eq("policy_code", policyCode)
      .eq("status", "approved")
      .gte("start_date", `${year}-01-01`)
      .lte("end_date", `${year}-12-31`),
  ]);
  if (balanceResult.error) throw new Error(balanceResult.error.message);
  if (usedResult.error) throw new Error(usedResult.error.message);
  const balance = balanceResult.data as {
    entitlement_days: number | null;
    adjustment_days: number | string;
  } | null;
  const used = ((usedResult.data ?? []) as { total_days: number | string }[])
    .reduce((sum, row) => sum + Number(row.total_days), 0);
  return Number(balance?.entitlement_days ?? defaultAllowance) + Number(balance?.adjustment_days ?? 0) - used;
}

/** Submit a leave request. The request starts pending and never mutates balance itself. */
export async function POST(request: Request) {
  const actor = await getTimeOffActor();
  if (!actor) return error("Unauthorized", 401);

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const policyCode = text(body?.policy_code, 60);
  const startDate = body?.start_date;
  const endDate = body?.end_date;
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (!policyCode) return error("Choose a time-off type.");
  if (!isDateKey(startDate) || !isDateKey(endDate) || startDate > endDate) {
    return error("Choose a valid start and end date.");
  }
  if (startDate.slice(0, 4) !== endDate.slice(0, 4)) {
    return error("For now, submit time off separately for each calendar year.");
  }
  if (reason.length > 1_000) return error("Reason must be 1,000 characters or fewer.");

  const supabase = getSupabaseAdmin();
  const { data: policy, error: policyError } = await supabase
    .from("time_off_policies")
    .select("code,annual_allowance,counts_toward_balance,is_active")
    .eq("code", policyCode)
    .eq("is_active", true)
    .maybeSingle();
  if (policyError) return error(policyError.message, 500);
  if (!policy) return error("This time-off type is no longer available.");

  const { data: companyHolidays, error: holidayError } = await supabase
    .from("time_off_holidays")
    .select("holiday_date")
    .gte("holiday_date", startDate)
    .lte("holiday_date", endDate);
  if (holidayError) return error(holidayError.message, 500);
  const holidayDates = new Set([
    ...getUsFederalHolidaysInRange(startDate, endDate).map((holiday) => holiday.date),
    ...((companyHolidays ?? []) as { holiday_date: string }[]).map((holiday) => holiday.holiday_date),
  ]);
  const totalDays = countLeaveBusinessDays(startDate, endDate, holidayDates);
  if (totalDays === 0) {
    return error("Those dates only contain weekends or company / US federal holidays.");
  }

  const { data: overlap, error: overlapError } = await supabase
    .from("time_off_requests")
    .select("id")
    .eq("requester_id", actor.accountId)
    .in("status", ["pending", "approved"])
    .lte("start_date", endDate)
    .gte("end_date", startDate)
    .limit(1);
  if (overlapError) return error(overlapError.message, 500);
  if ((overlap ?? []).length > 0) {
    return error("You already have a pending or approved request for part of this period.", 409);
  }

  if (policy.counts_toward_balance) {
    const balance = await availableDays(
      actor.accountId,
      policy.code,
      Number(startDate.slice(0, 4)),
      policy.annual_allowance === null ? null : Number(policy.annual_allowance)
    );
    if (balance !== null && totalDays > balance) {
      return error(`This request needs ${totalDays} days, but only ${balance} day(s) remain.`, 409);
    }
  }

  const { data, error: insertError } = await supabase
    .from("time_off_requests")
    .insert({
      requester_id: actor.accountId,
      policy_code: policy.code,
      start_date: startDate,
      end_date: endDate,
      total_days: totalDays,
      reason: reason || null,
    })
    .select("id,status,total_days")
    .single();
  if (insertError) return error(insertError.message, 500);
  return NextResponse.json({ request: data }, { status: 201 });
}
