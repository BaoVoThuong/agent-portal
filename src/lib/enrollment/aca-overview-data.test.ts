import { describe, expect, it } from "vitest";
import { exclusiveDateUpperBound } from "./aca-overview-data";

describe("ACA overview date boundaries", () => {
  it("uses the first instant of the following UTC day", () => {
    expect(exclusiveDateUpperBound("2026-08-13")).toBe("2026-08-14T00:00:00.000Z");
  });
});
