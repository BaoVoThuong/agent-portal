import type { LeadStatus } from "./types";

/**
 * Bảng tra status theo id, GỒM CẢ status đã archive.
 *
 * Phân biệt phải giữ cho bằng được: *danh sách chọn* chỉ được có status đang
 * dùng; *bảng tra để hiển thị* phải có cả status đã archive, vì lead cũ vẫn trỏ
 * vào đó. Thiếu chúng thì `resolveLeadAlerts` nhận `null`, coi lead là còn mở,
 * và mọi lead đã chốt theo status vừa bị archive sẽ sáng cờ đỏ trở lại — trong
 * khi drawer lại hiện "No status" cho đúng lead đó.
 *
 * Bản đang dùng ghi sau nên nó thắng nếu trùng id.
 */
export function buildStatusById(
  active: readonly LeadStatus[],
  archived: readonly LeadStatus[]
): Map<string, LeadStatus> {
  const map = new Map<string, LeadStatus>();
  for (const status of archived) map.set(status.id, status);
  for (const status of active) map.set(status.id, status);
  return map;
}
