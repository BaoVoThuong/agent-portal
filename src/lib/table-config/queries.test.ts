import { describe, it, expect } from "vitest";
import { defaultTableColumns, isTableConfigMissingError } from "./queries";

describe("isTableConfigMissingError", () => {
  it("treats a missing table (Postgres 42P01) as missing", () => {
    expect(isTableConfigMissingError({ code: "42P01" })).toBe(true);
  });

  it("treats a missing table (PostgREST schema cache) as missing", () => {
    expect(isTableConfigMissingError({ code: "PGRST205" })).toBe(true);
  });

  it("treats a table-not-found message without a code as missing", () => {
    expect(
      isTableConfigMissingError({
        message: 'relation "table_column" does not exist',
      })
    ).toBe(true);
    expect(
      isTableConfigMissingError({
        message: "Could not find the table 'public.table_column' in the schema cache",
      })
    ).toBe(true);
  });

  it("does NOT treat a missing column (Postgres 42703) as missing", () => {
    expect(
      isTableConfigMissingError({
        code: "42703",
        message: "column table_column.pinned does not exist",
      })
    ).toBe(false);
  });

  it("does NOT treat a missing-column message without a code as missing", () => {
    expect(
      isTableConfigMissingError({
        message: "column table_column.pinned does not exist",
      })
    ).toBe(false);
  });

  it("returns false for unrelated errors", () => {
    expect(isTableConfigMissingError({ code: "23505", message: "duplicate key" })).toBe(false);
    expect(isTableConfigMissingError(null)).toBe(false);
    expect(isTableConfigMissingError(undefined)).toBe(false);
  });
});

describe("lead interaction-history columns", () => {
  it.each(["lead_pc", "lead_health"] as const)(
    "seeds a visible system column for %s",
    (scope) => {
      expect(defaultTableColumns(scope)).toContainEqual(
        expect.objectContaining({
          key: "interactionHistory",
          label: "Interaction history",
          is_system: true,
          position: 65,
          hidden_default: false,
        }),
      );
    },
  );
});
