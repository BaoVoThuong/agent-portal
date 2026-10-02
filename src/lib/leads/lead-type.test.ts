import { describe, expect, it } from "vitest";
import { isLeadType, isPersonalLeadEventName, leadTypeOf } from "./lead-type";

describe("leadTypeOf", () => {
  it("reads the type off the event", () => {
    expect(leadTypeOf({ event_id: "11111111-1111-4111-8111-111111111111" })).toBe("event");
    expect(leadTypeOf({ event_id: null })).toBe("personal");
  });
});

describe("isPersonalLeadEventName", () => {
  // Cách đánh dấu cũ trên production: một event tên "Personal Lead".
  it("recognises the old hand-typed marker however it is spaced or cased", () => {
    expect(isPersonalLeadEventName("Personal Lead")).toBe(true);
    expect(isPersonalLeadEventName("  personal   lead ")).toBe(true);
    expect(isPersonalLeadEventName("PERSONAL LEADS")).toBe(true);
    expect(isPersonalLeadEventName("Personal")).toBe(true);
  });

  it("leaves real event names alone", () => {
    expect(isPersonalLeadEventName("Personal Finance Expo")).toBe(false);
    expect(isPersonalLeadEventName("Health Fair")).toBe(false);
    expect(isPersonalLeadEventName(null)).toBe(false);
    expect(isPersonalLeadEventName("")).toBe(false);
  });
});

describe("isLeadType", () => {
  it("accepts only the two types", () => {
    expect(isLeadType("event")).toBe(true);
    expect(isLeadType("personal")).toBe(true);
    expect(isLeadType("referral")).toBe(false);
    expect(isLeadType(undefined)).toBe(false);
  });
});
