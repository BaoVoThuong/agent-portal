import { describe, expect, it } from "vitest";
import {
  isAllowedEmoji,
  normalizeEmojiInput,
  searchEmoji,
} from "./emoji-search";

describe("searchEmoji", () => {
  it("matches on name", () => {
    expect(searchEmoji("thumbs up").map((entry) => entry.char)).toContain("👍");
  });

  it("matches on a keyword the name does not contain", () => {
    expect(searchEmoji("+1").map((entry) => entry.char)).toContain("👍");
  });

  it("is case and whitespace insensitive", () => {
    expect(searchEmoji("  THUMBS  ").map((entry) => entry.char)).toContain("👍");
  });

  it("ranks a name prefix above a mid-word or keyword hit", () => {
    const first = searchEmoji("smile")[0];
    expect(first.name.startsWith("smil")).toBe(true);
  });

  it("returns everything for an empty query", () => {
    expect(searchEmoji("").length).toBeGreaterThan(1000);
  });

  it("returns nothing for a query that matches nothing", () => {
    expect(searchEmoji("zzzzzznotanemoji")).toEqual([]);
  });
});

describe("isAllowedEmoji", () => {
  it("accepts a member of the set", () => {
    expect(isAllowedEmoji("👍")).toBe(true);
  });

  it("rejects arbitrary text", () => {
    expect(isAllowedEmoji("<script>")).toBe(false);
    expect(isAllowedEmoji("")).toBe(false);
  });

  it("rejects a long paste that merely starts with an emoji", () => {
    expect(isAllowedEmoji("👍 plus a whole sentence")).toBe(false);
  });
});

describe("normalizeEmojiInput", () => {
  it("keeps a canonical emoji untouched", () => {
    expect(normalizeEmojiInput("👍")).toBe("👍");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeEmojiInput(" 👍 ")).toBe("👍");
  });

  it("maps a bare variation-selector form to the canonical form", () => {
    expect(normalizeEmojiInput("❤")).toBe("❤️");
    expect(isAllowedEmoji("❤")).toBe(true);
  });
});
