import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROVIDER_FILTERS,
  EMPTY_PROVIDER_FILTERS,
  applyProviderFilters,
  filterProviders,
  providerFilterOptions,
  sortProviders,
} from "@/lib/providers/search";
import type { ProviderRow } from "@/lib/providers/types";

function row(overrides: Partial<ProviderRow> = {}): ProviderRow {
  return {
    id: "p1",
    source_row_number: 2,
    custom_values: {},
    needs_review: false,
    created_at: "2026-09-16T00:00:00.000Z",
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

describe("applyProviderFilters", () => {
  const rows = [
    row({ id: "a", state: "TX", city: "Houston", practices_as: "PCP - Adults", accepting_new_patients: "Yes" }),
    row({ id: "b", state: "tx", city: "Katy", practices_as: "Cardiology", accepting_new_patients: "No" }),
    row({ id: "c", state: "CA", city: "Irvine", practices_as: null, accepting_new_patients: null, needs_review: true }),
  ];

  it("không có bộ lọc nào thì trả NGUYÊN mảng cũ", () => {
    expect(applyProviderFilters(rows, EMPTY_PROVIDER_FILTERS)).toBe(rows);
  });

  it("lọc theo bang, không phân biệt hoa thường", () => {
    // Dữ liệu Sheet lẫn cả "TX" lẫn "tx"; chọn một mục phải ra cả hai dòng.
    expect(
      applyProviderFilters(rows, { ...EMPTY_PROVIDER_FILTERS, state: ["TX"] }).map((r) => r.id)
    ).toEqual(["a", "b"]);
  });

  it("nhiều giá trị trong cùng một bộ lọc là HOẶC", () => {
    expect(
      applyProviderFilters(rows, { ...EMPTY_PROVIDER_FILTERS, city: ["Houston", "Irvine"] }).map(
        (r) => r.id
      )
    ).toEqual(["a", "c"]);
  });

  it("hai bộ lọc khác nhau là VÀ", () => {
    expect(
      applyProviderFilters(rows, {
        ...EMPTY_PROVIDER_FILTERS,
        state: ["TX"],
        specialty: ["Cardiology"],
      }).map((r) => r.id)
    ).toEqual(["b"]);
  });

  it("lọc ra đúng những dòng còn phải sửa tay", () => {
    expect(
      applyProviderFilters(rows, { ...EMPTY_PROVIDER_FILTERS, review: "needs" }).map((r) => r.id)
    ).toEqual(["c"]);
    expect(
      applyProviderFilters(rows, { ...EMPTY_PROVIDER_FILTERS, review: "ok" }).map((r) => r.id)
    ).toEqual(["a", "b"]);
  });

  it("dòng có ô trống bị loại khi lọc theo ô đó", () => {
    expect(
      applyProviderFilters(rows, { ...EMPTY_PROVIDER_FILTERS, specialty: ["Cardiology"] }).map(
        (r) => r.id
      )
    ).toEqual(["b"]);
  });

  it("mặc định lúc mở bảng là chỉ hiện địa chỉ dùng được", () => {
    // DEFAULT khác EMPTY một cách CỐ Ý: EMPTY phải giữ nghĩa "không ràng buộc
    // gì", vì applyProviderFilters dựa vào nó để trả thẳng mảng gốc.
    expect(DEFAULT_PROVIDER_FILTERS.address).toBe("valid");
    expect(EMPTY_PROVIDER_FILTERS.address).toBe("");
    const list = [
      row({ id: "ok", street: "7111 Harwin Dr" }),
      row({ id: "bad", street: null }),
    ];
    expect(applyProviderFilters(list, DEFAULT_PROVIDER_FILTERS).map((r) => r.id)).toEqual(["ok"]);
    expect(applyProviderFilters(list, EMPTY_PROVIDER_FILTERS)).toBe(list);
  });

  it("lọc theo địa chỉ dùng được / không dùng được trong Finder", () => {
    const list = [
      row({ id: "ok", street: "7111 Harwin Dr", zip_code: "77036" }),
      // Mục tổng hệ thống: không có số nhà nên Finder không tra cứu được.
      row({ id: "umbrella", street: "Baptist's Locations", zip_code: "78xxx" }),
      // Chuỗi nhà thuốc: cố ý không có địa chỉ, hệ quả vẫn là không tra cứu được.
      row({ id: "chain", street: null, zip_code: null }),
    ];
    expect(
      applyProviderFilters(list, { ...EMPTY_PROVIDER_FILTERS, address: "valid" }).map((r) => r.id)
    ).toEqual(["ok"]);
    expect(
      applyProviderFilters(list, { ...EMPTY_PROVIDER_FILTERS, address: "invalid" }).map((r) => r.id)
    ).toEqual(["umbrella", "chain"]);
    // "" nghĩa là không ràng buộc, không phải "không khớp gì".
    expect(
      applyProviderFilters(list, { ...EMPTY_PROVIDER_FILTERS, address: "" })
    ).toBe(list);
  });

  it("lọc theo từng plan trong ô multiselect, và kết hợp ACA + Medicare bằng VÀ", () => {
    const planRows = [
      row({
        id: "a",
        obamacare: "Ambetter HMO, BCBS Advantage",
        medicare: "UHC, Healthspring/Cigna",
      }),
      row({ id: "b", obamacare: "Oscar HMO", medicare: "UHC" }),
      row({ id: "c", obamacare: "BCBS Advantage", medicare: "Humana" }),
    ];

    expect(
      applyProviderFilters(planRows, {
        ...EMPTY_PROVIDER_FILTERS,
        acaPlans: ["ambetter hmo"],
      }).map((r) => r.id)
    ).toEqual(["a"]);
    expect(
      applyProviderFilters(planRows, {
        ...EMPTY_PROVIDER_FILTERS,
        acaPlans: ["BCBS Advantage"],
        medicarePlans: ["UHC"],
      }).map((r) => r.id)
    ).toEqual(["a"]);
  });

  it("lọc theo từng Specialty trong ô multiselect và nhận alias cũ", () => {
    const specialtyRows = [
      row({ id: "a", practices_as: "PCP - Family (Adults and Children), Opthamology" }),
      row({ id: "b", practices_as: "Cardiologist" }),
    ];

    expect(
      applyProviderFilters(specialtyRows, {
        ...EMPTY_PROVIDER_FILTERS,
        specialty: ["PCP - Family"],
      }).map((r) => r.id)
    ).toEqual(["a"]);
    expect(
      applyProviderFilters(specialtyRows, {
        ...EMPTY_PROVIDER_FILTERS,
        specialty: ["Ophthalmology"],
      }).map((r) => r.id)
    ).toEqual(["a"]);
  });
});

describe("providerFilterOptions", () => {
  it("gộp theo bản chuẩn hoá nhưng giữ cách viết đầu tiên, và bỏ ô trống", () => {
    const options = providerFilterOptions([
      row({ id: "a", state: "TX", city: "Houston" }),
      row({ id: "b", state: "tx", city: "  " }),
      row({ id: "c", state: "CA", city: "Irvine" }),
    ]);
    expect(options.state).toEqual(["CA", "TX"]);
    expect(options.city).toEqual(["Houston", "Irvine"]);
  });

  it("tách ACA và Medicare thành từng option plan, không để nguyên cả chuỗi ô", () => {
    const options = providerFilterOptions([
      row({
        id: "a",
        obamacare: "Ambetter HMO, BCBS Advantage",
        medicare: "UHC, Healthspring/Cigna",
      }),
      row({
        id: "b",
        obamacare: "ambetter hmo",
        medicare: "UHC",
      }),
    ]);

    expect(options.acaPlans).toEqual(["Ambetter HMO", "BCBS Advantage"]);
    expect(options.medicarePlans).toEqual(["Healthspring/Cigna", "UHC"]);
  });

  it("chuẩn hoá option Specialty và tách từng nhãn trong ô", () => {
    const options = providerFilterOptions([
      row({
        practices_as: "PCP - Family (Adults and Children), Opthamology",
      }),
    ]);

    expect(options.specialty).toEqual(["Ophthalmology", "PCP - Family"]);
  });
});
