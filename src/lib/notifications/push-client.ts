/**
 * Phía trình duyệt của Web Push: đăng ký service worker, xin quyền, và gửi
 * "địa chỉ đẩy" lên server.
 *
 * Xem docs/2026-09-10-web-push-notifications.md.
 *
 * ⚠ Chỉ gọi `enablePush()` TỪ MỘT CÚ BẤM của người dùng. Xin quyền lúc tải
 * trang thì Chrome chặn, và người dùng hay bấm Deny theo phản xạ — mà **Deny là
 * không hỏi lại được bằng code**, họ phải tự vào cài đặt trình duyệt gỡ.
 */

export type PushSupport =
  | { supported: true }
  | { supported: false; reason: string };

export type EnablePushResult =
  | { ok: true }
  | { ok: false; reason: "unsupported" | "denied" | "failed"; message: string };

const SERVICE_WORKER_URL = "/sw.js";
const SUBSCRIBE_ENDPOINT = "/api/notifications/push/subscribe";

export function checkPushSupport(): PushSupport {
  if (typeof window === "undefined") {
    return { supported: false, reason: "Không chạy trên trình duyệt." };
  }
  if (!("serviceWorker" in navigator)) {
    return { supported: false, reason: "Trình duyệt này không hỗ trợ service worker." };
  }
  if (!("PushManager" in window)) {
    return { supported: false, reason: "Trình duyệt này không hỗ trợ Web Push." };
  }
  if (!("Notification" in window)) {
    return { supported: false, reason: "Trình duyệt này không hỗ trợ thông báo." };
  }
  // Web Push đòi HTTPS. localhost được miễn nên vẫn test local được.
  if (!window.isSecureContext) {
    return { supported: false, reason: "Cần HTTPS để bật thông báo." };
  }
  return { supported: true };
}

export function currentPushPermission(): NotificationPermission | null {
  if (typeof window === "undefined" || !("Notification" in window)) return null;
  return Notification.permission;
}

/**
 * Khoá công VAPID được server phát dưới dạng base64url, nhưng `subscribe()` chỉ
 * nhận Uint8Array. Không có bước đổi này thì trình duyệt ném
 * `InvalidCharacterError` mà không nói vì sao.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  // Cấp phát ArrayBuffer tường minh: `applicationServerKey` chỉ nhận
  // ArrayBufferView<ArrayBuffer>, còn Uint8Array trần có thể nằm trên
  // SharedArrayBuffer nên TypeScript từ chối.
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

async function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  const registration = await navigator.serviceWorker.register(SERVICE_WORKER_URL, {
    scope: "/",
  });
  // `register()` trả về ngay cả khi worker chưa sẵn sàng; `ready` mới là lúc
  // đăng ký push được.
  await navigator.serviceWorker.ready;
  return registration;
}

export async function enablePush(vapidPublicKey: string): Promise<EnablePushResult> {
  const support = checkPushSupport();
  if (!support.supported) {
    return { ok: false, reason: "unsupported", message: support.reason };
  }
  if (!vapidPublicKey) {
    return {
      ok: false,
      reason: "failed",
      message: "Máy chủ chưa cấu hình khoá VAPID.",
    };
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return {
      ok: false,
      reason: "denied",
      message:
        "Trình duyệt đang chặn thông báo. Mở phần cài đặt quyền của trang này để cho phép, rồi thử lại.",
    };
  }

  try {
    const registration = await registerServiceWorker();

    // Đăng ký cũ có thể gắn với khoá VAPID khác (khoá đã bị đổi) — khi đó server
    // gửi sẽ luôn thất bại. Bỏ đăng ký cũ rồi tạo lại là cách chắc chắn nhất.
    const existing = await registration.pushManager.getSubscription();
    if (existing) await existing.unsubscribe();

    const subscription = await registration.pushManager.subscribe({
      // Bắt buộc phải là true trên Chrome: không cho phép push "im lặng".
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    });

    const response = await fetch(SUBSCRIBE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subscription: subscription.toJSON(),
        userAgent: navigator.userAgent,
      }),
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => null);
      return {
        ok: false,
        reason: "failed",
        message: detail?.error ?? "Không lưu được đăng ký thông báo.",
      };
    }

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: "failed",
      message: error instanceof Error ? error.message : "Bật thông báo thất bại.",
    };
  }
}

/**
 * Tắt trên MÁY NÀY.
 *
 * Gỡ ở cả hai phía: huỷ đăng ký trong trình duyệt, và xoá dòng trong database.
 * Bỏ vế thứ hai thì server vẫn gửi tới một địa chỉ đã chết cho tới khi dịch vụ
 * đẩy trả 410.
 */
export async function disablePush(): Promise<void> {
  const support = checkPushSupport();
  if (!support.supported) return;

  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;

  const endpoint = subscription.endpoint;
  await subscription.unsubscribe().catch(() => {});
  await fetch(SUBSCRIBE_ENDPOINT, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint }),
  }).catch(() => {});
}

/** Máy này đã đăng ký chưa — để nút trong Settings hiện đúng trạng thái. */
export async function isPushEnabledOnThisDevice(): Promise<boolean> {
  const support = checkPushSupport();
  if (!support.supported) return false;
  if (Notification.permission !== "granted") return false;
  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager.getSubscription();
  return Boolean(subscription);
}
