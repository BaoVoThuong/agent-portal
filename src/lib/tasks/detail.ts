import type { SupabaseClient } from "@supabase/supabase-js";
import { signTaskFile } from "./storage";

export type SignedAttachment = {
  id: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  url: string;
};

export type CommentWithAttachments = Record<string, unknown> & {
  id: string;
  attachments: SignedAttachment[];
};

export type ActivityRow = {
  id: string;
  actor_email: string;
  type: string;
  meta: Record<string, unknown> | null;
  created_at: string;
};

export type TaskDetail = {
  comments: CommentWithAttachments[];
  activity: ActivityRow[];
  attachments: SignedAttachment[];
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
  opts: { includeAttachments?: boolean } = {}
): Promise<CommentWithAttachments[]> {
  const { data: comments, error: commentsError } = await supabase
    .from("task_comments")
    .select(COMMENT_COLUMNS)
    .eq("task_id", taskId)
    .order("created_at", { ascending: true });
  if (commentsError) throw new Error(commentsError.message);

  if (opts.includeAttachments === false) {
    return ((comments ?? []) as unknown as { id: string }[]).map((comment) => ({
      ...(comment as Record<string, unknown>),
      id: comment.id,
      attachments: [],
    }));
  }

  const { data: attachmentRows, error: attachmentsError } = await supabase
    .from("task_attachments")
    .select("id,comment_id,file_name,mime_type,size_bytes,storage_path,created_at")
    .eq("task_id", taskId)
    .not("comment_id", "is", null)
    .order("created_at", { ascending: true });
  if (attachmentsError) throw new Error(attachmentsError.message);

  const signed = await Promise.all(
    ((attachmentRows ?? []) as unknown as CommentAttachmentRow[]).map(
      async (row) => ({
        comment_id: row.comment_id,
        att: await signAttachment(row),
      })
    )
  );

  return groupCommentAttachments(
    (comments ?? []) as unknown as { id: string }[],
    signed
  );
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

  return (data ?? []) as unknown as ActivityRow[];
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
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  return Promise.all(
    ((data ?? []) as unknown as TaskAttachmentRow[]).map((row) =>
      signAttachment(row)
    )
  );
}

export async function loadTaskDetail(
  supabase: SupabaseClient,
  taskId: string,
  opts: {
    includeActivity?: boolean;
    includeCommentAttachments?: boolean;
    includeTaskAttachments?: boolean;
  } = {}
): Promise<TaskDetail> {
  const [comments, activity, attachments] = await Promise.all([
    loadComments(supabase, taskId, {
      includeAttachments: opts.includeCommentAttachments,
    }),
    opts.includeActivity === false
      ? Promise.resolve([])
      : loadActivity(supabase, taskId),
    opts.includeTaskAttachments === false
      ? Promise.resolve([])
      : loadTaskAttachments(supabase, taskId),
  ]);

  return { comments, activity, attachments };
}

async function signAttachment(
  row: CommentAttachmentRow | TaskAttachmentRow
): Promise<SignedAttachment> {
  return {
    id: row.id,
    file_name: row.file_name,
    mime_type: row.mime_type,
    size_bytes: row.size_bytes,
    url: await signTaskFile(row.storage_path),
  };
}
