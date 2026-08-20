import { describe, expect, it, vi } from "vitest";
import { settleSideEffects } from "./mutation-result";

describe("settleSideEffects", () => {
  it("turns an explicit false result into a non-fatal warning", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(
      settleSideEffects([
        {
          code: "broadcast_failed",
          message: "Live update will use fallback.",
          run: async () => false,
        },
      ]),
    ).resolves.toEqual([
      {
        code: "broadcast_failed",
        message: "Live update will use fallback.",
      },
    ]);
  });
});
