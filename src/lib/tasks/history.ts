import type { SupabaseClient } from "@supabase/supabase-js";
import { slaDeadline } from "./sla";
import type { TaskRow, TaskStatus } from "./types";

type TaskTimingRow = Pick<
  TaskRow,
  | "id"
  | "status"
  | "todo_started_at"
  | "in_progress_at"
  | "waiting_started_at"
  | "closed_at"
  | "sla_minutes"
  | "created_at"
  | "updated_at"
  | "overdue_flagged_at"
>;

type OpenStageCycle = { id: string; started_at: string };
type OpenOverdueEvent = { id: string; overdue_at: string };
type SupabaseErrorLike = { code?: string; message?: string };

function isUniqueViolation(error: SupabaseErrorLike): boolean {
  return error.code === "23505";
}

function durationSeconds(startIso: string, endIso: string): number {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.round((end - start) / 1000));
}

function stageStartedAt(task: TaskTimingRow, stage: TaskStatus = task.status): string {
  if (stage === "todo") {
    return task.todo_started_at ?? task.updated_at ?? task.created_at;
  }
  if (stage === "in_progress") {
    return task.in_progress_at ?? task.updated_at ?? task.created_at;
  }
  if (stage === "waiting") {
    return task.waiting_started_at ?? task.updated_at ?? task.created_at;
  }
  if (stage === "done" || stage === "cancel") {
    return task.closed_at ?? task.updated_at ?? task.created_at;
  }
  return task.created_at;
}

function stageStartedAtFromPatch(
  task: TaskTimingRow,
  patch: Record<string, unknown>,
  stage: TaskStatus,
  nowIso: string
): string {
  if (stage === "todo" && typeof patch.todo_started_at === "string") {
    return patch.todo_started_at;
  }
  if (stage === "in_progress" && typeof patch.in_progress_at === "string") {
    return patch.in_progress_at;
  }
  if (stage === "waiting" && typeof patch.waiting_started_at === "string") {
    return patch.waiting_started_at;
  }
  if ((stage === "done" || stage === "cancel") && typeof patch.closed_at === "string") {
    return patch.closed_at;
  }
  return nowIso;
}

function dueAtFor(stage: TaskStatus, startedAt: string, slaMinutes: number | null): string | null {
  if (stage !== "in_progress" || typeof slaMinutes !== "number") return null;
  return slaDeadline(startedAt, slaMinutes).toISOString();
}

async function findOpenStageCycle(
  supabase: SupabaseClient,
  taskId: string,
  stage: TaskStatus
): Promise<OpenStageCycle | null> {
  const { data, error } = await supabase
    .from("task_stage_cycles")
    .select("id,started_at")
    .eq("task_id", taskId)
    .eq("stage", stage)
    .is("ended_at", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as OpenStageCycle | null) ?? null;
}

async function closeStageCycle(
  supabase: SupabaseClient,
  task: TaskTimingRow,
  endedAt: string,
  actorEmail: string,
  toStatus: TaskStatus
): Promise<void> {
  const startedAt = stageStartedAt(task);
  const openCycle = await findOpenStageCycle(supabase, task.id, task.status);
  if (openCycle) {
    const { error } = await supabase
      .from("task_stage_cycles")
      .update({
        ended_at: endedAt,
        duration_seconds: durationSeconds(openCycle.started_at, endedAt),
        ended_by_email: actorEmail,
        to_status: toStatus,
      })
      .eq("id", openCycle.id);
    if (error) throw new Error(error.message);
    return;
  }

  const { error } = await supabase.from("task_stage_cycles").insert({
    task_id: task.id,
    stage: task.status,
    started_at: startedAt,
    ended_at: endedAt,
    duration_seconds: durationSeconds(startedAt, endedAt),
    ended_by_email: actorEmail,
    to_status: toStatus,
    sla_minutes: task.status === "in_progress" ? task.sla_minutes : null,
    due_at: dueAtFor(task.status, startedAt, task.sla_minutes),
    meta: { source: "fallback-close" },
  });
  if (error && !isUniqueViolation(error)) throw new Error(error.message);
}

async function startStageCycle(
  supabase: SupabaseClient,
  params: {
    taskId: string;
    stage: TaskStatus;
    startedAt: string;
    actorEmail: string;
    fromStatus: TaskStatus | null;
    slaMinutes?: number | null;
    meta?: Record<string, unknown> | null;
  }
): Promise<void> {
  const { error } = await supabase.from("task_stage_cycles").insert({
    task_id: params.taskId,
    stage: params.stage,
    started_at: params.startedAt,
    started_by_email: params.actorEmail,
    from_status: params.fromStatus,
    sla_minutes: params.stage === "in_progress" ? params.slaMinutes ?? null : null,
    due_at: dueAtFor(params.stage, params.startedAt, params.slaMinutes ?? null),
    meta: params.meta ?? null,
  });
  if (error && !isUniqueViolation(error)) throw new Error(error.message);
}

export async function recordInitialTaskHistory(
  supabase: SupabaseClient,
  task: TaskTimingRow,
  actorEmail: string,
  assignedEmails: string[],
  nowIso: string
): Promise<void> {
  await startStageCycle(supabase, {
    taskId: task.id,
    stage: task.status,
    startedAt: stageStartedAt(task),
    actorEmail,
    fromStatus: null,
    slaMinutes: task.sla_minutes,
    meta: { source: "create" },
  });
  await syncAssignmentCycles(supabase, {
    taskId: task.id,
    beforeEmails: [],
    afterEmails: assignedEmails,
    actorEmail,
    nowIso,
    source: "create",
  });
}

