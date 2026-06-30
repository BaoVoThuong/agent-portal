import { describe, expect, it } from "vitest";
import { resolveCommentRecipients } from "@/lib/tasks/notifications";

describe("resolveCommentRecipients", () => {
  it("notifies mentioned users (excluding author)", () => {
    const r = resolveCommentRecipients(
      { assignee_email: "cs@x.com" },
      "author@x.com",
      ["a@x.com", "author@x.com"]
    );
    expect(r).toContainEqual({ email: "a@x.com", type: "mentioned" });
    expect(r.find((n) => n.email === "author@x.com")).toBeUndefined();
  });
  it("notifies the assignee with 'commented' when not the author", () => {
    const r = resolveCommentRecipients({ assignee_email: "cs@x.com" }, "mgr@x.com", []);
    expect(r).toEqual([{ email: "cs@x.com", type: "commented" }]);
  });
  it("notifies each assignee with 'commented' when not mentioned", () => {
    const r = resolveCommentRecipients(
      { assignees: ["a@x.com", "b@x.com"] },
      "mgr@x.com",
      []
    );
    expect(r).toEqual([
      { email: "a@x.com", type: "commented" },
      { email: "b@x.com", type: "commented" },
    ]);
  });
  it("does not double-notify: mention wins over commented for the same person", () => {
    const r = resolveCommentRecipients({ assignee_email: "cs@x.com" }, "mgr@x.com", ["cs@x.com"]);
    expect(r).toEqual([{ email: "cs@x.com", type: "mentioned" }]);
  });
  it("no assignee, no mentions -> no notifications", () => {
    expect(resolveCommentRecipients({ assignee_email: null }, "a@x.com", [])).toEqual([]);
  });
  it("author is the assignee -> no 'commented' self-notify", () => {
    expect(resolveCommentRecipients({ assignee_email: "a@x.com" }, "a@x.com", [])).toEqual([]);
  });
});
