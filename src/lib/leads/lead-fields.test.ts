import { describe, expect, it } from "vitest";
import { normalizeLeadEmail, normalizeLeadText } from "./lead-fields";

describe("normalizeLeadEmail", () => {
  it("nhận email hợp lệ và hạ về chữ thường", () => {
    expect(normalizeLeadEmail("  Ann@Example.COM ")).toEqual({
      ok: true,
      value: "ann@example.com",
    });
  });

  it("rỗng nghĩa là không có email, không phải lỗi", () => {
    expect(normalizeLeadEmail("")).toEqual({ ok: true, value: null });
    expect(normalizeLeadEmail(null)).toEqual({ ok: true, value: null });
  });

  it("từ chối chuỗi chỉ có @ — đây chính là chỗ PATCH đang lọt", () => {
    // patch.ts chỉ kiểm `includes("@")`, nên "@" cũng qua được.
    expect(normalizeLeadEmail("@").ok).toBe(false);
  });

  it("từ chối email có khoảng trắng bên trong", () => {
    expect(normalizeLeadEmail("a b@c.com").ok).toBe(false);
  });

  it("từ chối giá trị không phải chuỗi", () => {
    expect(normalizeLeadEmail(42).ok).toBe(false);
  });
});

describe("normalizeLeadText", () => {
  it("cắt khoảng trắng hai đầu", () => {
    expect(normalizeLeadText("  Ann  ", "Name", 200)).toEqual({ ok: true, value: "Ann" });
  });

  it("rỗng thành null", () => {
    expect(normalizeLeadText("   ", "Name", 200)).toEqual({ ok: true, value: null });
  });

  it("từ chối giá trị quá dài — PATCH đang không giới hạn gì", () => {
    const result = normalizeLeadText("x".repeat(201), "Name", 200);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Name");
  });

  it("từ chối object thay vì ép String() thành '[object Object]'", () => {
    expect(normalizeLeadText({}, "Name", 200).ok).toBe(false);
  });
});
