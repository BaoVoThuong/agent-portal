import { describe, expect, it } from "vitest";
import {
  expandImpliedPermissions,
  isAssignablePermissionKey,
  normalizeExclusivePermissionKeys,
  permissionImpliedBy,
  PERMISSIONS,
  PERMISSION_DEFINITIONS,
} from "@/lib/rbac/permissions";

describe("personal Settings", () => {
  it("does not offer the retired Settings permission for role assignment", () => {
    expect(Object.values(PERMISSIONS)).not.toContain("settings.access");
    expect(PERMISSION_DEFINITIONS.map((permission) => permission.key)).not.toContain("settings.access");
    expect(isAssignablePermissionKey("settings.access")).toBe(false);
    expect(isAssignablePermissionKey("task.work")).toBe(true);
  });
});

describe("task permissions", () => {
  it("declares the two task permission keys", () => {
    expect(PERMISSIONS.TASK_MANAGE).toBe("task.manage");
    expect(PERMISSIONS.TASK_WORK).toBe("task.work");
  });

  it("has a definition for each task key in the Tasks group", () => {
    const keys = PERMISSION_DEFINITIONS.filter(
      (d) => d.groupKey === "tasks"
    ).map((d) => d.key);
    expect(keys).toContain("task.manage");
    expect(keys).toContain("task.work");
  });
});

describe("lead permissions", () => {
  it("declares all lead permission keys and definitions", () => {
    expect(PERMISSIONS.LEAD_MANAGE).toBe("lead.manage");
    expect(PERMISSIONS.LEAD_WORK).toBe("lead.work");
    expect(PERMISSION_DEFINITIONS.filter((d) => d.groupKey === "leads").map((d) => d.key))
      .toEqual(["lead.manage", "lead.work"]);
  });
});

describe("time-off permissions", () => {
  it("keeps user and admin access separate", () => {
    expect(PERMISSIONS.TIME_OFF_USER).toBe("timeoff.user");
    expect(PERMISSIONS.TIME_OFF_ADMIN).toBe("timeoff.admin");
    expect(PERMISSION_DEFINITIONS.filter((d) => d.groupKey === "time_off").map((d) => d.key))
      .toEqual(["timeoff.user", "timeoff.admin"]);
  });
});

describe("notification alert permissions", () => {
  it("declares the management permission and definition", () => {
    expect(PERMISSIONS.NOTIFICATION_ALERTS).toBe("management.notification_alerts");
    expect(PERMISSION_DEFINITIONS).toContainEqual(
      expect.objectContaining({
        key: "management.notification_alerts",
        groupKey: "management",
        sortOrder: 150,
      }),
    );
  });
});

describe("provider permissions", () => {
  it("puts Provider List Work / Manage in their own group, Manage first", () => {
    expect(PERMISSIONS.AUTOMATION_PROVIDER_FINDER).toBe("automation.provider_finder");
    expect(PERMISSIONS.AUTOMATION_PROVIDER_MANAGE).toBe("automation.provider_manage");
    expect(PERMISSION_DEFINITIONS).toContainEqual(
      expect.objectContaining({ key: "automation.provider_manage", label: "Provider List - Manage", groupKey: "provider_list", sortOrder: 100 }),
    );
    expect(PERMISSION_DEFINITIONS).toContainEqual(
      expect.objectContaining({ key: "automation.provider_finder", label: "Provider List - Work", groupKey: "provider_list", sortOrder: 200 }),
    );
  });
});

describe("manage includes work", () => {
  it("drops Work when the matching Manage is stored", () => {
    expect(normalizeExclusivePermissionKeys(["task.manage", "task.work"])).toEqual(["task.manage"]);
    expect(
      normalizeExclusivePermissionKeys(["automation.provider_manage", "automation.provider_finder"])
    ).toEqual(["automation.provider_manage"]);
    expect(normalizeExclusivePermissionKeys(["lead.manage", "lead.work", "x"]).sort()).toEqual(
      ["lead.manage", "x"]
    );
  });

  it("keeps Work on its own", () => {
    expect(normalizeExclusivePermissionKeys(["task.work"])).toEqual(["task.work"]);
  });

  it("expands Manage to the Work it includes when comparing", () => {
    expect(expandImpliedPermissions(["task.manage"])).toContain("task.work");
    expect(expandImpliedPermissions(["lead.manage"])).toContain("lead.work");
    expect(permissionImpliedBy("task.work")).toBe("task.manage");
    expect(permissionImpliedBy("task.manage")).toBeNull();
  });
});

describe("registration view-all", () => {
  it("is a Customer Registration permission, separate from the dashboard one", () => {
    expect(PERMISSIONS.CUSTOMER_REGISTRATION_VIEW_ALL).toBe("customer_registration.view_all");
    expect(PERMISSION_DEFINITIONS).toContainEqual(
      expect.objectContaining({
        key: "customer_registration.view_all",
        groupKey: "customer_registration",
      }),
    );
  });
});
