/**
 * Ba phép tính quyết định quyền lợi nghỉ phép của nhân viên.
 *
 * Tách thành hàm thuần vì đây là chỗ sai thì ra tiền thật: trừ nhầm ngày phép,
 * cho nghỉ quá hạn mức, hoặc chặn oan người còn ngày. Route handler không chạy
 * test được (cần session + Supabase), còn `.tsx` thì bộ test của dự án không
 * nạp — nên luật phải sống ở `src/lib` mới có lưới an toàn.
 */

/** Vì sao một đơn bị từ chối. `null` nghĩa là đơn hợp lệ. */
export type LeaveRequestRejection = "empty" | "too_long" | "over_balance";

/**
 * Số ngày còn dùng được của một loại nghỉ trong một năm.
 *
 * Trả `null` cho loại nghỉ KHÔNG tính vào quỹ (unpaid) — "còn lại" không có
 * nghĩa với thứ vô hạn, và `null` buộc nơi gọi phải xử lý riêng thay vì vô
 * tình so sánh với 0.
 *
 * `entitlementDays` là hạn mức RIÊNG đã đặt cho người này; không có thì rơi về
 * hạn mức chung của policy. `adjustmentDays` là tổng cộng/trừ tay và tích luỹ.
 */
export function availableLeaveDays(input: {
  entitlementDays: number | null;
  adjustmentDays: number;
  usedDays: number;
  defaultAllowance: number | null;
}): number | null {
  if (input.defaultAllowance === null && input.entitlementDays === null) return null;
  const entitlement = input.entitlementDays ?? input.defaultAllowance ?? 0;
  return entitlement + input.adjustmentDays - input.usedDays;
}

/**
 * Đơn này có được gửi không, và nếu không thì vì sao.
 *
 * `availableDays === null` (loại nghỉ không tính quỹ) thì không bao giờ chặn vì
 * số dư — nhưng VẪN chặn theo độ dài. Trước đây `unpaid` không bị kiểm gì cả,
 * nên một đơn nghỉ không lương kéo dài nhiều năm vẫn qua cửa.
 *
 * Không có khái niệm "âm ngày phép": vượt quỹ là chặn, không phải cho nợ.
 */
export function leaveRequestRejection(input: {
  requestedDays: number;
  availableDays: number | null;
  maxDays: number;
}): LeaveRequestRejection | null {
  if (input.requestedDays <= 0) return "empty";
  if (input.requestedDays > input.maxDays) return "too_long";
  if (input.availableDays !== null && input.requestedDays > input.availableDays) {
    return "over_balance";
  }
  return null;
}

/**
 * Hai khoảng nghỉ có chồng lên nhau không.
 *
 * Chạm nhau ĐÚNG một ngày cũng là chồng: nghỉ 1–5 và 5–9 cùng chiếm ngày 5, và
 * một người không thể nghỉ hai lần trong cùng một ngày. Vì ngày ở đây là chuỗi
 * `YYYY-MM-DD`, so sánh chuỗi cho đúng thứ tự thời gian mà không cần dựng Date
 * — nên không dính múi giờ của máy đang chạy.
 */
export function leaveRangesOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string
): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}
