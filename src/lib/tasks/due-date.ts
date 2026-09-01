import { formatCustomValue } from "@/lib/table-config/values";

/**
 * Due Date của Customer Service Tasks là một CUSTOM column (scope `cs`), không
 * phải cột trên bảng `tasks` — nó nằm trong `custom_values.due_date`. Khoá được
 * đặt tên ở đây một lần để List, Board và lớp quyền không ai gõ lại chuỗi đó.
 */
export const TASK_DUE_DATE_KEY = "due_date";

/** Giá trị due date thô (`YYYY-MM-DD`), hoặc null khi task chưa đặt hạn. */
export function readTaskDueDate(
  customValues: Record<string, unknown> | null | undefined
): string | null {
  const raw = customValues?.[TASK_DUE_DATE_KEY];
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  return value === "" ? null : value;
}

/**
 * "Oct 9". Uỷ quyền cho `formatCustomValue` thay vì tự định dạng: cột trong
 * List đã hiển thị qua hàm đó, nên viết bản thứ hai là mở đường cho Board và
 * List nói khác nhau về cùng một ngày.
 */
export function formatTaskDueDate(value: string | null): string | null {
  if (!value) return null;
  return formatCustomValue("date", value) || null;
}

/**
 * Quá hạn = hạn nằm TRƯỚC hôm nay, so theo ngày lịch địa phương.
 *
 * "Đến hạn hôm nay" cố ý KHÔNG tính là quá hạn: người ta vẫn còn cả ngày để
 * làm, tô đỏ lúc đó là báo động sai. Cắt theo ngày chứ không theo mốc thời gian
 * cũng tránh chuyện một task đổi màu vào giữa trưa chỉ vì trôi qua một giờ.
 */
export function isTaskDueDateOverdue(
  value: string | null,
  now: Date = new Date()
): boolean {
  if (!value) return false;
  const due = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(due.getTime())) return false;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return due.getTime() < today.getTime();
}
