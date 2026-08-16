import { compareEnrollmentOptionText } from "./options";
import type { EnrollmentOption } from "./types";

export function isTerminalStage(stage: EnrollmentOption): boolean {
  // The overview and workflow share one terminal definition. The legacy
  // treat_as_terminal column remains only for database compatibility and is
  // intentionally ignored.
  return Boolean(stage.is_terminal);
}
export function orderStages(stages: readonly EnrollmentOption[]): EnrollmentOption[] {
  return [...stages].sort((a, b) => compareEnrollmentOptionText(a.label, b.label));
}
export function runningStages(stages: readonly EnrollmentOption[]): EnrollmentOption[] {
  return orderStages(stages).filter((stage) => !isTerminalStage(stage));
}
