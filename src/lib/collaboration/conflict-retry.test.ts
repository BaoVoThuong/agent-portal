import { describe, expect, it } from "vitest";
import { MAX_CONFLICT_ATTEMPTS, shouldRetryConflict } from "./conflict-retry";

describe("shouldRetryConflict", () => {
  it("allows the initial send and up to three safe retries", () => {
    expect(MAX_CONFLICT_ATTEMPTS).toBe(4);
    for (let attempt = 0; attempt < MAX_CONFLICT_ATTEMPTS - 1; attempt += 1) {
      expect(shouldRetryConflict(attempt, true)).toBe(true);
    }
    expect(shouldRetryConflict(MAX_CONFLICT_ATTEMPTS - 1, true)).toBe(false);
  });

  it("stops immediately when a patched field changed", () => {
    expect(shouldRetryConflict(0, false)).toBe(false);
  });
});
