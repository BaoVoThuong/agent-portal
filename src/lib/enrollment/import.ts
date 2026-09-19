import type { TableColumn } from "@/lib/table-config/types";

/**
 * Nhập hồ sơ Enrollment từ file Excel — KHÔNG có bước map cột.
 *
 * Cùng một luật với Provider List: file xuất ra mang đúng `label` của cột nên
 * khớp theo tên là đủ. Khác chỗ khó hơn: bảng này lưu **id** cho Stage/Carrier…
 * và **email** cho Agent/Caller, trong khi file xuất ra ghi **nhãn** và **tên
 * người**. Nên đọc file xong còn phải dịch ngược lại, và dịch không ra thì
 * BỎ DÒNG chứ không ghi null đè lên giá trị đang đúng.
 */

export const ENROLLMENT_IMPORT_ID_HEADER = "ID";

/**
 * Cột không nhận giá trị từ file.
 *
 * `key` là số hiệu do database sinh. `qc` bị chặn theo stage (chỉ tick được ở
 * stage có `triggers_qc`) nên nhập từ file chỉ tạo ra một loạt lỗi khó hiểu.
 * Nhóm created/updated là lịch sử, một file Excel không được viết lại.
 */
export const ENROLLMENT_IMPORT_MANAGED_KEYS = [
  "key",
  "qc",
  "createdBy",
  "createdAt",
  "updatedBy",
  "updated",
] as const;

const MANAGED_KEYS = new Set<string>(ENROLLMENT_IMPORT_MANAGED_KEYS);

/** Khoá cột trên màn hình → tên cột thật trong bảng `enrollment`. */
export const ENROLLMENT_FIELD_BY_COLUMN: Record<string, string> = {
  client: "client_name",
  agent: "agent_email",
  caller: "caller_email",
  responsible: "responsible_enroll_email",
  stage: "stage_id",
  payment: "payment_status_id",
  carrier: "carrier_id",
  aca: "aca_status_id",
  consent: "consent_id",
  platform: "platform_id",
  pcp2025: "pcp_2025",
  pcp2026: "pcp_2026",
  due: "due_date",
  fub: "fub_link",
};

/** Cột lưu id của một option, không lưu chữ. */
export const ENROLLMENT_OPTION_COLUMNS = [
  "stage",
  "payment",
  "carrier",
  "aca",
  "consent",
  "platform",
] as const;

/** Cột lưu email người dùng, không lưu tên. */
export const ENROLLMENT_PERSON_COLUMNS = ["agent", "caller", "responsible"] as const;

const OPTION_COLUMNS = new Set<string>(ENROLLMENT_OPTION_COLUMNS);
const PERSON_COLUMNS = new Set<string>(ENROLLMENT_PERSON_COLUMNS);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type EnrollmentImportContext = {
  /** khoá cột → (nhãn đã chuẩn hoá → id option). */
  optionIdByLabel: Map<string, Map<string, string>>;
  /** tên hoặc email đã chuẩn hoá → email. */
  emailByPerson: Map<string, string>;
  /** Tên bị từ hai người trở lên dùng chung — không được đoán. */
  ambiguousPeople: Set<string>;
  /**
   * Cột TUỲ CHỈNH kiểu dropdown/multiselect cũng lưu id chứ không lưu chữ:
   * `column.id` → (nhãn đã chuẩn hoá → id lựa chọn).
   */
  customOptionIdByLabel: Map<string, Map<string, string>>;
};

export type EnrollmentHeaderMatch = {
  byHeader: Map<string, string>;
  idHeader: string | null;
  ignored: string[];
  /** Tiêu đề trỏ vào cột hệ thống quản — bị bỏ qua, nhưng nói rõ là vì sao. */
  managed: string[];
};

export type ParsedEnrollmentRow = {
  /** Số dòng người dùng THẤY trong Excel. */
  row: number;
  id: string | null;
  mode: "create" | "update";
  values: Record<string, unknown>;
};

export type EnrollmentImportParse = {
  rows: ParsedEnrollmentRow[];
  skipped: { row: number; reason: string }[];
};

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9@.]/g, "");
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Một ô ngày của Excel về `YYYY-MM-DD`.
 *
 * `parseEnrollmentDate` của API chỉ nhận đúng ISO, trong khi Excel trả về ba
 * kiểu khác nhau tuỳ ô: chuỗi ISO, chuỗi kiểu Mỹ, và **số sê-ri** (46118).
 */
