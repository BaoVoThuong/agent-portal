import { getSupabaseAdmin } from "@/lib/supabase";
import {
  LIST_ENRICH_CONCURRENCY,
  mapWithConcurrency,
} from "@/lib/pagination/concurrency";
import {
  fetchAllByKeyset,
  isTransientPostgrestError,
  type KeysetPage,
} from "@/lib/pagination/keyset";
import { attachAssigneesToTasks } from "./assignees";
import { canViewTask } from "./access";
import { resolveTaskQueueScope } from "./membership";
import { isMissingTaskParticipantsError } from "./participants";
import type { TaskActor, TaskRow } from "./types";

export const TASK_LIST_COUNT_MODE = "exact" as const;

export const TASK_COLUMNS =
  "id,display_number,title,description,fub_link,status,priority,category_id,custom_values,agent_email,assignee_email,reporter_email,todo_started_at,todo_reminded_at,in_progress_at,overdue_flagged_at,waiting_started_at,waiting_reminded_at,billing_started_at,billing_reminded_at,overdue_reminded_at,overdue_unlocked_at,due_soon_notified_at,stale_reminded_at,qc_reminded_at,last_activity_at,reopened_at,sla_minutes,overdue_count,todo_seconds,in_progress_seconds,waiting_seconds,billing_seconds,done_reviewed_by_email,done_reviewed_at,closed_at,position,created_at,updated_at,archived_at";
const TASK_COLUMNS_LEGACY =
  "id,title,description,fub_link,status,priority,category_id,agent_email,assignee_email,reporter_email,todo_started_at,todo_reminded_at,in_progress_at,overdue_flagged_at,waiting_started_at,waiting_reminded_at,billing_started_at,billing_reminded_at,overdue_reminded_at,overdue_unlocked_at,due_soon_notified_at,stale_reminded_at,qc_reminded_at,last_activity_at,reopened_at,sla_minutes,overdue_count,todo_seconds,in_progress_seconds,waiting_seconds,billing_seconds,done_reviewed_by_email,done_reviewed_at,closed_at,position,created_at,updated_at,archived_at";

export const TASK_PAGE_SIZE = 1000;

/**
 * Trần số DÒNG một lượt nạp bảng task được phép kéo về.
 *
 * Theo DÒNG chứ không theo TRANG: trần "N trang" thực chất là "N × trần của
 * server", mà trần server đổi theo cấu hình. 5.000 × ~1.372 bytes ≈ 6,9 MB —
 * đã là mức trình duyệt bắt đầu ì, nên đặt cao hơn chỉ khiến app treo TRƯỚC khi
 * banner cảnh báo kịp hiện.
 */
export const TASK_MAX_ROWS = 5_000;

/**
 * Một Agent/Assistant (không có task.manage) chỉ thấy task trong phạm vi của
 * mình. Phạm vi tính trong database bằng `tasks_visible_to_worker` (rollout
 * 2026-10-16-tasks-visible-to-worker.sql): request chỉ mang email và các Agent
 * mà người đó làm Assistant.
 *
 * Trước 2026-10-16, app gom MỌI task_id người đó từng được giao hoặc @mention
 * (kể cả task đã xong hay archive) rồi nhét vào URL dưới dạng `id.in.(...)`.
 * Danh sách chỉ tăng, nên tới khoảng 150 id thì vượt trần 6 KB và Task Board
 * sập (`TaskScopeTooLargeError`). Hai danh sách đó còn bị PostgREST cắt ở 1.000
 * dòng mà không báo.
 */
type WorkerScope = {
  email: string;
  /** Agents whose tasks this worker sees as their Assistant. */
  agentEmails: string[];
  /** Agents this worker has agent-owner rights for (resolveTaskQueueScope). */
  assistantAgentEmails: string[];
};

type TaskQueryShape = {
  columns: string;
  /** null = không giới hạn phạm vi (manager / plain-CS). */
  workerScope: WorkerScope | null;
};

type CountOption = { count?: typeof TASK_LIST_COUNT_MODE };

/**
 * Task một Agent/Assistant được thấy. Lỗi của RPC (thiếu hàm, schema cache) để
 * lộ ra cho người gọi: không bao giờ rơi về truy vấn không phạm vi.
 *
 * Không embed `task_participants` ở đây: PostgREST gắn bộ lọc embed của một
 * RPC vào chính hàm ("column pgrst_call.email does not exist", 2026-10-16).
 * Cờ participant lấy bằng fetchViewerParticipantTaskIds.
 */
