import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildTaskActor, isTaskViewAdmin, canChangeTaskStatus } from "@/lib/tasks/access";
import { attachAssigneesToTasks, isTaskAssignee } from "@/lib/tasks/assignees";
import { recordStageTransition, resolveOverdueEvent } from "@/lib/tasks/history";
import { touchLastActivity } from "@/lib/tasks/last-activity";
import {
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
import { broadcastTaskRoom, broadcastTasksChanged } from "@/lib/tasks/realtime";
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
    resolveOverdueEvent(supabase, {
      task,
      dueAt: dueAt.toISOString(),
      resolvedAt: nowIso,
      actorEmail: actor.email,
      reason,
      slaMinutes: minutes,
    }),
    recordStageTransition(supabase, {
      task,
      patch,
      actorEmail: actor.email,
      nowIso,
    }),
    touchLastActivity(supabase, id, nowIso),
    supabase.from("task_activity").insert({
      task_id: id,
      actor_email: actor.email,
      type: "overdue_unlocked",
      meta: {
        reason,
        due_at: dueAt.toISOString(),
        resolved_at: nowIso,
        previous_started_at: task.in_progress_at,
        sla_minutes: minutes,
        to_status: "todo",
      },
    }),
  ]);

  // Notify the agent owner/assistants that this overdue was resolved. The
  // reason is in the activity log (deep-link shows it).
  const overdueRecipients = (
    await fetchAgentOwnerAndAssistantEmails(task.agent_email)
  ).filter((recipient) => recipient !== actor.email);
  if (overdueRecipients.length > 0) {
    await insertNotifications(
      overdueRecipients.map((recipient) => ({
        recipient_email: recipient,
        task_id: id,
        type: "overdue_unlocked",
        actor_email: actor.email,
      }))
    );
  }

  await broadcastTasksChanged();
  await broadcastTaskRoom(id);

  const [task2] = await attachAssigneesToTasks([updated as TaskRow], supabase, {
    currentEmail: actor.email,
  });
  return NextResponse.json({ task: task2 });
}
