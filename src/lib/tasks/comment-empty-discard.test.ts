import { describe, expect, it } from "vitest";
import { shouldDiscardEmptyComment } from "./comment-submission";

describe("shouldDiscardEmptyComment", () => {
  it("dọn khi không có chữ và không tệp nào lên được", () => {
    expect(shouldDiscardEmptyComment({ body: "", uploadedAny: false })).toBe(true);
  });

  it("dọn cả khi người dùng chỉ gõ khoảng trắng", () => {
    expect(shouldDiscardEmptyComment({ body: "   \n ", uploadedAny: false })).toBe(true);
  });

  it("GIỮ comment chỉ-đính-kèm: đó là use case hợp lệ", () => {
    expect(shouldDiscardEmptyComment({ body: "", uploadedAny: true })).toBe(false);
  });

  it("GIỮ khi một tệp thành công dù tệp khác trong cùng lượt hỏng", () => {
    expect(shouldDiscardEmptyComment({ body: "", uploadedAny: true })).toBe(false);
  });

  it("GIỮ comment có chữ, kể cả khi mọi tệp đều hỏng", () => {
    expect(shouldDiscardEmptyComment({ body: "xem giúp anh", uploadedAny: false })).toBe(false);
  });
});
