import {
  enrollmentRecordOwnerEmails,
  uniqueEnrollmentNotificationRecipients,
  uniqueEnrollmentNotificationRows,
  type EnrollmentNotificationInsertInput,
} from "./notifications";
import { isKeyStage } from "./key-stages";
import type { EnrollmentOption, EnrollmentProgram } from "./types";

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

/** Builds assignment notifications from the field-level change semantics. */
export function buildAssignmentNotificationRows(input: {
  recordId: string;
  actorEmail: string;
  callerEmail?: string | null;
  responsibleEmail?: string | null;
  agentEmail?: string | null;
  changedFields: readonly string[];
}): EnrollmentNotificationInsertInput[] {
  const agentChanged = input.changedFields.includes("agent_email");
  const recipients = uniqueEnrollmentNotificationRecipients(
    agentChanged
      ? [input.agentEmail]
      : [input.callerEmail, input.responsibleEmail],
    [input.actorEmail],
  );
  const detail = agentChanged
    ? "Enrollment agent changed"
    : "Enrollment responsibility changed";

  return uniqueEnrollmentNotificationRows(
    recipients.map((recipient) => ({
      recipient_email: recipient,
      record_id: input.recordId,
      type: "assigned" as const,
      actor_email: input.actorEmail,
      detail,
    })),
  );
}

export function buildStageNotifications(input: {
  program: EnrollmentProgram;
  fromStage: Pick<EnrollmentOption, "is_terminal"> | null;
  toStage: Pick<EnrollmentOption, "label" | "is_terminal" | "triggers_qc"> | null;
  reopening: boolean;
  recordId: string;
  actorEmail: string;
  callerEmail?: string | null;
  responsibleEmail?: string | null;
  agentEmail?: string | null;
  managerEmails: string[];
  reopenReason?: string | null;
}): EnrollmentNotificationInsertInput[] {
  const owners = enrollmentRecordOwnerEmails({
    caller_email: input.callerEmail ?? null,
    responsible_enroll_email: input.responsibleEmail ?? null,
    agent_email: input.agentEmail ?? null,
  });
  const excluded = [input.actorEmail];
  if (input.reopening) {
    return uniqueEnrollmentNotificationRows(
      uniqueEnrollmentNotificationRecipients(owners, excluded).map((recipient) => ({
        recipient_email: recipient,
        record_id: input.recordId,
        type: "reopened" as const,
        actor_email: input.actorEmail,
        detail: input.reopenReason ?? null,
      })),
    );
  }

  if (!input.toStage) return [];
  const ownerRecipients = uniqueEnrollmentNotificationRecipients(owners, excluded);
  const keyStage = isKeyStage(input.program, input.toStage);
  const qcRecipients = input.toStage.triggers_qc
    ? uniqueEnrollmentNotificationRecipients(
        keyStage ? ownerRecipients : [...ownerRecipients, ...input.managerEmails],
        excluded,
      )
    : [];
  const stageRecipients = keyStage
    ? uniqueEnrollmentNotificationRecipients(
        [...ownerRecipients, ...input.managerEmails],
        [...excluded, ...qcRecipients],
      )
    : [];

  return uniqueEnrollmentNotificationRows([
    ...qcRecipients.map((recipient) => ({
      recipient_email: recipient,
      record_id: input.recordId,
      type: "qc_needed" as const,
      actor_email: input.actorEmail,
      detail: input.toStage!.label,
    })),
    ...stageRecipients.map((recipient) => ({
      recipient_email: recipient,
      record_id: input.recordId,
      type: "stage_changed" as const,
      actor_email: input.actorEmail,
      detail: input.toStage!.label,
    })),
  ]);
}
