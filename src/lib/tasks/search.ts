import { getSupabaseAdmin } from "@/lib/supabase";
import { canViewTask } from "./access";
import { fetchAssignedTaskIdsForEmail } from "./assignees";
import { fetchAgentsForCs, fetchAssistantAgentsForCs } from "./membership";
import { fetchParticipantTaskIds } from "./participants";
import { taskDisplayKey } from "./sorting";
import type { TaskActor, TaskStatus } from "./types";

export type SearchSnippet = {
  text: string;
  matchStart: number;
  matchLen: number;
};

export type TaskHit = {
  id: string;
  display_number: number | null;
  key: string;
  title: string;
  agent_email: string | null;
  status: TaskStatus;
};

export type CommentHit = {
  comment_id: string;
  task_id: string;
  task_title: string;
  snippet: SearchSnippet;
  author_email: string;
  created_at: string;
};

export type FileHit = {
  attachment_id: string;
  task_id: string;
  task_title: string;
  comment_id: string | null;
  file_name: string;
};

export type SearchResults = {
  tasks: TaskHit[];
  comments: CommentHit[];
  files: FileHit[];
  truncated: {
    tasks: boolean;
    comments: boolean;
    files: boolean;
  };
};

export type TaskVisibilityMeta = {
  task_id: string;
  agent_email: string | null;
  assignee_email: string | null;
  reporter_email: string | null;
};

export type VisibilityScope = {
  agents: string[];
  assistantAgents: string[];
  assignedIds: Set<string>;
  participantIds: Set<string>;
  assigneeByTask: Map<string, string[]>;
};

export function buildSnippet(
  body: string,
  query: string,
  radius = 60
): SearchSnippet {
  const trimmedQuery = query.trim();
  const idx = body.toLowerCase().indexOf(trimmedQuery.toLowerCase());
  if (idx < 0 || trimmedQuery.length === 0) {
    const text =
      body.length > radius * 2 ? `${body.slice(0, radius * 2)}...` : body;
    return { text, matchStart: 0, matchLen: 0 };
  }

  const start = Math.max(0, idx - radius);
  const end = Math.min(body.length, idx + trimmedQuery.length + radius);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < body.length ? "..." : "";
  const text = `${prefix}${body.slice(start, end)}${suffix}`;

  return {
    text,
    matchStart: prefix.length + (idx - start),
    matchLen: trimmedQuery.length,
  };
}

// Reuses canViewTask so search visibility cannot drift from board visibility.
export function isHitVisible(
  actor: TaskActor,
  meta: TaskVisibilityMeta,
  scope: VisibilityScope
): boolean {
  const assignees = scope.assigneeByTask.get(meta.task_id) ?? [];
  const effectiveAssigneeEmail = assignees[0] ?? meta.assignee_email;

  return canViewTask(
    actor,
    { assignee_email: effectiveAssigneeEmail },
    {
      isAssignee:
        assignees.includes(actor.email) ||
        meta.assignee_email === actor.email ||
        scope.assignedIds.has(meta.task_id),
      isAgentMember: Boolean(
        meta.agent_email && scope.agents.includes(meta.agent_email)
      ),
      isAgentOwner: Boolean(
        meta.agent_email &&
          (meta.agent_email === actor.email ||
            scope.assistantAgents.includes(meta.agent_email))
      ),
      isParticipant: scope.participantIds.has(meta.task_id),
      isReporter: meta.reporter_email === actor.email,
    }
  );
}

const GROUP_LIMIT = 6;
const SEARCH_PAGE_SIZE = 50;
// Visibility is resolved after joining task membership, so a fixed raw
// candidate limit can hide the first visible hit behind many out-of-scope
// matches. Page until the visible group is complete, with a safety ceiling so
// a hostile/common query cannot make the search unbounded.
const MAX_SEARCH_SCAN = 1000;

