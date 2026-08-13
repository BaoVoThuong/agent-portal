import { compareEnrollmentOptionText } from "./options";
import type { EnrollmentOption } from "./types";

export function isDashboardTerminal(stage: EnrollmentOption): boolean {
  return Boolean(stage.is_terminal) || Boolean(stage.treat_as_terminal);
}
export function orderStages(stages: readonly EnrollmentOption[]): EnrollmentOption[] {
  return [...stages].sort((a, b) => compareEnrollmentOptionText(a.label, b.label));
}
export function runningStages(stages: readonly EnrollmentOption[]): EnrollmentOption[] {
  return orderStages(stages).filter((stage) => !isDashboardTerminal(stage));
}
