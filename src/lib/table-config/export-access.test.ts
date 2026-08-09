import { describe, expect, it } from "vitest";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { canActorExport } from "./export-access";

describe("canActorExport", () => {
  it("allows a task.export holder", () => {
    expect(canActorExport([PERMISSIONS.TASK_EXPORT])).toBe(true);
  });

  it("denies a manager permission set without task.export", () => {
    expect(canActorExport([PERMISSIONS.TASK_MANAGE])).toBe(false);
  });

  it("denies empty and undefined permission sets", () => {
    expect(canActorExport([])).toBe(false);
    expect(canActorExport(undefined)).toBe(false);
  });
});
