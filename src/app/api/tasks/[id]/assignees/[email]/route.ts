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

export async function DELETE(req: Request, { params }: Ctx) {
  const { id, email: rawEmail } = await params;
  const email = decodeURIComponent(rawEmail).trim();
  if (!email) {
    return NextResponse.json({ error: "email is required." }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const expectedUpdatedAt =
    typeof body?.expected_updated_at === "string" && body.expected_updated_at.trim() !== ""
      ? body.expected_updated_at.trim()
      : "";
  if (!expectedUpdatedAt) {
    return NextResponse.json({ error: "expected_updated_at is required." }, { status: 400 });
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

  const { data: updated, error: updateError } = await ctx.supabase.rpc("patch_task_atomic", {
    p_task_id: id,
    p_expected_updated_at: expectedUpdatedAt,
    p_patch: taskPatch,
    p_before_assignees: current,
    p_next_assignees: wasAssigned ? next.assignees : null,
    p_actor_email: ctx.actor.email,
    p_activity: wasAssigned
      ? [{ type: "unassigned", meta: { removed: email, next_primary: legacyAssignee } }]
      : [],
    p_now: nowIso,
  });
  if (updateError) {
    if (updateError.message.includes("TASK_CONFLICT")) {
      return NextResponse.json(
        { error: "Task was updated by someone else. Refresh and try again." },
        { status: 409 }
      );
    }
    if (isTaskAssigneesMissingError(updateError)) {
      return NextResponse.json(
        { error: "task_assignees table is not migrated yet." },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }
  if (!updated || typeof updated !== "object") {
    return NextResponse.json({ error: "Atomic task mutation returned no task." }, { status: 500 });
  }

  const mutationWarnings: string[] = [];
  if (wasAssigned) {
    if (email !== ctx.actor.email) {
      const notificationResult = await Promise.allSettled([
        insertNotifications([
          {
            recipient_email: email,
            task_id: id,
            type: "unassigned",
            actor_email: ctx.actor.email,
          },
        ]),
      ]);
      if (notificationResult[0]?.status === "rejected") {
        mutationWarnings.push(
          notificationResult[0].reason instanceof Error
            ? notificationResult[0].reason.message
            : "Task unassignment notification failed."
        );
      }
    }
  }

  const taskData = updated as TaskRow;

  const broadcastResults = await Promise.allSettled([
    broadcastTasksChanged(),
    broadcastTaskRoom(id),
  ]);
  for (const result of broadcastResults) {
    if (result.status === "rejected") {
      mutationWarnings.push(
        result.reason instanceof Error ? result.reason.message : "Task broadcast failed."
      );
    }
  }
  let task = taskData as TaskRow;
  try {
    [task] = await attachAssigneesToTasks(
      [taskData as unknown as TaskRow],
      ctx.supabase,
      { currentEmail: ctx.actor.email }
    );
  } catch (error) {
    mutationWarnings.push(
      `Task assignee reload failed: ${error instanceof Error ? error.message : "unknown error"}`
    );
  }
  return NextResponse.json({ task, warnings: mutationWarnings });
}