function selectWorkerTasks(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  scope: WorkerScope,
  columns: string,
  countOption: CountOption,
) {
  return supabase
    .rpc(
      "tasks_visible_to_worker",
      { p_email: scope.email, p_agent_emails: scope.agentEmails },
      countOption,
    )
    .select(columns);
}

/**
 * Dựng lại MỘT trang. Phải là hàm chứ không phải một biến `query` dùng lại:
 * builder của Supabase là mutable, tái sử dụng một instance sẽ cộng dồn bộ lọc.
 *
 * Sắp theo `id` TĂNG DẦN và chỉ theo `id`. Thứ tự SQL chưa bao giờ là thứ người
 * dùng thấy — `TaskListView` luôn xếp lại bằng rankTasks/sortTasks — nên `id`
 * (bất biến, duy nhất, đã là primary key) là khoá phân trang đúng. Sắp theo
 * `position` thì kéo-thả một task sẽ dịch biên trang của mọi task khác.
 *
 * `count: exact` CHỈ ở trang đầu.
 */
function buildTaskQuery(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  shape: TaskQueryShape,
  afterId: string | null,
) {
  const countOption: CountOption =
    afterId === null ? { count: TASK_LIST_COUNT_MODE } : {};
  if (shape.workerScope) {
    let scoped = selectWorkerTasks(supabase, shape.workerScope, shape.columns, countOption)
      .is("archived_at", null)
      .order("id", { ascending: true })
      .limit(TASK_PAGE_SIZE);
    if (afterId !== null) scoped = scoped.gt("id", afterId);
    return scoped;
  }
  let query = supabase
    .from("tasks")
    .select(shape.columns, countOption)
    .is("archived_at", null)
    .order("id", { ascending: true })
    .limit(TASK_PAGE_SIZE);
  if (afterId !== null) query = query.gt("id", afterId);
  return query;
}

