import { describe, expect, it } from "vitest";
import {
  isLatestRefresh,
  readRefreshResponse,
  safeRefreshErrorMessage,
} from "./refresh-state";

describe("table config refresh state", () => {
  it("accepts only the current request sequence", () => {
    expect(isLatestRefresh(3, 3)).toBe(true);
    expect(isLatestRefresh(2, 3)).toBe(false);
  });

  it("keeps safe endpoint errors and falls back for malformed payloads", () => {
    expect(safeRefreshErrorMessage({ error: "Categories are unavailable." }, "fallback")).toBe(
      "Categories are unavailable."
    );
    expect(safeRefreshErrorMessage({ error: "" }, "fallback")).toBe("fallback");
    expect(safeRefreshErrorMessage({ message: "secret" }, "fallback")).toBe("fallback");
  });

  it("handles invalid JSON on failed responses without leaking parser errors", async () => {
    await expect(
      readRefreshResponse(new Response("not-json", { status: 503 }), "Could not refresh categories.")
    ).rejects.toThrow("Could not refresh categories.");
  });

  it("returns JSON for successful responses", async () => {
    await expect(
      readRefreshResponse(new Response(JSON.stringify({ categories: [] })), "fallback")
    ).resolves.toEqual({ categories: [] });
  });
});
