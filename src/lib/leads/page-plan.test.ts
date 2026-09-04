import { describe, expect, it } from "vitest";
import {
  chunkPageOffsets,
  dedupeLeadsById,
  LEAD_MAX_ROWS,
  LEAD_PAGE_FETCH_CONCURRENCY,
  planLeadPageOffsets,
} from "./page-plan";
import type { LeadRow } from "./types";

const row = (id: string): LeadRow =>
  ({ id, display_number: 1 }) as unknown as LeadRow;

describe("planLeadPageOffsets", () => {
  it("asks for nothing when page one already holds everything", () => {
    expect(planLeadPageOffsets(120, 120, LEAD_MAX_ROWS)).toEqual([]);
    expect(planLeadPageOffsets(1000, 400, LEAD_MAX_ROWS)).toEqual([]);
  });

  it("steps by what page one actually returned", () => {
    expect(planLeadPageOffsets(1000, 2000, LEAD_MAX_ROWS)).toEqual([1000]);
    expect(planLeadPageOffsets(1000, 2500, LEAD_MAX_ROWS)).toEqual([1000, 2000]);
  });

  // Lý do hàm này tồn tại: trần của server thấp hơn kích thước trang ta xin thì
  // kế hoạch KHÔNG được mở ra khoảng trống.
  it("respects a server ceiling below the requested page size", () => {
    expect(planLeadPageOffsets(500, 2000, LEAD_MAX_ROWS)).toEqual([500, 1000, 1500]);
  });

  it("asks for nothing when page one came back empty", () => {
    expect(planLeadPageOffsets(0, 2000, LEAD_MAX_ROWS)).toEqual([]);
  });

  // Trần tính theo DÒNG, nên nó không đổi khi trần của server đổi. Đây là điểm
  // review 2026-09-04 bắt được: bản đầu chặn theo TRANG, tức trần thật là
  // "12 × trần server" — 13.000 dòng nếu server trả 1000/trang, nhưng chỉ 2.600
  // nếu server trả 200, thấp hơn cả quy mô đang nhắm tới.
  it("caps by rows, so the ceiling does not move with the server page size", () => {
    expect(planLeadPageOffsets(1000, 10_000_000, 20_000)).toHaveLength(19);
    expect(planLeadPageOffsets(200, 10_000_000, 20_000)).toHaveLength(99);
    // 1 trang đầu + 19 trang sau = 20.000 dòng; 1 + 99 = 20.000 dòng. Bằng nhau.
    expect(1000 * (1 + 19)).toBe(20_000);
    expect(200 * (1 + 99)).toBe(20_000);
  });

  it("treats a total smaller than what we already hold as done", () => {
    expect(planLeadPageOffsets(1000, 0, LEAD_MAX_ROWS)).toEqual([]);
    expect(planLeadPageOffsets(1000, -1, LEAD_MAX_ROWS)).toEqual([]);
  });
});

describe("dedupeLeadsById", () => {
  it("keeps the first occurrence and preserves order", () => {
    const rows = [row("a"), row("b"), row("a"), row("c")];
    expect(dedupeLeadsById(rows).map((lead) => lead.id)).toEqual(["a", "b", "c"]);
  });

  it("returns an empty array unchanged", () => {
    expect(dedupeLeadsById([])).toEqual([]);
  });
});

describe("chunkPageOffsets", () => {
  it("splits into chunks of the given size", () => {
    expect(chunkPageOffsets([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns nothing for an empty plan", () => {
    expect(chunkPageOffsets([], LEAD_PAGE_FETCH_CONCURRENCY)).toEqual([]);
  });

  it("keeps every offset when the plan is smaller than one chunk", () => {
    expect(chunkPageOffsets([1], LEAD_PAGE_FETCH_CONCURRENCY)).toEqual([[1]]);
  });
});
