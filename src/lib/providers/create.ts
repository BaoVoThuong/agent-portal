import { PROVIDER_TEXT_FIELDS, type ProviderTextField } from "./types";
import { isProviderPlanField, parsePlanCell, serializePlanCell } from "./plans";
import {
  isProviderSpecialtyField,
  parseSpecialtyCell,
  serializeSpecialtyCell,
} from "./specialties";

const MAX_TEXT_LENGTH = 500;
const MAX_CUSTOM_FIELDS = 100;

export type CreateProviderInput = Record<ProviderTextField, string | null> & {
  customValues: Record<string, unknown>;
  /** Thiếu thì coi như false — xem `buildProviderRow`. */
  needsReview?: boolean;
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

/**
 * Ô nhiều lựa chọn: form gửi lên một MẢNG nhãn, bảng lưu một chuỗi ngăn bởi dấu
 * phẩy để tương thích Google Sheet. Cùng luật với `buildProviderPatch` — form
 * Thêm và form Sửa dùng chung một component, gửi hai định dạng khác nhau thì
 * một trong hai đường luôn gãy.
 */
function listText(
  value: unknown,
  label: string,
  field: string
): string | null | { error: string } {
  if (value === undefined || value === null || value === "") return null;
  if (
    typeof value !== "string" &&
    (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
  ) {
    return { error: `${label} must be text or a list.` };
  }
  const serialized = isProviderSpecialtyField(field)
    ? serializeSpecialtyCell(parseSpecialtyCell(value))
    : serializePlanCell(parsePlanCell(value));
  if (serialized === null) return null;
  if (serialized.length > MAX_TEXT_LENGTH) return { error: `${label} is too long.` };
  return serialized;
}

export function parseCreateProviderInput(body: unknown): CreateProviderParseResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Invalid request body." };
  }
  const raw = body as Record<string, unknown>;
  const value = {} as CreateProviderInput;

  for (const field of PROVIDER_TEXT_FIELDS) {
    const parsed =
      isProviderPlanField(field) || isProviderSpecialtyField(field)
        ? listText(raw[field], field, field)
        : text(raw[field], field);
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

  // Form Thêm hiện cùng ô Reviewed như form Sửa, nên phải gửi được cờ đó lên.
  // Thiếu khoá này thì `buildProviderRow` vẫn lấy mặc định false như trước.
  if (raw.needs_review !== undefined) {
    if (typeof raw.needs_review !== "boolean") {
      return { ok: false, error: "needs_review must be a boolean." };
    }
    value.needsReview = raw.needs_review;
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
  ctx: { actorEmail: string }
): Record<string, unknown> {
  const actor = ctx.actorEmail.trim().toLowerCase();
  const row: Record<string, unknown> = {
    // Dòng gõ tay trong portal không đến từ dòng Sheet nào, nên không có vết
    // dẫn ngược. Để trống chứ không bịa số: một số giả ở đây sẽ khiến người tra
    // nguồn mở nhầm dòng Sheet của người khác.
    source_row_number: null,
    custom_values: input.customValues,
    // Người gõ tay thì đã nhìn thấy dữ liệu mình nhập; chỉ dữ liệu chuyển từ
    // Sheet sang mới cần người soát lại. Form vẫn bỏ tick được nếu người nhập
    // muốn nhờ người khác soát lại dòng vừa thêm.
    needs_review: input.needsReview ?? false,
    created_by_email: actor,
    updated_by_email: actor,
  };
  for (const field of PROVIDER_TEXT_FIELDS) row[field] = input[field];
  return row;
}
