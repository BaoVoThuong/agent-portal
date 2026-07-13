import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildTaskActor, canAccessBoard, isTaskViewAdmin } from "@/lib/tasks/access";
import { TASK_PRIORITIES } from "@/lib/tasks/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const actor = buildTaskActor(session.user.permissions, email, {
    isAdmin: isTaskViewAdmin(session.user),
  });
  // Reads are for anyone on the task board — the client needs SLA rules to
  // render overdue/countdown for CS + agents. Only writes below are admin-only.
  if (!canAccessBoard(actor)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
  const actor = buildTaskActor(session.user.permissions, email, {
    isAdmin: isTaskViewAdmin(session.user),
  });
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

// Clears a specific override so that priority+category falls back to the
// priority-only rule, then the hardcoded DEFAULT_SLA_MINUTES.
export async function DELETE(req: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const actor = buildTaskActor(session.user.permissions, email, {
    isAdmin: isTaskViewAdmin(session.user),
  });
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

  const supabase = getSupabaseAdmin();
  let query = supabase.from("task_sla_rules").delete().eq("priority", priority);
  query = categoryId ? query.eq("category_id", categoryId) : query.is("category_id", null);
  const { error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
