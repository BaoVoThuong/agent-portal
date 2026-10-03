import { normalizePhone } from "./import-parse";

/**
 * Mẫu cột cố định của file lead sau sự kiện (2026-10-03).
 *
 * Đội gửi lead bằng một Google Sheet luôn cùng một bộ cột, nên Import đọc thẳng
 * theo mẫu này thay vì bắt người dùng map từng cột. Thứ tự dưới đây là thứ tự
 * trong file và trong nút "Download template".
 *
 * `expected`: 11 cột chắc chắn có. Thiếu một cột trong số đó thì file có thể
 * sai mẫu — preview cảnh báo đỏ nhưng vẫn cho import. Agent và Note thì có file
 * có, có file không.
 */
export type TemplateField =
  | "full_name"
  | "age"
  | "gender"
  | "phone"
  | "email"
  | "ticket_number"
  | "contact_method"
  | "best_time_to_contact"
  | "insurance_needs"
  | "client_note"
  | "agent"
  | "fub_link"
  | "note";

export type TemplateColumn = {
  field: TemplateField;
  header: string;
  /** Các cách viết khác của tiêu đề, đã qua normalizeHeader. */
  aliases: readonly string[];
  expected: boolean;
};

export const LEAD_IMPORT_TEMPLATE: readonly TemplateColumn[] = [
  { field: "full_name", header: "Full Name", aliases: ["name"], expected: true },
  { field: "age", header: "Age", aliases: [], expected: true },
  { field: "gender", header: "Gender", aliases: [], expected: true },
  { field: "phone", header: "Phone Number", aliases: ["phone"], expected: true },
  { field: "email", header: "Email", aliases: ["e mail"], expected: true },
  { field: "ticket_number", header: "Ticket #", aliases: ["ticket number", "ticket no"], expected: true },
  { field: "contact_method", header: "Contact Method", aliases: [], expected: true },
  { field: "best_time_to_contact", header: "Best Time to Contact", aliases: ["best time"], expected: true },
  { field: "insurance_needs", header: "Insurance Needs", aliases: [], expected: true },
  { field: "client_note", header: "Client's Note", aliases: ["client note", "clients note"], expected: true },
  { field: "agent", header: "Agent", aliases: [], expected: false },
  { field: "fub_link", header: "FUB link", aliases: ["fub"], expected: true },
  { field: "note", header: "Note", aliases: ["notes"], expected: false },
];

/**
 * Sáu cột không có chỗ trên bảng `leads` nên nằm trong `custom_values`, dưới
 * KEY CỐ ĐỊNH do rollout 2026-10-03-lead-import-template-columns.sql tạo. Admin
 * đổi nhãn hay màu thoải mái; Import đọc theo key.
 */
export const LEAD_IMPORT_CUSTOM_FIELDS = [
  "age",
  "gender",
  "ticket_number",
  "contact_method",
  "best_time_to_contact",
  "insurance_needs",
] as const satisfies readonly TemplateField[];

export type LeadImportCustomField = (typeof LEAD_IMPORT_CUSTOM_FIELDS)[number];

/** Header file → so khớp không phân biệt hoa thường, dấu câu hay khoảng trắng. */
export function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export type TemplateHeaderMatch = {
  /** Field → tiêu đề đúng như trong file. */
  headerByField: Partial<Record<TemplateField, string>>;
  /** Cột chắc chắn có mà file thiếu, theo nhãn của mẫu. */
  missingExpected: string[];
  /** Tiêu đề trong file không thuộc mẫu — bỏ qua. */
  unknownHeaders: string[];
};

export function matchTemplateHeaders(headers: readonly string[]): TemplateHeaderMatch {
  const headerByField: Partial<Record<TemplateField, string>> = {};
  const used = new Set<string>();
  for (const column of LEAD_IMPORT_TEMPLATE) {
    const accepted = new Set([normalizeHeader(column.header), ...column.aliases]);
    const header = headers.find(
      (candidate) => !used.has(candidate) && accepted.has(normalizeHeader(candidate)),
    );
    if (!header) continue;
    headerByField[column.field] = header;
    used.add(header);
  }
  return {
    headerByField,
    missingExpected: LEAD_IMPORT_TEMPLATE.filter(
      (column) => column.expected && !headerByField[column.field],
    ).map((column) => column.header),
    unknownHeaders: headers.filter((header) => !used.has(header)),
  };
}

