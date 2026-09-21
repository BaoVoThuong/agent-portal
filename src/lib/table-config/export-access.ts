import { PERMISSIONS } from "@/lib/rbac/permissions";
import { can } from "@/lib/rbac/client";

export function canActorExport(
  permissions: readonly string[] | undefined
): boolean {
  return can(permissions, PERMISSIONS.TASK_EXPORT);
}

/**
 * Nhập là quyền RIÊNG, không suy ra từ Export.
 *
 * Export chỉ ĐỌC; Import GHI ĐÈ hàng loạt — một file sai có thể sửa hàng trăm
 * dòng trong một lượt. Cho người ta quyền kéo dữ liệu ra không có nghĩa là cho
 * quyền đẩy dữ liệu vào.
 */
export function canActorImport(
  permissions: readonly string[] | undefined
): boolean {
  return can(permissions, PERMISSIONS.TASK_IMPORT);
}
