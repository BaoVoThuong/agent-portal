export const ENROLLMENT_TOPIC = "enrollment-stream";

export function enrollmentRoomTopic(recordId: string): string {
  return `enrollment-${recordId}`;
}
