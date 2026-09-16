/**
 * Giành quyền báo động cho MỘT thông báo trên cả trình duyệt.
 *
 * Mỗi tab portal có một cái chuông riêng, và ping realtime tới mọi tab. Trước
 * 16/09/2026 tab nào cũng tự kêu và tự bật popup: mở 3 tab là 3 tiếng chuông, 3
 * popup cho cùng một thông báo. Web Locks là khoá dùng chung giữa các tab cùng
 * origin: tab đầu tiên giữ được khoá mang tên id thông báo thì báo, các tab sau
 * nhận `null` và im.
 *
 * Giữ khoá 60 giây: tab ẩn bị trình duyệt làm chậm có thể tải danh sách trễ vài
 * giây; nhả sớm quá thì nó giành lại được và báo lần hai. Khoá tự nhả khi tab
 * đóng, nên không có chuyện kẹt vĩnh viễn.
 */

/** Phần của `LockManager` mà hàm này dùng — tách kiểu để test tiêm bản giả. */
export type AlertLockManager = {
  request(
    name: string,
    options: { ifAvailable: true },
    callback: (lock: unknown) => Promise<void> | void
  ): Promise<unknown>;
};

export const ALERT_LOCK_HOLD_MS = 60_000;

function browserLockManager(): AlertLockManager | null {
  if (typeof navigator === "undefined" || !("locks" in navigator)) return null;
  return navigator.locks as unknown as AlertLockManager;
}

export function claimNotificationAlert(
  notificationId: string,
  locks: AlertLockManager | null = browserLockManager(),
  holdMs: number = ALERT_LOCK_HOLD_MS
): Promise<boolean> {
  // Trình duyệt không có Web Locks: báo luôn — thừa một tiếng còn hơn mất.
  if (!locks) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    locks
      .request(`agent-portal:notif-alert:${notificationId}`, { ifAvailable: true }, (lock) => {
        if (!lock) {
          resolve(false);
          return;
        }
        resolve(true);
        return new Promise<void>((release) => {
          setTimeout(release, holdMs);
        });
      })
      .catch(() => resolve(true));
  });
}
