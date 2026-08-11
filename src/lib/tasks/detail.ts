import type { SupabaseClient } from "@supabase/supabase-js";
import { signTaskFile } from "./storage";
import { resolveDisplayNames } from "@/lib/people/display-names";
import {
  COMMENT_PAGE_SIZE,
  type CommentCursor,
} from "@/lib/collaboration/comment-pagination";

export type SignedAttachment = {
  id: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  url: string | null;
  unavailable?: true;
};

export type CommentWithAttachments = Record<string, unknown> & {
  id: string;
  attachments: SignedAttachment[];
  author_name?: string;
};

export type ActivityRow = {
  id: string;
  actor_email: string;
  type: string;
  meta: Record<string, unknown> | null;
  created_at: string;
  actor_name?: string;
};

export type TaskDetailMetadata = {
  last_activity_by_email: string | null;
  comment_count: number;
  attachment_count: number;
};

export type TaskDetail = {
  comments: CommentWithAttachments[];
  commentsHasMore: boolean;
  activity: ActivityRow[];
  attachments: SignedAttachment[];
  metadata?: TaskDetailMetadata;
};

export const TASK_ACTIVITY_LIMIT = 200;

const COMMENT_COLUMNS =
  "id,task_id,parent_id,author_email,body,created_at,updated_at,deleted_at";

type CommentAttachmentRow = {
  id: string;
  comment_id: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  storage_path: string;
};

type TaskAttachmentRow = {
  id: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  storage_path: string;
};

export function groupCommentAttachments(
  comments: { id: string }[],
  signed: { comment_id: string; att: SignedAttachment }[]
): CommentWithAttachments[] {
  const byComment = new Map<string, SignedAttachment[]>();

  for (const { comment_id, att } of signed) {
    const attachments = byComment.get(comment_id) ?? [];
    attachments.push(att);
    byComment.set(comment_id, attachments);
  }

  return comments.map((comment) => ({
    ...(comment as Record<string, unknown>),
    id: comment.id,
    attachments: byComment.get(comment.id) ?? [],
  }));
}

