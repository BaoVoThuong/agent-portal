/**
 * Chạy `run` trên từng phần tử, tối đa `size` cái cùng lúc, giữ nguyên thứ tự
 * kết quả theo thứ tự đầu vào.
 *
 * Vì sao cần: mấy chỗ enrich danh sách task chia id thành chùm 50 rồi gọi
 * `Promise.all` trên TOÀN BỘ chùm. Ở 141 task đó là 3 truy vấn song song —
 * không thấy gì. Ở 5.000 task là 100 truy vấn song song, mỗi cái chạy hai
 * subquery đếm cho từng id, đổ vào một connection pool mặc định 10. Chặn ở đây
 * làm phẳng đỉnh đó.
 *
 * Lưu ý: việc này KHÔNG giảm tổng khối lượng, chỉ giảm đỉnh. Giảm tổng là việc
 * của Phase B (đếm sẵn `comment_count`/`attachment_count`).
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  size: number,
  // PromiseLike chứ không Promise: builder của Supabase là thenable, không phải
  // một Promise thật, nên ràng `Promise<R>` sẽ từ chối chính những chỗ cần dùng.
  run: (item: T) => PromiseLike<R>,
): Promise<R[]> {
  if (size <= 0) return Promise.all(items.map(run));
  const results: R[] = [];
  for (let index = 0; index < items.length; index += size) {
    results.push(
      ...(await Promise.all(items.slice(index, index + size).map(run))),
    );
  }
  return results;
}

/** Giới hạn dùng chung cho mọi lượt enrich danh sách task. */
export const LIST_ENRICH_CONCURRENCY = 6;
