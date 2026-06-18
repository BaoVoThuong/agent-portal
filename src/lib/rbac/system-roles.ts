import type { UserRole } from "@/lib/domain/account.types";

/**
 * MIGRATION SHIM — cô lập điểm cầu nối giữa hai mô hình phân quyền đang TỒN TẠI
 * SONG SONG:
 *   - Legacy: cột `role` ("admin" | "agent") trên bảng portal_account.
 *   - RBAC mới: bảng user_roles → roles → role_permissions (granular permissions).
 *
 * Toàn bộ logic ánh xạ legacy <-> RBAC được gom về DUY NHẤT file này để khi muốn
 * gỡ bỏ mô hình legacy (bỏ cột `role`) ta chỉ phải sửa một nơi.
 *
 * ⚠️ CHƯA XOÁ trong đợt refactor "structure-only" này: việc loại bỏ cột legacy
 * `role` là thay đổi behavior + schema, cần đề xuất migration riêng (xem
 * MIGRATION_REPORT.md, mục Phase 4 / "nợ kỹ thuật mở").
 */

export const SYSTEM_ROLE_NAMES = {
  SUPER_ADMIN: "Admin",
  AGENT: "Agent",
} as const;

export const LEGACY_SUPER_ADMIN_ROLE_NAME = "Super Admin";

export function getDefaultSystemRoleName(legacyRole: UserRole) {
  return legacyRole === "admin"
    ? SYSTEM_ROLE_NAMES.SUPER_ADMIN
    : SYSTEM_ROLE_NAMES.AGENT;
}

export function getLegacyRoleFromRoleNames(roleNames: readonly string[]): UserRole {
  return roleNames.includes(SYSTEM_ROLE_NAMES.SUPER_ADMIN) ||
    roleNames.includes(LEGACY_SUPER_ADMIN_ROLE_NAME)
    ? "admin"
    : "agent";
}
