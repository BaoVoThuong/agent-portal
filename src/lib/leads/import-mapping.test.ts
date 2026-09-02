import { describe, expect, it } from "vitest";
import {
  guessMappingByName,
  joinMappedValues,
  parseMappingPayload,
  sanitizeSuggestedMapping,
} from "./import-mapping";
import type { LeadImportTarget } from "./import-targets";

const targets: LeadImportTarget[] = [
  { key: "name", label: "Name", required: false, isCustom: false, allowsMultiple: true },
  { key: "phone", label: "Phone", required: true, isCustom: false, allowsMultiple: false },
  { key: "email", label: "Email", required: false, isCustom: false, allowsMultiple: false },
  {
    key: "secondary_phone",
    label: "Secondary Phone",
    required: false,
    isCustom: true,
    allowsMultiple: true,
  },
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
    ).toEqual({ name: ["Ho ten"], phone: ["SDT"], email: ["Mail"] });
  });

  it("BỎ cột model bịa ra", () => {
    // Model có thể trả về một tiêu đề không hề có trong file. Để lọt thì bước
    // parse sẽ hỏng với thông báo chẳng ai hiểu.
    expect(
      sanitizeSuggestedMapping({ name: "Ho ten", phone: "Cot Khong Ton Tai" }, headers, targets)
    ).toEqual({ name: ["Ho ten"] });
  });

  it("BỎ khoá đích không nằm trong danh sách", () => {
    expect(
      sanitizeSuggestedMapping({ phone: "SDT", attempts: "SDT phu" }, headers, targets)
    ).toEqual({ phone: ["SDT"] });
  });

  it("một cột nguồn chỉ được dùng cho MỘT đích", () => {
    // Model hay map cả `phone` lẫn `secondary_phone` vào cùng một cột. Giữ đích
    // đầu tiên theo thứ tự danh sách, bỏ cái sau.
    expect(
      sanitizeSuggestedMapping({ phone: "SDT", secondary_phone: "SDT" }, headers, targets)
    ).toEqual({ phone: ["SDT"] });
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
      name: ["Full Name"],
      phone: ["Mobile"],
      email: ["E-mail"],
    });
  });

  it("khớp cột custom theo nhãn, không phân biệt hoa thường và dấu cách", () => {
    expect(guessMappingByName(["Phone", "secondary phone"], targets).secondary_phone).toEqual([
      "secondary phone",
    ]);
  });

  it("không khớp thì bỏ trống, KHÔNG đoán bừa", () => {
    // Đoán bừa tệ hơn để trống: người dùng thấy ô trống thì biết phải chọn, còn
    // thấy một lựa chọn sai thì tin và bấm Import.
    expect(guessMappingByName(["Column1", "Column2"], targets)).toEqual({});
  });

  it("một cột nguồn không bị gán cho hai đích", () => {
    const out = guessMappingByName(["Phone number", "Name"], targets);
    const values = Object.values(out).flat();
    expect(values).toEqual([...new Set(values)]);
  });
});

describe("ghép nhiều cột", () => {
  const multiTargets: LeadImportTarget[] = [
    { key: "name", label: "Name", required: false, isCustom: false, allowsMultiple: true },
    { key: "phone", label: "Phone", required: true, isCustom: false, allowsMultiple: false },
  ];
  const multiHeaders = ["First Name", "Last Name", "Phone", "Phone 2"];

  it("nhận mảng cho trường ghép được — đây là ca First/Last Name", () => {
    expect(
      sanitizeSuggestedMapping(
        { name: ["First Name", "Last Name"], phone: "Phone" },
        multiHeaders,
        multiTargets
      )
    ).toEqual({ name: ["First Name", "Last Name"], phone: ["Phone"] });
  });

  it("trường KHÔNG ghép được thì chỉ lấy cột đầu", () => {
    // Ghép hai cột điện thoại ra một chuỗi 20 chữ số vô nghĩa sau khi
    // normalizePhone bỏ hết ký tự không phải số.
    expect(
      sanitizeSuggestedMapping({ phone: ["Phone", "Phone 2"] }, multiHeaders, multiTargets)
    ).toEqual({ phone: ["Phone"] });
  });

  it("bỏ cột bịa nằm giữa mảng nhưng giữ phần còn lại", () => {
    expect(
      sanitizeSuggestedMapping(
        { name: ["First Name", "Cot Ma", "Last Name"] },
        multiHeaders,
        multiTargets
      )
    ).toEqual({ name: ["First Name", "Last Name"] });
  });
});

describe("joinMappedValues", () => {
  it("nối bằng một dấu cách", () => {
    expect(joinMappedValues(["An", "Nguyen"])).toBe("An Nguyen");
  });

  it("bỏ phần rỗng, không để lại dấu cách thừa", () => {
    // "An " với dấu cách cuối rồi sẽ nằm trong DB và hiện lên màn hình.
    expect(joinMappedValues(["An", "", null, undefined])).toBe("An");
  });

  it("rỗng hết thì trả null", () => {
    expect(joinMappedValues(["", null])).toBeNull();
    expect(joinMappedValues([])).toBeNull();
  });

  it("cắt khoảng trắng hai đầu từng phần", () => {
    expect(joinMappedValues(["  An  ", " Nguyen "])).toBe("An Nguyen");
  });
});

describe("parseMappingPayload", () => {
  it("nhận mảng chuỗi — dạng client đang gửi", () => {
    expect(parseMappingPayload({ name: ["First", "Last"], phone: ["Cell"] })).toEqual({
      name: ["First", "Last"],
      phone: ["Cell"],
    });
  });

  it("nhận cả chuỗi trần, bọc thành mảng", () => {
    // Bộ lọc cũ ở route chỉ nhận chuỗi, nên khi mapping đổi sang mảng thì mọi
    // cặp bị vứt lặng lẽ và import trả 400 dù người dùng đã chọn cột.
    expect(parseMappingPayload({ phone: "Cell" })).toEqual({ phone: ["Cell"] });
  });

  it("bỏ trường rỗng và giá trị không phải chuỗi", () => {
    expect(
      parseMappingPayload({ phone: ["Cell"], a: [], b: 42, c: [1, "X"], d: null })
    ).toEqual({ phone: ["Cell"], c: ["X"] });
  });

  it("payload méo thì trả rỗng, không nổ", () => {
    expect(parseMappingPayload(null)).toEqual({});
    expect(parseMappingPayload("linh tinh")).toEqual({});
    expect(parseMappingPayload([1, 2])).toEqual({});
  });
});
