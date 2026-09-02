import { describe, expect, it } from "vitest";
import { parseOverviewProduct, settingsForLead, summarizeLeads } from "./overview";
import type { LeadAlertSettings, LeadProduct, LeadRow, LeadStatus } from "./types";

const settings: LeadAlertSettings = { product: "pc", no_contact_hours: 24, stale_days: 3, max_attempts: 4 };
const NOW = new Date("2026-09-01T12:00:00Z");
const hoursAgo = (n: number) => new Date(NOW.getTime() - n * 3600_000).toISOString();
const open: LeadStatus = { id: "s1", label: "Open", color: null, position: 0, kind: "open", archived_at: null };
const won: LeadStatus = { ...open, id: "s2", kind: "won" };
const statusById = new Map([["s1", open], ["s2", won]]);

function lead(patch: Partial<LeadRow>): LeadRow {
  return {
    id: Math.random().toString(36), display_number: 1, product: "pc", products: ["pc"], event_id: "e1",
    full_name: null, phone: "1", email: null, assigned_to_email: null,
    assigned_at: null, assigned_by_email: null, status_id: "s1",
    first_contacted_at: null, last_contacted_at: null, contact_attempt_count: 0,
    next_follow_up_at: null, closed_at: null, created_by_email: "m@x.com",
    created_at: hoursAgo(100), updated_by_email: null, updated_at: hoursAgo(100),
    custom_values: {}, archived_at: null, ...patch,
  };
}

describe("summarizeLeads", () => {
  it("counts what is still sitting in the pool", () => {
    const result = summarizeLeads([lead({}), lead({ assigned_to_email: "a@x.com", assigned_at: hoursAgo(1) })], statusById, settings, NOW);
    expect(result.total).toBe(2);
    expect(result.unassigned).toBe(1);
  });

  it("attributes each red flag to the agent holding the lead", () => {
    const result = summarizeLeads([
      lead({ assigned_to_email: "a@x.com", assigned_at: hoursAgo(30) }),
      lead({ assigned_to_email: "a@x.com", assigned_at: hoursAgo(30) }),
      lead({ assigned_to_email: "b@x.com", assigned_at: hoursAgo(1) }),
    ], statusById, settings, NOW);
    expect(result.byAlert.never_contacted).toBe(2);
    expect(result.byAgent.find((row) => row.email === "a@x.com")?.redCount).toBe(2);
    expect(result.byAgent.find((row) => row.email === "b@x.com")?.redCount).toBe(0);
  });

  it("computes the win rate over closed leads only", () => {
    const result = summarizeLeads([
      lead({ event_id: "e1", status_id: "s2", closed_at: hoursAgo(1) }),
      lead({ event_id: "e1", status_id: "s1" }),
      lead({ event_id: "e1", status_id: "s1" }),
    ], statusById, settings, NOW);
    const event = result.byEvent.find((row) => row.eventId === "e1");
    expect(event?.total).toBe(3);
    expect(event?.won).toBe(1);
    expect(event?.closed).toBe(1);
    expect(event?.winRate).toBe(1);
  });

  it("reports a null win rate when nothing has closed yet", () => {
    const result = summarizeLeads([lead({})], statusById, settings, NOW);
    expect(result.byEvent[0].winRate).toBeNull();
  });

  it("ranks the worst agent first", () => {
    const result = summarizeLeads([
      lead({ assigned_to_email: "quiet@x.com", assigned_at: hoursAgo(1) }),
      lead({ assigned_to_email: "bad@x.com", assigned_at: hoursAgo(30) }),
      lead({ assigned_to_email: "bad@x.com", assigned_at: hoursAgo(30) }),
    ], statusById, settings, NOW);
    expect(result.byAgent[0].email).toBe("bad@x.com");
  });
});

describe("parseOverviewProduct", () => {
  // The Overview fetched with no product param, toLeadProduct turned that into
  // "pc", and every one of the 30 live leads is Health — so the tab rendered an
  // empty summary for every manager.
  it("treats a missing or unknown product as every product", () => {
    expect(parseOverviewProduct(null)).toBeNull();
    expect(parseOverviewProduct("")).toBeNull();
    expect(parseOverviewProduct("banana")).toBeNull();
  });

  it("keeps a real product", () => {
    expect(parseOverviewProduct("pc")).toBe("pc");
    expect(parseOverviewProduct("health")).toBe("health");
  });
});

describe("settingsForLead", () => {
  const pc = { product: "pc", no_contact_hours: 1, stale_days: 1, max_attempts: 1 } as const;
  const health = { product: "health", no_contact_hours: 99, stale_days: 99, max_attempts: 99 } as const;

  it("returns the single row unchanged when the list is scoped to one product", () => {
    expect(settingsForLead(pc, { product: "health", products: ["health"] })).toBe(pc);
  });

  // Mixing products under one threshold set is how a P&C lead ends up measured
  // against Health's numbers.
  it("picks per product when both rows are supplied", () => {
    const byProduct = { pc, health };
    // Một product thì trả nguyên bộ của product đó — không dựng bản mới, nên
    // toEqual chứ không toBe: hàm nay gộp ngưỡng nên luôn trả object mới.
    expect(settingsForLead(byProduct, { product: "pc", products: ["pc"] })).toEqual(pc);
    expect(settingsForLead(byProduct, { product: "health", products: ["health"] })).toEqual(
      health,
    );
  });
});

describe("settingsForLead — lead mang nhiều product", () => {
  const byProduct: Record<LeadProduct, LeadAlertSettings> = {
    pc: { product: "pc", no_contact_hours: 48, stale_days: 7, max_attempts: 6 },
    health: { product: "health", no_contact_hours: 12, stale_days: 2, max_attempts: 3 },
  };

  it("lead mang cả hai product bị chấm theo ngưỡng CHẶT nhất", () => {
    // Lấy theo products[0] là chấm nó theo P&C mãi mãi, vì trigger luôn đặt
    // product = products[0] theo thứ tự cố định.
    expect(settingsForLead(byProduct, { product: "pc", products: ["pc", "health"] })).toEqual({
      product: "pc",
      no_contact_hours: 12,
      stale_days: 2,
      max_attempts: 3,
    });
  });

  it("lead một product dùng đúng ngưỡng của product đó", () => {
    expect(settingsForLead(byProduct, { product: "pc", products: ["pc"] })).toEqual(byProduct.pc);
  });

  it("lead chưa phân loại product không có ngưỡng nào", () => {
    expect(settingsForLead(byProduct, { product: null, products: [] })).toBeNull();
  });

  it("lead cũ chưa có mảng products vẫn dùng cột scalar", () => {
    // Đường đọc nào chưa kịp select `products` thì không được vì thế mà mất
    // cảnh báo — im lặng bỏ cảnh báo tệ hơn hẳn cảnh báo hơi rộng.
    expect(settingsForLead(byProduct, { product: "health" })).toEqual(byProduct.health);
  });

  it("truyền thẳng một bộ ngưỡng đơn thì trả nguyên bộ đó", () => {
    expect(settingsForLead(byProduct.health, { product: "pc", products: ["pc"] })).toEqual(
      byProduct.health
    );
  });
});
