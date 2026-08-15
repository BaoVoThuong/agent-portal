import type { ColumnType } from "./types";

export type CustomValueContext = {
  optionIds?: ReadonlySet<string>;
  optionLabelById?: ReadonlyMap<string, string>;
  optionIdByLabel?: ReadonlyMap<string, string>;
  personEmails?: ReadonlySet<string>;
  personLabelByEmail?: ReadonlyMap<string, string>;
  personEmailByLabel?: ReadonlyMap<string, string>;
};

export type CoerceResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

export type EnrollmentOptionRuleInput = {
  program: string;
  setKey: string;
  isStage: boolean;
  isTerminal?: unknown;
  triggersQc?: unknown;
  treatAsTerminal?: unknown;
};

export function validateEnrollmentOptionRules(
  input: EnrollmentOptionRuleInput
): { ok: true } | { ok: false; error: string } {
  if (input.isTerminal === true && !input.isStage) {
    return { ok: false, error: "Workflow terminal is only valid for Stage options." };
  }
  if (input.triggersQc === true && !input.isStage) {
    return { ok: false, error: "QC is only valid for Stage options." };
  }
  if (
    input.treatAsTerminal === true &&
    !(input.program === "aca" && input.setKey === "stage" && input.isStage)
  ) {
    return { ok: false, error: "ACA dashboard terminal is only valid for ACA Stage options." };
  }
  return { ok: true };
}

/**
 * Compare a pending custom-field value with the persisted value using the
 * same canonicalization rules as the custom-field editor.
 */
export function normalizedValueEquals(
  type: ColumnType,
  current: unknown,
  next: unknown
): boolean {
  if ((current === "" || current === undefined) && next === null) return true;
  if (type === "person" && typeof current === "string" && typeof next === "string") {
    return current.trim().toLowerCase() === next.trim().toLowerCase();
  }
  return current === next;
}

export function coerceCustomValue(
  type: ColumnType,
  raw: unknown,
  ctx: CustomValueContext = {}
): CoerceResult {
  if (raw === null || raw === undefined || raw === "") {
    return { ok: true, value: null };
  }

  switch (type) {
    case "text":
    case "link":
      return { ok: true, value: String(raw).trim() };
    case "number": {
      const value = typeof raw === "number" ? raw : Number(String(raw).trim());
      return Number.isFinite(value)
        ? { ok: true, value }
        : { ok: false, error: "Enter a valid number." };
    }
    case "date": {
      const text = String(raw).trim();
      if (isIsoDate(text)) {
        return { ok: true, value: text };
      }
      const slashDate = parseSlashDate(text);
      if (slashDate) return { ok: true, value: slashDate };
      const parsed = new Date(text);
      if (Number.isNaN(parsed.getTime())) {
        return { ok: false, error: "Enter a valid date." };
      }
      return { ok: true, value: parsed.toISOString().slice(0, 10) };
    }
    case "checkbox":
      if (typeof raw === "boolean") return { ok: true, value: raw };
      if (typeof raw === "number") return { ok: true, value: raw !== 0 };
      if (typeof raw === "string") {
        const value = raw.trim().toLowerCase();
        if (["true", "yes", "y", "1", "checked"].includes(value)) {
          return { ok: true, value: true };
        }
        if (["false", "no", "n", "0", "unchecked"].includes(value)) {
          return { ok: true, value: false };
        }
      }
      return { ok: false, error: "Enter a valid checkbox value." };
    case "dropdown": {
      const value = String(raw).trim();
      const optionId = ctx.optionIdByLabel?.get(value.toLowerCase()) ?? value;
      if (ctx.optionIds && !ctx.optionIds.has(optionId)) {
        return { ok: false, error: "Select a valid option." };
      }
      return { ok: true, value: optionId };
    }
    case "person": {
      const text = String(raw).trim();
      const email = ctx.personEmailByLabel?.get(text.toLowerCase()) ?? text.toLowerCase();
      if (ctx.personEmails && !ctx.personEmails.has(email)) {
        return { ok: false, error: "Select a valid person." };
      }
      return { ok: true, value: email };
    }
  }
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function parseSlashDate(value: string): string | null {
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
}

export function formatCustomValue(
  type: ColumnType,
  value: unknown,
  ctx: CustomValueContext = {}
): string {
  if (value === null || value === undefined || value === "") return "";

  switch (type) {
    case "checkbox":
      return value ? "Yes" : "No";
    case "dropdown": {
      const id = String(value);
      return ctx.optionLabelById?.get(id) ?? id;
    }
    case "person": {
      const email = String(value).toLowerCase();
      return ctx.personLabelByEmail?.get(email) ?? email;
    }
    case "number":
      return typeof value === "number" ? String(value) : String(value);
    case "date": {
      const raw = String(value);
      const date = new Date(`${raw.slice(0, 10)}T00:00:00`);
      if (Number.isNaN(date.getTime())) return raw;
      return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    }
    case "link":
    case "text":
      return String(value);
  }
}
