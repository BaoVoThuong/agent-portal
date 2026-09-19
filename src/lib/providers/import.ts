import type { TableColumn } from "@/lib/table-config/types";
import { isProviderMultiselectColumn, isReadOnlyProviderColumn } from "./form";

/**
 * Nhập provider từ file Excel — KHÔNG có bước map cột.
 *
 * Luồng thật của người dùng là: Xuất ra → sửa trong Excel → Nhập lại. File xuất
 * ra mang đúng `label` của từng cột, nên khớp theo tên là khớp được hết và màn
 * hình không phải hỏi thêm gì. Cột nào không khớp thì BÁO RA ở bản xem trước,
 * chứ không lặng lẽ bỏ — bỏ im lặng là người dùng tưởng đã nhập xong.
 */

/** Cột định danh trong file xuất ra. Có ID = cập nhật, không có = thêm mới. */
export const PROVIDER_IMPORT_ID_HEADER = "ID";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Vài cách gọi khác cho cùng một cột, gặp trong file người dùng tự gõ.
 * Chỉ có tác dụng khi cột đích thật sự tồn tại trong cấu hình bảng.
 */
const HEADER_ALIASES: Record<string, string> = {
  doctor: "doctors",
  doctorname: "doctors",
  provider: "doctors",
  clinic: "facility",
  zip: "zip_code",
  zipcode: "zip_code",
  specialty: "practices_as",
  specialties: "practices_as",
  aca: "obamacare",
  acaplan: "obamacare",
  acaplans: "obamacare",
  obamacare: "obamacare",
  medicareplan: "medicare",
  medicareplans: "medicare",
  newpatient: "accepting_new_patients",
  newpatients: "accepting_new_patients",
  acceptingnewpatients: "accepting_new_patients",
  reviewed: "needs_review",
  hours: "business_hours",
  verifieddate: "date",
};

export type ProviderHeaderMatch = {
  /** Tiêu đề trong file → khoá cột. */
  byHeader: Map<string, string>;
  /** Tiêu đề nào mang số định danh dòng, nếu file có. */
  idHeader: string | null;
  /** Tiêu đề không khớp cột nào — phải hiện cho người dùng thấy. */
  ignored: string[];
};

export type ParsedProviderRow = {
  /** Số dòng người dùng THẤY trong Excel (dòng tiêu đề là 1). */
  row: number;
  id: string | null;
  mode: "create" | "update";
  values: Record<string, unknown>;
};

export type ProviderImportParse = {
  rows: ParsedProviderRow[];
  skipped: { row: number; reason: string }[];
};

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function matchProviderHeaders(
  headers: readonly string[],
  columns: readonly TableColumn[]
): ProviderHeaderMatch {
  const lookup = new Map<string, string>();
  for (const column of columns) {
    if (column.archived_at) continue;
    // Cột siêu dữ liệu do hệ thống ghi. Nhận giá trị nhập vào cho chúng là để
    // một file Excel viết lại lịch sử "ai tạo dòng này, lúc nào".
    if (isReadOnlyProviderColumn(column)) continue;
    lookup.set(normalizeHeader(column.label), column.key);
    lookup.set(normalizeHeader(column.key), column.key);
  }
  const columnKeys = new Set(
    columns.filter((column) => !column.archived_at).map((column) => column.key)
  );
  for (const [alias, key] of Object.entries(HEADER_ALIASES)) {
    if (!columnKeys.has(key) || lookup.has(alias)) continue;
    if (!lookup.has(normalizeHeader(key))) continue;
    lookup.set(alias, key);
  }

  const byHeader = new Map<string, string>();
  const taken = new Set<string>();
  const ignored: string[] = [];
  let idHeader: string | null = null;

  for (const header of headers) {
    const normalized = normalizeHeader(header);
    if (normalized === "id") {
      if (idHeader === null) {
        idHeader = header;
        continue;
      }
      ignored.push(header);
      continue;
    }
    const key = lookup.get(normalized);
    // Cột đã có người nhận rồi thì cột sau bị bỏ, và phải nói ra: hai cột cùng
    // đổ vào một chỗ thì giá trị nào thắng là chuyện không ai đoán được.
    if (!key || taken.has(key)) {
      ignored.push(header);
      continue;
    }
    taken.add(key);
    byHeader.set(header, key);
  }

  return { byHeader, idHeader, ignored };
}