export function toIsoDate(raw: unknown): string | null | { error: string } {
  if (raw === null || raw === undefined || raw === "") return null;

  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? { error: "Invalid date" } : iso(raw);
  }

  if (typeof raw === "number" && Number.isFinite(raw)) {
    // Ngày 0 của Excel là 30/12/1899 — bù cho lỗi năm nhuận 1900 của nó.
    const millis = Date.UTC(1899, 11, 30) + Math.round(raw) * 86400000;
    return iso(new Date(millis));
  }

  const text = String(raw).trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (us) {
    const [, month, day, year] = us;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  return { error: `Invalid date: ${text}` };
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function matchEnrollmentHeaders(
  headers: readonly string[],
  columns: readonly TableColumn[]
): EnrollmentHeaderMatch {
  const lookup = new Map<string, string>();
  const managedLookup = new Set<string>();
  for (const column of columns) {
    if (column.archived_at) continue;
    if (MANAGED_KEYS.has(column.key)) {
      managedLookup.add(normalizeHeader(column.label));
      managedLookup.add(normalizeHeader(column.key));
      continue;
    }
    lookup.set(normalizeHeader(column.label), column.key);
    lookup.set(normalizeHeader(column.key), column.key);
  }

  const byHeader = new Map<string, string>();
  const taken = new Set<string>();
  const ignored: string[] = [];
  const managed: string[] = [];
  let idHeader: string | null = null;

  for (const header of headers) {
    const normalized = normalizeHeader(header);
    if (normalized === "id") {
      if (idHeader === null) idHeader = header;
      else ignored.push(header);
      continue;
    }
    if (managedLookup.has(normalized)) {
      managed.push(header);
      continue;
    }
    const key = lookup.get(normalized);
    if (!key || taken.has(key)) {
      ignored.push(header);
      continue;
    }
    taken.add(key);
    byHeader.set(header, key);
  }

  return { byHeader, idHeader, ignored, managed };
}

export function parseEnrollmentImportRows(
  records: readonly Record<string, unknown>[],
  matched: EnrollmentHeaderMatch,
  columns: readonly TableColumn[],
  context: EnrollmentImportContext
): EnrollmentImportParse {
  const columnByKey = new Map(columns.map((column) => [column.key, column]));
  const rows: ParsedEnrollmentRow[] = [];
  const skipped: EnrollmentImportParse["skipped"] = [];

  records.forEach((record, index) => {
    const excelRow = index + 2;

    let id: string | null = null;
    if (matched.idHeader) {
      const rawId = String(record[matched.idHeader] ?? "").trim();
      if (rawId) {
        if (!UUID_RE.test(rawId)) {
          skipped.push({ row: excelRow, reason: `Invalid ID: ${rawId}` });
          return;
        }
        id = rawId;
      }
    }

    const values: Record<string, unknown> = {};
    let failure: string | null = null;

    for (const [header, key] of matched.byHeader) {
      if (failure) break;
      const column = columnByKey.get(key);
      if (!column) continue;
      const raw = record[header];
      const label = column.label;

      if (OPTION_COLUMNS.has(key)) {
        const text = String(raw ?? "").trim();
        if (!text) {
          values[key] = null;
          continue;
        }
        if (UUID_RE.test(text)) {
          values[key] = text;
          continue;
        }
        const id = context.optionIdByLabel.get(key)?.get(normalize(text));
        if (!id) {
          // Ghi null ở đây là lặng lẽ xoá một giá trị đang đúng chỉ vì người
          // dùng gõ sai chính tả một nhãn.
          failure = `${label}: unknown value "${text}"`;
          break;
        }
        values[key] = id;
        continue;
      }

      if (PERSON_COLUMNS.has(key)) {
        const text = String(raw ?? "").trim();
        if (!text) {
          values[key] = null;
          continue;
        }
        const normalized = normalize(text);
        if (context.ambiguousPeople.has(normalized)) {
          failure = `${label}: "${text}" matches more than one person`;
          break;
        }
        const email = context.emailByPerson.get(normalized);
        if (!email) {
          failure = `${label}: unknown person "${text}"`;
          break;
        }
        values[key] = email;
        continue;
      }

      if (column.type === "date") {
        const parsed = toIsoDate(raw);
        if (parsed !== null && typeof parsed === "object") {
          failure = `${label}: ${parsed.error}`;
          break;
        }
        values[key] = parsed;
        continue;
      }

      if (column.type === "checkbox") {
        values[key] = ["yes", "true", "1", "y"].includes(
          String(raw ?? "").trim().toLowerCase()
        );
        continue;
      }

      const text = raw === null || raw === undefined ? "" : String(raw).trim();

      if (!column.is_system) {
        const custom = coerceCustomCell(column, text, context);
        if (custom !== null && typeof custom === "object" && "error" in custom) {
          failure = `${label}: ${custom.error}`;
          break;
        }
        values[key] = custom;
        continue;
      }

      values[key] = text === "" ? null : text;
    }

    if (failure) {
      skipped.push({ row: excelRow, reason: failure });
      return;
    }

    const mode = id ? "update" : "create";
    if (mode === "create" && !values.client) {
      skipped.push({ row: excelRow, reason: "Missing Client Name" });
      return;
    }
    if (mode === "update" && Object.keys(values).length === 0) {
      skipped.push({ row: excelRow, reason: "No columns to update" });
      return;
    }

    rows.push({ row: excelRow, id, mode, values });
  });

  return { rows, skipped };
}

/**
 * Một ô của cột TUỲ CHỈNH, ép về đúng kiểu mà `validateCustomValues` chấp nhận.
 *
 * Bỏ bước này là cột kiểu `number` nhận chuỗi `"1"` và bị API từ chối với
 * "Invalid custom value" — đúng lỗi gặp khi thử nhập thật lần đầu.
 */
function coerceCustomCell(
  column: TableColumn,
  text: string,
  context: EnrollmentImportContext
): unknown | { error: string } {
  if (text === "") return null;

  if (column.type === "number") {
    const parsed = Number(text.replace(/,/g, ""));
    if (!Number.isFinite(parsed)) return { error: `not a number "${text}"` };
    return parsed;
  }

  if (column.type === "person") {
    const normalized = normalize(text);
    if (context.ambiguousPeople.has(normalized)) {
      return { error: `"${text}" matches more than one person` };
    }
    const email = context.emailByPerson.get(normalized);
    return email ?? { error: `unknown person "${text}"` };
  }

  if (column.type === "dropdown" || column.type === "multiselect") {
    const byLabel = context.customOptionIdByLabel.get(column.id);
    const labels =
      column.type === "multiselect"
        ? text.split(",").map((part) => part.trim()).filter(Boolean)
        : [text];
    const ids: string[] = [];
    for (const item of labels) {
      if (UUID_RE.test(item)) {
        ids.push(item);
        continue;
      }
      const id = byLabel?.get(normalize(item));
      if (!id) return { error: `unknown value "${item}"` };
      ids.push(id);
    }
    return column.type === "multiselect" ? ids : ids[0];
  }

  return text;
}

/**
 * Thân request cho MỘT dòng, chỉ gồm những cột có trong file.
 *
 * Duyệt `values` chứ không duyệt toàn bộ cột: file nhập thường chỉ có vài cột,
 * gửi đủ mọi cột là xoá sạch phần còn lại của từng dòng nó chạm vào.
 */
export function enrollmentImportPayload(
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
    if (column.is_system) {
      const field = ENROLLMENT_FIELD_BY_COLUMN[key];
      if (field) body[field] = value;
      continue;
    }
    customValues[key] = value;
    hasCustom = true;
  }

  if (hasCustom) body.custom_values = customValues;
  return body;
}

