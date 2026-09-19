import { describe, expect, it } from "vitest";
import {
  PROVIDER_IMPORT_ID_HEADER,
  PROVIDER_IMPORT_MANAGED_KEYS,
  PROVIDER_IMPORT_TEMPLATE_HEADERS,
  matchProviderHeaders,
  parseProviderImportRows,
  providerImportPayload,
} from "@/lib/providers/import";
import type { TableColumn } from "@/lib/table-config/types";

function column(key: string, label: string, type: TableColumn["type"] = "text"): TableColumn {
  return {
    id: `col-${key}`,
    scope: "provider",
    key,
    label,
    type,
    position: 10,
    hidden_default: false,
    required: false,
    is_system: true,
    archived_at: null,
  } as TableColumn;
}

const COLUMNS = [
  column("doctors", "Doctor"),
  column("facility", "Facility"),
  column("npi", "NPI"),
  column("practices_as", "Specialty", "multiselect"),
  column("street", "Street"),
  column("zip_code", "ZIP"),
  column("accepting_new_patients", "New Patient", "checkbox"),
  column("needs_review", "Reviewed", "checkbox"),
  column("obamacare", "ACA plans", "multiselect"),
  column("created_at", "Added on", "date"),
];

describe("matchProviderHeaders", () => {
  // Người dùng Xuất ra rồi sửa trong Excel rồi Nhập lại. Tiêu đề file xuất ra
  // chính là `label` của cột, nên khớp theo label là đủ và KHÔNG cần bước map.
  it("khớp theo đúng nhãn cột của file xuất ra", () => {
    const matched = matchProviderHeaders(["Doctor", "Facility", "ZIP"], COLUMNS);
    expect(matched.byHeader.get("Doctor")).toBe("doctors");
    expect(matched.byHeader.get("Facility")).toBe("facility");
    expect(matched.byHeader.get("ZIP")).toBe("zip_code");
    expect(matched.ignored).toEqual([]);
  });

  it("bỏ qua hoa thường, khoảng trắng và dấu gạch", () => {
    const matched = matchProviderHeaders(["  new   patient ", "aca_plans"], COLUMNS);
    expect(matched.byHeader.get("  new   patient ")).toBe("accepting_new_patients");
    expect(matched.byHeader.get("aca_plans")).toBe("obamacare");
  });

  it("khớp cả theo khoá cột, cho file gõ tay", () => {
    const matched = matchProviderHeaders(["zip_code", "practices_as"], COLUMNS);
    expect(matched.byHeader.get("zip_code")).toBe("zip_code");
    expect(matched.byHeader.get("practices_as")).toBe("practices_as");
  });

  it("nhận vài cách gọi khác hay gặp", () => {
    const matched = matchProviderHeaders(["Doctors", "Zip Code", "Obamacare"], COLUMNS);
    expect(matched.byHeader.get("Doctors")).toBe("doctors");
    expect(matched.byHeader.get("Zip Code")).toBe("zip_code");
    expect(matched.byHeader.get("Obamacare")).toBe("obamacare");
  });

  // Im lặng bỏ cột là mất dữ liệu mà người dùng tưởng đã nhập xong.
  it("báo lại những tiêu đề không khớp cột nào", () => {
    const matched = matchProviderHeaders(["Doctor", "Ghi chú riêng"], COLUMNS);
    expect(matched.ignored).toEqual(["Ghi chú riêng"]);
  });

  it("cột chỉ-đọc không nhận dữ liệu nhập vào", () => {
    const matched = matchProviderHeaders(["Added on"], COLUMNS);
    expect(matched.byHeader.has("Added on")).toBe(false);
    expect(matched.ignored).toEqual(["Added on"]);
  });

  it("hai tiêu đề cùng trỏ một cột thì chỉ cái đầu được nhận", () => {
    const matched = matchProviderHeaders(["Doctor", "doctors"], COLUMNS);
    expect(matched.byHeader.get("Doctor")).toBe("doctors");
    expect(matched.byHeader.has("doctors")).toBe(false);
    expect(matched.ignored).toEqual(["doctors"]);
  });
});

