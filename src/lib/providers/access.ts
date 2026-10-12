import { can } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";

/**
 * Quyền trên Provider List, hai tầng.
 *
 *   Tầng 1 `automation.provider_finder`  — xem bảng, chạy Finder, sửa ô.
 *   Tầng 2 `automation.provider_manage`  — THÊM / XOÁ address, đổi cột của bảng,
 *                                          và Export / Import bảng.
 *
 * Tầng 2 đứng TRÊN tầng 1, không thay nó: người không vào được Provider List thì
 * vẫn không đụng được dữ liệu của nó, dù có cấp nhầm quyền manage.
 *
 * Export / Import của bảng Provider chỉ đi theo tầng Manage. Trước 2026-10-09
 * `task.export` / `task.import` (quyền của Task + Enrollment) cũng mở được — một
 * quyền chéo; giờ mỗi trang chỉ dùng quyền của chính nó.
 *
 * Một nơi duy nhất quyết định luật này; trang, route và nút bấm đều gọi vào đây
 * để chúng không bao giờ nói khác nhau.
 */
function hasFinder(permissions: readonly string[] | undefined): boolean {
  return can(permissions, PERMISSIONS.AUTOMATION_PROVIDER_FINDER);
}

/** Thêm / xoá address và đổi cấu hình cột của bảng Provider. */
export function canManageProviders(
  permissions: readonly string[] | undefined
): boolean {
  return (
    hasFinder(permissions) &&
    can(permissions, PERMISSIONS.AUTOMATION_PROVIDER_MANAGE)
  );
}

export function canExportProviders(
  permissions: readonly string[] | undefined
): boolean {
  return canManageProviders(permissions);
}

export function canImportProviders(
  permissions: readonly string[] | undefined
): boolean {
  return canManageProviders(permissions);
}
