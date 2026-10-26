/**
 * Tổng hiện ngay trên tiêu đề cột của bảng Enrollment — "Apply number (597)".
 * Tính trên các dòng đang hiện (theo bộ lọc, năm, ô tìm kiếm), như tổng có lọc
 * trong Excel.
 *
 * Chỉ Apply number của ACA (user chốt 26/10/2026). Ghi cứng key vì đây là cột tự
 * tạo trong Config; cần thêm cột khác thì thêm key vào đây.
 */
export const HEADER_TOTAL_COLUMN_KEYS: ReadonlySet<string> = new Set(["apply_number"]);

/** Cộng các ô có số; ô trống hoặc không phải số thì bỏ qua thay vì làm hỏng cả tổng. */
export function sumColumnValues(values: Iterable<unknown>): number {
  let total = 0;
  for (const value of values) {
    const number =
      typeof value === "number"
        ? value
        : typeof value === "string" && value.trim() !== ""
          ? Number(value)
          : Number.NaN;
    if (Number.isFinite(number)) total += number;
  }
  return total;
}

/** "Apply number (1,234)": phân nhóm hàng nghìn, tối đa 2 chữ số thập phân. */
export function labelWithTotal(label: string, total: number): string {
  return `${label} (${total.toLocaleString("en-US", { maximumFractionDigits: 2 })})`;
}