/** Khoá cột trên màn hình → bộ option trong database. */
export const ENROLLMENT_SET_BY_COLUMN: Record<string, string> = {
  stage: "stage",
  payment: "payment_status",
  carrier: "carrier",
  aca: "aca_status",
  consent: "consent",
  platform: "platform",
};

/**
 * Dựng bảng tra cứu để dịch ngược nhãn/tên trong file về id/email.
 *
 * Tên người trùng nhau được gom vào `ambiguousPeople` chứ không chọn bừa một
 * người: gán nhầm hồ sơ cho đồng nghiệp trùng tên là lỗi không ai phát hiện ra
 * cho tới khi có người đi hỏi tại sao mình có hồ sơ lạ.
 */
export function buildEnrollmentImportContext(
  options: readonly { id: string; set_key: string; label: string; archived_at: string | null }[],
  people: readonly { email: string; name?: string | null }[],
  customOptions: readonly { id: string; column_id: string; label: string; archived_at: string | null }[] = []
): EnrollmentImportContext {
  const optionIdByLabel = new Map<string, Map<string, string>>();
  for (const [columnKey, setKey] of Object.entries(ENROLLMENT_SET_BY_COLUMN)) {
    const byLabel = new Map<string, string>();
    for (const option of options) {
      if (option.set_key !== setKey || option.archived_at) continue;
      byLabel.set(normalize(option.label), option.id);
    }
    optionIdByLabel.set(columnKey, byLabel);
  }

  const emailByPerson = new Map<string, string>();
  const ambiguousPeople = new Set<string>();
  for (const person of people) {
    const email = person.email.trim().toLowerCase();
    if (!email) continue;
    emailByPerson.set(normalize(email), email);
    const name = person.name?.trim();
    if (!name) continue;
    const key = normalize(name);
    if (!key) continue;
    const existing = emailByPerson.get(key);
    if (existing && existing !== email) {
      ambiguousPeople.add(key);
      continue;
    }
    emailByPerson.set(key, email);
  }

  const customOptionIdByLabel = new Map<string, Map<string, string>>();
  for (const option of customOptions) {
    if (option.archived_at) continue;
    const byLabel = customOptionIdByLabel.get(option.column_id) ?? new Map<string, string>();
    byLabel.set(normalize(option.label), option.id);
    customOptionIdByLabel.set(option.column_id, byLabel);
  }

  return { optionIdByLabel, emailByPerson, ambiguousPeople, customOptionIdByLabel };
}

