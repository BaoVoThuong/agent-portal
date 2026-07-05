import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  buildTaskActor,
  canAssignToTask,
  canChangeTaskStatus,
  canDeleteTask,
  canMutateTask,
  canReviewDoneTask,
  canViewTask,
} from "@/lib/tasks/access";
import { resolveTaskPatch } from "@/lib/tasks/transitions";
import type { TaskRow } from "@/lib/tasks/types";
import { buildActivityEntries } from "@/lib/tasks/activity";
import { insertNotifications } from "@/lib/tasks/notifications";
import { broadcastTaskRoom, broadcastTasksChanged } from "@/lib/tasks/realtime";
import { fetchAgentsForCs, fetchCsForAgent, isAgentOwnerOrAssistant } from "@/lib/tasks/membership";
import { reconcileAssigneesForNewAgent } from "@/lib/tasks/assignees-set";
import { isTaskParticipant } from "@/lib/tasks/participants";
import {
  attachAssigneesToTasks,
  fetchTaskAssigneeEmails,
  isTaskAssigneesMissingError,
  isTaskAssignee,
} from "@/lib/tasks/assignees";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const STATUS_PATCH_KEYS = new Set(["status", "position"]);
const REVIEW_PATCH_KEYS = new Set(["done_reviewed"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isStatusOnlyPatch(body: Record<string, unknown>): boolean {
  return Object.keys(body).every((key) => STATUS_PATCH_KEYS.has(key));
}

function isReviewOnlyPatch(body: Record<string, unknown>): boolean {
  return Object.keys(body).every((key) => REVIEW_PATCH_KEYS.has(key));
}

async function resolveTaskAccess(
  actor: ReturnType<typeof buildTaskActor>,
  task: Pick<TaskRow, "assignee_email" | "agent_email" | "reporter_email">,
  taskId: string
): Promise<{
  canView: boolean;
  isAgentMember: boolean;
  isAgentOwner: boolean;
  isAssignee: boolean;
  isParticipant: boolean;
  isReporter: boolean;
}> {
  if (actor.isManager) {
    return {
      canView: true,
      isAgentMember: false,
      isAgentOwner: false,
      isAssignee: false,
      isParticipant: false,
      isReporter: false,
    };
  }
  const [isParticipant, isAssignee, agents, isAgentOwner] = await Promise.all([
    isTaskParticipant(taskId, actor.email),
    isTaskAssignee(taskId, actor.email),
    fetchAgentsForCs(actor.email),
    isAgentOwnerOrAssistant(task.agent_email, actor.email),
  ]);
  const isAgentMember = Boolean(task.agent_email && agents.includes(task.agent_email));
  const isReporter = task.reporter_email === actor.email;
  return {
    canView: canViewTask(actor, task, {
      isParticipant,
      isAgentMember,
      isAgentOwner,
      isAssignee,
    }),
    isAgentMember,
    isAgentOwner,
    isAssignee,
    isParticipant,
    isReporter,
  };
}

async function loadActorAndTask(id: string) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { error: "Unauthorized" as const, status: 401 };
  const actor = buildTaskActor(session.user.permissions, email);

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) return { error: error.message, status: 500 };
  if (!data) return { error: "Not found", status: 404 };
  return { actor, task: data as unknown as TaskRow, supabase };
}

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const r = await loadActorAndTask(id);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const access = await resolveTaskAccess(r.actor, r.task, id);
  if (!access.canView)
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  const [task] = await attachAssigneesToTasks([r.task], r.supabase);
  return NextResponse.json({ task });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const r = await loadActorAndTask(id);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });

  const body = await req.json().catch(() => null);
  const bodyRecord = isRecord(body) ? body : null;
  if (!bodyRecord) {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }

  const access = await resolveTaskAccess(r.actor, r.task, id);
  if (!access.canView) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const currentAssignees = await fetchTaskAssigneeEmails(id, r.supabase);
  const currentForPatch = {
    status: r.task.status,
    assignee_email: currentAssignees[0] ?? r.task.assignee_email,
    in_progress_at: r.task.in_progress_at,
  };
  const reassigning = bodyRecord.assignee_email !== undefined;

  const mayAssign = canAssignToTask(r.actor, access.isAgentOwner);
  if (reassigning && !mayAssign) {
    return NextResponse.json({ error: "You cannot assign this task." }, { status: 403 });
  }

  const canMutate = canMutateTask(r.actor, r.task, {
    isAgentOwner: access.isAgentOwner,
    isReporter: access.isReporter,
  });
  const canReviewDone = canReviewDoneTask(r.actor, r.task);
  let resolvedBody: unknown = body;
  if (!canMutate) {
    const statusOnly = isStatusOnlyPatch(bodyRecord);
    const reviewOnly = isReviewOnlyPatch(bodyRecord);
    const canPatchStatus =
      statusOnly &&
      canChangeTaskStatus(r.actor, r.task, {
        isAssignee: access.isAssignee,
        isAgentOwner: access.isAgentOwner,
      });
    const canPatchReview = reviewOnly && canReviewDone;
    if (!canPatchStatus && !canPatchReview) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }
    resolvedBody = bodyRecord;
  }

  const resolved = resolveTaskPatch(r.actor, currentForPatch, resolvedBody, {
    canAssign: mayAssign,
    canReviewDone,
  });
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: 400 });

  // Changing the agent (without also explicitly reassigning in the same
  // request) prunes any assignees who aren't on the new agent's team.
  if (
    !reassigning &&
    typeof resolved.patch.agent_email === "string" &&
    resolved.patch.agent_email !== r.task.agent_email
  ) {
    const newTeam = await fetchCsForAgent(resolved.patch.agent_email);
    const reconciled = reconcileAssigneesForNewAgent(currentAssignees, newTeam);
    if (reconciled.assignees !== null) {
      const nextAssignees = reconciled.assignees;
      const staleAssignees = currentAssignees.filter((e) => !nextAssignees.includes(e));
      const { error: pruneError } = await r.supabase
        .from("task_assignees")
        .delete()
        .eq("task_id", id)
        .in("email", staleAssignees);
      if (pruneError && !isTaskAssigneesMissingError(pruneError)) {
        return NextResponse.json({ error: pruneError.message }, { status: 500 });
      }
      resolved.patch.assignee_email = nextAssignees[0] ?? null;
      if (reconciled.status) {
        resolved.patch.status = reconciled.status;
      }
    }
  }

  if (reassigning) {
    const nextAssignee = resolved.patch.assignee_email as string | null;
    const { error: deleteAssigneesError } = await r.supabase
      .from("task_assignees")
      .delete()
      .eq("task_id", id);
    if (deleteAssigneesError && !isTaskAssigneesMissingError(deleteAssigneesError)) {
      return NextResponse.json({ error: deleteAssigneesError.message }, { status: 500 });
    }
    if (nextAssignee) {
      const { error: insertAssigneeError } = await r.supabase
        .from("task_assignees")
        .insert({ task_id: id, email: nextAssignee });
      if (insertAssigneeError && !isTaskAssigneesMissingError(insertAssigneeError)) {
        return NextResponse.json({ error: insertAssigneeError.message }, { status: 500 });
      }
    }
  }

  const { data, error } = await r.supabase
    .from("tasks")
    .update({ ...resolved.patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const entries = buildActivityEntries(
    {
      status: r.task.status,
      assignee_email: r.task.assignee_email,
      agent_email: r.task.agent_email,
      done_reviewed_at: r.task.done_reviewed_at,
    },
    resolved.patch
  );
  if (entries.length > 0) {
    await r.supabase.from("task_activity").insert(
      entries.map((e) => ({
        task_id: id,
        actor_email: r.actor.email,
        type: e.type,
        meta: e.meta,
      }))
    );
  }

  // Notify a newly assigned person (not when assigning to self).
  const newAssignee = resolved.patch.assignee_email as string | null | undefined;
  if (
    newAssignee &&
    newAssignee !== r.task.assignee_email &&
    newAssignee !== r.actor.email
  ) {
    await insertNotifications([
      { recipient_email: newAssignee, task_id: id, type: "assigned", actor_email: r.actor.email },
    ]);
  }

  await broadcastTasksChanged();
  await broadcastTaskRoom(id);
  const [task] = await attachAssigneesToTasks([data as TaskRow], r.supabase);
  return NextResponse.json({ task });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const r = await loadActorAndTask(id);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const isAgentOwner = r.actor.isManager
    ? false
    : await isAgentOwnerOrAssistant(r.task.agent_email, r.actor.email);
  if (!canDeleteTask(r.actor, isAgentOwner))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  // Soft-delete (archive), not a hard delete: a hard delete would cascade away
  // task_activity — including the overdue/reopen history now used for KPI
  // reporting. Archived tasks are already excluded from board queries
  // (fetchTasksForActor filters `archived_at is null`); nothing else changes.
  const { error } = await r.supabase
    .from("tasks")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await broadcastTasksChanged();
  return NextResponse.json({ ok: true });
}
