import { describe, expect, it } from "vitest";
import { deriveCompatGrants } from "./compat";
import { diffDecisions } from "./decision-diff";
import { PERSONAS } from "./legacy/personas";

describe("diffDecisions", () => {
  for (const [name, access] of Object.entries(PERSONAS)) {
    it(`${name}: role chưa chuyển → không lệch quyết định nào`, () => {
      expect(diffDecisions(access, deriveCompatGrants(access))).toEqual([]);
    });
  }

  it("role đã chuyển với grant hẹp hơn: liệt kê đúng quyết định đổi", () => {
    const access = PERSONAS.taskCs;
    const narrowed = deriveCompatGrants(access).filter((grant) => grant !== "task.read:shared_queue");
    const diff = diffDecisions(access, narrowed);
    expect(diff.length).toBeGreaterThan(0);
    expect(diff.every((row) => row.legacy && !row.next)).toBe(true);
    expect(diff.some((row) => row.decision.startsWith("task.canView["))).toBe(true);
  });
});
