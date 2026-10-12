import { beforeEach, describe, expect, it, vi } from "vitest";
import { groupAssistantMembers } from "./membership";

describe("groupAssistantMembers", () => {
  it("groups cs_email by agent_email, dedupes, and includes empty agents", () => {
    const rows = [
      { agent_email: "a@x", cs_email: "c1@x" },
      { agent_email: "a@x", cs_email: "c1@x" },
      { agent_email: "a@x", cs_email: "c2@x" },
      { agent_email: "b@x", cs_email: "c3@x" },
    ];

    expect(groupAssistantMembers(rows, ["a@x", "b@x", "z@x"])).toEqual({
      "a@x": ["c1@x", "c2@x"],
      "b@x": ["c3@x"],
      "z@x": [],
    });
  });
});

// A query failure here must never be mistaken for "this actor has no assistant
// rows", because actorSeesAllTasks reads an empty list as proof of plain-CS and
// opens the whole company queue.
describe("membership lookups fail closed", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  async function loadWith(
    agentMembersError: { message: string } | null,
    data: unknown[] = [],
  ) {
    const state = { error: agentMembersError, data };
    const builder = {
      select: () => builder,
      eq: () => builder,
      then: (resolve: (v: { data: unknown[]; error: unknown }) => void) =>
        resolve({ data: state.data, error: state.error }),
    };
    vi.doMock("@/lib/supabase", () => ({
      getSupabaseAdmin: () => ({ from: () => builder }),
    }));
    vi.doMock("./assignees", () => ({
      TASK_MEMBERSHIP_REUSE_MS: 60_000,
      fetchSelectedAgentEmails: vi.fn(async () => new Set<string>()),
      invalidateSelectedAgentEmails: vi.fn(),
    }));
    return Object.assign(await import("./membership"), { state });
  }

  it("throws instead of reporting no assistant rows", async () => {
    const mod = await loadWith({ message: "schema cache miss" });
    await expect(mod.fetchAssistantAgentsForCs("cs@x.com")).rejects.toThrow(
      "schema cache miss"
    );
  });

  it("does not hand the company queue to an actor whose lookup failed", async () => {
    const mod = await loadWith({ message: "statement timeout" });
    await expect(
      mod.actorSeesAllTasks({
        email: "assistant@x.com",
        isManager: false,
        isWorker: true,
      })
    ).rejects.toThrow("statement timeout");
  });

  it("still resolves normally when the lookup succeeds", async () => {
    const mod = await loadWith(null);
    await expect(mod.fetchAssistantAgentsForCs("cs@x.com")).resolves.toEqual([]);
  });

  // Lookups are shared across requests; a failure must not be what is shared.
  it("reads again after a failed lookup instead of reusing it", async () => {
    const mod = await loadWith({ message: "statement timeout" });
    await expect(mod.fetchAgentsForCs("cs@x.com")).resolves.toEqual([]);

    mod.state.error = null;
    mod.state.data = [{ agent_email: "agent@x.com" }];
    await expect(mod.fetchAssistantAgentsForCs("cs@x.com")).resolves.toEqual([
      "agent@x.com",
    ]);
  });

  it("reads again after an admin change invalidates the lookups", async () => {
    const mod = await loadWith(null, [{ agent_email: "old@x.com" }]);
    await expect(mod.fetchAgentsForCs("cs@x.com")).resolves.toEqual(["old@x.com"]);

    mod.state.data = [{ agent_email: "new@x.com" }];
    await expect(mod.fetchAgentsForCs("cs@x.com")).resolves.toEqual(["old@x.com"]);
    mod.invalidateTaskMembershipLookups();
    await expect(mod.fetchAgentsForCs("cs@x.com")).resolves.toEqual(["new@x.com"]);
  });
});
