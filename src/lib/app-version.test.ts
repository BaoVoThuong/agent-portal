import { describe, expect, it } from "vitest";
import { isNewerDeployment, MIN_VERSION_CHECK_GAP_MS, versionCheckDue } from "./app-version";

describe("isNewerDeployment", () => {
  it("flags a tab whose deployment differs from the one serving", () => {
    expect(isNewerDeployment("dpl_old", "dpl_new")).toBe(true);
  });

  it("stays quiet when they match or either side is unknown", () => {
    expect(isNewerDeployment("dpl_same", "dpl_same")).toBe(false);
    expect(isNewerDeployment("", "dpl_new")).toBe(false);
    expect(isNewerDeployment("dpl_old", null)).toBe(false);
    expect(isNewerDeployment(undefined, undefined)).toBe(false);
  });
});

describe("versionCheckDue", () => {
  it("checks immediately on the first event", () => {
    expect(versionCheckDue(null, 1_000)).toBe(true);
  });

  it("skips a second focus or visibility event", () => {
    expect(versionCheckDue(1_000, 1_050)).toBe(false);
    expect(versionCheckDue(1_000, 1_000 + MIN_VERSION_CHECK_GAP_MS - 1)).toBe(false);
  });

  it("checks again after the gap", () => {
    expect(versionCheckDue(1_000, 1_000 + MIN_VERSION_CHECK_GAP_MS)).toBe(true);
  });
});
