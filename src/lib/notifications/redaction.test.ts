import { describe, expect, it } from "vitest";
import { redactNotification } from "./redaction";

const notification = {
  id: "task:notification-1",
  entity_type: "task" as const,
  task_id: "private-task-id",
  entity_id: "private-task-id",
  comment_id: "private-comment-id",
  task_title: "Private client",
  comment_body: "Private comment",
  detail: "Private reason",
  actor_email: "actor@example.com",
  actor_name: "Actor",
  entity_display_number: 42,
  is_read: false,
};

describe("redactNotification", () => {
  it("preserves current notification content for an accessible record", () => {
    expect(redactNotification(notification, true)).toEqual({
      ...notification,
      entity_accessible: true,
    });
  });

  it.each(["task", "enrollment", "time_off"] as const)(
    "keeps the unread row but removes %s content after access is lost",
    (entityType) => {
      expect(redactNotification({ ...notification, entity_type: entityType }, false)).toEqual({
        ...notification,
        entity_type: entityType,
        entity_accessible: false,
        task_id: "",
        entity_id: "",
        comment_id: null,
        task_title: null,
        comment_body: null,
        detail: null,
        actor_email: "",
        actor_name: null,
        entity_display_number: null,
      });
    },
  );
});
