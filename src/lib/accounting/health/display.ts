import { commissionStatus, formatDate, formatMoney, MONTHS, paidDates, parseMoney, type RowField } from "./values";

/**
 * One way to show every cell, whatever the accountant typed: "21", "$21" and
 * "$21.00" all read "$21.00"; "1/31/2026" and "01/31/2026" both read
 * "01/31/2026"; a status code is the same pill in every column of a month.
 * The stored text is never changed — only how it is shown.
 */
export type DisplayValue =
  | { kind: "empty" }
  | { kind: "code"; text: string }
  | { kind: "money"; text: string }
  | { kind: "date"; text: string }
  /** A label from a short list (carrier, state, stage): shown as a Task-style category badge. */
  | { kind: "category"; text: string; color: string | null }
  | { kind: "text"; text: string };

const MONEY_FIELDS = new Set<RowField>(["mp", "ar", "ov", "ovr", "sp"]);
const DATE_FIELDS = new Set<RowField>(["pe", "be", "pt", "ptd"]);
const CATEGORY_FIELDS = new Set<RowField>(["carrier", "state", "stage"]);
/** Stages get a colour that says something; carriers and states get one from their name. */
function stageColor(stage: string): string | null {
  const text = stage.toLowerCase();
  if (text.startsWith("active")) return "#36b37e";
  if (text.startsWith("terminat")) return "#de350b";
  if (text.startsWith("enroll")) return "#4c9aff";
  if (text.includes("call")) return "#ffab00";
  return null;
}
/** Columns of the month block, where a code (P6, NC…) stands in for a value. */
const CODE_FIELDS = new Set<RowField>(["mp", "rate", "ar", "ov", "ovr", "sp", "ptd", "tid", "st"]);

function rateText(value: string) {
  const percent = value.match(/^(\d+(?:\.\d+)?)\s*%$/);
  if (percent) return `${Number(percent[1])}%`;
  if (/^0?\.\d+$|^1(\.0+)?$/.test(value)) return `${Math.round(Number(value) * 100)}%`;
  return value;
}

export function displayValue(field: RowField, raw: string | null | undefined): DisplayValue {
  const value = String(raw ?? "").trim();
  if (!value) return { kind: "empty" };
  if (CODE_FIELDS.has(field)) {
    const status = commissionStatus(value);
    if (status !== "Paid" && status !== "Other") return { kind: "code", text: value.toUpperCase() };
  }
  if (MONEY_FIELDS.has(field)) {
    const amount = parseMoney(value);
    return amount === null ? { kind: "text", text: value } : { kind: "money", text: formatMoney(amount) };
  }
  if (DATE_FIELDS.has(field)) {
    const dates = paidDates(value);
    return dates.length ? { kind: "date", text: dates.map(formatDate).join(", ") } : { kind: "text", text: value };
  }
  if (CATEGORY_FIELDS.has(field)) {
    return { kind: "category", text: value.toUpperCase(), color: field === "stage" ? stageColor(value) : null };
  }
  if (field === "rate") return { kind: "text", text: rateText(value) };
  return { kind: "text", text: value };
}

/** What a status code means, for the band a month shows when it holds only a code. */
export function codeMeaning(code: string): string {
  const text = code.trim().toUpperCase();
  const later = text.match(/^P(\d{1,2})$/);
  if (later && Number(later[1]) >= 1 && Number(later[1]) <= 12) return `Paid in ${MONTHS[Number(later[1]) - 1]}`;
  switch (text) {
    case "P":
      return "Pending";
    case "NC":
      return "No commission";
    case "N/C":
      return "No contract";
    case "T":
      return "Terminated";
    case "UP":
      return "Unpaid premium";
    case "C":
    case "CHARGEBACK":
      return "Chargeback";
    default:
      return "";
  }
}
