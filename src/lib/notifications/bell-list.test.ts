import { describe, expect, it } from "vitest";
import { mergeFirstPage, mergeNotifs } from "./bell-list";

const row = (id: string, minute: number, is_read = false) => ({
  id,
  created_at: `2026-10-19T10:${String(minute).padStart(2, "0")}:00+00:00`,
  is_read,
});

describe("mergeNotifs", () => {
  it("keeps the first copy of each id and sorts newest first", () => {
    const fresh = [row("a", 5, true)];
    const stale = [row("a", 5, false), row("b", 9)];
    expect(mergeNotifs(fresh, stale)).toEqual([row("b", 9), row("a", 5, true)]);
  });
});

describe("mergeFirstPage", () => {
  it("keeps older pages when the fresh page overlaps them", () => {
    const current = { items: [row("c", 30), row("b", 20), row("a", 10)], hasMore: true };
    const fresh = [row("d", 40), row("c", 30)];
    expect(mergeFirstPage(fresh, true, current)).toEqual({
      items: [row("d", 40), row("c", 30), row("b", 20), row("a", 10)],
      hasMore: true,
    });
  });

  it("starts over when a whole page of new rows leaves a possible hole", () => {
    const current = { items: [row("b", 20), row("a", 10)], hasMore: false };
    const fresh = [row("f", 50), row("e", 45)];
    expect(mergeFirstPage(fresh, true, current)).toEqual({ items: fresh, hasMore: true });
  });

  it("keeps rows read here that the server no longer lists as unread", () => {
    const current = { items: [row("b", 20, true), row("a", 10)], hasMore: false };
    const fresh = [row("a", 10)];
    expect(mergeFirstPage(fresh, false, current)).toEqual({
      items: [row("b", 20, true), row("a", 10)],
      hasMore: false,
    });
  });

  it("takes the fresh page as is when there is nothing cached", () => {
    expect(mergeFirstPage([row("a", 10)], true, { items: [], hasMore: false })).toEqual({
      items: [row("a", 10)],
      hasMore: true,
    });
  });
});
