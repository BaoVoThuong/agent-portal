import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildTaskActor, isTaskViewAdmin, canChangeTaskStatus } from "@/lib/tasks/access";
import {
  attachAssigneesToTasks,
  fetchTaskAssigneeEmails,
  isTaskAssignee,
} from "@/lib/tasks/assignees";
import { isAgentOwnerOrAssistant } from "@/lib/tasks/membership";
import { insertNotifications } from "@/lib/tasks/notifications";
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
  const actor = buildTaskActor(session.user.permissions, email, {
    isAdmin: isTaskViewAdmin(session.user),
  });

  const body = await req.json().catch(() => null);
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  const expectedUpdatedAt =
    typeof body?.expected_updated_at === "string" && body.expected_updated_at.trim() !== ""
      ? body.expected_updated_at.trim()
      : "";
  if (!reason) {
    return NextResponse.json({ error: "A reason is required." }, { status: 400 });
  }
  if (!expectedUpdatedAt) {
    return NextResponse.json({ error: "expected_updated_at is required." }, { status: 400 });
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
    todo_reminded_at: null,
    in_progress_at: null,
    waiting_started_at: null,
    done_reviewed_by_email: null,
    done_reviewed_at: null,
    closed_at: null,
    reopened_at: nowIso,
  };
  const { data: updated, error: updateError } = await supabase.rpc("patch_task_atomic", {
    p_task_id: id,
    p_expected_updated_at: expectedUpdatedAt,
    p_patch: patch,
    p_before_assignees: [],
    p_next_assignees: null,
    p_actor_email: actor.email,
    p_activity: [
      {
        type: "task_reopened",
        meta: { reason, from_status: task.status, to_status: "todo" },
      },
    ],
    p_now: nowIso,
  });
  if (updateError) {
    if (updateError.message.includes("TASK_CONFLICT")) {
      return NextResponse.json(
        { error: "Task was updated by someone else. Refresh and try again." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }
  if (!updated || typeof updated !== "object") {
    return NextResponse.json({ error: "Atomic task mutation returned no task." }, { status: 500 });
  }

  const mutationWarnings: string[] = [];
  let reopenedRecipients: string[] = [];
  try {
    const assignees = await fetchTaskAssigneeEmails(id, supabase);
    reopenedRecipients = assignees.filter((assignee) => assignee !== actor.email);
  } catch (error) {
    mutationWarnings.push(
      `Task assignee lookup failed: ${error instanceof Error ? error.message : "unknown error"}`
    );
  }
  const notificationResult = await Promise.allSettled([
    insertNotifications(
      reopenedRecipients.map((recipient) => ({
        recipient_email: recipient,
        task_id: id,
        type: "reopened",
        actor_email: actor.email,
      }))
    ),
  ]);
  if (notificationResult[0]?.status === "rejected") {
    mutationWarnings.push(
      notificationResult[0].reason instanceof Error
        ? notificationResult[0].reason.message
        : "Task reopen notification failed."
    );
  }

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

  let task2 = updated as TaskRow;
  try {
    [task2] = await attachAssigneesToTasks([updated as TaskRow], supabase, {
      currentEmail: actor.email,
    });
  } catch (error) {
    mutationWarnings.push(
      `Task assignee reload failed: ${error instanceof Error ? error.message : "unknown error"}`
    );
  }
  return NextResponse.json({ task: task2, warnings: mutationWarnings });
}
