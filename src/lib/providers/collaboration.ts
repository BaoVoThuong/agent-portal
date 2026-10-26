import type { SupabaseClient } from "@supabase/supabase-js";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { can } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { fetchEmailsWithPermission } from "@/lib/rbac/permission-holders";
import { createSharedLookup } from "@/lib/shared-lookup";
import { resolveDisplayNames } from "@/lib/people/display-names";
import { indexReactionRows, type ReactionRow } from "@/lib/tasks/reactions";
import type { CommentWithAttachments } from "@/lib/tasks/detail";
import type { TaskAssignee } from "@/lib/tasks/assignees";
import { sendBroadcastMessages } from "@/lib/tasks/realtime";
import { nextCommentPageCursor, type CommentCursor } from "@/lib/collaboration/comment-pagination";
import { canManageProviders } from "./access";
import type { ProviderActivityRow, ProviderActivityType } from "./activity";
import { providerReactionTopic, providerRoomTopic } from "./realtime-topics";
import { PROVIDER_TABLE } from "./types";

/**
 * Comments + Activity của Provider List (2026-10-25). Cùng khuôn Enrollment
 * (lib/enrollment/detail.ts) nhưng không có đính kèm.
 *
 * Quyền: ai xem được Provider List (`automation.provider_finder`) thì đọc
 * được; chỉ tầng Manage viết — comment, trả lời, sửa/xoá, reaction.
 */

export const PROVIDER_ACTIVITY_LIMIT = 250;
const PROVIDER_COMMENT_COLUMNS =
  "id,provider_id,parent_id,author_email,body,created_at,updated_at,deleted_at";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isProviderUuid(value: string | null | undefined): value is string {
  return Boolean(value && UUID_RE.test(value));
}

export type ProviderCollabContext = {
  supabase: SupabaseClient;
  email: string;
  canComment: boolean;
  provider: { id: string; doctors: string | null; facility: string | null };
};

/**
 * Người đang gọi + provider đang mở. `write: true` đòi tầng Manage.
 * Provider đã archive coi như không còn: comment vào dòng đã xoá là comment
 * không ai thấy.
 */
export async function loadProviderCollabContext(
  providerId: string,
  options: { write?: boolean } = {}
): Promise<
  | ({ ok: true } & ProviderCollabContext)
  | { ok: false; error: string; status: number }
