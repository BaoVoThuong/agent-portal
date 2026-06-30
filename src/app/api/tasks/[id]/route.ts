import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  buildTaskActor,
  canAssignToTask,
  canChangeTaskStatus,
  canDeleteTask,
  canMutateTask,
  canViewTask,
} from "@/lib/tasks/access";
import { resolveTaskPatch } from "@/lib/tasks/transitions";
import type { TaskRow } from "@/lib/tasks/types";
import { buildActivityEntries } from "@/lib/tasks/activity";
import { insertNotifications } from "@/lib/tasks/notifications";
import { removeTaskFiles } from "@/lib/tasks/storage";
import { broadcastTaskRoom, broadcastTasksChanged } from "@/lib/tasks/realtime";
import { fetchAgentsForCs } from "@/lib/tasks/membership";
import { isTaskParticipant } from "@/lib/tasks/participants";
import {
  attachAssigneesToTasks,
  fetchTaskAssigneeEmails,
  isTaskAssigneesMissingError,
  isTaskAssignee,
} from "@/lib/tasks/assignees";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const STATUS_PATCH_KEYS = new Set(["status", "waiting_reason", "position"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isStatusOnlyPatch(body: Record<string, unknown>): boolean {
  return Object.keys(body).every((key) => STATUS_PATCH_KEYS.has(key));
}

async function resolveTaskAccess(
  actor: ReturnType<typeof buildTaskActor>,
  task: Pick<TaskRow, "assignee_email" | "agent_email">,
  taskId: string
): Promise<{
  canView: boolean;
  isAgentMember: boolean;
  isAssignee: boolean;
  isParticipant: boolean;
}> {
  if (actor.isManager) {
    return { canView: true, isAgentMember: false, isAssignee: false, isParticipant: false };
  }
  const [isParticipant, isAssignee, agents] = await Promise.all([
    isTaskParticipant(taskId, actor.email),
    isTaskAssignee(taskId, actor.email),
    fetchAgentsForCs(actor.email),
  ]);
  const isAgentMember = Boolean(task.agent_email && agents.includes(task.agent_email));
  return {
    canView: canViewTask(actor, task, { isParticipant, isAgentMember, isAssignee }),
    isAgentMember,
    isAssignee,
    isParticipant,
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
  };
  const reassigning = bodyRecord.assignee_email !== undefined;

  const mayAssign = canAssignToTask(r.actor, access.isAgentMember);
  if (reassigning && !mayAssign) {
    return NextResponse.json({ error: "You cannot assign this task." }, { status: 403 });
  }

  const canMutate = canMutateTask(r.actor, r.task, access.isAssignee);
  let resolvedBody: unknown = body;
  if (!canMutate) {
    if (
      !isStatusOnlyPatch(bodyRecord) ||
      !canChangeTaskStatus(r.actor, r.task, {
        isAssignee: access.isAssignee,
      })
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }
    resolvedBody = bodyRecord;
  }

  const resolved = resolveTaskPatch(r.actor, currentForPatch, resolvedBody, { canAssign: mayAssign });
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: 400 });

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
  if (!canDeleteTask(r.actor))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  // Best-effort: remove attachment files from storage before the rows cascade away.
  const { data: atts } = await r.supabase
    .from("task_attachments")
    .select("storage_path")
    .eq("task_id", id);
  const paths = ((atts ?? []) as { storage_path: string }[]).map((a) => a.storage_path);
  if (paths.length > 0) {
    await removeTaskFiles(paths).catch(() => {});
  }

  // Hard delete. Child rows (comments, attachments, activity, notifications)
  // are removed by the `on delete cascade` foreign keys.
  const { error } = await r.supabase.from("tasks").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await broadcastTasksChanged();
  return NextResponse.json({ ok: true });
}
