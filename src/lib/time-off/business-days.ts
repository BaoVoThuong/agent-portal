/** Date-only keys keep leave calculations independent of browser time zones. */
export function isDateKey(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function toUtcDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

function toDateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function countLeaveBusinessDays(
  startDate: string,
  endDate: string,
  holidayDates: ReadonlySet<string>
): number {
  if (!isDateKey(startDate) || !isDateKey(endDate) || startDate > endDate) return 0;
  let days = 0;
  const cursor = toUtcDate(startDate);
  const end = toUtcDate(endDate);
  while (cursor <= end) {
    const weekday = cursor.getUTCDay();
    const key = toDateKey(cursor);
    if (weekday !== 0 && weekday !== 6 && !holidayDates.has(key)) days += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

export function monthBounds(monthKey: string): { start: string; end: string } | null {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) return null;
  const date = new Date(`${monthKey}-01T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 7) !== monthKey) return null;
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
  return { start: `${monthKey}-01`, end: toDateKey(end) };
}
