import { describe, expect, it } from "vitest";
import {
  CONFIG_VALUE_INACTIVE_OR_MISSING,
  CONFIG_DUPLICATE_OPTION_LABEL,
  CONFIG_ARCHIVED_COLUMN_TYPE_MISMATCH,
  archivedColumnConflictResponse,
  archivedColumnTypeMismatchResponse,
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
    expect(
      archivedColumnConflictResponse(
        { id: "c1", label: "Old", type: "text", archived_at: "2026-08-16T02:40:16.456+00:00" },
        { option_count: 2, layout_count: 1 }
      )
    ).toEqual({
      error: "An archived column with this label already exists.",
      code: "CONFIG_ARCHIVED_COLUMN_EXISTS",
      archived_column: {
        id: "c1",
        label: "Old",
        type: "text",
        archived_at: "2026-08-16T02:40:16.456+00:00",
        option_count: 2,
        layout_count: 1,
      },
    });
  });

  // Đếm hỏng không được phép chặn đường tạo cột, nên thiếu số liệu thì về 0.
  it("falls back to zero counts when the server could not count", () => {
    expect(archivedColumnConflictResponse({ id: "c1", label: "Old", type: "text" }).archived_column)
      .toEqual({
        id: "c1",
        label: "Old",
        type: "text",
        archived_at: null,
        option_count: 0,
        layout_count: 0,
      });
  });

  it("carries the archived column on a type mismatch so the UI can offer both ways out", () => {
    const response = archivedColumnTypeMismatchResponse(
      { id: "c1", label: "Year", type: "text", archived_at: null },
      { option_count: 0, layout_count: 0 }
    );
    expect(response.code).toBe(CONFIG_ARCHIVED_COLUMN_TYPE_MISMATCH);
    expect(response.archived_column).toMatchObject({ id: "c1", label: "Year", type: "text" });
  });
});
