import { useEffect, useState } from "react";

/**
 * Trả về `value` sau khi nó ngừng đổi trong `delayMs`. Ô Search của danh sách
 * lead gọi setState mỗi lần gõ; nếu không hoãn, mỗi ký tự kéo theo một lần
 * `filterLeads` + `sortLeads` + render lại toàn bảng. Ở vài trăm lead không
 * cảm nhận được; ở quy mô một đợt event thì đó là khựng thấy được mỗi phím.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