describe("parseProviderImportRows", () => {
  const matched = matchProviderHeaders(
    ["ID", "Doctor", "Facility", "ZIP", "New Patient", "Specialty"],
    COLUMNS
  );

  it("dòng có ID là CẬP NHẬT, không có ID là THÊM MỚI", () => {
    const parsed = parseProviderImportRows(
      [
        { ID: "11111111-1111-4111-8111-111111111111", Doctor: "A", Facility: null },
        { ID: null, Doctor: "B", Facility: null },
      ],
      matched,
      COLUMNS
    );
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0].mode).toBe("update");
    expect(parsed.rows[0].id).toBe("11111111-1111-4111-8111-111111111111");
    expect(parsed.rows[1].mode).toBe("create");
    expect(parsed.rows[1].id).toBeNull();
  });

  it("bỏ dòng không có cả tên bác sĩ lẫn tên cơ sở, đúng luật của server", () => {
    const parsed = parseProviderImportRows(
      [{ Doctor: "  ", Facility: null, ZIP: "77036" }],
      matched,
      COLUMNS
    );
    expect(parsed.rows).toHaveLength(0);
    expect(parsed.skipped).toEqual([
      { row: 2, reason: "Missing both Doctor and Facility" },
    ]);
  });

  it("bỏ dòng có ID sai định dạng, không im lặng biến nó thành dòng mới", () => {
    const parsed = parseProviderImportRows(
      [{ ID: "khong-phai-uuid", Doctor: "A" }],
      matched,
      COLUMNS
    );
    expect(parsed.rows).toHaveLength(0);
    expect(parsed.skipped[0].reason).toContain("ID");
  });

  it("ô tick nhận Yes/No, true/false, 1/0", () => {
    const parsed = parseProviderImportRows(
      [
        { Doctor: "A", "New Patient": "Yes" },
        { Doctor: "B", "New Patient": "no" },
        { Doctor: "C", "New Patient": true },
        { Doctor: "D", "New Patient": 0 },
      ],
      matched,
      COLUMNS
    );
    expect(parsed.rows.map((row) => row.values.accepting_new_patients)).toEqual([
      true,
      false,
      true,
      false,
    ]);
  });

  it("ô nhiều lựa chọn tách theo dấu phẩy thành mảng", () => {
    const parsed = parseProviderImportRows(
      [{ Doctor: "A", Specialty: "PCP - Adults, Cardiologist" }],
      matched,
      COLUMNS
    );
    expect(parsed.rows[0].values.practices_as).toEqual(["PCP - Adults", "Cardiologist"]);
  });

  it("số trong Excel về đúng chuỗi, không thành 7.7036e4", () => {
    const parsed = parseProviderImportRows([{ Doctor: "A", ZIP: 77036 }], matched, COLUMNS);
    expect(parsed.rows[0].values.zip_code).toBe("77036");
  });

  it("ô trống nghĩa là XOÁ giá trị, không phải bỏ qua", () => {
    const parsed = parseProviderImportRows(
      [{ ID: "11111111-1111-4111-8111-111111111111", Doctor: "A", Facility: "" }],
      matched,
      COLUMNS
    );
    expect(parsed.rows[0].values.facility).toBeNull();
  });

  it("số dòng báo lỗi là số dòng người dùng THẤY trong Excel", () => {
    const parsed = parseProviderImportRows(
      [{ Doctor: "A" }, { Doctor: null, Facility: null }],
      matched,
      COLUMNS
    );
    expect(parsed.skipped[0].row).toBe(3);
  });

  it("cột ID luôn được nhận diện dù người dùng có xoá cột khác", () => {
    expect(PROVIDER_IMPORT_ID_HEADER).toBe("ID");
  });
});

describe("providerImportPayload", () => {
  const columns = [
    column("doctors", "Doctor"),
    column("facility", "Facility"),
    column("needs_review", "Reviewed", "checkbox"),
    column("accepting_new_patients", "New Patient", "checkbox"),
    column("practices_as", "Specialty", "multiselect"),
    { ...column("note", "Note"), is_system: false } as TableColumn,
  ];

  // Đây là khác biệt SỐNG CÒN so với payload của form sửa: form gửi mọi cột nên
  // ô nào trống là xoá. File nhập chỉ có vài cột — gửi mọi cột thì một file hai
  // cột sẽ xoá sạch phần còn lại của 458 dòng.
  it("CHỈ gửi những cột có trong file", () => {
    const body = providerImportPayload({ doctors: "A" }, columns);
    expect(body).toEqual({ doctors: "A" });
    expect("facility" in body).toBe(false);
    expect("custom_values" in body).toBe(false);
  });

  it("Reviewed trên file là nghịch đảo của needs_review trong bảng", () => {
    expect(providerImportPayload({ needs_review: true }, columns).needs_review).toBe(false);
    expect(providerImportPayload({ needs_review: false }, columns).needs_review).toBe(true);
  });

  it("New Patient thành chữ Yes/No", () => {
    expect(
      providerImportPayload({ accepting_new_patients: true }, columns).accepting_new_patients
    ).toBe("Yes");
    expect(
      providerImportPayload({ accepting_new_patients: false }, columns).accepting_new_patients
    ).toBe("No");
  });

  it("cột tuỳ chỉnh đi vào custom_values", () => {
    expect(providerImportPayload({ note: "Vietnamese" }, columns)).toEqual({
      custom_values: { note: "Vietnamese" },
    });
  });

  it("giữ mảng cho ô nhiều lựa chọn để server tự nối chuỗi", () => {
    expect(
      providerImportPayload({ practices_as: ["PCP - Adults"] }, columns).practices_as
    ).toEqual(["PCP - Adults"]);
  });

  it("bỏ qua khoá không phải cột nào", () => {
    expect(providerImportPayload({ khong_ton_tai: "x" }, columns)).toEqual({});
  });
});

