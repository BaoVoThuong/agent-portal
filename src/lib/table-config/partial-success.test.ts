import { describe, expect, it } from "vitest";
import {
  isConfigMutationWarning,
  layoutResetFailedWarning,
} from "./partial-success";

describe("config partial-success warnings", () => {
  it("returns a stable safe layout warning", () => {
    expect(layoutResetFailedWarning()).toEqual({
      code: "LAYOUT_RESET_FAILED",
      message:
        "The change was saved, but saved table layouts could not be reset. Refresh layouts and retry if needed.",
    });
  });

  it("accepts only the known warning shape", () => {
    expect(isConfigMutationWarning(layoutResetFailedWarning())).toBe(true);
    expect(isConfigMutationWarning({ code: "OTHER", message: "nope" })).toBe(false);
    expect(isConfigMutationWarning({ code: "LAYOUT_RESET_FAILED", message: "" })).toBe(false);
  });
});
