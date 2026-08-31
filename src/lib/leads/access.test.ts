import { describe, expect, it } from "vitest";
import {
  buildLeadActor,
  canEditLead,
  canLogInteraction,
  canManageLeads,
  canViewLead,
  isLeadViewAdmin,
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

// An Assistant is promoted against an agent in agent_members; the routes
// resolve that pairing and hand it in as a flag, which is what these cover.
describe("assistant membership", () => {
  const assistantFlag = { isOwnerOrAssistant: true };

  it("lets an assistant view, edit and log on their agent's lead", () => {
    expect(canViewLead(agent, theirs, assistantFlag)).toBe(true);
    expect(canEditLead(agent, theirs, assistantFlag)).toBe(true);
    expect(canLogInteraction(agent, theirs, assistantFlag)).toBe(true);
  });

  // The flag only ever widens. Someone with no lead permission at all stays
  // out even if the membership lookup says they assist that agent.
  it("does not let the flag rescue someone with no lead permission", () => {
    expect(canViewLead(outsider, theirs, assistantFlag)).toBe(false);
    expect(canEditLead(outsider, theirs, assistantFlag)).toBe(false);
    expect(canLogInteraction(outsider, theirs, assistantFlag)).toBe(false);
  });

  it("still refuses an unrelated agent when the flag is false", () => {
    expect(canEditLead(agent, theirs, { isOwnerOrAssistant: false })).toBe(false);
  });

  // An unassigned lead has no agent, so there is nobody to assist: an
  // assistant flag on a pool lead would be a bug in the resolver, and the
  // rules must not depend on it never happening.
  it("gives a manager the pool and leaves a worker out of it", () => {
    expect(canEditLead(manager, unassigned)).toBe(true);
    expect(canEditLead(agent, unassigned)).toBe(false);
    expect(canLogInteraction(agent, unassigned, assistantFlag)).toBe(true);
  });
});

describe("account-role admin", () => {
  it("counts the legacy admin role and the super-admin RBAC role", () => {
    expect(isLeadViewAdmin({ role: "admin" })).toBe(true);
    expect(isLeadViewAdmin({ roles: ["Admin"] })).toBe(true);
    expect(isLeadViewAdmin({ roles: ["Super Admin"] })).toBe(true);
    expect(isLeadViewAdmin({ role: "agent", roles: ["Agent"] })).toBe(false);
  });

  // An admin manages leads without lead.manage being granted separately.
  it("makes an admin a lead manager without the permission", () => {
    const admin = buildLeadActor(["lead.work"], "boss@x.com", { isAdmin: true });
    expect(admin.isManager).toBe(true);
    expect(canViewLead(admin, theirs)).toBe(true);
    expect(canEditLead(admin, theirs)).toBe(true);
  });
});
