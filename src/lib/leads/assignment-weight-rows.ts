/**
 * Thao tác thuần trên danh sách tỉ lệ chia lead mà hộp thoại Distribute đang
 * giữ — tách ra để test được, và để bật/tắt một agent chỉ đụng ĐÚNG MỘT dòng.
 *
 * Tab tỉ lệ tự tính share, hàng chờ lead và cờ `dirty` ngay trên máy từ những
 * dòng này, nên sửa đúng dòng là màn hình đổi ngay — không phải GET lại cả danh
 * sách rồi mới thấy.
 */

export type AssignmentWeightRowView = {
  agent_email: string;
  weight: number;
  position: number;
  is_active: boolean;
  /** Computed by the API from the live totals — never stored. */
  share: number;
  /** Vị trí hiện tại trong vòng xoay; dãy xem trước phải bắt đầu từ đây. */
  current_weight: number;
};

/**
 * Bật/tắt một agent, đúng như server sẽ làm.
 *
 * Tick vào là THÊM agent vào vòng chia, nên hệ số luôn bắt đầu từ 1 — kể cả
 * agent từng có dòng cũ với hệ số khác (0, 5...), vì với người đang bấm thì đó
 * cũng là thêm vào. Con trỏ vòng xoay về 0 theo. Chưa có dòng thì thêm vào cuối,
 * vị trí = số dòng + 1. Tắt thì chỉ lật `is_active`, không xoá dòng.
 * Khớp PATCH /api/leads/assignment-weights.
 */
export function applyAgentToggle<T extends AssignmentWeightRowView>(
  rows: T[],
  agentEmail: string,
  next: boolean
): (T | AssignmentWeightRowView)[] {
  const index = rows.findIndex((row) => row.agent_email === agentEmail);
  if (index !== -1) {
    if (rows[index].is_active === next) return rows;
    const copy: (T | AssignmentWeightRowView)[] = rows.slice();
    copy[index] = next
      ? { ...rows[index], is_active: true, weight: 1, current_weight: 0 }
      : { ...rows[index], is_active: false };
    return copy;
  }
  if (!next) return rows;
  return [
    ...rows,
    {
      agent_email: agentEmail,
      weight: 1,
      position: rows.length + 1,
      is_active: true,
      share: 0,
      current_weight: 0,
    },
  ];
}

/**
 * Đặt dòng của một agent về đúng `row`: thay tại chỗ, thêm vào cuối, hoặc xoá
 * khi `row` là undefined. Dùng cho cả đối chiếu với server lẫn trả lại khi lưu
 * hỏng. Mọi dòng khác giữ nguyên — kể cả tỉ lệ đang sửa dở.
 */
export function setAgentRow<T extends AssignmentWeightRowView>(
  rows: T[],
  agentEmail: string,
  row: T | undefined
): T[] {
  const index = rows.findIndex((candidate) => candidate.agent_email === agentEmail);
  if (!row) return index === -1 ? rows : rows.filter((_, i) => i !== index);
  if (index === -1) return [...rows, row];
  const copy = rows.slice();
  copy[index] = row;
  return copy;
}

/**
 * Dòng nháp sau khi server xác nhận cú tick.
 *
 * Lấy trạng thái bật/tắt và con trỏ từ server, nhưng GIỮ trọng số và vị trí đang
 * có trong nháp: người ta có thể đã gõ trọng số mới ở tab tỉ lệ mà chưa lưu, rồi
 * sang Agent config tick — cú tick không được xoá mất phần đang sửa đó.
 */
export function draftRowAfterSave(
  serverRow: AssignmentWeightRowView,
  previousDraftRow: AssignmentWeightRowView | undefined
): AssignmentWeightRowView {
  // Chỉ có gì để giữ khi agent ĐANG nhận lead ở cả trước lẫn sau: tab tỉ lệ chỉ
  // hiện dòng đang bật, nên dòng đang tắt không thể có hệ số gõ dở. Tick lại thì
  // lấy hệ số 1 của server; tắt thì lấy nguyên dòng server.
  if (!previousDraftRow || !previousDraftRow.is_active || !serverRow.is_active) {
    return serverRow;
  }
  return {
    ...serverRow,
    weight: previousDraftRow.weight,
    position: previousDraftRow.position,
  };
}

/** Đọc dòng PATCH trả về; sai hình dạng thì null để bên gọi nạp lại cả danh sách. */
export function parseAssignmentWeightRow(value: unknown): AssignmentWeightRowView | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.agent_email !== "string" || raw.agent_email === "") return null;
  if (typeof raw.is_active !== "boolean") return null;
  const weight = Number(raw.weight);
  const position = Number(raw.position);
  const currentWeight = Number(raw.current_weight ?? 0);
  if (!Number.isFinite(weight) || !Number.isFinite(position)) return null;
  return {
    agent_email: raw.agent_email,
    weight,
    position,
    is_active: raw.is_active,
    share: 0,
    current_weight: Number.isFinite(currentWeight) ? currentWeight : 0,
  };
}
