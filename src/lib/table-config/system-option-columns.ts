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
]);

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
