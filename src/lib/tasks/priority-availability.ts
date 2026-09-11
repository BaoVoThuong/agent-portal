import { TASK_PRIORITIES, type TaskPriority, type TaskSlaRule } from "./types";

/**
 * Tổ hợp Category × Priority nào đang BẬT.
 *
 * Đội nghiệp vụ cần "loại việc này không được đặt mức ưu tiên kia" — ví dụ
 * "Order Physical ID card" không được Urgent. Nay mỗi ô trong SLA Times có một
 * nút bật/tắt: tắt thì vừa không đặt được thời hạn, vừa không chọn được tổ hợp
 * khi tạo hay sửa task.
 *
 * Thứ tự tra CÙNG với `resolveSlaMinutes`, và phải giữ như vậy — nếu hai hàm tra
 * khác nhau sẽ có tổ hợp vừa bật vừa tắt tuỳ chỗ nào hỏi:
 *   1. Dòng khai riêng cho đúng category đó.
 *   2. Dòng mặc định của priority (category_id = null).
 *   3. Không có dòng nào → đang bật.
 */
type ToggleRule = Pick<TaskSlaRule, "priority" | "category_id" | "is_enabled">;

export function isPriorityEnabledForCategory(
  priority: TaskPriority,
  categoryId: string | null,
  rules: readonly ToggleRule[]
): boolean {
  if (categoryId) {
    const exact = rules.find(
      (rule) => rule.priority === priority && rule.category_id === categoryId
    );
    // Dòng riêng THẮNG dòng mặc định, kể cả khi nó bật còn mặc định tắt — đó là
    // cách một loại việc xin ngoại lệ cho riêng mình.
    if (exact) return exact.is_enabled !== false;
  }
  const fallback = rules.find(
    (rule) => rule.priority === priority && rule.category_id === null
  );
  if (fallback) return fallback.is_enabled !== false;
  return true;
}

/** Các mức ưu tiên còn chọn được, giữ thứ tự low → urgent. */
export function enabledPrioritiesForCategory(
  categoryId: string | null,
  rules: readonly ToggleRule[]
): TaskPriority[] {
  return TASK_PRIORITIES.filter((priority) =>
    isPriorityEnabledForCategory(priority, categoryId, rules)
  );
}

/**
 * Mức ưu tiên nên chọn sẵn khi người dùng đổi sang một loại việc khác.
 *
 * Giữ nguyên lựa chọn hiện tại nếu nó còn hợp lệ; không thì lùi xuống mức thấp
 * hơn gần nhất. Trả `null` khi loại việc đó tắt hết mọi mức — cấu hình sai, và
 * lớp gọi phải báo lỗi chứ không được lặng lẽ ghi một giá trị đang bị tắt.
 */
export function resolvePriorityForCategory(
  current: TaskPriority,
  categoryId: string | null,
  rules: readonly ToggleRule[]
): TaskPriority | null {
  if (isPriorityEnabledForCategory(current, categoryId, rules)) return current;
  const enabled = enabledPrioritiesForCategory(categoryId, rules);
  if (enabled.length === 0) return null;

  // Chỉ lùi xuống, không bao giờ tự đẩy lên: hạ mức của người khác thì phiền,
  // còn tự nâng lên là làm sai lệch mức độ khẩn thật sự của công việc.
  const currentIndex = TASK_PRIORITIES.indexOf(current);
  for (let index = currentIndex - 1; index >= 0; index -= 1) {
    const candidate = TASK_PRIORITIES[index];
    if (enabled.includes(candidate)) return candidate;
  }
  return enabled[0];
}
