import { describe, expect, it } from "vitest";
import { needsReopenReason } from "./stage-transition";

describe("needsReopenReason", () => {
  it.each([
    [true, false, true],
    [true, true, false],
    [false, false, false],
    [false, true, false],
  ])("returns %s for %s -> %s", (fromTerminal, toTerminal, expected) => {
    expect(
      needsReopenReason(
        { is_terminal: fromTerminal },
        { is_terminal: toTerminal },
      ),
    ).toBe(expected);
  });
});
