import { getSupabaseAdmin } from "@/lib/supabase";
import { canViewTask } from "./access";
import { fetchAssignedTaskIdsForEmail } from "./assignees";
import { fetchAgentsForCs, fetchAssistantAgentsForCs } from "./membership";
import { fetchParticipantTaskIds } from "./participants";
import { taskKey } from "./sorting";
import type { TaskActor, TaskStatus } from "./types";

export type SearchSnippet = {
  text: string;
  matchStart: number;
  matchLen: number;
};

export type TaskHit = {
  id: string;
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
    }
  );
}

const GROUP_LIMIT = 6;
const CANDIDATE_LIMIT = 40;

type TaskMetaRow = {
  id: string;
  title: string;
  agent_email: string | null;
  assignee_email: string | null;
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

function emptySearchResults(): SearchResults {
  return {
    tasks: [],
    comments: [],
    files: [],
    truncated: { tasks: false, comments: false, files: false },
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

  const [titleRows, commentRows, fileRows] = await Promise.all([
    supabase
      .from("tasks")
      .select("id,title,agent_email,assignee_email,status,archived_at")
      .ilike("title", pattern)
      .is("archived_at", null)
      .limit(CANDIDATE_LIMIT + 1),
    supabase
      .from("task_comments")
      .select("id,task_id,body,author_email,created_at")
      .ilike("body", pattern)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(CANDIDATE_LIMIT + 1),
    supabase
      .from("task_attachments")
      .select("id,task_id,comment_id,file_name")
      .ilike("file_name", pattern)
      .limit(CANDIDATE_LIMIT + 1),
  ]);

  if (titleRows.error) throw new Error(titleRows.error.message);
  if (commentRows.error) throw new Error(commentRows.error.message);
  if (fileRows.error) throw new Error(fileRows.error.message);

  const titles = ((titleRows.data ?? []) as unknown as TaskMetaRow[]).slice(
    0,
    CANDIDATE_LIMIT
  );
  const comments = (
    (commentRows.data ?? []) as unknown as CommentSearchRow[]
  ).slice(0, CANDIDATE_LIMIT);
  const files = ((fileRows.data ?? []) as unknown as FileSearchRow[]).slice(
    0,
    CANDIDATE_LIMIT
  );

  const taskIds = [
    ...new Set([
      ...titles.map((task) => task.id),
      ...comments.map((comment) => comment.task_id),
      ...files.map((file) => file.task_id),
    ]),
  ];
  const metaById = new Map<string, TaskMetaRow>();
  if (taskIds.length > 0) {
    const { data, error } = await supabase
      .from("tasks")
      .select("id,title,agent_email,assignee_email,status,archived_at")
      .in("id", taskIds)
      .is("archived_at", null);
    if (error) throw new Error(error.message);

    for (const row of (data ?? []) as unknown as TaskMetaRow[]) {
      metaById.set(row.id, row);
    }
  }

  let scope: VisibilityScope | null = null;
  if (!actor.isManager) {
    const [agents, assistantAgents, assignedIds, participantIds] =
      await Promise.all([
        fetchAgentsForCs(actor.email),
        fetchAssistantAgentsForCs(actor.email),
        fetchAssignedTaskIdsForEmail(actor.email, supabase),
        fetchParticipantTaskIds(actor.email),
      ]);
    const assigneeByTask = new Map<string, string[]>();

    if (taskIds.length > 0) {
      const { data, error } = await supabase
        .from("task_assignees")
        .select("task_id,email")
        .in("task_id", taskIds);
      if (error) throw new Error(error.message);

      for (const row of (data ?? []) as unknown as {
        task_id: string;
        email: string;
      }[]) {
        const emails = assigneeByTask.get(row.task_id) ?? [];
        emails.push(row.email);
        assigneeByTask.set(row.task_id, emails);
      }
    }

    scope = {
      agents,
      assistantAgents,
      assignedIds: new Set(assignedIds),
      participantIds: new Set(participantIds),
      assigneeByTask,
    };
  }

  const visible = (meta: TaskVisibilityMeta) =>
    !scope || isHitVisible(actor, meta, scope);

  const taskHits: TaskHit[] = [];
  for (const task of titles) {
    const meta = metaById.get(task.id);
    if (!meta) continue;
    if (
      !visible({
        task_id: task.id,
        agent_email: meta.agent_email,
        assignee_email: meta.assignee_email,
      })
    ) {
      continue;
    }

    taskHits.push({
      id: task.id,
      key: taskKey(task.id),
      title: meta.title,
      agent_email: meta.agent_email,
      status: meta.status,
    });
  }

  const commentHits: CommentHit[] = [];
  for (const comment of comments) {
    const meta = metaById.get(comment.task_id);
    if (!meta) continue;
    if (
      !visible({
        task_id: comment.task_id,
        agent_email: meta.agent_email,
        assignee_email: meta.assignee_email,
      })
    ) {
      continue;
    }

    commentHits.push({
      comment_id: comment.id,
      task_id: comment.task_id,
      task_title: meta.title,
      snippet: buildSnippet(comment.body, query),
      author_email: comment.author_email,
      created_at: comment.created_at,
    });
  }

  const fileHits: FileHit[] = [];
  for (const file of files) {
    const meta = metaById.get(file.task_id);
    if (!meta) continue;
    if (
      !visible({
        task_id: file.task_id,
        agent_email: meta.agent_email,
        assignee_email: meta.assignee_email,
      })
    ) {
      continue;
    }

    fileHits.push({
      attachment_id: file.id,
      task_id: file.task_id,
      task_title: meta.title,
      comment_id: file.comment_id,
      file_name: file.file_name,
    });
  }

  return {
    tasks: taskHits.slice(0, GROUP_LIMIT),
    comments: commentHits.slice(0, GROUP_LIMIT),
    files: fileHits.slice(0, GROUP_LIMIT),
    truncated: {
      tasks: taskHits.length > GROUP_LIMIT,
      comments: commentHits.length > GROUP_LIMIT,
      files: fileHits.length > GROUP_LIMIT,
    },
  };
}