export async function loadComments(
  supabase: SupabaseClient,
  taskId: string,
  opts: { includeAttachments?: boolean; before?: CommentCursor; highlightCommentId?: string | null } = {}
): Promise<{ comments: CommentWithAttachments[]; hasMore: boolean }> {
  let query = supabase
    .from("task_comments")
    .select(COMMENT_COLUMNS)
    .eq("task_id", taskId)
    .is("deleted_at", null);
  if (opts.before) {
    query = query.or(
      `created_at.lt.${opts.before.created_at},and(created_at.eq.${opts.before.created_at},id.lt.${opts.before.id})`
    );
  }
  const { data: comments, error: commentsError } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(COMMENT_PAGE_SIZE + 1);
  if (commentsError) throw new Error(commentsError.message);

  let rawComments = (comments ?? []) as unknown as Array<{
    id: string;
    parent_id: string | null;
    author_email: string;
    created_at: string;
  }>;
  const hasMore = rawComments.length > COMMENT_PAGE_SIZE;
  rawComments = rawComments.slice(0, COMMENT_PAGE_SIZE);
  if (opts.highlightCommentId && !rawComments.some((row) => row.id === opts.highlightCommentId)) {
    const { data: highlighted, error } = await supabase
      .from("task_comments")
      .select(COMMENT_COLUMNS)
      .eq("task_id", taskId)
      .eq("id", opts.highlightCommentId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (highlighted) rawComments.push(highlighted as unknown as (typeof rawComments)[number]);
  }
  const parentIds = [...new Set(rawComments.map((row) => row.parent_id).filter(Boolean))]
    .filter((id) => !rawComments.some((row) => row.id === id));
  if (parentIds.length > 0) {
    const { data: parents, error } = await supabase
      .from("task_comments")
      .select(COMMENT_COLUMNS)
      .eq("task_id", taskId)
      .in("id", parentIds)
      .is("deleted_at", null);
    if (error) throw new Error(error.message);
    rawComments.push(...((parents ?? []) as unknown as typeof rawComments));
  }
  rawComments.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  const displayNames = await resolveDisplayNames(rawComments.map((comment) => comment.author_email));
  const commentsWithNames = rawComments.map((comment) => ({
    ...comment,
    author_name: displayNames.get(comment.author_email.trim().toLowerCase()),
  }));

  if (opts.includeAttachments === false) {
    return { comments: commentsWithNames.map((comment) => ({
      ...(comment as Record<string, unknown>),
      id: comment.id,
      attachments: [],
    })), hasMore };
  }

  const commentIds = rawComments.map((comment) => comment.id);
  if (commentIds.length === 0) return { comments: [], hasMore };
  const { data: attachmentRows, error: attachmentsError } = await supabase
    .from("task_attachments")
    .select("id,comment_id,file_name,mime_type,size_bytes,storage_path,created_at")
    .in("comment_id", commentIds)
    .not("comment_id", "is", null)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (attachmentsError) throw new Error(attachmentsError.message);

  const rows = (attachmentRows ?? []) as unknown as CommentAttachmentRow[];
  const attachments = await signAttachmentsSafely(rows);
  const signed = rows.map((row, index) => ({ comment_id: row.comment_id, att: attachments[index] }));

  return { comments: groupCommentAttachments(
    commentsWithNames as unknown as { id: string }[],
    signed
  ), hasMore };
}

export async function loadActivity(
  supabase: SupabaseClient,
  taskId: string
): Promise<ActivityRow[]> {
  const { data, error } = await supabase
    .from("task_activity")
    .select("id,actor_email,type,meta,created_at")
    .eq("task_id", taskId)
    .order("created_at", { ascending: false })
    .limit(TASK_ACTIVITY_LIMIT);
  if (error) throw new Error(error.message);

  const activity = (data ?? []) as unknown as ActivityRow[];
  const displayNames = await resolveDisplayNames(activity.map((row) => row.actor_email));
  return activity.map((row) => ({
    ...row,
    actor_name: displayNames.get(row.actor_email.trim().toLowerCase()),
  }));
}

export async function loadTaskAttachments(
  supabase: SupabaseClient,
  taskId: string
): Promise<SignedAttachment[]> {
  const { data, error } = await supabase
    .from("task_attachments")
    .select("id,file_name,mime_type,size_bytes,storage_path,created_at")
    .eq("task_id", taskId)
    .is("comment_id", null)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  return signAttachmentsSafely((data ?? []) as unknown as TaskAttachmentRow[]);
}

export async function loadTaskDetail(
  supabase: SupabaseClient,
  taskId: string,
  opts: {
    includeActivity?: boolean;
    includeCommentAttachments?: boolean;
    includeTaskAttachments?: boolean;
    commentsBefore?: CommentCursor;
    highlightCommentId?: string | null;
  } = {}
): Promise<TaskDetail> {
  const [commentPage, activity, attachments] = await Promise.all([
    loadComments(supabase, taskId, {
      includeAttachments: opts.includeCommentAttachments,
      before: opts.commentsBefore,
      highlightCommentId: opts.highlightCommentId,
    }),
    opts.includeActivity === false
      ? Promise.resolve([])
      : loadActivity(supabase, taskId),
    opts.includeTaskAttachments === false
      ? Promise.resolve([])
      : loadTaskAttachments(supabase, taskId),
  ]);

  return { comments: commentPage.comments, commentsHasMore: commentPage.hasMore, activity, attachments };
}

export async function signAttachmentsSafely<
  T extends { id: string; file_name: string; mime_type: string | null; size_bytes: number | null; storage_path: string }
>(
  rows: readonly T[],
  sign: (path: string) => Promise<string> = signTaskFile
): Promise<SignedAttachment[]> {
  const settled = await Promise.allSettled(rows.map((row) => sign(row.storage_path)));
  return rows.map((row, index) => {
    const base = { id: row.id, file_name: row.file_name, mime_type: row.mime_type, size_bytes: row.size_bytes };
    const result = settled[index];
    if (result.status === "fulfilled") return { ...base, url: result.value };
    console.warn(`[attachments] could not sign ${row.id}`, result.reason);
    return { ...base, url: null, unavailable: true as const };
  });
}
