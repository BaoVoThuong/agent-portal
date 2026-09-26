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

const { grantsForRoles } = await import("./principal");

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
  // đó cho ai (trần uỷ quyền): thêm ánh xạ vào deriveCompatGrants, hoặc
  // `delegatedBy` nếu đó là grant "thành viên" admin không tự giữ.
  it("không grant nào nằm ngoài tầm Admin", () => {
    const adminGrants = grantsForRoles(
      [
        {
          id: "admin",
          name: "Admin",
          isActive: true,
          permissions: Object.values(PERMISSIONS),
          grants: null,
        },
      ],
      "admin"
    );
    expect(grantsBeyondCeiling(adminGrants, allCatalogGrants())).toEqual([]);
  });
});

describe("projectLegacyPermissions", () => {
  it("worker Task CS chiếu lại đúng permission cũ", () => {
    const grants = deriveCompatGrants({
      permissions: [PERMISSIONS.TASK_WORK, PERMISSIONS.SETTINGS],
      roles: ["Task CS"],
      legacyRole: "agent",
    });
    expect(projectLegacyPermissions(grants)).toEqual(
      [PERMISSIONS.SETTINGS, PERMISSIONS.TASK_WORK].sort()
    );
  });

  it("task admin chiếu ra task.manage (và task.work vì đọc được task)", () => {
    const grants = deriveCompatGrants({
      permissions: [PERMISSIONS.TASK_MANAGE],
      roles: ["Admin Health Task"],
      legacyRole: "agent",
    });
    expect(projectLegacyPermissions(grants)).toEqual(
      expect.arrayContaining([PERMISSIONS.TASK_MANAGE, PERMISSIONS.TASK_WORK])
    );
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
      permissions: projectLegacyPermissions(original),
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
