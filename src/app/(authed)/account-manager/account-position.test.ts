import { describe, expect, it } from "vitest";
import { resolveAccountPosition, type AccountPositionFacts } from "./account-position";

const facts: AccountPositionFacts = {
  rosterEmails: new Set(["khang@example.com", "linh@example.com", "agent@example.com"]),
  assistantAgentsByEmail: new Map([
    ["kay@example.com", ["khang@example.com"]],
    ["helper@example.com", ["agent@example.com"]],
    ["stale@example.com", ["former@example.com"]],
  ]),
  nameByEmail: new Map([
    ["khang@example.com", "Khang Nguyen"],
    ["agent@example.com", "Agent One"],
    ["former@example.com", "Former Agent"],
  ]),
};

function position(email: string, rolePermissionKeys: string[], isActive = true) {
  return resolveAccountPosition({ email, isActive, rolePermissionKeys }, facts);
}

describe("resolveAccountPosition", () => {
  it("labels the people from the user's examples", () => {
    expect(position("Khang@example.com", ["task.manage"]).label).toBe("Admin");
    expect(position("linh@example.com", ["task.manage", "lead.work"]).label).toBe("Admin");
    expect(position("kay@example.com", ["task.manage", "lead.work"]).label).toBe("Admin");
    expect(position("agent@example.com", ["task.work"]).label).toBe("Agent");
    expect(position("helper@example.com", ["task.work"]).label).toBe("Assistant to Agent One");
    expect(position("cs@example.com", ["task.work"]).label).toBe("Customer Service");
    expect(position("pc@example.com", ["customer_registration.pc"]).label).toBeNull();
  });

  it("shows nothing for a disabled account or a disabled role", () => {
    expect(position("cs@example.com", ["task.work"], false)).toEqual({
      kind: null,
      label: null,
      warnings: [],
    });
    // The caller passes [] for a disabled role.
    expect(position("cs@example.com", []).label).toBeNull();
  });

  it("warns about a link to someone who is no longer an Agent", () => {
    const stale = position("stale@example.com", ["task.work"]);
    expect(stale.label).toBe("Assistant to Former Agent");
    expect(stale.warnings).toEqual([
      "Assistant to Former Agent, who is no longer an Agent. Remove the link under Agent membership → Assistant membership.",
    ]);
    expect(position("kay@example.com", ["task.manage"]).warnings).toEqual([]);
  });
});
