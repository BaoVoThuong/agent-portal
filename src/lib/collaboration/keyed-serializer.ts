/**
 * Chạy các việc CÙNG khoá nối đuôi nhau; khác khoá thì vẫn song song.
 *
 * Dùng cho sửa inline theo từng lead. Route PATCH đọc dòng rồi ghi có điều kiện
 * `updated_at` không đổi, nên hai lượt sửa cùng một lead bay song song thì lượt
 * sau luôn thua lượt trước và báo "Someone else changed this lead" — dù người
 * kia chính là mình, ví dụ tick hai product liền tay. Xếp hàng còn giữ đúng thứ
 * tự: lượt sau được tính từ màn hình đã có lượt trước, nên nó phải ghi sau.
 *
 * Việc trước hỏng thì việc sau VẪN chạy: nó là một thay đổi riêng người dùng đã
 * bấm, không phải phần tiếp theo của việc trước.
 */
export function createKeyedSerializer() {
  const tails = new Map<string, Promise<void>>();
  return function run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const prior = tails.get(key) ?? Promise.resolve();
    const result = prior.then(task);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    tails.set(key, tail);
    void tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
    return result;
  };
}
