import { describe, expect, it } from "vitest";
import { parsePlanCell, serializePlanCell } from "@/lib/providers/plans";

describe("provider plan cells", () => {
  it("đọc cả chuỗi Sheet và mảng nhãn", () => {
    expect(parsePlanCell("UHC, Oscar HMO, UHC\nMolina")).toEqual([
      "UHC",
      "Oscar HMO",
      "Molina",
    ]);
    expect(parsePlanCell(["UHC", "Molina"])).toEqual(["UHC", "Molina"]);
  });

  it("giữ nhãn lạ và không nhân đôi khi serialize", () => {
    expect(
      serializePlanCell(["UHC", "Unknown plan", "UHC", " Unknown plan "])
    ).toBe("UHC, Unknown plan");
  });

  it("biến ô rỗng thành null", () => {
    expect(serializePlanCell([])).toBeNull();
    expect(parsePlanCell(null)).toEqual([]);
  });
});
