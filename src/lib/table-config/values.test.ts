import { describe, expect, it } from "vitest";
import { coerceCustomValue, formatCustomValue } from "./values";

describe("coerceCustomValue", () => {
  it("coerces number/date/checkbox", () => {
    expect(coerceCustomValue("number", "12.5")).toEqual({ ok: true, value: 12.5 });
    expect(coerceCustomValue("date", "7/31/2026")).toEqual({
      ok: true,
      value: "2026-07-31",
    });
    expect(coerceCustomValue("checkbox", "yes")).toEqual({ ok: true, value: true });
  });

  it("validates dropdown and person values when context is provided", () => {
    expect(
      coerceCustomValue("dropdown", "Open", {
        optionIds: new Set(["opt-1"]),
        optionIdByLabel: new Map([["open", "opt-1"]]),
      })
    ).toEqual({ ok: true, value: "opt-1" });
    expect(
      coerceCustomValue("person", "bad@example.com", {
        personEmails: new Set(["good@example.com"]),
      }).ok
    ).toBe(false);
  });
});

describe("formatCustomValue", () => {
  it("formats dropdown/person labels through context", () => {
    expect(
      formatCustomValue("dropdown", "opt-1", {
        optionLabelById: new Map([["opt-1", "Open"]]),
      })
    ).toBe("Open");
    expect(
      formatCustomValue("person", "a@example.com", {
        personLabelByEmail: new Map([["a@example.com", "Agent A"]]),
      })
    ).toBe("Agent A");
  });
});
