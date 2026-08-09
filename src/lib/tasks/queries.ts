import { getSupabaseAdmin } from "@/lib/supabase";
import {
  attachAssigneesToTasks,
  fetchAssignedTaskIdsForEmail,
  fetchSelectedAgentEmails,
} from "./assignees";
import { canViewTask } from "./access";
import { fetchAgentsForCs, fetchAssistantAgentsForCs } from "./membership";
import { fetchParticipantTaskIds } from "./participants";
import type { TaskActor, TaskRow } from "./types";

export const TASK_LIST_COUNT_MODE = "exact" as const;

export const TASK_COLUMNS =
  "id,title,description,fub_link,status,priority,category_id,custom_values,agent_email,assignee_email,reporter_email,todo_started_at,todo_reminded_at,in_progress_at,overdue_flagged_at,waiting_started_at,waiting_reminded_at,overdue_reminded_at,overdue_unlocked_at,due_soon_notified_at,stale_reminded_at,qc_reminded_at,last_activity_at,reopened_at,sla_minutes,overdue_count,todo_seconds,in_progress_seconds,waiting_seconds,done_reviewed_by_email,done_reviewed_at,closed_at,position,created_at,updated_at,archived_at";
const TASK_COLUMNS_LEGACY =
  "id,title,description,fub_link,status,priority,category_id,agent_email,assignee_email,reporter_email,todo_started_at,todo_reminded_at,in_progress_at,overdue_flagged_at,waiting_started_at,waiting_reminded_at,overdue_reminded_at,overdue_unlocked_at,due_soon_notified_at,stale_reminded_at,qc_reminded_at,last_activity_at,reopened_at,sla_minutes,overdue_count,todo_seconds,in_progress_seconds,waiting_seconds,done_reviewed_by_email,done_reviewed_at,closed_at,position,created_at,updated_at,archived_at";

// Values inside PostgREST `.or()`/`.in()` expressions are still parsed as
// filter grammar. Quote and escape them so session/DB identities remain data.
export function quotePostgrestFilterValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export async function fetchTasksForActor(actor: TaskActor): Promise<TaskRow[]> {
  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("tasks")
    .select(TASK_COLUMNS, { count: TASK_LIST_COUNT_MODE })
    .is("archived_at", null)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  let workerScope:
    | {
      agents: string[];
      assistantAgents: string[];
      assignedIds: string[];
      participantIds: string[];
    }
    | null = null;
  // Manager and plain-CS see the shared company queue. Agent/assistant users
  // keep the narrower agent-scope view.
  let seeAll = actor.isManager;
  if (!actor.isManager) {
    const [selectedAgentEmails, assistantAgents] = await Promise.all([
      fetchSelectedAgentEmails(),
      fetchAssistantAgentsForCs(actor.email),
    ]);
    const isAgent = selectedAgentEmails.has(actor.email);
    const isAssistant = assistantAgents.length > 0;
    seeAll = !isAgent && !isAssistant;
    if (!seeAll) {
      const [agents, assignedIds, participantIds] = await Promise.all([
        fetchAgentsForCs(actor.email),
        fetchAssignedTaskIdsForEmail(actor.email, supabase),
        fetchParticipantTaskIds(actor.email),
      ]);
      workerScope = { agents, assistantAgents, assignedIds, participantIds };
      const quotedEmail = quotePostgrestFilterValue(actor.email);
      const ors: string[] = [
        `assignee_email.eq.${quotedEmail}`,
        `agent_email.eq.${quotedEmail}`,
      ];
      if (agents.length > 0) {
        ors.push(
          `agent_email.in.(${agents.map(quotePostgrestFilterValue).join(",")})`
        );
      }
      if (assignedIds.length > 0) {
        ors.push(
          `id.in.(${assignedIds.map(quotePostgrestFilterValue).join(",")})`
        );
      }
      if (participantIds.length > 0) {
        ors.push(
          `id.in.(${participantIds.map(quotePostgrestFilterValue).join(",")})`
        );
      }
      query =
        ors.length > 0
          ? query.or(ors.join(","))
          : query.eq("id", "00000000-0000-0000-0000-000000000000");
    }
  }

  const result = await query;
  let rows = result.data as unknown[] | null;
  let queryError = result.error as { code?: string; message?: string } | null;
  if (isMissingTaskCustomValuesColumn(queryError)) {
    let fallback = supabase
      .from("tasks")
      .select(TASK_COLUMNS_LEGACY, { count: TASK_LIST_COUNT_MODE })
      .is("archived_at", null)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (!seeAll) {
      const scopedOrs = buildWorkerTaskOrs(actor.email, workerScope);
      fallback =
        scopedOrs.length > 0
          ? fallback.or(scopedOrs.join(","))
          : fallback.eq("id", "00000000-0000-0000-0000-000000000000");
    }
    const fallbackResult = await fallback;
    rows = fallbackResult.data as unknown[] | null;
    queryError = fallbackResult.error as { code?: string; message?: string } | null;
    assertTaskListComplete(rows, fallbackResult.count);
  } else {
    assertTaskListComplete(rows, result.count);
  }
  if (queryError) throw new Error(queryError.message);
  const tasks = await attachAssigneesToTasks(
    ((rows ?? []) as unknown as TaskRow[]).map((task) => ({
      ...task,
      custom_values: task.custom_values ?? {},
    })),
    supabase,
    { currentEmail: actor.email }
  );

  if (!workerScope) return attachTaskListMetadata(tasks, supabase);

  const participantIdSet = new Set(workerScope.participantIds);
  const visibleTasks = tasks
    .map((task) => ({
      ...task,
      viewer_is_participant: participantIdSet.has(task.id),
    }))
    .filter((task) => {
      const effectiveAssigneeEmail = task.assignees[0] ?? task.assignee_email;
      return canViewTask(actor, { assignee_email: effectiveAssigneeEmail }, {
        isAssignee:
          task.assignees.includes(actor.email) ||
          task.assignee_email === actor.email,
        isAgentMember: Boolean(
          task.agent_email && workerScope.agents.includes(task.agent_email)
        ),
        isAgentOwner: Boolean(
          task.agent_email &&
            (task.agent_email === actor.email ||
              workerScope.assistantAgents.includes(task.agent_email))
        ),
        isParticipant: task.viewer_is_participant,
      });
    });

  return attachTaskListMetadata(visibleTasks, supabase);
}

