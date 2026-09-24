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
 * Bao nhiêu pixel ảnh luôn phải còn nằm trong khung.
 *
 * Đây là thứ DUY NHẤT còn chặn việc kéo. Không có nó thì kéo mạnh một cái là
 * ảnh ra khỏi khung hoàn toàn, màn hình trống trơn và người dùng không biết
 * đường lấy lại.
 */
const KEEP_VISIBLE_PX = 80;

/**
 * Giới hạn độ kéo.
 *
 * Bản đầu chỉ cho kéo đúng bằng nửa phần tràn — tức mép ảnh không bao giờ đi
 * quá mép khung. Về lý thì "không lòi nền xám", nhưng dùng thật thì **chật**:
 * ở 150% mỗi bên chỉ nhúc nhích được hơn trăm pixel, và không thể đưa một góc
 * ảnh vào giữa khung để nhìn cho rõ.
 *
 * Nay cho kéo gần như tự do: đặt được góc nào của ảnh vào bất kỳ chỗ nào trong
 * khung, miễn là còn chừa lại `KEEP_VISIBLE_PX` để ảnh không biến mất hẳn.
 *
 * Ảnh còn lọt trọn trong khung ở CẢ HAI chiều thì vẫn ghim giữa — lúc đó không
 * có gì bị che, kéo đi chỉ làm nó lệch vô cớ.
 */
export function clampPanOffset(offset: PanOffset, bounds: Size, viewport: Size): PanOffset {
  // Khung chưa được bố trí (mới mở modal, ảnh chưa tải xong) thì mọi giới hạn
  // tính ra đều vô nghĩa — theo công thức thì viewport bằng 0 cho phép kéo đi
  // đâu cũng được, tức ảnh bay khỏi màn hình ngay nhịp vẽ đầu tiên.
  if (viewport.width <= 0 || viewport.height <= 0) return { x: 0, y: 0 };

  const fitsEntirely =
    bounds.width <= viewport.width && bounds.height <= viewport.height;
  if (fitsEntirely) return { x: 0, y: 0 };

  // Kéo tối đa cho tới khi chỉ còn KEEP_VISIBLE_PX chồng lên khung.
  const limitX = Math.max(0, bounds.width / 2 + viewport.width / 2 - KEEP_VISIBLE_PX);
  const limitY = Math.max(0, bounds.height / 2 + viewport.height / 2 - KEEP_VISIBLE_PX);
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
