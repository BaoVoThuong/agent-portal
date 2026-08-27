import { describe, expect, it } from "vitest";
import { isOwnLeadMutation } from "./realtime-topics";

describe("isOwnLeadMutation", () => {
  it("suppresses only a genuine echo of this tab", () => {
    expect(isOwnLeadMutation("tab-a", "tab-a")).toBe(true);
    expect(isOwnLeadMutation("tab-a", "tab-b")).toBe(false);
  });

  it("never suppresses when either side has no id", () => {
    expect(isOwnLeadMutation(undefined, undefined)).toBe(false);
    expect(isOwnLeadMutation("tab-a", undefined)).toBe(false);
    expect(isOwnLeadMutation(undefined, "tab-b")).toBe(false);
  });
});