export class TaskListTruncatedError extends Error {
  readonly total: number;
  readonly loaded: number;

  constructor(total: number, loaded: number) {
    super(
      `Tasks list is larger than the server response limit (${loaded} of ${total} rows loaded).`
    );
    this.name = "TaskListTruncatedError";
    this.total = total;
    this.loaded = loaded;
  }
}

/**
 * PostgREST can cap an un-ranged response without returning an error. Exact
 * count lets us fail closed instead of presenting a silently incomplete task
 * board or export. Pagination/windowing is a separate, measured follow-up.
 */
export function assertTaskListComplete(
  rows: unknown[] | null,
  count: number | null | undefined
): void {
  const loaded = rows?.length ?? 0;
  if (typeof count === "number" && count > loaded) {
    throw new TaskListTruncatedError(count, loaded);
  }
}

type TaskActivityListRow = {
  task_id: string;
  actor_email: string;
  created_at: string;
};
export type TaskListMetadataRow = {
  task_id: string;
  last_activity_by_email: string | null;
  comment_count: number | null;
  attachment_count: number | null;
};
const TASK_METADATA_TASK_ID_CHUNK_SIZE = 50;

async function attachTaskListMetadata(
  tasks: TaskRow[],
  supabase = getSupabaseAdmin()
): Promise<TaskRow[]> {
  if (tasks.length === 0) return tasks;

  const ids = tasks.map((task) => task.id);
  const metadataByTask = new Map(
    (await fetchTaskListMetadata(ids, supabase)).map((row) => [
      row.task_id,
      row,
    ])
  );

  return tasks.map((task) => {
    const metadata = metadataByTask.get(task.id);
    return {
      ...task,
      last_activity_by_email: metadata?.last_activity_by_email ?? null,
      comment_count: metadata?.comment_count ?? 0,
      attachment_count: metadata?.attachment_count ?? 0,
    };
  });
}

/**
 * Load the same metadata shown by the task list for a small set of task ids.
 * Detail views use this after comment/file mutations so the list row can
 * reconcile its counters and latest activity without waiting for a later
 * board refetch. Keep the legacy fallback shared with the initial list load
 * because deployments can be upgraded before the RPC exists in the schema.
 */
export async function fetchTaskListMetadata(
  taskIds: string[],
  supabase = getSupabaseAdmin()
): Promise<TaskListMetadataRow[]> {
  const ids = [...new Set(taskIds.filter(Boolean))];
  if (ids.length === 0) return [];

  const { data, error } = await supabase.rpc("task_list_metadata", {
    task_ids: ids,
  });
  if (!error) return (data ?? []) as unknown as TaskListMetadataRow[];
  if (!isMissingTaskListMetadataRpc(error)) throw new Error(error.message);

  const [activityRows, commentRows, attachmentRows] = await Promise.all([
    fetchTaskActivityRows(ids, supabase),
    fetchTaskCommentRows(ids, supabase),
    fetchTaskAttachmentRows(ids, supabase),
  ]);

  const lastActivityByTask = new Map<string, string>();
  for (const row of activityRows) {
    if (!lastActivityByTask.has(row.task_id)) {
      lastActivityByTask.set(row.task_id, row.actor_email);
    }
  }
  const commentCountByTask = countRowsByTask(commentRows);
  const attachmentCountByTask = countRowsByTask(attachmentRows);

  return ids.map((task_id) => ({
    task_id,
    last_activity_by_email: lastActivityByTask.get(task_id) ?? null,
    comment_count: commentCountByTask.get(task_id) ?? 0,
    attachment_count: attachmentCountByTask.get(task_id) ?? 0,
  }));
}

