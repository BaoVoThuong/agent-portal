/**
 * Mốc phát hiện thông báo mới cho vòng lặp nền của chuông.
 *
 * Vì sao KHÔNG dùng số chưa đọc làm mốc: `unread` mà API trả về là TỔNG của ba
 * bảng (`task_notifications` + `enrollment_notifications` +
 * `time_off_notifications`), và nó lên xuống hai chiều. Một thông báo mới tới
 * (+1) đúng lúc người dùng đọc một thông báo cũ ở tab khác (−1) thì tổng không
 * đổi — vòng lặp sẽ kết luận "không có gì mới" và bỏ lỡ hẳn cái vừa tới.
 *
 * Mốc thời điểm thì chỉ đi một chiều: đọc hay xoá đều không làm nó lùi lại.
 */

/** Có thông báo nào mới hơn mốc đã thấy không. */
export function hasNewerNotification(
  seenAt: string | null,
  latestAt: string | null,
): boolean {
  // Người dùng chưa có thông báo nào.
  if (!latestAt) return false;
  // Lần quan sát đầu tiên chưa có mốc để so. Nạp lúc này là dựng toast cho
  // những thông báo cũ mà người dùng đã đọc từ lâu.
  if (!seenAt) return false;

  const latest = Date.parse(latestAt);
  const seen = Date.parse(seenAt);
  // Chuỗi thời gian hỏng thì coi như không có gì mới, còn hơn là bắn toast sai.
  if (Number.isNaN(latest) || Number.isNaN(seen)) return false;
  return latest > seen;
}

/** Thời điểm mới nhất trong một danh sách thông báo, hoặc null nếu rỗng. */
export function newestNotificationAt(
  items: readonly { created_at?: string | null }[],
): string | null {
  let bestIso: string | null = null;
  let best = Number.NEGATIVE_INFINITY;
  for (const item of items) {
    if (!item.created_at) continue;
    const at = Date.parse(item.created_at);
    if (Number.isNaN(at) || at <= best) continue;
    best = at;
    bestIso = item.created_at;
  }
  return bestIso;
}
