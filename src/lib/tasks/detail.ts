import type { SupabaseClient } from "@supabase/supabase-js";
import {
  signTaskFile,
  signTaskFiles,
  type BatchSignedTaskFile,
} from "./storage";
import { resolveDisplayNames } from "@/lib/people/display-names";
import {
  COMMENT_PAGE_SIZE,
  type CommentCursor,
} from "@/lib/collaboration/comment-pagination";
import type { ReactionRow } from "./reactions";
import type { TimingRecorder } from "@/lib/server-timing";

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
  /**
   * Raw rows, not grouped: `reactedByMe` depends on the viewer and this shape
   * is stored in the shared detail-cache. The client calls groupReactions().
   * Optional because reactions hydrate through a separate lightweight endpoint
   * and optimistic rows do not have a canonical reaction snapshot yet.
   */
  reactions?: ReactionRow[];
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

async function measureTiming<T>(
  timing: TimingRecorder | undefined,
  name: string,
  operation: () => Promise<T>,
): Promise<T> {
  return timing ? timing.measure(name, operation) : operation();
}

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
  opts: {
    includeAttachments?: boolean;
    before?: CommentCursor;
    limit?: number;
    highlightCommentId?: string | null;
    timing?: TimingRecorder;
    displayNameResolver?: typeof resolveDisplayNames;
  } = {}
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
  const limit = Math.max(1, Math.floor(opts.limit ?? COMMENT_PAGE_SIZE));
  const { data: comments, error: commentsError } = await measureTiming(
    opts.timing,
    "comment_query",
    async () =>
      query
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(limit + 1),
  );
  if (commentsError) throw new Error(commentsError.message);

  let rawComments = (comments ?? []) as unknown as Array<{
    id: string;
    parent_id: string | null;
    author_email: string;
    created_at: string;
  }>;
  const hasMore = rawComments.length > limit;
  rawComments = rawComments.slice(0, limit);
  if (opts.highlightCommentId && !rawComments.some((row) => row.id === opts.highlightCommentId)) {
    const { data: highlighted, error } = await measureTiming(
      opts.timing,
      "comment_highlight",
      async () =>
        supabase
          .from("task_comments")
          .select(COMMENT_COLUMNS)
          .eq("task_id", taskId)
          .eq("id", opts.highlightCommentId!)
          .is("deleted_at", null)
          .maybeSingle(),
    );
    if (error) throw new Error(error.message);
    if (highlighted) rawComments.push(highlighted as unknown as (typeof rawComments)[number]);
  }
  const parentIds = [...new Set(rawComments.map((row) => row.parent_id).filter(Boolean))]
    .filter((id) => !rawComments.some((row) => row.id === id));
  if (parentIds.length > 0) {
    const { data: parents, error } = await measureTiming(
      opts.timing,
      "comment_parents",
      async () =>
        supabase
          .from("task_comments")
          .select(COMMENT_COLUMNS)
          .eq("task_id", taskId)
          .in("id", parentIds)
          .is("deleted_at", null),
    );
    if (error) throw new Error(error.message);
    rawComments.push(...((parents ?? []) as unknown as typeof rawComments));
  }
  rawComments.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  const displayNamesPromise = measureTiming(
    opts.timing,
    "comment_names",
    async () =>
      (opts.displayNameResolver ?? resolveDisplayNames)(
        rawComments.map((comment) => comment.author_email),
      ),
  );

  if (opts.includeAttachments === false) {
    const displayNames = await displayNamesPromise;
    const commentsWithNames = rawComments.map((comment) => ({
      ...comment,
      author_name: displayNames.get(comment.author_email.trim().toLowerCase()),
    }));
    return { comments: commentsWithNames.map((comment) => ({
      ...(comment as Record<string, unknown>),
      id: comment.id,
      attachments: [],
    })), hasMore };
  }

  const commentIds = rawComments.map((comment) => comment.id);
  if (commentIds.length === 0) {
    await displayNamesPromise;
    return { comments: [], hasMore };
  }
  // Both lookups depend only on the finalized comment page. Running them in
  // parallel removes one full database round-trip from the comment critical
  // path without changing the response shape or authorization boundary.
  const [displayNames, { data: attachmentRows, error: attachmentsError }] =
    await Promise.all([
      displayNamesPromise,
      measureTiming(
        opts.timing,
        "comment_file_rows",
        async () =>
          supabase
            .from("task_attachments")
            .select("id,comment_id,file_name,mime_type,size_bytes,storage_path,created_at")
            .in("comment_id", commentIds)
            .not("comment_id", "is", null)
            .is("deleted_at", null)
            .order("created_at", { ascending: true }),
      ),
    ]);
  if (attachmentsError) throw new Error(attachmentsError.message);

  const commentsWithNames = rawComments.map((comment) => ({
    ...comment,
    author_name: displayNames.get(comment.author_email.trim().toLowerCase()),
  }));

  const rows = (attachmentRows ?? []) as unknown as CommentAttachmentRow[];
  const attachments = await measureTiming(
    opts.timing,
    "comment_file_sign",
    async () => signAttachmentsSafely(rows),
  );
  const signed = rows.map((row, index) => ({ comment_id: row.comment_id, att: attachments[index] }));

  return { comments: groupCommentAttachments(
    commentsWithNames as unknown as { id: string }[],
    signed
  ), hasMore };
}

