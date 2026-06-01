type HealthPaidDate = {
  month: number;
  timestamp: number;
  year: number;
};

export function getHealthPaidPeriodLabel(value: string | null | undefined) {
  const dates = (value ?? "")
    .replace(/\s*\/\s*/g, "/")
    .split(/[\s,;|]+/)
    .map(parseHealthPaidDate)
    .filter((date): date is HealthPaidDate => date !== null)
    .sort((a, b) => a.timestamp - b.timestamp);

  if (dates.length < 2) return null;

  const first = dates[0];
  const last = dates[dates.length - 1];
  if (first.month === last.month && first.year === last.year) return null;

  return `${formatHealthPaidMonth(first)} -> ${formatHealthPaidMonth(last)}`;
}

function parseHealthPaidDate(value: string): HealthPaidDate | null {
  const text = value.trim();
  const isoSlashDateMatch = text.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (isoSlashDateMatch) {
    return toHealthPaidDate(
      Number(isoSlashDateMatch[1]),
      Number(isoSlashDateMatch[2]),
      Number(isoSlashDateMatch[3])
    );
  }

  const slashDateMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashDateMatch) {
    const firstNumber = Number(slashDateMatch[1]);
    const secondNumber = Number(slashDateMatch[2]);
    const year = Number(slashDateMatch[3]);

    return firstNumber > 12 && secondNumber <= 12
      ? toHealthPaidDate(year, secondNumber, firstNumber)
      : toHealthPaidDate(year, firstNumber, secondNumber);
  }

  const isoDateMatch = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoDateMatch) {
    return toHealthPaidDate(
      Number(isoDateMatch[1]),
      Number(isoDateMatch[2]),
      Number(isoDateMatch[3])
    );
  }

  const compactDateMatch = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compactDateMatch) {
    return toHealthPaidDate(
      Number(compactDateMatch[1]),
      Number(compactDateMatch[2]),
      Number(compactDateMatch[3])
    );
  }

  const monthNameMatch = text.match(
    /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)-(\d{2})$/i
  );
  if (monthNameMatch) {
    return toHealthPaidDate(
      2000 + Number(monthNameMatch[2]),
      MONTH_NAME_TO_NUMBER[monthNameMatch[1].toLowerCase()],
      1
    );
  }

  const isoMonthMatch = text.match(/^(\d{4})-(\d{2})$/);
  if (isoMonthMatch) {
    return toHealthPaidDate(Number(isoMonthMatch[1]), Number(isoMonthMatch[2]), 1);
  }

  const slashMonthMatch = text.match(/^(\d{1,2})\/(\d{4})$/);
  if (slashMonthMatch) {
    return toHealthPaidDate(Number(slashMonthMatch[2]), Number(slashMonthMatch[1]), 1);
  }

  return null;
}

function toHealthPaidDate(year: number, month: number, day: number): HealthPaidDate | null {
  if (!isValidCalendarDate(year, month, day)) {
    return null;
  }

  return {
    month,
    timestamp: Date.UTC(year, month - 1, 1),
    year,
  };
}

function isValidCalendarDate(year: number, month: number, day: number) {
  if (![year, month, day].every(Number.isInteger)) return false;

  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function formatHealthPaidMonth(date: HealthPaidDate) {
  return `${String(date.month).padStart(2, "0")}/${date.year}`;
}

const MONTH_NAME_TO_NUMBER: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};
