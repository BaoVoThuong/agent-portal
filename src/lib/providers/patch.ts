import { PROVIDER_TEXT_FIELDS } from "./types";

const MAX_TEXT_LENGTH = 500;

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
    if (!(PROVIDER_TEXT_FIELDS as readonly string[]).includes(key)) {
      return { ok: false, error: `${key} cannot be edited here.` };
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
  return { ok: true, patch, customValues };
}
