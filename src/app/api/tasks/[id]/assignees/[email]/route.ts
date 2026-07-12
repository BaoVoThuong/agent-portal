import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildTaskActor, isTaskViewAdmin, canAssignToTask } from "@/lib/tasks/access";
import {
  attachAssigneesToTasks,
  fetchTaskAssigneeEmails,
  isTaskAssigneesMissingError,
} from "@/lib/tasks/assignees";
import { resolveAssigneeChange } from "@/lib/tasks/assignees-set";
import { isAgentOwnerOrAssistant } from "@/lib/tasks/membership";
import { insertNotifications } from "@/lib/tasks/notifications";
import { broadcastTaskRoom, broadcastTasksChanged } from "@/lib/tasks/realtime";
import { TASK_COLUMNS } from "@/lib/tasks/queries";
import { recordStageTransition, syncAssignmentCycles } from "@/lib/tasks/history";
import { touchLastActivity } from "@/lib/tasks/last-activity";
import type { TaskRow } from "@/lib/tasks/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; email: string }> };

async function loadContext(id: string) {
  const session = await auth();
  const actorEmail = session?.user?.email;
  if (!actorEmail) return { error: "Unauthorized" as const, status: 401 };

  const actor = buildTaskActor(session.user.permissions, actorEmail, {
    isAdmin: isTaskViewAdmin(session.user),
  });
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) return { error: error.message, status: 500 };
  if (!data) return { error: "Not found", status: 404 };

  const task = data as unknown as TaskRow;
  const isAgentOwner = actor.isManager
    ? false
    : await isAgentOwnerOrAssistant(task.agent_email, actor.email);
  if (!canAssignToTask(actor, isAgentOwner)) {
    return { error: "You cannot assign this task.", status: 403 };
  }

  return { actor, supabase, task };
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id, email: rawEmail } = await params;
  const email = decodeURIComponent(rawEmail).trim();
  if (!email) {
    return NextResponse.json({ error: "email is required." }, { status: 400 });
  }

  const ctx = await loadContext(id);
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const currentFromJunction = await fetchTaskAssigneeEmails(id, ctx.supabase);
  const current =
    currentFromJunction.length > 0
      ? currentFromJunction
      : ctx.task.assignee_email
        ? [ctx.task.assignee_email]
        : [];
  const wasAssigned = current.includes(email);
  const next = resolveAssigneeChange(
    { status: ctx.task.status, assignees: current },
    { remove: email }
  );
  const nowIso = new Date().toISOString();

  const { error: deleteError } = await ctx.supabase
    .from("task_assignees")
    .delete()
    .eq("task_id", id)
    .eq("email", email);
  if (deleteError) {
    if (isTaskAssigneesMissingError(deleteError)) {
      return NextResponse.json(
        { error: "task_assignees table is not migrated yet." },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  const legacyAssignee = next.assignees[0] ?? null;
  const taskPatch: Record<string, unknown> = {
    assignee_email: legacyAssignee,
    updated_at: nowIso,
  };
  if (next.status !== ctx.task.status) {
    taskPatch.status = next.status;
    if (ctx.task.status === "waiting" && next.status !== "waiting") {
      taskPatch.waiting_reminded_at = null;
    }
  }

  const { error: updateError } = await ctx.supabase
    .from("tasks")
    .update(taskPatch)
    .eq("id", id);
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  if (wasAssigned) {
    await ctx.supabase.from("task_activity").insert({
      task_id: id,
      actor_email: ctx.actor.email,
      type: "assigned",
      meta: { removed: email, to: legacyAssignee },
    });
    if (email !== ctx.actor.email) {
      await insertNotifications([
        {
          recipient_email: email,
          task_id: id,
          type: "unassigned",
          actor_email: ctx.actor.email,
        },
      ]);
    }
  }

  await recordStageTransition(ctx.supabase, {
    task: ctx.task,
    patch: taskPatch,
    actorEmail: ctx.actor.email,
    nowIso,
  });
  await syncAssignmentCycles(ctx.supabase, {
    taskId: id,
    beforeEmails: current,
    afterEmails: next.assignees,
    actorEmail: ctx.actor.email,
    nowIso,
    source: "unassign",
  });
  await touchLastActivity(ctx.supabase, id, nowIso);

  const { data: taskData, error: taskError } = await ctx.supabase
    .from("tasks")
    .select(TASK_COLUMNS)
    .eq("id", id)
    .single();
  if (taskError) {
    return NextResponse.json({ error: taskError.message }, { status: 500 });
  }

  await broadcastTasksChanged();
  await broadcastTaskRoom(id);
  const [task] = await attachAssigneesToTasks(
    [taskData as unknown as TaskRow],
    ctx.supabase,
    { currentEmail: ctx.actor.email }
  );
  return NextResponse.json({ task });
}