/**
 * Bộ tiêu đề và một dòng ví dụ cho file mẫu.
 *
 * Dựng từ CẤU HÌNH CỘT THẬT chứ không cắm cứng như bên Provider List: mỗi
 * chương trình một bộ cột khác nhau, và admin còn thêm/đổi cột tuỳ chỉnh trong
 * /config. Cắm cứng là file mẫu sai ngay lần admin sửa cột đầu tiên.
 *
 * Dòng ví dụ lấy NHÃN thật của lựa chọn đầu tiên, không lấy id: người dùng gõ
 * "5-Ready to Enroll" chứ không ai gõ uuid.
 *
 * Không có cột `ID` — file mẫu là để THÊM hồ sơ mới. Muốn sửa hồ sơ có sẵn thì
 * bấm Export, file xuất ra luôn mang sẵn ID.
 */
export function buildEnrollmentTemplate(
  columns: readonly TableColumn[],
  options: readonly { id: string; set_key: string; label: string; archived_at: string | null }[],
  columnOptions: readonly { id: string; column_id: string; label: string; archived_at: string | null }[],
  sample: { personName?: string; today?: string } = {}
): { header: string[]; example: string[] } {
  const importable = columns.filter(
    (column) => !column.archived_at && !MANAGED_KEYS.has(column.key)
  );
  const today = sample.today ?? new Date().toISOString().slice(0, 10);
  const person = sample.personName ?? "name@company.com";

  const firstOptionLabel = (columnKey: string): string => {
    const setKey = ENROLLMENT_SET_BY_COLUMN[columnKey];
    if (!setKey) return "";
    return (
      options.find((option) => option.set_key === setKey && !option.archived_at)?.label ?? ""
    );
  };
  const firstCustomLabel = (columnId: string): string =>
    columnOptions.find((option) => option.column_id === columnId && !option.archived_at)
      ?.label ?? "";

  const example = importable.map((column) => {
    if (OPTION_COLUMNS.has(column.key)) return firstOptionLabel(column.key);
    if (PERSON_COLUMNS.has(column.key) || column.type === "person") return person;
    if (column.type === "date") return today;
    if (column.type === "checkbox") return "Yes";
    if (column.type === "number") return "1";
    if (column.type === "dropdown" || column.type === "multiselect") {
      return firstCustomLabel(column.id);
    }
    if (column.key === "client") return "Nguyen Van A";
    if (column.type === "link" || column.key === "fub") return "https://example.com/1";
    return "";
  });

  return { header: importable.map((column) => column.label), example };
}
