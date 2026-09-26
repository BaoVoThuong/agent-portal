import { PERMISSIONS } from "@/lib/rbac/permissions";
import { ACTIONS, getActionDefinition, type Action } from "./catalog";
import { deriveCompatGrants } from "./compat";
import { decodeGrant, encodeGrant, hasGrant, normalizeGrants } from "./grants";

/**
 * Trần uỷ quyền (audit S4, plan D10): người thao tác chỉ cấp / gán được những
 * grant chính mình đang có. So trên GRANT HIỆU LỰC (đã gồm scope), không so tên
 * role hay permission phẳng.
 *
 * Trả về các grant vượt trần — rỗng nghĩa là được phép.
 */
export function grantsBeyondCeiling(
  actorGrants: readonly string[],
  targetGrants: readonly string[]
): string[] {
  return normalizeGrants(targetGrants).filter((grant) => !canDelegateGrant(actorGrants, grant));
}

/**
 * Người này cấp được `grant` cho người khác: đang giữ đúng grant đó, hoặc giữ
 * scope `all` của cùng action, hoặc giữ action quản lý của một grant "thành viên" (`delegatedBy` trong catalog — vd
 * quản cấu hình task thì xếp được người vào hàng đợi CS dù bản thân không ở đó).
 * Dùng chung cho API và lưới Role Manager.
 */
export function canDelegateGrant(actorGrants: readonly string[], grant: string): boolean {
  if (actorGrants.includes(grant)) return true;
  const decoded = decodeGrant(grant);
  if (!decoded) return false;
  // `all` bao mọi scope hẹp hơn của CÙNG action: người xem mọi task cấp được
  // "xem task được giao" (review C P2-07). Chiều ngược lại vẫn bị chặn.
  if (decoded.scope !== "*" && hasGrant(actorGrants, decoded.action as Action, "all")) return true;
  const manager = getActionDefinition(decoded.action)?.delegatedBy;
  return Boolean(manager && hasGrant(actorGrants, manager as Action));
}

/** Mọi grant hợp lệ theo catalog — dùng cho test và lưới Role Manager. */
export function allCatalogGrants(): string[] {
  return ACTIONS.flatMap((definition) =>
    definition.scopes.map((scope) => encodeGrant({ action: definition.action, scope }))
  );
}

/**
 * Bản chiếu permission phẳng từ grant — ghi vào `role_permissions` khi lưu role.
 * Từ Phase H không code nào đọc nó để phân quyền; nó chỉ còn để QUAY VỀ code cũ.
 *
 * Phải AN TOÀN (review C P1-01..03): chỉ chiếu tập key K mà luật cũ hiểu KHÔNG
 * rộng hơn grant — `deriveCompatGrants(K, tên role) ⊆ grants`. Tham lam: thử key
 * thường trước, key "khuếch đại" (company.view_all, task.manage, lead.manage) sau
 * cùng, để key khuếch đại không chặn mất key thường.
 */
const AMPLIFYING_KEYS: readonly string[] = [
  PERMISSIONS.COMPANY_VIEW_ALL,
  PERMISSIONS.TASK_MANAGE,
  PERMISSIONS.LEAD_MANAGE,
];

export function projectLegacyPermissions(grants: readonly string[], roleName: string): string[] {
  const held = new Set(normalizeGrants(grants));
  const within = (keys: readonly string[]) =>
    deriveCompatGrants({ permissions: keys, roles: [roleName], legacyRole: "agent" }).every((grant) =>
      held.has(grant)
    );
  const allKeys = Object.values(PERMISSIONS) as string[];
  const ordered = [
    ...allKeys.filter((key) => !AMPLIFYING_KEYS.includes(key)),
    ...AMPLIFYING_KEYS,
  ];
  const keys: string[] = [];
  for (const key of ordered) {
    // Key không mở thêm grant nào (vd không có ánh xạ) thì bỏ.
    if (deriveCompatGrants({ permissions: [key], roles: [roleName], legacyRole: "agent" }).length === 0) {
      continue;
    }
    if (within([...keys, key])) keys.push(key);
  }
  return keys.sort();
}
