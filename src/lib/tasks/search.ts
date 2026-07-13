import { canViewTask } from "./access";
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
