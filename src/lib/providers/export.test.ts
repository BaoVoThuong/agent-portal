import { describe, expect, it } from "vitest";
import { PROVIDER_IMPORT_ID_HEADER } from "@/lib/providers/import";
import { buildProviderExportMatrix } from "@/lib/providers/export";
import type { ProviderRow } from "@/lib/providers/types";
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

function row(overrides: Partial<ProviderRow> = {}): ProviderRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
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
    practices_as: "PCP - Adults, Cardiologist",
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

const COLUMNS = [
  column("doctors", "Doctor"),
  column("accepting_new_patients", "New Patient", "checkbox"),
  column("needs_review", "Reviewed", "checkbox"),
  column("business_hours", "Business hours"),
];

describe("buildProviderExportMatrix", () => {
  // Cột ID là thứ làm cho Xuất → sửa Excel → Nhập lại trở thành CẬP NHẬT chứ
  // không phải nhân đôi cả bảng. Bỏ nó đi là hỏng cả vòng.
  it("luôn đặt cột ID lên đầu", () => {
    const matrix = buildProviderExportMatrix([row()], COLUMNS);
    expect(matrix.header[0]).toBe(PROVIDER_IMPORT_ID_HEADER);
    expect(matrix.rows[0][0]).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("tiêu đề còn lại đúng bằng nhãn cột, để nhập lại khỏi phải map", () => {
    const matrix = buildProviderExportMatrix([row()], COLUMNS);
    expect(matrix.header).toEqual([
      "ID",
      "Doctor",
      "New Patient",
      "Reviewed",
      "Business hours",
    ]);
  });

  it("ô tick xuất ra Yes/No, và Reviewed là nghịch đảo của needs_review", () => {
    const matrix = buildProviderExportMatrix(
      [row({ accepting_new_patients: "No", needs_review: true })],
      COLUMNS
    );
    expect(matrix.rows[0][2]).toBe("No");
    expect(matrix.rows[0][3]).toBe("No");
  });

  it("dòng đã soát thì Reviewed là Yes", () => {
    const matrix = buildProviderExportMatrix([row({ needs_review: false })], COLUMNS);
    expect(matrix.rows[0][3]).toBe("Yes");
  });

  it("ô trống xuất ra chuỗi rỗng, không phải chữ null", () => {
    const matrix = buildProviderExportMatrix([row({ business_hours: null })], COLUMNS);
    expect(matrix.rows[0][4]).toBe("");
  });

  it("xuống dòng trong Business hours giữ nguyên", () => {
    const matrix = buildProviderExportMatrix(
      [row({ business_hours: "Mon - Fri: 8:00am - 5:00pm\nSat: 9am - 1pm" })],
      COLUMNS
    );
    expect(matrix.rows[0][4]).toContain("\n");
  });

  it("cột tuỳ chỉnh lấy từ custom_values", () => {
    const custom = { ...column("note", "Note"), is_system: false } as TableColumn;
    const matrix = buildProviderExportMatrix(
      [row({ custom_values: { note: "Vietnamese" } })],
      [custom]
    );
    expect(matrix.rows[0][1]).toBe("Vietnamese");
  });

  it("bỏ cột đã archive", () => {
    const archived = { ...column("npi", "NPI"), archived_at: "2026-01-01T00:00:00.000Z" };
    const matrix = buildProviderExportMatrix([row()], [...COLUMNS, archived]);
    expect(matrix.header).not.toContain("NPI");
  });
});