> {
  const session = await auth();
  const email = session?.user?.email?.trim().toLowerCase();
  if (!session || !email) return { ok: false, error: "Unauthorized", status: 401 };
  const permissions = session.user.permissions;
  if (!can(permissions, PERMISSIONS.AUTOMATION_PROVIDER_FINDER)) {
    return { ok: false, error: "Forbidden", status: 403 };
  }
  const canComment = canManageProviders(permissions);
  if (options.write && !canComment) {
    return { ok: false, error: "Only Provider List managers can comment.", status: 403 };
  }
  if (!isProviderUuid(providerId)) {
    return { ok: false, error: "Invalid provider id.", status: 400 };
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from(PROVIDER_TABLE)
    .select("id,doctors,facility")
    .eq("id", providerId)
    .is("archived_at", null)
    .maybeSingle();
  if (error) return { ok: false, error: error.message, status: 500 };
  if (!data) return { ok: false, error: "Not found", status: 404 };
  return {
    ok: true,
    supabase,
    email,
    canComment,
    provider: data as ProviderCollabContext["provider"],
  };
}

export async function loadProviderComments(
  supabase: SupabaseClient,
  providerId: string,
  opts: { before?: CommentCursor; limit: number }
): Promise<{ comments: CommentWithAttachments[]; hasMore: boolean; nextCursor: CommentCursor | null }> {
  let query = supabase
    .from("provider_comments")
    .select(PROVIDER_COMMENT_COLUMNS)
    .eq("provider_id", providerId)
    .is("deleted_at", null);
  if (opts.before) {
    query = query.or(
      `created_at.lt.${opts.before.created_at},and(created_at.eq.${opts.before.created_at},id.lt.${opts.before.id})`
    );
  }
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(opts.limit + 1);
  if (error) throw new Error(error.message);

  let rows = (data ?? []) as unknown as Array<{
    id: string;
    parent_id: string | null;
    author_email: string;
    created_at: string;
  }>;
  const hasMore = rows.length > opts.limit;
  rows = rows.slice(0, opts.limit);
  // Reply có thể kéo comment gốc rất cũ vào response. Cursor phải theo trang
  // gốc của truy vấn, nếu không "Load older" sẽ nhảy qua các comment ở giữa.
  const nextCursor = nextCommentPageCursor(rows, hasMore);

  // Trả lời nằm ở trang này mà comment gốc ở trang cũ hơn: kéo gốc về theo,
  // nếu không CommentThread không có chỗ treo câu trả lời.
  const missingParents = [
    ...new Set(rows.map((row) => row.parent_id).filter((id): id is string => Boolean(id))),
  ].filter((id) => !rows.some((row) => row.id === id));
  if (missingParents.length > 0) {
    const { data: parents, error: parentsError } = await supabase
      .from("provider_comments")
      .select(PROVIDER_COMMENT_COLUMNS)
      .eq("provider_id", providerId)
      .in("id", missingParents)
      .is("deleted_at", null);
    if (parentsError) throw new Error(parentsError.message);
    rows.push(...((parents ?? []) as unknown as typeof rows));
  }

  rows.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  const commentIds = rows.map((row) => row.id);
  const [names, reactionResult] = await Promise.all([
    resolveDisplayNames(rows.map((row) => row.author_email)),
    rows.length === 0
      ? Promise.resolve({ data: [] as ReactionRow[], error: null })
      : supabase
          .from("provider_comment_reactions")
          .select("comment_id,emoji,reactor_email")
          .in("comment_id", commentIds),
  ]);
  // Reaction là phần phụ: lỗi không làm mất cả comment.
  if (reactionResult.error) {
    console.warn("[provider-detail] reaction snapshot unavailable", reactionResult.error.message);
  }
  const reactionRows = (reactionResult.data ?? []) as ReactionRow[];
  const reactionsByComment = indexReactionRows(reactionRows);
  return {
    comments: rows.map((row) => ({
      ...row,
      author_name: names.get(row.author_email.trim().toLowerCase()),
      attachments: [],
      reactions: reactionsByComment.get(row.id) ?? [],
    })),
    hasMore,
    nextCursor,
  };
}

export async function loadProviderActivity(
  supabase: SupabaseClient,
  providerId: string
): Promise<ProviderActivityRow[]> {
  const { data, error } = await supabase
    .from("provider_activity")
    .select("id,actor_email,type,meta,created_at")
    .eq("provider_id", providerId)
    .order("created_at", { ascending: false })
    .limit(PROVIDER_ACTIVITY_LIMIT);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as ProviderActivityRow[];
  const names = await resolveDisplayNames(rows.map((row) => row.actor_email));
  return rows.map((row) => ({
    ...row,
    actor_name: names.get(row.actor_email.trim().toLowerCase()) ?? null,
  }));
}

// Ai xem được Provider List — đúng tập người nhận được thông báo @mention và
// hiện trong ô gợi ý. Dùng lại 60 giây như các lookup quyền khác
// (TASK_MEMBERSHIP_REUSE_MS): mỗi lần mở dialog mà đọc lại là 5 lượt nối đuôi.
const providerViewers = createSharedLookup(
  async (): Promise<TaskAssignee[]> => {
    const emails = await fetchEmailsWithPermission(PERMISSIONS.AUTOMATION_PROVIDER_FINDER);
    if (emails.length === 0) return [];
    const { data, error } = await getSupabaseAdmin()
      .from("portal_account")
      .select("email,name")
      .in("email", emails)
      .eq("is_active", true);
    if (error) throw new Error(error.message);
    return ((data ?? []) as { email: string; name: string | null }[])
      .map((row) => ({ email: row.email.trim().toLowerCase(), name: row.name }))
      .sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email));
  },
  { ttlMs: 60 * 1000 }
);

export async function fetchProviderViewers(): Promise<TaskAssignee[]> {
  return [...(await providerViewers.get("all"))];
}

/** Ghi activity không được làm hỏng thao tác đã lưu: lỗi chỉ ghi log. */
export async function insertProviderActivity(
  supabase: SupabaseClient,
  rows: {
    provider_id: string;
    actor_email: string;
    type: ProviderActivityType;
    meta?: Record<string, unknown> | null;
  }[]
): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await supabase
    .from("provider_activity")
    .insert(rows.map((row) => ({ ...row, meta: row.meta ?? null })));
  if (error) {
    console.error("provider.activity.insert_failed", {
      count: rows.length,
      error: error.message,
    });
  }
}

export async function broadcastProviderRoom(providerId: string): Promise<boolean> {
  return sendBroadcastMessages([
    { topic: providerRoomTopic(providerId), event: "changed", payload: {} },
  ]);
}

export async function broadcastProviderCommentReaction(providerId: string): Promise<boolean> {
  return sendBroadcastMessages([
    { topic: providerReactionTopic(providerId), event: "reaction", payload: {} },
  ]);
}
