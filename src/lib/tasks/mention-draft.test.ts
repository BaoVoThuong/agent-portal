import { describe, expect, it } from "vitest";
import {
  decodeMentions,
  diffMentionEmails,
  encodeMentions,
  filterMentionCandidates,
  findActiveMention,
  rebaseMentions,
} from "@/lib/tasks/mention-draft";

const roster = [
  { email: "bao@x.com", name: "Võ Thương Bảo" },
  { email: "do@x.com", name: "Đỗ Minh" },
  { email: "bao2@x.com", name: "Bảo Trân" },
];

describe("mention search", () => {
  it("matches Vietnamese names typed without accents", () => {
    expect(filterMentionCandidates(roster, "bao").map((m) => m.email)).toEqual([
      "bao@x.com",
      "bao2@x.com",
    ]);
  });

  it("matches đ typed as d", () => {
    expect(filterMentionCandidates(roster, "do").map((m) => m.email)).toEqual([
      "do@x.com",
    ]);
  });

  it("matches on email internally without making email the visible label", () => {
    expect(filterMentionCandidates(roster, "bao2@").map((m) => m.email)).toEqual([
      "bao2@x.com",
    ]);
  });
});

describe("mention identity", () => {
  it("survives text edited around an existing tag", () => {
    const stored = "hi @[Võ Thương Bảo](bao@x.com) please check";
    const draft = decodeMentions(stored);
    const rewritten = {
      ...draft,
      text: draft.text.replace("please check", "check this now"),
    };
    expect(encodeMentions(rewritten)).toContain("@[Võ Thương Bảo](bao@x.com)");
  });

  it("does not turn arbitrary @text into a tag", () => {
    const draft = { text: "ping @nobody", mentions: [] };
    expect(encodeMentions(draft)).toBe("ping @nobody");
  });

  it("reports only newly added emails so only they get notified", () => {
    expect(diffMentionEmails(["a@x.com"], ["a@x.com", "b@x.com"])).toEqual([
      "b@x.com",
    ]);
  });

  it("drops only a mention whose visible token was edited", () => {
    const draft = decodeMentions("@Võ Thương Bảo please");
    const next = "@Võ Bảo please";
    const rebased = rebaseMentions(draft.text, next, draft.mentions);
    expect(encodeMentions({ text: next, mentions: rebased })).toBe(next);
  });
});

describe("findActiveMention", () => {
  it("detects the token under the caret", () => {
    expect(findActiveMention("hi @ba", 6)).toMatchObject({ query: "ba" });
  });

  it("ignores an email address already typed", () => {
    expect(findActiveMention("mail a@b.com", 12)).toBeNull();
  });
});
