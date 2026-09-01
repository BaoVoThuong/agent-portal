"use client";

import { useEffect } from "react";

/**
 * Số modal đang mở, đếm ở phạm vi module.
 *
 * Bắt buộc phải đếm chứ không chỉ set/restore: modal lồng nhau là chuyện bình
 * thường ở đây (hộp xác nhận trong Config, xem trước tệp đính kèm trong
 * TaskDetailDrawer). Hai bản tự viết trước đây lưu overflow cũ rồi khôi phục
 * khi đóng, nên đóng cái bên trong là mở khoá luôn nền trong khi cái bên ngoài
 * vẫn đang mở.
 */
let lockCount = 0;
let previousOverflow = "";
let previousPaddingRight = "";

function lock() {
  if (lockCount === 0) {
    const { body } = document;
    previousOverflow = body.style.overflow;
    previousPaddingRight = body.style.paddingRight;

    // Bù đúng bề rộng thanh cuộn vừa biến mất. Không bù thì cả trang nhích
    // ngang một nhịp ngay lúc modal mở, và nhích lại khi đóng.
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    if (scrollbar > 0) {
      const current = Number.parseFloat(window.getComputedStyle(body).paddingRight) || 0;
      body.style.paddingRight = `${current + scrollbar}px`;
    }
    body.style.overflow = "hidden";
  }
  lockCount += 1;
}

function unlock() {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) {
    document.body.style.overflow = previousOverflow;
    document.body.style.paddingRight = previousPaddingRight;
  }
}

/**
 * Khoá cuộn trang nền trong lúc modal mở.
 *
 * Không có nó thì cuộn hết nội dung modal là trang phía sau ăn tiếp phần cuộn
 * còn lại — người ta đóng modal ra và thấy mình đang ở một chỗ khác trên trang.
 *
 * Gọi VÔ ĐIỀU KIỆN, trước mọi `return null`, và truyền cờ mở vào:
 *
 *   useBodyScrollLock(open);
 *   if (!open) return null;
 */
export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    lock();
    return unlock;
  }, [active]);
}
