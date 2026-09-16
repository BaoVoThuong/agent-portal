import { describe, expect, it } from "vitest";
import { buildProviderRow, parseCreateProviderInput } from "@/lib/providers/create";
import { PORTAL_SOURCE, PROVIDER_TEXT_FIELDS } from "@/lib/providers/types";

function emptyInput() {
  const value = Object.fromEntries(PROVIDER_TEXT_FIELDS.map((field) => [field, null]));
  return { ...value, customValues: {} } as Parameters<typeof buildProviderRow>[0];
}

describe("parseCreateProviderInput", () => {
  it("đòi ít nhất tên bác sĩ hoặc tên cơ sở", () => {
    expect(parseCreateProviderInput({ city: "Houston" })).toEqual({
      ok: false,
      error: "Doctor or facility is required.",
    });
  });

  it("cắt khoảng trắng, viết hoa bang, giữ các trường còn lại", () => {
    expect(
      parseCreateProviderInput({
        doctors: "  Hoang Anh Phan  ",
        facility: "",
        city: " Houston ",
        state: "tx",
        zip_code: "77036",
        phone: "(713) 555-0123",
      })
    ).toMatchObject({
      ok: true,
      value: {
        doctors: "Hoang Anh Phan",
        facility: null,
        city: "Houston",
        state: "TX",
        zip_code: "77036",
        phone: "(713) 555-0123",
      },
    });
  });

  it("từ chối custom_values không phải object", () => {
    expect(parseCreateProviderInput({ doctors: "A", custom_values: [1, 2] })).toEqual({
      ok: false,
      error: "custom_values must be an object.",
    });
  });

  it("từ chối giá trị không phải chuỗi ở cột văn bản", () => {
    expect(parseCreateProviderInput({ doctors: "A", npi: 1407020035 })).toEqual({
      ok: false,
      error: "npi must be text.",
    });
  });
});

describe("buildProviderRow", () => {
  // Đây là điều giữ cho dòng thêm tay sống sót qua lượt sync: sync chỉ xoá đúng
  // phân vùng (source_sheet_id, source_gid) của Sheet.
  it("ghi dòng vào phân vùng riêng của portal, không phải phân vùng Sheet", () => {
    const row = buildProviderRow(
      { ...emptyInput(), doctors: "A" },
      { actorEmail: "Bao@X.com", nextRowNumber: 5 }
    );
    expect(row).toMatchObject({
      source_sheet_id: PORTAL_SOURCE.sheetId,
      source_gid: PORTAL_SOURCE.gid,
      source_row_number: 5,
      doctors: "A",
      created_by_email: "bao@x.com",
      updated_by_email: "bao@x.com",
    });
    expect(typeof row.source_row_hash).toBe("string");
    expect(row.raw_row).toEqual({});
  });

  it("ghi đủ mọi cột văn bản, kể cả cột để trống", () => {
    const row = buildProviderRow(
      { ...emptyInput(), facility: "Clinic" },
      { actorEmail: "bao@x.com", nextRowNumber: 1 }
    );
    for (const field of PROVIDER_TEXT_FIELDS) {
      expect(field in row, field).toBe(true);
    }
    expect(row.doctors).toBeNull();
  });
});
