import { describe, expect, it } from "vitest";
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
