import { describe, expect, it } from "vitest";
import { ALERT_SEVERITY, resolveLeadAlerts } from "./alerts";
import type { LeadAlertSettings, LeadRow, LeadStatus } from "./types";

const settings: LeadAlertSettings = {
  product: "pc",
  no_contact_hours: 24,
  stale_days: 3,
  max_attempts: 4,
};

const NOW = new Date("2026-09-01T12:00:00Z");
const hoursAgo = (n: number) =>
  new Date(NOW.getTime() - n * 3600_000).toISOString();

function lead(patch: Partial<LeadRow> = {}): LeadRow {
  return {
    id: "l1", display_number: 1, product: "pc", products: ["pc"], event_id: null,
    full_name: "A", phone: "1", email: null,
    assigned_to_email: "cs@x.com", assigned_at: hoursAgo(1),
    assigned_by_email: "mgr@x.com", status_id: "s-open",
    first_contacted_at: null, last_contacted_at: null,
    contact_attempt_count: 0, next_follow_up_at: null, closed_at: null,
    created_by_email: "mgr@x.com", created_at: hoursAgo(1),
    updated_by_email: null, updated_at: hoursAgo(1),
    custom_values: {}, archived_at: null,
    ...patch,
  };
}

const openStatus: LeadStatus = {
  id: "s-open", label: "Đang theo", color: null,
  position: 0, kind: "open", archived_at: null,
};
const wonStatus: LeadStatus = { ...openStatus, id: "s-won", kind: "won" };
const lostStatus: LeadStatus = { ...openStatus, id: "s-lost", kind: "lost" };

describe("resolveLeadAlerts", () => {
  it("stays quiet while the lead is still inside the window", () => {
    expect(resolveLeadAlerts(lead(), openStatus, settings, NOW)).toEqual([]);
  });

  it("flags a lead nobody has called since it was assigned", () => {
    const row = lead({ assigned_at: hoursAgo(30) });
    expect(resolveLeadAlerts(row, openStatus, settings, NOW)).toContain(
      "never_contacted"
    );
  });

  // Chưa giao cho ai thì không ai có lỗi. Đây là lead trong kho, không phải
  // lead bị bỏ bê.
  it("does not flag an unassigned lead", () => {
    const row = lead({ assigned_to_email: null, assigned_at: null });
    expect(resolveLeadAlerts(row, openStatus, settings, NOW)).toEqual([]);
  });

  it("flags a lead that was contacted once then abandoned", () => {
    const row = lead({
      assigned_at: hoursAgo(200),
      first_contacted_at: hoursAgo(190),
      last_contacted_at: hoursAgo(100),
      contact_attempt_count: 1,
    });
    const alerts = resolveLeadAlerts(row, openStatus, settings, NOW);
    expect(alerts).toContain("stale");
    expect(alerts).not.toContain("never_contacted");
  });

  it("flags a missed callback promise", () => {
    const row = lead({
      last_contacted_at: hoursAgo(2),
      contact_attempt_count: 1,
      next_follow_up_at: hoursAgo(1),
    });
    expect(resolveLeadAlerts(row, openStatus, settings, NOW)).toContain(
      "follow_up_overdue"
    );
  });

  // Agent hứa gọi 3pm thứ Ba, gọi đúng hẹn, khách không bắt máy. RPC không xoá
  // next_follow_up_at cho một cuộc gọi thường, nên nếu cờ chỉ so hẹn với hiện
  // tại thì agent làm đúng sẽ đỏ mãi mãi.
  it("clears the missed-callback flag once the agent calls back", () => {
    const row = lead({
      first_contacted_at: hoursAgo(50),
      next_follow_up_at: hoursAgo(5),
      last_contacted_at: hoursAgo(2),
      contact_attempt_count: 2,
    });
    expect(resolveLeadAlerts(row, openStatus, settings, NOW)).not.toContain(
      "follow_up_overdue"
    );
  });

  it("still flags a promise the agent never came back to", () => {
    const row = lead({
      first_contacted_at: hoursAgo(50),
      next_follow_up_at: hoursAgo(5),
      last_contacted_at: hoursAgo(20),
      contact_attempt_count: 2,
    });
    expect(resolveLeadAlerts(row, openStatus, settings, NOW)).toContain(
      "follow_up_overdue"
    );
  });

  it("marks a hard-to-reach lead amber, not red", () => {
    const row = lead({
      last_contacted_at: hoursAgo(2),
      first_contacted_at: hoursAgo(50),
      contact_attempt_count: 4,
    });
    const alerts = resolveLeadAlerts(row, openStatus, settings, NOW);
    expect(alerts).toContain("exhausted");
    expect(ALERT_SEVERITY.exhausted).toBe("amber");
    expect(ALERT_SEVERITY.never_contacted).toBe("red");
  });

  // Lead đã đóng thì không còn là việc của ai nữa.
  it("goes silent once the status is terminal", () => {
    const row = lead({
      assigned_at: hoursAgo(500),
      next_follow_up_at: hoursAgo(400),
      contact_attempt_count: 9,
    });
    expect(resolveLeadAlerts(row, wonStatus, settings, NOW)).toEqual([]);
  });

  // Status có thể bị admin xoá khỏi bộ từ vựng trong khi lead vẫn trỏ vào nó.
  it("treats an unknown status as still open", () => {
    const row = lead({ assigned_at: hoursAgo(30) });
    expect(resolveLeadAlerts(row, null, settings, NOW)).toContain(
      "never_contacted"
    );
  });

  // archived_at là lưu trữ vĩnh viễn, khác hẳn status "closed" vốn còn có thể
  // mở lại. Một lead đủ điều kiện never_contacted nhưng đã lưu trữ thì không
  // còn là việc của ai — im lặng là đúng, không phải bug.
  it("stays quiet once the lead is archived, even if it would otherwise flag", () => {
    const row = lead({ assigned_at: hoursAgo(30), archived_at: hoursAgo(1) });
    expect(resolveLeadAlerts(row, openStatus, settings, NOW)).toEqual([]);
  });

  // Nguội và hết lượt thử là hai vấn đề độc lập, có thể xảy ra cùng lúc trên
  // một lead — đó là lý do hàm trả về mảng chứ không phải một cờ duy nhất.
  // Và vì đỏ/vàng là điểm bán của tính năng (bỏ bê vs. đã cố mà không được),
  // test phải tự khẳng định hai màu đó tách nhau trong đúng trường hợp này.
  it("raises both stale and exhausted together, one red and one amber", () => {
    const row = lead({
      assigned_at: hoursAgo(200),
      first_contacted_at: hoursAgo(190),
      last_contacted_at: hoursAgo(100),
      contact_attempt_count: 4,
    });
    const alerts = resolveLeadAlerts(row, openStatus, settings, NOW);
    expect(alerts).toContain("stale");
    expect(alerts).toContain("exhausted");
    expect(ALERT_SEVERITY.stale).toBe("red");
    expect(ALERT_SEVERITY.exhausted).toBe("amber");
  });

  // "won" và "lost" cùng chung điều kiện terminal, nhưng test trên chỉ mới đi
  // qua nhánh won — nhánh lost phải tự chứng minh nó im lặng y hệt, không suy
  // diễn từ test kia.
  it("goes silent once the status is lost, not just won", () => {
    const row = lead({
      assigned_at: hoursAgo(500),
      next_follow_up_at: hoursAgo(400),
      contact_attempt_count: 9,
    });
    expect(resolveLeadAlerts(row, lostStatus, settings, NOW)).toEqual([]);
  });
});
