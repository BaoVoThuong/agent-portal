import { describe, expect, it } from "vitest";
import { PERMISSIONS as P } from "@/lib/rbac/permissions";
import { deriveCompatGrants } from "./compat";
import { PERSONAS } from "./legacy/personas";
import { isLegacyTaskAdminRole, type LegacyAccess } from "./compat";
import {
  canUseNotifications,
  getFirstAccessiblePath,
  visibleNavKeys,
  type NavKey,
} from "./navigation";

// Luật menu CŨ (Sidebar.tsx / rbac/routes.ts trước Phase E), theo permission phẳng.
const LEGACY_NAV: [NavKey, string[]][] = [
  ["registration.health", [P.CUSTOMER_REGISTRATION_HEALTH]],
  ["registration.pc", [P.CUSTOMER_REGISTRATION_PC]],
  ["automation.health_statement", [P.AUTOMATION_HEALTH_STATEMENT]],
  ["automation.pc_statement", [P.AUTOMATION_PC_STATEMENT]],
  ["provider.list", [P.AUTOMATION_PROVIDER_FINDER]],
  ["dashboard.health", [P.AGENT_DASHBOARD_HEALTH, P.COMPANY_DASHBOARD_HEALTH]],
  ["dashboard.pc", [P.AGENT_DASHBOARD_PC, P.COMPANY_DASHBOARD_PC]],
  ["tasks", [P.TASK_MANAGE, P.TASK_WORK]],
  ["enrollment", [P.TASK_MANAGE, P.TASK_WORK]],
  ["leads", [P.LEAD_MANAGE, P.LEAD_WORK]],
  ["config", [P.TASK_MANAGE, P.LEAD_MANAGE]],
  ["timeoff", [P.TIME_OFF_USER, P.TIME_OFF_ADMIN]],
  ["account_manager", [P.ACCOUNT_MANAGER]],
  ["role_manager", [P.ROLE_MANAGER]],
  ["settings", [P.SETTINGS]],
];

function legacyVisible(access: LegacyAccess): NavKey[] {
  return LEGACY_NAV.filter(([, keys]) => keys.some((key) => access.permissions.includes(key))).map(
    ([nav]) => nav
  );
}

describe("registry điều hướng theo grant", () => {
  for (const [name, access] of Object.entries(PERSONAS)) {
    it(`${name}: cùng mục menu như trước (trừ Table Configuration)`, () => {
      const grants = deriveCompatGrants(access);
      const next = visibleNavKeys(grants).filter((key) => key !== "config");
      const legacy = legacyVisible(access).filter((key) => key !== "config");
      // Legacy admin quản lead không cần lead.* — menu cũ giấu mất Lead Management.
      const leadViaAdmin = next.includes("leads") && !legacy.includes("leads");
      expect(leadViaAdmin ? next.filter((key) => key !== "leads") : next).toEqual(legacy);
    });
  }

  it("Table Configuration chỉ hiện cho người sửa được ít nhất một bảng", () => {
    // Giữ task.manage nhưng không phải task admin: trang /config từ chối → nay ẩn mục.
    const customManage = deriveCompatGrants(PERSONAS.customManage);
    expect(isLegacyTaskAdminRole(PERSONAS.customManage)).toBe(false);
    expect(visibleNavKeys(customManage)).not.toContain("config");
    expect(visibleNavKeys(deriveCompatGrants(PERSONAS.adminHealthTask))).toContain("config");
  });

  it("trang đích: mục đầu tiên mở được; không có gì thì /unauthorized", () => {
    expect(getFirstAccessiblePath(deriveCompatGrants(PERSONAS.taskCs))).toBe("/tasks");
    expect(getFirstAccessiblePath(deriveCompatGrants(PERSONAS.healthAgent))).toBe("/");
    expect(getFirstAccessiblePath(deriveCompatGrants(PERSONAS.leadWorker))).toBe("/tasks/leads");
    expect(getFirstAccessiblePath([])).toBe("/unauthorized");
  });

  it("chuông hiện cả khi chỉ dùng Time Off", () => {
    expect(canUseNotifications(["timeoff.request:*"])).toBe(true);
    expect(canUseNotifications(["settings.access:*"])).toBe(false);
  });
});
