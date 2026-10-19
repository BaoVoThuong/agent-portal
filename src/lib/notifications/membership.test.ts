import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { freshNotificationMembership } from "./membership";

function db(agentEmail: string | null, assistantAgents: string[], fail = false) {
  return {
    from(table: string) {
      if (table === "task_agents") {
        const query = {
          select: () => query,
          eq: () => query,
          maybeSingle: async () => ({
            data: agentEmail ? { email: agentEmail } : null,
            error: fail ? { message: "roster unavailable" } : null,
          }),
        };
        return query;
      }
      const query = {
        select: () => query,
        eq: (_key: string) => {
          if (_key === "is_assistant") return Promise.resolve({
            data: assistantAgents.map((agent_email) => ({ agent_email })),
            error: null,
          });
          return query;
        },
      };
      return query;
    },
  } as unknown as SupabaseClient;
}

describe("freshNotificationMembership", () => {
  it("reads current Agent and Assistant links for each call", async () => {
    expect(await freshNotificationMembership("person@x.com", db(null, ["agent@x.com"])))
      .toEqual({ isSelectedAgent: false, assistantAgentEmails: ["agent@x.com"] });
    expect(await freshNotificationMembership("person@x.com", db(null, [])))
      .toEqual({ isSelectedAgent: false, assistantAgentEmails: [] });
  });

  it("fails closed when the roster cannot be checked", async () => {
    await expect(freshNotificationMembership("person@x.com", db(null, [], true)))
      .rejects.toThrow("roster unavailable");
  });
});
