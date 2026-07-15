import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  buildTaskActor,
  isTaskViewAdmin,
  canDeleteTask,
  resolveTaskCapabilities,
  type TaskCapabilities,
} from "@/lib/tasks/access";
import { resolveTaskPatch } from "@/lib/tasks/transitions";
import { currentStintDueAt, effectiveSlaMinutes, isTaskOverdue } from "@/lib/tasks/sla";
import type { TaskRow, TaskSlaRule } from "@/lib/tasks/types";
import { buildActivityEntries } from "@/lib/tasks/activity";
import { insertNotifications } from "@/lib/tasks/notifications";
import { broadcastTaskRoom, broadcastTasksChanged } from "@/lib/tasks/realtime";
import {
  fetchAgentOwnerAndAssistantEmails,
  fetchAgentsForCs,
  fetchCsForAgent,
  isAgentOwnerOrAssistant,
} from "@/lib/tasks/membership";
import { reconcileAssigneesForNewAgent } from "@/lib/tasks/assignees-set";
import { isTaskParticipant } from "@/lib/tasks/participants";
import {
  attachAssigneesToTasks,
  fetchTaskAssigneeEmails,
  isTaskAssigneesMissingError,
  isTaskAssignee,
} from "@/lib/tasks/assignees";
import {
  recordStageTransition,
  resolveOverdueEvent,
  syncAssignmentCycles,
} from "@/lib/tasks/history";
import { touchLastActivity } from "@/lib/tasks/last-activity";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const STATUS_PATCH_KEYS = new Set([
  "status",
  "position",
]);
const CONTENT_PATCH_KEYS = new Set([
  "title",
  "description",
  "fub_link",
  "priority",
  "category_id",
  "agent_email",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function hasAnyPatchKey(
  body: Record<string, unknown>,
  keys: ReadonlySet<string>
): boolean {
  return Object.keys(body).some((key) => keys.has(key));
}

function patchCapabilityError(
  body: Record<string, unknown>,
  capabilities: TaskCapabilities
): string | null {
  if (hasAnyPatchKey(body, CONTENT_PATCH_KEYS) && !capabilities.canEditContent) {
    return "You cannot edit this task.";
  }
  if (body.assignee_email !== undefined && !capabilities.canAssign) {
    return "You cannot assign this task.";
  }
  if (hasAnyPatchKey(body, STATUS_PATCH_KEYS) && !capabilities.canChangeStatus) {
    return "You cannot change this task's status.";
  }
  if (body.done_reviewed !== undefined && !capabilities.canReviewQC) {
    return "You cannot QC check this task.";
  }
  return null;
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
    const capabilities = resolveTaskCapabilities(actor, task, {});
    return {
      canView: capabilities.canView,
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
  const capabilities = resolveTaskCapabilities(actor, task, {
    isParticipant,
    isAgentMember,
    isAgentOwner,
    isAssignee,
    isReporter,
  });
  return {
    canView: capabilities.canView,
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
  const actor = buildTaskActor(session.user.permissions, email, {
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
  return { actor, task: data as unknown as TaskRow, supabase };
}

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const r = await loadActorAndTask(id);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const access = await resolveTaskAccess(r.actor, r.task, id);
  if (!access.canView)
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  const [task] = await attachAssigneesToTasks([r.task], r.supabase, {
    currentEmail: r.actor.email,
  });
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
  const beforeAssigneesForHistory =
    currentAssignees.length > 0
      ? currentAssignees
      : r.task.assignee_email
        ? [r.task.assignee_email]
        : [];
  let nextAssigneesForHistory = beforeAssigneesForHistory;
  const currentForPatch = {
    status: r.task.status,
    assignee_email: currentAssignees[0] ?? r.task.assignee_email,
    in_progress_at: r.task.in_progress_at,
    priority: r.task.priority,
    category_id: r.task.category_id,
    todo_started_at: r.task.todo_started_at,
    waiting_started_at: r.task.waiting_started_at,
    todo_seconds: r.task.todo_seconds,
    in_progress_seconds: r.task.in_progress_seconds,
    waiting_seconds: r.task.waiting_seconds,
    sla_minutes: r.task.sla_minutes,
  };
  const reassigning = bodyRecord.assignee_email !== undefined;
  const nowIso = new Date().toISOString();

  // Needed to snapshot sla_minutes on a first start into in_progress, and to
  // check whether a task was overdue at the moment it's marked Done directly
  // (skipping /overdue-unlock) so overdue_count still gets credited.
  let slaRules: Pick<TaskSlaRule, "priority" | "category_id" | "duration_minutes">[] = [];
  const requestedStatus =
    typeof bodyRecord.status === "string" ? bodyRecord.status : null;
  const enteringInProgress =
    requestedStatus === "in_progress" && r.task.status !== "in_progress";
  const leavingInProgress =
    requestedStatus !== null &&
    requestedStatus !== "in_progress" &&
    r.task.status === "in_progress";
  if (enteringInProgress || leavingInProgress) {
    const { data: rulesData, error: rulesError } = await r.supabase
      .from("task_sla_rules")
      .select("priority,category_id,duration_minutes");
    if (rulesError) return NextResponse.json({ error: rulesError.message }, { status: 500 });
    slaRules = rulesData ?? [];
  }

  const capabilities = resolveTaskCapabilities(r.actor, currentForPatch, {
    isAssignee: access.isAssignee,
    isAgentOwner: access.isAgentOwner,
    isReporter: access.isReporter,
    isAgentMember: access.isAgentMember,
    isParticipant: access.isParticipant,
  });
  const capabilityError = patchCapabilityError(bodyRecord, capabilities);
  if (capabilityError) {
    return NextResponse.json({ error: capabilityError }, { status: 403 });
  }

  const resolved = resolveTaskPatch(r.actor, currentForPatch, bodyRecord, {
    canAssign: capabilities.canAssign,
    canReviewDone: capabilities.canReviewQC,
    rules: slaRules,
    nowIso,
  });
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: 400 });

  // A non-manager (agent owner/Assistant) can freely pick any assignee, but
  // only within their own agent's team — same bound the create-task flow and
  // the UI picker enforce. Without this, the picker's restriction is
  // cosmetic: calling the API directly could assign anyone at all.
  if (reassigning && !r.actor.isManager) {
    const nextAssignee = resolved.patch.assignee_email as string | null;
    if (nextAssignee) {
      const targetAgent =
        typeof resolved.patch.agent_email === "string"
          ? resolved.patch.agent_email
          : r.task.agent_email;
      const teamEmails = new Set(await fetchCsForAgent(targetAgent ?? ""));
      if (nextAssignee !== targetAgent && !teamEmails.has(nextAssignee)) {
        return NextResponse.json(
          { error: "Assignee must be part of this agent's team." },
          { status: 400 }
        );
      }
    }
  }

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
      nextAssigneesForHistory = nextAssignees;
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
        if (r.task.status === "waiting" && reconciled.status !== "waiting") {
          resolved.patch.waiting_reminded_at = null;
        }
      }
    }
  }

  if (reassigning) {
    const nextAssignee = resolved.patch.assignee_email as string | null;
    const currentPrimaryAssignee = currentAssignees[0] ?? r.task.assignee_email ?? null;
    const assigneeActuallyChanged =
      nextAssignee !== currentPrimaryAssignee || currentAssignees.length > 1;
    if (assigneeActuallyChanged) {
      nextAssigneesForHistory = nextAssignee ? [nextAssignee] : [];
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
          .insert({ task_id: id, email: nextAssignee, created_at: nowIso });
        if (insertAssigneeError && !isTaskAssigneesMissingError(insertAssigneeError)) {
          return NextResponse.json({ error: insertAssigneeError.message }, { status: 500 });
        }
      }
    }
  }

  const finalStatus =
    typeof resolved.patch.status === "string"
      ? resolved.patch.status
      : r.task.status;
  const finalLeavingInProgress =
    finalStatus !== "in_progress" && r.task.status === "in_progress";
  if (finalLeavingInProgress && slaRules.length === 0) {
    const { data: rulesData, error: rulesError } = await r.supabase
      .from("task_sla_rules")
      .select("priority,category_id,duration_minutes");
    if (rulesError) return NextResponse.json({ error: rulesError.message }, { status: 500 });
    slaRules = rulesData ?? [];
  }

  // A task can leave In Progress while currently overdue without ever touching
  // /overdue-unlock — completing/cancelling/reassigning isn't the same as
  // continuing to work on it. Credit overdue_count (KPI) + stamp the permanent
  // overdue marker the FIRST time it's observed over budget, so it's counted
  // once regardless of whether the cron caught it first, and the "Overdue" tag
  // sticks on the card. transitions.ts already banked the In Progress seconds.
  const leavingOverdueInProgress =
    finalLeavingInProgress && isTaskOverdue(r.task, slaRules);
  if (leavingOverdueInProgress && !r.task.overdue_flagged_at) {
    resolved.patch.overdue_count = r.task.overdue_count + 1;
    resolved.patch.overdue_flagged_at = nowIso;
  }

  const { data, error } = await r.supabase
    .from("tasks")
    .update({ ...resolved.patch, updated_at: nowIso })
    .eq("id", id)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Everything below writes audit/history tables that don't depend on each
  // other's results — running them concurrently (instead of one after another)
  // meaningfully shortens the response time, which matters here: a slow
  // response widens the window where a realtime-triggered refetch on the
  // client can race the confirm and flash stale data (see updateTasks/
  // refetchTasks in TaskBoardClient.tsx for the client-side half of this).
  const entries = buildActivityEntries(
    {
      status: r.task.status,
      assignee_email: r.task.assignee_email,
      agent_email: r.task.agent_email,
      done_reviewed_at: r.task.done_reviewed_at,
    },
    resolved.patch
  );
  const newAssignee = resolved.patch.assignee_email as string | null | undefined;
  const notifyNewAssignee =
    newAssignee && newAssignee !== r.task.assignee_email && newAssignee !== r.actor.email;
  const shouldNotifyQcNeeded =
    (resolved.patch.status === "done" || resolved.patch.status === "cancel") &&
    r.task.status !== resolved.patch.status;
  const qcAgentEmail =
    typeof resolved.patch.agent_email === "string"
      ? resolved.patch.agent_email
      : r.task.agent_email;
  const qcRecipients = shouldNotifyQcNeeded
    ? (await fetchAgentOwnerAndAssistantEmails(qcAgentEmail)).filter(
        (recipient) => recipient !== r.actor.email
      )
    : [];

  await Promise.all([
    leavingOverdueInProgress
      ? resolveOverdueEvent(r.supabase, {
          task: r.task,
          dueAt: (currentStintDueAt(r.task, slaRules) ?? new Date(nowIso)).toISOString(),
          resolvedAt: nowIso,
          actorEmail: r.actor.email,
          reason: `Status changed to ${resolved.patch.status}`,
          slaMinutes: effectiveSlaMinutes(r.task, slaRules),
        })
      : null,
    recordStageTransition(r.supabase, {
      task: r.task,
      patch: resolved.patch,
      actorEmail: r.actor.email,
      nowIso,
    }),
    syncAssignmentCycles(r.supabase, {
      taskId: id,
      beforeEmails: beforeAssigneesForHistory,
      afterEmails: nextAssigneesForHistory,
      actorEmail: r.actor.email,
      nowIso,
      source: "patch",
    }),
    touchLastActivity(r.supabase, id, nowIso),
    entries.length > 0
      ? r.supabase.from("task_activity").insert(
          entries.map((e) => ({
            task_id: id,
            actor_email: r.actor.email,
            type: e.type,
            meta: e.meta,
          }))
        )
      : null,
    notifyNewAssignee
      ? insertNotifications([
          { recipient_email: newAssignee, task_id: id, type: "assigned", actor_email: r.actor.email },
        ])
      : null,
    qcRecipients.length > 0
      ? insertNotifications(
          qcRecipients.map((recipient) => ({
            recipient_email: recipient,
            task_id: id,
            type: "qc_needed",
            actor_email: r.actor.email,
          }))
        )
      : null,
  ]);

  await broadcastTasksChanged();
  await broadcastTaskRoom(id);
  const [task] = await attachAssigneesToTasks([data as TaskRow], r.supabase, {
    currentEmail: r.actor.email,
  });
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
