import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveDisplayNames } from "@/lib/people/display-names";
import { signAttachmentsSafely } from "@/lib/tasks/detail";
import { indexReactionRows, type ReactionRow } from "@/lib/tasks/reactions";
import type { TimingRecorder } from "@/lib/server-timing";
import {
  COMMENT_PAGE_SIZE,
  type CommentCursor,
} from "@/lib/collaboration/comment-pagination";
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

async function measureTiming<T>(
  timing: TimingRecorder | undefined,
  name: string,
  operation: () => Promise<T>,
): Promise<T> {
  return timing ? timing.measure(name, operation) : operation();
}

export async function loadEnrollmentComments(
  supabase: SupabaseClient,
  recordId: string,
  opts: {
    includeAttachments?: boolean;
    before?: CommentCursor;
    highlightCommentId?: string | null;
    limit?: number;
    timing?: TimingRecorder;
    displayNameResolver?: typeof resolveDisplayNames;
  } = {},
): Promise<{ comments: EnrollmentCommentWithAttachments[]; hasMore: boolean }> {
  const commentLimit = Math.max(1, Math.floor(opts.limit ?? COMMENT_PAGE_SIZE));
  let query = supabase
    .from("enrollment_comments")
    .select(COMMENT_COLUMNS)
    .eq("record_id", recordId)
    .is("deleted_at", null);
  if (opts.before) {
    query = query.or(
      `created_at.lt.${opts.before.created_at},and(created_at.eq.${opts.before.created_at},id.lt.${opts.before.id})`,
    );
  }

  const { data: comments, error: commentsError } = await measureTiming(
    opts.timing,
    "comment_query",
    async () =>
      query
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(commentLimit + 1),
  );
  if (commentsError) throw new Error(commentsError.message);

  let commentRows = (comments ?? []) as unknown as Array<{
    id: string;
    parent_id: string | null;
    author_email: string;
    created_at: string;
  }>;
  const hasMore = commentRows.length > commentLimit;
  commentRows = commentRows.slice(0, commentLimit);

  if (
    opts.highlightCommentId &&
    !commentRows.some((row) => row.id === opts.highlightCommentId)
  ) {
    const { data: highlighted, error } = await measureTiming(
      opts.timing,
      "comment_highlight",
      async () =>
        supabase
          .from("enrollment_comments")
          .select(COMMENT_COLUMNS)
          .eq("record_id", recordId)
          .eq("id", opts.highlightCommentId!)
          .is("deleted_at", null)
          .maybeSingle(),
    );
    if (error) throw new Error(error.message);
    if (highlighted) {
      commentRows.push(highlighted as unknown as (typeof commentRows)[number]);
    }
  }

  const parentIds = [...new Set(commentRows.map((row) => row.parent_id).filter(Boolean))]
    .filter((id) => !commentRows.some((row) => row.id === id));
  if (parentIds.length > 0) {
    const { data: parents, error } = await measureTiming(
      opts.timing,
      "comment_parents",
      async () =>
        supabase
          .from("enrollment_comments")
          .select(COMMENT_COLUMNS)
          .eq("record_id", recordId)
          .in("id", parentIds)
          .is("deleted_at", null),
    );
    if (error) throw new Error(error.message);
    commentRows.push(...((parents ?? []) as unknown as typeof commentRows));
  }

  commentRows.sort(
    (a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
  );
  const displayNamesPromise = measureTiming(
    opts.timing,
    "comment_names",
    async () =>
      (opts.displayNameResolver ?? resolveDisplayNames)(
        commentRows.map((comment) => comment.author_email),
      ),
  );

  if (commentRows.length === 0) {
    await displayNamesPromise;
    return { comments: [], hasMore };
  }

  if (opts.includeAttachments === false) {
    const displayNames = await displayNamesPromise;
    return {
      comments: commentRows.map((comment) => ({
        ...comment,
        author_name: displayNames.get(comment.author_email.trim().toLowerCase()),
        attachments: [],
      })),
      hasMore,
    };
  }

  // Names and attachment rows are independent reads. Start both before
  // signing so Enrollment follows the same critical path as CS instead of
  // paying an extra database round-trip before file signing can begin.
  const [displayNames, { data: attachments, error: attachmentsError }] =
    await Promise.all([
      displayNamesPromise,
      measureTiming(
        opts.timing,
        "comment_file_rows",
        async () =>
          supabase
            .from("enrollment_attachments")
            .select("id,comment_id,file_name,mime_type,size_bytes,storage_path,created_at")
            .in("comment_id", commentRows.map((comment) => comment.id))
            .not("comment_id", "is", null)
            .is("deleted_at", null)
            .order("created_at", { ascending: true }),
      ),
    ]);
  if (attachmentsError) throw new Error(attachmentsError.message);

  const signedAttachments = await measureTiming(
    opts.timing,
    "comment_file_sign",
    async () =>
      signAttachmentsSafely((attachments ?? []) as unknown as CommentAttachmentRow[]),
  );
  const attachmentRows = (attachments ?? []) as unknown as CommentAttachmentRow[];
  const byComment = new Map<string, EnrollmentSignedAttachment[]>();
  for (const [index, attachment] of signedAttachments.entries()) {
    const commentId = attachmentRows[index]?.comment_id;
    if (!commentId) continue;
    const list = byComment.get(commentId) ?? [];
    list.push(attachment);
    byComment.set(commentId, list);
  }

  return {
    comments: commentRows.map((comment) => ({
      ...comment,
      author_name: displayNames.get(comment.author_email.trim().toLowerCase()),
      attachments: byComment.get(comment.id) ?? [],
    })),
    hasMore,
  };
}

export async function loadEnrollmentActivity(
  supabase: SupabaseClient,
  recordId: string,
  timing?: TimingRecorder,
): Promise<EnrollmentActivityRow[]> {
  const { data, error } = await measureTiming(
    timing,
    "activity_query",
    async () =>
      supabase
        .from("enrollment_activity")
        .select("id,actor_email,type,meta,created_at")
        .eq("record_id", recordId)
        .order("created_at", { ascending: false })
        .limit(ENROLLMENT_ACTIVITY_LIMIT),
  );
  if (error) throw new Error(error.message);

  const activity = (data ?? []) as unknown as EnrollmentActivityRow[];
  const displayNames = await measureTiming(
    timing,
    "activity_names",
    async () => resolveDisplayNames(activity.map((row) => row.actor_email)),
  );
  return activity.map((row) => ({
    ...row,
    actor_name: displayNames.get(row.actor_email.trim().toLowerCase()),
  }));
}

export async function loadEnrollmentAttachments(
  supabase: SupabaseClient,
  recordId: string,
  timing?: TimingRecorder,
): Promise<EnrollmentSignedAttachment[]> {
  const { data, error } = await measureTiming(
    timing,
    "record_file_rows",
    async () =>
      supabase
        .from("enrollment_attachments")
        .select("id,file_name,mime_type,size_bytes,storage_path,created_at")
        .eq("record_id", recordId)
        .is("comment_id", null)
        .is("deleted_at", null)
        .order("created_at", { ascending: true }),
  );
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as RecordAttachmentRow[];
  return measureTiming(timing, "record_file_sign", async () =>
    signAttachmentsSafely(rows),
  );
}

export async function loadEnrollmentDetail(
  supabase: SupabaseClient,
  recordId: string,
  opts: {
    commentsBefore?: CommentCursor;
    highlightCommentId?: string | null;
    commentLimit?: number;
    includeActivity?: boolean;
    includeCommentAttachments?: boolean;
    includeAttachments?: boolean;
    includeReactions?: boolean;
    timing?: TimingRecorder;
  } = {},
): Promise<EnrollmentDetail> {
  const [commentPage, activity, attachments, reactionRows] = await Promise.all([
    measureTiming(opts.timing, "comments", async () =>
      loadEnrollmentComments(supabase, recordId, {
        before: opts.commentsBefore,
        highlightCommentId: opts.highlightCommentId,
        limit: opts.commentLimit,
        includeAttachments: opts.includeCommentAttachments !== false,
        timing: opts.timing,
      }),
    ),
    opts.includeActivity === false
      ? Promise.resolve([])
      : measureTiming(opts.timing, "activity", async () =>
          loadEnrollmentActivity(supabase, recordId, opts.timing),
        ),
    opts.includeAttachments === false
      ? Promise.resolve([])
      : measureTiming(opts.timing, "record_files", async () =>
          loadEnrollmentAttachments(supabase, recordId, opts.timing),
        ),
    opts.includeReactions
      ? measureTiming(opts.timing, "reactions", async () => {
          const { data, error } = await supabase.rpc(
            "enrollment_comment_reactions_for_record",
            { p_record_id: recordId },
          );
          if (error) {
            // Reactions are optional enrichment. Keep the enrollment detail
            // usable and let CommentThread fall back to its old endpoint.
            console.warn(
              "[enrollment-detail] initial reaction snapshot unavailable",
              error.message,
            );
            return null;
          }
          return (data ?? []) as ReactionRow[];
        })
      : Promise.resolve(null as ReactionRow[] | null),
  ]);
  const reactionsByComment = reactionRows ? indexReactionRows(reactionRows) : null;
  const comments = reactionsByComment
    ? commentPage.comments.map((comment) => ({
        ...comment,
        reactions: reactionsByComment.get(comment.id) ?? [],
      }))
    : commentPage.comments;
  return {
    comments,
    commentsHasMore: commentPage.hasMore,
    activity,
    attachments,
  };
}