describe("Verified by / Verified date do hệ thống đặt", () => {
  const COLS = [
    column("doctors", "Doctor"),
    column("verified_by", "Verified by"),
    column("date", "Verified date"),
  ];

  it("hai cột đó không nhận giá trị từ file", () => {
    expect([...PROVIDER_IMPORT_MANAGED_KEYS]).toEqual(["verified_by", "date"]);
    const matched = matchProviderHeaders(["Doctor", "Verified by", "Verified date"], COLS);
    expect(matched.byHeader.has("Verified by")).toBe(false);
    expect(matched.byHeader.has("Verified date")).toBe(false);
  });

  // Không xếp vào `ignored`: chúng KHÔNG bị bỏ, chúng bị GHI ĐÈ. Báo là "đã bỏ
  // qua" thì người dùng tưởng dữ liệu biến mất.
  it("báo riêng là do hệ thống đặt, không lẫn vào danh sách bị bỏ", () => {
    const matched = matchProviderHeaders(["Verified by", "Ghi chú riêng"], COLS);
    expect(matched.managed).toEqual(["Verified by"]);
    expect(matched.ignored).toEqual(["Ghi chú riêng"]);
  });

  it("mọi dòng đều nhận người nhập và ngày nhập, kể cả dòng cập nhật", () => {
    const matched = matchProviderHeaders(["ID", "Doctor"], COLS);
    const parsed = parseProviderImportRows(
      [
        { ID: "11111111-1111-4111-8111-111111111111", Doctor: "A" },
        { ID: null, Doctor: "B" },
      ],
      matched,
      COLS,
      { verifiedBy: "Khang Nguyen", verifiedDate: "09/19/2026" }
    );
    for (const row of parsed.rows) {
      expect(row.values.verified_by).toBe("Khang Nguyen");
      expect(row.values.date).toBe("09/19/2026");
    }
  });

  it("giá trị trong file bị ghi đè, kể cả số sê-ri ngày của Excel", () => {
    const matched = matchProviderHeaders(["Doctor", "Verified date"], COLS);
    const parsed = parseProviderImportRows(
      [{ Doctor: "A", "Verified date": 46118.0003472 }],
      matched,
      COLS,
      { verifiedBy: "Khang Nguyen", verifiedDate: "09/19/2026" }
    );
    expect(parsed.rows[0].values.date).toBe("09/19/2026");
  });

  it("không truyền thì không tự bịa giá trị", () => {
    const matched = matchProviderHeaders(["Doctor"], COLS);
    const parsed = parseProviderImportRows([{ Doctor: "A" }], matched, COLS);
    expect("verified_by" in parsed.rows[0].values).toBe(false);
    expect("date" in parsed.rows[0].values).toBe(false);
  });
});

describe("file mẫu khớp được hết", () => {
  // Đây là header thật của Google Sheet đội đang dùng. Đổi cách đặt tên cột
  // trong /config mà quên bộ alias là file mẫu im lặng hỏng, nên khoá lại.
  const ALL = [
    column("facility", "Facility"),
    column("doctors", "Doctor"),
    column("npi", "NPI"),
    column("practices_as", "Specialty", "multiselect"),
    column("accepting_new_patients", "New Patient", "checkbox"),
    column("business_hours", "Business hours"),
    column("phone", "Phone"),
    column("street", "Street"),
    column("city", "City"),
    column("state", "State"),
    column("zip_code", "ZIP"),
    column("obamacare", "ACA plans", "multiselect"),
    column("medicare", "Medicare plans", "multiselect"),
    column("other_plans", "Other plans"),
  ];

  it("mọi tiêu đề của file mẫu đều khớp một cột", () => {
    const matched = matchProviderHeaders([...PROVIDER_IMPORT_TEMPLATE_HEADERS], ALL);
    expect(matched.ignored).toEqual([]);
    expect(matched.managed).toEqual([]);
    expect(matched.byHeader.size).toBe(PROVIDER_IMPORT_TEMPLATE_HEADERS.length);
  });

  it("khớp đúng cột chứ không chỉ khớp số lượng", () => {
    const matched = matchProviderHeaders([...PROVIDER_IMPORT_TEMPLATE_HEADERS], ALL);
    expect(matched.byHeader.get("Doctors")).toBe("doctors");
    expect(matched.byHeader.get("Practices As")).toBe("practices_as");
    expect(matched.byHeader.get("Accepting New Patients")).toBe("accepting_new_patients");
    expect(matched.byHeader.get("Zip Code")).toBe("zip_code");
    expect(matched.byHeader.get("ObamaCare")).toBe("obamacare");
    expect(matched.byHeader.get("Medicare")).toBe("medicare");
    expect(matched.byHeader.get("Other Plans")).toBe("other_plans");
  });
});
