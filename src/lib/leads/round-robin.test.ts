import { describe, expect, it } from "vitest";
import { pickWeighted, previewDistribution, type WeightedEntry } from "./round-robin";

const entry = (
  email: string, weight: number, position: number, currentWeight = 0
): WeightedEntry => ({ email, weight, currentWeight, position });

describe("pickWeighted", () => {
  // Both halves of the requirement in one assertion: the ratio is 7/3 AND the
  // two are interleaved rather than handed out as one block each.
  it("gives 70/30 as an interleaved run, not two blocks", () => {
    const { picks } = pickWeighted([entry("a", 70, 1), entry("b", 30, 2)], 10);
    expect(picks.join("")).toBe("abaaabaaba");
    expect(picks.filter((p) => p === "a")).toHaveLength(7);
    expect(picks.filter((p) => p === "b")).toHaveLength(3);
  });

  it("returns to zero after a full cycle so the ratio cannot drift", () => {
    const { nextState } = pickWeighted([entry("a", 70, 1), entry("b", 30, 2)], 10);
    expect(nextState.map((e) => e.currentWeight)).toEqual([0, 0]);
  });

  // This is why the cursor has to live in the database. Without it, ten imports
  // of one lead each would all land on the same agent.
  it("continues the rotation across calls", () => {
    const start = [entry("a", 70, 1), entry("b", 30, 2)];
    const first = pickWeighted(start, 3);
    const second = pickWeighted(first.nextState, 7);
    expect([...first.picks, ...second.picks].join("")).toBe("abaaabaaba");
  });

  it("breaks ties by position then email, never by input order", () => {
    expect(pickWeighted([entry("z", 50, 2), entry("a", 50, 1)], 2).picks)
      .toEqual(["a", "z"]);
    expect(pickWeighted([entry("b", 50, 1), entry("a", 50, 1)], 2).picks)
      .toEqual(["a", "b"]);
  });

  it("sends everything to the only agent", () => {
    expect(pickWeighted([entry("a", 5, 1)], 3).picks).toEqual(["a", "a", "a"]);
  });

  // The caller leaves those leads in the pool rather than failing the import.
  it("returns no picks when there is nobody to pick", () => {
    expect(pickWeighted([], 5).picks).toEqual([]);
    expect(pickWeighted([entry("a", 0, 1)], 5).picks).toEqual([]);
  });

  it("never picks a zero-weight agent", () => {
    const { picks } = pickWeighted([entry("a", 10, 1), entry("b", 0, 2)], 5);
    expect(picks.every((p) => p === "a")).toBe(true);
  });

  it("holds the ratio over a long run with three uneven weights", () => {
    const { picks } = pickWeighted(
      [entry("a", 50, 1), entry("b", 30, 2), entry("c", 20, 3)], 100
    );
    const count = (email: string) => picks.filter((p) => p === email).length;
    expect([count("a"), count("b"), count("c")]).toEqual([50, 30, 20]);
    // Interleaved, not blocked: nobody waits through a long run of someone else.
    expect(picks.slice(0, 10)).toContain("c");
  });
});

describe("previewDistribution", () => {
  it("reports the next ten without spending the cursor", () => {
    const state = [entry("a", 70, 1), entry("b", 30, 2)];
    expect(previewDistribution(state, 10)).toEqual([
      { email: "a", count: 7 },
      { email: "b", count: 3 },
    ]);
    // The caller's own state is untouched — pickWeighted copies before mutating.
    expect(state.map((e) => e.currentWeight)).toEqual([0, 0]);
  });
});
