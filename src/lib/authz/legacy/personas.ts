import { PERMISSIONS } from "@/lib/rbac/permissions";
import type { LegacyAccess } from "../compat";

/**
 * Persona lấy từ snapshot production 04/09 (docs/2026-09-04-rbac-role-access-inventory.md §6)
 * cộng các ca biên. Mỗi persona được đối chiếu với các hàm quyết định CŨ để chắc
 * grant tương thích không đổi quyết định nào.
 */
const ALL_PERMISSIONS = Object.values(PERMISSIONS);
export const PERSONAS: Record<string, LegacyAccess> = {
  admin: { permissions: ALL_PERMISSIONS, roles: ["Admin"], legacyRole: "admin" },
  adminHealthTask: {
    permissions: [PERMISSIONS.SETTINGS, PERMISSIONS.TASK_MANAGE],
    roles: ["Admin Health Task"],
    legacyRole: "agent",
  },
  taskCs: {
    permissions: [PERMISSIONS.SETTINGS, PERMISSIONS.TASK_WORK],
    roles: ["Task CS"],
    legacyRole: "agent",
  },
  healthAgent: {
    permissions: [
      PERMISSIONS.CUSTOMER_REGISTRATION_HEALTH,
      PERMISSIONS.AUTOMATION_HEALTH_STATEMENT,
      PERMISSIONS.AUTOMATION_PROVIDER_FINDER,
      PERMISSIONS.AGENT_DASHBOARD_HEALTH,
      PERMISSIONS.SETTINGS,
      PERMISSIONS.TASK_WORK,
    ],
    roles: ["Health Agent"],
    legacyRole: "agent",
  },
  accounting: {
    permissions: [
      PERMISSIONS.AUTOMATION_HEALTH_STATEMENT,
      PERMISSIONS.AUTOMATION_PC_STATEMENT,
      PERMISSIONS.COMPANY_DASHBOARD_HEALTH,
      PERMISSIONS.COMPANY_DASHBOARD_PC,
      PERMISSIONS.SETTINGS,
    ],
    roles: ["Accounting"],
    legacyRole: "agent",
  },
  // task.manage mà role không mang tên task-admin: KHÔNG phải manager (luật 1).
  customManage: {
    permissions: [PERMISSIONS.TASK_MANAGE, PERMISSIONS.LEAD_WORK],
    roles: ["Custom Manager"],
    legacyRole: "agent",
  },
  // Tên role task-admin nhưng thiếu task.manage.
  taskAdminNameOnly: { permissions: [PERMISSIONS.TASK_WORK], roles: ["Task Admin"], legacyRole: "agent" },
  // Legacy admin (cột) với role thường: vẫn là lead manager (luật 3).
  legacyColumnAdmin: {
    permissions: [PERMISSIONS.TASK_WORK, PERMISSIONS.TASK_MANAGE],
    roles: ["Task CS"],
    legacyRole: "admin",
  },
  leadWorker: { permissions: [PERMISSIONS.LEAD_WORK], roles: ["Lead"], legacyRole: "agent" },
  nothing: { permissions: [], roles: [], legacyRole: "agent" },
};
