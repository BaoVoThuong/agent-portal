import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildTaskActor, isTaskViewAdmin, canChangeTaskStatus } from "@/lib/tasks/access";
import { attachAssigneesToTasks, isTaskAssignee } from "@/lib/tasks/assignees";
import {
  fetchAdminEmails,
  fetchAgentOwnerAndAssistantEmails,
  isAgentOwnerOrAssistant,
} from "@/lib/tasks/membership";
import { insertNotifications } from "@/lib/tasks/notifications";
import {
  currentStintDueAt,
  effectiveSlaMinutes,
  inProgressConsumedSeconds,
  isTaskOverdue,
} from "@/lib/tasks/sla";
import {
  broadcastTaskRoom,
  broadcastTasksChanged,
  readTaskMutationSourceId,
} from "@/lib/tasks/realtime";
import type { TaskRow } from "@/lib/tasks/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// Resolving an overdue task sends it back to To Do — same destination and
// same reason requirement as reopening a Done/Cancel task, just from a
// different starting status. The In Progress time already spent is banked
// (never lost), and the SLA budget is left untouched. Since isTaskOverdue
// only returns true while overdue_count is still 0, this is always the
// task's first (and only) overdue resolution — overdue_count can safely go
// straight to 1 with no "already counted" branching. From here on
// isSlaActiveInProgress is permanently false for this task: no countdown,
// no re-locking, ever again — just plain elapsed-time tracking with a
// permanent "Was overdue" marker (see sla.ts).
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

  const { data: rulesData, error: rulesError } = await supabase
    .from("task_sla_rules")
    .select("priority,category_id,duration_minutes");
  if (rulesError) return NextResponse.json({ error: rulesError.message }, { status: 500 });

  const rules = rulesData ?? [];
  if (!isTaskOverdue(task, rules)) {
    return NextResponse.json({ error: "Task isn't overdue." }, { status: 400 });
  }

  const minutes = effectiveSlaMinutes(task, rules);
  const nowIso = new Date().toISOString();
  const now = new Date(nowIso);
  const dueAt = currentStintDueAt(task, rules) ?? now;

  const patch = {
    status: "todo",
    todo_started_at: nowIso,
    todo_reminded_at: null,
    in_progress_at: null,
    // Bank the In Progress stint that just ended — time already spent is
    // never lost, it carries into the next stint's starting total.
    in_progress_seconds: inProgressConsumedSeconds(task, now),
    // Permanent record that this task went overdue once (see sla.ts —
    // isTaskOverdue can never fire again once this is > 0).
    overdue_count: task.overdue_count + 1,
    overdue_flagged_at: task.overdue_flagged_at ?? nowIso,
    overdue_reminded_at: null,
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
        type: "overdue_unlocked",
        meta: {
          reason,
          due_at: dueAt.toISOString(),
          resolved_at: nowIso,
          previous_started_at: task.in_progress_at,
          sla_minutes: minutes,
          to_status: "todo",
        },
      },
    ],
    p_overdue: {
      due_at: dueAt.toISOString(),
      resolved_at: nowIso,
      reason,
      sla_minutes: minutes,
    },
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

  // Notify the agent owner/assistants + all admins that this overdue was
  // resolved, carrying the reason in the notification itself.
  let overdueRecipients: string[] = [];
  try {
    const [agentRecipients, adminRecipients] = await Promise.all([
      fetchAgentOwnerAndAssistantEmails(task.agent_email),
      fetchAdminEmails(),
    ]);
    overdueRecipients = [...new Set([...agentRecipients, ...adminRecipients])].filter(
      (recipient) => recipient !== actor.email
    );
  } catch (error) {
    mutationWarnings.push(
      `Overdue recipient lookup failed: ${error instanceof Error ? error.message : "unknown error"}`
    );
  }
  if (overdueRecipients.length > 0) {
    const notificationResult = await Promise.allSettled([
      insertNotifications(
        overdueRecipients.map((recipient) => ({
          recipient_email: recipient,
          task_id: id,
          type: "overdue_unlocked",
          actor_email: actor.email,
          detail: reason,
        }))
      ),
    ]);
    const overdueNotification = notificationResult[0];
    if (
      overdueNotification?.status === "rejected" ||
      (overdueNotification?.status === "fulfilled" && !overdueNotification.value)
    ) {
      mutationWarnings.push(
        overdueNotification?.status === "rejected" && overdueNotification.reason instanceof Error
          ? overdueNotification.reason.message
          : "Overdue unlock notification failed."
      );
    }
  }

  const broadcastResults = await Promise.allSettled([
    broadcastTasksChanged(readTaskMutationSourceId(req)),
    broadcastTaskRoom(id, readTaskMutationSourceId(req)),
  ]);
  for (const result of broadcastResults) {
    if (result.status === "rejected" || !result.value) {
      mutationWarnings.push(
        result.status === "rejected" && result.reason instanceof Error
          ? result.reason.message
          : "Task broadcast failed."
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
