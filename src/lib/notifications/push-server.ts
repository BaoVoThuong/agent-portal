import "server-only";
import webpush from "web-push";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  notificationHref,
  notificationSentence,
  type NotificationCopySource,
} from "./copy";
import { notificationAlertTag, shouldRenotify } from "./alert-policy";

/**
 * Phía server của Web Push — xem docs/2026-09-10-web-push-notifications.md.
 *
 * Server KHÔNG gửi thẳng tới máy người dùng. Nó gửi tới dịch vụ đẩy của
 * Google/Microsoft (địa chỉ nằm trong `endpoint`), và họ chuyển tiếp. Nhờ vậy
 * máy người nhận đang tắt cũng không sao: thông báo được xếp hàng và giao khi
 * máy bật lại.
 */

export type PushPayload = {
  title: string;
  body: string;
  url: string;
  /** Thông báo cùng `tag` sẽ thay thế nhau thay vì chồng đống. */
  tag: string;
  /** Thay thế popup cùng tag có kêu lại không — chỉ loại gọi đích danh. */
  renotify: boolean;
};

type SubscriptionRow = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

let vapidConfigured: boolean | null = null;

/**
 * Nạp khoá VAPID một lần.
 *
 * Thiếu khoá KHÔNG phải lỗi: môi trường dev chưa cấu hình thì push im lặng bỏ
 * qua, còn chuông trong web vẫn chạy như cũ. Ném lỗi ở đây sẽ làm hỏng cả thao
 * tác bình luận chỉ vì một biến môi trường.
 */
function ensureVapid(): boolean {
  if (vapidConfigured !== null) return vapidConfigured;

  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? "mailto:bao.vo@excelplannings.com";

  if (!publicKey || !privateKey) {
    vapidConfigured = false;
    return false;
  }
  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    vapidConfigured = true;
  } catch {
    vapidConfigured = false;
  }
  return vapidConfigured;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Lọc ra những người CÒN muốn nhận push.
 *
 * Mặc định là bật: ai chưa có dòng nào trong `notification_preferences` vẫn
 * nhận. Nhờ vậy không cần backfill cho các tài khoản đang có, và một bảng chưa
 * kịp tạo cũng không làm tắt push của tất cả mọi người.
 */
async function filterByPreference(emails: string[]): Promise<string[]> {
  if (emails.length === 0) return [];
  const { data, error } = await getSupabaseAdmin()
    .from("notification_preferences")
    .select("email,push_enabled")
    .in("email", emails);

  // Đọc hỏng thì giữ nguyên danh sách: thà gửi thừa còn hơn im lặng nuốt mất
  // thông báo của mọi người vì một lỗi truy vấn.
  if (error) return emails;

  const disabled = new Set(
    (data ?? [])
      .filter((row) => (row as { push_enabled: boolean }).push_enabled === false)
      .map((row) => normalizeEmail((row as { email: string }).email))
  );
  return emails.filter((email) => !disabled.has(email));
}

/**
 * Đăng ký đã chết vĩnh viễn hay chỉ hỏng tạm thời.
 *
 * 404/410 = trình duyệt đã huỷ đăng ký (người dùng xoá dữ liệu trang, gỡ trình
 * duyệt, đổi máy). Không xoá thì mỗi lần gửi đều tốn một request lỗi, và bảng
 * cứ phình ra theo thời gian.
 */
function isGoneStatus(status: number | undefined): boolean {
  return status === 404 || status === 410;
}

async function deleteSubscriptions(endpoints: string[]): Promise<void> {
  if (endpoints.length === 0) return;
  await getSupabaseAdmin()
    .from("push_subscriptions")
    .delete()
    .in("endpoint", endpoints);
}

/**
 * Gửi một thông báo tới mọi máy của những người này.
 *
 * KHÔNG BAO GIỜ ném lỗi: người gọi đang nằm trong luồng ghi thông báo, và một
 * dịch vụ đẩy trục trặc không được phép làm hỏng việc bình luận hay giao việc.
 */
export async function sendPushToEmails(
  emails: readonly string[],
  payload: PushPayload
): Promise<{ sent: number; removed: number }> {
  const result = { sent: 0, removed: 0 };
  try {
    if (!ensureVapid()) return result;

    const unique = [...new Set(emails.map(normalizeEmail).filter(Boolean))];
    const allowed = await filterByPreference(unique);
    if (allowed.length === 0) return result;

    const { data, error } = await getSupabaseAdmin()
      .from("push_subscriptions")
      .select("endpoint,p256dh,auth")
      .in("recipient_email", allowed);
    if (error || !data || data.length === 0) return result;

    const body = JSON.stringify(payload);
    const rows = data as SubscriptionRow[];

    // allSettled: một máy chết không được chặn những máy còn lại.
    const outcomes = await Promise.allSettled(
      rows.map((row) =>
        webpush.sendNotification(
          {
            endpoint: row.endpoint,
            keys: { p256dh: row.p256dh, auth: row.auth },
          },
          body,
          { TTL: 60 * 60 * 24 }
        )
      )
    );

    const dead: string[] = [];
    outcomes.forEach((outcome, index) => {
      if (outcome.status === "fulfilled") {
        result.sent += 1;
        return;
      }
      const status = (outcome.reason as { statusCode?: number } | undefined)?.statusCode;
      if (isGoneStatus(status)) dead.push(rows[index].endpoint);
    });

    if (dead.length > 0) {
      await deleteSubscriptions(dead);
      result.removed = dead.length;
    }
    return result;
  } catch {
    return result;
  }
}

/**
 * Dựng nội dung push từ chính dữ liệu thông báo vừa ghi.
 *
 * Dùng cùng `notificationSentence` mà chuông trong web dùng, nên chữ hai nơi
 * không thể trôi lệch nhau.
 */
export function buildPushPayload(
  notification: NotificationCopySource,
  options: { actorLabel: string; entityTitle?: string | null }
): PushPayload {
  const sentence = notificationSentence(notification, options.actorLabel);
  const title = options.entityTitle?.trim() || "Agent Portal";
  return {
    title,
    body: sentence,
    url: notificationHref(notification),
    // Hai họ tag theo bản ghi (xem alert-policy): 5 bình luận trong một task chỉ
    // để lại một dòng, nhưng một lần bị @ vẫn kêu thay vì bị thay im lặng.
    tag: notificationAlertTag(notification),
    renotify: shouldRenotify(notification),
  };
}
