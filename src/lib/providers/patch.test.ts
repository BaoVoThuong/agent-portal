import { describe, expect, it } from "vitest";
import { buildProviderPatch } from "@/lib/providers/patch";

describe("buildProviderPatch", () => {
  it("nhận cột văn bản và cắt khoảng trắng", () => {
    expect(buildProviderPatch({ city: "  Katy  " })).toMatchObject({
      ok: true,
      patch: { city: "Katy" },
    });
  });

  it("nhận mảng plan và ghi nhãn dạng chuỗi cho provider_directory", () => {
    expect(buildProviderPatch({ obamacare: ["UHC", "Oscar HMO", "UHC"] })).toMatchObject({
      ok: true,
      patch: { obamacare: "UHC, Oscar HMO" },
    });
  });

  it("vẫn nhận chuỗi plan cũ và cho phép xoá bằng mảng rỗng", () => {
    expect(buildProviderPatch({ medicare: " UHC, Aetna " })).toMatchObject({
      ok: true,
      patch: { medicare: "UHC, Aetna" },
    });
    expect(buildProviderPatch({ medicare: [] })).toMatchObject({
      ok: true,
      patch: { medicare: null },
    });
  });

  it("chuẩn hoá Specialty thành chuỗi multiselect canonical", () => {
    expect(
      buildProviderPatch({
        practices_as: ["PCP - Family (Adults and Children)", "Opthamology", "Opthamology"],
      })
    ).toMatchObject({
      ok: true,
      patch: { practices_as: "PCP - Family, Ophthalmology" },
    });
  });

  it("viết hoa bang, giống hệt đường tạo mới", () => {
    expect(buildProviderPatch({ state: "tx" })).toMatchObject({
      ok: true,
      patch: { state: "TX" },
    });
  });

  it("nhận checkbox Reviewed và giữ đúng boolean needs_review", () => {
    expect(buildProviderPatch({ needs_review: false })).toMatchObject({
      ok: true,
      patch: { needs_review: false },
    });
    expect(buildProviderPatch({ needs_review: "false" })).toEqual({
      ok: false,
      error: "needs_review must be a boolean.",
    });
  });

  it("ô để trống nghĩa là xoá giá trị, không phải bỏ qua", () => {
    expect(buildProviderPatch({ phone: "" })).toMatchObject({
      ok: true,
      patch: { phone: null },
    });
    expect(buildProviderPatch({ phone: "   " })).toMatchObject({
      ok: true,
      patch: { phone: null },
    });
  });

  it("từ chối cột không nằm trong danh sách sửa được", () => {
    expect(buildProviderPatch({ source_sheet_id: "portal" })).toEqual({
      ok: false,
      error: "source_sheet_id cannot be edited here.",
    });
    expect(buildProviderPatch({ id: "abc" })).toEqual({
      ok: false,
      error: "id cannot be edited here.",
    });
  });

  it("archive đi qua patch, và chỉ nhận true", () => {
    const archived = buildProviderPatch({ archived: true });
    expect(archived.ok).toBe(true);
    expect(archived.ok && typeof archived.patch.archived_at).toBe("string");
    expect(buildProviderPatch({ archived: "yes" })).toEqual({
      ok: false,
      error: "archived must be true.",
    });
  });

  it("tách custom_values ra khỏi patch cột hệ thống", () => {
    expect(buildProviderPatch({ custom_values: { note: "abc" } })).toMatchObject({
      ok: true,
      patch: {},
      customValues: { note: "abc" },
    });
  });

  it("không nhận patch rỗng", () => {
    expect(buildProviderPatch({})).toEqual({ ok: false, error: "Nothing to update." });
  });
});

describe("sửa địa chỉ thì xoá toạ độ cũ", () => {
  // Không xoá thì Finder vẫn tính khoảng cách tới CHỖ CŨ cho tới lần backfill
  // kế tiếp — sai một cách im lặng, và sai đúng ở thứ người dùng tin nhất.
  it("đổi street/city/state/zip đều dọn sạch nhóm cột geocode", () => {
    for (const key of ["street", "city", "state", "zip_code"]) {
      const result = buildProviderPatch({ [key]: "gia tri moi" });
      expect(result.ok, key).toBe(true);
      if (!result.ok) continue;
      expect(result.patch.latitude, key).toBeNull();
      expect(result.patch.longitude, key).toBeNull();
      expect(result.patch.geocode_source, key).toBeNull();
      expect(result.patch.geocoded_at, key).toBeNull();
      expect(result.patch.geocode_key, key).toBeNull();
    }
  });

  it("xoá địa chỉ (gửi null) cũng phải xoá toạ độ", () => {
    const result = buildProviderPatch({ street: null });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.patch.latitude).toBeNull();
  });

  it("sửa ô không liên quan thì KHÔNG đụng tới toạ độ", () => {
    const result = buildProviderPatch({ phone: "713-555-0123" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect("latitude" in result.patch).toBe(false);
    expect("geocode_key" in result.patch).toBe(false);
  });

  it("vẫn không cho gửi thẳng toạ độ từ ngoài vào", () => {
    expect(buildProviderPatch({ latitude: 29.7 })).toEqual({
      ok: false,
      error: "latitude cannot be edited here.",
    });
  });
});
