import { describe, expect, it } from "vitest";
import {
  formatTableDate,
  formatTableDateTime,
  formatTableDateTimeFull,
} from "./date-format";

// Dạng chuẩn của Task CS, nay dùng cho mọi bảng (Enrollment, Leads, Provider).
describe("table date format", () => {
  const value = "2026-10-02T05:31:51.046+00:00";

  it("shows Created date as a short month-day", () => {
    expect(formatTableDate(value)).toBe("Oct 2");
  });

  it("shows Last Updated as month-day plus 24h time", () => {
    expect(formatTableDateTime(value)).toBe("Oct 2 05:31");
  });

  it("gives the full UTC timestamp for the tooltip", () => {
    expect(formatTableDateTimeFull(value)).toBe("2026-10-02 05:31 UTC");
  });

  it("uses UTC so server and browser render the same text", () => {
    // 23:30 ở Texas ngày 1/10 là 04:30 UTC ngày 2/10.
    expect(formatTableDateTime("2026-10-01T23:30:00-05:00")).toBe("Oct 2 04:30");
  });

  it("renders a dash for empty or invalid values", () => {
    for (const empty of [null, undefined, "", "not a date"]) {
      expect(formatTableDate(empty)).toBe("—");
      expect(formatTableDateTime(empty)).toBe("—");
      expect(formatTableDateTimeFull(empty)).toBe("—");
    }
  });
});
