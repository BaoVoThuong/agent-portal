/**
 * Cột hệ thống được phép có danh sách option do admin quản lý.
 *
 * Danh sách này phải khớp với `is_admin_managed_system_column` trong database.
 * TS chỉ giúp UI không mời admin làm một việc mà API/database sẽ từ chối; chốt
 * chặn cuối cùng vẫn nằm ở server.
 */
const ADMIN_MANAGED_SYSTEM_COLUMNS = new Set([
  "provider:practices_as",
  "provider:obamacare",
  "provider:medicare",
  // Trường cố định của mẫu Import Lead (2026-10-03) — admin thêm/sửa lựa chọn.
  "lead:gender",
  "lead:contact_method",
  "lead:best_time_to_contact",
  "lead:insurance_needs",
]);

/**
 * Cột HỆ THỐNG mà giá trị vẫn nằm trong `custom_values`, theo key cột.
 *
 * Sáu trường của mẫu Import Lead là trường cố định — không archive được, luôn
 * có trên form — nhưng không có cột riêng trên bảng `leads`. Chúng đi đúng
 * đường của cột custom (validate, Required, ô sửa) chứ không phải đường của
 * cột hệ thống (đọc từ cột thật của bảng).
 */
const CUSTOM_VALUE_SYSTEM_COLUMNS = new Set([
  "lead:age",
  "lead:gender",
  "lead:ticket_number",
  "lead:contact_method",
  "lead:best_time_to_contact",
  "lead:insurance_needs",
]);

/** Giá trị của cột này nằm trong `custom_values` (cột custom, hoặc cột hệ thống ở trên). */
export function storesInCustomValues(column: {
  scope: string;
  key: string;
  is_system: boolean;
}): boolean {
  return !column.is_system || CUSTOM_VALUE_SYSTEM_COLUMNS.has(`${column.scope}:${column.key}`);
}

export function canManageColumnOptions(column: {
  scope: string;
  key: string;
  type: string;
  is_system: boolean;
}): boolean {
  if (column.type !== "dropdown" && column.type !== "multiselect") return false;
  if (!column.is_system) return true;
  return ADMIN_MANAGED_SYSTEM_COLUMNS.has(`${column.scope}:${column.key}`);
}
