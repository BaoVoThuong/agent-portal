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
 * Cột nào lên bảng.
 *
 * Khác Task List và Event Leads: ở đây `hidden_default` chỉ là **giá trị khởi
 * đầu**, không phải bản án. Bảng provider có nhiều cột thưa dữ liệu nên mặc định
 * ẩn (Other plans 0/889 dòng, Verified by 1%, nhóm siêu dữ liệu); nếu người dùng
 * không tự bật lại được thì họ phải nhờ admin vào `/config` cho một việc thuần
 * cá nhân. `initialHiddenProviderColumnKeys` nạp sẵn chúng vào tập ẩn, và bỏ
 * tick trong menu là hiện.
 *
 * Cột định danh và cột admin đã ghim vẫn luôn ở lại.
 */
export function visibleProviderListColumns(
  columns: readonly TableColumn[],
  hiddenKeys: ReadonlySet<string>
): TableColumn[] {
  return columns.filter(
    (column) =>
      PROVIDER_LIST_LOCKED_COLUMN_KEYS.has(column.key) ||
      column.pinned ||
      !hiddenKeys.has(column.key)
  );
}

/**
 * Tập cột ẩn lúc mới mở bảng, khi người này chưa từng lưu lựa chọn riêng.
 * Chính là các cột admin đánh `hidden_default`.
 */
export function initialHiddenProviderColumnKeys(
  columns: readonly TableColumn[]
): Set<string> {
  return new Set(
    columns
      .filter(
        (column) =>
          column.hidden_default &&
          !column.pinned &&
          !PROVIDER_LIST_LOCKED_COLUMN_KEYS.has(column.key)
      )
      .map((column) => column.key)
  );
}
