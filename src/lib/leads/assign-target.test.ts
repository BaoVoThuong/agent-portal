import { describe, expect, it } from "vitest";
import { deriveCompatGrants } from "@/lib/authz/compat";
import { canBeAssignedLead } from "./assign-target";

const base = { isActive: true, permissions: [] as string[], legacyRole: "agent", roles: [] as string[] };

// Role chưa chuyển: grant tương thích từ permission + tên role + cột legacy.
function target(t: typeof base) {
  return {
    isActive: t.isActive,
    grants: deriveCompatGrants({ permissions: t.permissions, roles: t.roles, legacyRole: t.legacyRole }),
  };
}

describe("canBeAssignedLead", () => {
  it("accepts an agent holding lead.work", () => {
    expect(canBeAssignedLead(target({ ...base, permissions: ["lead.work"], roles: ["Agent"] }))).toBe(true);
  });

  // The defect this exists for: buildLeadActor gained an isAdmin flag, but the
  // assign route resolved the target without it. An account-role admin could
  // manage every lead and still be refused as the recipient of one.
  it("accepts an account-role admin with no lead permission granted", () => {
    expect(canBeAssignedLead(target({ ...base, legacyRole: "admin", roles: ["Admin"] }))).toBe(true);
  });

  it("accepts a Super Admin RBAC role", () => {
    expect(canBeAssignedLead(target({ ...base, roles: ["Super Admin"] }))).toBe(true);
  });

  it("refuses a deactivated account even when it holds the permission", () => {
    expect(
      canBeAssignedLead(target({ ...base, isActive: false, permissions: ["lead.manage"], roles: ["Admin"] }))
    ).toBe(false);
  });

  it("refuses someone with no lead permission at all", () => {
    expect(canBeAssignedLead(target({ ...base, permissions: ["task.work"], roles: ["Task CS"] }))).toBe(false);
  });
});

// A guard against the failure that produced this file: buildLeadActor gained an
// isAdmin flag, two routes resolved an assign target with it, and only one was
// updated. The rule must live in exactly one place.
describe("no lead route rebuilds the assign-target rule", () => {
  it("never calls buildLeadActor on a resolved target account", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");

    const root = "src/app/api/leads";
    const routes: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name === "route.ts") routes.push(full);
      }
    };
    walk(root);
    expect(routes.length).toBeGreaterThan(0);

    for (const route of routes) {
      const source = readFileSync(route, "utf8");
      expect(
        source.includes("buildLeadActor(targetAccess.permissions"),
        `${route} builds its own assign-target actor; use canBeAssignedLead()`
      ).toBe(false);
    }
  });
});
