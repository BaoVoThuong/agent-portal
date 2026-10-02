export const ENROLLMENT_BUSINESS_TIME_ZONE = "America/Chicago";

export type DueAction = "due_soon" | "overdue" | "overdue_reminder";

export type DueRecordSchedule = {
  due_date: string | null;
  closed_at: string | null;
  due_soon_notified_at: string | null;
  overdue_notified_at: string | null;
  overdue_reminded_at: string | null;
  caller_email: string | null;
  responsible_enroll_email: string | null;
  agent_email: string | null;
};

export function businessDate(
  at: Date,
  timeZone = ENROLLMENT_BUSINESS_TIME_ZONE,
): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}

export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function businessEndOfDay(
  date: string,
  timeZone = ENROLLMENT_BUSINESS_TIME_ZONE,
): Date {
  const guessedUtc = new Date(`${date}T23:59:59.999Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(guessedUtc);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const localAsUtc = Date.UTC(
    Number(values.get("year")),
    Number(values.get("month")) - 1,
    Number(values.get("day")),
    Number(values.get("hour")),
    Number(values.get("minute")),
    Number(values.get("second")),
  ) + 999;
  const offset = localAsUtc - guessedUtc.getTime();
  return new Date(guessedUtc.getTime() - offset);
}

export function classifyDueRecord(
  record: Pick<
    DueRecordSchedule,
    | "due_date"
    | "closed_at"
    | "due_soon_notified_at"
    | "overdue_notified_at"
    | "overdue_reminded_at"
  >,
  today: string,
): DueAction | null {
  if (record.closed_at || !record.due_date) return null;
  if (record.due_date < today) {
    if (!record.overdue_notified_at) return "overdue";
    const lastReminder = (record.overdue_reminded_at ?? record.overdue_notified_at)
      ? businessDate(
          new Date(record.overdue_reminded_at ?? record.overdue_notified_at!),
        )
      : null;
    return lastReminder === null || lastReminder < today
      ? "overdue_reminder"
      : null;
  }
  if (record.due_date <= addDays(today, 1) && !record.due_soon_notified_at) {
    return "due_soon";
  }
  return null;
}

export function reminderResetForDueChange(
  currentDue: string | null,
  nextDue: string | null | undefined,
): Record<string, null> {
  if (nextDue === undefined || nextDue === currentDue) return {};
  return {
    due_soon_notified_at: null,
    overdue_notified_at: null,
    overdue_reminded_at: null,
  };
}

function ownerEmails(record: Pick<DueRecordSchedule, "caller_email" | "responsible_enroll_email" | "agent_email">): string[] {
  return [record.caller_email, record.responsible_enroll_email, record.agent_email]
    .map((email) => email?.trim().toLowerCase() ?? "")
    .filter(Boolean);
}

export function dueRecipients(
  action: DueAction,
  record: Pick<DueRecordSchedule, "caller_email" | "responsible_enroll_email" | "agent_email">,
  managerEmails: readonly string[],
): string[] {
  const recipients = action === "due_soon"
    ? ownerEmails(record)
    : [...ownerEmails(record), ...managerEmails.map((email) => email.trim().toLowerCase())];
  return [...new Set(recipients.filter(Boolean))];
}
