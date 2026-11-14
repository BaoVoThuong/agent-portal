import { describe, expect, it } from "vitest";
import {
  expandImpliedPermissions,
  isAssignablePermissionKey,
  normalizeExclusivePermissionKeys,
  permissionImpliedBy,
  PERMISSIONS,
  PERMISSION_DEFINITIONS,
} from "@/lib/rbac/permissions";
import {
  ADMIN_KEYS,
  AUTOMATION_TOOL_KEYS,
  LEVEL_ROWS,
  LINE_ROWS,
  LINE_SCOPES,
  PLACED_PERMISSION_KEYS,
} from "@/lib/rbac/permission-matrix";

describe("slack bot permission", () => {
  it("has its own group outside the permission matrix", () => {
    expect(PERMISSIONS.SLACK_BOT_MANAGE).toBe("slack_bot.manage");
    expect(PERMISSION_DEFINITIONS).toContainEqual(
      expect.objectContaining({ key: "slack_bot.manage", groupKey: "slack_bot", groupLabel: "Slack Bot" }),
    );
    expect(PLACED_PERMISSION_KEYS.has("slack_bot.manage")).toBe(false);
  });
});

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
    expect(PERMISSIONS.LEAD_EXPORT).toBe("lead.export");
    expect(PERMISSIONS.LEAD_IMPORT).toBe("lead.import");
    expect(PERMISSION_DEFINITIONS.filter((d) => d.groupKey === "leads").map((d) => d.key))
      .toEqual(["lead.manage", "lead.work", "lead.export", "lead.import"]);
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

describe("notification alerts", () => {
  // Folded into Account Manager (2026-11-01): no separate key to tick.
  it("has no permission of its own", () => {
    expect(Object.values(PERMISSIONS)).not.toContain("management.notification_alerts");
    expect(PERMISSION_DEFINITIONS.map((permission) => permission.key)).not.toContain("management.notification_alerts");
    expect(isAssignablePermissionKey("management.notification_alerts")).toBe(false);
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
    expect(PERMISSION_DEFINITIONS).toContainEqual(
      expect.objectContaining({ key: "automation.provider_export", label: "Provider List - Export", groupKey: "provider_list" }),
    );
    expect(PERMISSION_DEFINITIONS).toContainEqual(
      expect.objectContaining({ key: "automation.provider_import", label: "Provider List - Import", groupKey: "provider_list" }),
    );
  });

  // Export / Import stand alone (2026-11-01): Manage does not include them.
  it("keeps Export and Import out of Manage-includes-Work", () => {
    expect(expandImpliedPermissions(["automation.provider_manage"])).not.toContain("automation.provider_export");
    expect(expandImpliedPermissions(["lead.manage"])).not.toContain("lead.import");
  });
});

describe("manage includes work", () => {
  it("drops Work when the matching Manage is stored", () => {
    expect(normalizeExclusivePermissionKeys(["task.manage", "task.work"])).toEqual(["task.manage"]);
    expect(
      normalizeExclusivePermissionKeys(["automation.provider_manage", "automation.provider_finder"])
    ).toEqual(["automation.provider_manage"]);
    expect(normalizeExclusivePermissionKeys(["timeoff.admin", "timeoff.user"])).toEqual(["timeoff.admin"]);
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

describe("permission matrix layout", () => {
  it("places only keys that exist in the catalog, each at most once", () => {
    const catalog = new Set<string>(PERMISSION_DEFINITIONS.map((definition) => definition.key));
    const placed = [
      ...LEVEL_ROWS.flatMap((row) => [row.low, row.high, ...(row.extras ?? []).map((extra) => extra.key)]),
      ...AUTOMATION_TOOL_KEYS,
      ...LINE_ROWS.flatMap((row) => row.keys),
      ...Object.values(LINE_SCOPES),
      ...ADMIN_KEYS,
    ];
    expect(placed.filter((key) => !catalog.has(key))).toEqual([]);
    expect(new Set(placed).size).toBe(placed.length);
    expect(PLACED_PERMISSION_KEYS.size).toBe(placed.length);
  });

  it("pairs every level row the way Manage-includes-Work does", () => {
    for (const row of LEVEL_ROWS) expect(normalizeExclusivePermissionKeys([row.high, row.low])).toEqual([row.high]);
  });
});