export async function fetchTasksForActor(actor: TaskActor): Promise<{
  tasks: TaskRow[];
  total: number;
  /** Danh sách chạm trần và bị cắt. Người gọi PHẢI nói ra. */
  truncated: boolean;
}> {
  const supabase = getSupabaseAdmin();

  // Manager and plain-CS see the shared company queue. Agent/assistant users
  // keep the narrower agent-scope view, applied in the database.
  let workerScope: WorkerScope | null = null;
  if (!actor.isManager) {
    const scope = await resolveTaskQueueScope(actor);
    if (!scope.seesAllTasks) {
      workerScope = {
        email: actor.email,
        agentEmails: scope.agentEmails,
        assistantAgentEmails: scope.assistantAgentEmails,
      };
    }
  }

  const readPage = async (
    columns: string,
    afterId: string | null
  ): Promise<KeysetPage<{ id: string }>> => {
    const result = await buildTaskQuery(supabase, { columns, workerScope }, afterId);
    const error = result.error as { code?: string; message?: string } | null;
    return {
      rows: result.data as unknown as { id: string }[] | null,
      // Giữ HTTP status: 502/503/504 từ gateway và 429 rate-limit không mang mã
      // Postgres nào, nên thiếu status thì đúng những lỗi đáng thử lại nhất lại
      // bị coi là vĩnh viễn.
      error: error ? { ...error, status: result.status } : null,
      count: result.count,
    };
  };

  let page: { rows: { id: string }[]; total: number; truncated: boolean };
  try {
    page = await fetchAllByKeyset(
      (afterId) => readPage(TASK_COLUMNS, afterId),
      { maxRows: TASK_MAX_ROWS, isTransient: isTransientPostgrestError }
    );
  } catch (error) {
    // Nhánh tương thích cho DB chưa có cột custom_values. Production ĐÃ có cột
    // này, nên nhánh này nguội — giữ nguyên kiểu một-phát kèm
    // assertTaskListComplete, không phân trang một đường không chạy.
    const maybeMissingColumn = { message: (error as Error).message };
    if (!isMissingTaskCustomValuesColumn(maybeMissingColumn)) throw error;
    const countOption: CountOption = { count: TASK_LIST_COUNT_MODE };
    const fallbackResult = workerScope
      ? await selectWorkerTasks(supabase, workerScope, TASK_COLUMNS_LEGACY, countOption)
          .is("archived_at", null)
          .order("position", { ascending: true })
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
      : await supabase
          .from("tasks")
          .select(TASK_COLUMNS_LEGACY, countOption)
          .is("archived_at", null)
          .order("position", { ascending: true })
          .order("created_at", { ascending: true })
          .order("id", { ascending: true });
    if (fallbackResult.error) throw new Error(fallbackResult.error.message);
    const rows = fallbackResult.data as unknown[] | null;
    assertTaskListComplete(rows, fallbackResult.count);
    page = {
      rows: (rows ?? []) as { id: string }[],
      total: fallbackResult.count ?? 0,
      truncated: false,
    };
  }

  const rows = (page.rows as unknown as TaskRow[]).map((task) => ({
    ...task,
    custom_values: task.custom_values ?? {},
  }));
  const [tasks, viewerParticipantTaskIds] = await Promise.all([
    attachAssigneesToTasks(rows, supabase, { currentEmail: actor.email }),
    workerScope
      ? fetchViewerParticipantTaskIds(actor.email, rows.map((task) => task.id), supabase)
      : Promise.resolve(null),
  ]);

  if (!workerScope || !viewerParticipantTaskIds) {
    return {
      tasks: await attachTaskListMetadata(tasks, supabase),
      total: page.total,
      truncated: page.truncated,
    };
  }

  // Defence in depth: the database already applied the scope.
  const visibleTasks = tasks
    .map((task) => ({
      ...task,
      viewer_is_participant: viewerParticipantTaskIds.has(task.id),
    }))
    .filter((task) => {
      const effectiveAssigneeEmail = task.assignees[0] ?? task.assignee_email;
      return canViewTask(actor, { assignee_email: effectiveAssigneeEmail }, {
        isAssignee:
          task.assignees.includes(actor.email) ||
          task.assignee_email === actor.email,
        isAgentMember: Boolean(
          task.agent_email && workerScope.agentEmails.includes(task.agent_email)
        ),
        isAgentOwner: Boolean(
          task.agent_email &&
            (task.agent_email === actor.email ||
              workerScope.assistantAgentEmails.includes(task.agent_email))
        ),
        isParticipant: task.viewer_is_participant,
        isReporter: task.reporter_email === actor.email,
      });
    });

  return {
    tasks: await attachTaskListMetadata(visibleTasks, supabase),
    total: page.total,
    truncated: page.truncated,
  };
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

export type TaskListMetadataRow = {
  task_id: string;
  last_activity_by_email: string | null;
  comment_count: number | null;
  attachment_count: number | null;
};
/**
 * Số id mỗi lượt gọi `task_list_metadata`.
 *
 * 50 là con số cũ, chọn để "giữ payload nhỏ". Nhưng RPC nhận `uuid[]` qua POST
 * body, nên payload chưa bao giờ là ràng buộc: 500 UUID chỉ ~18 KB. Còn khối
 * lượng DB thì KHÔNG đổi theo kích thước chùm — hàm chạy hai subquery có index
 * cho mỗi id (`task_comments(task_id, created_at)`,
 * `task_attachments(task_id)`), nên 100 lượt × 50 id tốn đúng bằng 10 lượt ×
 * 500 id, chỉ khác số lượt đi-về.
 *
 * Ở 5.000 task: 100 lượt → 10.
 */
const TASK_METADATA_TASK_ID_CHUNK_SIZE = 500;
// `.in("task_id", ...)` goes in the URL. 300 quoted UUIDs (~11,7 KB) is the size
// the assignee lookup (assignees.ts) sends on every board load in production.
// The 500-id GET lookups in fetchTaskListMetadata's legacy fallback have never
// run there, so they prove nothing about longer URLs.
const TASK_PARTICIPANT_TASK_ID_CHUNK_SIZE = 300;

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

  // Keep the RPC payload bounded as well. Unlike a PostgREST `.in()` filter,
  // the RPC uses a POST body, but a large task queue can still create an
  // unnecessarily large request and one expensive database operation. The
  // legacy fallback below uses the same chunk size.
  // Chặn số lượt song song. Ở 141 task đây là 3 truy vấn — không thấy gì; ở
  // 5.000 task là 100, mỗi cái hai subquery đếm cho từng id, đổ vào một pool
  // mặc định 10 kết nối.
  const rpcResults = await mapWithConcurrency(
    chunkValues(ids, TASK_METADATA_TASK_ID_CHUNK_SIZE),
    LIST_ENRICH_CONCURRENCY,
    (chunk) => supabase.rpc("task_list_metadata", { task_ids: chunk }),
  );
  const rpcErrors = rpcResults
    .map((result) => result.error)
    .filter((error): error is NonNullable<typeof error> => Boolean(error));
  if (rpcErrors.length === 0) {
    return rpcResults.flatMap(
      ({ data }) => (data ?? []) as unknown as TaskListMetadataRow[],
    );
  }
  const rpcError =
    rpcErrors.find((error) => !isMissingTaskListMetadataRpc(error)) ?? rpcErrors[0];
  if (!isMissingTaskListMetadataRpc(rpcError)) {
    throw new Error(rpcError.message);
  }

  const [actorRows, commentRows, attachmentRows] = await Promise.all([
    fetchTaskActorRows(ids, supabase),
    fetchTaskCommentRows(ids, supabase),
    fetchTaskAttachmentRows(ids, supabase),
  ]);

  const lastActivityByTask = new Map(
    actorRows.map((row) => [row.task_id, row.last_activity_by_email] as const),
  );
  const commentCountByTask = countRowsByTask(commentRows);
  const attachmentCountByTask = countRowsByTask(attachmentRows);

  return ids.map((task_id) => ({
    task_id,
    last_activity_by_email: lastActivityByTask.get(task_id) ?? null,
    comment_count: commentCountByTask.get(task_id) ?? 0,
    attachment_count: attachmentCountByTask.get(task_id) ?? 0,
  }));
}

