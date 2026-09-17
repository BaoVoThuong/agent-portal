/**
 * Bảng mà Provider List đọc/ghi.
 *
 * KHÔNG phải `provider_address`: bảng đó bị `promote_sheet_sync_run` xoá sạch
 * theo cặp (source_sheet_id, source_gid) rồi chèn lại từ Google Sheet mỗi đêm,
 * nên mọi chỉnh sửa tay trên đó sống không quá một đêm. `provider_directory`
 * nằm ngoài tầm với của sync — đó là toàn bộ lý do nó tồn tại — và chứa bản dữ
 * liệu đã làm sạch (chuẩn hoá điện thoại/bang/ZIP, tách dòng nhiều cơ sở).
 *
 * Provider Finder đọc CÙNG bảng này. Hai tab nằm trên cùng một màn hình, nên
 * đọc hai bảng khác nhau là người dùng thấy dữ liệu vênh nhau ngay tại chỗ.
 */
export const PROVIDER_TABLE = "provider_directory";

/**
 * Các cột văn bản của provider mà màn hình đọc/ghi. Tên trùng cột trong
 * `provider_directory`, và trùng `table_column.key` của scope `provider` — một
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
  "source_row_number",
  ...PROVIDER_TEXT_FIELDS,
  "custom_values",
  "needs_review",
  "created_at",
  "created_by_email",
  "updated_by_email",
  "updated_at",
  "archived_at",
].join(",");

/**
 * Cột siêu dữ liệu: chỉ đọc, ẩn mặc định.
 *
 * Không ai gõ tay vào những cột này, nhưng chúng trả lời câu hỏi hay gặp:
 * "dòng này ai thêm / sửa lần cuối".
 */
export const PROVIDER_META_FIELDS = [
  "created_at",
  "updated_at",
  "created_by_email",
  "updated_by_email",
] as const;

export type ProviderMetaField = (typeof PROVIDER_META_FIELDS)[number];

export type ProviderRow = {
  id: string;
  /**
   * Vết dẫn ngược về dòng trong Google Sheet, để đội còn tra được nguồn gốc.
   * Không phải khoá: một dòng Sheet có thể đã tách thành nhiều bản ghi ở đây,
   * và dòng thêm tay trong portal thì không có dòng Sheet nào nên để trống.
   */
  source_row_number: number | null;
  custom_values: Record<string, unknown>;
  needs_review: boolean;
  created_at: string | null;
  created_by_email: string | null;
  updated_by_email: string | null;
  updated_at: string;
  archived_at: string | null;
} & Record<ProviderTextField, string | null>;

/**
 * Dòng này còn vấn đề cần người xử hay không.
 *
 * Lúc chuyển dữ liệu sang bảng sạch có 24 dòng không tự sửa được bằng quy tắc:
 * địa chỉ ghi "X's Locations" thay vì địa chỉ thật, ZIP bị che ("78xxx"), hoặc
 * địa chỉ gãy dòng không khớp số với điện thoại. Chúng vẫn hiện trong danh sách
 * — giấu đi thì không ai sửa — nhưng được đánh dấu để lọc ra mà làm.
 */
export function needsReview(row: Pick<ProviderRow, "needs_review">): boolean {
  return row.needs_review === true;
}
