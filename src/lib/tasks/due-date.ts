import { formatCustomValue } from "@/lib/table-config/values";
import type { TaskStatus } from "./types";

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
 * Múi giờ quyết định "hết ngày".
 *
 * Người dùng chốt Texas (2026-09-02). Gần như toàn bang là Central; chỉ vùng
 * El Paso ở cực tây là Mountain, và một tiếng lệch cho một góc bang không đáng
 * để dựng cấu hình theo từng người.
 */
export const TASK_DUE_DATE_TIMEZONE = "America/Chicago";

/**
 * Hôm nay là ngày nào, theo giờ Texas — dạng "YYYY-MM-DD".
 *
 * `en-CA` là locale cho ra đúng định dạng ISO, nên không phải tự ghép chuỗi.
 */
export function businessToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TASK_DUE_DATE_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * Quá hạn = ngày đến hạn nằm TRƯỚC hôm nay, tính theo giờ Texas.
 *
 * So CHUỖI "YYYY-MM-DD" chứ không làm toán trên `Date`. Hai lý do:
 *
 *  - Chuỗi ISO so từ điển đã ra đúng thứ tự thời gian, nên không cần dựng Date.
 *  - Bản trước dựng `new Date(...)` rồi so theo giờ MÁY ĐANG CHẠY. Trên trình
 *    duyệt của agent đó là giờ Texas (đúng), nhưng trong cron trên Vercel đó là
 *    UTC — sớm hơn 5–6 tiếng. Task hạn "Oct 9" bị cron coi là quá hạn từ 7 giờ
 *    tối Oct 9 giờ Texas, tức thông báo bay đi khi agent vẫn đang làm việc.
 *    Cùng một hàm mà server và browser cho hai câu trả lời khác nhau.
 *
 * "Đến hạn hôm nay" cố ý KHÔNG tính là quá hạn: còn cả ngày để làm.
 */
export function isTaskDueDateOverdue(
  value: string | null,
  now: Date = new Date()
): boolean {
  if (!value) return false;
  const due = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return false;
  return due < businessToday(now);
}

/** Trạng thái đã kết thúc thì không còn hạn nào để vỡ. */
const TERMINAL_STATUSES = new Set<TaskStatus>(["done", "cancel"]);

/**
 * Dòng task này có đang quá hạn Due Date không.
 *
 * Gộp hai điều kiện vào một chỗ vì chúng luôn đi cùng nhau: quá hạn **và** chưa
 * xong. `cancel` cũng tính là xong — huỷ là một kết cục hợp lệ, và tô đỏ một
 * task đã huỷ là đòi người ta làm một việc đã được quyết định là không làm nữa.
 */
export function isTaskRowDueDateOverdue(
  task: { status: TaskStatus; custom_values?: Record<string, unknown> | null },
  now: Date = new Date()
): boolean {
  if (TERMINAL_STATUSES.has(task.status)) return false;
  return isTaskDueDateOverdue(readTaskDueDate(task.custom_values), now);
}
