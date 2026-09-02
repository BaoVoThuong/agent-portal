import type { LeadImportTarget } from "./import-targets";

/**
 * Khoá cột đích → DANH SÁCH tiêu đề cột trong file. Thiếu khoá = chưa map.
 *
 * Luôn là mảng, kể cả khi chỉ có một cột. Một kiểu `string | string[]` thì mọi
 * nơi đọc nó đều phải nhớ kiểm hai nhánh, và chỗ nào quên là một lỗi im lặng.
 */
export type LeadImportMapping = Record<string, string[]>;

/**
 * Ghép các cột nguồn của một trường thành một giá trị.
 *
 * Nối bằng MỘT dấu cách, bỏ phần rỗng: "An" + "" không được ra "An " với dấu
 * cách thừa ở cuối, vì chuỗi đó rồi sẽ nằm trong DB và hiện lên màn hình.
 */
export function joinMappedValues(parts: readonly unknown[]): string | null {
  const pieces = parts
    .map((part) => (part === null || part === undefined ? "" : String(part).trim()))
    .filter((part) => part !== "");
  return pieces.length === 0 ? null : pieces.join(" ");
}

/** Luật đoán theo tên, dùng cho ba trường hệ thống. */
const NAME_PATTERNS: Record<string, RegExp> = {
  name: /(full\s*)?name|ho\s*ten|khach/i,
  phone: /phone|cell|mobile|sdt|so\s*dien\s*thoai/i,
  email: /e-?mail|mail/i,
};

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, " ");
}

/**
 * Đoán mapping từ tên cột, không gọi mạng.
 *
 * Chạy TRƯỚC khi hỏi AI, và là thứ hiện ra ngay nếu AI hỏng hoặc chậm. Đoán
 * bừa thì tệ hơn để trống: người dùng thấy ô trống thì biết phải chọn, còn thấy
 * một lựa chọn sai thì tin và bấm Import.
 */
export function guessMappingByName(
  headers: readonly string[],
  targets: readonly LeadImportTarget[]
): LeadImportMapping {
  const mapping: LeadImportMapping = {};
  const used = new Set<string>();
  for (const target of targets) {
    const pattern = NAME_PATTERNS[target.key];
    const label = normalize(target.label);
    const match = headers.find((header) => {
      if (used.has(header)) return false;
      if (pattern?.test(header)) return true;
      // Cột custom: khớp theo nhãn admin đặt.
      return normalize(header) === label;
    });
    if (match) {
      mapping[target.key] = [match];
      used.add(match);
    }
  }
  return mapping;
}

/**
 * Làm sạch gợi ý của model trước khi cho nó chạm vào giao diện.
 *
 * KHÔNG BAO GIỜ tin thẳng output của model. Bốn thứ nó làm sai được, và cả bốn
 * đều bị chặn ở đây — không phải để chống kẻ xấu, mà vì một bảng map trỏ vào
 * cột không tồn tại sẽ hỏng ở bước parse với thông báo chẳng ai hiểu.
 */
export function sanitizeSuggestedMapping(
  raw: unknown,
  headers: readonly string[],
  targets: readonly LeadImportTarget[]
): LeadImportMapping {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const headerSet = new Set(headers);
  const source = raw as Record<string, unknown>;

  const mapping: LeadImportMapping = {};
  const used = new Set<string>();
  // Duyệt theo THỨ TỰ DANH SÁCH ĐÍCH, không theo thứ tự khoá model trả về: khi
  // model map hai đích vào cùng một cột nguồn, đích đứng trước trong danh sách
  // được giữ — và thứ tự đó ổn định giữa các lần chạy.
  for (const target of targets) {
    const value = source[target.key];
    // Model được phép trả một chuỗi hoặc một mảng (khi nó muốn ghép cột).
    const candidates = typeof value === "string"
      ? [value]
      : Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string")
        : [];
    const picked: string[] = [];
    for (const header of candidates) {
      if (!headerSet.has(header)) continue;
      if (used.has(header)) continue;
      if (picked.includes(header)) continue;
      // Trường không cho ghép thì chỉ lấy cột đầu tiên hợp lệ.
      if (picked.length > 0 && !target.allowsMultiple) break;
      picked.push(header);
    }
    if (picked.length === 0) continue;
    mapping[target.key] = picked;
    for (const header of picked) used.add(header);
  }
  return mapping;
}

/**
 * Giá trị của một trường đích trên một hàng đã parse, để vẽ bảng xem trước.
 *
 * Ba trường hệ thống nằm ở cột riêng của `ParsedLead`; còn lại nằm trong
 * `custom_values` dưới đúng khoá cột đích.
 */
export function previewCellValue(
  row: {
    full_name: string | null;
    phone: string;
    email: string | null;
    custom_values: Record<string, unknown>;
  },
  targetKey: string
): string {
  if (targetKey === "name") return row.full_name ?? "—";
  if (targetKey === "phone") return row.phone;
  if (targetKey === "email") return row.email ?? "—";
  const value = row.custom_values[targetKey];
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}
