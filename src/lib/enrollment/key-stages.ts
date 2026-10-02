import type { EnrollmentProgram } from "./types";

export const KEY_STAGE_LABELS_BY_PROGRAM: Record<
  EnrollmentProgram,
  ReadonlySet<string>
> = {
  aca: new Set(["5-ready to enroll", "12-terminated"]),
  medicare: new Set(["5-ready to enroll", "11-terminated"]),
  medicaid: new Set(["urgent", "need apply", "approved"]),
};

export function isKeyStage(
  program: EnrollmentProgram,
  option: { label: string } | null | undefined,
): boolean {
  return Boolean(
    option &&
      KEY_STAGE_LABELS_BY_PROGRAM[program].has(option.label.trim().toLowerCase()),
  );
}
