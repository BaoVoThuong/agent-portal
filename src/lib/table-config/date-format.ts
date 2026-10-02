/**
 * Cách hiện ngày giờ cho các cột siêu dữ liệu của MỌI bảng: Created date,
 * Last Updated — Task CS, Enrollment (ACA / Medicare / Medicaid), Leads,
 * Provider List.
 *
 * Bám đúng dạng bảng Task CS đang dùng (trước đây là hàm riêng trong
 * TaskRowItem.tsx): ngày gọn "Oct 2", ngày giờ gọn "Oct 2 05:31", tooltip đầy
 * đủ "2026-10-02 05:31 UTC". Trước 2026-10-02 mỗi màn một kiểu — Enrollment
 * "5m ago" rồi "2026-09-24", Leads/Provider theo ngôn ngữ trình duyệt
 * ("10/2/2026", "10/2/2026, 12:31:51 AM").
 *
 * Luôn tính theo UTC: server và trình duyệt ra cùng một chuỗi, nên không lệch
 * HTML lúc hydrate. Vì vậy tooltip ghi rõ "UTC".
 */

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function parse(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** "Oct 2" — cột Created date. */
export function formatTableDate(value: string | null | undefined): string {
  const date = parse(value);
  if (!date) return "—";
  return `${MONTH_LABELS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

/** "Oct 2 05:31" — cột Last Updated và các mốc thời gian khác. */
export function formatTableDateTime(value: string | null | undefined): string {
  const date = parse(value);
  if (!date) return "—";
  return `${formatTableDate(value)} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

/** "2026-10-02 05:31 UTC" — tooltip khi rê chuột. */
export function formatTableDateTimeFull(value: string | null | undefined): string {
  const date = parse(value);
  if (!date) return "—";
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(
    date.getUTCHours()
  )}:${pad(date.getUTCMinutes())} UTC`;
}
