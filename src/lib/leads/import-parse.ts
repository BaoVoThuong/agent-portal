import type { LeadImportMapping } from "./import-mapping";

export type ParsedLead = {
  /** Số dòng trong file Excel, để lý do bỏ hàng chỉ đúng dòng người dùng thấy. */
  row: number;
  full_name: string | null;
  phone: string;
  email: string | null;
  custom_values: Record<string, unknown>;
};

export type ParseResult = {
  rows: ParsedLead[];
  skipped: { row: number; reason: string }[];
};

/** Ba khoá này đổ vào cột thật trên bảng `leads`, không vào `custom_values`. */
const SYSTEM_TARGET_KEYS = new Set(["name", "phone", "email"]);

/** Normalize the phone formats commonly produced by US spreadsheets. */
export function normalizePhone(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const source = typeof raw === "number"
    ? Number.isFinite(raw) ? String(Math.trunc(raw)) : ""
    : String(raw);
  const digits = source.replace(/\D+/g, "");
  if (digits.length === 0) return null;
  const trimmed = digits.length === 11 && digits.startsWith("1")
    ? digits.slice(1)
    : digits;
  return trimmed.length >= 7 ? trimmed : null;
}

function cell(record: Record<string, unknown>, key: string | undefined): string | null {
  if (!key) return null;
  const value = record[key];
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

/**
 * Convert sheet records to canonical lead rows. `row` in skipped results is the
 * visible Excel row number (header is row 1), so a user can find it directly.
 */
export function parseLeadRows(
  records: readonly Record<string, unknown>[],
  mapping: LeadImportMapping
): ParseResult {
  const rows: ParsedLead[] = [];
  const skipped: ParseResult["skipped"] = [];
  const seenPhones = new Set<string>();

  records.forEach((record, index) => {
    const excelRow = index + 2;
    const phone = normalizePhone(cell(record, mapping.phone));
    if (!phone) {
      skipped.push({ row: excelRow, reason: "Missing phone number" });
      return;
    }
    if (seenPhones.has(phone)) {
      skipped.push({ row: excelRow, reason: "Duplicate phone number in this file" });
      return;
    }
    seenPhones.add(phone);

    // CHỈ cột được map mới vào custom_values, và vào đúng khoá cột đích.
    //
    // Bản trước nhặt MỌI cột không map theo tên đã slugify — một phỏng đoán,
    // không phải lựa chọn của người dùng. Giữ cả hai cơ chế là để chúng cùng
    // quyết một chuyện rồi mâu thuẫn nhau.
    const customValues: Record<string, unknown> = {};
    for (const [targetKey, header] of Object.entries(mapping)) {
      if (SYSTEM_TARGET_KEYS.has(targetKey)) continue;
      const value = record[header];
      if (value === null || value === undefined || value === "") continue;
      customValues[targetKey] = value;
    }

    const email = cell(record, mapping.email);
    rows.push({
      row: excelRow,
      full_name: cell(record, mapping.name),
      phone,
      email: email ? email.toLowerCase() : null,
      custom_values: customValues,
    });
  });

  return { rows, skipped };
}
