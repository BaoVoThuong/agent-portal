import { hasGrant } from "@/lib/authz/grants";
import { getSupabaseAdmin } from "@/lib/supabase";
import { audienceKey, enrollmentViewersAmong, taskViewersAmong } from "./audience";

/**
 * KIỂM LẠI LÚC ĐỌC (Phase F, D17): thông báo đã ghi từ trước vẫn nằm trong chuông
 * sau khi người nhận mất quyền (bị bỏ giao, rời roster, đổi role…). Chuông chỉ
 * được hiện tiêu đề / bình luận của bản ghi người xem CÒN mở được ngay lúc này
 * (review Phase A, P2-01).
 *
 * Trả về tập khoá `${entity_type}:${entity_id}` còn xem được. Lỗi thì trả tập
 * rỗng (fail-closed: mọi dòng bị rút gọn) và ghi log.
 */
export type NotificationEntityRef = {
  entity_type: "task" | "enrollment" | "time_off";
  entity_id: string;
};

export function entityRefKey(ref: NotificationEntityRef): string {
  return `${ref.entity_type}:${ref.entity_id}`;
}

export async function visibleNotificationEntities(
  viewer: { email: string; accountId: string | null; grants: readonly string[] },
  refs: readonly NotificationEntityRef[]
): Promise<Set<string>> {
  const visible = new Set<string>();
  const idsOf = (type: NotificationEntityRef["entity_type"]) => [
    ...new Set(refs.filter((ref) => ref.entity_type === type).map((ref) => ref.entity_id)),
  ];
  const taskIds = idsOf("task");
  const recordIds = idsOf("enrollment");
  const timeOffIds = idsOf("time_off");

  try {
    const [tasks, records, timeOff] = await Promise.all([
      taskViewersAmong(taskIds.map((entityId) => ({ entityId, email: viewer.email }))),
      enrollmentViewersAmong(recordIds.map((entityId) => ({ entityId, email: viewer.email }))),
      visibleTimeOffRequests(viewer, timeOffIds),
    ]);
    for (const id of taskIds) {
      if (tasks.has(audienceKey(id, viewer.email))) visible.add(`task:${id}`);
    }
    for (const id of recordIds) {
      if (records.has(audienceKey(id, viewer.email))) visible.add(`enrollment:${id}`);
    }
    for (const id of timeOff) visible.add(`time_off:${id}`);
  } catch (error) {
    console.warn("[notifications] read-time access check failed; redacting", {
      error: error instanceof Error ? error.message : String(error),
    });
    return new Set();
  }
  return visible;
}

/** Đơn nghỉ: người duyệt xem mọi đơn; người thường chỉ đơn của chính mình. */
async function visibleTimeOffRequests(
  viewer: { email: string; accountId: string | null; grants: readonly string[] },
  ids: string[]
): Promise<string[]> {
  if (ids.length === 0) return [];
  if (hasGrant(viewer.grants, "timeoff.manage")) return ids;
  if (!hasGrant(viewer.grants, "timeoff.request")) return [];
  const supabase = getSupabaseAdmin();
  let accountId = viewer.accountId;
  if (!accountId) {
    const { data, error } = await supabase
      .from("portal_account")
      .select("id")
      .eq("email", viewer.email.trim().toLowerCase())
      .maybeSingle();
    if (error) throw new Error(error.message);
    accountId = (data as { id: string } | null)?.id ?? null;
  }
  if (!accountId) return [];
  const { data, error } = await supabase
    .from("time_off_requests")
    .select("id")
    .in("id", ids)
    .eq("requester_id", accountId);
  if (error) throw new Error(error.message);
  return ((data ?? []) as { id: string }[]).map((row) => row.id);
}
