/**
 * Tải file đính kèm chạy nền sau khi tạo task/lead/hồ sơ, thay cho vòng `for`
 * tải tuần tự từng file trong lúc form còn khoá (plan instant feedback T2.1).
 *
 * Chạy `upload` cho từng mục, tối đa `concurrency` mục cùng lúc (ít nhất 1).
 * Trả về các mục lỗi THEO THỨ TỰ ĐẦU VÀO — không theo thứ tự các worker song
 * song xong việc. `onSettled` báo tiến trình từng mục.
 *
 * `upload` tự giữ `client_request_id` cố định của từng file, nên tải lại một mục
 * lỗi không tạo file trùng.
 */
export async function uploadWithConcurrency<T>(
  items: readonly T[],
  upload: (item: T) => Promise<boolean>,
  options: { concurrency?: number; onSettled?: (item: T, ok: boolean) => void } = {},
): Promise<T[]> {
  const requested = options.concurrency ?? 3;
  const limit = Number.isFinite(requested) ? Math.max(1, Math.floor(requested)) : 3;
  const succeeded = new Array<boolean>(items.length).fill(false);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      const item = items[index];
      const ok = await upload(item).catch(() => false);
      succeeded[index] = ok;
      try {
        options.onSettled?.(item, ok);
      } catch {
        // Báo tiến trình hỏng không được làm dừng các file còn lại.
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return items.filter((_, index) => !succeeded[index]);
}
