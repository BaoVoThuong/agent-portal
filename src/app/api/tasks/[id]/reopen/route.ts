import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildTaskActor, canChangeTaskStatus } from "@/lib/tasks/access";
import { attachAssigneesToTasks, isTaskAssignee } from "@/lib/tasks/assignees";
import { recordStageTransition } from "@/lib/tasks/history";
import { isAgentOwnerOrAssistant } from "@/lib/tasks/membership";
import { broadcastTaskRoom, broadcastTasksChanged } from "@/lib/tasks/realtime";
import type { TaskRow } from "@/lib/tasks/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// Reopening a Done/Cancel task sends it back to To Do — same destination and
// reason requirement as resolving an overdue task (see /overdue-unlock) — so
// it always needs a reason, same permission bar as changing status generally
// (manager, assignee, or agent owner), instead of a silent kanban drag.
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

  if (task.status !== "done" && task.status !== "cancel") {
    return NextResponse.json(
      { error: "Only a Done or Cancelled task can be reopened this way." },
      { status: 400 }
    );
  }

  const nowIso = new Date().toISOString();
  // Reopen a Done/Cancelled task back to To Do — not In Progress. The task's
  // SLA budget and any time already banked In Progress are preserved, never
  // reset (see sla.ts / overdue-unlock for the matching logic on that path).
  const patch = {
    status: "todo",
    todo_started_at: nowIso,
    in_progress_at: null,
    waiting_started_at: null,
    done_reviewed_by_email: null,
    done_reviewed_at: null,
    closed_at: null,
    reopened_at: nowIso,
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

  await Promise.all([
    recordStageTransition(supabase, {
      task,
      patch,
      actorEmail: actor.email,
      nowIso,
    }),
    supabase.from("task_activity").insert({
      task_id: id,
      actor_email: actor.email,
      type: "task_reopened",
      meta: { reason, from_status: task.status, to_status: "todo" },
    }),
  ]);

  await broadcastTasksChanged();
  await broadcastTaskRoom(id);

  const [task2] = await attachAssigneesToTasks([updated as TaskRow], supabase, {
    currentEmail: actor.email,
  });
  return NextResponse.json({ task: task2 });
}
