import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildTaskActor, canAssignToTask } from "@/lib/tasks/access";
import {
  attachAssigneesToTasks,
  fetchTaskAssigneeEmails,
  isTaskAssigneesMissingError,
} from "@/lib/tasks/assignees";
import { resolveAssigneeChange } from "@/lib/tasks/assignees-set";
import { fetchCsForAgent, isAgentOwnerOrAssistant } from "@/lib/tasks/membership";
import { insertNotifications } from "@/lib/tasks/notifications";
import { broadcastTaskRoom, broadcastTasksChanged } from "@/lib/tasks/realtime";
import { TASK_COLUMNS } from "@/lib/tasks/queries";
import type { TaskRow } from "@/lib/tasks/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function loadContext(id: string) {
  const session = await auth();
  const actorEmail = session?.user?.email;
  if (!actorEmail) return { error: "Unauthorized" as const, status: 401 };

  const actor = buildTaskActor(session.user.permissions, actorEmail);
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("tasks")
    .select("id,status,agent_email,assignee_email")
    .eq("id", id)
    .maybeSingle();
  if (error) return { error: error.message, status: 500 };
  if (!data) return { error: "Not found", status: 404 };

  const task = data as unknown as Pick<
    TaskRow,
    "id" | "status" | "agent_email" | "assignee_email"
  >;
  const isAgentOwner = actor.isManager
    ? false
    : await isAgentOwnerOrAssistant(task.agent_email, actor.email);
  if (!canAssignToTask(actor, isAgentOwner)) {
    return { error: "You cannot assign this task.", status: 403 };
  }

  return { actor, supabase, task };
}

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const ctx = await loadContext(id);
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  if (!email) {
    return NextResponse.json({ error: "email is required." }, { status: 400 });
  }

  // Same bound as the create-task flow and the UI picker: a non-manager can
  // assign freely, but only within their own agent's team.
  if (!ctx.actor.isManager && email !== ctx.task.agent_email) {
    const teamEmails = new Set(await fetchCsForAgent(ctx.task.agent_email ?? ""));
    if (!teamEmails.has(email)) {
      return NextResponse.json(
        { error: "Assignee must be part of this agent's team." },
        { status: 400 }
      );
    }
  }

  const currentFromJunction = await fetchTaskAssigneeEmails(id, ctx.supabase);
  const current =
    currentFromJunction.length > 0
      ? currentFromJunction
      : ctx.task.assignee_email
        ? [ctx.task.assignee_email]
        : [];
  const alreadyAssigned = current.includes(email);
  const next = resolveAssigneeChange(
    { status: ctx.task.status, assignees: current },
    { add: email }
  );

  const { error: upsertError } = await ctx.supabase
    .from("task_assignees")
    .upsert({ task_id: id, email }, { onConflict: "task_id,email" });
  if (upsertError) {
    if (isTaskAssigneesMissingError(upsertError)) {
      return NextResponse.json(
        { error: "task_assignees table is not migrated yet." },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }

  const legacyAssignee = next.assignees[0] ?? null;
  const taskPatch: Record<string, unknown> = {
    assignee_email: legacyAssignee,
    updated_at: new Date().toISOString(),
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

  if (!alreadyAssigned) {
    await ctx.supabase.from("task_activity").insert({
      task_id: id,
      actor_email: ctx.actor.email,
      type: "assigned",
      meta: { to: email },
    });

    if (email !== ctx.actor.email) {
      await insertNotifications([
        {
          recipient_email: email,
          task_id: id,
          type: "assigned",
          actor_email: ctx.actor.email,
        },
      ]);
    }
  }

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
