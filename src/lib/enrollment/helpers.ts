import type {
  EnrollmentOption,
  EnrollmentProgram,
  EnrollmentRecord,
} from "./types";

const ENROLLMENT_PROGRAM_PREFIX: Record<EnrollmentProgram, string> = {
  aca: "ACA",
  medicare: "MED",
};

export function enrollmentKey(
  id: string,
  program: EnrollmentProgram = "aca"
): string {
  let hash = 0;
  for (const character of id) {
    hash = (hash * 31 + character.charCodeAt(0)) % 9000;
  }
  return `${ENROLLMENT_PROGRAM_PREFIX[program]}-${hash + 1000}`;
}

export function enrollmentDisplayKey(
  displayNumber: number | null | undefined,
  program: EnrollmentProgram = "aca"
): string {
  const prefix = ENROLLMENT_PROGRAM_PREFIX[program];
  return typeof displayNumber === "number"
    ? `${prefix}-${displayNumber}`
    : `${prefix}-—`;
}

export function enrollmentIsOverdue(
  record: Pick<EnrollmentRecord, "due_date" | "closed_at">,
  now = new Date()
): boolean {
  if (!record.due_date || record.closed_at) return false;
  return dateOnlyToEndOfDay(record.due_date).getTime() < now.getTime();
}

export function enrollmentIsDueSoon(
  record: Pick<EnrollmentRecord, "due_date" | "closed_at">,
  now = new Date(),
  windowDays = 1
): boolean {
  if (!record.due_date || record.closed_at) return false;
  const due = dateOnlyToEndOfDay(record.due_date).getTime();
  const ms = now.getTime();
  return due >= ms && due <= ms + windowDays * 24 * 3600_000;
}

export function dateOnlyToEndOfDay(dateOnly: string): Date {
  return new Date(`${dateOnly}T23:59:59.999`);
}

export function formatDateShort(value: string | null): string {
  if (!value) return "-";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatDateInput(value: string | null): string {
  if (!value) return "";
  return value.slice(0, 10);
}

export function optionLabel(
  optionId: string | null,
  optionById: Map<string, EnrollmentOption>
): string {
  return optionId ? optionById.get(optionId)?.label ?? "Unknown" : "None";
}

export function optionColor(
  optionId: string | null,
  optionById: Map<string, EnrollmentOption>
): string | null {
  return optionId ? optionById.get(optionId)?.color ?? null : null;
}
