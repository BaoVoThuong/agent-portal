import { TASK_DUE_DATE_TIMEZONE } from "./due-date";

/**
 * Một timestamp thuộc về NGÀY nào, theo giờ nghiệp vụ (Texas).
 *
 * Vì sao phải có: trước đây có HAI bản `getLocalDateKey` giống hệt nhau —
 * `src/lib/tasks/filtering.ts` (chạy ở trình duyệt) và
 * `src/lib/tasks/overview-data.ts` (chạy ở server) — cả hai đều lấy ngày bằng
 * `date.getFullYear()/getMonth()/getDate()`, tức theo múi giờ của MÁY đang
 * chạy. Hệ quả là cùng một task rơi vào ba ngày khác nhau tuỳ ai hỏi:
 *
 *   - bộ lọc trên board  → múi giờ trình duyệt người xem (CS ở VN là UTC+7);
 *   - Overview/KPI        → múi giờ server (Vercel là UTC);
 *   - cron vỡ hạn Due Date → America/Chicago, qua `businessToday()`.
 *
 * Một task đóng lúc 20h ngày 3 giờ Texas là 9h sáng ngày 4 giờ VN. Với người
 * xem ở VN nó nằm ở ngày 4; với Overview nó nằm ở ngày 4 (UTC); với luật Due
 * Date nó nằm ở ngày 3. Không con số nào cộng lại khớp con số nào.
 *
 * Dùng chung một hàm này ở mọi nơi thì "ngày" chỉ còn một nghĩa.
 *
 * `en-CA` cho ra sẵn định dạng ISO nên không phải tự ghép chuỗi — cùng cách
 * `businessToday()` đang làm.
 */
const dateKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TASK_DUE_DATE_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function businessDateKey(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    // Giá trị hỏng: giữ nguyên hành vi cũ, cắt 10 ký tự đầu. Một chuỗi không
    // parse được thường đã là "YYYY-MM-DD..." rồi.
    return typeof value === "string" ? value.slice(0, 10) : "";
  }
  return dateKeyFormatter.format(date);
}

/**
 * Cộng/trừ ngày trên một khoá "YYYY-MM-DD".
 *
 * Làm phép ngay trên chuỗi ngày (parse như UTC, cộng, format lại như UTC) thay
 * vì trên `Date` giờ địa phương. Lý do: `new Date(y, m, 1)` dựng nửa đêm theo
 * múi giờ MÁY, nên với người xem ở UTC+7 thì "ngày 1 tháng này" lúc 0h VN đang
 * là ngày cuối tháng trước ở Texas — preset "This month" sẽ bắt đầu sai một
 * ngày. Trong không gian date-key thì không có múi giờ nào để sai.
 */
export function shiftBusinessDateKey(key: string, days: number): string {
  const parsed = new Date(`${key}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return key;
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

/** Ngày đầu tháng của một khoá "YYYY-MM-DD". */
export function firstDayOfBusinessMonth(key: string): string {
  return `${key.slice(0, 7)}-01`;
}