/** Giá trị một ô Excel, đưa về đúng kiểu mà form provider đang dùng. */
function coerce(column: TableColumn, raw: unknown): unknown {
  if (column.type === "checkbox") {
    if (typeof raw === "boolean") return raw;
    if (typeof raw === "number") return raw !== 0;
    return ["yes", "true", "1", "y"].includes(
      String(raw ?? "").trim().toLowerCase()
    );
  }

  const text =
    raw instanceof Date
      ? // Cột ngày của provider là cột CHỮ chứa MM/DD/YYYY. Excel trả về một
        // đối tượng Date, để nguyên là ra chuỗi ISO dài ngoằng lẫn múi giờ.
        `${String(raw.getMonth() + 1).padStart(2, "0")}/${String(
          raw.getDate()
        ).padStart(2, "0")}/${raw.getFullYear()}`
      : raw === null || raw === undefined
        ? ""
        : String(raw).trim();

  if (isProviderMultiselectColumn(column)) {
    return text
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
  }
  return text === "" ? null : text;
}

export function parseProviderImportRows(
  records: readonly Record<string, unknown>[],
  matched: ProviderHeaderMatch,
  columns: readonly TableColumn[]
): ProviderImportParse {
  const columnByKey = new Map(columns.map((column) => [column.key, column]));
  const rows: ParsedProviderRow[] = [];
  const skipped: ProviderImportParse["skipped"] = [];

  records.forEach((record, index) => {
    // Dòng 1 là tiêu đề, nên dòng dữ liệu đầu tiên là dòng 2 trên màn hình Excel.
    const excelRow = index + 2;

    let id: string | null = null;
    if (matched.idHeader) {
      const rawId = String(record[matched.idHeader] ?? "").trim();
      if (rawId) {
        if (!UUID_RE.test(rawId)) {
          // Không lặng lẽ biến nó thành dòng thêm mới: người dùng gõ hỏng một ô
          // ID sẽ nhân đôi dòng đó trong bảng mà không hiểu vì sao.
          skipped.push({ row: excelRow, reason: `Invalid ID: ${rawId}` });
          return;
        }
        id = rawId;
      }
    }

    const values: Record<string, unknown> = {};
    for (const [header, key] of matched.byHeader) {
      const column = columnByKey.get(key);
      if (!column) continue;
      values[key] = coerce(column, record[header]);
    }

    const mode = id ? "update" : "create";
    if (mode === "create") {
      const hasName = Boolean(values.doctors) || Boolean(values.facility);
      if (!hasName) {
        skipped.push({ row: excelRow, reason: "Missing both Doctor and Facility" });
        return;
      }
    } else if (Object.keys(values).length === 0) {
      skipped.push({ row: excelRow, reason: "No columns to update" });
      return;
    }

    rows.push({ row: excelRow, id, mode, values });
  });

  return { rows, skipped };
}

/**
 * Thân request cho MỘT dòng nhập, chỉ gồm những cột có mặt trong file.
 *
 * Cố ý KHÔNG dùng `providerFormPayload`: hàm đó duyệt mọi cột đang sửa được vì
 * form sửa luôn gửi đủ, nên ô trống nghĩa là xoá. File nhập thì chỉ có vài cột
 * — duyệt mọi cột ở đây là một file hai cột sẽ xoá sạch phần còn lại của từng
 * dòng nó chạm vào.
 */
export function providerImportPayload(
  values: Record<string, unknown>,
  columns: readonly TableColumn[]
): Record<string, unknown> {
  const columnByKey = new Map(columns.map((column) => [column.key, column]));
  const body: Record<string, unknown> = {};
  const customValues: Record<string, unknown> = {};
  let hasCustom = false;

  for (const [key, value] of Object.entries(values)) {
    const column = columnByKey.get(key);
    if (!column) continue;

    if (key === "needs_review") {
      // Cột trên file tên là "Reviewed" — ngược nghĩa với `needs_review`.
      body[key] = value !== true;
    } else if (key === "accepting_new_patients") {
      body[key] = value === true ? "Yes" : "No";
    } else if (column.is_system) {
      body[key] = value;
    } else {
      customValues[key] = value;
      hasCustom = true;
    }
  }

  if (hasCustom) body.custom_values = customValues;
  return body;
}
