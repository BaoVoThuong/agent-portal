import type { LeadInteraction } from "./types";

/**
 * Lịch sử tương tác nào được hiển thị cho lead đang mở.
 *
 * Tách khỏi component vì đây là chỗ đã sinh ra bug "badge ghi 3 nhưng danh sách
 * nói No interactions yet": drawer giữ một danh sách, InteractionLog giữ bản
 * sao thứ hai, và bản sao chỉ được lấy lúc mount — dữ liệu về sau khi mount thì
 * badge thấy còn danh sách không. Ở repo này vitest chỉ chạy `.test.ts` nên
 * phần quyết định phải nằm ngoài `.tsx` mới có lưới an toàn.
 */
export function resolveVisibleInteractions(input: {
  currentLeadId: string;
  /** Lead mà `fetched` thuộc về; null khi chưa có phản hồi nào. */
  loadedLeadId: string | null;
  fetched: readonly LeadInteraction[];
  /** Bản đã tải lần trước của ĐÚNG lead này, nếu có. */
  cached: readonly LeadInteraction[] | undefined;
}): readonly LeadInteraction[] {
  // So khớp id là thứ ngăn lịch sử của lead A hiện dưới tên lead B trong lúc
  // lead B đang tải.
  if (input.loadedLeadId === input.currentLeadId) return input.fetched;
  return input.cached ?? [];
}

/**
 * Thêm một tương tác vừa ghi vào danh sách đang hiển thị.
 *
 * Chống trùng theo `id` chứ không theo vị trí: đường ghi lạc quan và phản hồi
 * realtime có thể mang về cùng một dòng, và đếm hai lần thì badge nói sai.
 */
export function appendInteraction(
  current: readonly LeadInteraction[],
  interaction: LeadInteraction
): readonly LeadInteraction[] {
  if (current.some((item) => item.id === interaction.id)) return current;
  // Mới nhất lên đầu, khớp thứ tự `occurred_at desc` mà API trả về.
  return [interaction, ...current];
}
