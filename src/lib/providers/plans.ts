import {
  parseMultiselectValue,
  serializeMultiselectValue,
} from "@/lib/table-config/multiselect";

/** Hai cột này là cột text thật trong provider_directory, nên lưu chuỗi nhãn. */
export const PROVIDER_PLAN_FIELDS = ["obamacare", "medicare"] as const;
export type ProviderPlanField = (typeof PROVIDER_PLAN_FIELDS)[number];

export function isProviderPlanField(value: string): value is ProviderPlanField {
  return (PROVIDER_PLAN_FIELDS as readonly string[]).includes(value);
}

export function parsePlanCell(raw: unknown): string[] {
  return parseMultiselectValue(raw);
}

export function serializePlanCell(values: readonly string[]): string | null {
  return serializeMultiselectValue(values);
}
