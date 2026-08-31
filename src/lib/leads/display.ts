import type { LeadRow } from "./types";

/**
 * Human-facing lead identifier. Mirrors taskDisplayKey ("CS-123") and
 * enrollmentDisplayKey ("ACA-123") in purpose; the prefix is deliberately
 * unpunctuated because that is the form the team asked for.
 */
export function leadDisplayKey(
  displayNumber: LeadRow["display_number"] | null | undefined
): string {
  return typeof displayNumber === "number" ? `LD${displayNumber}` : "LD—";
}
