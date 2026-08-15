import { describe, expect, it } from "vitest";
import {
  CONFIG_VALUE_INACTIVE_OR_MISSING,
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
});
