import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildTaskActor, canChangeTaskStatus } from "@/lib/tasks/access";
import { attachAssigneesToTasks, isTaskAssignee } from "@/lib/tasks/assignees";
import { recordStageTransition, resolveOverdueEvent } from "@/lib/tasks/history";
import { isAgentOwnerOrAssistant } from "@/lib/tasks/membership";
import {
  currentStintDueAt,
  effectiveSlaMinutes,
  inProgressConsumedSeconds,
  isTaskOverdue,
} from "@/lib/tasks/sla";
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
  const nowIso = new Date().toISOString();
  const dueAt = currentStintDueAt(task, rules) ?? new Date(nowIso);
  // Only bump the permanent tally if this overdue occurrence wasn't already
  // counted (overdue_flagged_at unset means the person noticed and reopened it
  // before the daily cron ran).
  const alreadyCounted = Boolean(task.overdue_flagged_at);
  // Reopen sends the task back to To Do, but the SLA budget and the In Progress
  // time already burned are PRESERVED (not reset): the same work continues, so
  // the meter must keep counting. When it's dragged back to In Progress it's
  // already over budget and shows the "Overdue" tag + count-up immediately —
  // no misleading fresh countdown, no way to wipe the delay by reopening.
  const patch = {
    status: "todo",
    todo_started_at: nowIso,
    in_progress_at: null,
    // Bank the In Progress stint just ended so the time isn't lost.
    in_progress_seconds: inProgressConsumedSeconds(task, new Date(nowIso)),
    // Keep the permanent overdue marker (and set it now if the cron hadn't yet).
    overdue_flagged_at: task.overdue_flagged_at ?? nowIso,
    overdue_count: alreadyCounted ? task.overdue_count : task.overdue_count + 1,
    // NOTE: sla_minutes (budget) is intentionally left untouched — never reset.
    done_reviewed_by_email: null,
    done_reviewed_at: null,
    closed_at: null,
    updated_at: nowIso,
  };

  const { data: updated, error: updateError } = await supabase
    .from("tasks")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  await resolveOverdueEvent(supabase, {
    task,
    dueAt: dueAt.toISOString(),
    resolvedAt: nowIso,
    actorEmail: actor.email,
    reason,
    slaMinutes: minutes,
  });
  await recordStageTransition(supabase, {
    task,
    actorEmail: actor.email,
    patch,
    nowIso,
  });

  await supabase.from("task_activity").insert({
    task_id: id,
    actor_email: actor.email,
    type: "overdue_resolved",
    meta: {
      reason,
      due_at: dueAt.toISOString(),
      resolved_at: nowIso,
      previous_started_at: task.in_progress_at,
      previous_sla_minutes: minutes,
      to_status: "todo",
    },
  });

  await broadcastTasksChanged();
  await broadcastTaskRoom(id);

  const [task2] = await attachAssigneesToTasks([updated as TaskRow], supabase, {
    currentEmail: actor.email,
  });
  return NextResponse.json({ task: task2 });
}
