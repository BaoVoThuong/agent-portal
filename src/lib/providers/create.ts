import { PORTAL_SOURCE, PROVIDER_TEXT_FIELDS, type ProviderTextField } from "./types";

const MAX_TEXT_LENGTH = 500;
const MAX_CUSTOM_FIELDS = 100;

export type CreateProviderInput = Record<ProviderTextField, string | null> & {
  customValues: Record<string, unknown>;
};

export type CreateProviderParseResult =
  | { ok: true; value: CreateProviderInput }
  | { ok: false; error: string };

function text(value: unknown, label: string): string | null | { error: string } {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return { error: `${label} must be text.` };
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_TEXT_LENGTH) return { error: `${label} is too long.` };
  return trimmed;
}

export function parseCreateProviderInput(body: unknown): CreateProviderParseResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Invalid request body." };
  }
  const raw = body as Record<string, unknown>;
  const value = {} as CreateProviderInput;

  for (const field of PROVIDER_TEXT_FIELDS) {
    const parsed = text(raw[field], field);
    if (parsed !== null && typeof parsed === "object") {
      return { ok: false, error: parsed.error };
    }
    value[field] = parsed;
  }
  // Bang viết hoa để lọc và tìm kiếm không phải so chữ hoa/thường: dữ liệu từ
  // Sheet đang lẫn cả "TX" lẫn "tx".
  if (value.state) value.state = value.state.toUpperCase();

  // Một dòng không có cả tên bác sĩ lẫn tên cơ sở thì không ai tra cứu được,
  // và cũng không phân biệt nổi với dòng trống.
  if (!value.doctors && !value.facility) {
    return { ok: false, error: "Doctor or facility is required." };
  }

  const customValues = raw.custom_values;
  if (customValues === undefined || customValues === null) {
    value.customValues = {};
  } else if (typeof customValues !== "object" || Array.isArray(customValues)) {
    return { ok: false, error: "custom_values must be an object." };
  } else {
    const entries = Object.entries(customValues as Record<string, unknown>);
    if (entries.length > MAX_CUSTOM_FIELDS) {
      return { ok: false, error: `At most ${MAX_CUSTOM_FIELDS} custom fields.` };
    }
    value.customValues = Object.fromEntries(entries);
  }

  return { ok: true, value };
}

export function buildProviderRow(
  input: CreateProviderInput,
  ctx: { actorEmail: string; nextRowNumber: number }
): Record<string, unknown> {
  const actor = ctx.actorEmail.trim().toLowerCase();
  const row: Record<string, unknown> = {
    source_sheet_id: PORTAL_SOURCE.sheetId,
    source_gid: PORTAL_SOURCE.gid,
    source_row_number: ctx.nextRowNumber,
    // Bảng đòi not null. Dòng thêm tay không đến từ ô Sheet nào, nên băm theo
    // chính vị trí trong phân vùng portal: đủ để phân biệt và không bao giờ
    // đụng hàng với băm nội dung mà sync sinh ra.
    source_row_hash: `portal:${ctx.nextRowNumber}:${actor}`,
    raw_row: {},
    custom_values: input.customValues,
    created_by_email: actor,
    updated_by_email: actor,
  };
  for (const field of PROVIDER_TEXT_FIELDS) row[field] = input[field];
  return row;
}
