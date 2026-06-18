import { describe, expect, it } from "vitest";
import { can, canAny } from "@/lib/rbac/client";

// Golden-master: khoá behavior hiện tại của permission helper thuần.
describe("can", () => {
  it("trả false khi permissions undefined", () => {
    expect(can(undefined, "x")).toBe(false);
  });

  it("trả false khi permissions rỗng", () => {
    expect(can([], "x")).toBe(false);
  });

  it("trả true khi permission có trong danh sách", () => {
    expect(can(["a", "b"], "b")).toBe(true);
  });

  it("trả false khi permission không có", () => {
    expect(can(["a", "b"], "c")).toBe(false);
  });
});

describe("canAny", () => {
  it("trả false khi permissions undefined", () => {
    expect(canAny(undefined, ["a"])).toBe(false);
  });

  it("trả false khi required rỗng", () => {
    expect(canAny(["a"], [])).toBe(false);
  });

  it("trả true khi có ít nhất một permission khớp", () => {
    expect(canAny(["a", "b"], ["x", "b"])).toBe(true);
  });

  it("trả false khi không permission nào khớp", () => {
    expect(canAny(["a", "b"], ["x", "y"])).toBe(false);
  });
});
