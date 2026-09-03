import type { TimeOffHoliday } from "./types";

type HolidaySeed = { date: string; name: string };

function dateKey(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

function dateFromKey(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

function observedDate(value: string): string {
  const date = dateFromKey(value);
  const weekday = date.getUTCDay();
  if (weekday === 6) date.setUTCDate(date.getUTCDate() - 1);
  if (weekday === 0) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function nthWeekdayOfMonth(
  year: number,
  month: number,
  weekday: number,
  occurrence: number
): string {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const delta = (weekday - first.getUTCDay() + 7) % 7;
  return dateKey(year, month, 1 + delta + (occurrence - 1) * 7);
}

function lastWeekdayOfMonth(year: number, month: number, weekday: number): string {
  const last = new Date(Date.UTC(year, month, 0));
  const delta = (last.getUTCDay() - weekday + 7) % 7;
  return dateKey(year, month, last.getUTCDate() - delta);
}

function federalHolidaySeeds(year: number): HolidaySeed[] {
  const fixed: HolidaySeed[] = [
    { date: dateKey(year, 1, 1), name: "New Year's Day" },
    { date: dateKey(year, 6, 19), name: "Juneteenth National Independence Day" },
    { date: dateKey(year, 7, 4), name: "Independence Day" },
    { date: dateKey(year, 11, 11), name: "Veterans Day" },
    { date: dateKey(year, 12, 25), name: "Christmas Day" },
  ];

  if (year < 2021) {
    fixed.splice(1, 1);
  }

  return [
    ...fixed,
    { date: nthWeekdayOfMonth(year, 1, 1, 3), name: "Martin Luther King Jr. Day" },
    { date: nthWeekdayOfMonth(year, 2, 1, 3), name: "Washington's Birthday" },
    { date: lastWeekdayOfMonth(year, 5, 1), name: "Memorial Day" },
    { date: nthWeekdayOfMonth(year, 9, 1, 1), name: "Labor Day" },
    { date: nthWeekdayOfMonth(year, 10, 1, 2), name: "Columbus Day" },
    { date: nthWeekdayOfMonth(year, 11, 4, 4), name: "Thanksgiving Day" },
  ];
}

/**
 * US federal holidays observed by federal employees. When a fixed-date
 * holiday lands on Saturday/Sunday, its Friday/Monday observance is returned.
 * The adjacent years are included so the observed New Year's Day on Dec 31 is
 * present in the year where employees are actually off.
 */
export function getUsFederalHolidays(year: number): TimeOffHoliday[] {
  const holidays = new Map<string, TimeOffHoliday>();
  for (const sourceYear of [year - 1, year, year + 1]) {
    for (const seed of federalHolidaySeeds(sourceYear)) {
      const observed = observedDate(seed.date);
      if (!observed.startsWith(`${year}-`)) continue;
      holidays.set(observed, {
        id: `us-${observed}`,
        date: observed,
        name: seed.name,
        source: "us_federal",
      });
    }
  }
  return [...holidays.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function getUsFederalHolidaysInRange(
  startDate: string,
  endDate: string
): TimeOffHoliday[] {
  const firstYear = Number(startDate.slice(0, 4));
  const lastYear = Number(endDate.slice(0, 4));
  const years = new Set<number>([firstYear, lastYear]);
  return [...years]
    .flatMap(getUsFederalHolidays)
    .filter((holiday) => holiday.date >= startDate && holiday.date <= endDate)
    .sort((a, b) => a.date.localeCompare(b.date));
}
