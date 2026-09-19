import { describe, expect, it } from "vitest";
import { buildProviderRow, parseCreateProviderInput } from "@/lib/providers/create";
import { PROVIDER_TEXT_FIELDS } from "@/lib/providers/types";

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

  it("chuẩn hoá plan thành chuỗi nhãn để tương thích Sheet", () => {
    expect(
      parseCreateProviderInput({
        doctors: "A",
        obamacare: ["UHC", "Oscar HMO", "UHC"],
      })
    ).toMatchObject({
      ok: true,
      value: { obamacare: "UHC, Oscar HMO" },
    });
  });

  it("chuẩn hoá Specialty thành chuỗi nhãn, giống hệt đường sửa", () => {
    // Form Thêm và form Sửa nay dùng chung một component ô nhiều lựa chọn, nên
    // cả hai đều gửi mảng lên. Trước đây chỉ PATCH nhận mảng, POST thì từ chối.
    expect(
      parseCreateProviderInput({
        doctors: "A",
        practices_as: ["PCP - Adults", "Opthamology"],
      })
    ).toMatchObject({
      ok: true,
      value: { practices_as: "PCP - Adults, Ophthalmology" },
    });
  });

  it("nhận cờ đã soát từ form, và từ chối kiểu khác boolean", () => {
    expect(
      parseCreateProviderInput({ doctors: "A", needs_review: true })
    ).toMatchObject({ ok: true, value: { needsReview: true } });
    expect(parseCreateProviderInput({ doctors: "A", needs_review: "yes" })).toEqual({
      ok: false,
      error: "needs_review must be a boolean.",
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
  // Dòng gõ tay không đến từ dòng Sheet nào. Bịa một số ở đây sẽ khiến người
  // tra nguồn mở nhầm dòng Sheet của người khác.
  it("để trống vết dẫn ngược về Sheet, và không đánh dấu cần soát", () => {
    const row = buildProviderRow(
      { ...emptyInput(), doctors: "A" },
      { actorEmail: "Bao@X.com" }
    );
    expect(row).toMatchObject({
      source_row_number: null,
      needs_review: false,
      doctors: "A",
      created_by_email: "bao@x.com",
      updated_by_email: "bao@x.com",
    });
  });

  // Bảng sạch không còn các cột của luồng sync; gửi kèm chúng là PostgREST
  // trả lỗi "column does not exist" và người dùng không thêm được dòng nào.
  it("không gửi cột nào của luồng sync cũ", () => {
    const row = buildProviderRow(
      { ...emptyInput(), doctors: "A" },
      { actorEmail: "bao@x.com" }
    );
    for (const dead of ["source_sheet_id", "source_gid", "source_row_hash", "raw_row"]) {
      expect(dead in row, dead).toBe(false);
    }
  });

  it("theo cờ đã soát mà form gửi lên, mặc định vẫn là đã soát", () => {
    expect(
      buildProviderRow({ ...emptyInput(), doctors: "A", needsReview: true }, {
        actorEmail: "bao@x.com",
      }).needs_review
    ).toBe(true);
  });

  it("ghi đủ mọi cột văn bản, kể cả cột để trống", () => {
    const row = buildProviderRow(
      { ...emptyInput(), facility: "Clinic" },
      { actorEmail: "bao@x.com" }
    );
    for (const field of PROVIDER_TEXT_FIELDS) {
      expect(field in row, field).toBe(true);
    }
    expect(row.doctors).toBeNull();
  });
});
