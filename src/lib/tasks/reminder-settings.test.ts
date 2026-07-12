import { describe, expect, it } from "vitest";
import {
  DEFAULT_REMINDER_SETTINGS,
  resolveReminderSettings,
} from "@/lib/tasks/reminder-settings";

describe("resolveReminderSettings", () => {
  it("returns defaults for null/empty", () => {
    expect(resolveReminderSettings(null)).toEqual(DEFAULT_REMINDER_SETTINGS);
  });

  it("maps snake_case DB row to camelCase", () => {
    expect(
      resolveReminderSettings({
        due_soon_minutes: 10,
        todo_hours: 8,
        overdue_reminder_hours: 12,
        waiting_hours: 6,
        stale_hours: 72,
      })
    ).toEqual({
      dueSoonMinutes: 10,
      todoHours: 8,
      overdueReminderHours: 12,
      waitingHours: 6,
      staleHours: 72,
    });
  });

  it("falls back per-field for invalid values", () => {
    const r = resolveReminderSettings({
      due_soon_minutes: 0,
      stale_hours: -1,
    });

    expect(r.dueSoonMinutes).toBe(
      DEFAULT_REMINDER_SETTINGS.dueSoonMinutes
    );
    expect(r.staleHours).toBe(DEFAULT_REMINDER_SETTINGS.staleHours);
  });
});
