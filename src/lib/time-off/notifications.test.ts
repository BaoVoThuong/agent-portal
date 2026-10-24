import { describe, expect, it } from "vitest";
import {
  timeOffDecisionRows,
  uniqueTimeOffNotificationRows,
  type TimeOffNotificationInsertInput,
} from "@/lib/time-off/notifications";

function row(
  recipient: string,
  overrides: Partial<TimeOffNotificationInsertInput> = {},
): TimeOffNotificationInsertInput {
  return {
    recipient_email: recipient,
    request_id: "req-1",
    type: "submitted",
    actor_email: "requester@example.com",
    ...overrides,
  };
}

describe("uniqueTimeOffNotificationRows", () => {
  // Đây là ca thật sự xảy ra: người được chọn làm manager thường CŨNG là người
  // có quyền duyệt, nên họ lọt vào cả hai danh sách người nhận. Không gộp thì
  // index duy nhất dưới database làm cả lượt insert thất bại.
  it("collapses someone who is both the chosen manager and an approver", () => {
    const rows = uniqueTimeOffNotificationRows([
      row("manager@example.com"),
      row("manager@example.com"),
      row("hr@example.com"),
    ]);
    expect(rows.map((r) => r.recipient_email)).toEqual([
      "manager@example.com",
      "hr@example.com",
    ]);
  });

  it("treats addresses differing only by case or spacing as one person", () => {
    const rows = uniqueTimeOffNotificationRows([
      row("  Manager@Example.com  "),
      row("manager@example.com"),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].recipient_email).toBe("manager@example.com");
  });

  it("keeps the same person for different requests", () => {
    const rows = uniqueTimeOffNotificationRows([
      row("manager@example.com", { request_id: "req-1" }),
      row("manager@example.com", { request_id: "req-2" }),
    ]);
    expect(rows).toHaveLength(2);
  });

  it("keeps the same person for different event types on one request", () => {
    const rows = uniqueTimeOffNotificationRows([
      row("manager@example.com", { type: "submitted" }),
      row("manager@example.com", { type: "approved" }),
    ]);
    expect(rows).toHaveLength(2);
  });

  it("drops rows with no recipient rather than writing a blank address", () => {
    expect(
      uniqueTimeOffNotificationRows([row(""), row("   "), row("ok@example.com")]),
    ).toHaveLength(1);
  });

  it("returns nothing for an empty batch so callers can skip the insert", () => {
    expect(uniqueTimeOffNotificationRows([])).toEqual([]);
  });
});

describe("timeOffDecisionRows", () => {
  const base = {
    requestId: "req-1",
    requesterEmail: "Agent@X.com",
    submissionRecipients: ["manager@x.com", "admin@x.com", "agent@x.com"],
    detail: "2 ngày, 2026-11-02 → 2026-11-03",
  };

  it("tells the requester the request was approved or rejected", () => {
    expect(timeOffDecisionRows({ ...base, decision: "approve", actorEmail: "admin@x.com" })).toEqual([
      {
        recipient_email: "agent@x.com",
        request_id: "req-1",
        type: "approved",
        actor_email: "admin@x.com",
        detail: "2 ngày, 2026-11-02 → 2026-11-03",
      },
    ]);
    expect(
      timeOffDecisionRows({ ...base, decision: "reject", actorEmail: "admin@x.com" }).map((r) => r.type),
    ).toEqual(["rejected"]);
  });

  it("tells the manager and approvers when the requester cancels, never the requester", () => {
    const rows = timeOffDecisionRows({ ...base, decision: "cancel", actorEmail: "agent@x.com" });
    expect(rows.map((r) => [r.recipient_email, r.type])).toEqual([
      ["manager@x.com", "cancelled"],
      ["admin@x.com", "cancelled"],
    ]);
  });

  it("does not notify the person who acted", () => {
    expect(timeOffDecisionRows({ ...base, decision: "approve", actorEmail: "agent@x.com" })).toEqual([]);
  });
});
