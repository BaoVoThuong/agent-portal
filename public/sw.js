/*
 * Service worker cho Web Push — xem docs/2026-09-10-web-push-notifications.md
 *
 * File này chạy NGOÀI React, sống cả khi mọi tab đã đóng. Nó là thứ duy nhất có
 * quyền hiện thông báo của hệ điều hành khi không còn tab nào mở.
 *
 * ⚠ Trình duyệt giữ service worker rất dai: bản cũ vẫn phục vụ cho tới khi mọi
 * tab đóng hết. Tăng SW_VERSION mỗi lần sửa file này — vừa để thấy bản nào đang
 * chạy trong DevTools, vừa buộc trình duyệt coi đây là file khác.
 */
const SW_VERSION = "2026-09-16.1";

// Nhận quyền điều khiển ngay, không chờ mọi tab đóng.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

/**
 * Người dùng có đang THAO TÁC trên portal không.
 *
 * Đang thao tác thì chuông + toast trong web đã báo rồi; bắn thêm thông báo hệ
 * điều hành là kêu hai lần cho cùng một việc.
 *
 * Trước 16/09/2026 hàm này hỏi `visible`: cửa sổ portal mở ở màn hình phụ, hoặc
 * nằm cạnh cửa sổ khác, vẫn tính là "đang nhìn" nên push bị nuốt — mà cái chuông
 * của máy có push cũng không bật popup. Chỉ `focused` mới chắc người dùng thấy
 * toast trong trang.
 */
async function hasFocusedWindow() {
  const windows = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  return windows.some((client) => client.focused);
}

self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      let payload = {};
      try {
        payload = event.data ? event.data.json() : {};
      } catch {
        // Payload hỏng thì vẫn báo, còn hơn im lặng nuốt mất thông báo.
        payload = {};
      }

      if (await hasFocusedWindow()) return;

      const title = payload.title || "Agent Portal";
      await self.registration.showNotification(title, {
        body: payload.body || "",
        // Cùng `tag` thì thông báo mới thay thế cái cũ thay vì chồng đống —
        // ví dụ 5 bình luận trong một task chỉ để lại một dòng.
        tag: payload.tag || "agent-portal",
        // Thay popup cùng tag mà vẫn kêu — server chỉ bật cho loại gọi đích danh.
        renotify: Boolean(payload.renotify),
        data: { url: payload.url || "/" },
        // Cố ý KHÔNG khai `icon`/`badge`: trỏ vào file không tồn tại thì Chrome
        // im lặng bỏ qua, còn thêm một cặp PNG chỉ để trang trí là thêm thứ phải
        // giữ. Thông báo sẽ dùng icon mặc định của trình duyệt.
        // Không tự biến mất: agent có thể đang ở tab khác, thông báo phải chờ họ.
        requireInteraction: false,
      });
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      // Ưu tiên dùng lại tab đang mở: mở thêm tab thứ tư của cùng một portal là
      // thứ người dùng phải tự dọn.
      for (const client of windows) {
        if (client.url.includes(self.location.origin)) {
          await client.focus();
          if ("navigate" in client) {
            try {
              await client.navigate(targetUrl);
            } catch {
              // Vài trình duyệt chặn navigate xuyên tài liệu — đã focus là đủ.
            }
          }
          return;
        }
      }

      await self.clients.openWindow(targetUrl);
    })()
  );
});
