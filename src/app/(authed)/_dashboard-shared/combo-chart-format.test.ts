import { describe, expect, it } from "vitest";
import { niceAxisScale, twoLineLabelPositions } from "./combo-chart-format";

describe("twoLineLabelPositions", () => {
  it("puts the higher line's number above and the lower line's below", () => {
    expect(twoLineLabelPositions(30, 20)).toEqual({ first: "top", second: "bottom" });
    expect(twoLineLabelPositions(20, 30)).toEqual({ first: "bottom", second: "top" });
  });

  it("still separates the two numbers when the lines meet", () => {
    expect(twoLineLabelPositions(25, 25)).toEqual({ first: "top", second: "bottom" });
  });
});

describe("niceAxisScale", () => {
  it("rounds up to a tick size that divides the axis evenly", () => {
    expect(niceAxisScale(410000)).toEqual({ max: 480000, interval: 120000 });
    expect(niceAxisScale(11)).toEqual({ max: 12, interval: 3 });
  });

  it("never goes below the value it has to show", () => {
    for (const value of [1.1, 7.5, 85, 199, 201, 137000, 999999]) {
      expect(niceAxisScale(value).max).toBeGreaterThanOrEqual(value);
    }
  });

  it("keeps whole-number ticks for counts", () => {
    for (const value of [1.1, 2, 7.5, 13, 85, 176]) {
      const { interval, max } = niceAxisScale(value, true);

      expect(Number.isInteger(interval)).toBe(true);
      expect(max).toBeGreaterThanOrEqual(value);
    }
  });

  it("handles an empty chart", () => {
    expect(niceAxisScale(0)).toEqual({ max: 1, interval: 0.25 });
    expect(niceAxisScale(0, true)).toEqual({ max: 4, interval: 1 });
  });
});
