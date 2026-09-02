import { describe, expect, it } from "vitest";
import { partitionImportRows } from "./import-validate";
import type { ParsedLead } from "./import-parse";
import type { WriteValidationContext } from "@/lib/table-config/custom-values";
import type { TableColumn } from "@/lib/table-config/types";

const column = (over: Partial<TableColumn>): TableColumn =>
  ({
    id: "col-1",
    scope: "lead",
    key: "secondary_phone",
    label: "Secondary Phone",
    type: "text",
    is_system: false,
    position: 1,
    hidden_default: false,
    required: false,
    pinned: false,
    show_in_detail: true,
    archived_at: null,
    ...over,
  }) as TableColumn;

const context = (columns: TableColumn[]): WriteValidationContext => ({
  columns,
  options: [],
  matchedPersonEmails: [],
});

const lead = (over: Partial<ParsedLead> = {}): ParsedLead => ({
  row: 2,
  full_name: "Test Person",
  phone: "7145550123",
  email: null,
  custom_values: {},
  ...over,
});

describe("partitionImportRows", () => {
  it("BỎ QUA header không có trong cấu hình, KHÔNG loại cả dòng", () => {
    // Ca quan trọng nhất của cả file. import-parse nhét MỌI header Excel không
    // map vào custom_values; validateCustomValues từ chối key lạ. Nối thẳng hai
    // thứ đó là một file bình thường có cột "Notes" sẽ mất sạch dòng.
    const result = partitionImportRows(
      [lead({ custom_values: { notes: "gọi lại sau", secondary_phone: "7145550999" } })],
      context([column({})])
    );
    expect(result.valid).toHaveLength(1);
    expect(result.valid[0].custom_values).toEqual({ secondary_phone: "7145550999" });
    expect(result.ignoredHeaders).toEqual(["notes"]);
    expect(result.skipped).toEqual([]);
  });

  it("gom mỗi header bị bỏ qua đúng MỘT lần dù xuất hiện ở mọi dòng", () => {
    const result = partitionImportRows(
      [
        lead({ row: 2, custom_values: { notes: "a" } }),
        lead({ row: 3, custom_values: { notes: "b" } }),
      ],
      context([column({})])
    );
    expect(result.ignoredHeaders).toEqual(["notes"]);
    expect(result.valid).toHaveLength(2);
  });

  it("giá trị sai kiểu của cột ĐÃ cấu hình thì bỏ đúng dòng đó", () => {
    // Cột number: `validateCustomValues` đòi một SỐ thật, không ép "42" thành
    // 42. Ô Excel định dạng chữ sẽ về đây dưới dạng chuỗi và bị loại — đúng
    // như màn hình Add đang làm.
    const result = partitionImportRows(
      [
        lead({ row: 2, custom_values: { so: "bốn hai" } }),
        lead({ row: 3, custom_values: { so: 42 } }),
      ],
      context([column({ key: "so", label: "Số", type: "number" })])
    );
    expect(result.valid.map((r) => r.row)).toEqual([3]);
    expect(result.skipped[0].row).toBe(2);
    expect(result.skipped[0].reason).toContain("so");
  });

  it("thiếu cột bắt buộc thì bỏ đúng dòng đó, không hỏng cả lượt import", () => {
    const result = partitionImportRows(
      [lead({ row: 2 }), lead({ row: 3, custom_values: { secondary_phone: "7145550999" } })],
      context([column({ required: true })])
    );
    expect(result.valid.map((r) => r.row)).toEqual([3]);
    expect(result.skipped[0].reason).toContain("Secondary Phone");
  });

  it("lưu bản validateCustomValues trả về, không lưu bản thô", () => {
    // Bản trả về đã bị loại mọi key không cấu hình. Lưu bản thô là để Import và
    // Create lưu hai hình dạng khác nhau cho cùng một lead.
    const result = partitionImportRows(
      [lead({ custom_values: { so: 42, khong_cau_hinh: "x" } })],
      context([column({ key: "so", label: "Số", type: "number" })])
    );
    expect(result.valid[0].custom_values).toEqual({ so: 42 });
  });

  it("cột date chỉ đòi CHUỖI, không kiểm định dạng — cùng luật với Create", () => {
    // Ghi ra để người sau không tưởng là bỏ sót: `isValueValidForType` cho date
    // chỉ kiểm `typeof value === "string"`. Siết định dạng ở đây mà không siết
    // ở Create là tạo lại đúng cái lệch mà cả task này đang xoá bỏ.
    const result = partitionImportRows(
      [lead({ custom_values: { ngay: "không-phải-ngày" } })],
      context([column({ key: "ngay", label: "Ngày", type: "date" })])
    );
    expect(result.valid).toHaveLength(1);
  });

  it("danh sách rỗng trả về ba thứ rỗng", () => {
    expect(partitionImportRows([], context([]))).toEqual({
      valid: [],
      skipped: [],
      ignoredHeaders: [],
    });
  });
});
