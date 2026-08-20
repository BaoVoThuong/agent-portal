import { describe, expect, it } from "vitest";
import { insertAtCaret, QUICK_EMOJI } from "./emoji";

describe("QUICK_EMOJI", () => {
  it("offers a small, duplicate-free shortlist", () => {
    expect(QUICK_EMOJI.length).toBeGreaterThan(0);
    expect(new Set(QUICK_EMOJI).size).toBe(QUICK_EMOJI.length);
  });

  it("contains no variation selectors", () => {
    // U+FE0F survives a round trip through some clients and not others. An
    // emoji that arrives without it fails the server allowlist and 400s.
    for (const emoji of QUICK_EMOJI) expect(emoji).not.toContain("️");
  });
});

describe("insertAtCaret", () => {
  it("inserts at the caret and reports the new caret", () => {
    // "👍" is 2 UTF-16 code units.
    expect(insertAtCaret("hello world", 5, "👍")).toEqual({
      text: "hello👍 world",
      caret: 7,
    });
  });

  it("appends when the caret sits at the end", () => {
    expect(insertAtCaret("ok", 2, "🎉")).toEqual({ text: "ok🎉", caret: 4 });
  });

  it("replaces a selection rather than splitting it", () => {
    expect(insertAtCaret("hello world", 0, "👋", 5)).toEqual({
      text: "👋 world",
      caret: 2,
    });
  });

  it("clamps a caret past the end", () => {
    // "✅" is U+2705 — ONE code unit, unlike the emoji above.
    expect(insertAtCaret("hi", 99, "✅")).toEqual({ text: "hi✅", caret: 3 });
  });

  it("clamps a negative caret", () => {
    expect(insertAtCaret("hi", -3, "✅")).toEqual({ text: "✅hi", caret: 1 });
  });

  it("measures the caret in UTF-16 code units, not code points", () => {
    // selectionStart counts code units; measuring in code points would land
    // the caret inside a surrogate pair.
    expect(insertAtCaret("", 0, "👍").caret).toBe(2);
    expect(insertAtCaret("", 0, "✅").caret).toBe(1);
  });

  it("handles a reversed selection pair defensively", () => {
    // A textarea always reports selectionStart <= selectionEnd, but the clamp
    // must not produce a negative slice if that ever stops being true.
    expect(insertAtCaret("hello", 3, "✅", 1)).toEqual({
      text: "hel✅lo",
      caret: 4,
    });
  });
});
