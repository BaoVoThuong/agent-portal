import { getSupabaseAdmin } from "@/lib/supabase";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { fetchEmailsWithPermission } from "@/lib/rbac/permission-holders";
import { broadcastNotif } from "@/lib/tasks/realtime";

/**
 * Thông báo của Time Off.
 *
 * Đi theo đúng khuôn `enrollment_notifications`: mỗi module một bảng, chuông
 * đọc hết rồi trộn lại. KHÔNG nhồi vào `task_notifications` — bảng đó có
 * `task_id not null references tasks(id)`, muốn dùng chung phải nới cột đó
 * thành nullable, tức đụng vào đường thông báo bận nhất của cả ứng dụng để
 * phục vụ một module phụ.
 */

export type TimeOffNotificationType =
  | "submitted"
  | "approved"
  | "rejected"
  | "cancelled";

export type TimeOffNotificationInsertInput = {
  recipient_email: string;
  request_id: string;
  type: TimeOffNotificationType;
  actor_email: string;
  detail?: string | null;
};

function normalizeEmail(email: string | null | undefined): string {
  return email?.trim().toLowerCase() ?? "";
}

/**
 * Gộp trùng theo (đơn, người nhận, loại).
 *
 * Người vừa được chọn làm manager vừa có quyền duyệt sẽ lọt vào cả hai danh
 * sách người nhận. Không gộp ở đây thì họ nhận hai thông báo giống hệt nhau
 * cho cùng một đơn — và index duy nhất dưới database sẽ làm cả lượt insert
 * thất bại, kéo theo cả thao tác nộp đơn.
 */
export function uniqueTimeOffNotificationRows(
  rows: readonly TimeOffNotificationInsertInput[]
): TimeOffNotificationInsertInput[] {
  const seen = new Map<string, TimeOffNotificationInsertInput>();
  for (const row of rows) {
    const recipient = normalizeEmail(row.recipient_email);
    if (!recipient || !row.request_id) continue;
    const key = `${row.request_id}::${recipient}::${row.type}`;
    if (seen.has(key)) continue;
    seen.set(key, { ...row, recipient_email: recipient });
  }
  return [...seen.values()];
}

/**
 * Ai được báo khi có đơn nghỉ mới: manager được chọn + mọi người có quyền
 * duyệt. Loại chính người nộp — không ai cần tin nhắn báo về việc mình vừa làm.
 *
 * Quyết định của đội: chọn manager là để BÁO TIN, không giới hạn ai được
 * duyệt. Nên danh sách người duyệt vẫn là toàn bộ người có `timeoff.admin`,
 * y như trước.
 */
export async function resolveTimeOffRecipients(opts: {
  requesterEmail: string;
  managerEmail: string | null;
}): Promise<string[]> {
  const approvers = await fetchEmailsWithPermission(PERMISSIONS.TIME_OFF_ADMIN);
  const requester = normalizeEmail(opts.requesterEmail);
  return [
    ...new Set(
      [normalizeEmail(opts.managerEmail), ...approvers]
        .filter(Boolean)
        .filter((email) => email !== requester)
    ),
  ];
}

export async function insertTimeOffNotifications(
  rows: readonly TimeOffNotificationInsertInput[]
): Promise<void> {
  const uniqueRows = uniqueTimeOffNotificationRows(rows);
  if (uniqueRows.length === 0) return;

  const { error } = await getSupabaseAdmin()
    .from("time_off_notifications")
    .insert(
      uniqueRows.map((row) => ({
        recipient_email: row.recipient_email,
        request_id: row.request_id,
        type: row.type,
        actor_email: row.actor_email,
        detail: row.detail ?? null,
      }))
    );
  if (error) throw new Error(error.message);

  await broadcastNotif(uniqueRows.map((row) => row.recipient_email));
}
