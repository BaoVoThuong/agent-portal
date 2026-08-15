import { describe, expect, it } from "vitest";
import {
  CONFIG_VALUE_INACTIVE_OR_MISSING,
  CONFIG_DUPLICATE_OPTION_LABEL,
  archivedColumnConflictResponse,
  duplicateOptionLabelResponse,
  inactiveConfigValueResponse,
  isUniqueViolation,
} from "./mutation-errors";

describe("table config mutation errors", () => {
  it("returns a stable inactive/missing conflict payload", () => {
    expect(inactiveConfigValueResponse("Column")).toEqual({
      error: "Column is inactive or missing. Refresh the configuration and try again.",
      code: CONFIG_VALUE_INACTIVE_OR_MISSING,
    });
  });

  it("recognises unique constraint conflicts without exposing database text", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    expect(isUniqueViolation({ code: "42P01" })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });

  it("returns a stable duplicate-label conflict", () => {
    expect(duplicateOptionLabelResponse().code).toBe(CONFIG_DUPLICATE_OPTION_LABEL);
  });

  it("returns only safe archived-column restore details", () => {
    expect(archivedColumnConflictResponse({ id: "c1", label: "Old", type: "text" })).toEqual({
      error: "An archived column with this label already exists.",
      code: "CONFIG_ARCHIVED_COLUMN_EXISTS",
      archived_column: { id: "c1", label: "Old", type: "text" },
    });
  });
});
