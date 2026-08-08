import type { EnrollmentOptionsBySet } from "./options";

export const ENROLLMENT_OPTION_FORM_FIELDS = [
  ["stage", "stage_id"],
  ["carrier", "carrier_id"],
  ["platform", "platform_id"],
  ["consent", "consent_id"],
  ["payment_status", "payment_status_id"],
  ["aca_status", "aca_status_id"],
] as const satisfies ReadonlyArray<readonly [keyof EnrollmentOptionsBySet, string]>;

export function findInvalidEnrollmentOptionFields(
  form: Readonly<Record<string, string>>,
  optionsBySet: EnrollmentOptionsBySet
): string[] {
  return ENROLLMENT_OPTION_FORM_FIELDS.filter(([setKey, field]) => {
    const selectedId = form[field];
    return Boolean(
      selectedId && !optionsBySet[setKey].some((option) => option.id === selectedId)
    );
  }).map(([, field]) => field);
}
