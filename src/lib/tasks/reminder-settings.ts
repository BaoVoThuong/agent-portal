export type ReminderSettings = {
  dueSoonMinutes: number;
  todoHours: number;
  overdueReminderHours: number;
  waitingHours: number;
  staleHours: number;
  qcHours: number;
  updatedAt?: string | null;
};

export type ReminderSettingKey =
  | "dueSoonMinutes"
  | "todoHours"
  | "overdueReminderHours"
  | "waitingHours"
  | "staleHours"
  | "qcHours";

export const REMINDER_SETTING_BOUNDS: Record<ReminderSettingKey, { min: number; max: number }> = {
  dueSoonMinutes: { min: 1, max: 7 * 24 * 60 },
  todoHours: { min: 1, max: 365 * 24 },
  overdueReminderHours: { min: 1, max: 365 * 24 },
  waitingHours: { min: 1, max: 365 * 24 },
  staleHours: { min: 1, max: 365 * 24 },
  qcHours: { min: 1, max: 365 * 24 },
};

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  dueSoonMinutes: 15,
  todoHours: 24,
  overdueReminderHours: 24,
  waitingHours: 24,
  staleHours: 48,
  qcHours: 24,
};

function posInt(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

export function isReminderSettingKey(value: unknown): value is ReminderSettingKey {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(REMINDER_SETTING_BOUNDS, value);
}

export function isReminderSettingValueInBounds(key: ReminderSettingKey, value: unknown): value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return false;
  const bounds = REMINDER_SETTING_BOUNDS[key];
  return value >= bounds.min && value <= bounds.max;
}

export function resolveReminderSettings(row: unknown): ReminderSettings {
  const r = (row ?? {}) as Record<string, unknown>;

  const settings: ReminderSettings = {
    dueSoonMinutes: posInt(
      r.due_soon_minutes,
      DEFAULT_REMINDER_SETTINGS.dueSoonMinutes
    ),
    todoHours: posInt(r.todo_hours, DEFAULT_REMINDER_SETTINGS.todoHours),
    overdueReminderHours: posInt(
      r.overdue_reminder_hours,
      DEFAULT_REMINDER_SETTINGS.overdueReminderHours
    ),
    waitingHours: posInt(
      r.waiting_hours,
      DEFAULT_REMINDER_SETTINGS.waitingHours
    ),
    staleHours: posInt(r.stale_hours, DEFAULT_REMINDER_SETTINGS.staleHours),
    qcHours: posInt(r.qc_hours, DEFAULT_REMINDER_SETTINGS.qcHours),
  };
  if (typeof r.updated_at === "string") settings.updatedAt = r.updated_at;
  return settings;
}
