import { describe, expect, it } from "vitest";
import {
  accountConfigEffects,
  accountConfigProblem,
  buildAccountConfigPatch,
  canBeAssistant,
  changesMembership,
  parseAccountConfigRequest,
  type AccountConfig,
} from "./account-config";
import type { PositionKind } from "./positions";

const AGENT = "11111111-1111-4111-8111-111111111111";
const ASSISTANT = "22222222-2222-4222-8222-222222222222";
const CS = "33333333-3333-4333-8333-333333333333";
const MANAGER = "44444444-4444-4444-8444-444444444444";
const KINDS: Record<string, PositionKind> = { [AGENT]: "agent", [ASSISTANT]: "assistant", [CS]: "cs" };
const kindOf = (id: string | null) => (id ? KINDS[id] ?? null : null);

const cheryl: AccountConfig = {
  positionId: ASSISTANT,
  managerId: null,
  assistedAgentEmails: ["que@x.com", "phi@x.com"],
};

describe("buildAccountConfigPatch", () => {
  it("sends nothing when nothing changed, even if the Agents come back in another order", () => {
    expect(
      buildAccountConfigPatch(cheryl, { ...cheryl, assistedAgentEmails: ["PHI@x.com ", "que@x.com"] }, kindOf),
    ).toEqual({});
  });

  it("sends only the manager plus the loaded snapshot when only the manager changes", () => {
    expect(buildAccountConfigPatch(cheryl, { ...cheryl, managerId: MANAGER }, kindOf)).toEqual({
      manager_id: MANAGER,
      expected: { position_id: ASSISTANT, manager_id: null, assisted_agent_emails: ["phi@x.com", "que@x.com"] },
    });
  });

  it("sends the full Agent list when an Assistant's Agents change", () => {
    const patch = buildAccountConfigPatch(cheryl, { ...cheryl, assistedAgentEmails: ["que@x.com", "tri@x.com"] }, kindOf);
    expect(patch.assisted_agent_emails).toEqual(["que@x.com", "tri@x.com"]);
    expect(patch.position_id).toBeUndefined();
    expect(changesMembership(patch)).toBe(true);
  });

  it("leaving the Assistant group sends the Position only; the database drops the links", () => {
    const patch = buildAccountConfigPatch(cheryl, { positionId: CS, managerId: null, assistedAgentEmails: [] }, kindOf);
    expect(patch).toMatchObject({ position_id: CS });
    expect(patch.assisted_agent_emails).toBeUndefined();
  });

  it("a manager-only change does not count as a membership change", () => {
    expect(changesMembership(buildAccountConfigPatch(cheryl, { ...cheryl, managerId: MANAGER }, kindOf))).toBe(false);
  });
});

describe("accountConfigProblem", () => {
  it("an Assistant needs at least one Agent", () => {
    expect(accountConfigProblem({ positionId: ASSISTANT, managerId: null, assistedAgentEmails: [] }, kindOf)).not.toBeNull();
    expect(accountConfigProblem(cheryl, kindOf)).toBeNull();
    expect(accountConfigProblem({ positionId: CS, managerId: null, assistedAgentEmails: [] }, kindOf)).toBeNull();
  });
});

describe("accountConfigEffects", () => {
  const nameOfEmail = (email: string) => email.split("@")[0];

  it("warns that an Agent's Assistants lose access when the Agent leaves the list", () => {
    const effects = accountConfigEffects({
      personName: "Tri",
      current: { positionId: AGENT, managerId: null, assistedAgentEmails: [] },
      next: { positionId: CS, managerId: null, assistedAgentEmails: [] },
      kindOf,
      assistantNames: ["Lucy"],
      nameOfEmail,
    });
    expect(effects).toEqual([
      "Tri leaves the Agent list. Lucy will no longer assist them and lose access to their tasks, leads and enrollments.",
    ]);
  });

  it("lists the Agents added and removed for an Assistant", () => {
    const effects = accountConfigEffects({
      personName: "Cheryl",
      current: cheryl,
      next: { ...cheryl, assistedAgentEmails: ["que@x.com", "tri@x.com"] },
      kindOf,
      assistantNames: [],
      nameOfEmail,
    });
    expect(effects).toEqual(["Cheryl starts assisting tri.", "Cheryl stops assisting phi."]);
  });

  it("says nothing when the save leaves membership alone", () => {
    expect(
      accountConfigEffects({ personName: "Cheryl", current: cheryl, next: { ...cheryl, managerId: MANAGER }, kindOf, assistantNames: [], nameOfEmail }),
    ).toEqual([]);
  });
});