/** Một dòng tiêu đề, cho nút "Download template". */
export function leadImportTemplateCsv(): string {
  return `${LEAD_IMPORT_TEMPLATE.map((column) =>
    /[",]/.test(column.header) ? `"${column.header.replace(/"/g, '""')}"` : column.header,
  ).join(",")}\n`;
}

export type TemplateLead = {
  /** Số dòng Excel (tiêu đề = 1), để mọi lý do chỉ đúng dòng người dùng thấy. */
  row: number;
  full_name: string | null;
  /** Có thể trống: "có gì ghi nấy" — dòng không có số vẫn được import. */
  phone: string | null;
  email: string | null;
  fub_link: string | null;
  description: string | null;
  /** Thô; route tự khớp ra email (resolveImportAgents). */
  agentName: string | null;
  /** Giá trị THÔ của 6 cột custom, theo key; nhãn chưa đổi sang option id. */
  customRaw: Partial<Record<LeadImportCustomField, unknown>>;
};

export type ImportRowNote = { row: number; reason: string };

export type TemplateParseResult = {
  rows: TemplateLead[];
  /** Dòng không import — kèm lý do. */
  skipped: ImportRowNote[];
  /** Dòng vẫn import nhưng có phần không ghi được. */
  warnings: ImportRowNote[];
};

/** Ô bảng tính → chữ đã trim; số giữ đúng chữ số (2818575511, 4619). */
export function cellText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

/**
 * "Client's Note" và "Note" cùng vào Description, mỗi phần có nhãn để người
 * đọc biết đâu là lời khách, đâu là ghi chú nội bộ. Xuống dòng trong ô giữ
 * nguyên.
 */
export function buildImportDescription(
  clientNote: string | null,
  note: string | null,
): string | null {
  const parts = [
    clientNote ? `Client's note: ${clientNote}` : null,
    note ? `Note: ${note}` : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join("\n") : null;
}

/**
 * Khoá so FUB link: số người trong `/people/view/<id>`. File có cả http lẫn
 * https cho cùng một người, nên so cả URL là bỏ sót.
 */