type TaskMetaRow = {
  id: string;
  display_number: number | null;
  title: string;
  agent_email: string | null;
  assignee_email: string | null;
  reporter_email: string | null;
  status: TaskStatus;
  archived_at: string | null;
};

type CommentSearchRow = {
  id: string;
  task_id: string;
  body: string;
  author_email: string;
  created_at: string;
};

type FileSearchRow = {
  id: string;
  task_id: string;
  comment_id: string | null;
  file_name: string;
};

type SearchMembership =
  | null
  | [string[], string[], string[], string[]];

type SearchPage<Row> = {
  data: Row[] | null;
  error: { message: string } | null;
};

function emptySearchResults(): SearchResults {
  return {
    tasks: [],
    comments: [],
    files: [],
    truncated: { tasks: false, comments: false, files: false },
  };
}

async function loadSearchVisibility(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  taskIds: string[],
  membership: SearchMembership
): Promise<{
  metaById: Map<string, TaskMetaRow>;
  scope: VisibilityScope | null;
}> {
  const [metaRes, assigneeRes] = await Promise.all([
    taskIds.length > 0
      ? supabase
          .from("tasks")
          .select("id,display_number,title,agent_email,assignee_email,reporter_email,status,archived_at")
          .in("id", taskIds)
          .is("archived_at", null)
      : Promise.resolve({ data: [], error: null }),
    membership && taskIds.length > 0
      ? supabase
          .from("task_assignees")
          .select("task_id,email")
          .in("task_id", taskIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (metaRes.error) throw new Error(metaRes.error.message);
  if (assigneeRes.error) throw new Error(assigneeRes.error.message);

  const metaById = new Map<string, TaskMetaRow>();
  for (const row of (metaRes.data ?? []) as unknown as TaskMetaRow[]) {
    metaById.set(row.id, row);
  }

  if (!membership) return { metaById, scope: null };

  const [agents, assistantAgents, assignedIds, participantIds] = membership;
  const assigneeByTask = new Map<string, string[]>();
  for (const row of (assigneeRes.data ?? []) as unknown as {
    task_id: string;
    email: string;
  }[]) {
    const emails = assigneeByTask.get(row.task_id) ?? [];
    emails.push(row.email);
    assigneeByTask.set(row.task_id, emails);
  }

  return {
    metaById,
    scope: {
      agents,
      assistantAgents,
      assignedIds: new Set(assignedIds),
      participantIds: new Set(participantIds),
      assigneeByTask,
    },
  };
}

async function collectVisibleHits<Row, Hit>(params: {
  actor: TaskActor;
  membership: SearchMembership;
  supabase: ReturnType<typeof getSupabaseAdmin>;
  fetchPage: (offset: number, limit: number) => PromiseLike<SearchPage<Row>>;
  taskIdOf: (row: Row) => string;
  buildHit: (row: Row, meta: TaskMetaRow) => Hit;
}): Promise<{ hits: Hit[]; truncated: boolean }> {
  const hits: Hit[] = [];
  let offset = 0;
  let scanned = 0;
  let hasMoreRows = false;

  while (hits.length <= GROUP_LIMIT && scanned < MAX_SEARCH_SCAN) {
    const page = await params.fetchPage(offset, SEARCH_PAGE_SIZE);
    if (page.error) throw new Error(page.error.message);
    const rows = page.data ?? [];
    if (rows.length === 0) break;

    offset += rows.length;
    scanned += rows.length;
    const taskIds = [...new Set(rows.map(params.taskIdOf))];
    const { metaById, scope } = await loadSearchVisibility(
      params.supabase,
      taskIds,
      params.membership
    );

    for (const row of rows) {
      const taskId = params.taskIdOf(row);
      const meta = metaById.get(taskId);
      if (!meta) continue;
      if (
        !isHitVisible(
          params.actor,
          {
            task_id: taskId,
            agent_email: meta.agent_email,
            assignee_email: meta.assignee_email,
            reporter_email: meta.reporter_email,
          },
          scope ?? {
            agents: [],
            assistantAgents: [],
            assignedIds: new Set(),
            participantIds: new Set(),
            assigneeByTask: new Map(),
          }
        )
      ) {
        continue;
      }
      hits.push(params.buildHit(row, meta));
      if (hits.length > GROUP_LIMIT) break;
    }

    if (hits.length > GROUP_LIMIT) {
      hasMoreRows = true;
      break;
    }
    if (rows.length < SEARCH_PAGE_SIZE) break;
    if (scanned >= MAX_SEARCH_SCAN) {
      hasMoreRows = true;
      break;
    }
  }

  return {
    hits: hits.slice(0, GROUP_LIMIT),
    truncated: hasMoreRows || hits.length > GROUP_LIMIT,
  };
}

function escapeIlike(query: string): string {
  return query.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export async function runTaskSearch(
  actor: TaskActor,
  rawQuery: string
): Promise<SearchResults> {
  const query = rawQuery.trim();
  if (query.length < 2) return emptySearchResults();

  const supabase = getSupabaseAdmin();
  const pattern = `%${escapeIlike(query)}%`;

  // Scope membership depends only on actor.email. It must be known before
  // applying the visible-group limit, otherwise hidden rows can crowd out
  // valid results.
  const membershipPromise = actor.isManager
    ? Promise.resolve(null)
    : Promise.all([
        fetchAgentsForCs(actor.email),
        fetchAssistantAgentsForCs(actor.email),
        fetchAssignedTaskIdsForEmail(actor.email, supabase),
        fetchParticipantTaskIds(actor.email),
      ]);

  const membership = await membershipPromise;
  const [taskResult, commentResult, fileResult] = await Promise.all([
    collectVisibleHits<TaskMetaRow, TaskHit>({
      actor,
      membership,
      supabase,
      fetchPage: (offset, limit) =>
        supabase
          .from("tasks")
          .select("id,display_number,title,agent_email,assignee_email,reporter_email,status,archived_at")
          .ilike("title", pattern)
          .is("archived_at", null)
          .order("updated_at", { ascending: false })
          .range(offset, offset + limit - 1),
      taskIdOf: (task) => task.id,
      buildHit: (task, meta) => ({
        id: task.id,
        display_number: task.display_number,
        key: taskDisplayKey(task.display_number),
        title: meta.title,
        agent_email: meta.agent_email,
        status: meta.status,
      }),
    }),
    collectVisibleHits<CommentSearchRow, CommentHit>({
      actor,
      membership,
      supabase,
      fetchPage: (offset, limit) =>
        supabase
          .from("task_comments")
          .select("id,task_id,body,author_email,created_at")
          .ilike("body", pattern)
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .range(offset, offset + limit - 1),
      taskIdOf: (comment) => comment.task_id,
      buildHit: (comment, meta) => ({
        comment_id: comment.id,
        task_id: comment.task_id,
        task_title: meta.title,
        snippet: buildSnippet(comment.body, query),
        author_email: comment.author_email,
        created_at: comment.created_at,
      }),
    }),
    collectVisibleHits<FileSearchRow, FileHit>({
      actor,
      membership,
      supabase,
      fetchPage: (offset, limit) =>
        supabase
          .from("task_attachments")
          .select("id,task_id,comment_id,file_name,created_at")
          .ilike("file_name", pattern)
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .range(offset, offset + limit - 1),
      taskIdOf: (file) => file.task_id,
      buildHit: (file, meta) => ({
        attachment_id: file.id,
        task_id: file.task_id,
        task_title: meta.title,
        comment_id: file.comment_id,
        file_name: file.file_name,
      }),
    }),
  ]);

  return {
    tasks: taskResult.hits,
    comments: commentResult.hits,
    files: fileResult.hits,
    truncated: {
      tasks: taskResult.truncated,
      comments: commentResult.truncated,
      files: fileResult.truncated,
    },
  };
}
