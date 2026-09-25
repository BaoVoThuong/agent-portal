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

/**
 * Import Enrollment ghi thẳng `.update()` theo ID — KHÔNG qua scope bản ghi,
 * capability từng dòng hay activity log (api/enrollment/import/route.ts). Cho
 * tới khi import áp đủ các lớp đó (Phase D, Q11), chỉ task admin — người vốn
 * đã thấy và sửa được mọi hồ sơ — mới được dùng. Không nới thêm gì cho họ; chỉ
 * chặn việc cấp `task.import` cho người thường thành cửa hậu (S6).
 */
export function canActorImportEnrollment(
  permissions: readonly string[] | undefined,
  actor: { isManager: boolean }
): boolean {
  return canActorImport(permissions) && actor.isManager;
}
