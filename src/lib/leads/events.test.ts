import { describe, expect, it } from "vitest";
import { escapeLikePattern } from "./events";

describe("escapeLikePattern", () => {
  // An event genuinely called "50% Off Fair" would otherwise match half the
  // table through ILIKE and resolve a lead to the wrong event.
  it("escapes the ILIKE wildcards", () => {
    expect(escapeLikePattern("50% Off")).toBe("50\\% Off");
    expect(escapeLikePattern("Health_Fair")).toBe("Health\\_Fair");
    expect(escapeLikePattern("a\\b")).toBe("a\\\\b");
  });

  it("leaves an ordinary name alone", () => {
    expect(escapeLikePattern("Health Fair 2026")).toBe("Health Fair 2026");
  });
});
