import type { EnrollmentProgram } from "./types";

export const ENROLLMENT_TOPIC = "enrollment-stream";
export const ENROLLMENT_MUTATION_SOURCE_HEADER = "x-enrollment-client-source";

export function enrollmentTopic(program: EnrollmentProgram): string {
  return `enrollment-${program}-stream`;
}

export function enrollmentRoomTopic(recordId: string): string {
  return `enrollment-${recordId}`;
}

export function enrollmentReactionTopic(recordId: string): string {
  return `${enrollmentRoomTopic(recordId)}:reactions`;
}
