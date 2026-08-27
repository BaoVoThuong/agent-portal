import { describe, expect, it } from "vitest";
import { PERMISSIONS, PERMISSION_DEFINITIONS } from "@/lib/rbac/permissions";

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
    expect(PERMISSION_DEFINITIONS.filter((d) => d.groupKey === "leads").map((d) => d.key))
      .toEqual(["lead.manage", "lead.work", "lead.export"]);
  });
});
