import { describe, expect, it } from "vitest";
import { groupLeadIdsByProduct } from "./auto-assign";

describe("groupLeadIdsByProduct", () => {
  // Import handles one product at a time, but "distribute the pool" does not:
  // the ratio table AND the rotation cursor are per product, so a mixed batch
  // has to be split before either is touched.
  it("splits a mixed batch by product", () => {
    expect(
      groupLeadIdsByProduct([
        { id: "1", product: "health" },
        { id: "2", product: "pc" },
        { id: "3", product: "health" },
      ])
    ).toEqual({ health: ["1", "3"], pc: ["2"] });
  });

  it("returns both keys even when one product has nothing", () => {
    expect(groupLeadIdsByProduct([{ id: "1", product: "pc" }])).toEqual({
      pc: ["1"],
      health: [],
    });
  });

  it("handles an empty batch", () => {
    expect(groupLeadIdsByProduct([])).toEqual({ pc: [], health: [] });
  });

  // ---- Lead mang nhiều product ----

  it("bấm Distribute ở một tab thì mọi lead vào đúng nhóm tab đó", () => {
    // Mia mang cả hai, `product` = "pc" vì trigger lấy phần tử đầu. Bấm ở tab
    // Health thì cô ấy phải tiêu cursor của Health, không phải của P&C.
    expect(
      groupLeadIdsByProduct(
        [
          { id: "mia", product: "pc", products: ["pc", "health"] },
          { id: "solo", product: "health", products: ["health"] },
        ],
        "health"
      )
    ).toEqual({ pc: [], health: ["mia", "solo"] });
  });

  it("chia tất cả thì lead multi-product chỉ được tính MỘT lần", () => {
    // Đếm ở cả hai nhóm là lượt thứ hai vẫn dời cursor rồi mới phát hiện lead
    // đã có chủ — một lead bị bỏ qua vẫn đốt mất lượt của người khác.
    const grouped = groupLeadIdsByProduct([
      { id: "mia", product: "pc", products: ["pc", "health"] },
    ]);
    expect(grouped).toEqual({ pc: ["mia"], health: [] });
    expect(grouped.pc.length + grouped.health.length).toBe(1);
  });

  it("chia tất cả: gom theo thứ tự LEAD_PRODUCTS, không theo thứ tự mảng trong DB", () => {
    // Cùng một lead phải luôn rơi vào cùng một nhóm giữa hai lần chạy, kể cả
    // khi mảng được ghi ngược thứ tự.
    expect(
      groupLeadIdsByProduct([{ id: "mia", product: "pc", products: ["health", "pc"] }])
    ).toEqual({ pc: ["mia"], health: [] });
  });

  it("bỏ qua lead chưa phân loại product khi chia tất cả", () => {
    expect(
      groupLeadIdsByProduct([{ id: "unknown", product: null, products: [] }])
    ).toEqual({ pc: [], health: [] });
  });

  it("lead chưa phân loại vẫn theo tab khi lượt chia có product cụ thể", () => {
    // Nó lọt vào đây thì đã qua bộ lọc pool `products @> {pc}` của chính tab đó,
    // nên nó KHÔNG thể là lead chưa phân loại — nhưng nếu có, tab là nguồn đúng.
    expect(
      groupLeadIdsByProduct([{ id: "x", product: null, products: [] }], "pc")
    ).toEqual({ pc: ["x"], health: [] });
  });
});