describe("parseAccountConfigRequest", () => {
  it("accepts ids, nulls and an email list, lower-cased and de-duplicated", () => {
    expect(
      parseAccountConfigRequest({
        positionId: ASSISTANT,
        managerId: null,
        assistedAgentEmails: ["B@x.com", "b@x.com ", "a@x.com"],
        expected: { position_id: null, manager_id: MANAGER, assisted_agent_emails: [] },
      }),
    ).toEqual({
      ok: true,
      patch: {
        position_id: ASSISTANT,
        manager_id: null,
        assisted_agent_emails: ["a@x.com", "b@x.com"],
        expected: { position_id: null, manager_id: MANAGER, assisted_agent_emails: [] },
      },
    });
  });

  it("rejects malformed ids and lists before they reach SQL", () => {
    expect(parseAccountConfigRequest({ positionId: "not-a-uuid" }).ok).toBe(false);
    expect(parseAccountConfigRequest({ managerId: 5 }).ok).toBe(false);
    expect(parseAccountConfigRequest({ assistedAgentEmails: "a@x.com" }).ok).toBe(false);
    expect(parseAccountConfigRequest({ expected: { position_id: "x" } }).ok).toBe(false);
  });

  it("leaves keys the request did not send out of the patch", () => {
    expect(parseAccountConfigRequest({})).toEqual({ ok: true, patch: {} });
  });
});

describe("accountConfigEffects with Task access", () => {
  const nameOfEmail = (email: string) => email.split("@")[0];
  const none: AccountConfig = { positionId: null, managerId: null, assistedAgentEmails: [] };

  it("a plain CS worker who becomes an Agent loses the company queue and the CS pool", () => {
    expect(
      accountConfigEffects({
        personName: "Ann",
        current: none,
        next: { ...none, positionId: AGENT },
        kindOf,
        assistantNames: [],
        nameOfEmail,
        access: { taskAccess: "work", csPoolBase: true },
      }),
    ).toEqual([
      "Ann joins the Agent list.",
      "Ann will see only their own tasks and enrollments instead of the whole company task queue.",
      "Ann stops receiving auto-assigned CS tasks.",
    ]);
  });

  it("an Assistant who stops assisting sees the company queue and joins the CS pool when their queue is on", () => {
    expect(
      accountConfigEffects({
        personName: "Cheryl",
        current: cheryl,
        next: { ...none },
        kindOf,
        assistantNames: [],
        nameOfEmail,
        access: { taskAccess: "work", csPoolBase: true },
      }),
    ).toEqual([
      "Cheryl stops assisting phi, que.",
      "Cheryl will see the whole company task queue instead of only their Agents' tasks and enrollments.",
      "Cheryl starts receiving auto-assigned CS tasks.",
    ]);
  });

  it("a manager keeps seeing every task but Agent status changes their notifications", () => {
    expect(
      accountConfigEffects({
        personName: "Linh",
        current: { ...none, positionId: AGENT },
        next: { ...none, positionId: CS },
        kindOf,
        assistantNames: [],
        nameOfEmail,
        access: { taskAccess: "manage", csPoolBase: false },
      }),
    ).toEqual(["Linh leaves the Agent list.", "Linh will get manager notifications for every case again."]);
  });

  it("moving between positions outside the Agent and Assistant groups changes nothing", () => {
    expect(
      accountConfigEffects({
        personName: "Ann",
        current: none,
        next: { ...none, positionId: CS },
        kindOf,
        assistantNames: [],
        nameOfEmail,
        access: { taskAccess: "work", csPoolBase: true },
      }),
    ).toEqual([]);
  });

  it("someone without Task access gets no Task scope or CS pool lines", () => {
    expect(
      accountConfigEffects({
        personName: "Jackie",
        current: none,
        next: { ...none, positionId: AGENT },
        kindOf,
        assistantNames: [],
        nameOfEmail,
        access: { taskAccess: "none", csPoolBase: false },
      }),
    ).toEqual(["Jackie joins the Agent list."]);
  });
});

describe("canBeAssistant", () => {
  it("matches the old tab: only Task workers could be Assistants", () => {
    expect(canBeAssistant("work")).toBe(true);
    expect(canBeAssistant("manage")).toBe(true);
    expect(canBeAssistant("none")).toBe(false);
  });
});
