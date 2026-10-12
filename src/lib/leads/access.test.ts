import { describe, expect, it } from "vitest";
import {
  buildLeadActor,
  canEditLead,
  canLogInteraction,
  canManageLeads,
  canViewLead,
  personalLeadAgentEmailsForWorker,
} from "./access";
import type { LeadRow } from "./types";

const manager = buildLeadActor(["lead.manage"], "mgr@x.com");
const agent = buildLeadActor(["lead.work"], "cs@x.com");
const taskManager = buildLeadActor(["task.manage"], "task-manager@x.com");
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

  it("lets a listed collaborator view, edit and log without changing the assigned agent", () => {
    const lead = {
      assigned_to_email: "agent@x.com",
      collaborator_emails: ["cs@x.com"],
    } as LeadRow;
    expect(canViewLead(agent, lead)).toBe(true);
    expect(canEditLead(agent, lead)).toBe(true);
    expect(canLogInteraction(agent, lead)).toBe(true);
    expect(lead.assigned_to_email).toBe("agent@x.com");
  });

  // No cross-module grant: task.manage is a Task permission and opens nothing
  // in Lead (it used to show every lead).
  it("gives task.manage no lead access at all", () => {
    expect(taskManager.isWorker).toBe(false);
    expect(canViewLead(taskManager, theirs)).toBe(false);
    expect(canViewLead(taskManager, unassigned)).toBe(false);
    expect(canEditLead(taskManager, theirs)).toBe(false);
    expect(canManageLeads(taskManager)).toBe(false);
  });

  it("locks out anyone without a lead permission", () => {
    expect(canViewLead(outsider, mine)).toBe(false);
    expect(canManageLeads(outsider)).toBe(false);
  });

  // Logging reaches as far as editing. It used to exclude a manager who was
  // not the assigned agent; that just pushed a manager covering for someone on
  // leave outside the system, and every interaction row records actor_email so
  // who made the call is never lost.
  it("agent logs on their own lead, manager logs on any", () => {
    expect(canLogInteraction(agent, mine)).toBe(true);
    expect(canLogInteraction(agent, theirs)).toBe(false);
    expect(canLogInteraction(manager, theirs)).toBe(true);
    expect(canLogInteraction(manager, unassigned)).toBe(true);
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

// Lead access follows the Lead ticks only. Until 2026-10-09 an admin-named
// account was a manager without lead.manage, and task.manage saw every lead.
describe("only lead permissions grant lead access", () => {
  it("lead.manage is the manager and includes work", () => {
    expect(manager.isManager).toBe(true);
    expect(manager.isWorker).toBe(true);
  });

  it("lead.work without lead.manage is not a manager, whatever the role is called", () => {
    const worker = buildLeadActor(["lead.work"], "boss@x.com");
    expect(worker.isManager).toBe(false);
    expect(canViewLead(worker, theirs)).toBe(false);
  });
});

// Agent / Assistant add Personal leads: the lead belongs to themselves (Agent)
// or to the Agent they assist (Assistant). This is the list the create route
// enforces, so an empty result is "may not add a lead at all".
describe("personal lead agents for a worker", () => {
  const roster = ["agent-a@x.com", "agent-b@x.com", "cs@x.com"];

  it("gives an Agent only themselves", () => {
    expect(
      personalLeadAgentEmailsForWorker({
        actorEmail: "agent-a@x.com",
        rosterEmails: roster,
        assistedAgentEmails: [],
      }),
    ).toEqual(["agent-a@x.com"]);
  });

  it("gives an Assistant the Agent they assist, not themselves", () => {
    expect(
      personalLeadAgentEmailsForWorker({
        actorEmail: "assistant@x.com",
        rosterEmails: roster,
        assistedAgentEmails: ["agent-a@x.com"],
      }),
    ).toEqual(["agent-a@x.com"]);
  });

  it("offers every Agent an Assistant covers, and puts an Agent's own seat first", () => {
    expect(
      personalLeadAgentEmailsForWorker({
        actorEmail: "agent-b@x.com",
        rosterEmails: roster,
        assistedAgentEmails: ["agent-a@x.com", "agent-b@x.com"],
      }),
    ).toEqual(["agent-b@x.com", "agent-a@x.com"]);
  });

  it("drops an assisted Agent who is no longer on the roster", () => {
    expect(
      personalLeadAgentEmailsForWorker({
        actorEmail: "assistant@x.com",
        rosterEmails: roster,
        assistedAgentEmails: ["agent-a@x.com", "gone@x.com"],
      }),
    ).toEqual(["agent-a@x.com"]);
  });

  it("is empty for someone who is neither an Agent nor an Assistant", () => {
    expect(
      personalLeadAgentEmailsForWorker({
        actorEmail: "plain-cs@x.com",
        rosterEmails: roster,
        assistedAgentEmails: [],
      }),
    ).toEqual([]);
  });

  it("matches emails case-insensitively", () => {
    expect(
      personalLeadAgentEmailsForWorker({
        actorEmail: "Agent-A@X.com",
        rosterEmails: ["AGENT-A@x.com"],
        assistedAgentEmails: [],
      }),
    ).toEqual(["agent-a@x.com"]);
  });
});