async function fetchTaskActivityRows(
  taskIds: string[],
  supabase = getSupabaseAdmin()
): Promise<TaskActivityListRow[]> {
  const chunks = chunkValues(taskIds, TASK_METADATA_TASK_ID_CHUNK_SIZE);
  const results = await Promise.all(
    chunks.map((chunk) =>
      supabase
        .from("task_activity")
        .select("task_id,actor_email,created_at")
        .in("task_id", chunk)
        .order("created_at", { ascending: false })
    )
  );
  const rows: TaskActivityListRow[] = [];
  for (const { data, error } of results) {
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as unknown as TaskActivityListRow[]));
  }
  return rows.sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

async function fetchTaskCommentRows(
  taskIds: string[],
  supabase = getSupabaseAdmin()
): Promise<Array<{ task_id: string }>> {
  const chunks = chunkValues(taskIds, TASK_METADATA_TASK_ID_CHUNK_SIZE);
  const results = await Promise.all(
    chunks.map((chunk) =>
      supabase
        .from("task_comments")
        .select("task_id")
        .in("task_id", chunk)
        .is("deleted_at", null)
    )
  );
  const rows: Array<{ task_id: string }> = [];
  for (const { data, error } of results) {
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as Array<{ task_id: string }>));
  }
  return rows;
}

async function fetchTaskAttachmentRows(
  taskIds: string[],
  supabase = getSupabaseAdmin()
): Promise<Array<{ task_id: string }>> {
  const chunks = chunkValues(taskIds, TASK_METADATA_TASK_ID_CHUNK_SIZE);
  const results = await Promise.all(
    chunks.map((chunk) =>
      supabase
        .from("task_attachments")
        .select("task_id")
        .in("task_id", chunk)
        .is("deleted_at", null)
    )
  );
  const rows: Array<{ task_id: string }> = [];
  for (const { data, error } of results) {
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as Array<{ task_id: string }>));
  }
  return rows;
}

function chunkValues<T>(values: T[], size: number): T[][] {
  const uniqueValues = [...new Set(values.filter(Boolean))];
  const chunks: T[][] = [];
  for (let index = 0; index < uniqueValues.length; index += size) {
    chunks.push(uniqueValues.slice(index, index + size));
  }
  return chunks;
}

function countRowsByTask(rows: Array<{ task_id: string }>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.task_id, (counts.get(row.task_id) ?? 0) + 1);
  }
  return counts;
}

function buildWorkerTaskOrs(
  email: string,
  workerScope:
    | {
        agents: string[];
        assistantAgents: string[];
        assignedIds: string[];
        participantIds: string[];
      }
    | null
): string[] {
  const quotedEmail = quotePostgrestFilterValue(email);
  const ors: string[] = [
    `assignee_email.eq.${quotedEmail}`,
    `agent_email.eq.${quotedEmail}`,
  ];
  if (!workerScope) return ors;
  if (workerScope.agents.length > 0) {
    ors.push(
      `agent_email.in.(${workerScope.agents.map(quotePostgrestFilterValue).join(",")})`
    );
  }
  if (workerScope.participantIds.length > 0) {
    ors.push(
      `id.in.(${workerScope.participantIds.map(quotePostgrestFilterValue).join(",")})`
    );
  }
  if (workerScope.assignedIds.length > 0) {
    ors.push(
      `id.in.(${workerScope.assignedIds.map(quotePostgrestFilterValue).join(",")})`
    );
  }
  return ors;
}

function isMissingTaskCustomValuesColumn(error: { code?: string; message?: string } | null): boolean {
  const message = error?.message?.toLowerCase() ?? "";
  return (
    error?.code === "42703" ||
    error?.code === "PGRST204" ||
    (message.includes("custom_values") &&
      message.includes("tasks") &&
      (message.includes("does not exist") || message.includes("schema cache")))
  );
}

export function isMissingTaskListMetadataRpc(error: { code?: string; message?: string } | null): boolean {
  const message = error?.message?.toLowerCase() ?? "";
  return (
    error?.code === "PGRST202" ||
    (message.includes("task_list_metadata") &&
      (message.includes("does not exist") || message.includes("could not find")))
  );
}
