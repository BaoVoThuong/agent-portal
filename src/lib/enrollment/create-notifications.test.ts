import { describe, expect, it } from "vitest";
import {
  buildAssignmentNotificationRows,
  buildCreateEnrollmentNotificationRows,
  buildStageNotifications,
} from "./create-notifications";

describe("new enrollment notification recipients", () => {
  it("notifies task.manage holders when a record is created", () => {
    const rows = buildCreateEnrollmentNotificationRows({
      recordId: "record-1",
      actorEmail: "creator@example.com",
      assignees: [],
      createdRecipients: ["manager@example.com"],
    });

    expect(rows).toEqual([
      {
        recipient_email: "manager@example.com",
        record_id: "record-1",
        type: "record_created",
        actor_email: "creator@example.com",
      },
    ]);
  });

  it("keeps assignment notices for assignees and avoids duplicate/self notices", () => {
    const rows = buildCreateEnrollmentNotificationRows({
      recordId: "record-1",
      actorEmail: "creator@example.com",
      assignees: ["agent@example.com", "manager@example.com"],
      createdRecipients: ["manager@example.com", "manager@example.com", "creator@example.com"],
    });

    expect(rows.map((row) => [row.recipient_email, row.type])).toEqual([
      ["agent@example.com", "assigned"],
      ["manager@example.com", "assigned"],
    ]);
  });

  it("sends one message per recipient when a key stage also triggers QC", () => {
    const rows = buildStageNotifications({
      program: "aca",
      fromStage: { is_terminal: false },
      toStage: { label: "12-Terminated", is_terminal: true, triggers_qc: true },
      reopening: false,
      recordId: "record-1",
      actorEmail: "actor@example.com",
      callerEmail: "caller@example.com",
      responsibleEmail: null,
      agentEmail: "agent@example.com",
      managerEmails: ["manager@example.com"],
    });

    expect(rows.map((row) => [row.recipient_email, row.type])).toEqual([
      ["caller@example.com", "qc_needed"],
      ["agent@example.com", "qc_needed"],
      ["manager@example.com", "stage_changed"],
    ]);
  });

  it("does not send a manager their own key-stage notification", () => {
    const rows = buildStageNotifications({
      program: "aca",
      fromStage: { is_terminal: false },
      toStage: { label: "5-Ready to Enroll", is_terminal: false, triggers_qc: false },
      reopening: false,
      recordId: "record-1",
      actorEmail: "manager@example.com",
      callerEmail: "caller@example.com",
      responsibleEmail: null,
      agentEmail: null,
      managerEmails: ["manager@example.com", "other-manager@example.com"],
    });

    expect(rows.map((row) => row.recipient_email)).toEqual([
      "caller@example.com",
      "other-manager@example.com",
    ]);
  });

  it("sends QC-only stages to owners and managers without a stage-change row", () => {
    const rows = buildStageNotifications({
      program: "aca",
      fromStage: { is_terminal: false },
      toStage: { label: "QC", is_terminal: false, triggers_qc: true },
      reopening: false,
      recordId: "record-1",
      actorEmail: "actor@example.com",
      callerEmail: "caller@example.com",
      responsibleEmail: null,
      agentEmail: null,
      managerEmails: ["manager@example.com"],
    });

    expect(rows.map((row) => [row.recipient_email, row.type])).toEqual([
      ["caller@example.com", "qc_needed"],
      ["manager@example.com", "qc_needed"],
    ]);
  });

  it("does not notify anyone for a non-key stage without QC", () => {
    const rows = buildStageNotifications({
      program: "aca",
      fromStage: { is_terminal: false },
      toStage: { label: "In progress", is_terminal: false, triggers_qc: false },
      reopening: false,
      recordId: "record-1",
      actorEmail: "actor@example.com",
      callerEmail: "caller@example.com",
      responsibleEmail: "responsible@example.com",
      agentEmail: "agent@example.com",
      managerEmails: ["manager@example.com"],
    });

    expect(rows).toEqual([]);
  });

  it("routes assignment notifications to the changed owner only", () => {
    expect(
      buildAssignmentNotificationRows({
        recordId: "record-1",
        actorEmail: "manager@example.com",
        callerEmail: "caller@example.com",
        responsibleEmail: "responsible@example.com",
        agentEmail: "agent@example.com",
        changedFields: ["agent_email"],
      }),
    ).toMatchObject([
      {
        recipient_email: "agent@example.com",
        type: "assigned",
        detail: "Enrollment agent changed",
      },
    ]);

    expect(
      buildAssignmentNotificationRows({
        recordId: "record-1",
        actorEmail: "caller@example.com",
        callerEmail: "caller@example.com",
        responsibleEmail: "responsible@example.com",
        agentEmail: "agent@example.com",
        changedFields: ["caller_email"],
      }).map((row) => row.recipient_email),
    ).toEqual(["responsible@example.com"]);
  });

  it("supports Medicaid key stages without a name-based global list", () => {
    const rows = buildStageNotifications({
      program: "medicaid",
      fromStage: { is_terminal: false },
      toStage: { label: "Approved", is_terminal: false, triggers_qc: false },
      reopening: false,
      recordId: "record-1",
      actorEmail: "actor@example.com",
      callerEmail: null,
      responsibleEmail: null,
      agentEmail: null,
      managerEmails: ["manager@example.com"],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      recipient_email: "manager@example.com",
      type: "stage_changed",
    });
  });
});
