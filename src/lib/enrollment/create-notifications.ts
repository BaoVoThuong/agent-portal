import {
  uniqueEnrollmentNotificationRecipients,
  uniqueEnrollmentNotificationRows,
  type EnrollmentNotificationInsertInput,
} from "./notifications";

/**
 * New enrollment records notify their caller/responsible people and every
 * active task.manage holder. Each recipient gets one, correctly worded row:
 * direct assignment takes precedence over the general created-record notice.
 */
export function buildCreateEnrollmentNotificationRows(input: {
  recordId: string;
  actorEmail: string;
  assignees: string[];
  createdRecipients: string[];
}): EnrollmentNotificationInsertInput[] {
  const assigned = uniqueEnrollmentNotificationRecipients(input.assignees, [input.actorEmail]);
  const created = uniqueEnrollmentNotificationRecipients(input.createdRecipients, [
    input.actorEmail,
    ...assigned,
  ]);

  return uniqueEnrollmentNotificationRows([
    ...assigned.map((recipient) => ({
      recipient_email: recipient,
      record_id: input.recordId,
      type: "assigned" as const,
      actor_email: input.actorEmail,
    })),
    ...created.map((recipient) => ({
      recipient_email: recipient,
      record_id: input.recordId,
      type: "record_created" as const,
      actor_email: input.actorEmail,
    })),
  ]);
}

/**
 * Key pipeline stages are visible to the same task-management audience as a
 * newly created enrollment. Caller/responsible recipients remain included;
 * task managers receive the stage event even when neither role is assigned.
 */
export function buildStageChangedEnrollmentNotificationRows(input: {
  recordId: string;
  actorEmail: string;
  callerEmail?: string | null;
  responsibleEmail?: string | null;
  taskManagerEmails: string[];
  detail: string;
}): EnrollmentNotificationInsertInput[] {
  const recipients = uniqueEnrollmentNotificationRecipients(
    [input.callerEmail, input.responsibleEmail, ...input.taskManagerEmails],
    [input.actorEmail],
  );

  return uniqueEnrollmentNotificationRows(
    recipients.map((recipient) => ({
      recipient_email: recipient,
      record_id: input.recordId,
      type: "stage_changed" as const,
      actor_email: input.actorEmail,
      detail: input.detail,
    })),
  );
}
