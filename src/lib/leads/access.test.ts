import { describe, expect, it } from "vitest";
import {
  buildLeadActor,
  canLogInteraction,
  canManageLeads,
  canViewLead,
} from "./access";
import type { LeadRow } from "./types";

const manager = buildLeadActor(["lead.manage"], "mgr@x.com");
const agent = buildLeadActor(["lead.work"], "cs@x.com");
const outsider = buildLeadActor(["task.work"], "other@x.com");

const mine = { assigned_to_email: "cs@x.com" } as LeadRow;
const theirs = { assigned_to_email: "someone@x.com" } as LeadRow;
const unassigned = { assigned_to_email: null } as LeadRow;

describe("lead access", () => {
  it("manager sees every lead", () => {
    expect(canViewLead(manager, theirs)).toBe(true);
    expect(canViewLead(manager, unassigned)).toBe(true);
  });

  it("agent sees only their own", () => {
    expect(canViewLead(agent, mine)).toBe(true);
    expect(canViewLead(agent, theirs)).toBe(false);
    expect(canViewLead(agent, unassigned)).toBe(false);
  });

  it("matches the owner case-insensitively", () => {
    expect(canViewLead(agent, { assigned_to_email: "CS@X.COM" } as LeadRow)).toBe(true);
  });

  it("locks out anyone without a lead permission", () => {
    expect(canViewLead(outsider, mine)).toBe(false);
    expect(canManageLeads(outsider)).toBe(false);
  });

  it("only the owning agent logs interactions", () => {
    expect(canLogInteraction(agent, mine)).toBe(true);
    expect(canLogInteraction(manager, theirs)).toBe(false);
    expect(canLogInteraction(manager, { assigned_to_email: "mgr@x.com" } as LeadRow)).toBe(true);
  });
});
