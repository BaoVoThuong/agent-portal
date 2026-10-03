/**
 * Chỗ đặt các trường cố định của mẫu Import (2026-10-03) trên form Add lead và
 * drawer — một nguồn để hai màn hình không xếp mỗi nơi một kiểu.
 *
 *  - Thông tin về KHÁCH: cột trái, cạnh tên / số điện thoại / email.
 *  - NHU CẦU: sau thông tin khách, trước Agent.
 *  - Thuộc tính LEAD còn lại: cột phải, sau Agent / Collaborators.
 */
export const LEAD_CLIENT_FIELD_KEYS = ["age", "gender"] as const;

export const LEAD_NEED_FIELD_KEYS = ["insurance_needs"] as const;

export const LEAD_PROPERTY_FIELD_KEYS = [
  "contact_method",
  "best_time_to_contact",
  "ticket_number",
] as const;

/** Lọc + xếp cột theo đúng thứ tự `keys`; cột không có thì bỏ qua. */
export function pickColumnsInOrder<Column extends { key: string }>(
  columns: readonly Column[],
  keys: readonly string[],
): Column[] {
  const byKey = new Map(columns.map((column) => [column.key, column]));
  return keys.flatMap((key) => {
    const column = byKey.get(key);
    return column ? [column] : [];
  });
}
