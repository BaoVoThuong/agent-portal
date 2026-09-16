/**
 * Luật chung cho kiểu cột `multiselect`.
 *
 * Cột tuỳ chỉnh lưu mảng id trong `custom_values`, còn cột provider lưu chuỗi
 * nhãn trong cột text thật để luồng đồng bộ Google Sheet không bị đổi hình
 * dạng. Vì vậy parser cố ý nhận cả mảng lẫn chuỗi.
 */
const SEPARATOR = /[,\n]/;

export function parseMultiselectValue(raw: unknown): string[] {
  const parts = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw.split(SEPARATOR)
      : [];
  const seen = new Set<string>();
  const parsed: string[] = [];

  for (const part of parts) {
    if (typeof part !== "string") continue;
    const value = part.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    parsed.push(value);
  }
  return parsed;
}

/** Ghép về dạng chuỗi mà Google Sheet đang ghi trong ô provider. */
export function serializeMultiselectValue(
  values: readonly string[]
): string | null {
  const parsed = parseMultiselectValue(values);
  return parsed.length > 0 ? parsed.join(", ") : null;
}

export function toggleMultiselectValue(
  current: readonly string[],
  value: string
): string[] {
  const parsed = parseMultiselectValue(current);
  return parsed.includes(value)
    ? parsed.filter((candidate) => candidate !== value)
    : [...parsed, value];
}

/** So sánh nội dung và thứ tự, không so sánh reference của hai mảng. */
export function multiselectEquals(a: unknown, b: unknown): boolean {
  const left = parseMultiselectValue(a);
  const right = parseMultiselectValue(b);
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
