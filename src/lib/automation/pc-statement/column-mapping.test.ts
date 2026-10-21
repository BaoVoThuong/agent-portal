import { describe, expect, it } from "vitest";
import {
  assignPcColumn,
  columnIndex,
  columnLetters,
  isCompletePcMapping,
  missingPcInputs,
  parsePcColumnMapping,
} from "./column-mapping";
import { readPcMappings } from "./request-mappings";

const FULL = { insured: "A", policyNo: "D", policyExp: "F", premium: "K", carrierRate: "N" };

describe("column letters", () => {
  it("round-trips past Z", () => {
    for (const index of [0, 25, 26, 51, 701, 702]) {
      expect(columnIndex(columnLetters(index))).toBe(index);
    }
    expect(columnLetters(26)).toBe("AA");
  });
});

describe("assignPcColumn", () => {
  it("moves a column that was on another input", () => {
    expect(assignPcColumn({ insured: "A", premium: "K" }, "carrierRate", "K")).toEqual({
      insured: "A",
      carrierRate: "K",
    });
  });

  it("replaces the input's previous column", () => {
    expect(assignPcColumn({ premium: "K" }, "premium", "T")).toEqual({ premium: "T" });
  });
});

describe("parsePcColumnMapping", () => {
  it("accepts a complete mapping and normalizes letters", () => {
    expect(parsePcColumnMapping({ ...FULL, premium: " k " })).toEqual(FULL);
  });

  it("rejects missing inputs, shared columns and junk", () => {
    expect(parsePcColumnMapping({ ...FULL, premium: undefined })).toBeNull();
    expect(parsePcColumnMapping({ ...FULL, premium: "A" })).toBeNull();
    expect(parsePcColumnMapping({ ...FULL, premium: "K1" })).toBeNull();
    expect(parsePcColumnMapping("A,D,F")).toBeNull();
  });

  it("knows what is still missing", () => {
    expect(missingPcInputs({ insured: "A", policyNo: "D" })).toEqual(["policyExp", "premium", "carrierRate"]);
    expect(isCompletePcMapping(FULL)).toBe(true);
    expect(isCompletePcMapping({ insured: "A" })).toBe(false);
  });
});

describe("readPcMappings", () => {
  function form(mappings?: unknown) {
    const data = new FormData();
    if (mappings !== undefined) data.append("mappings", JSON.stringify(mappings));
    return data;
  }

  it("defaults every file to the header guess", () => {
    expect(readPcMappings(form(), 2)).toEqual({ ok: true, mappings: [null, null] });
  });

  it("reads one mapping per file", () => {
    expect(readPcMappings(form([FULL, null]), 2)).toEqual({ ok: true, mappings: [FULL, null] });
  });

  it("rejects a count mismatch or a broken mapping", () => {
    expect(readPcMappings(form([FULL]), 2).ok).toBe(false);
    expect(readPcMappings(form([{ ...FULL, premium: "A" }]), 1).ok).toBe(false);
  });
});
