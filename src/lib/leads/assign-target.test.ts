import { describe, expect, it } from "vitest";
import { canBeAssignedLead } from "./assign-target";

const base = { isActive: true, permissions: [] as string[], legacyRole: "agent", roles: [] as string[] };

describe("canBeAssignedLead", () => {
  it("accepts an agent holding lead.work", () => {
    expect(canBeAssignedLead({ ...base, permissions: ["lead.work"], roles: ["Agent"] })).toBe(true);
  });

  // The defect this exists for: buildLeadActor gained an isAdmin flag, but the
  // assign route resolved the target without it. An account-role admin could
  // manage every lead and still be refused as the recipient of one.
  it("accepts an account-role admin with no lead permission granted", () => {
    expect(canBeAssignedLead({ ...base, legacyRole: "admin", roles: ["Admin"] })).toBe(true);
  });

  it("accepts a Super Admin RBAC role", () => {
    expect(canBeAssignedLead({ ...base, roles: ["Super Admin"] })).toBe(true);
  });

  it("refuses a deactivated account even when it holds the permission", () => {
    expect(
      canBeAssignedLead({ ...base, isActive: false, permissions: ["lead.manage"], roles: ["Admin"] })
    ).toBe(false);
  });

  it("refuses someone with no lead permission at all", () => {
    expect(canBeAssignedLead({ ...base, permissions: ["task.work"], roles: ["Task CS"] })).toBe(false);
  });
});
