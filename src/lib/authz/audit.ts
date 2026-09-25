import { getSupabaseAdmin } from "@/lib/supabase";
import { getPrincipal } from "./principal";

/**
 * Ghi một dòng `access_audit` cho thay đổi quyền truy cập làm ở tầng ứng dụng
 * (roster agent, delegation assistant). Thay đổi role/account đã được các RPC
 * Phase C tự ghi trong cùng transaction.
 *
 * Lỗi chỉ ghi log: thao tác đã commit, và bảng có thể chưa có nếu rollout Phase C
 * chưa chạy.
 */
export async function recordAccessAudit(entry: {
  event: string;
  targetType: string;
  targetId: string;
  before?: unknown;
  after?: unknown;
}): Promise<void> {
  const principal = await getPrincipal().catch(() => null);
  const { error } = await getSupabaseAdmin()
    .from("access_audit")
    .insert({
      actor_account_id: principal?.accountId ?? null,
      actor_email: principal?.email ?? null,
      event: entry.event,
      target_type: entry.targetType,
      target_id: entry.targetId,
      before: entry.before ?? null,
      after: entry.after ?? null,
    });
  if (error) {
    console.error("[authz] access_audit insert failed", { event: entry.event, error: error.message });
  }
}
