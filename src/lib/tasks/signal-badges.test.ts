import { describe, expect, it } from "vitest";
import {
  emptySignalBadges,
  hasAnySignal,
  signalRankWeight,
  type TaskSignalBadges,
} from "@/lib/tasks/signal-badges";

const badges = (partial: Partial<TaskSignalBadges>): TaskSignalBadges => ({
  ...emptySignalBadges(),
  ...partial,
});

describe("hasAnySignal", () => {
  it("is false when nothing is unread", () => {
    expect(hasAnySignal(emptySignalBadges())).toBe(false);
  });

  it("is true for any single signal", () => {
    expect(hasAnySignal(badges({ assigned: true }))).toBe(true);
    expect(hasAnySignal(badges({ comments: 1 }))).toBe(true);
    expect(hasAnySignal(badges({ mentioned: true }))).toBe(true);
  });

  it("treats a zero comment count as no signal", () => {
    expect(hasAnySignal(badges({ comments: 0 }))).toBe(false);
  });
});

describe("signalRankWeight", () => {
  it("ranks mention above comments above assignment", () => {
    // Lower is higher in the list, matching the rank tuples in sorting.ts.
    const mention = signalRankWeight(badges({ mentioned: true }));
    const comment = signalRankWeight(badges({ comments: 3 }));
    const assigned = signalRankWeight(badges({ assigned: true }));

    expect(mention).toBeLessThan(comment);
    expect(comment).toBeLessThan(assigned);
  });

  it("ranks by the strongest signal present, not the sum", () => {
    // A mention plus comments is still a mention -- it must not outrank a
    // lone mention by accumulating weight.
    expect(signalRankWeight(badges({ mentioned: true, comments: 5 }))).toBe(
      signalRankWeight(badges({ mentioned: true }))
    );
  });

  it("sorts an unbadged task after every badged one", () => {
    expect(signalRankWeight(emptySignalBadges())).toBeGreaterThan(
      signalRankWeight(badges({ assigned: true }))
    );
  });
});
