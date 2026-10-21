import { NextResponse } from "next/server";
import { parsePcColumnMapping, type PcColumnMapping } from "./column-mapping";
import { PcColumnMappingError } from "./payment-parser";

/**
 * The `mappings` form field: a JSON array with one entry per uploaded file, in
 * the same order, each a complete column mapping or null (header guess).
 */
export function readPcMappings(
  formData: FormData,
  fileCount: number,
): { ok: true; mappings: Array<PcColumnMapping | null> } | { ok: false; error: string } {
  const raw = formData.get("mappings");
  if (raw === null || raw === "") return { ok: true, mappings: Array(fileCount).fill(null) };
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(raw));
  } catch {
    return { ok: false, error: "Invalid column mapping." };
  }
  if (!Array.isArray(parsed) || parsed.length !== fileCount) {
    return { ok: false, error: "Invalid column mapping." };
  }
  const mappings: Array<PcColumnMapping | null> = [];
  for (const entry of parsed) {
    if (entry === null) {
      mappings.push(null);
      continue;
    }
    const mapping = parsePcColumnMapping(entry);
    if (!mapping) return { ok: false, error: "Each input needs its own column." };
    mappings.push(mapping);
  }
  return { ok: true, mappings };
}

/** 422 telling the page which inputs still need a column, or null for any other error. */
export function mappingRequiredResponse(error: unknown, fileName?: string) {
  if (!(error instanceof PcColumnMappingError)) return null;
  return NextResponse.json(
    {
      error: fileName ? `${fileName}: ${error.message}` : error.message,
      code: "mapping_required",
      missing: error.missing,
    },
    { status: 422 },
  );
}
