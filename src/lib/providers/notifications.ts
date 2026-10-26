import { getSupabaseAdmin } from "@/lib/supabase";
import { broadcastNotif } from "@/lib/tasks/realtime";
import { parseMentions } from "@/lib/tasks/mentions";
import { fetchProviderViewers } from "./collaboration";

/**
 * Thông báo của Provider List — hiện chỉ @mention trong comment (user chốt
 * 25/10). Bảng riêng `provider_notifications`, chuông đọc nó như nguồn thứ tư.
 */

export type ProviderNotificationRow = {
  recipient_email: string;
  provider_id: string;
  type: "mentioned";
  actor_email: string;
  comment_id: string;
};

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

  const rows: ProviderNotificationRow[] = recipients.map((recipient) => ({
    recipient_email: recipient,
    provider_id: input.providerId,
    type: "mentioned",
    actor_email: input.actorEmail,
    comment_id: input.commentId,
  }));
  const { error } = await getSupabaseAdmin().from("provider_notifications").insert(rows);
  if (error) throw new Error(error.message);

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
