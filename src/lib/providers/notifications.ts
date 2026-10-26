import { getSupabaseAdmin } from "@/lib/supabase";
import { broadcastNotif } from "@/lib/tasks/realtime";
import { parseMentions } from "@/lib/tasks/mentions";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { fetchEmailsWithPermission } from "@/lib/rbac/permission-holders";
import { fetchProviderViewers } from "./collaboration";

/**
 * Thông báo của Provider List: @mention trong comment (user chốt 25/10), và
 * Backlog (26/10) — báo cả hai phía. Bảng riêng `provider_notifications`, chuông
 * đọc nó như nguồn thứ tư.
 */

export type ProviderNotificationType = "mentioned" | "submitted" | "approved" | "rejected";

export type ProviderNotificationRow = {
  recipient_email: string;
  provider_id: string;
  type: ProviderNotificationType;
  actor_email: string;
  comment_id: string | null;
  detail?: string | null;
};

const normalizeEmail = (email: string) => email.trim().toLowerCase();

/**
 * Ghi rồi phát (realtime + Web Push). Lỗi ghi thì ném cho route ghi log; lỗi
 * phát chỉ ghi log — thông báo đã nằm trong chuông, lần mở sau vẫn thấy.
 */
async function deliverProviderNotifications(rows: ProviderNotificationRow[]): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await getSupabaseAdmin().from("provider_notifications").insert(rows);
  if (error) throw new Error(error.message);

  const recipients = [...new Set(rows.map((row) => row.recipient_email))];
  try {
    if (!(await broadcastNotif(recipients))) {
      console.error("provider.notification.delivery_failed", { stage: "broadcast" });
    }
  } catch (broadcastError) {
    console.error("provider.notification.delivery_failed", {
      stage: "broadcast",
      error: broadcastError instanceof Error ? broadcastError.message : "unknown error",
    });
  }
  try {
    const { pushForProviderNotifications } = await import("@/lib/notifications/push-dispatch");
    await pushForProviderNotifications(rows);
  } catch (pushError) {
    console.error("provider.notification.delivery_failed", {
      stage: "push",
      error: pushError instanceof Error ? pushError.message : "unknown error",
    });
  }
}

/**
 * Người nhận một lượt @mention: người được tag MỚI (lúc sửa comment, ai đã được
 * tag từ bản trước thì không báo lại), xem được Provider List, và không phải
 * chính người viết. Tag một người không xem được bảng thì bỏ: bấm vào thông báo
 * họ cũng chỉ gặp trang báo không có quyền.
 */
export function providerMentionRecipients(input: {
  body: string;
  previousBody?: string | null;
  actorEmail: string;
  viewerEmails: ReadonlySet<string>;
}): string[] {
  const normalize = (email: string) => email.trim().toLowerCase();
  const before = new Set(parseMentions(input.previousBody ?? "").map(normalize));
  const actor = normalize(input.actorEmail);
  return [
    ...new Set(
      parseMentions(input.body)
        .map(normalize)
        .filter((email) => !before.has(email) && email !== actor && input.viewerEmails.has(email))
    ),
  ];
}

/**
 * Ghi rồi phát thông báo @mention. Gọi trong `after()` của route: comment đã
 * lưu xong, nên lỗi ở đây chỉ ném ra cho route ghi log.
 */
export async function notifyProviderMentions(input: {
  providerId: string;
  commentId: string;
  actorEmail: string;
  body: string;
  previousBody?: string | null;
}): Promise<void> {
  if (parseMentions(input.body).length === 0) return;
  const viewers = await fetchProviderViewers();
  const recipients = providerMentionRecipients({
    body: input.body,
    previousBody: input.previousBody,
    actorEmail: input.actorEmail,
    viewerEmails: new Set(viewers.map((viewer) => viewer.email)),
  });
  if (recipients.length === 0) return;

  await deliverProviderNotifications(
    recipients.map((recipient) => ({
      recipient_email: recipient,
      provider_id: input.providerId,
      type: "mentioned",
      actor_email: input.actorEmail,
      comment_id: input.commentId,
    }))
  );
}

/**
 * Người nhận "có dòng mới chờ duyệt": người có Provider List - Manage VÀ còn xem
 * được bảng (quyền Manage không đi kèm quyền xem thì bấm vào cũng không mở được),
 * trừ chính người gửi.
 */
export function providerBacklogReviewers(input: {
  managerEmails: readonly string[];
  viewerEmails: ReadonlySet<string>;
  actorEmail: string;
}): string[] {
  const actor = normalizeEmail(input.actorEmail);
  return [
    ...new Set(
      input.managerEmails
        .map(normalizeEmail)
        .filter((email) => email && email !== actor && input.viewerEmails.has(email))
    ),
  ];
}

/**
 * Báo người duyệt có dòng mới ở Backlog. Một lượt nhập 40 dòng là MỘT thông báo
 * (`detail` = số dòng, trỏ vào dòng đầu), không phải 40 cái chuông.
 */
export async function notifyProviderBacklogSubmitted(input: {
  providerId: string;
  actorEmail: string;
  count: number;
}): Promise<void> {
  if (input.count <= 0) return;
  const [managerEmails, viewers] = await Promise.all([
    fetchEmailsWithPermission(PERMISSIONS.AUTOMATION_PROVIDER_MANAGE),
    fetchProviderViewers(),
  ]);
  const recipients = providerBacklogReviewers({
    managerEmails,
    viewerEmails: new Set(viewers.map((viewer) => viewer.email)),
    actorEmail: input.actorEmail,
  });
  await deliverProviderNotifications(
    recipients.map((recipient) => ({
      recipient_email: recipient,
      provider_id: input.providerId,
      type: "submitted",
      actor_email: normalizeEmail(input.actorEmail),
      comment_id: null,
      detail: input.count > 1 ? String(input.count) : null,
    }))
  );
}

/**
 * Báo người gửi kết quả duyệt. `approved` trỏ vào dòng đang ở trong danh sách
 * (dòng vừa duyệt, hoặc dòng cũ khi "Update existing" — `detail` = "merged");
 * `rejected` mang lý do trong `detail`. Người tự duyệt dòng của mình thì không báo.
 */
export async function notifyProviderBacklogDecision(input: {
  providerId: string;
  actorEmail: string;
  submitterEmail: string | null;
  type: "approved" | "rejected";
  detail?: string | null;
}): Promise<void> {
  const submitter = normalizeEmail(input.submitterEmail ?? "");
  const actor = normalizeEmail(input.actorEmail);
  if (!submitter || submitter === actor) return;
  await deliverProviderNotifications([
    {
      recipient_email: submitter,
      provider_id: input.providerId,
      type: input.type,
      actor_email: actor,
      comment_id: null,
      detail: input.detail ?? null,
    },
  ]);
}
