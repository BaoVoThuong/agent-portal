import { describe, expect, it } from "vitest";
import { buildDisplayNameMap, UNKNOWN_PERSON_LABEL } from "@/lib/people/display-names";

describe("buildDisplayNameMap", () => {
  it("uses the canonical account name, including inactive accounts", () => {
    const map = buildDisplayNameMap([
      { email: "bao@x.com", name: "Võ Thương Bảo", active: false },
    ]);
    expect(map.get("bao@x.com")).toBe("Võ Thương Bảo");
  });

  it("uses a neutral label instead of guessing from the email", () => {
    const map = buildDisplayNameMap([{ email: "j.doe@x.com", name: null }]);
    expect(map.get("j.doe@x.com")).toBe(UNKNOWN_PERSON_LABEL);
    expect(map.get("j.doe@x.com")).not.toBe("J Doe");
  });

  it("normalizes lookup keys", () => {
    const map = buildDisplayNameMap([{ email: "Bao@X.com", name: "Bảo" }]);
    expect(map.get("bao@x.com")).toBe("Bảo");
  });
});
