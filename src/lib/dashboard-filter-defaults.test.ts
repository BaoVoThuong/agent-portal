import { describe, expect, it } from "vitest";
import {
  fallbackDashboardMonthDefault,
  normalizeMonthDate,
  normalizeReportMonthRange,
  resolveDashboardMonthDefaultRange,
  type DashboardMonthRangeDefault,
} from "@/lib/dashboard-filter-defaults";

// Golden-master cho các hàm math thuần (không chạm DB).
const FIXED = new Date(2024, 5, 15); // 2024-06-15 (local time)

function makeDefault(
  over: Partial<DashboardMonthRangeDefault>
): DashboardMonthRangeDefault {
  return {
    dashboardKey: "agent_dashboard_health",
    defaultType: "latest_n_months",
    start: null,
    end: null,
    rollingMonths: 12,
    ...over,
  };
}

describe("fallbackDashboardMonthDefault", () => {
  it("mặc định latest_n_months với 12 tháng", () => {
    expect(fallbackDashboardMonthDefault("agent_dashboard_pc")).toEqual({
      dashboardKey: "agent_dashboard_pc",
      defaultType: "latest_n_months",
      start: null,
      end: null,
      rollingMonths: 12,
    });
  });
});

describe("normalizeMonthDate", () => {
  it("trả null với rỗng/null", () => {
    expect(normalizeMonthDate(null)).toBeNull();
    expect(normalizeMonthDate("")).toBeNull();
  });
  it("YYYY-MM -> YYYY-MM-01", () => {
    expect(normalizeMonthDate("2024-03")).toBe("2024-03-01");
  });
  it("YYYY-MM-DD -> YYYY-MM-01 (giữ tháng)", () => {
    expect(normalizeMonthDate("2024-03-25")).toBe("2024-03-01");
  });
  it("định dạng lạ -> null", () => {
    expect(normalizeMonthDate("03/2024")).toBeNull();
  });
});

describe("normalizeReportMonthRange", () => {
  it("đảo start/end khi bị ngược", () => {
    expect(
      normalizeReportMonthRange({ start: "2024-05-01", end: "2024-02-01" })
    ).toEqual({ start: "2024-02-01", end: "2024-05-01" });
  });
  it("giữ nguyên khi đúng thứ tự", () => {
    expect(
      normalizeReportMonthRange({ start: "2024-02-01", end: "2024-05-01" })
    ).toEqual({ start: "2024-02-01", end: "2024-05-01" });
  });
  it("null an toàn", () => {
    expect(normalizeReportMonthRange({ start: null, end: null })).toEqual({
      start: null,
      end: null,
    });
  });
});

describe("resolveDashboardMonthDefaultRange", () => {
  it("all -> không giới hạn", () => {
    expect(
      resolveDashboardMonthDefaultRange(makeDefault({ defaultType: "all" }), FIXED)
    ).toEqual({ start: null, end: null });
  });

  it("fixed_range -> normalize từ start/end", () => {
    expect(
      resolveDashboardMonthDefaultRange(
        makeDefault({
          defaultType: "fixed_range",
          start: "2024-02-01",
          end: "2024-05-01",
        }),
        FIXED
      )
    ).toEqual({ start: "2024-02-01", end: "2024-05-01" });
  });

  it("current_year -> từ tháng 1 tới tháng hiện tại", () => {
    expect(
      resolveDashboardMonthDefaultRange(
        makeDefault({ defaultType: "current_year" }),
        FIXED
      )
    ).toEqual({ start: "2024-01-01", end: "2024-06-01" });
  });

  it("latest_n_months=3 -> 3 tháng tính ngược gồm tháng hiện tại", () => {
    expect(
      resolveDashboardMonthDefaultRange(
        makeDefault({ defaultType: "latest_n_months", rollingMonths: 3 }),
        FIXED
      )
    ).toEqual({ start: "2024-04-01", end: "2024-06-01" });
  });

  it("latest_n_months bắc qua năm", () => {
    expect(
      resolveDashboardMonthDefaultRange(
        makeDefault({ defaultType: "latest_n_months", rollingMonths: 12 }),
        FIXED
      )
    ).toEqual({ start: "2023-07-01", end: "2024-06-01" });
  });
});
