import type { EnrollmentProgram } from "./types";

export const MEDICARE_INAPPLICABLE_FIELDS = [
  "caller_email",
  "pcp_2026",
  "platform_id",
  "consent_id",
  "payment_status_id",
  "aca_status_id",
] as const;

export type MedicareInapplicableField =
  (typeof MEDICARE_INAPPLICABLE_FIELDS)[number];

export function sanitizeEnrollmentPatchForProgram<T extends Record<string, unknown>>(
  program: EnrollmentProgram,
  patch: T,
  current?: Partial<Record<MedicareInapplicableField, unknown>>
): T {
  if (program !== "medicare") return patch;

  const next: Record<string, unknown> = { ...patch };
  for (const field of MEDICARE_INAPPLICABLE_FIELDS) {
    if (field in next || current?.[field] != null) {
      next[field] = null;
    }
  }
  return next as T;
}
