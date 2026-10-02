import { describe, expect, it } from "vitest";
import {
  addDays,
  businessDate,
  businessEndOfDay,
  classifyDueRecord,
  dueRecipients,
  reminderResetForDueChange,
} from "./due-schedule";

describe("enrollment due schedule", () => {
  it("uses the Texas business date", () => {
    expect(businessDate(new Date("2026-10-02T03:00:00.000Z"))).toBe("2026-10-01");
    expect(addDays("2026-10-01", 1)).toBe("2026-10-02");
  });

  it("classifies due and overdue records by date", () => {
    const base = {
      closed_at: null,
      due_soon_notified_at: null,
      overdue_notified_at: null,
      overdue_reminded_at: null,
    };
    expect(classifyDueRecord({ ...base, due_date: "2026-10-02" }, "2026-10-01")).toBe("due_soon");
    expect(classifyDueRecord({ ...base, due_date: "2026-09-30" }, "2026-10-01")).toBe("overdue");
    expect(classifyDueRecord({ ...base, due_date: "2026-09-30", overdue_notified_at: "2026-09-30T13:00:00Z", overdue_reminded_at: "2026-09-30T13:00:00Z" }, "2026-10-01")).toBe("overdue_reminder");
    expect(classifyDueRecord({ ...base, due_date: "2026-09-30", overdue_notified_at: "2026-09-30T13:00:00Z", overdue_reminded_at: "2026-10-01T13:00:00Z" }, "2026-10-01")).toBeNull();
    expect(classifyDueRecord({ ...base, due_date: "2026-09-30", closed_at: "2026-09-30T13:00:00Z" }, "2026-10-01")).toBeNull();
  });

  it("does not remind twice on the same business day", () => {
    const record = {
      due_date: "2026-09-30",
      closed_at: null,
      due_soon_notified_at: null,
      overdue_notified_at: "2026-10-01T13:00:00Z",
      overdue_reminded_at: null,
    };

    expect(classifyDueRecord(record, "2026-10-01")).toBeNull();
    expect(
      classifyDueRecord(
        { ...record, overdue_notified_at: "2026-09-30T13:00:00Z" },
        "2026-10-01",
      ),
    ).toBe("overdue_reminder");
  });

  it("resets reminder markers only when due changes", () => {
    expect(reminderResetForDueChange(null, undefined)).toEqual({});
    expect(reminderResetForDueChange("2026-10-01", "2026-10-01")).toEqual({});
    expect(reminderResetForDueChange("2026-10-01", "2026-10-02")).toEqual({
      due_soon_notified_at: null,
      overdue_notified_at: null,
      overdue_reminded_at: null,
    });
  });

  it("routes due reminders to owners and overdue reminders to managers", () => {
    const record = {
      caller_email: "CALLER@example.com",
      responsible_enroll_email: null,
      agent_email: "agent@example.com",
    };
    expect(dueRecipients("due_soon", record, ["manager@example.com"])).toEqual([
      "caller@example.com",
      "agent@example.com",
    ]);
    expect(dueRecipients("overdue", record, ["manager@example.com", "MANAGER@example.com"])).toEqual([
      "caller@example.com",
      "agent@example.com",
      "manager@example.com",
    ]);
  });

  it("keeps the end of a business date in the configured timezone", () => {
    expect(businessDate(businessEndOfDay("2026-11-01"))).toBe("2026-11-01");
  });
});
