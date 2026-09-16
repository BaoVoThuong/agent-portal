import type { TableColumn } from "@/lib/table-config/types";

/**
 * Cột không bao giờ ẩn được: một dòng provider phải luôn tự nhận diện được.
 *
 * Dữ liệu thật có dòng chỉ có tên bác sĩ, có dòng chỉ có tên cơ sở (production
 * 16/09/2026: doctors 51%, facility 46%), nên khoá CẢ HAI. Khoá một cột sẽ để
 * lại những dòng trống hoàn toàn ở phần đầu bảng.
 */
export const PROVIDER_LIST_LOCKED_COLUMN_KEYS = new Set(["doctors", "facility"]);

export function toggleHiddenProviderListColumn(
  current: ReadonlySet<string>,
  key: string
): Set<string> {
  const next = new Set(current);
  if (PROVIDER_LIST_LOCKED_COLUMN_KEYS.has(key)) return next;
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

/**
 * Cấu hình chung thắng trước (`hidden_default`). Các cột còn lại theo lựa chọn
 * trong menu Table settings của từng người, trừ cột định danh và cột admin đã
 * ghim — hai loại đó phải luôn ở lại.
 */
export function visibleProviderListColumns(
  columns: readonly TableColumn[],
  hiddenKeys: ReadonlySet<string>
): TableColumn[] {
  return columns.filter(
    (column) =>
      !column.hidden_default &&
      (PROVIDER_LIST_LOCKED_COLUMN_KEYS.has(column.key) ||
        column.pinned ||
        !hiddenKeys.has(column.key))
  );
}
