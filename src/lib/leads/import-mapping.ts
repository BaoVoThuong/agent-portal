import type { LeadImportTarget } from "./import-targets";

/** Khoá cột đích → tiêu đề cột trong file. Thiếu khoá = chưa map. */
export type LeadImportMapping = Record<string, string>;

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
      mapping[target.key] = match;
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
    if (typeof value !== "string") continue;
    if (!headerSet.has(value)) continue;
    if (used.has(value)) continue;
    mapping[target.key] = value;
    used.add(value);
  }
  return mapping;
}
