import { describe, expect, it } from "vitest";
import { isNewerDeployment } from "./app-version";

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
