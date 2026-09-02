import { describe, expect, it } from "vitest";
import { guessMappingByName, sanitizeSuggestedMapping } from "./import-mapping";
import type { LeadImportTarget } from "./import-targets";

const targets: LeadImportTarget[] = [
  { key: "name", label: "Name", required: false, isCustom: false },
  { key: "phone", label: "Phone", required: true, isCustom: false },
  { key: "email", label: "Email", required: false, isCustom: false },
  { key: "secondary_phone", label: "Secondary Phone", required: false, isCustom: true },
];
const headers = ["Ho ten", "SDT", "Mail", "SDT phu"];

describe("sanitizeSuggestedMapping", () => {
  it("giữ lại gợi ý hợp lệ", () => {
    expect(
      sanitizeSuggestedMapping(
        { name: "Ho ten", phone: "SDT", email: "Mail" },
        headers,
        targets
      )
    ).toEqual({ name: "Ho ten", phone: "SDT", email: "Mail" });
  });

  it("BỎ cột model bịa ra", () => {
    // Model có thể trả về một tiêu đề không hề có trong file. Để lọt thì bước
    // parse sẽ hỏng với thông báo chẳng ai hiểu.
    expect(
      sanitizeSuggestedMapping({ name: "Ho ten", phone: "Cot Khong Ton Tai" }, headers, targets)
    ).toEqual({ name: "Ho ten" });
  });

  it("BỎ khoá đích không nằm trong danh sách", () => {
    expect(
      sanitizeSuggestedMapping({ phone: "SDT", attempts: "SDT phu" }, headers, targets)
    ).toEqual({ phone: "SDT" });
  });

  it("một cột nguồn chỉ được dùng cho MỘT đích", () => {
    // Model hay map cả `phone` lẫn `secondary_phone` vào cùng một cột. Giữ đích
    // đầu tiên theo thứ tự danh sách, bỏ cái sau.
    expect(
      sanitizeSuggestedMapping({ phone: "SDT", secondary_phone: "SDT" }, headers, targets)
    ).toEqual({ phone: "SDT" });
  });

  it("chịu được JSON hỏng mà không nổ", () => {
    expect(sanitizeSuggestedMapping(null, headers, targets)).toEqual({});
    expect(sanitizeSuggestedMapping("linh tinh", headers, targets)).toEqual({});
    expect(sanitizeSuggestedMapping([1, 2], headers, targets)).toEqual({});
    expect(sanitizeSuggestedMapping({ phone: 42 }, headers, targets)).toEqual({});
  });
});

describe("guessMappingByName", () => {
  it("khớp tiêu đề tiếng Anh thông dụng", () => {
    expect(guessMappingByName(["Full Name", "Mobile", "E-mail"], targets)).toEqual({
      name: "Full Name",
      phone: "Mobile",
      email: "E-mail",
    });
  });

  it("khớp cột custom theo nhãn, không phân biệt hoa thường và dấu cách", () => {
    expect(guessMappingByName(["Phone", "secondary phone"], targets).secondary_phone).toBe(
      "secondary phone"
    );
  });

  it("không khớp thì bỏ trống, KHÔNG đoán bừa", () => {
    // Đoán bừa tệ hơn để trống: người dùng thấy ô trống thì biết phải chọn, còn
    // thấy một lựa chọn sai thì tin và bấm Import.
    expect(guessMappingByName(["Column1", "Column2"], targets)).toEqual({});
  });

  it("một cột nguồn không bị gán cho hai đích", () => {
    const out = guessMappingByName(["Phone number", "Name"], targets);
    const values = Object.values(out);
    expect(values).toEqual([...new Set(values)]);
  });
});
