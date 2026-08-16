import { describe, expect, it } from "vitest";
import {
  coerceCustomValue,
  formatCustomValue,
  normalizedValueEquals,
  validateEnrollmentOptionRules,
} from "./values";

describe("validateEnrollmentOptionRules", () => {
  it("allows terminal and QC rules only on Stage", () => {
    expect(validateEnrollmentOptionRules({ program: "cs", setKey: "category", isStage: false, isTerminal: true }).ok).toBe(false);
    expect(validateEnrollmentOptionRules({ program: "aca", setKey: "stage", isStage: true, isTerminal: true, triggersQc: true })).toEqual({ ok: true });
    expect(validateEnrollmentOptionRules({ program: "medicare", setKey: "carrier", isStage: false, triggersQc: true }).ok).toBe(false);
  });
});

describe("normalizedValueEquals", () => {
  it("recognizes unchanged values across supported custom field types", () => {
    expect(normalizedValueEquals("text", "same", "same")).toBe(true);
    expect(normalizedValueEquals("number", 12, 12)).toBe(true);
    expect(normalizedValueEquals("checkbox", true, true)).toBe(true);
  });

  it("treats empty persisted values and a null clear as equal", () => {
    expect(normalizedValueEquals("dropdown", "", null)).toBe(true);
    expect(normalizedValueEquals("person", undefined, null)).toBe(true);
  });

  it("compares person emails case-insensitively after trimming", () => {
    expect(
      normalizedValueEquals("person", " Agent@Example.com ", "agent@example.com")
    ).toBe(true);
    expect(normalizedValueEquals("person", "a@example.com", "b@example.com")).toBe(
      false
    );
  });

  it("keeps dropdown IDs exact", () => {
    expect(normalizedValueEquals("dropdown", "opt-1", "opt-1")).toBe(true);
    expect(normalizedValueEquals("dropdown", "opt-1", "OPT-1")).toBe(false);
  });
});

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
    expect(
      coerceCustomValue("person", "Good Agent", {
        personEmails: new Set(["good@example.com"]),
        personEmailByLabel: new Map([["good agent", "good@example.com"]]),
      })
    ).toEqual({ ok: true, value: "good@example.com" });
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
