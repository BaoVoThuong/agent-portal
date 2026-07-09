import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  buildTaskActor,
  canAccessBoard,
  canCreateTaskWithScope,
  resolveCreateAssignment,
} from "@/lib/tasks/access";
import { attachAssigneesToTasks, isTaskAssigneesMissingError } from "@/lib/tasks/assignees";
import { fetchTasksForActor } from "@/lib/tasks/queries";
import { midpoint } from "@/lib/tasks/ordering";
import { TASK_PRIORITIES, TASK_STATUSES } from "@/lib/tasks/types";
import { broadcastTasksChanged } from "@/lib/tasks/realtime";
import { fetchAgentsForCs, fetchCsForAgent, isAgentOwnerOrAssistant } from "@/lib/tasks/membership";
import { insertNotifications } from "@/lib/tasks/notifications";
import { resolveSlaMinutes } from "@/lib/tasks/sla";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const actor = buildTaskActor(session.user.permissions, email);
  if (!canAccessBoard(actor))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const tasks = await fetchTasksForActor(actor);
  return NextResponse.json({ tasks });
}

export async function POST(request: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const actor = buildTaskActor(session.user.permissions, email);
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
  if (elevated && assignedEmails.length > 0 && !actor.isManager) {
    // Free choice is still bounded to the agent's own team, same restriction
    // the assignee picker UI enforces — reject anything outside it rather
    // than silently dropping/ignoring an out-of-scope pick.
    const teamEmails = new Set(await fetchCsForAgent(agentEmail));
    const outOfScope = assignedEmails.filter(
      (assigneeEmail) => assigneeEmail !== agentEmail && !teamEmails.has(assigneeEmail)
    );
    if (outOfScope.length > 0) {
      return NextResponse.json(
        { error: "Assignee must be part of this agent's team." },
        { status: 400 }
      );
    }
  }
  const fubLink =
    typeof body?.fub_link === "string" && body.fub_link.trim() !== ""
      ? body.fub_link.trim()
      : null;
  const categoryId =
    typeof body?.category_id === "string" && body.category_id.trim() !== ""
      ? body.category_id.trim()
      : null;
  if (!categoryId) {
    return NextResponse.json({ error: "Category is required." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
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
  const startingInProgress = assignment.status === "in_progress";
  const startingWaiting = assignment.status === "waiting";
  const startingClosed = assignment.status === "done" || assignment.status === "cancel";
  const { data: rulesData, error: rulesError } = startingInProgress
    ? await supabase.from("task_sla_rules").select("priority,category_id,duration_minutes")
    : { data: null, error: null };
  if (rulesError) return NextResponse.json({ error: rulesError.message }, { status: 500 });
  const slaMinutes = startingInProgress
    ? resolveSlaMinutes(priority, categoryId, rulesData ?? [])
    : null;

  const { data, error } = await supabase
    .from("tasks")
    .insert({
      title,
      description:
        typeof body?.description === "string" && body.description.trim() !== ""
          ? body.description.trim()
          : null,
      fub_link: fubLink,
      status: assignment.status,
      priority,
      agent_email: agentEmail,
      assignee_email: assignment.assignee_email,
      reporter_email: email,
      category_id: categoryId,
      position,
      ...(startingInProgress
        ? { in_progress_at: nowIso, overdue_flagged_at: null, sla_minutes: slaMinutes }
        : {}),
      ...(startingWaiting ? { waiting_started_at: nowIso, waiting_reminded_at: null } : {}),
      ...(startingClosed ? { closed_at: nowIso } : {}),
    })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const taskId = (data as { id: string }).id;
  if (assignedEmails.length > 0) {
    const { error: assigneeError } = await supabase.from("task_assignees").insert(
      assignedEmails.map((assigneeEmail) => ({
        task_id: taskId,
        email: assigneeEmail,
      }))
    );
    if (assigneeError && !isTaskAssigneesMissingError(assigneeError)) {
      return NextResponse.json({ error: assigneeError.message }, { status: 500 });
    }
  }

  await supabase.from("task_activity").insert({
    task_id: taskId,
    actor_email: email,
    type: "created",
    meta: assignedEmails.length > 0 ? { to: assignedEmails } : null,
  });

  const assignedRecipients = assignedEmails.filter(
    (assigneeEmail) => assigneeEmail !== email
  );
  await insertNotifications(
    assignedRecipients.map((assigneeEmail) => ({
      recipient_email: assigneeEmail,
      task_id: taskId,
      type: "assigned",
      actor_email: email,
    }))
  );

  const [task] = await attachAssigneesToTasks(
    [data as { id: string; assignee_email: string | null }],
    supabase,
    { currentEmail: email }
  );
  await broadcastTasksChanged();
  return NextResponse.json({ task });
}
