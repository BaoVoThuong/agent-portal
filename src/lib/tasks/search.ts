import { getSupabaseAdmin } from "@/lib/supabase";
import { resolveTaskQueueScope } from "./membership";
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

const GROUP_LIMIT = 6;
type TaskSearchRow = {
  id: string;
  display_number: number | null;
  title: string;
  agent_email: string | null;
  status: TaskStatus;
};
type CommentSearchRow = {
  comment_id: string;
  task_id: string;
  task_title: string;
  body: string;
  author_email: string;
  created_at: string;
};
type FileSearchRow = {
  attachment_id: string;
  task_id: string;
  task_title: string;
  comment_id: string | null;
  file_name: string;
};
type SearchRpcPayload = {
  tasks: TaskSearchRow[];
  comments: CommentSearchRow[];
  files: FileSearchRow[];
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
  if (!actor.isManager && !actor.isWorker) return emptySearchResults();

  const supabase = getSupabaseAdmin();
  const scope = actor.isManager
    ? { agentEmails: [] as string[], seesAllTasks: true }
    : await resolveTaskQueueScope(actor);
  const { data, error } = await supabase.rpc("search_visible_task_content", {
    p_email: actor.email,
    p_agent_emails: scope.agentEmails,
    p_sees_all: scope.seesAllTasks,
    p_pattern: `%${escapeIlike(query)}%`,
  });
  if (error) throw new Error(error.message);
  if (!isSearchRpcPayload(data)) throw new Error("Task search returned an invalid result.");

  return {
    tasks: data.tasks.slice(0, GROUP_LIMIT).map((task) => ({
      id: task.id,
      display_number: task.display_number,
      key: taskDisplayKey(task.display_number),
      title: task.title,
      agent_email: task.agent_email,
      status: task.status,
    })),
    comments: data.comments.slice(0, GROUP_LIMIT).map((comment) => ({
      comment_id: comment.comment_id,
      task_id: comment.task_id,
      task_title: comment.task_title,
      snippet: buildSnippet(comment.body, query),
      author_email: comment.author_email,
      created_at: comment.created_at,
    })),
    files: data.files.slice(0, GROUP_LIMIT).map((file) => ({
      attachment_id: file.attachment_id,
      task_id: file.task_id,
      task_title: file.task_title,
      comment_id: file.comment_id,
      file_name: file.file_name,
    })),
    truncated: {
      tasks: data.tasks.length > GROUP_LIMIT,
      comments: data.comments.length > GROUP_LIMIT,
      files: data.files.length > GROUP_LIMIT,
    },
  };
}

function isSearchRpcPayload(value: unknown): value is SearchRpcPayload {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<SearchRpcPayload>;
  return Array.isArray(result.tasks) && Array.isArray(result.comments) && Array.isArray(result.files);
}
