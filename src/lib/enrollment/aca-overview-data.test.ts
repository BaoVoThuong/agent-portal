import { describe, expect, it } from "vitest";
import { chunkOverviewRecordIds, exclusiveDateUpperBound, normalizeOverviewEmail, parseThreshold } from "./aca-overview-data";

describe("ACA overview date boundaries", () => {
  it("uses the first instant of the following UTC day", () => {
    expect(exclusiveDateUpperBound("2026-08-13")).toBe("2026-08-14T00:00:00.000Z");
  });
  it("uses the configured threshold for missing or invalid query values", () => {
    expect(parseThreshold(null, 7)).toBe(7);
    expect(parseThreshold("99", 10)).toBe(10);
    expect(parseThreshold("1", 10)).toBe(1);
  });
  it("normalizes snapshot emails for roster and cycle joins", () => {
    expect(normalizeOverviewEmail("  Agent@Example.COM ")).toBe("agent@example.com");
    expect(normalizeOverviewEmail("   ")).toBeNull();
  });
  it("keeps stage-cycle filters below the PostgREST URL limit", () => {
    const ids = Array.from({ length: 101 }, (_, index) => `record-${index}`);
    const chunks = chunkOverviewRecordIds(ids);

    expect(chunks).toHaveLength(3);
    expect(Math.max(...chunks.map((chunk) => chunk.length))).toBeLessThanOrEqual(50);
    expect(chunks.flat()).toEqual(ids);
  });
  it("rejects invalid overview chunk sizes", () => {
    expect(() => chunkOverviewRecordIds(["record-1"], 0)).toThrow("chunkSize must be a positive integer");
  });
});
