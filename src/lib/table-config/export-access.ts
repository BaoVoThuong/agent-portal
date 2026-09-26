import type { Action } from "@/lib/authz/catalog";
import { hasGrant } from "@/lib/authz/grants";

/** Domain có Export/Import riêng — mỗi domain một grant (audit C9, review C P1-03). */
export type TransferDomain = "task" | "enrollment" | "provider";

export function canActorExport(
  grants: readonly string[] | undefined,
  domain: TransferDomain
): boolean {
  return hasGrant(grants, `${domain}.export` as Action);
}

/**
 * Nhập là quyền RIÊNG, không suy ra từ Export.
 *
 * Export chỉ ĐỌC; Import GHI ĐÈ hàng loạt — một file sai có thể sửa hàng trăm
 * dòng trong một lượt. Cho người ta quyền kéo dữ liệu ra không có nghĩa là cho
 * quyền đẩy dữ liệu vào.
 *
 * Import Enrollment ghi thẳng `.update()` theo ID — KHÔNG qua scope bản ghi,
 * capability từng dòng hay activity log (api/enrollment/import/route.ts). Grant
 * tương thích chỉ cấp `enrollment.import` cho task admin có `task.import` (S6);
 * role tuỳ chỉnh chỉ nên cấp nó cho người vốn đã sửa được mọi hồ sơ.
 */
export function canActorImport(
  grants: readonly string[] | undefined,
  domain: Exclude<TransferDomain, "task">
): boolean {
  return hasGrant(grants, `${domain}.import` as Action);
}
