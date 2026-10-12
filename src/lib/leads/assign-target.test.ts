import { describe, expect, it } from "vitest";
import { canBeAssignedLead } from "./assign-target";

const base = { isActive: true, permissions: [] as string[] };

describe("canBeAssignedLead", () => {
  it("accepts an agent holding lead.work", () => {
    expect(canBeAssignedLead({ ...base, permissions: ["lead.work"] })).toBe(true);
  });

  it("accepts a lead manager (manage includes work)", () => {
    expect(canBeAssignedLead({ ...base, permissions: ["lead.manage"] })).toBe(true);
  });

  it("refuses a deactivated account even when it holds the permission", () => {
    expect(
      canBeAssignedLead({ ...base, isActive: false, permissions: ["lead.manage"] })
    ).toBe(false);
  });

  // No cross-module grant: Task permissions never make someone a lead recipient.
  it("refuses someone with only task permissions", () => {
    expect(canBeAssignedLead({ ...base, permissions: ["task.work"] })).toBe(false);
    expect(canBeAssignedLead({ ...base, permissions: ["task.manage"] })).toBe(false);
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
