import {
  parseMultiselectValue,
  serializeMultiselectValue,
} from "@/lib/table-config/multiselect";

/**
 * Bộ giá trị Specialty đã chuẩn hoá từ toàn bộ provider_directory hiện có.
 *
 * Một số dòng cũ dùng cột này để ghi thêm loại cơ sở/trạng thái (ví dụ
 * `Hospital`). Các nhãn loại cơ sở vẫn được giữ lại để không làm mất thông
 * tin; riêng `Does not take ACA` là trạng thái bảo hiểm, không phải Specialty,
 * nên bị loại khỏi danh sách và không còn được giữ trong ô này.
 */
export const PROVIDER_SPECIALTY_OPTIONS = [
  "Allergist",
  "Cardiologist",
  "Dentist",
  "Dermatology",
  "Emergency Medicine",
  "Endocrinology",
  "ER",
  "Gastroenterology",
  "General Surgeon",
  "Geriatric",
  "Hematology",
  "Hospital",
  "Imaging Facility",
  "Location Closed",
  "Nephrology",
  "Neurology",
  "Nurse Practitioner",
  "OBGYN",
  "Oncology",
  "Ophthalmology",
  "Orthopedic",
  "Otolaryngologist (ENT)",
  "PCP - Adults",
  "PCP - Children",
  "PCP - Family",
  "Pharmacy",
  "Physician Assistant",
  "Podiatrist",
  "Psychiatrist",
  "Pulmonologist",
  "Rheumatology",
  "Specialists",
  "Urgent Care",
  "Urology",
] as const;

export type ProviderSpecialty = (typeof PROVIDER_SPECIALTY_OPTIONS)[number];

const SPECIALTY_ALIASES: Record<string, ProviderSpecialty> = {
  "opthamology": "Ophthalmology",
  "pcp - family (adults and children)": "PCP - Family",
};

const SPECIALTY_BY_NORMALIZED_VALUE = new Map(
  PROVIDER_SPECIALTY_OPTIONS.map((value) => [value.toLowerCase(), value])
);
const NON_SPECIALTY_VALUES = new Set(["does not take aca"]);

export function isProviderSpecialtyField(
  value: string
): value is "practices_as" {
  return value === "practices_as";
}

export function normalizeProviderSpecialty(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return (
    SPECIALTY_ALIASES[trimmed.toLowerCase()] ??
    SPECIALTY_BY_NORMALIZED_VALUE.get(trimmed.toLowerCase()) ??
    trimmed
  );
}

export function parseSpecialtyCell(raw: unknown): string[] {
  const seen = new Set<string>();
  const values: string[] = [];

  for (const value of parseMultiselectValue(raw)) {
    const normalized = normalizeProviderSpecialty(value);
    const key = normalized.toLowerCase();
    if (!normalized || NON_SPECIALTY_VALUES.has(key) || seen.has(key)) continue;
    seen.add(key);
    values.push(normalized);
  }

  return values;
}

export function serializeSpecialtyCell(values: readonly string[]): string | null {
  return serializeMultiselectValue(
    parseSpecialtyCell(values).filter((value) => value.length > 0)
  );
}
