import { describe, expect, it } from "vitest";
import { buildLeadActor, isLeadViewAdmin } from "@/lib/leads/access";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { canActorExport, canActorImport } from "@/lib/table-config/export-access";
import { buildTaskActor, isTaskViewAdmin } from "@/lib/tasks/access";
import { ACTIONS } from "./catalog";
import { deriveCompatGrants, type LegacyAccess } from "./compat";
import { decodeGrant, hasGrant } from "./grants";

/**
 * Persona lấy từ snapshot production 04/09 (docs/2026-09-04-rbac-role-access-inventory.md §6)
 * cộng các ca biên. Mỗi persona được đối chiếu với các hàm quyết định CŨ để chắc
 * grant tương thích không đổi quyết định nào.
 */
const ALL_PERMISSIONS = Object.values(PERMISSIONS);
const PERSONAS: Record<string, LegacyAccess> = {
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

describe("deriveCompatGrants — tương đương quyết định cũ", () => {
  for (const [name, access] of Object.entries(PERSONAS)) {
    const grants = deriveCompatGrants(access);
    const user = { role: access.legacyRole ?? null, roles: [...access.roles] };

    it(`${name}: task manager / worker`, () => {
      const actor = buildTaskActor(access.permissions, "x@x.com", { isAdmin: isTaskViewAdmin(user) });
      expect(hasGrant(grants, "task.read", "all")).toBe(actor.isManager);
      expect(hasGrant(grants, "task.backlog.read")).toBe(actor.isManager);
      expect(hasGrant(grants, "task.config.manage")).toBe(actor.isManager);
      expect(hasGrant(grants, "enrollment.options.manage")).toBe(actor.isManager);
      expect(hasGrant(grants, "task.read")).toBe(actor.isWorker);
      expect(hasGrant(grants, "enrollment.read")).toBe(actor.isWorker);
    });

    it(`${name}: lead manager / worker`, () => {
      const actor = buildLeadActor(access.permissions, "x@x.com", { isAdmin: isLeadViewAdmin(user) });
      expect(hasGrant(grants, "lead.read", "all")).toBe(actor.isManager);
      expect(hasGrant(grants, "lead.assign")).toBe(actor.isManager);
      expect(hasGrant(grants, "lead.read")).toBe(actor.isWorker);
    });

    it(`${name}: export / import`, () => {
      expect(hasGrant(grants, "task.export")).toBe(canActorExport(access.permissions));
      expect(hasGrant(grants, "provider.import")).toBe(canActorImport(access.permissions));
    });

    it(`${name}: mọi grant hợp lệ theo catalog`, () => {
      expect(grants.every((grant) => decodeGrant(grant) !== null)).toBe(true);
    });
  }

  it("worker thường: đủ scope quan hệ, KHÔNG có scope all", () => {
    const grants = deriveCompatGrants(PERSONAS.taskCs);
    expect(hasGrant(grants, "task.read", "shared_queue")).toBe(true);
    expect(hasGrant(grants, "task.content.update", "reported")).toBe(true);
    // Người được @mention chỉ được xem, không được sửa nội dung (audit C8).
    expect(hasGrant(grants, "task.content.update", "participating" as never)).toBe(false);
    expect(hasGrant(grants, "task.due_date.update", "participating")).toBe(true);
    expect(hasGrant(grants, "task.assign", "all")).toBe(false);
  });

  it("company.view_all chỉ mở rộng registration khi có quyền registration", () => {
    const withReg = deriveCompatGrants({
      permissions: [PERMISSIONS.CUSTOMER_REGISTRATION_HEALTH, PERMISSIONS.COMPANY_VIEW_ALL],
      roles: [],
      legacyRole: "agent",
    });
    expect(hasGrant(withReg, "registration.health.read", "all")).toBe(true);
    expect(hasGrant(withReg, "registration.health.update", "all")).toBe(true);

    const withoutReg = deriveCompatGrants({
      permissions: [PERMISSIONS.COMPANY_VIEW_ALL],
      roles: [],
      legacyRole: "agent",
    });
    expect(hasGrant(withoutReg, "registration.health.read")).toBe(false);
  });

  it("enrollment.import chỉ cho task admin có task.import (A8)", () => {
    expect(
      hasGrant(
        deriveCompatGrants({ permissions: [PERMISSIONS.TASK_IMPORT, PERMISSIONS.TASK_WORK], roles: [], legacyRole: "agent" }),
        "enrollment.import"
      )
    ).toBe(false);
    expect(hasGrant(deriveCompatGrants(PERSONAS.admin), "enrollment.import")).toBe(true);
  });

  it("thông báo leo thang chỉ cho legacy admin; task_created cho mọi người giữ task.manage", () => {
    expect(hasGrant(deriveCompatGrants(PERSONAS.admin), "notify.task.escalation")).toBe(true);
    expect(hasGrant(deriveCompatGrants(PERSONAS.adminHealthTask), "notify.task.escalation")).toBe(false);
    expect(hasGrant(deriveCompatGrants(PERSONAS.customManage), "notify.task.created")).toBe(true);
  });
});

describe("catalog", () => {
  it("action không trùng, mỗi action có ít nhất một scope", () => {
    const names = ACTIONS.map((definition) => definition.action);
    expect(new Set(names).size).toBe(names.length);
    expect(ACTIONS.every((definition) => definition.scopes.length > 0)).toBe(true);
  });

  // Đo cho quyết định D5: grant của Admin đã vượt budget cookie 3.500 byte
  // TRƯỚC khi mã hoá, nên grant KHÔNG đi trong JWT — server suy lại mỗi request
  // từ cache định nghĩa role (principal.ts). Nếu test này bắt đầu fail vì grant
  // nhỏ lại, xem xét lại quyết định chứ đừng xoá test.
  it("grant của Admin quá lớn để đi trong JWT (lý do của D5)", () => {
    const grants = deriveCompatGrants(PERSONAS.admin);
    const bytes = new TextEncoder().encode(JSON.stringify(grants)).length;
    expect(bytes).toBeGreaterThan(3500);
  });
});
