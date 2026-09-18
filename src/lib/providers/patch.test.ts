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
