import { describe, expect, it } from "vitest";
import {
  ALLOWED_TASK_ACTIVITY_TYPES,
  describeActivity,
  isKnownActivityType,
} from "@/lib/tasks/activity-events";
import { ACTIVITY_LABELS } from "@/app/(authed)/tasks/_components/activity-labels";

describe("task activity vocabulary", () => {
  it("matches the task activity constraint", () => {
    expect([...ALLOWED_TASK_ACTIVITY_TYPES].sort()).toEqual([
      "agent_changed",
      "assigned",
      "attachment_added",
      "attachment_deleted",
      "category_changed",
      "comment_added",
      "comment_deleted",
      "comment_edited",
      "created",
      "done_review_cleared",
      "due_date_overdue",
      "done_reviewed",
      "edited",
      "overdue_unlocked",
      "priority_changed",
      "reopened",
      "status_changed",
      "task_reopened",
      "unassigned",
      "went_overdue",
    ].sort());
  });

  it("does not reject historical or unknown values", () => {
    expect(isKnownActivityType("comment_added")).toBe(true);
    expect(isKnownActivityType("some_legacy_type")).toBe(false);
  });
});

describe("assignment activity wording", () => {
  it("describes a removal as a removal", () => {
    expect(
      describeActivity({
        type: "unassigned",
        meta: { removed: "a@x.com", next_primary: "b@x.com" },
      })
    ).toEqual({ kind: "unassigned", subject: "a@x.com" });
  });

  it("reads historical rows that recorded a removal as assigned", () => {
    expect(
      describeActivity({
        type: "assigned",
        meta: { removed: "a@x.com", to: "b@x.com" },
      })
    ).toEqual({ kind: "unassigned", subject: "a@x.com" });
  });

  it("describes a genuine assignment as an assignment", () => {
    expect(describeActivity({ type: "assigned", meta: { to: "b@x.com" } })).toEqual({
      kind: "assigned",
      subject: "b@x.com",
    });
  });
});

describe("activity renderer coverage", () => {
  it("has exactly one label for every allowed task activity type", () => {
    const labelled = new Set(Object.keys(ACTIVITY_LABELS));
    const allowed = new Set<string>(ALLOWED_TASK_ACTIVITY_TYPES);
    expect([...allowed].filter((type) => !labelled.has(type))).toEqual([]);
    expect([...labelled].filter((type) => !allowed.has(type))).toEqual([]);
  });
});
