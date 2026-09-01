import { describe, expect, it } from "vitest";
import {
  appendInteraction,
  resolveVisibleInteractions,
} from "./interaction-log-state";
import type { LeadInteraction } from "./types";

const interaction = (id: string): LeadInteraction =>
  ({ id, note: id }) as unknown as LeadInteraction;

describe("resolveVisibleInteractions", () => {
  // Chính là bug LD36: badge đọc một nguồn, danh sách đọc nguồn khác.
  it("phản hồi về SAU lần render đầu thì hiện ngay, không cần đóng/mở lại", () => {
    const truoc = resolveVisibleInteractions({
      currentLeadId: "LD36",
      loadedLeadId: null,
      fetched: [],
      cached: undefined,
    });
    expect(truoc).toEqual([]);

    const sau = resolveVisibleInteractions({
      currentLeadId: "LD36",
      loadedLeadId: "LD36",
      fetched: [interaction("i1"), interaction("i2"), interaction("i3")],
      cached: undefined,
    });
    expect(sau).toHaveLength(3);
  });

  it("cache hit hiện tức thì trong lúc tải nền", () => {
    expect(
      resolveVisibleInteractions({
        currentLeadId: "LD36",
        loadedLeadId: null,
        fetched: [],
        cached: [interaction("i1")],
      })
    ).toHaveLength(1);
  });

  it("KHÔNG để lịch sử của lead A lọt sang lead B đang tải", () => {
    expect(
      resolveVisibleInteractions({
        currentLeadId: "LD37",
        loadedLeadId: "LD36",
        fetched: [interaction("cua-LD36")],
        cached: undefined,
      })
    ).toEqual([]);
  });

  it("lead thật sự không có tương tác thì trả mảng rỗng", () => {
    expect(
      resolveVisibleInteractions({
        currentLeadId: "LD40",
        loadedLeadId: "LD40",
        fetched: [],
        cached: undefined,
      })
    ).toEqual([]);
  });
});

describe("appendInteraction", () => {
  it("thêm dòng mới lên đầu", () => {
    expect(
      appendInteraction([interaction("cu")], interaction("moi")).map((i) => i.id)
    ).toEqual(["moi", "cu"]);
  });

  it("cùng một id ghi hai lần chỉ hiện một lần", () => {
    const list = [interaction("i1")];
    expect(appendInteraction(list, interaction("i1"))).toBe(list);
  });
});
