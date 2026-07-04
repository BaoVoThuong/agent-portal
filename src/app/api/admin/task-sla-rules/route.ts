import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildTaskActor, canAccessBoard } from "@/lib/tasks/access";
import { TASK_PRIORITIES } from "@/lib/tasks/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const actor = buildTaskActor(session.user.permissions, email);
  if (!canAccessBoard(actor)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("task_sla_rules")
    .select("id,priority,category_id,duration_minutes");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ rules: data ?? [] });
}

export async function POST(req: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const actor = buildTaskActor(session.user.permissions, email);
  if (!actor.isManager) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const priority = typeof body?.priority === "string" ? body.priority : "";
  if (!TASK_PRIORITIES.includes(priority as (typeof TASK_PRIORITIES)[number])) {
    return NextResponse.json({ error: "Invalid priority." }, { status: 400 });
  }
  const categoryId =
    typeof body?.category_id === "string" && body.category_id.trim() !== ""
      ? body.category_id.trim()
      : null;
  const durationMinutes = Number(body?.duration_minutes);
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    return NextResponse.json({ error: "Invalid duration." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  // Upsert by hand (not .upsert/onConflict): the uniqueness constraint is a
  // functional index over coalesce(category_id, sentinel), which onConflict
  // can't target directly by column list.
  let existing = supabase
    .from("task_sla_rules")
    .select("id")
    .eq("priority", priority);
  existing = categoryId
    ? existing.eq("category_id", categoryId)
    : existing.is("category_id", null);
  const { data: existingRow, error: existingError } = await existing.maybeSingle();
  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 });
  }

  const patch = {
    priority,
    category_id: categoryId,
    duration_minutes: Math.round(durationMinutes),
    updated_at: new Date().toISOString(),
  };

  const { data, error } = existingRow
    ? await supabase
        .from("task_sla_rules")
        .update(patch)
        .eq("id", (existingRow as { id: string }).id)
        .select("id,priority,category_id,duration_minutes")
        .single()
    : await supabase
        .from("task_sla_rules")
        .insert(patch)
        .select("id,priority,category_id,duration_minutes")
        .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ rule: data });
}