export async function loadActivity(
  supabase: SupabaseClient,
  taskId: string,
  timing?: TimingRecorder,
): Promise<ActivityRow[]> {
  const { data, error } = await measureTiming(
    timing,
    "activity_query",
    async () =>
      supabase
        .from("task_activity")
        .select("id,actor_email,type,meta,created_at")
        .eq("task_id", taskId)
        .order("created_at", { ascending: false })
        .limit(TASK_ACTIVITY_LIMIT),
  );
  if (error) throw new Error(error.message);

  const activity = (data ?? []) as unknown as ActivityRow[];
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

export async function loadTaskAttachments(
  supabase: SupabaseClient,
  taskId: string,
  timing?: TimingRecorder,
): Promise<SignedAttachment[]> {
  const { data, error } = await measureTiming(
    timing,
    "task_file_rows",
    async () =>
      supabase
        .from("task_attachments")
        .select("id,file_name,mime_type,size_bytes,storage_path,created_at")
        .eq("task_id", taskId)
        .is("comment_id", null)
        .is("deleted_at", null)
        .order("created_at", { ascending: true }),
  );
  if (error) throw new Error(error.message);

  return measureTiming(timing, "task_file_sign", async () =>
    signAttachmentsSafely((data ?? []) as unknown as TaskAttachmentRow[]),
  );
}

export async function loadTaskDetail(
  supabase: SupabaseClient,
  taskId: string,
  opts: {
    includeActivity?: boolean;
    includeCommentAttachments?: boolean;
    includeTaskAttachments?: boolean;
    commentsBefore?: CommentCursor;
    commentLimit?: number;
    highlightCommentId?: string | null;
    timing?: TimingRecorder;
  } = {}
): Promise<TaskDetail> {
  const [commentPage, activity, attachments] = await Promise.all([
    measureTiming(opts.timing, "comments", async () =>
      loadComments(supabase, taskId, {
        includeAttachments: opts.includeCommentAttachments,
        before: opts.commentsBefore,
        limit: opts.commentLimit,
        highlightCommentId: opts.highlightCommentId,
        timing: opts.timing,
      }),
    ),
    opts.includeActivity === false
      ? Promise.resolve([])
      : measureTiming(opts.timing, "activity", async () =>
          loadActivity(supabase, taskId, opts.timing),
        ),
    opts.includeTaskAttachments === false
      ? Promise.resolve([])
      : measureTiming(opts.timing, "task_files", async () =>
          loadTaskAttachments(supabase, taskId, opts.timing),
        ),
  ]);

  return { comments: commentPage.comments, commentsHasMore: commentPage.hasMore, activity, attachments };
}

export async function signAttachmentsSafely<
  T extends { id: string; file_name: string; mime_type: string | null; size_bytes: number | null; storage_path: string }
>(
  rows: readonly T[],
  sign: (path: string) => Promise<string> = signTaskFile,
  signMany: ((paths: string[]) => Promise<BatchSignedTaskFile[]>) | undefined =
    sign === signTaskFile ? signTaskFiles : undefined,
): Promise<SignedAttachment[]> {
  if (signMany && rows.length > 0) {
    try {
      const results = await signMany(rows.map((row) => row.storage_path));
      return rows.map((row) => {
        const base = { id: row.id, file_name: row.file_name, mime_type: row.mime_type, size_bytes: row.size_bytes };
        const result = results.find((item) => item.path === row.storage_path);
        if (result?.signedUrl && !result.error) {
          return { ...base, url: result.signedUrl };
        }
        console.warn(`[attachments] could not sign ${row.id}`, result?.error ?? "Missing signed URL");
        return { ...base, url: null, unavailable: true as const };
      });
    } catch (error) {
      // A transport-level batch failure should not make every file disappear.
      // Fall back to isolated requests so recoverable objects remain usable.
      console.warn("[attachments] batch signing failed; retrying individually", error);
    }
  }

  const settled = await Promise.allSettled(rows.map((row) => sign(row.storage_path)));
  return rows.map((row, index) => {
    const base = { id: row.id, file_name: row.file_name, mime_type: row.mime_type, size_bytes: row.size_bytes };
    const result = settled[index];
    if (result.status === "fulfilled") return { ...base, url: result.value };
    console.warn(`[attachments] could not sign ${row.id}`, result.reason);
    return { ...base, url: null, unavailable: true as const };
  });
}
