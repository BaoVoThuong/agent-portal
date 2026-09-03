import { NextResponse } from "next/server";
import { getTimeOffActor } from "@/lib/time-off/access";
import { monthBounds } from "@/lib/time-off/business-days";
import type { TimeOffCalendarEvent, TimeOffHoliday } from "@/lib/time-off/types";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getUsFederalHolidaysInRange } from "@/lib/time-off/us-holidays";

export const dynamic = "force-dynamic";

type RequestRow = {
  id: string;
  policy_code: string;
  start_date: string;
  end_date: string;
};

/** A small month-only endpoint used by the calendar navigator and its cache. */
export async function GET(request: Request) {
  const actor = await getTimeOffActor();
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const month = url.searchParams.get("month") ?? "";
  const year = url.searchParams.get("year") ?? "";
  const monthBoundsValue = monthBounds(month);
  const isYearRequest = !monthBoundsValue && /^20\d{2}$/.test(year);
  const bounds = monthBoundsValue ?? (isYearRequest ? { start: `${year}-01-01`, end: `${year}-12-31` } : null);
  if (!bounds) return NextResponse.json({ error: "Invalid calendar month." }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const [holidaysResult, requestsResult] = await Promise.all([
    supabase
      .from("time_off_holidays")
      .select("id,holiday_date,name")
      .gte("holiday_date", bounds.start)
      .lte("holiday_date", bounds.end)
      .order("holiday_date"),
    supabase
      .from("time_off_requests")
      .select("id,policy_code,start_date,end_date")
      .eq("requester_id", actor.accountId)
      .eq("status", "approved")
      .lte("start_date", bounds.end)
      .gte("end_date", bounds.start)
      .order("start_date"),
  ]);
  if (holidaysResult.error) return NextResponse.json({ error: holidaysResult.error.message }, { status: 500 });
  if (requestsResult.error) return NextResponse.json({ error: requestsResult.error.message }, { status: 500 });

  const requestRows = (requestsResult.data ?? []) as RequestRow[];
  const holidaysByDate = new Map<string, TimeOffHoliday>();
  for (const holiday of [
    ...getUsFederalHolidaysInRange(bounds.start, bounds.end),
    ...((holidaysResult.data ?? []) as { id: string; holiday_date: string; name: string }[]).map((holiday) => ({
      id: holiday.id,
      date: holiday.holiday_date,
      name: holiday.name,
      source: "company" as const,
    })),
  ]) holidaysByDate.set(holiday.date, holiday);

  const calendarRequests: TimeOffCalendarEvent[] = requestRows.map((row) => ({
    id: row.id,
    policy_code: row.policy_code,
    start_date: row.start_date,
    end_date: row.end_date,
  }));

  const holidays = [...holidaysByDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  if (isYearRequest) {
    return NextResponse.json({
      calendars: Array.from({ length: 12 }, (_, index) => {
        const calendarMonth = `${year}-${String(index + 1).padStart(2, "0")}`;
        const calendarBounds = monthBounds(calendarMonth)!;
        return {
          month: calendarMonth,
          holidays: holidays.filter((holiday) => holiday.date >= calendarBounds.start && holiday.date <= calendarBounds.end),
          calendar_requests: calendarRequests.filter((item) => item.start_date <= calendarBounds.end && item.end_date >= calendarBounds.start),
        };
      }),
    });
  }

  return NextResponse.json({ month, holidays, calendar_requests: calendarRequests });
}
