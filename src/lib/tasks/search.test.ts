import { describe, expect, it } from "vitest";
import {
  buildSnippet,
  isHitVisible,
  type VisibilityScope,
} from "@/lib/tasks/search";
import { buildTaskActor } from "@/lib/tasks/access";

describe("buildSnippet", () => {
  it("windows around the first match and reports the span", () => {
    const body = "The quick brown fox jumps over the lazy dog again and again";
    const snippet = buildSnippet(body, "fox", 8);

    expect(
      snippet.text
        .slice(snippet.matchStart, snippet.matchStart + snippet.matchLen)
        .toLowerCase()
    ).toBe("fox");
    expect(snippet.text.length).toBeLessThan(body.length);
    expect(snippet.text).toContain("fox");
  });

  it("no match returns the head of the string with a zero-length span", () => {
    const snippet = buildSnippet("hello world", "zzz", 5);

    expect(snippet.matchLen).toBe(0);
    expect(snippet.text.startsWith("hello")).toBe(true);
  });
});

describe("isHitVisible", () => {
  const scope: VisibilityScope = {
    agents: ["agentA@x.com"],
    assistantAgents: ["agentB@x.com"],
    assignedIds: new Set(["t-assigned"]),
    participantIds: new Set(["t-part"]),
    assigneeByTask: new Map([["t-assigned", ["cs@x.com"]]]),
  };
  const cs = buildTaskActor(["task.work"], "cs@x.com");
  const admin = buildTaskActor(["task.manage"], "admin@x.com", {
    isAdmin: true,
  });

  it("admin sees every hit", () => {
    expect(
      isHitVisible(
        admin,
        { task_id: "x", agent_email: "other@x.com", assignee_email: null },
        scope
      )
    ).toBe(true);
  });

  it("worker sees their agent-owner / assisted / assigned / participant hits", () => {
    expect(
      isHitVisible(
        cs,
        { task_id: "t1", agent_email: "agentB@x.com", assignee_email: null },
        scope
      )
    ).toBe(true);
    expect(
      isHitVisible(
        cs,
        { task_id: "t-part", agent_email: "other@x.com", assignee_email: null },
        scope
      )
    ).toBe(true);
  });

  it("worker sees a member-team hit only when the task has an assignee", () => {
    expect(
      isHitVisible(
        cs,
        {
          task_id: "t2",
          agent_email: "agentA@x.com",
          assignee_email: "someone@x.com",
        },
        scope
      )
    ).toBe(true);
    expect(
      isHitVisible(
        cs,
        { task_id: "t3", agent_email: "agentA@x.com", assignee_email: null },
        scope
      )
    ).toBe(false);
  });

  it("worker cannot see an unrelated task hit", () => {
    expect(
      isHitVisible(
        cs,
        {
          task_id: "zzz",
          agent_email: "stranger@x.com",
          assignee_email: "x@x.com",
        },
        scope
      )
    ).toBe(false);
  });
});
