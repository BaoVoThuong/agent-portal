import { describe, expect, it } from "vitest";
import { filterProviders, sortProviders } from "@/lib/providers/search";
import type { ProviderRow } from "@/lib/providers/types";

function row(overrides: Partial<ProviderRow> = {}): ProviderRow {
  return {
    id: "p1",
    source_sheet_id: "sheet",
    source_gid: "gid",
    source_row_number: 2,
    custom_values: {},
    created_by_email: null,
    updated_by_email: null,
    updated_at: "2026-09-16T00:00:00.000Z",
    archived_at: null,
    doctors: "Hoang Anh Phan",
    facility: "Houston Methodist",
    npi: "1407020035",
    practices_as: "PCP - Adults",
    phone: "713-555-0123",
    street: "1 Main",
    city: "Houston",
    state: "TX",
    zip_code: "77036",
    accepting_new_patients: "Yes",
    business_hours: null,
    obamacare: null,
    medicare: null,
    other_plans: null,
    verified_by: null,
    date: null,
    ...overrides,
  };
}

describe("filterProviders", () => {
  it("tìm không phân biệt hoa thường trên mọi cột văn bản", () => {
    expect(filterProviders([row()], "methodist")).toHaveLength(1);
    expect(filterProviders([row()], "77036")).toHaveLength(1);
    expect(filterProviders([row()], "khong-co")).toHaveLength(0);
  });

  it("chuỗi rỗng trả về NGUYÊN mảng cũ, không tạo mảng mới", () => {
    const rows = [row(), row({ id: "p2" })];
    expect(filterProviders(rows, "   ")).toBe(rows);
  });

  it("tìm được cả trong giá trị cột tuỳ chỉnh", () => {
    expect(
      filterProviders([row({ custom_values: { note: "Vietnamese" } })], "vietnam")
    ).toHaveLength(1);
  });
});

describe("sortProviders", () => {
  it("sắp theo cột văn bản, ô trống luôn xuống cuối bất kể chiều sắp", () => {
    const rows = [
      row({ id: "a", city: "Katy" }),
      row({ id: "b", city: null }),
      row({ id: "c", city: "Austin" }),
    ];
    expect(sortProviders(rows, "city", "asc").map((r) => r.id)).toEqual(["c", "a", "b"]);
    expect(sortProviders(rows, "city", "desc").map((r) => r.id)).toEqual(["a", "c", "b"]);
  });

  it("sắp được theo cột tuỳ chỉnh", () => {
    const rows = [
      row({ id: "a", custom_values: { note: "b" } }),
      row({ id: "b", custom_values: { note: "a" } }),
    ];
    expect(sortProviders(rows, "note", "asc").map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("không sửa mảng gốc", () => {
    const rows = [row({ id: "a", city: "Katy" }), row({ id: "b", city: "Austin" })];
    sortProviders(rows, "city", "asc");
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
  });
});
