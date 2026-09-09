/**
 * Nhớ bộ lọc của một bảng qua lần tải trang.
 *
 * Vì sao cần: agent lọc Status + Agent + People rồi F5 (hoặc mở một hồ sơ rồi
 * bấm back) là mất sạch, phải chọn lại từ đầu.
 *
 * Vì sao là localStorage chứ không phải URL: bộ lọc của Task/Enrollment chạy
 * hoàn toàn ở client — server trả về cả trang rồi client mới lọc. Đẩy filter vào
 * URL nghĩa là mỗi lần tick một ô, Next chạy lại server component (`page.tsx`
 * đọc `searchParams`) và nạp lại dữ liệu. Đổi một tiện ích nhỏ lấy một loạt
 * round-trip là không đáng.
 *
 * ⚠ PHẢI đọc trong `useEffect` sau khi mount, KHÔNG đọc trong `useState(() => …)`.
 * Server không có localStorage nên render ra bộ lọc mặc định, còn client đọc
 * được giá trị đã lưu — hai bên khác nhau và React báo lỗi hydration ("server
 * rendered text didn't match the client"). Cái giá phải trả là một nhịp: trang
 * hiện mặc định rồi mới nhảy sang bộ lọc đã nhớ.
 *
 * Phần khó không nằm ở lúc GHI mà ở lúc ĐỌC LẠI: giá trị lưu hôm nay có thể vô
 * nghĩa ngày mai — một Stage bị archive, một người nghỉ việc, một carrier bị
 * xoá. Khôi phục nguyên xi thì agent mở lên thấy danh sách trống và không hiểu
 * vì sao. Nên mọi hàm `keep*` dưới đây đều lọc theo tập giá trị CÒN HỢP LỆ do
 * lớp gọi truyền vào — cùng cách `readHiddenTaskListColumns` đã làm với cột.
 */

export type FilterStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * localStorage của trình duyệt, hoặc `undefined` khi không dùng được.
 *
 * Truy cập localStorage NÉM LỖI chứ không trả null trong vài trường hợp thật:
 * Safari chế độ riêng tư, và trình duyệt bị chặn cookie/site data. Bọc try/catch
 * ngay từ bước lấy đối tượng, không phải chỉ ở bước đọc.
 */
export function browserFilterStorage(): FilterStorage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Đọc bộ lọc đã lưu và dựng lại qua `revive`.
 *
 * `revive` chịu trách nhiệm bỏ đi thứ không còn hợp lệ. Trả `null` ở bất kỳ
 * bước nào đều có nghĩa "dùng mặc định" — không bao giờ ném ra ngoài, vì một
 * dòng JSON hỏng không đáng làm vỡ cả trang.
 */
export function readPersistedFilters<T>(
  key: string,
  storage: FilterStorage | undefined,
  revive: (raw: Record<string, unknown>) => T | null
): T | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isPlainRecord(parsed)) return null;
    return revive(parsed);
  } catch {
    return null;
  }
}

/**
 * Ghi bộ lọc. Ghi hỏng thì im lặng bỏ qua: quota đầy hoặc storage bị chặn không
 * phải lý do để chặn thao tác lọc mà người dùng vừa thực hiện.
 */
export function writePersistedFilters(
  key: string,
  storage: FilterStorage | undefined,
  value: unknown
): void {
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // không làm gì
  }
}

export function clearPersistedFilters(
  key: string,
  storage: FilterStorage | undefined
): void {
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // không làm gì
  }
}

/** Danh sách chuỗi, chỉ giữ lại giá trị còn tồn tại và bỏ trùng. */
export function keepKnownStrings(
  value: unknown,
  valid: ReadonlySet<string>
): string[] {
  if (!Array.isArray(value)) return [];
  const kept = value.filter(
    (item): item is string => typeof item === "string" && valid.has(item)
  );
  return [...new Set(kept)];
}

/** Một chuỗi, hoặc null nếu giá trị đã biến mất. */
export function keepKnownString(
  value: unknown,
  valid: ReadonlySet<string>
): string | null {
  return typeof value === "string" && valid.has(value) ? value : null;
}

export function readStoredBoolean(value: unknown): boolean {
  return value === true;
}

/** Ngày dạng `YYYY-MM-DD`; mọi thứ khác coi như không đặt. */
export function readStoredDateOnly(value: unknown): string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}
