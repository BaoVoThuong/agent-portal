"use client";

import { useEffect, useState } from "react";
import { BellRing, Loader2 } from "lucide-react";
import {
  checkPushSupport,
  currentPushPermission,
  disablePush,
  enablePush,
  isPushEnabledOnThisDevice,
} from "@/lib/notifications/push-client";

/**
 * Bật thông báo ngoài trình duyệt cho MÁY NÀY.
 *
 * Xem docs/2026-09-10-web-push-notifications.md.
 *
 * Cố ý đặt ở Settings chứ không phải trong chuông: quyền thông báo chỉ xin được
 * từ một cú bấm có chủ đích. Bật lúc tải trang thì Chrome chặn, và người dùng
 * hay bấm "Block" theo phản xạ — mà Block thì không hỏi lại được bằng code.
 *
 * "Máy này" là đúng nghĩa đen: đăng ký gắn với trình duyệt trên máy đang dùng,
 * nên agent dùng cả máy bàn lẫn laptop phải bật ở cả hai.
 */
export default function PushNotificationCard({
  vapidPublicKey,
}: {
  vapidPublicKey: string;
}) {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unsupportedReason, setUnsupportedReason] = useState<string | null>(null);

  useEffect(() => {
    // Đọc trạng thái SAU khi mount, không phải trong useState: `checkPushSupport`
    // đụng `window`, mà server không có — đọc sớm là lệch HTML giữa hai bên.
    //
    // Mọi setState đều nằm sau `await` để không rơi vào nhánh đồng bộ của effect
    // (react-hooks/set-state-in-effect), và `cancelled` chặn việc cập nhật sau
    // khi người dùng đã rời trang.
    let cancelled = false;
    void (async () => {
      const support = checkPushSupport();
      const enabledNow = support.supported ? await isPushEnabledOnThisDevice() : false;
      if (cancelled) return;
      setUnsupportedReason(support.supported ? null : support.reason);
      setEnabled(enabledNow);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggle() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (enabled) {
        await disablePush();
        setEnabled(false);
        setMessage("Đã tắt thông báo trên máy này.");
        return;
      }
      const result = await enablePush(vapidPublicKey);
      if (result.ok) {
        setEnabled(true);
        setMessage("Đã bật. Thử đóng tab portal rồi nhờ ai đó bình luận vào task của bạn.");
        return;
      }
      setError(result.message);
    } finally {
      setBusy(false);
    }
  }

  const permission = currentPushPermission();

  return (
    <section className="mt-6 rounded-lg border border-[#d8dee7] bg-white">
      <div className="border-b border-[#e6eaf0] px-6 py-5">
        <h2 className="flex items-center gap-2 text-base font-semibold text-[#172b4d]">
          <BellRing className="h-4 w-4 text-[#0c66e4]" />
          Thông báo ngoài trình duyệt
        </h2>
        <p className="mt-1 text-sm text-[#6b778c]">
          Nhận thông báo ngay trên màn hình kể cả khi đã đóng tab portal. Bật riêng
          cho từng máy bạn dùng.
        </p>
      </div>

      <div className="px-6 py-5">
        {!ready ? (
          <p className="text-sm text-[#6b778c]">Đang kiểm tra…</p>
        ) : unsupportedReason ? (
          <p className="text-sm text-[#6b778c]">{unsupportedReason}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={toggle}
                disabled={busy}
                className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold transition disabled:opacity-60 ${
                  enabled
                    ? "border border-[#cfd8e5] bg-white text-[#172b4d] hover:bg-[#f4f5f7]"
                    : "bg-[#0c66e4] text-white hover:bg-[#0055cc]"
                }`}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {enabled ? "Tắt trên máy này" : "Bật trên máy này"}
              </button>
              <span className="text-sm text-[#6b778c]">
                {enabled ? "Đang bật cho máy này." : "Đang tắt."}
              </span>
            </div>

            {/* Đã bị chặn thì nút bên trên không làm gì được — trình duyệt không
                cho hỏi lại. Chỉ còn cách chỉ người dùng tự mở khoá. */}
            {permission === "denied" ? (
              <p className="mt-3 rounded-md bg-[#fff7f5] px-3 py-2 text-sm text-[#a3473c]">
                Trình duyệt đang chặn thông báo cho trang này. Bấm vào biểu tượng ổ khoá
                cạnh thanh địa chỉ → Notifications → Allow, rồi tải lại trang.
              </p>
            ) : null}

            {message ? (
              <p className="mt-3 text-sm font-semibold text-[#216e4e]">{message}</p>
            ) : null}
            {error ? (
              <p className="mt-3 text-sm font-semibold text-[#a3473c]">{error}</p>
            ) : null}

            {/* Cạm bẫy hay gặp nhất trên máy Mac: web đã cấp quyền nhưng hệ điều
                hành vẫn chặn, và không có tín hiệu nào báo cho người dùng biết. */}
            <p className="mt-4 text-xs text-[#6b778c]">
              Dùng macOS: nếu đã bật mà vẫn không thấy gì, kiểm tra
              <span className="font-semibold"> System Settings → Notifications → Chrome</span> và
              tắt chế độ Focus.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
