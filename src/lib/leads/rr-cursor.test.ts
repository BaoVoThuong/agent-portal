import { describe, expect, it } from "vitest";
import { pickWeighted } from "./round-robin";

// Màn Chia pool vẽ dãy kế tiếp bằng chính hàm này, và truyền current_weight
// đã lưu vào. Lượt chia trước chưa bao giờ dừng đúng ranh giới một chu kỳ, nên
// bắt đầu lại từ 0 sẽ vẽ một dãy KHÁC với dãy mà việc chia thật sẽ chạy.
describe("preview starts from the saved rotation cursor", () => {
  it("a mid-cycle cursor gives a different order than a fresh one", () => {
    const fresh = pickWeighted(
      [{ email: "a", weight: 70, currentWeight: 0, position: 1 },
       { email: "b", weight: 30, currentWeight: 0, position: 2 }], 5).picks;
    // Đúng tình huống thật: lượt chia trước dừng giữa chu kỳ, b đang được nợ.
    const midCycle = pickWeighted(
      [{ email: "a", weight: 70, currentWeight: -50, position: 1 },
       { email: "b", weight: 30, currentWeight: 50, position: 2 }], 5).picks;
    expect(fresh).not.toEqual(midCycle);
    expect(midCycle[0]).toBe("b");
  });
});
