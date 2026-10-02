import { describe, expect, it } from "vitest";
import { redactEnrollmentNotification } from "./notification-redaction";

describe("redactEnrollmentNotification", () => {
  const row = {
    entity_type: "enrollment",
    task_title: "Sensitive client",
    comment_body: "Sensitive comment",
    detail: "Sensitive attachment name and reopen reason",
  };

  it("keeps content for a currently accessible record", () => {
    expect(redactEnrollmentNotification(row, true)).toMatchObject({
      entity_accessible: true,
      task_title: "Sensitive client",
      comment_body: "Sensitive comment",
      detail: "Sensitive attachment name and reopen reason",
    });
  });

  it("redacts old content when scope is gone", () => {
    expect(redactEnrollmentNotification(row, false)).toMatchObject({
      entity_accessible: false,
      task_title: null,
      comment_body: null,
      detail: null,
    });
  });
});
