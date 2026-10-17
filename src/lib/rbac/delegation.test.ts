import { describe, expect, it } from "vitest";
import {
  checkAccountChange,
  checkRolePermissionChange,
  checkMembershipChange,
  permissionsNotHeld,
  rolePatchGrant,
} from "@/lib/rbac/delegation";

const ROLE_MANAGER = ["management.role_manager", "task.work", "settings.access"];
const ACCOUNT_MANAGER = ["management.account_manager", "task.manage", "settings.access"];
const EVERYTHING = [
  "management.account_manager",
  "management.role_manager",
  "task.manage",
  "lead.manage",
  "settings.access",
];

describe("permissionsNotHeld", () => {
  it("counts Manage as holding the Work it includes", () => {
    expect(permissionsNotHeld(["task.manage"], ["task.work"])).toEqual([]);
    expect(permissionsNotHeld(["task.work"], ["task.manage"])).toEqual(["task.manage"]);
  });

  it("does not treat legacy Settings as a delegation ceiling", () => {
    expect(permissionsNotHeld(["management.account_manager"], ["settings.access"])).toEqual([]);
    expect(checkAccountChange({
      actorPermissions: ["management.account_manager"],
      isSelf: false,
      targetPermissionKeys: ["settings.access"],
    })).toEqual({ ok: true });
  });
});

describe("role reactivation", () => {
  it("treats activating a disabled role as granting every stored permission", () => {
    const grant = rolePatchGrant({
      roleIsActive: false,
      nextIsActive: true,
      liveKeys: ["task.manage", "management.account_manager"],
      permissionKeys: null,
    });
    expect(grant).toEqual({
      currentKeys: [],
      nextKeys: ["task.manage", "management.account_manager"],
    });
    expect(checkRolePermissionChange({ actorPermissions: ROLE_MANAGER, ...grant! }).ok).toBe(false);
  });

  it("still allows removing a permission from an active role", () => {
    const grant = rolePatchGrant({
      roleIsActive: true,
      nextIsActive: undefined,
      liveKeys: ["task.manage", "lead.manage"],
      permissionKeys: ["task.manage"],
    });
    expect(checkRolePermissionChange({ actorPermissions: ROLE_MANAGER, ...grant! })).toEqual({ ok: true });
  });
});

describe("membership delegation", () => {
  it("blocks changing your own membership", () => {
    expect(checkMembershipChange({
      actorPermissions: EVERYTHING,
      isSelf: true,
      targetPermissionKeys: [],
    })).toMatchObject({ ok: false, status: 400 });
  });

  it("blocks changing membership for an account above your permission ceiling", () => {
    expect(checkMembershipChange({
      actorPermissions: ACCOUNT_MANAGER,
      isSelf: false,
      targetPermissionKeys: ["management.role_manager"],
    })).toMatchObject({ ok: false, status: 403 });
  });
});

describe("checkRolePermissionChange", () => {
  it("lets you add permissions you hold", () => {
    expect(
      checkRolePermissionChange({
        actorPermissions: ROLE_MANAGER,
        currentKeys: [],
        nextKeys: ["task.work"],
      })
    ).toEqual({ ok: true });
  });

  it("refuses adding a permission you do not hold, naming it", () => {
    const result = checkRolePermissionChange({
      actorPermissions: ROLE_MANAGER,
      currentKeys: [],
      nextKeys: ["management.account_manager"],
    });
    expect(result).toMatchObject({ ok: false, status: 403 });
    if (!result.ok) expect(result.error).toContain("management.account_manager");
  });

  it("always allows removing, even what you do not hold", () => {
    expect(
      checkRolePermissionChange({
        actorPermissions: ROLE_MANAGER,
        currentKeys: ["management.account_manager", "task.work"],
        nextKeys: ["task.work"],
      })
    ).toEqual({ ok: true });
  });
});

describe("checkAccountChange", () => {
  it("refuses touching an account that holds more than you", () => {
    expect(
      checkAccountChange({
        actorPermissions: ACCOUNT_MANAGER,
        isSelf: false,
        targetPermissionKeys: EVERYTHING,
      })
    ).toMatchObject({ ok: false, status: 403 });
  });

  it("lets an all-permissions account manage another all-permissions account", () => {
    expect(
      checkAccountChange({
        actorPermissions: EVERYTHING,
        isSelf: false,
        targetPermissionKeys: EVERYTHING,
        nextRolePermissionKeys: EVERYTHING,
      })
    ).toEqual({ ok: true });
  });

  it("refuses changing your own role", () => {
    expect(
      checkAccountChange({
        actorPermissions: EVERYTHING,
        isSelf: true,
        targetPermissionKeys: EVERYTHING,
        nextRolePermissionKeys: ["task.work"],
      })
    ).toMatchObject({ ok: false, status: 400 });
  });

  it("lets you edit your own name or password (no role change)", () => {
    expect(
      checkAccountChange({
        actorPermissions: ACCOUNT_MANAGER,
        isSelf: true,
        targetPermissionKeys: ACCOUNT_MANAGER,
      })
    ).toEqual({ ok: true });
  });

  it("refuses handing out a role above your own", () => {
    expect(
      checkAccountChange({
        actorPermissions: ACCOUNT_MANAGER,
        isSelf: false,
        targetPermissionKeys: ["task.work"],
        nextRolePermissionKeys: ["task.work", "lead.manage"],
      })
    ).toMatchObject({ ok: false, status: 403 });
  });

  it("lets a task manager hand out a Work-only role", () => {
    expect(
      checkAccountChange({
        actorPermissions: ACCOUNT_MANAGER,
        isSelf: false,
        targetPermissionKeys: [],
        nextRolePermissionKeys: ["task.work", "settings.access"],
      })
    ).toEqual({ ok: true });
  });
});
