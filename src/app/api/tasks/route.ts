import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  buildTaskActor,
  isTaskViewAdmin,
  canAccessBoard,
  canCreateTaskWithScope,
  resolveCreateAssignment,
} from "@/lib/tasks/access";
import {
  attachAssigneesToTasks,
  findIneligibleTaskAssigneeEmail,
} from "@/lib/tasks/assignees";
import {
  fetchTasksForActor,
  TaskListTruncatedError,
} from "@/lib/tasks/queries";
import { midpoint } from "@/lib/tasks/ordering";
import { TASK_PRIORITIES, TASK_STATUSES, type TaskRow } from "@/lib/tasks/types";
import { broadcastTasksChanged } from "@/lib/tasks/realtime";
import {
  fetchAdminEmails,
  fetchAgentOwnerAndAssistantEmails,
  fetchAgentsForCs,
  isAgentOwnerOrAssistant,
} from "@/lib/tasks/membership";
import {
  insertNotifications,
  uniqueNotificationRecipients,
  uniqueNotificationRows,
  type NotificationInsertInput,
} from "@/lib/tasks/notifications";
import { resolveSlaMinutes } from "@/lib/tasks/sla";
import { bumpAssignmentRotation } from "@/lib/tasks/rotation";
import { settleSideEffects } from "@/lib/tasks/mutation-result";
import {
  findMissingRequiredFieldsFromContext,
  missingRequiredFieldsMessage,
} from "@/lib/table-config/required";
import {
  customValueIssuesMessage,
  isCustomValueRecord,
  validateCustomValues,
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const actor = buildTaskActor(session.user.permissions, email, {
    isAdmin: isTaskViewAdmin(session.user),
  });
  if (!canAccessBoard(actor))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const tasks = await fetchTasksForActor(actor);
    return NextResponse.json({ tasks });
  } catch (error) {
    if (error instanceof TaskListTruncatedError) {
      return NextResponse.json(
        {
          error: error.message,
          code: "TASK_LIST_TRUNCATED",
          total: error.total,
          loaded: error.loaded,
        },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load tasks." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const actor = buildTaskActor(session.user.permissions, email, {
    isAdmin: isTaskViewAdmin(session.user),
  });
  if (!canAccessBoard(actor))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  if (!title) return NextResponse.json({ error: "Title is required." }, { status: 400 });

  const priority: (typeof TASK_PRIORITIES)[number] =
    typeof body?.priority === "string" &&
    (TASK_PRIORITIES as readonly string[]).includes(body.priority)
      ? (body.priority as (typeof TASK_PRIORITIES)[number])
      : "medium";
  const agentEmail =
    typeof body?.agent_email === "string" && body.agent_email.trim() !== ""
      ? body.agent_email.trim()
      : null;
  if (!agentEmail) {
    return NextResponse.json({ error: "Agent is required." }, { status: 400 });
  }
  let hasAgentScope = false;
  if (!actor.isManager) {
    hasAgentScope = await isAgentOwnerOrAssistant(agentEmail, email);
    const allowedAgents = await fetchAgentsForCs(email);
    if (!allowedAgents.includes(agentEmail) && !hasAgentScope) {
      return NextResponse.json(
        { error: "You cannot create tasks for this agent." },
        { status: 403 }
      );
    }
  }
  if (!canCreateTaskWithScope(actor, hasAgentScope)) {
    return NextResponse.json(
      { error: "Customer Service cannot create tasks." },
      { status: 403 }
    );
  }

  const requestedStatus =
    typeof body?.status === "string" &&
    (TASK_STATUSES as readonly string[]).includes(body.status)
      ? body.status
      : "backlog";
  const requestedAssignees = Array.isArray(body?.assignees)
    ? [
        ...new Set(
          body.assignees
            .map((value: unknown) => (typeof value === "string" ? value.trim() : ""))
            .filter(Boolean)
        ),
      ]
    : typeof body?.assignee_email === "string" && body.assignee_email.trim() !== ""
      ? [body.assignee_email.trim()]
      : [];
  const assignment = resolveCreateAssignment(
    actor,
    { assignee_email: requestedAssignees[0] ?? null, status: requestedStatus },
    { hasAgentScope }
  );
  if (!assignment.ok)
    return NextResponse.json({ error: assignment.error }, { status: 400 });
  const elevated = actor.isManager || hasAgentScope;
  const assignedEmails = elevated ? requestedAssignees : [email];
  const ineligibleAssignee = await findIneligibleTaskAssigneeEmail(assignedEmails);
  if (ineligibleAssignee) {
    return NextResponse.json(
      { error: `Assignee is not eligible: ${ineligibleAssignee}` },
      { status: 400 }
    );
  }
  const fubLink =
    typeof body?.fub_link === "string" && body.fub_link.trim() !== ""
      ? body.fub_link.trim()
      : null;
  const description =
    typeof body?.description === "string" && body.description.trim() !== ""
      ? body.description.trim()
      : null;
  const categoryId =
    typeof body?.category_id === "string" && body.category_id.trim() !== ""
      ? body.category_id.trim()
      : null;
  if (!categoryId) {
    return NextResponse.json({ error: "Category is required." }, { status: 400 });
  }
  if (!isTaskCategoryId(categoryId)) {
    return NextResponse.json(invalidTaskCategoryResponse(), { status: 400 });
  }
  const supabase = getSupabaseAdmin();
  let customValues: Record<string, unknown> = {};
  if (body?.custom_values !== undefined) {
    if (!isCustomValueRecord(body.custom_values)) {
      return NextResponse.json(
        { error: "Invalid custom values." },
        { status: 400 }
      );
    }
    customValues = body.custom_values;
  }
  let writeContext;
  try {
    writeContext = await fetchWriteValidationContext({
      scope: "cs",
      mode: "create",
      touchedSystemKeys: ["summary", "description", "fub", "priority", "category", "agent"],
      touchedCustomKeys: Object.keys(customValues),
      submittedCustomValues: customValues,
    }, supabase);
  } catch (error) {
    if (error instanceof TableConfigUnavailableError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 503 });
    }
    throw error;
  }
  const customValueValidation = body?.custom_values === undefined
    ? { ok: true as const, values: {} }
    : validateCustomValues(customValues, writeContext);
  if (!customValueValidation.ok) {
    return NextResponse.json(
      { error: customValueIssuesMessage(customValueValidation.issues) },
      { status: 400 }
    );
  }
  customValues = customValueValidation.values;
  // Title/Agent/Category are validated above with field-specific messages;
  // this additionally covers any OTHER column an admin has marked Required —
  // The write context reads live table_column rows, so WHICH fields get checked
  // is 100% driven by Config, not this file. This
  // object only needs to name every CS system column that has a real
  // Create-time input at all (table_column.key on the left — not the DB
  // column name, that would only make sense by coincidence for a couple of
  // these), so a required column always has somewhere to read its value from
  // — see REQUIRED_CAPABLE_SYSTEM_KEYS.cs in src/lib/table-config/columns.ts
  // for that full list. Leaving one out here means Config would let an admin
  // mark it Required while nothing could ever satisfy it (this is exactly
  // how Priority broke Create on 2026-08-07 — see changelog.md).
  const missingRequired = findMissingRequiredFieldsFromContext(writeContext, {
    fieldValues: {
      summary: title,
      description,
      fub: fubLink,
      priority,
      category: categoryId,
      agent: agentEmail,
    },
    customValues,
  });
  if (missingRequired.length > 0) {
    return NextResponse.json(
      { error: missingRequiredFieldsMessage(missingRequired) },
      { status: 400 }
    );
  }

  // Place new card at the bottom of its column.
  const { data: last } = await supabase
    .from("tasks")
    .select("position")
    .eq("status", assignment.status)
    .is("archived_at", null)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const position = midpoint((last as { position: number } | null)?.position ?? null, null);
  const nowIso = new Date().toISOString();
  const startingTodo = assignment.status === "todo";
  const startingInProgress = assignment.status === "in_progress";
  const startingWaiting = assignment.status === "waiting";
  const startingClosed = assignment.status === "done" || assignment.status === "cancel";
  const shouldLoadSlaRules = startingInProgress || assignedEmails.length > 0;
  const { data: rulesData, error: rulesError } = shouldLoadSlaRules
    ? await supabase.from("task_sla_rules").select("priority,category_id,duration_minutes")
    : { data: null, error: null };
  if (rulesError) return NextResponse.json({ error: rulesError.message }, { status: 500 });
  const slaMinutes = startingInProgress
    ? resolveSlaMinutes(priority, categoryId, rulesData ?? [])
    : null;
  const clientRequestId =
    typeof body?.client_request_id === "string" && body.client_request_id.trim() !== ""
      ? body.client_request_id.trim()
      : null;
  if (clientRequestId !== null && !UUID_RE.test(clientRequestId)) {
    return NextResponse.json({ error: "Invalid request id." }, { status: 400 });
  }
  const taskPayload = {
    title,
    description,
    fub_link: fubLink,
    status: assignment.status,
    priority,
    agent_email: agentEmail,
    assignee_email: assignment.assignee_email,
    category_id: categoryId,
    custom_values: customValues,
    position,
    sla_minutes: slaMinutes,
    ...(startingTodo ? { todo_started_at: nowIso } : {}),
    ...(startingInProgress ? { in_progress_at: nowIso } : {}),
    ...(startingWaiting ? { waiting_started_at: nowIso } : {}),
    ...(startingClosed ? { closed_at: nowIso } : {}),
  };
  const { data: created, error: createError } = await supabase
    .rpc("create_task_atomic", {
      p_task: taskPayload,
      p_assignees: assignedEmails,
      p_actor_email: email,
      p_client_request_id: clientRequestId,
    })
    .single();
  if (createError) {
    if (createError.message.includes("TASK_ACTOR_REQUIRED")) {
      return NextResponse.json({ error: "Task actor is required." }, { status: 400 });
    }
    if (createError.message.includes("TASK_TITLE_REQUIRED")) {
      return NextResponse.json({ error: "Title is required." }, { status: 400 });
    }
    const categoryError = mapTaskCategoryMutationError(createError);
    if (categoryError) return NextResponse.json(categoryError, { status: 409 });
    return NextResponse.json({ error: createError.message }, { status: 500 });
  }
  const result = created as {
    task: TaskRow;
    was_created: boolean;
  };
  const data = result.task;
  const taskId = data.id;
  const warnings = result.was_created
    ? await settleSideEffects([
        ...(assignedEmails.length > 0
          ? [
              {
                code: "rotation_failed",
                message: "The task was saved but assignment rotation could not be updated.",
                run: () =>
                  Promise.all(
                    assignedEmails.map((assigneeEmail) =>
                      bumpAssignmentRotation(
                        supabase,
                        assigneeEmail,
                        data,
                        rulesData ?? [],
                        new Date(nowIso)
                      )
                    )
                  ),
              },
            ]
          : []),
        {
          code: "notification_failed",
          message: "The task was saved but some people may not have been notified.",
          run: async () => {
            const assignedRecipients = assignedEmails.filter(
              (assigneeEmail) => assigneeEmail !== email
            );
            const backlogNeedsAttention =
              assignedEmails.length === 0 &&
              assignment.status === "backlog" &&
              (priority === "urgent" || priority === "high");
            const backlogAttentionRecipients = backlogNeedsAttention
              ? uniqueNotificationRecipients(
                  [
                    ...(await fetchAgentOwnerAndAssistantEmails(agentEmail)),
                    ...(await fetchAdminEmails()),
                  ],
                  [email]
                )
              : [];
            const notificationRows: NotificationInsertInput[] = uniqueNotificationRows([
              ...assignedRecipients.map((assigneeEmail) => ({
                recipient_email: assigneeEmail,
                task_id: taskId,
                type: "assigned" as const,
                actor_email: email,
              })),
              ...backlogAttentionRecipients.map((recipient) => ({
                recipient_email: recipient,
                task_id: taskId,
                type: "backlog_attention" as const,
                actor_email: email,
                detail: `${priority} backlog task needs assignment`,
              })),
            ]);
            if (notificationRows.length > 0) await insertNotifications(notificationRows);
          },
        },
        {
          code: "broadcast_failed",
          message: "Other open task boards may need a refresh to see this task.",
          run: () => broadcastTasksChanged(),
        },
      ])
    : [];

  let task = data;
  try {
    [task] = await attachAssigneesToTasks([data], supabase, { currentEmail: email });
  } catch (error) {
    warnings.push({
      code: "task_reload_failed",
      message: "The task was saved but its assignee display needs a refresh.",
    });
    console.warn("Task create reconciliation failed", error);
  }
  return NextResponse.json({ task, warnings }, { status: result.was_created ? 201 : 200 });
}
