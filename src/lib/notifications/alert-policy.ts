import {
  notificationEntityId,
  notificationEntityKind,
  type NotificationCopySource,
  type NotificationCopyType,
} from "./copy";

/**
 * Luật "báo động" — tiếng chuông và popup hệ điều hành — dùng chung cho cái
 * chuông trong web và Web Push. Toàn hàm thuần, không I/O, không DOM.
 */

/**
 * Loại gọi ĐÍCH DANH người nhận. Chúng có họ tag riêng và được kêu lại khi thay
 * thế: trước 16/09/2026 mọi thông báo của một task chung tag `task:<id>`, nên bị
 * @ ngay sau một bình luận cùng task là popup cũ bị thay im lặng — không tiếng,
 * không ai biết.
 */
const DIRECT_TYPES: ReadonlySet<NotificationCopyType> = new Set<NotificationCopyType>([
  "mentioned",
  "assigned",
  "unassigned",
  "reopened",
]);

export function isDirectNotification(type: NotificationCopyType): boolean {
  return DIRECT_TYPES.has(type);
}

/**
 * Tag của popup. Cùng tag thì popup mới thay popup cũ thay vì chồng đống.
 * Hai họ: `direct` (gọi đích danh) và `activity` (bình luận, lời nhắc...).
 */
export function notificationAlertTag(notification: NotificationCopySource): string {
  const family = isDirectNotification(notification.type) ? "direct" : "activity";
  return `${notificationEntityKind(notification)}:${notificationEntityId(notification)}:${family}`;
}

/** Thay popup cùng tag có kêu lại không — chỉ loại gọi đích danh. */
export function shouldRenotify(notification: Pick<NotificationCopySource, "type">): boolean {
  return isDirectNotification(notification.type);
}

/**
 * Cái chuông có tự bật popup hệ điều hành không.
 *
 * - Đang focus portal: không — toast trong trang đã báo.
 * - Máy có Web Push: không — service worker bật popup; chuông bật thêm là hai cái.
 * - Còn lại: có. Chỉ 6/30 người nhận có đăng ký push (15/09/2026), nên với phần
 *   lớn mọi người đây là cảnh báo DUY NHẤT ra ngoài trình duyệt — không bỏ được.
 */
export function shouldShowNativePopup(input: {
  permission: NotificationPermission | null;
  documentHasFocus: boolean;
  pushSubscribedOnThisDevice: boolean;
}): boolean {
  if (input.permission !== "granted") return false;
  if (input.documentHasFocus) return false;
  return !input.pushSubscribedOnThisDevice;
}

/**
 * Tab ẩn chờ một nhịp trước khi giành quyền báo, để tab đang hiện thắng: tab
 * chưa từng được bấm thì AudioContext còn bị treo và tiếng chuông không phát.
 */
export const HIDDEN_TAB_CLAIM_DELAY_MS = 400;

export function alertClaimDelayMs(visibility: string): number {
  return visibility === "visible" ? 0 : HIDDEN_TAB_CLAIM_DELAY_MS;
}
