/** Normalize the phone formats commonly produced by US spreadsheets. */
export function normalizePhone(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const source = typeof raw === "number"
    ? Number.isFinite(raw) ? String(Math.trunc(raw)) : ""
    : String(raw);
  const digits = source.replace(/\D+/g, "");
  if (digits.length === 0) return null;
  const trimmed = digits.length === 11 && digits.startsWith("1")
    ? digits.slice(1)
    : digits;
  return trimmed.length >= 7 ? trimmed : null;
}
