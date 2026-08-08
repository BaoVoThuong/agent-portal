import type { EnrollmentProgram } from "./types";

export const ENROLLMENT_TOPIC = "enrollment-stream";

export function enrollmentTopic(program: EnrollmentProgram): string {
  return `enrollment-${program}-stream`;
}

export function enrollmentRoomTopic(recordId: string): string {
  return `enrollment-${recordId}`;
}
