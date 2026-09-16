/**
 * Phân vùng nguồn của dòng provider do người dùng thêm trong portal.
 *
 * `promote_sheet_sync_run` xoá theo ĐÚNG cặp (source_sheet_id, source_gid) của
 * Sheet rồi chèn lại từ staging. Dòng mang cặp này không nằm trong vùng bị xoá,
 * nên không lượt sync nào chạm tới được — đó là toàn bộ lý do nó tồn tại.
 */
export const PORTAL_SOURCE = { sheetId: "portal", gid: "manual" } as const;

/**
 * Các cột văn bản của provider mà màn hình đọc/ghi. Tên trùng cột trong
 * `provider_address`, và trùng `table_column.key` của scope `provider` — một
 * tên duy nhất đi suốt từ database lên tới cấu hình cột.
 */
export const PROVIDER_TEXT_FIELDS = [
  "doctors",
  "facility",
  "npi",
  "practices_as",
  "phone",
  "street",
  "city",
  "state",
  "zip_code",
  "accepting_new_patients",
  "business_hours",
  "obamacare",
  "medicare",
  "other_plans",
  "verified_by",
  "date",
] as const;

export type ProviderTextField = (typeof PROVIDER_TEXT_FIELDS)[number];

/**
 * Cột mà API trả về. Một hằng duy nhất cho cả route danh sách, route sửa và
 * trang server — ba nơi trả về hình dạng khác nhau là ba lần màn hình phải
 * đoán xem trường nào có mặt.
 */
export const PROVIDER_SELECT = [
  "id",
  "source_sheet_id",
  "source_gid",
  "source_row_number",
  ...PROVIDER_TEXT_FIELDS,
  "custom_values",
  "created_at",
  "synced_at",
  "created_by_email",
  "updated_by_email",
  "updated_at",
  "archived_at",
].join(",");

/**
 * Cột siêu dữ liệu: chỉ đọc, ẩn mặc định.
 *
 * Không ai gõ tay vào những cột này, nhưng chúng trả lời được hai câu hỏi hay
 * gặp: "dòng này ai thêm / sửa lần cuối" và "bản Sheet này cũ tới đâu".
 */
export const PROVIDER_META_FIELDS = [
  "created_at",
  "synced_at",
  "updated_at",
  "created_by_email",
  "updated_by_email",
] as const;

export type ProviderMetaField = (typeof PROVIDER_META_FIELDS)[number];

export type ProviderRow = {
  id: string;
  source_sheet_id: string;
  source_gid: string;
  source_row_number: number;
  custom_values: Record<string, unknown>;
  created_at: string | null;
  synced_at: string | null;
  created_by_email: string | null;
  updated_by_email: string | null;
  updated_at: string;
  archived_at: string | null;
} & Record<ProviderTextField, string | null>;

/**
 * Dòng này do người dùng thêm trong portal hay do Sheet đẩy sang.
 *
 * Người dùng cần thấy khác biệt đó trước khi sửa: sửa một dòng từ Sheet sẽ bị
 * ghi đè ở lượt sync kế tiếp, cho tới khi luồng sync được tắt.
 */
export function isPortalRow(row: Pick<ProviderRow, "source_sheet_id">): boolean {
  return row.source_sheet_id === PORTAL_SOURCE.sheetId;
}
