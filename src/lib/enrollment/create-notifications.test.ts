import { describe, expect, it } from "vitest";
import { buildCreateEnrollmentNotificationRows } from "./create-notifications";

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
});
