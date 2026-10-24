import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assistantRows: [] as Array<{ agent_email: string; cs_email: string }>,
  assistantError: null as { message: string } | null,
  personColumns: [] as Array<{ program: string; key: string; label?: string }>,
}));
vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => Promise.resolve({ data: mocks.assistantRows, error: mocks.assistantError }),
      }),
    }),
  }),
}));
vi.mock("./scope", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./scope")>()),
  fetchViewerPersonColumns: () => Promise.resolve(mocks.personColumns),
}));

import {
  agentAssistantEmails,
  enrollmentWatcherEmails,
  loadEnrollmentWatcherContext,
  newPersonColumnPicks,
  personColumnEmails,
} from "./watchers";

beforeEach(() => {
  mocks.assistantRows = [
    { agent_email: "Jennifer@X.com", cs_email: "cheryl@x.com" },
    { agent_email: "jennifer@x.com", cs_email: "huy@x.com" },
    { agent_email: "ann@x.com", cs_email: "ngan@x.com" },
  ];
  mocks.assistantError = null;
  mocks.personColumns = [
    { program: "medicaid", key: "monitor", label: "Monitor" },
    { program: "medicare", key: "caller_2", label: "Caller" },
    { program: "medicare", key: "follow_up", label: "Follow up" },
  ];
});

describe("enrollment watchers", () => {
  it("adds the Agent's Assistants, case-insensitively", async () => {
    const context = await loadEnrollmentWatcherContext();
    expect(agentAssistantEmails({ agent_email: "JENNIFER@x.com" }, context)).toEqual([
      "cheryl@x.com",
      "huy@x.com",
    ]);
    expect(agentAssistantEmails({ agent_email: null }, context)).toEqual([]);
  });

  it("adds the people picked in the record's own program's Person columns", async () => {
    const context = await loadEnrollmentWatcherContext();
    const record = {
      program: "medicare",
      agent_email: "ann@x.com",
      custom_values: { caller_2: "Viewer@X.com", follow_up: "lead@x.com", monitor: "other@x.com" },
    };
    expect(personColumnEmails(record, context)).toEqual(["viewer@x.com", "lead@x.com"]);
    expect(enrollmentWatcherEmails(record, context)).toEqual(["ngan@x.com", "viewer@x.com", "lead@x.com"]);
  });

  it("finds who an edit newly put in a Person column", async () => {
    const context = await loadEnrollmentWatcherContext();
    const before = { program: "medicare", agent_email: null, custom_values: { caller_2: "a@x.com" } };
    const after = {
      program: "medicare",
      agent_email: null,
      custom_values: { caller_2: "a@x.com", follow_up: "B@x.com" },
    };
    expect(newPersonColumnPicks(before, after, context)).toEqual([{ email: "b@x.com", label: "Follow up" }]);
    expect(newPersonColumnPicks(after, after, context)).toEqual([]);
  });

  it("fails loudly when the Assistant roster cannot be read", async () => {
    mocks.assistantError = { message: "db down" };
    await expect(loadEnrollmentWatcherContext()).rejects.toThrow("db down");
  });
});
