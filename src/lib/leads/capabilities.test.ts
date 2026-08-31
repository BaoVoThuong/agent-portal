import { describe, expect, it } from "vitest";
import { buildLeadActor } from "./access";
import { leadIsInScope, resolveLeadCapabilities } from "./capabilities";
import { resolveLeadOwnerEmails } from "./membership";
import type { LeadRow } from "./types";

const manager = buildLeadActor(["lead.manage"], "mgr@x.com");
const agent = buildLeadActor(["lead.work"], "cs@x.com");
const mine = { assigned_to_email: "cs@x.com" } as LeadRow;
const theirs = { assigned_to_email: "someone@x.com" } as LeadRow;
const unassigned = { assigned_to_email: null } as LeadRow;

describe("resolveLeadCapabilities", () => {
  it("manager: everything, on any lead", () => {
    expect(resolveLeadCapabilities(manager, theirs)).toEqual({
      canView: true, canEdit: true, canLog: true, canAssign: true,
    });
  });

  it("agent on their own lead: view, edit and log — but no assigning", () => {
    expect(resolveLeadCapabilities(agent, mine)).toEqual({
      canView: true, canEdit: true, canLog: true, canAssign: false,
    });
  });

  it("agent on someone else's lead: nothing", () => {
    expect(resolveLeadCapabilities(agent, theirs)).toEqual({
      canView: false, canEdit: false, canLog: false, canAssign: false,
    });
  });

  it("the assistant flag unlocks exactly what owning the lead would", () => {
    expect(resolveLeadCapabilities(agent, theirs, { isOwnerOrAssistant: true })).toEqual(
      resolveLeadCapabilities(agent, mine)
    );
  });
});

// The client cannot build a LeadActor, so it reads the resolved owner list
// instead. These two paths answer the same question and must not disagree.
describe("leadIsInScope agrees with canEdit", () => {
  it("manager: null scope, everything in", () => {
    expect(leadIsInScope(theirs, null)).toBe(true);
    expect(leadIsInScope(unassigned, null)).toBe(true);
  });

  // canLog and canEdit currently agree by rule, not by coincidence — the client
  // reads one scope list for both, so a divergence would silently mis-render.
  it("canLog and canEdit agree for every actor on every lead", () => {
    for (const actor of [manager, agent]) {
      for (const lead of [mine, theirs, unassigned]) {
        const caps = resolveLeadCapabilities(actor, lead);
        expect(caps.canLog).toBe(caps.canEdit);
      }
    }
  });

  it("worker: matches canEdit for their own lead and for another's", () => {
    const scope = ["cs@x.com"];
    expect(leadIsInScope(mine, scope)).toBe(resolveLeadCapabilities(agent, mine).canEdit);
    expect(leadIsInScope(theirs, scope)).toBe(resolveLeadCapabilities(agent, theirs).canEdit);
  });

  it("an assisted agent's lead is in scope, matching the flagged capability", () => {
    const scope = ["cs@x.com", "someone@x.com"];
    expect(leadIsInScope(theirs, scope)).toBe(
      resolveLeadCapabilities(agent, theirs, { isOwnerOrAssistant: true }).canEdit
    );
  });

  // An unassigned lead belongs to nobody, so no worker scope can contain it.
  it("never puts a pool lead in a worker's scope", () => {
    expect(leadIsInScope(unassigned, ["cs@x.com", ""])).toBe(false);
  });
});

describe("resolveLeadOwnerEmails", () => {
  it("returns null for a manager so the query stays unfiltered", async () => {
    await expect(resolveLeadOwnerEmails(manager)).resolves.toBeNull();
  });
});