export function fubPersonKey(link: string | null | undefined): string | null {
  const text = link?.trim();
  if (!text) return null;
  const id = text.match(/\/people\/view\/(\d+)/i)?.[1];
  if (id) return `id:${id}`;
  return `url:${text.toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
}

/**
 * Khoá chống trùng TRONG file: phone, không có thì FUB link, không có nữa thì
 * email. Dòng không có cả ba thì không so được — vẫn import.
 */
export function importDedupeKey(
  row: Pick<TemplateLead, "phone" | "email" | "fub_link">,
): { key: string; label: string } | null {
  if (row.phone) return { key: `phone:${row.phone}`, label: "phone" };
  const fub = fubPersonKey(row.fub_link);
  if (fub) return { key: `fub:${fub}`, label: "FUB link" };
  if (row.email) return { key: `email:${row.email}`, label: "email" };
  return null;
}

export function parseTemplateRows(
  records: readonly Record<string, unknown>[],
  rowNumbers: readonly number[],
  headerByField: Partial<Record<TemplateField, string>>,
): TemplateParseResult {
  const rows: TemplateLead[] = [];
  const skipped: ImportRowNote[] = [];
  const warnings: ImportRowNote[] = [];
  const firstRowByKey = new Map<string, number>();

  const raw = (record: Record<string, unknown>, field: TemplateField): unknown => {
    const header = headerByField[field];
    return header ? record[header] : null;
  };
  const text = (record: Record<string, unknown>, field: TemplateField) =>
    cellText(raw(record, field));

  records.forEach((record, index) => {
    const row = rowNumbers[index] ?? index + 2;
    const mapped = LEAD_IMPORT_TEMPLATE.map((column) => text(record, column.field));
    // Dòng trống hoàn toàn (thường là dòng thừa cuối file) không phải một lead.
    if (mapped.every((value) => value === null)) return;

    const rawPhone = text(record, "phone");
    const phone = rawPhone ? normalizePhone(raw(record, "phone")) : null;
    if (rawPhone && !phone) {
      warnings.push({ row, reason: `Phone "${rawPhone}" is not a valid number; saved without a phone` });
    }

    const lead: TemplateLead = {
      row,
      full_name: text(record, "full_name"),
      phone,
      email: text(record, "email")?.toLowerCase() ?? null,
      fub_link: text(record, "fub_link"),
      description: buildImportDescription(text(record, "client_note"), text(record, "note")),
      agentName: text(record, "agent"),
      customRaw: {},
    };
    for (const field of LEAD_IMPORT_CUSTOM_FIELDS) {
      const value = raw(record, field);
      // Số giữ nguyên kiểu (cột Age là number); còn lại là chữ đã trim.
      const cell = typeof value === "number" && field === "age" ? value : cellText(value);
      if (cell !== null) lead.customRaw[field] = cell;
    }

    const dedupe = importDedupeKey(lead);
    if (dedupe) {
      const first = firstRowByKey.get(dedupe.key);
      if (first !== undefined) {
        skipped.push({ row, reason: `Same ${dedupe.label} as row ${first} in this file` });
        return;
      }
      firstRowByKey.set(dedupe.key, row);
    }
    rows.push(lead);
  });

  return { rows, skipped, warnings };
}

/** Tên người để so: bỏ dấu, `đ`→`d`, lowercase, bỏ dấu câu, gộp khoảng trắng. */
export function normalizePersonName(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export type ImportAccount = { email: string; name: string | null };

export type ImportAgentResolution =
  | { status: "matched"; email: string; name: string }
  /** Có tài khoản nhưng không nằm trong danh sách Agent ở Config. */
  | { status: "not-agent"; email: string; name: string }
  | { status: "ambiguous"; candidates: string[] }
  | { status: "not-found" };

type AccountMatch =
  | { kind: "one"; account: ImportAccount }
  | { kind: "many"; accounts: ImportAccount[] }
  | null;

/**
 * Email (nếu ô chứa email) → trùng nguyên tên → trùng tên đầu + họ cuối
 * ("Jennifer Thao Le" ↔ "Jennifer Le"), chỉ khi DUY NHẤT một người khớp.
 */
function matchAccount(rawName: string, accounts: readonly ImportAccount[]): AccountMatch {
  const pick = (found: readonly ImportAccount[]): AccountMatch =>
    found.length === 1
      ? { kind: "one", account: found[0] }
      : found.length > 1
        ? { kind: "many", accounts: [...found] }
        : null;

  const trimmed = rawName.trim();
  if (trimmed.includes("@")) {
    const email = trimmed.toLowerCase();
    return pick(accounts.filter((account) => account.email.trim().toLowerCase() === email));
  }
  const target = normalizePersonName(trimmed);
  if (!target) return null;
  const exact = pick(accounts.filter((account) => normalizePersonName(account.name) === target));
  if (exact) return exact;

  const words = target.split(" ");
  if (words.length < 2) return null;
  const [first, last] = [words[0], words[words.length - 1]];
  return pick(
    accounts.filter((account) => {
      const parts = normalizePersonName(account.name).split(" ");
      return parts.length >= 2 && parts[0] === first && parts[parts.length - 1] === last;
    }),
  );
}

/**
 * Tên Agent trong file → Agent.
 *
 * Nguồn là danh sách Agent ở Config (bảng `task_agents`, mục Assistant
 * membership) — cùng danh sách Task CS dùng. Agent không cần tự có quyền Lead:
 * lead của họ do các Assistant của họ xem và xử lý (lib/leads/membership.ts).
 *
 * So trong danh sách Agent trước. Không có thì so với mọi tài khoản để nói rõ
 * "có tài khoản nhưng chưa là Agent" thay vì chỉ "không tìm thấy". Hai người
 * cùng khớp thì không đoán — đoán sai là giao khách cho nhầm người.
 */
export function resolveImportAgent(
  rawName: string,
  agents: readonly ImportAccount[],
  accounts: readonly ImportAccount[],
): ImportAgentResolution {
  const label = (account: ImportAccount) => account.name?.trim() || account.email;
  const agent = matchAccount(rawName, agents);
  if (agent?.kind === "one") {
    return { status: "matched", email: agent.account.email.trim().toLowerCase(), name: label(agent.account) };
  }
  if (agent?.kind === "many") return { status: "ambiguous", candidates: agent.accounts.map(label) };

  const account = matchAccount(rawName, accounts);
  if (account?.kind === "one") {
    return { status: "not-agent", email: account.account.email.trim().toLowerCase(), name: label(account.account) };
  }
  if (account?.kind === "many") return { status: "ambiguous", candidates: account.accounts.map(label) };
  return { status: "not-found" };
}