export async function recordStageTransition(
  supabase: SupabaseClient,
  params: {
    task: TaskTimingRow;
    patch: Record<string, unknown>;
    actorEmail: string;
    nowIso: string;
  }
): Promise<void> {
  const nextStatus = params.patch.status;
  if (typeof nextStatus !== "string" || nextStatus === params.task.status) return;

  await closeStageCycle(
    supabase,
    params.task,
    params.nowIso,
    params.actorEmail,
    nextStatus as TaskStatus
  );
  await startStageCycle(supabase, {
    taskId: params.task.id,
    stage: nextStatus as TaskStatus,
    startedAt: stageStartedAtFromPatch(
      params.task,
      params.patch,
      nextStatus as TaskStatus,
      params.nowIso
    ),
    actorEmail: params.actorEmail,
    fromStatus: params.task.status,
    slaMinutes:
      nextStatus === "in_progress"
        ? ((params.patch.sla_minutes as number | undefined) ?? params.task.sla_minutes)
        : null,
  });
}

export async function syncAssignmentCycles(
  supabase: SupabaseClient,
  params: {
    taskId: string;
    beforeEmails: string[];
    afterEmails: string[];
    actorEmail: string;
    nowIso: string;
    source: string;
  }
): Promise<void> {
  const before = new Set(params.beforeEmails);
  const after = new Set(params.afterEmails);
  const removed = [...before].filter((email) => !after.has(email));
  const added = [...after].filter((email) => !before.has(email));

  await Promise.all(
    removed.map(async (email) => {
      const { error } = await supabase
        .from("task_assignment_cycles")
        .update({
          unassigned_at: params.nowIso,
          unassigned_by_email: params.actorEmail,
          source: params.source,
        })
        .eq("task_id", params.taskId)
        .eq("email", email)
        .is("unassigned_at", null);
      if (error) throw new Error(error.message);
    })
  );

  await Promise.all(
    added.map(async (email) => {
      const { error } = await supabase.from("task_assignment_cycles").insert({
        task_id: params.taskId,
        email,
        assigned_at: params.nowIso,
        assigned_by_email: params.actorEmail,
        source: params.source,
      });
      if (error && !isUniqueViolation(error)) throw new Error(error.message);
    })
  );
}

async function currentInProgressCycleId(
  supabase: SupabaseClient,
  taskId: string
): Promise<string | null> {
  const openCycle = await findOpenStageCycle(supabase, taskId, "in_progress");
  return openCycle?.id ?? null;
}

async function findOpenOverdueEvent(
  supabase: SupabaseClient,
  taskId: string
): Promise<OpenOverdueEvent | null> {
  const { data, error } = await supabase
    .from("task_overdue_events")
    .select("id,overdue_at")
    .eq("task_id", taskId)
    .is("resolved_at", null)
    .order("overdue_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as OpenOverdueEvent | null) ?? null;
}

export async function openOverdueEvent(
  supabase: SupabaseClient,
  params: {
    taskId: string;
    dueAt: string;
    overdueAt: string;
    slaMinutes: number;
  }
): Promise<void> {
  const existing = await findOpenOverdueEvent(supabase, params.taskId);
  if (existing) return;

  const { error } = await supabase.from("task_overdue_events").insert({
    task_id: params.taskId,
    stage_cycle_id: await currentInProgressCycleId(supabase, params.taskId),
    due_at: params.dueAt,
    overdue_at: params.overdueAt,
    sla_minutes: params.slaMinutes,
  });
  if (error && !isUniqueViolation(error)) throw new Error(error.message);
}

export async function resolveOverdueEvent(
  supabase: SupabaseClient,
  params: {
    task: TaskTimingRow;
    dueAt: string;
    resolvedAt: string;
    actorEmail: string;
    reason: string;
    slaMinutes: number;
  }
): Promise<void> {
  const existing = await findOpenOverdueEvent(supabase, params.task.id);
  const overdueAt = existing?.overdue_at ?? params.task.overdue_flagged_at ?? params.dueAt;
  const overdueSeconds = durationSeconds(params.dueAt, params.resolvedAt);
  if (existing) {
    const { error } = await supabase
      .from("task_overdue_events")
      .update({
        stage_cycle_id: await currentInProgressCycleId(supabase, params.task.id),
        resolved_at: params.resolvedAt,
        overdue_seconds: overdueSeconds,
        resolved_by_email: params.actorEmail,
        reason: params.reason,
        sla_minutes: params.slaMinutes,
      })
      .eq("id", existing.id);
    if (error) throw new Error(error.message);
    return;
  }

  const { error } = await supabase.from("task_overdue_events").insert({
    task_id: params.task.id,
    stage_cycle_id: await currentInProgressCycleId(supabase, params.task.id),
    due_at: params.dueAt,
    overdue_at: overdueAt,
    resolved_at: params.resolvedAt,
    overdue_seconds: overdueSeconds,
    resolved_by_email: params.actorEmail,
    reason: params.reason,
    sla_minutes: params.slaMinutes,
  });
  if (error && !isUniqueViolation(error)) throw new Error(error.message);
}
