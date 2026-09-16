import { PROVIDER_TEXT_FIELDS, type ProviderRow, type ProviderTextField } from "./types";

/**
 * Lọc và sắp xếp chạy trong bộ nhớ, không phải trong database.
 *
 * Production đang có 889 dòng và cả bảng được nạp một lần khi mở màn hình; đẩy
 * việc này xuống PostgREST chỉ thêm một vòng mạng cho mỗi lần gõ phím. Đổi ý
 * khi bảng thật sự lớn, không phải trước đó.
 */
export function filterProviders(rows: ProviderRow[], query: string): ProviderRow[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((row) => {
    for (const field of PROVIDER_TEXT_FIELDS) {
      const value = row[field];
      if (value && value.toLowerCase().includes(needle)) return true;
    }
    // Cột tuỳ chỉnh cũng phải tìm được: người dùng thêm cột riêng chính là để
    // ghi thứ họ sẽ tra cứu.
    for (const value of Object.values(row.custom_values ?? {})) {
      if (value != null && String(value).toLowerCase().includes(needle)) return true;
    }
    return false;
  });
}

export type ProviderSortDir = "asc" | "desc";

export function sortProviders(
  rows: ProviderRow[],
  key: string,
  dir: ProviderSortDir
): ProviderRow[] {
  const factor = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = readSortValue(a, key);
    const right = readSortValue(b, key);
    // Ô trống luôn xuống cuối ở CẢ hai chiều: đảo chiều sắp xếp để lôi một đống
    // ô trống lên đầu là thứ không ai muốn. Dữ liệu provider rỗng gần một nửa.
    if (!left && !right) return 0;
    if (!left) return 1;
    if (!right) return -1;
    return left.localeCompare(right) * factor;
  });
}

function readSortValue(row: ProviderRow, key: string): string {
  if ((PROVIDER_TEXT_FIELDS as readonly string[]).includes(key)) {
    return (row[key as ProviderTextField] ?? "").toLowerCase();
  }
  const custom = row.custom_values?.[key];
  return custom == null ? "" : String(custom).toLowerCase();
}
