import type { SupabaseClient } from "@supabase/supabase-js";
import { signTaskFile } from "./storage";
import type {
  EnrollmentActivityRow,
  EnrollmentCommentWithAttachments,
  EnrollmentDetail,
  EnrollmentSignedAttachment,
} from "./types";
import { resolveDisplayNames } from "@/lib/people/display-names";
import { COMMENT_PAGE_SIZE, type CommentCursor } from "@/lib/collaboration/comment-pagination";

export const ENROLLMENT_ACTIVITY_LIMIT = 250;

const COMMENT_COLUMNS =
  "id,record_id,parent_id,author_email,body,created_at,updated_at,deleted_at";

type CommentAttachmentRow = {
  id: string;
  comment_id: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  storage_path: string;
};

type RecordAttachmentRow = {
  id: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  storage_path: string;
};

export async function loadEnrollmentComments(
  supabase: SupabaseClient,
  recordId: string,
  opts: { includeAttachments?: boolean; before?: CommentCursor; highlightCommentId?: string | null } = {}
): Promise<{ comments: EnrollmentCommentWithAttachments[]; hasMore: boolean }> {
  let query = supabase
    .from("enrollment_comments")
    .select(COMMENT_COLUMNS)
    .eq("record_id", recordId)
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

  let commentRows = (comments ?? []) as unknown as Array<{
    id: string;
    parent_id: string | null;
    author_email: string;
    created_at: string;
  }>;
  const hasMore = commentRows.length > COMMENT_PAGE_SIZE;
  commentRows = commentRows.slice(0, COMMENT_PAGE_SIZE);
  if (opts.highlightCommentId && !commentRows.some((row) => row.id === opts.highlightCommentId)) {
    const { data: highlighted, error } = await supabase
      .from("enrollment_comments")
      .select(COMMENT_COLUMNS)
      .eq("record_id", recordId)
      .eq("id", opts.highlightCommentId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (highlighted) commentRows.push(highlighted as unknown as (typeof commentRows)[number]);
  }
  const parentIds = [...new Set(commentRows.map((row) => row.parent_id).filter(Boolean))]
    .filter((id) => !commentRows.some((row) => row.id === id));
  if (parentIds.length > 0) {
    const { data: parents, error } = await supabase
      .from("enrollment_comments")
      .select(COMMENT_COLUMNS)
      .eq("record_id", recordId)
      .in("id", parentIds)
      .is("deleted_at", null);
    if (error) throw new Error(error.message);
    commentRows.push(...((parents ?? []) as unknown as typeof commentRows));
  }
  commentRows.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  const displayNames = await resolveDisplayNames(commentRows.map((comment) => comment.author_email));
  const commentsWithNames = commentRows.map((comment) => ({
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

  const { data: attachments, error: attachmentsError } = await supabase
    .from("enrollment_attachments")
    .select("id,comment_id,file_name,mime_type,size_bytes,storage_path,created_at")
    .in("comment_id", commentRows.map((comment) => comment.id))
    .not("comment_id", "is", null)
    .order("created_at", { ascending: true });
  if (attachmentsError) throw new Error(attachmentsError.message);

  const attachmentRows = (attachments ?? []) as unknown as CommentAttachmentRow[];
  if (attachmentRows.length === 0) {
    return {
      comments: commentsWithNames.map((comment) => ({
        ...(comment as Record<string, unknown>),
        id: comment.id,
        attachments: [],
      })),
      hasMore,
    };
  }

  const signed = await Promise.allSettled(
    attachmentRows.map(async (row) => ({
      comment_id: row.comment_id,
      attachment: await signEnrollmentAttachment(row),
    }))
  );
  const byComment = new Map<string, EnrollmentSignedAttachment[]>();
  for (const [index, result] of signed.entries()) {
    const source = attachmentRows[index];
    const list = byComment.get(source.comment_id) ?? [];
    list.push(result.status === "fulfilled" ? result.value.attachment : {
      id: source.id,
      file_name: source.file_name,
      mime_type: source.mime_type,
      size_bytes: source.size_bytes,
      url: null,
      unavailable: true,
    });
    byComment.set(source.comment_id, list);
  }

  return { comments: commentsWithNames.map((comment) => ({
    ...(comment as Record<string, unknown>),
    id: comment.id,
    attachments: byComment.get(comment.id) ?? [],
  })), hasMore };
}

export async function loadEnrollmentActivity(
  supabase: SupabaseClient,
  recordId: string
): Promise<EnrollmentActivityRow[]> {
  const { data, error } = await supabase
    .from("enrollment_activity")
    .select("id,actor_email,type,meta,created_at")
    .eq("record_id", recordId)
    .order("created_at", { ascending: false })
    .limit(ENROLLMENT_ACTIVITY_LIMIT);
  if (error) throw new Error(error.message);
  const activity = (data ?? []) as unknown as EnrollmentActivityRow[];
  const displayNames = await resolveDisplayNames(activity.map((row) => row.actor_email));
  return activity.map((row) => ({
    ...row,
    actor_name: displayNames.get(row.actor_email.trim().toLowerCase()),
  }));
}

export async function loadEnrollmentAttachments(
  supabase: SupabaseClient,
  recordId: string
): Promise<EnrollmentSignedAttachment[]> {
  const { data, error } = await supabase
    .from("enrollment_attachments")
    .select("id,file_name,mime_type,size_bytes,storage_path,created_at")
    .eq("record_id", recordId)
    .is("comment_id", null)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as RecordAttachmentRow[];
  const signed = await Promise.allSettled(rows.map((row) => signEnrollmentAttachment(row)));
  return rows.map((row, index) => {
    const result = signed[index];
    if (result.status === "fulfilled") return result.value;
    return {
      id: row.id,
      file_name: row.file_name,
      mime_type: row.mime_type,
      size_bytes: row.size_bytes,
      url: null,
      unavailable: true as const,
    };
  });
}

export async function loadEnrollmentDetail(
  supabase: SupabaseClient,
  recordId: string,
  opts: { commentsBefore?: CommentCursor; highlightCommentId?: string | null } = {}
): Promise<EnrollmentDetail> {
  const [commentPage, activity, attachments] = await Promise.all([
    loadEnrollmentComments(supabase, recordId, opts),
    loadEnrollmentActivity(supabase, recordId),
    loadEnrollmentAttachments(supabase, recordId),
  ]);
  return { comments: commentPage.comments, commentsHasMore: commentPage.hasMore, activity, attachments };
}

async function signEnrollmentAttachment(
  row: CommentAttachmentRow | RecordAttachmentRow
): Promise<EnrollmentSignedAttachment> {
  return {
    id: row.id,
    file_name: row.file_name,
    mime_type: row.mime_type,
    size_bytes: row.size_bytes,
    url: await signTaskFile(row.storage_path),
  };
}
