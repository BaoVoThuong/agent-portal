import { describe, expect, it } from "vitest";
import type { TableColumn, TableColumnOption } from "@/lib/table-config/types";
import { LEAD_IMPORT_TEMPLATE } from "./import-template";
import { buildLeadTemplateSpec } from "./import-template-spec";

function column(key: string, label: string, type: TableColumn["type"]): TableColumn {
  return {
    id: `col-${key}`,
    scope: "lead",
    key,
    label,
    type,
    is_system: true,
    position: 1,
    pinned: false,
    hidden_default: false,
    show_in_detail: true,
    required: false,
    archived_at: null,
  } as TableColumn;
}

function option(columnKey: string, label: string, position: number): TableColumnOption {
  return {
    id: `${columnKey}-${label}`,
    column_id: `col-${columnKey}`,
    label,
    color: null,
    position,
    archived_at: null,
  };
}

describe("buildLeadTemplateSpec", () => {
  const COLS = [
    column("gender", "Gender", "dropdown"),
    column("insurance_needs", "Insurance Needs", "multiselect"),
    column("contact_method", "Contact Method", "multiselect"),
  ];
  const OPTIONS = [
    option("gender", "Male", 2),
    option("gender", "Female", 1),
    option("insurance_needs", "Health", 1),
  ];
  const AGENTS = [
    { email: "khang@x.com", name: "Khang Nguyễn" },
    { email: "an1@x.com", name: "An Tran" },
    { email: "an2@x.com", name: "An Tran" },
  ];
  const spec = buildLeadTemplateSpec(COLS, OPTIONS, AGENTS);
  const byHeader = new Map(spec.columns.map((c) => [c.header, c]));

  it("giữ đúng tiêu đề và thứ tự mẫu cố định", () => {
    expect(spec.kind).toBe("lead");
    expect(spec.columns.map((c) => c.header)).toEqual(
      LEAD_IMPORT_TEMPLATE.map((c) => c.header),
    );
  });

  it("dropdown theo Table Config, chỉ cảnh báo vì Import tự tạo nhãn mới", () => {
    expect(byHeader.get("Gender")?.dropdown).toEqual({
      values: ["Female", "Male"],
      allowOther: true,
    });
    expect(byHeader.get("Insurance Needs")?.dropdown?.values).toEqual(["Health"]);
    // Cột không có lựa chọn nào thì không có dropdown rỗng.
    expect(byHeader.get("Contact Method")?.dropdown).toBeUndefined();
    expect(byHeader.get("Full Name")?.dropdown).toBeUndefined();
  });

  it("không có dòng ví dụ", () => {
    expect(spec.columns.every((c) => c.example === "")).toBe(true);
  });

  it("Agent: tên, tên trùng thì email", () => {
    expect(byHeader.get("Agent")?.dropdown).toEqual({
      values: ["an1@x.com", "an2@x.com", "Khang Nguyễn"],
      allowOther: false,
      tracked: false,
    });
  });
});
