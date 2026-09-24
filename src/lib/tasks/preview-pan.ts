/**
 * Toán cho việc phóng to và kéo ảnh trong ô xem trước tệp đính kèm.
 *
 * Để ở `lib` để chạy được dưới test: đây là phần quyết định ảnh trôi tới đâu,
 * và sai ở đây thì người dùng kéo ảnh ra khỏi khung rồi không biết đường lấy
 * lại — một lỗi rất khó nhìn ra bằng mắt khi đọc JSX.
 */

export type PanOffset = { x: number; y: number };
export type Size = { width: number; height: number };

/**
 * Hộp bao của ảnh sau khi xoay và phóng.
 *
 * Phải tự tính chứ không hỏi được trình duyệt: `transform` KHÔNG đổi ô chiếm
 * chỗ của phần tử, nên `offsetWidth` vẫn là số lúc chưa phóng, còn
 * `getBoundingClientRect()` thì đã cộng cả phần kéo vào nên không dùng để tính
 * ngược ra giới hạn kéo được.
 *
 * Chỉ có bốn nấc xoay 90°, nên chỉ cần biết có đổi chỗ hai cạnh hay không.
 */
export function rotatedScaledBounds(base: Size, rotation: number, scale: number): Size {
  const quarter = (((rotation / 90) % 4) + 4) % 4;
  const swapped = quarter === 1 || quarter === 3;
  return {
    width: (swapped ? base.height : base.width) * scale,
    height: (swapped ? base.width : base.height) * scale,
  };
}

/**
 * Giới hạn độ kéo để ảnh không bị lôi ra ngoài khung.
 *
 * Kéo được đúng bằng nửa phần tràn ở mỗi phía — quá mức đó là bắt đầu lòi nền
 * trống ra. Chiều nào ảnh vẫn lọt trong khung thì ghim về giữa, vì chiều đó
 * không có gì để xem thêm.
 */
export function clampPanOffset(offset: PanOffset, bounds: Size, viewport: Size): PanOffset {
  // Khung chưa được bố trí (mới mở modal, ảnh chưa tải xong) thì mọi giới hạn
  // tính ra đều vô nghĩa — theo công thức thì viewport bằng 0 cho phép kéo đi
  // đâu cũng được, tức ảnh bay khỏi màn hình ngay nhịp vẽ đầu tiên.
  if (viewport.width <= 0 || viewport.height <= 0) return { x: 0, y: 0 };

  const limitX = Math.max(0, (bounds.width - viewport.width) / 2);
  const limitY = Math.max(0, (bounds.height - viewport.height) / 2);
  return {
    // Cộng 0 để -0 thành 0: `Math.max(-0, …)` trả -0, và một offset âm-không
    // lọt vào so sánh bằng ở nơi khác là bug rất khó nhìn ra.
    x: Math.min(limitX, Math.max(-limitX, offset.x)) + 0,
    y: Math.min(limitY, Math.max(-limitY, offset.y)) + 0,
  };
}

/**
 * Độ kéo mới sao cho điểm ảnh đang nằm dưới con trỏ vẫn đứng yên sau khi phóng.
 *
 * Đây là khác biệt giữa "phóng to được" và "phóng to dùng được": phóng quanh
 * tâm khung thì chỗ đang xem trôi đi mất, và người dùng phải kéo lại từ đầu sau
 * mỗi nấc zoom.
 *
 * `pointer` tính theo TÂM khung, không phải góc trên trái.
 */
export function zoomAtPoint(
  offset: PanOffset,
  pointer: PanOffset,
  oldScale: number,
  newScale: number
): PanOffset {
  const ratio = newScale / oldScale;
  return {
    x: pointer.x - (pointer.x - offset.x) * ratio,
    y: pointer.y - (pointer.y - offset.y) * ratio,
  };
}
