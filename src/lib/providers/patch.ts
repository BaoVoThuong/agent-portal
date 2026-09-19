import { PROVIDER_TEXT_FIELDS } from "./types";
import {
  isProviderPlanField,
  parsePlanCell,
  serializePlanCell,
} from "./plans";
import { isProviderSpecialtyField, parseSpecialtyCell, serializeSpecialtyCell } from "./specialties";

const MAX_TEXT_LENGTH = 500;

/**
 * Sửa một trong bốn ô này là toạ độ đã geocode không còn trỏ đúng chỗ nữa.
 *
 * Xoá ngay thay vì chờ lần backfill kế tiếp: giữa hai lần chạy script, Finder
 * sẽ tính khoảng cách tới ĐỊA CHỈ CŨ và không có gì trên màn hình nói ra điều
 * đó. Xoá đi thì dòng đó rơi về nhóm "chưa có toạ độ" — vẫn vào được danh sách
 * ứng viên qua hạn ngạch riêng, chỉ là xếp bằng điểm chuỗi cho tới khi có người
 * chạy lại `scripts/geocode-providers.mjs`.
 */
const ADDRESS_KEYS = ["street", "city", "state", "zip_code"] as const;
const GEOCODE_KEYS = [
  "latitude",
  "longitude",
  "geocode_source",
  "geocoded_at",
  "geocode_key",
] as const;

export type ProviderPatchResult =
  | {
      ok: true;
      patch: Record<string, unknown>;
      customValues: Record<string, unknown> | null;
    }
  | { ok: false; error: string };

export function buildProviderPatch(body: unknown): ProviderPatchResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Invalid request body." };
  }
  const patch: Record<string, unknown> = {};
  let customValues: Record<string, unknown> | null = null;

  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (key === "custom_values") {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return { ok: false, error: "custom_values must be an object." };
      }
      customValues = value as Record<string, unknown>;
      continue;
    }
    if (key === "archived") {
      // Chỉ cho archive qua đường này, không cho bỏ archive: khôi phục một dòng
      // là việc hiếm và cần màn hình riêng, không nên lọt vào patch của một ô.
      if (value !== true) return { ok: false, error: "archived must be true." };
      patch.archived_at = new Date().toISOString();
      continue;
    }
    if (key === "needs_review") {
      if (typeof value !== "boolean") {
        return { ok: false, error: "needs_review must be a boolean." };
      }
      patch[key] = value;
      continue;
    }
    if (!(PROVIDER_TEXT_FIELDS as readonly string[]).includes(key)) {
      return { ok: false, error: `${key} cannot be edited here.` };
    }
    if (isProviderPlanField(key) || isProviderSpecialtyField(key)) {
      if (value === null || value === "") {
        patch[key] = null;
        continue;
      }
      if (
        typeof value !== "string" &&
        (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
      ) {
        return { ok: false, error: `${key} must be text or a list.` };
      }
      const serialized = isProviderSpecialtyField(key)
        ? serializeSpecialtyCell(parseSpecialtyCell(value))
        : serializePlanCell(parsePlanCell(value));
      if (serialized === null) {
        patch[key] = null;
        continue;
      }
      if (serialized.length > MAX_TEXT_LENGTH) {
        return { ok: false, error: `${key} is too long.` };
      }
      patch[key] = serialized;
      continue;
    }
    if (value === null || value === "") {
      // Ô để trống nghĩa là XOÁ giá trị. Bỏ qua thì người dùng không bao giờ
      // xoá được một số điện thoại gõ nhầm.
      patch[key] = null;
      continue;
    }
    if (typeof value !== "string") return { ok: false, error: `${key} must be text.` };
    const trimmed = value.trim();
    if (trimmed.length > MAX_TEXT_LENGTH) return { ok: false, error: `${key} is too long.` };
    if (trimmed === "") {
      patch[key] = null;
      continue;
    }
    patch[key] = key === "state" ? trimmed.toUpperCase() : trimmed;
  }

  if (Object.keys(patch).length === 0 && customValues === null) {
    return { ok: false, error: "Nothing to update." };
  }

  if (ADDRESS_KEYS.some((key) => key in patch)) {
    for (const key of GEOCODE_KEYS) patch[key] = null;
  }

  return { ok: true, patch, customValues };
}
