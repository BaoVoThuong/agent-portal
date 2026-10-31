import { can, canAny } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";

/**
 * Quyền trên Provider List, hai tầng — cùng kiểu task.work / task.manage.
 *
 *   Work   `automation.provider_finder`  — xem bảng, chạy Finder, sửa ô, và
 *                                          thêm / nhập address VÀO BACKLOG.
 *   Manage `automation.provider_manage`  — MỌI THỨ của Work, cộng: thêm / nhập
 *                                          vào thẳng danh sách, duyệt Backlog,
 *                                          XOÁ address, bình luận, đổi cột của
 *                                          bảng, và Export.
 *
 * Backlog (2026-10-26): trước đó chỉ tầng 2 thêm / nhập được. Giờ ai xem được
 * bảng cũng gửi được, nhưng dòng của tầng 1 chờ tầng 2 duyệt rồi mới vào danh
 * sách — List, Finder và Export không bao giờ thấy dòng chưa duyệt.
 *
 * Manage BAO GỒM Work (2026-10-31, `IMPLIED_PERMISSIONS`): role có Manage không
 * cần tick Finder, và Role Manager không lưu Finder bên cạnh Manage. Trước đó
 * Manage đứng trên Finder mà không thay nó — quên tick Finder là mất lối vào.
 *
 * Export / Import của bảng Provider chỉ đi theo tầng Manage. Trước 2026-10-09
 * `task.export` / `task.import` (quyền của Task + Enrollment) cũng mở được — một
 * quyền chéo; giờ mỗi trang chỉ dùng quyền của chính nó.
 *
 * Một nơi duy nhất quyết định luật này; trang, route và nút bấm đều gọi vào đây
 * để chúng không bao giờ nói khác nhau.
 */
/** Quyền mở Provider List — Work hoặc Manage. Dùng cho requireAnyPermission / sidebar. */
export const PROVIDER_VIEW_PERMISSIONS = [
  PERMISSIONS.AUTOMATION_PROVIDER_FINDER,
  PERMISSIONS.AUTOMATION_PROVIDER_MANAGE,
] as const;

/** Vào Provider List: Work hoặc Manage. */
export function canViewProviders(permissions: readonly string[] | undefined): boolean {
  return canAny(permissions, PROVIDER_VIEW_PERMISSIONS);
}

/** Thêm / xoá address và đổi cấu hình cột của bảng Provider. */
export function canManageProviders(
  permissions: readonly string[] | undefined
): boolean {
  return can(permissions, PERMISSIONS.AUTOMATION_PROVIDER_MANAGE);
}

export function canExportProviders(
  permissions: readonly string[] | undefined
): boolean {
  return canManageProviders(permissions);
}

/** Thêm address bằng form. Không có Manage thì dòng vào Backlog. */
export function canAddProviders(
  permissions: readonly string[] | undefined
): boolean {
  return canViewProviders(permissions);
}

/** Nhập file. Cùng luật với thêm bằng form: không có Manage thì vào Backlog. */
export function canImportProviders(
  permissions: readonly string[] | undefined
): boolean {
  return canAddProviders(permissions);
}

/** Dòng người này thêm / nhập vào thẳng danh sách, không qua Backlog. */
export function providerWritesGoLive(
  permissions: readonly string[] | undefined
): boolean {
  return canManageProviders(permissions);
}

/** Duyệt Backlog: Verify, Update existing, Reject. */
export function canReviewProviderBacklog(
  permissions: readonly string[] | undefined
): boolean {
  return canManageProviders(permissions);
}
