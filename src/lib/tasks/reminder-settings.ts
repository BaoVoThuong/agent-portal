export type ReminderSettings = {
  dueSoonMinutes: number;
  overdueReminderHours: number;
  waitingHours: number;
  staleHours: number;
};

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  dueSoonMinutes: 15,
  overdueReminderHours: 24,
  waitingHours: 24,
  staleHours: 48,
};

function posInt(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : fallback;
}

export function resolveReminderSettings(row: unknown): ReminderSettings {
  const r = (row ?? {}) as Record<string, unknown>;

  return {
    dueSoonMinutes: posInt(
      r.due_soon_minutes,
      DEFAULT_REMINDER_SETTINGS.dueSoonMinutes
    ),
    overdueReminderHours: posInt(
      r.overdue_reminder_hours,
      DEFAULT_REMINDER_SETTINGS.overdueReminderHours
    ),
    waitingHours: posInt(
      r.waiting_hours,
      DEFAULT_REMINDER_SETTINGS.waitingHours
    ),
    staleHours: posInt(r.stale_hours, DEFAULT_REMINDER_SETTINGS.staleHours),
  };
}
