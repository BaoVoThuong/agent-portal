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
        setMessage("Notifications turned off on this device.");
        return;
      }
      const result = await enablePush(vapidPublicKey);
      if (result.ok) {
        setEnabled(true);
        setMessage("Turned on. Try closing every portal tab, then have someone comment on one of your tasks.");
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
          Desktop notifications
        </h2>
        <p className="mt-1 text-sm text-[#6b778c]">
          Get notified on your screen even when every portal tab is closed. Turn
          this on separately for each device you use.
        </p>
      </div>

      <div className="px-6 py-5">
        {!ready ? (
          <p className="text-sm text-[#6b778c]">Checking…</p>
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
                {enabled ? "Turn off on this device" : "Turn on for this device"}
              </button>
              <span className="text-sm text-[#6b778c]">
                {enabled ? "On for this device." : "Off."}
              </span>
            </div>

            {/* Đã bị chặn thì nút bên trên không làm gì được — trình duyệt không
                cho hỏi lại. Chỉ còn cách chỉ người dùng tự mở khoá. */}
            {permission === "denied" ? (
              <p className="mt-3 rounded-md bg-[#fff7f5] px-3 py-2 text-sm text-[#a3473c]">
                Your browser is blocking notifications for this site. Click the lock
                icon next to the address bar → Notifications → Allow, then reload.
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
              On macOS: if this is on but nothing shows up, check
              <span className="font-semibold"> System Settings → Notifications → Chrome</span> and
              turn off Focus.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
