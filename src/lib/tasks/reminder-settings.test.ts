import { describe, expect, it } from "vitest";
import {
  DEFAULT_REMINDER_SETTINGS,
  isReminderSettingValueInBounds,
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
      qcHours: 24,
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

  it("preserves the DB version and rejects fractional or impractical values", () => {
    expect(resolveReminderSettings({ updated_at: "2026-08-15T00:00:00.000Z" }).updatedAt).toBe(
      "2026-08-15T00:00:00.000Z"
    );
    expect(isReminderSettingValueInBounds("todoHours", 24)).toBe(true);
    expect(isReminderSettingValueInBounds("todoHours", 1.5)).toBe(false);
    expect(isReminderSettingValueInBounds("dueSoonMinutes", 7 * 24 * 60 + 1)).toBe(false);
  });
});
