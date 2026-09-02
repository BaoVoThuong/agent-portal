/**
 * Một bộ luật cho các trường hệ thống của lead, dùng chung Create / PATCH / Import.
 *
 * Trước đó `create.ts` có regex email và giới hạn độ dài, còn `patch.ts` chỉ
 * `String(value).trim()` không giới hạn và email kiểm bằng `includes("@")`. Cùng
 * một giá trị: màn hình Add từ chối, sửa inline lại ghi được — và cái ghi được
 * đó mới là thứ nằm lại trong DB.
 */

/** Cùng regex `create.ts` đang dùng, chuyển về đây làm bản duy nhất. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+$/;

export type NormalizeResult =
  | { ok: true; value: string | null }
  | { ok: false; error: string };

export function normalizeLeadEmail(value: unknown): NormalizeResult {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false, error: "Enter a valid email address." };
  const trimmed = value.trim();
  if (trimmed === "") return { ok: true, value: null };
  if (!EMAIL_RE.test(trimmed)) return { ok: false, error: "Enter a valid email address." };
  return { ok: true, value: trimmed.toLowerCase() };
}

export function normalizeLeadText(
  value: unknown,
  label: string,
  maxLength: number
): NormalizeResult {
  if (value === null || value === undefined) return { ok: true, value: null };
  // KHÔNG ép String(): một object lọt qua sẽ nằm trong DB dưới dạng chuỗi
  // "[object Object]", và không ai truy ngược được nó từ đâu ra.
  if (typeof value !== "string") return { ok: false, error: `${label} must be text.` };
  const trimmed = value.trim();
  if (trimmed === "") return { ok: true, value: null };
  if (trimmed.length > maxLength) return { ok: false, error: `${label} is too long.` };
  return { ok: true, value: trimmed };
}
