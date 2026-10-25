import { describe, expect, it } from "vitest";
import { newTaskAgentScope } from "./new-task-agent";

const roster = ["agent@x.com", "other@x.com", "third@x.com"];

describe("newTaskAgentScope", () => {
  it("lets a manager pick any Agent, starting empty", () => {
    expect(
      newTaskAgentScope({ isManager: true, currentEmail: "boss@x.com", agentEmails: roster, assistedAgentEmails: [] }),
    ).toEqual({ agentEmails: roster, defaultAgentEmail: "", locked: false });
  });

  it("starts an Agent on themselves and locks it", () => {
    expect(
      newTaskAgentScope({ isManager: false, currentEmail: "agent@x.com", agentEmails: roster, assistedAgentEmails: [] }),
    ).toEqual({ agentEmails: ["agent@x.com"], defaultAgentEmail: "agent@x.com", locked: true });
  });

  it("lets an Agent who also assists others pick among them, still starting on themselves", () => {
    expect(
      newTaskAgentScope({ isManager: false, currentEmail: "agent@x.com", agentEmails: roster, assistedAgentEmails: ["other@x.com"] }),
    ).toEqual({ agentEmails: ["agent@x.com", "other@x.com"], defaultAgentEmail: "agent@x.com", locked: false });
  });

  it("fills and locks the only Agent an Assistant covers", () => {
    expect(
      newTaskAgentScope({ isManager: false, currentEmail: "cheryl@x.com", agentEmails: roster, assistedAgentEmails: ["other@x.com"] }),
    ).toEqual({ agentEmails: ["other@x.com"], defaultAgentEmail: "other@x.com", locked: true });
  });

  it("makes an Assistant of several Agents choose", () => {
    expect(
      newTaskAgentScope({ isManager: false, currentEmail: "cheryl@x.com", agentEmails: roster, assistedAgentEmails: ["other@x.com", "third@x.com"] }),
    ).toEqual({ agentEmails: ["other@x.com", "third@x.com"], defaultAgentEmail: "", locked: false });
  });
});
