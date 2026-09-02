import { validateCustomValues } from "@/lib/table-config/custom-values";
import type { WriteValidationContext } from "@/lib/table-config/custom-values";
import { findMissingRequiredFieldsFromContext } from "@/lib/table-config/required";
import type { ParsedLead } from "./import-parse";

/**
 * Tách hàng import thành hợp lệ / bị bỏ, và nói rõ header nào đã bị bỏ qua.
 *
 * Ba điều phải đúng cùng lúc, và điều thứ nhất là điều dễ làm sai nhất:
 *
 * 1. **Header không có trong cấu hình thì BỎ QUA, không loại cả dòng.**
 *    `parseLeadRows` nhét MỌI header Excel không được map vào `custom_values`,
 *    còn `validateCustomValues` từ chối key lạ bằng `unknown-column`. Nối thẳng
 *    hai thứ đó lại là một file bình thường có cột "Notes" sẽ mất sạch dòng.
 *    Người dùng dán file xuất từ hệ thống khác với hàng chục cột không liên
 *    quan — chuyện bình thường, không phải lỗi của họ. Nhưng cũng không im
 *    lặng: tên header bị bỏ được trả về để màn hình nói ra.
 *
 * 2. Cột ĐÃ cấu hình mà giá trị sai kiểu thì bỏ đúng dòng đó, kèm lý do.
 *
 * 3. Thiếu trường bắt buộc thì cũng chỉ bỏ dòng đó. Đánh hỏng 2.000 dòng vì
 *    một dòng là mất việc lớn vì việc nhỏ — và đó đúng là cách import đang xử
 *    lý "thiếu số điện thoại" với "trùng số trong file".
 */
export function partitionImportRows(
  rows: readonly ParsedLead[],
  context: WriteValidationContext
): {
  valid: ParsedLead[];
  skipped: { row: number; reason: string }[];
  ignoredHeaders: string[];
} {
  const configuredKeys = new Set(
    context.columns.filter((column) => !column.is_system).map((column) => column.key)
  );
  const valid: ParsedLead[] = [];
  const skipped: { row: number; reason: string }[] = [];
  const ignored = new Set<string>();

  for (const row of rows) {
    const known: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row.custom_values)) {
      if (configuredKeys.has(key)) known[key] = value;
      else ignored.add(key);
    }

    const validated = validateCustomValues(known, context);
    if (!validated.ok) {
      const first = validated.issues[0];
      skipped.push({
        row: row.row,
        reason: `${first.key}: ${first.reason.replace(/-/g, " ")}`,
      });
      continue;
    }

    // partial: false — import là một cửa TẠO lead, nên phải điền đủ trường bắt
    // buộc giống màn hình Add. `partial: true` là dành cho sửa từng ô.
    const missing = findMissingRequiredFieldsFromContext(context, {
      fieldValues: {
        name: row.full_name,
        phone: row.phone,
        email: row.email,
      },
      customValues: validated.values,
      partial: false,
    });
    if (missing.length > 0) {
      skipped.push({
        row: row.row,
        reason: `${missing.map((field) => field.label).join(", ")} required`,
      });
      continue;
    }

    // Bản ĐÃ chuẩn hoá, không phải bản thô: khác đi là Import và Create lưu hai
    // hình dạng khác nhau cho cùng một giá trị.
    valid.push({ ...row, custom_values: validated.values });
  }

  return { valid, skipped, ignoredHeaders: [...ignored].sort() };
}
