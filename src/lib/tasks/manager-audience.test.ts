import { describe, expect, it } from "vitest";
import { managerRecipientsForCase } from "@/lib/tasks/manager-audience";

const MANAGERS = ["bao@x.com", "nam@x.com", "khang@x.com", "linh@x.com"];
const AGENTS = ["khang@x.com", "linh@x.com", "agent-only@x.com"];

describe("managerRecipientsForCase", () => {
  it("sends every case to managers who are not Agents", () => {
    expect(
      managerRecipientsForCase({
        managerEmails: MANAGERS,
        agentEmails: AGENTS,
        caseAgentEmail: "agent-only@x.com",
      })
    ).toEqual(["bao@x.com", "nam@x.com"]);
  });

  it("adds a manager who is also an Agent only on their own case", () => {
    expect(
      managerRecipientsForCase({
        managerEmails: MANAGERS,
        agentEmails: AGENTS,
        caseAgentEmail: "linh@x.com",
      })
    ).toEqual(["bao@x.com", "nam@x.com", "linh@x.com"]);
  });

  it("keeps Agent-managers out of a case with no Agent", () => {
    expect(
      managerRecipientsForCase({
        managerEmails: MANAGERS,
        agentEmails: AGENTS,
        caseAgentEmail: null,
      })
    ).toEqual(["bao@x.com", "nam@x.com"]);
  });

  it("matches emails regardless of case and spaces, and dedupes", () => {
    expect(
      managerRecipientsForCase({
        managerEmails: ["Bao@X.com ", "bao@x.com", "KHANG@x.com", ""],
        agentEmails: [" khang@X.COM"],
        caseAgentEmail: "Khang@x.com",
      })
    ).toEqual(["bao@x.com", "khang@x.com"]);
  });

  it("returns nothing when nobody manages tasks", () => {
    expect(
      managerRecipientsForCase({ managerEmails: [], agentEmails: AGENTS, caseAgentEmail: "linh@x.com" })
    ).toEqual([]);
  });
});
