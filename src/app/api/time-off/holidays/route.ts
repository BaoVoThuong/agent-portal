import { NextResponse } from "next/server";
import { isDateKey } from "@/lib/time-off/business-days";
import { getTimeOffActor } from "@/lib/time-off/access";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getUsFederalHolidaysInRange } from "@/lib/time-off/us-holidays";

export async function POST(request: Request) {
  const actor = await getTimeOffActor();
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!actor.canManage) return NextResponse.json({ error: "Time Off Admin permission is required to add a company day off." }, { status: 403 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const date = body?.date;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!isDateKey(date) || !name || name.length > 120) {
    return NextResponse.json({ error: "Enter a valid date and a holiday name up to 120 characters." }, { status: 400 });
  }
  if (getUsFederalHolidaysInRange(date, date).length > 0) {
    return NextResponse.json({ error: "That date is already a US federal holiday." }, { status: 409 });
  }
  const { data, error } = await getSupabaseAdmin()
    .from("time_off_holidays")
    .insert({ holiday_date: date, name, created_by_id: actor.accountId })
    .select("id,holiday_date,name")
    .single();
  if (error) {
    return NextResponse.json(
      { error: error.code === "23505" ? "A company day off already exists on this date." : error.message },
      { status: error.code === "23505" ? 409 : 500 }
    );
  }
  return NextResponse.json({ holiday: data }, { status: 201 });
}
