import { describe, expect, it } from "vitest";
import { isRosterAgent } from "./roster";

const roster = new Set(["ann.strambler@excelplannings.com", "Thuy.Insagent@gmail.com"]);

describe("isRosterAgent", () => {
  it("nhận agent có tên trong roster, không phân biệt hoa thường và khoảng trắng", () => {
    expect(isRosterAgent("  ANN.STRAMBLER@excelplannings.com ", roster)).toBe(true);
    expect(isRosterAgent("thuy.insagent@gmail.com", roster)).toBe(true);
  });

  it("từ chối người ngoài roster, kể cả khi đó là chính người gọi", () => {
    expect(isRosterAgent("plain.cs@epsins.co", roster)).toBe(false);
  });

  it("từ chối rỗng / null", () => {
    expect(isRosterAgent("", roster)).toBe(false);
    expect(isRosterAgent(null, roster)).toBe(false);
    expect(isRosterAgent(undefined, roster)).toBe(false);
  });
});
