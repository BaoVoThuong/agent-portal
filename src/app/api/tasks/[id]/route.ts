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
import {
  insertNotifications,
  uniqueNotificationRecipients,
  uniqueNotificationRows,
  type NotificationInsertInput,
} from "@/lib/tasks/notifications";
import {
  broadcastTaskRoom,
  broadcastTasksChanged,
  readTaskMutationSourceId,
} from "@/lib/tasks/realtime";
import {
  fetchAgentOwnerAndAssistantEmails,
  fetchAgentsForCs,
  isAgentOwnerOrAssistant,
} from "@/lib/tasks/membership";
import { isTaskParticipant } from "@/lib/tasks/participants";
import {
  attachAssigneesToTasks,
  fetchTaskAssigneeEmails,
  isEligibleTaskAssigneeEmail,
  isTaskAssignee,
} from "@/lib/tasks/assignees";
import {
  findMissingRequiredFieldsFromContext,
  missingRequiredFieldsMessage,
} from "@/lib/table-config/required";
import {
  customValueIssuesMessage,
  isCustomValueRecord,
  validateCustomValues,
  type CustomValueRecord,
} from "@/lib/table-config/custom-values";
import {
  fetchWriteValidationContext,
  TableConfigUnavailableError,
} from "@/lib/table-config/write-context";
import {
  invalidTaskCategoryResponse,
  isTaskCategoryId,
  mapTaskCategoryMutationError,
} from "@/lib/tasks/category-mutation";

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
  "custom_values",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
  const expectedUpdatedAt =
    typeof bodyRecord.expected_updated_at === "string" &&
    bodyRecord.expected_updated_at.trim() !== ""
      ? bodyRecord.expected_updated_at.trim()
      : null;
  if (!expectedUpdatedAt) {
    return NextResponse.json(
      { error: "expected_updated_at is required." },
      { status: 400 }
    );
  }
  if (expectedUpdatedAt !== r.task.updated_at) {
    return NextResponse.json(
      { error: "Task was updated by someone else. Refresh and try again." },
      { status: 409 }
    );
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
  let replaceAssigneesWith: string[] | null = null;

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

  const customValuesPresent = bodyRecord.custom_values !== undefined;
  let submittedCustomValues: CustomValueRecord = {};
  if (customValuesPresent) {
    if (!isCustomValueRecord(bodyRecord.custom_values)) {
      return NextResponse.json({ error: "Invalid custom values." }, { status: 400 });
    }
    submittedCustomValues = bodyRecord.custom_values;
  }
  const touchedSystemKeys = [
    ...(Object.prototype.hasOwnProperty.call(bodyRecord, "title") ? ["summary"] : []),
    ...(Object.prototype.hasOwnProperty.call(bodyRecord, "description") ? ["description"] : []),
    ...(Object.prototype.hasOwnProperty.call(bodyRecord, "fub_link") ? ["fub"] : []),
    ...(Object.prototype.hasOwnProperty.call(bodyRecord, "priority") ? ["priority"] : []),
    ...(Object.prototype.hasOwnProperty.call(bodyRecord, "category_id") ? ["category"] : []),
    ...(Object.prototype.hasOwnProperty.call(bodyRecord, "agent_email") ? ["agent"] : []),
  ];
  let writeContext: Awaited<ReturnType<typeof fetchWriteValidationContext>>;
  try {
    writeContext = await fetchWriteValidationContext({
      scope: "cs",
      mode: "patch",
      touchedSystemKeys,
      touchedCustomKeys: Object.keys(submittedCustomValues),
      submittedCustomValues,
    }, r.supabase);
  } catch (error) {
    if (error instanceof TableConfigUnavailableError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 503 });
    }
    throw error;
  }
  let validatedCustomValues: CustomValueRecord = {};
  if (customValuesPresent) {
    const validation = validateCustomValues(submittedCustomValues, writeContext);
    if (!validation.ok) {
      return NextResponse.json(
        { error: customValueIssuesMessage(validation.issues) },
        { status: 400 }
      );
    }
    validatedCustomValues = validation.values;
  }
  const transitionBody = customValuesPresent
    ? { ...bodyRecord, custom_values: validatedCustomValues }
    : bodyRecord;

  const resolved = resolveTaskPatch(r.actor, currentForPatch, transitionBody, {
    canAssign: capabilities.canAssign,
    canReviewDone: capabilities.canReviewQC,
    rules: slaRules,
    nowIso,
  });
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: 400 });
  if (
    reassigning &&
    typeof resolved.patch.assignee_email === "string" &&
    !(await isEligibleTaskAssigneeEmail(resolved.patch.assignee_email))
  ) {
    return NextResponse.json(
      { error: `Assignee is not eligible: ${resolved.patch.assignee_email}` },
      { status: 400 }
    );
  }

  if (customValuesPresent) {
    resolved.patch.custom_values = {
      ...(isRecord(r.task.custom_values) ? r.task.custom_values : {}),
      ...validatedCustomValues,
    };
  }

  // findMissingRequiredFields() keys fieldValues by table_column.key, not by
  // the tasks table's own column names — resolved.patch uses the latter
  // (title/category_id/agent_email/...), so translate only the few that
  // actually differ, and only when the patch actually touches them (so
  // `partial: true` below correctly ignores fields this request never sent —
  // a patch that never mentions Agent must not be blocked by Agent being
  // Required).
  const requiredFieldValues: Record<string, unknown> = {};
  if ("title" in resolved.patch) requiredFieldValues.summary = resolved.patch.title;
  if ("description" in resolved.patch) requiredFieldValues.description = resolved.patch.description;
  if ("fub_link" in resolved.patch) requiredFieldValues.fub = resolved.patch.fub_link;
  if ("priority" in resolved.patch) requiredFieldValues.priority = resolved.patch.priority;
  if ("category_id" in resolved.patch) requiredFieldValues.category = resolved.patch.category_id;
  if ("agent_email" in resolved.patch) requiredFieldValues.agent = resolved.patch.agent_email;
  const missingRequired = findMissingRequiredFieldsFromContext(writeContext, {
    fieldValues: requiredFieldValues,
    customValues: validatedCustomValues,
    partial: true,
  });
  if (missingRequired.length > 0) {
    return NextResponse.json(
      { error: missingRequiredFieldsMessage(missingRequired) },
      { status: 400 }
    );
  }

  if (
    Object.prototype.hasOwnProperty.call(resolved.patch, "category_id") &&
    resolved.patch.category_id !== null &&
    !isTaskCategoryId(resolved.patch.category_id)
  ) {
    return NextResponse.json(invalidTaskCategoryResponse(), { status: 400 });
  }

  if (reassigning) {
    const nextAssignee = resolved.patch.assignee_email as string | null;
    const currentPrimaryAssignee = currentAssignees[0] ?? r.task.assignee_email ?? null;
    const assigneeActuallyChanged =
      nextAssignee !== currentPrimaryAssignee || currentAssignees.length > 1;
    if (assigneeActuallyChanged) {
      nextAssigneesForHistory = nextAssignee ? [nextAssignee] : [];
      replaceAssigneesWith = nextAssignee ? [nextAssignee] : [];
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

  // Recipient lookup is non-authoritative and may fail independently. Keep
  // the warning but still let the atomic task command commit below.
  const mutationWarnings: string[] = [];

  // Build required audit rows before entering the database transaction. The
  // command below commits these rows together with the canonical task state.
  const entries = buildActivityEntries(
    {
      status: r.task.status,
      assignee_email: r.task.assignee_email,
      agent_email: r.task.agent_email,
      done_reviewed_at: r.task.done_reviewed_at,
    },
    resolved.patch
  );
  const assignmentChanged = replaceAssigneesWith !== null;
  const newlyAssignedRecipients = assignmentChanged
    ? uniqueNotificationRecipients(
        nextAssigneesForHistory.filter(
          (email) => !beforeAssigneesForHistory.includes(email)
        ),
        [r.actor.email]
      )
    : [];
  const unassignedRecipients = assignmentChanged
    ? uniqueNotificationRecipients(
        beforeAssigneesForHistory.filter(
          (email) => !nextAssigneesForHistory.includes(email)
        ),
        [r.actor.email]
      )
    : [];
  const shouldNotifyQcNeeded =
    (resolved.patch.status === "done" || resolved.patch.status === "cancel") &&
    r.task.status !== resolved.patch.status;
  const qcAgentEmail =
    typeof resolved.patch.agent_email === "string"
      ? resolved.patch.agent_email
      : r.task.agent_email;
  let qcRecipients: string[] = [];
  if (shouldNotifyQcNeeded) {
    try {
      qcRecipients = (await fetchAgentOwnerAndAssistantEmails(qcAgentEmail)).filter(
        (recipient) => recipient !== r.actor.email
      );
    } catch (error) {
      mutationWarnings.push(
        `QC recipient lookup failed: ${error instanceof Error ? error.message : "unknown error"}`
      );
    }
  }
  const qcReviewedRecipients =
    resolved.patch.done_reviewed_at && !r.task.done_reviewed_at
      ? uniqueNotificationRecipients(
          [...nextAssigneesForHistory, r.task.reporter_email],
          [r.actor.email]
        )
      : [];
  const cancelledRecipients =
    resolved.patch.status === "cancel" && r.task.status !== "cancel"
      ? uniqueNotificationRecipients(
          [...nextAssigneesForHistory, r.task.reporter_email],
          [r.actor.email, ...qcRecipients]
        )
      : [];
  const notificationRows: NotificationInsertInput[] = uniqueNotificationRows([
    ...newlyAssignedRecipients.map((recipient) => ({
      recipient_email: recipient,
      task_id: id,
      type: "assigned" as const,
      actor_email: r.actor.email,
    })),
    ...unassignedRecipients.map((recipient) => ({
      recipient_email: recipient,
      task_id: id,
      type: "unassigned" as const,
      actor_email: r.actor.email,
    })),
    ...qcRecipients.map((recipient) => ({
      recipient_email: recipient,
      task_id: id,
      type: "qc_needed" as const,
      actor_email: r.actor.email,
    })),
    ...qcReviewedRecipients.map((recipient) => ({
      recipient_email: recipient,
      task_id: id,
      type: "qc_reviewed" as const,
      actor_email: r.actor.email,
    })),
    ...cancelledRecipients.map((recipient) => ({
      recipient_email: recipient,
      task_id: id,
      type: "cancelled" as const,
      actor_email: r.actor.email,
    })),
  ]);

  const { data: atomicData, error: atomicError } = await r.supabase.rpc(
    "patch_task_atomic",
    {
      p_task_id: id,
      p_expected_updated_at: expectedUpdatedAt,
      p_patch: resolved.patch,
      p_before_assignees: beforeAssigneesForHistory,
      p_next_assignees: replaceAssigneesWith,
      p_actor_email: r.actor.email,
      p_activity: entries,
      p_overdue: leavingOverdueInProgress
        ? {
            due_at: (currentStintDueAt(r.task, slaRules) ?? new Date(nowIso)).toISOString(),
            resolved_at: nowIso,
            reason: `Status changed to ${resolved.patch.status}`,
            sla_minutes: effectiveSlaMinutes(r.task, slaRules),
          }
        : null,
      p_now: nowIso,
    }
  );
  if (atomicError) {
    if (atomicError.message.includes("TASK_CONFLICT")) {
      return NextResponse.json(
        { error: "Task was updated by someone else. Refresh and try again." },
        { status: 409 }
      );
    }
    if (atomicError.message.includes("TASK_NOT_FOUND")) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const categoryError = mapTaskCategoryMutationError(atomicError);
    if (categoryError) return NextResponse.json(categoryError, { status: 409 });
    return NextResponse.json({ error: atomicError.message }, { status: 500 });
  }
  if (!atomicData || typeof atomicData !== "object") {
    return NextResponse.json({ error: "Atomic task mutation returned no task." }, { status: 500 });
  }

  const data = atomicData as TaskRow;

  const notificationResults = await Promise.allSettled([
    notificationRows.length > 0 ? insertNotifications(notificationRows) : null,
  ]);
  for (const result of notificationResults) {
    if (result.status === "rejected" || result.value === false) {
      mutationWarnings.push(
        result.status === "rejected" && result.reason instanceof Error
          ? result.reason.message
          : "Task notification delivery failed."
      );
    }
  }

  const broadcastResults = await Promise.allSettled([
    broadcastTasksChanged(readTaskMutationSourceId(req)),
    broadcastTaskRoom(id),
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

  let task: TaskRow & { assignees: string[]; assignee_started_at: string | null } = {
    ...(data as TaskRow),
    assignees: nextAssigneesForHistory,
    assignee_started_at: null,
  };
  try {
    [task] = await attachAssigneesToTasks([data as TaskRow], r.supabase, {
      currentEmail: r.actor.email,
    });
  } catch (error) {
    mutationWarnings.push(
      `Task assignee reload failed: ${error instanceof Error ? error.message : "unknown error"}`
    );
  }
  if (mutationWarnings.length > 0) {
    console.error("Task mutation committed with side-effect warnings", {
      taskId: id,
      warnings: mutationWarnings,
    });
  }
  return NextResponse.json({ task, warnings: mutationWarnings });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const { id } = await params;
  const r = await loadActorAndTask(id);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const isAgentOwner = r.actor.isManager
    ? false
    : await isAgentOwnerOrAssistant(r.task.agent_email, r.actor.email);
  if (!canDeleteTask(r.actor, isAgentOwner))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const expectedUpdatedAt =
    typeof body?.expected_updated_at === "string" && body.expected_updated_at.trim() !== ""
      ? body.expected_updated_at.trim()
      : "";
  if (!expectedUpdatedAt) {
    return NextResponse.json({ error: "expected_updated_at is required." }, { status: 400 });
  }

  // Soft-delete (archive), not a hard delete: a hard delete would cascade away
  // task_activity — including the overdue/reopen history now used for KPI
  // reporting. Archived tasks are already excluded from board queries
  // (fetchTasksForActor filters `archived_at is null`); nothing else changes.
  const nowIso = new Date().toISOString();
  const { data, error } = await r.supabase
    .from("tasks")
    .update({
      archived_at: nowIso,
      updated_at: nowIso,
      last_activity_at: nowIso,
      last_activity_by_email: r.actor.email,
    })
    .eq("id", id)
    .eq("updated_at", expectedUpdatedAt)
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) {
    return NextResponse.json(
      { error: "Task was updated by someone else. Refresh and try again." },
      { status: 409 }
    );
  }

  const warnings: string[] = [];
  const broadcastResult = await Promise.allSettled([
    broadcastTasksChanged(readTaskMutationSourceId(req)),
  ]);
  const taskBroadcast = broadcastResult[0];
  if (
    taskBroadcast?.status === "rejected" ||
    (taskBroadcast?.status === "fulfilled" && !taskBroadcast.value)
  ) {
    warnings.push(
      taskBroadcast?.status === "rejected" && taskBroadcast.reason instanceof Error
        ? taskBroadcast.reason.message
        : "Task broadcast failed."
    );
  }
  return NextResponse.json({ ok: true, warnings });
}
