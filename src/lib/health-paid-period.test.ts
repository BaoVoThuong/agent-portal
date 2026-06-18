import { describe, expect, it } from "vitest";
import { getHealthPaidPeriodLabel } from "@/lib/health-paid-period";

// Golden-master: khoá behavior parse nhiều định dạng ngày + sinh nhãn period.
describe("getHealthPaidPeriodLabel", () => {
  it("trả null với null/undefined/rỗng", () => {
    expect(getHealthPaidPeriodLabel(null)).toBeNull();
    expect(getHealthPaidPeriodLabel(undefined)).toBeNull();
    expect(getHealthPaidPeriodLabel("")).toBeNull();
  });

  it("trả null khi chỉ có một ngày", () => {
    expect(getHealthPaidPeriodLabel("2024/01/15")).toBeNull();
  });

  it("trả null khi hai ngày cùng tháng/năm", () => {
    expect(getHealthPaidPeriodLabel("2024/01/05 2024/01/20")).toBeNull();
  });

  it("sinh nhãn từ hai ngày YYYY/MM/DD", () => {
    expect(getHealthPaidPeriodLabel("2024/01/15 2024/03/15")).toBe(
      "01/2024 -> 03/2024"
    );
  });

  it("sắp xếp theo thời gian bất kể thứ tự đầu vào", () => {
    expect(getHealthPaidPeriodLabel("2024/05/01, 2024/02/01")).toBe(
      "02/2024 -> 05/2024"
    );
  });

  it("parse định dạng MM/DD/YYYY", () => {
    expect(getHealthPaidPeriodLabel("01/15/2024 12/15/2024")).toBe(
      "01/2024 -> 12/2024"
    );
  });

  it("dùng heuristic ngày>12 để đảo D/M trong MM/DD/YYYY", () => {
    // 25/01 -> ngày 25 tháng 01; 01/06 -> tháng 01 ngày 06
    expect(getHealthPaidPeriodLabel("25/01/2024 06/2024")).toBe(
      "01/2024 -> 06/2024"
    );
  });

  it("parse định dạng ISO YYYY-MM-DD", () => {
    expect(getHealthPaidPeriodLabel("2024-01-10 2024-04-10")).toBe(
      "01/2024 -> 04/2024"
    );
  });

  it("parse định dạng compact YYYYMMDD", () => {
    expect(getHealthPaidPeriodLabel("20240101 20240601")).toBe(
      "01/2024 -> 06/2024"
    );
  });

  it("parse tên tháng jan-YY", () => {
    expect(getHealthPaidPeriodLabel("jan-24 mar-24")).toBe(
      "01/2024 -> 03/2024"
    );
  });

  it("parse YYYY-MM (tháng)", () => {
    expect(getHealthPaidPeriodLabel("2024-01 2024-07")).toBe(
      "01/2024 -> 07/2024"
    );
  });

  it("parse M/YYYY (tháng)", () => {
    expect(getHealthPaidPeriodLabel("1/2024 9/2024")).toBe(
      "01/2024 -> 09/2024"
    );
  });

  it("bỏ qua token không hợp lệ và phân tách bằng nhiều dấu", () => {
    expect(getHealthPaidPeriodLabel("2024/01/01 | abc ; 2024/12/01")).toBe(
      "01/2024 -> 12/2024"
    );
  });

  it("loại ngày lịch không hợp lệ (32/13)", () => {
    // 2024/13/01 không hợp lệ -> chỉ còn 1 ngày hợp lệ -> null
    expect(getHealthPaidPeriodLabel("2024/13/01 2024/02/01")).toBeNull();
  });
});
