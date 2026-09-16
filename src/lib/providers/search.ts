import {
  PROVIDER_TEXT_FIELDS,
  isPortalRow,
  type ProviderRow,
  type ProviderTextField,
} from "./types";

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

/**
 * Bộ lọc của bảng provider.
 *
 * Provider không có cột dropdown nào — mọi cột đều là văn bản tự do đến từ
 * Sheet — nên danh sách lựa chọn phải rút ra từ chính dữ liệu đang có
 * (`providerFilterOptions`), không phải từ `table_column_option`.
 *
 * Mảng rỗng nghĩa là KHÔNG ràng buộc, không phải "không khớp gì cả".
 */
export type ProviderFilters = {
  state: string[];
  city: string[];
  specialty: string[];
  accepting: string[];
  /** "" = cả hai nguồn. */
  source: "" | "sheet" | "manual";
};

export const EMPTY_PROVIDER_FILTERS: ProviderFilters = {
  state: [],
  city: [],
  specialty: [],
  accepting: [],
  source: "",
};

const FILTER_FIELDS = {
  state: "state",
  city: "city",
  specialty: "practices_as",
  accepting: "accepting_new_patients",
} as const;

function normalize(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export function hasActiveProviderFilters(filters: ProviderFilters): boolean {
  return (
    filters.state.length > 0 ||
    filters.city.length > 0 ||
    filters.specialty.length > 0 ||
    filters.accepting.length > 0 ||
    filters.source !== ""
  );
}

export function applyProviderFilters(
  rows: ProviderRow[],
  filters: ProviderFilters
): ProviderRow[] {
  if (!hasActiveProviderFilters(filters)) return rows;
  return rows.filter((row) => {
    for (const [filterKey, field] of Object.entries(FILTER_FIELDS) as [
      keyof typeof FILTER_FIELDS,
      (typeof FILTER_FIELDS)[keyof typeof FILTER_FIELDS],
    ][]) {
      const selected = filters[filterKey];
      if (selected.length === 0) continue;
      const value = normalize(row[field]);
      // So khớp không phân biệt hoa thường: dữ liệu Sheet lẫn cả "TX" lẫn "tx",
      // "Houston" lẫn "houston ".
      if (!selected.some((candidate) => normalize(candidate) === value)) return false;
    }
    if (filters.source === "manual" && !isPortalRow(row)) return false;
    if (filters.source === "sheet" && isPortalRow(row)) return false;
    return true;
  });
}

/**
 * Giá trị có thật trong dữ liệu, mỗi giá trị một lần, đã sắp xếp.
 *
 * Giữ nguyên cách viết của lần xuất hiện ĐẦU TIÊN để nhãn đọc được ("Houston"
 * chứ không phải "houston"), nhưng gộp theo bản đã chuẩn hoá để "TX" và "tx"
 * không thành hai mục riêng. Ô trống không lọc được nên bị loại khỏi danh sách.
 */
export function providerFilterOptions(rows: ProviderRow[]): {
  state: string[];
  city: string[];
  specialty: string[];
  accepting: string[];
} {
  const collect = (field: (typeof FILTER_FIELDS)[keyof typeof FILTER_FIELDS]) => {
    const byNormalized = new Map<string, string>();
    for (const row of rows) {
      const raw = (row[field] ?? "").trim();
      if (!raw) continue;
      const key = raw.toLowerCase();
      if (!byNormalized.has(key)) byNormalized.set(key, raw);
    }
    return [...byNormalized.values()].sort((a, b) => a.localeCompare(b));
  };
  return {
    state: collect(FILTER_FIELDS.state),
    city: collect(FILTER_FIELDS.city),
    specialty: collect(FILTER_FIELDS.specialty),
    accepting: collect(FILTER_FIELDS.accepting),
  };
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
