import type { SupabaseClient } from "@supabase/supabase-js";
import { signTaskFile } from "./storage";
import type {
  EnrollmentActivityRow,
  EnrollmentCommentWithAttachments,
  EnrollmentDetail,
  EnrollmentSignedAttachment,
} from "./types";

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
  opts: { includeAttachments?: boolean } = {}
): Promise<EnrollmentCommentWithAttachments[]> {
  const { data: comments, error: commentsError } = await supabase
    .from("enrollment_comments")
    .select(COMMENT_COLUMNS)
    .eq("record_id", recordId)
    .order("created_at", { ascending: true });
  if (commentsError) throw new Error(commentsError.message);

  const commentRows = (comments ?? []) as unknown as { id: string }[];
  if (opts.includeAttachments === false) {
    return commentRows.map((comment) => ({
      ...(comment as Record<string, unknown>),
      id: comment.id,
      attachments: [],
    }));
  }

  const { data: attachments, error: attachmentsError } = await supabase
    .from("enrollment_attachments")
    .select("id,comment_id,file_name,mime_type,size_bytes,storage_path,created_at")
    .eq("record_id", recordId)
    .not("comment_id", "is", null)
    .order("created_at", { ascending: true });
  if (attachmentsError) throw new Error(attachmentsError.message);

  const signed = await Promise.all(
    ((attachments ?? []) as unknown as CommentAttachmentRow[]).map(async (row) => ({
      comment_id: row.comment_id,
      attachment: await signEnrollmentAttachment(row),
    }))
  );
  const byComment = new Map<string, EnrollmentSignedAttachment[]>();
  for (const row of signed) {
    const list = byComment.get(row.comment_id) ?? [];
    list.push(row.attachment);
    byComment.set(row.comment_id, list);
  }

  return commentRows.map((comment) => ({
    ...(comment as Record<string, unknown>),
    id: comment.id,
    attachments: byComment.get(comment.id) ?? [],
  }));
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
  return (data ?? []) as unknown as EnrollmentActivityRow[];
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

  return Promise.all(
    ((data ?? []) as unknown as RecordAttachmentRow[]).map((row) =>
      signEnrollmentAttachment(row)
    )
  );
}

export async function loadEnrollmentDetail(
  supabase: SupabaseClient,
  recordId: string
): Promise<EnrollmentDetail> {
  const [comments, activity, attachments] = await Promise.all([
    loadEnrollmentComments(supabase, recordId),
    loadEnrollmentActivity(supabase, recordId),
    loadEnrollmentAttachments(supabase, recordId),
  ]);
  return { comments, activity, attachments };
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
