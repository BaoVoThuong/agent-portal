import { describe, expect, it } from "vitest";
import { applyFrozenOrder } from "@/lib/tasks/frozen-order";

const rows = (...ids: string[]) => ids.map((id) => ({ id }));

describe("applyFrozenOrder", () => {
  it("adopts the incoming order on the first pass", () => {
    const out = applyFrozenOrder(rows("a", "b", "c"), []);
    expect(out.rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(out.nextFrozenIds).toEqual(["a", "b", "c"]);
  });

  it("keeps the frozen order even when the incoming order changes", () => {
    // The whole point: an edit re-ranks the source list, and the row the user
    // just touched must not jump out from under their cursor.
    const out = applyFrozenOrder(rows("c", "a", "b"), ["a", "b", "c"]);
    expect(out.rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("inserts a new row at its ranked position, not at the bottom", () => {
    // Both lists are urgency queues. A task just assigned to you must land
    // where the ranking puts it, not below the fold.
    const out = applyFrozenOrder(rows("a", "new", "b"), ["a", "b"]);
    expect(out.rows.map((r) => r.id)).toEqual(["a", "new", "b"]);
    expect(out.nextFrozenIds).toEqual(["a", "new", "b"]);
  });

  it("places a new top-ranked row above the held rows", () => {
    const out = applyFrozenOrder(rows("urgent", "a", "b"), ["a", "b"]);
    expect(out.rows.map((r) => r.id)).toEqual(["urgent", "a", "b"]);
  });

  it("puts new rows ranked below everything held at the end", () => {
    const out = applyFrozenOrder(rows("a", "b", "last"), ["a", "b"]);
    expect(out.rows.map((r) => r.id)).toEqual(["a", "b", "last"]);
  });

  it("keeps several new rows in their ranked order around held rows", () => {
    const out = applyFrozenOrder(rows("x", "a", "y", "b", "z"), ["a", "b"]);
    expect(out.rows.map((r) => r.id)).toEqual(["x", "a", "y", "b", "z"]);
  });

  it("returns the CURRENT row objects, not stale cached ones", () => {
    // "Position frozen, contents update in place" is the whole premise; only
    // asserting ids would let a stale-row implementation pass.
    const out = applyFrozenOrder([{ id: "a", v: 2 }], ["a"]);
    expect(out.rows[0]).toEqual({ id: "a", v: 2 });
  });

  it("drops a duplicated id exactly once and keeps the count consistent", () => {
    // visibleCount is derived from rows.length, so a silent duplicate would
    // desync the header count from what is rendered.
    const out = applyFrozenOrder(rows("a", "a", "b"), ["a"]);
    expect(out.rows.map((r) => r.id)).toEqual(["a", "b"]);
    expect(out.nextFrozenIds).toEqual(["a", "b"]);
  });

  it("drops frozen ids that are no longer present", () => {
    const out = applyFrozenOrder(rows("a"), ["a", "gone"]);
    expect(out.rows.map((r) => r.id)).toEqual(["a"]);
    expect(out.nextFrozenIds).toEqual(["a"]);
  });

  it("returns a stable frozen list when membership did not change", () => {
    const first = applyFrozenOrder(rows("a", "b"), []);
    const second = applyFrozenOrder(rows("b", "a"), first.nextFrozenIds);
    expect(second.nextFrozenIds).toEqual(first.nextFrozenIds);
  });

  it("does not mutate its inputs", () => {
    const incoming = rows("b", "a");
    const frozen = ["a", "b"];
    applyFrozenOrder(incoming, frozen);
    expect(incoming.map((r) => r.id)).toEqual(["b", "a"]);
    expect(frozen).toEqual(["a", "b"]);
  });

  it("handles an empty list", () => {
    const out = applyFrozenOrder([], ["a"]);
    expect(out.rows).toEqual([]);
    expect(out.nextFrozenIds).toEqual([]);
  });
});
