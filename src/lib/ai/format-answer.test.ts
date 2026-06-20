import { describe, expect, it } from "vitest";
import { formatAnswer, stripMarkdown } from "@/lib/ai/format-answer";

describe("stripMarkdown", () => {
  it("bỏ bold/italic/code/heading", () => {
    expect(stripMarkdown("You have **12** `active` __policies__")).toBe(
      "You have 12 active policies"
    );
    expect(stripMarkdown("# Title")).toBe("Title");
  });

  it("rút link [text](url) thành text", () => {
    expect(stripMarkdown("see [report](http://x.com)")).toBe("see report");
  });
});

describe("formatAnswer", () => {
  it("strip markdown ở headline", () => {
    const out = formatAnswer({
      headline: "You have **12** active policies",
      stats: [],
    });
    expect(out.headline).toBe("You have 12 active policies");
  });

  it("format usd & number & percent bằng code, không tin chuỗi LLM", () => {
    const out = formatAnswer({
      headline: "Summary",
      stats: [
        { label: "Premium", value: 45200, format: "usd" },
        { label: "Policies", value: 12, format: "number" },
        { label: "Comm Rate", value: 6.04, format: "percent" },
        { label: "Top type", value: "**Auto**", format: "text" },
      ],
    });
    expect(out.stats).toEqual([
      { label: "Premium", value: "$45,200.00" },
      { label: "Policies", value: "12" },
      { label: "Comm Rate", value: "6.04%" },
      { label: "Top type", value: "Auto" },
    ]);
  });

  it("bỏ stat thiếu label, fallback headline khi rỗng", () => {
    const out = formatAnswer({ stats: [{ value: 1, format: "number" }] });
    expect(out.stats).toHaveLength(0);
    expect(out.headline).toContain("No answer");
  });
});