async function fetchTaskActorRows(
  taskIds: string[],
  supabase = getSupabaseAdmin()
): Promise<Array<{ task_id: string; last_activity_by_email: string | null }>> {
  const chunks = chunkValues(taskIds, TASK_METADATA_TASK_ID_CHUNK_SIZE);
  const results = await mapWithConcurrency(chunks, LIST_ENRICH_CONCURRENCY, (chunk) =>
    supabase.from("tasks").select("id,last_activity_by_email").in("id", chunk)
  );
  const rows: Array<{ task_id: string; last_activity_by_email: string | null }> = [];
  for (const { data, error } of results) {
    if (error) throw new Error(error.message);
    rows.push(
      ...((data ?? []) as Array<{ id: string; last_activity_by_email: string | null }>).map(
        (row) => ({ task_id: row.id, last_activity_by_email: row.last_activity_by_email }),
      ),
    );
  }
  return rows;
}

async function fetchTaskCommentRows(
  taskIds: string[],
  supabase = getSupabaseAdmin()
): Promise<Array<{ task_id: string }>> {
  const chunks = chunkValues(taskIds, TASK_METADATA_TASK_ID_CHUNK_SIZE);
  const results = await mapWithConcurrency(chunks, LIST_ENRICH_CONCURRENCY, (chunk) =>
    supabase.from("task_comments").select("task_id").in("task_id", chunk).is("deleted_at", null)
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
  const results = await mapWithConcurrency(chunks, LIST_ENRICH_CONCURRENCY, (chunk) =>
    supabase.from("task_attachments").select("task_id").in("task_id", chunk).is("deleted_at", null)
  );
  const rows: Array<{ task_id: string }> = [];
  for (const { data, error } of results) {
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as Array<{ task_id: string }>));
  }
  return rows;
}

/**
 * Which of the loaded tasks the viewer participates in (@mention or added).
 * Asks only about these task ids, so the flag is exact however long the
 * viewer's history is. A single read of all their participant rows is capped
 * at 1.000 by PostgREST, and canViewTask would then drop tasks the viewer only
 * sees as a participant.
 */
async function fetchViewerParticipantTaskIds(
  email: string,
  taskIds: string[],
  supabase = getSupabaseAdmin()
): Promise<Set<string>> {
  const chunks = chunkValues(taskIds, TASK_PARTICIPANT_TASK_ID_CHUNK_SIZE);
  const results = await mapWithConcurrency(chunks, LIST_ENRICH_CONCURRENCY, (chunk) =>
    supabase
      .from("task_participants")
      .select("task_id")
      .eq("email", email)
      .in("task_id", chunk)
  );
  const participantTaskIds = new Set<string>();
  for (const { data, error } of results) {
    if (error) {
      // Same additive-rollout fallback as fetchParticipantTaskIds.
      if (isMissingTaskParticipantsError(error)) return new Set();
      throw new Error(error.message);
    }
    for (const row of (data ?? []) as Array<{ task_id: string }>) {
      participantTaskIds.add(row.task_id);
    }
  }
  return participantTaskIds;
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
