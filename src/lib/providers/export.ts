import type { TableColumn } from "@/lib/table-config/types";
import { PROVIDER_IMPORT_ID_HEADER } from "./import";
import type { ProviderRow } from "./types";

/**
 * Bảng dữ liệu để ghi ra file Excel.
 *
 * Tiêu đề dùng đúng `label` của cột, và cột đầu luôn là ID — đó là thứ làm cho
 * vòng Xuất → sửa trong Excel → Nhập lại trở thành CẬP NHẬT thay vì nhân đôi
 * cả bảng, và cũng là lý do màn hình nhập không cần hỏi map cột.
 */
export function buildProviderExportMatrix(
  records: readonly ProviderRow[],
  columns: readonly TableColumn[]
): { header: string[]; rows: string[][] } {
  const exportColumns = columns.filter((column) => !column.archived_at);
  return {
    header: [PROVIDER_IMPORT_ID_HEADER, ...exportColumns.map((column) => column.label)],
    rows: records.map((record) => [
      record.id,
      ...exportColumns.map((column) => formatCell(record, column)),
    ]),
  };
}

function formatCell(record: ProviderRow, column: TableColumn): string {
  if (column.key === "needs_review") {
    // Nhãn cột là "Reviewed", ngược nghĩa với `needs_review` trong bảng.
    return record.needs_review ? "No" : "Yes";
  }

  const raw = column.is_system
    ? (record[column.key as keyof ProviderRow] ?? null)
    : (record.custom_values?.[column.key] ?? null);

  if (raw === null || raw === undefined) return "";
  if (typeof raw === "boolean") return raw ? "Yes" : "No";
  if (Array.isArray(raw)) return raw.map((item) => String(item)).join(", ");
  return String(raw);
}
