import { describe, expect, it } from "vitest";
import { buildSnippet } from "./search";

describe("buildSnippet", () => {
  it("windows around the first match and reports the span", () => {
    const body = "The quick brown fox jumps over the lazy dog again and again";
    const snippet = buildSnippet(body, "fox", 8);
    expect(snippet.text.slice(snippet.matchStart, snippet.matchStart + snippet.matchLen).toLowerCase()).toBe("fox");
    expect(snippet.text.length).toBeLessThan(body.length);
  });

  it("no match returns the head with a zero-length span", () => {
    const snippet = buildSnippet("hello world", "zzz", 5);
    expect(snippet.matchLen).toBe(0);
    expect(snippet.text.startsWith("hello")).toBe(true);
  });
});
