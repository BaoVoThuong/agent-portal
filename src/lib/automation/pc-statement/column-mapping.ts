/**
 * The five payment-file columns the P&C statement actually uses, and the
 * user's mapping of each to a column of their file (2026-10-21).
 *
 * The parser used to require twelve columns by exact header text, five of
 * which fed nothing; when the carrier renamed "Commission Paid to TWFG" to
 * "Ag Comm" every run failed. Now the upload step lists the file's columns,
 * pre-fills these five from the header text, and the user drags a column onto
 * any input the guess got wrong. Shared by the parser (server) and the
 * mapping UI (client), so it must stay free of server-only imports.
 */

export type PcInputKind = "text" | "date" | "number";

export const PC_INPUT_FIELDS = [
  {
    key: "insured",
    label: "Insured",
    kind: "text",
    aliases: ["insured", "insured name", "named insured"],
  },
  {
    key: "policyNo",
    label: "Policy No",
    kind: "text",
    aliases: ["policy no", "policy number", "policy #", "policy no."],
  },
  {
    key: "policyExp",
    label: "Policy Exp",
    kind: "date",
    aliases: ["policy exp", "policy expiration", "policy expiration date", "expiration date", "exp date"],
  },
  {
    key: "premium",
    label: "Commissionable Premium",
    kind: "number",
    aliases: ["commissionable premium", "comm premium", "commissionable prem"],
  },
  {
    key: "carrierRate",
    label: "Carrier Rate",
    kind: "number",
    aliases: ["carrier rate (%)", "carrier rate", "carrier rate %"],
  },
] as const satisfies ReadonlyArray<{
  key: string;
  label: string;
  kind: PcInputKind;
  aliases: readonly string[];
}>;

export type PcInputField = (typeof PC_INPUT_FIELDS)[number]["key"];

/** Input field → column letters of the payment file ("A", "K", "AB"). */
export type PcColumnMapping = Record<PcInputField, string>;

export type PcFileColumn = {
  letter: string;
  label: string;
  samples: string[];
};

export type PcWorkbookInspection = {
  sheet: string | null;
  /** 1-based, as Excel shows it. */
  headerRow: number | null;
  columns: PcFileColumn[];
  /** The first data rows, one cell per entry of `columns`, for the mapping preview. */
  preview: string[][];
  suggested: Partial<PcColumnMapping>;
};

const COLUMN_LETTERS_RE = /^[A-Z]{1,3}$/;

export function columnLetters(index: number): string {
  let value = index + 1;
  let output = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    output = String.fromCharCode(65 + remainder) + output;
    value = Math.floor((value - 1) / 26);
  }
  return output;
}

export function columnIndex(letters: string): number {
  let value = 0;
  for (const char of letters) value = value * 26 + (char.charCodeAt(0) - 64);
  return value - 1;
}

export function missingPcInputs(mapping: Partial<PcColumnMapping>): PcInputField[] {
  return PC_INPUT_FIELDS.filter((field) => !mapping[field.key]).map((field) => field.key);
}

export function isCompletePcMapping(
  mapping: Partial<PcColumnMapping> | null | undefined,
): mapping is PcColumnMapping {
  return Boolean(mapping) && missingPcInputs(mapping!).length === 0;
}

export function pcInputLabel(field: PcInputField): string {
  return PC_INPUT_FIELDS.find((item) => item.key === field)?.label ?? field;
}

/** One column per input: putting a column on an input takes it off any other. */
export function assignPcColumn(
  mapping: Partial<PcColumnMapping>,
  field: PcInputField,
  letter: string,
): Partial<PcColumnMapping> {
  const next: Partial<PcColumnMapping> = {};
  for (const item of PC_INPUT_FIELDS) {
    if (item.key !== field && mapping[item.key] && mapping[item.key] !== letter) {
      next[item.key] = mapping[item.key];
    }
  }
  next[field] = letter;
  return next;
}

/** A complete mapping from untrusted JSON, or null. Two inputs cannot share a column. */
export function parsePcColumnMapping(value: unknown): PcColumnMapping | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const mapping = {} as PcColumnMapping;
  const used = new Set<string>();
  for (const field of PC_INPUT_FIELDS) {
    const letters = typeof raw[field.key] === "string" ? (raw[field.key] as string).trim().toUpperCase() : "";
    if (!COLUMN_LETTERS_RE.test(letters) || used.has(letters)) return null;
    used.add(letters);
    mapping[field.key] = letters;
  }
  return mapping;
}
