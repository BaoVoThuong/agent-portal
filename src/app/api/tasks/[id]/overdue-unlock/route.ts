import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildTaskActor, canChangeTaskStatus } from "@/lib/tasks/access";
import { attachAssigneesToTasks, isTaskAssignee } from "@/lib/tasks/assignees";
import { isAgentOwnerOrAssistant } from "@/lib/tasks/membership";
import { effectiveSlaMinutes, isTaskOverdue, resolveSlaMinutes, slaDeadline } from "@/lib/tasks/sla";
import { broadcastTaskRoom, broadcastTasksChanged } from "@/lib/tasks/realtime";
import type { TaskRow } from "@/lib/tasks/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const actor = buildTaskActor(session.user.permissions, email);

  const body = await req.json().catch(() => null);
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (!reason) {
    return NextResponse.json({ error: "A reason is required." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const task = data as unknown as TaskRow;

  const isAssignee = actor.isManager ? false : await isTaskAssignee(id, actor.email, supabase);
  const isAgentOwner = actor.isManager
    ? false
    : await isAgentOwnerOrAssistant(task.agent_email, actor.email);
  if (!canChangeTaskStatus(actor, task, { isAssignee, isAgentOwner })) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { data: rulesData, error: rulesError } = await supabase
    .from("task_sla_rules")
    .select("priority,category_id,duration_minutes");
  if (rulesError) return NextResponse.json({ error: rulesError.message }, { status: 500 });

  const rules = rulesData ?? [];
  if (!isTaskOverdue(task, rules)) {
    return NextResponse.json({ error: "Task isn't overdue." }, { status: 400 });
  }

  // task.in_progress_at is non-null here (isTaskOverdue only returns true when set).
  const minutes = effectiveSlaMinutes(task, rules);
  const dueAt = slaDeadline(task.in_progress_at as string, minutes);
  const nowIso = new Date().toISOString();
  // Re-snapshot at the current priority/category — locks in the SLA for the
  // new run the same way a first start does (see sla_minutes in schema.sql).
  const nextSlaMinutes = resolveSlaMinutes(task.priority, task.category_id, rules);
  // Only bump the permanent tally if the cron hasn't already counted this
  // occurrence (overdue_flagged_at unset means the person noticed and
  // unlocked it before the daily cron ran).
  const nextOverdueCount = task.overdue_flagged_at
    ? task.overdue_count
    : task.overdue_count + 1;

  const { data: updated, error: updateError } = await supabase
    .from("tasks")
    .update({
      in_progress_at: nowIso,
      overdue_flagged_at: null,
      overdue_reminded_at: null,
      sla_minutes: nextSlaMinutes,
      overdue_count: nextOverdueCount,
      updated_at: nowIso,
    })
    .eq("id", id)
    .select("*")
    .single();
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  await supabase.from("task_activity").insert({
    task_id: id,
    actor_email: actor.email,
    type: "overdue_resolved",
    meta: {
      reason,
      due_at: dueAt.toISOString(),
      resolved_at: nowIso,
    },
  });

  await broadcastTasksChanged();
  await broadcastTaskRoom(id);

  const [task2] = await attachAssigneesToTasks([updated as TaskRow], supabase, {
    currentEmail: actor.email,
  });
  return NextResponse.json({ task: task2 });
}
