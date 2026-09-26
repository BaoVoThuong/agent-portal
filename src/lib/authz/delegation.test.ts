import { describe, expect, it, vi } from "vitest";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { deriveCompatGrants } from "./compat";
import { allCatalogGrants, grantsBeyondCeiling, projectLegacyPermissions } from "./delegation";

vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: () => {
    throw new Error("test này không được chạm database");
  },
}));
vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));

const { grantsForRoles, SUPER_ADMIN_GRANTS } = await import("./principal");

describe("grantsBeyondCeiling", () => {
  it("được cấp đúng thứ mình có", () => {
    expect(grantsBeyondCeiling(["task.read:all", "task.export:*"], ["task.read:all"])).toEqual([]);
  });

  it("liệt kê grant vượt trần, kể cả khác scope", () => {
    expect(grantsBeyondCeiling(["task.read:assigned"], ["task.read:all", "task.read:assigned"])).toEqual([
      "task.read:all",
    ]);
  });

  it("bỏ qua chuỗi rác thay vì coi là vượt trần", () => {
    expect(grantsBeyondCeiling([], ["bogus"])).toEqual([]);
  });
});

describe("Admin (role hệ thống) cấp được MỌI grant trong catalog", () => {
  // Nếu test này fail sau khi thêm action mới, Admin sẽ không cấp được action
  // đó cho ai (trần uỷ quyền): action "thành viên" cần `delegatedBy`.
  it("không grant nào nằm ngoài tầm Admin", () => {
    const adminGrants = grantsForRoles([
      { id: "admin", name: "Admin", isActive: true, systemKey: "super_admin", permissions: [], grants: null },
    ]);
    expect(grantsBeyondCeiling(adminGrants, allCatalogGrants())).toEqual([]);
  });

  it("SUPER_ADMIN_GRANTS trùng grant tương thích của Admin cũ (không ai đổi quyền)", () => {
    const legacyAdmin = deriveCompatGrants({
      permissions: Object.values(PERMISSIONS),
      roles: ["Admin"],
      legacyRole: "admin",
    });
    expect([...SUPER_ADMIN_GRANTS]).toEqual(legacyAdmin);
  });
});

describe("projectLegacyPermissions", () => {
  it("worker Task CS chiếu lại đúng permission cũ", () => {
    const grants = deriveCompatGrants({
      permissions: [PERMISSIONS.TASK_WORK, PERMISSIONS.SETTINGS],
      roles: ["Task CS"],
      legacyRole: "agent",
    });
    expect(projectLegacyPermissions(grants, "Task CS")).toEqual(
      [PERMISSIONS.SETTINGS, PERMISSIONS.TASK_WORK].sort()
    );
  });

  it("task admin chiếu ra task.manage — không thêm task.work (sẽ kéo vào hàng đợi CS)", () => {
    const grants = deriveCompatGrants({
      permissions: [PERMISSIONS.TASK_MANAGE],
      roles: ["Admin Health Task"],
      legacyRole: "agent",
    });
    expect(projectLegacyPermissions(grants, "Admin Health Task")).toEqual([PERMISSIONS.TASK_MANAGE]);
  });

  it("an toàn: luật cũ đọc bản chiếu KHÔNG rộng hơn grant (review C P1-01..03)", () => {
    const cases: [string, string[]][] = [
      ["Reader", ["registration.health.read:all"]],
      ["Reader", ["provider.read:*"]],
      ["Reader", ["lead.read:all"]],
      ["Reader", ["task.read:assigned"]],
      ["Task Admin", ["task.read:all"]],
      ["Mixed", ["registration.health.read:all", "registration.pc.read:own"]],
      ["Mixed", ["provider.read:*", "enrollment.import:*"]],
    ];
    for (const [name, grants] of cases) {
      const projected = projectLegacyPermissions(grants, name);
      const legacy = deriveCompatGrants({ permissions: projected, roles: [name], legacyRole: "agent" });
      expect(legacy.filter((grant) => !grants.includes(grant)), `${name} ${grants}`).toEqual([]);
    }
  });

  it("chiếu rồi suy ngược cho lại cùng grant với role worker thường", () => {
    const original = deriveCompatGrants({
      permissions: [
        PERMISSIONS.CUSTOMER_REGISTRATION_HEALTH,
        PERMISSIONS.AGENT_DASHBOARD_HEALTH,
        PERMISSIONS.AUTOMATION_PROVIDER_FINDER,
        PERMISSIONS.TASK_WORK,
        PERMISSIONS.LEAD_WORK,
        PERMISSIONS.TIME_OFF_USER,
      ],
      roles: ["Health Agent"],
      legacyRole: "agent",
    });
    const roundTrip = deriveCompatGrants({
      permissions: projectLegacyPermissions(original, "Health Agent"),
      roles: ["Health Agent"],
      legacyRole: "agent",
    });
    expect(roundTrip).toEqual(original);
  });
});

describe("canDelegateGrant", () => {
  it("grant thành viên: người quản lý cấp được dù không giữ", () => {
    expect(grantsBeyondCeiling(["task.config.manage:*"], ["task.queue.member:*"])).toEqual([]);
    expect(grantsBeyondCeiling(["task.read:assigned"], ["task.queue.member:*"])).toEqual([
      "task.queue.member:*",
    ]);
  });
});

describe("scope all bao scope hẹp (review C P2-07)", () => {
  it("giữ read:all cấp được read:assigned; giữ read:assigned KHÔNG cấp được read:all", () => {
    expect(grantsBeyondCeiling(["task.read:all"], ["task.read:assigned", "task.read:reported"])).toEqual([]);
    expect(grantsBeyondCeiling(["task.read:assigned"], ["task.read:all"])).toEqual(["task.read:all"]);
    expect(grantsBeyondCeiling(["task.read:all"], ["task.status.update:assigned"])).toEqual([
      "task.status.update:assigned",
    ]);
  });
});
