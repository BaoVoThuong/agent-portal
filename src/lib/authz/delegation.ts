import { PERMISSIONS } from "@/lib/rbac/permissions";
import { ACTIONS, getActionDefinition, type Action } from "./catalog";
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
 * Bản chiếu permission phẳng từ grant — ghi vào `role_permissions` khi role đã
 * chuyển sang grant, để điều hướng và code chưa chuyển vẫn thấy quyền nhất quán
 * (plan D3). Luật: permission cũ có mặt khi grant tương ứng có mặt.
 */
export function projectLegacyPermissions(grants: readonly string[]): string[] {
  const any = (action: Action) => hasGrant(grants, action);
  const all = (action: Action) => hasGrant(grants, action, "all");
  const keys: string[] = [];
  const add = (condition: boolean, key: string) => {
    if (condition) keys.push(key);
  };

  add(any("registration.health.read"), PERMISSIONS.CUSTOMER_REGISTRATION_HEALTH);
  add(any("registration.pc.read"), PERMISSIONS.CUSTOMER_REGISTRATION_PC);
  add(any("automation.health_statement.run"), PERMISSIONS.AUTOMATION_HEALTH_STATEMENT);
  add(any("automation.pc_statement.run"), PERMISSIONS.AUTOMATION_PC_STATEMENT);
  add(any("provider.read"), PERMISSIONS.AUTOMATION_PROVIDER_FINDER);
  add(any("dashboard.health.agent.read"), PERMISSIONS.AGENT_DASHBOARD_HEALTH);
  add(any("dashboard.pc.agent.read"), PERMISSIONS.AGENT_DASHBOARD_PC);
  add(any("dashboard.health.company.read"), PERMISSIONS.COMPANY_DASHBOARD_HEALTH);
  add(any("dashboard.pc.company.read"), PERMISSIONS.COMPANY_DASHBOARD_PC);
  add(
    all("registration.health.read") ||
      all("registration.pc.read") ||
      all("dashboard.health.agent.read") ||
      all("dashboard.pc.agent.read"),
    PERMISSIONS.COMPANY_VIEW_ALL
  );
  add(any("account.manage"), PERMISSIONS.ACCOUNT_MANAGER);
  add(any("role.manage"), PERMISSIONS.ROLE_MANAGER);
  add(any("timeoff.request"), PERMISSIONS.TIME_OFF_USER);
  add(any("timeoff.manage"), PERMISSIONS.TIME_OFF_ADMIN);
  add(any("settings.access"), PERMISSIONS.SETTINGS);
  add(all("task.read"), PERMISSIONS.TASK_MANAGE);
  add(any("task.read"), PERMISSIONS.TASK_WORK);
  add(any("task.export") || any("enrollment.export") || any("provider.export"), PERMISSIONS.TASK_EXPORT);
  add(any("enrollment.import") || any("provider.import"), PERMISSIONS.TASK_IMPORT);
  add(all("lead.read"), PERMISSIONS.LEAD_MANAGE);
  add(any("lead.read"), PERMISSIONS.LEAD_WORK);

  return [...new Set(keys)].sort();
}
