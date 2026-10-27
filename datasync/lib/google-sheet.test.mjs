import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { fetchSheetCsv } = require("./google-sheet.js");

const CSV = "agent\nann@example.com\n";

function fakeGoogle(contentType) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(CSV, { headers: { "content-type": contentType } })));
}

describe("fetchSheetCsv", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the CSV export", async () => {
    fakeGoogle("text/csv; charset=utf-8");
    await expect(fetchSheetCsv("sheet-1", "42")).resolves.toBe(CSV);
  });

  it("refuses a page that is not CSV, such as the Google sign-in page", async () => {
    fakeGoogle("text/html; charset=utf-8");
    await expect(fetchSheetCsv("sheet-1", "42")).rejects.toThrow("instead of CSV");
  });
});
