import { describe, expect, it } from "vitest";
import { partitionBySignal } from "@/lib/enrollment/signal-order";
import {
  emptySignalBadges,
  type TaskSignalBadges,
} from "@/lib/tasks/signal-badges";

const row = (id: string) => ({ id });
const badged = (partial: Partial<TaskSignalBadges>): TaskSignalBadges => ({
  ...emptySignalBadges(),
  ...partial,
});

describe("partitionBySignal", () => {
  it("floats badged records to the front", () => {
    const rows = [row("a"), row("b"), row("c")];
    const out = partitionBySignal(rows, { b: badged({ comments: 1 }) });
    expect(out.map((r) => r.id)).toEqual(["b", "a", "c"]);
  });

  it("orders the badged group mention, comments, assignment", () => {
    const rows = [row("assigned"), row("commented"), row("mentioned")];
    const out = partitionBySignal(rows, {
      assigned: badged({ assigned: true }),
      commented: badged({ comments: 2 }),
      mentioned: badged({ mentioned: true }),
    });
    expect(out.map((r) => r.id)).toEqual(["mentioned", "commented", "assigned"]);
  });

  it("preserves the incoming order inside each group", () => {
    // The active column sort already ordered these; the partition must not
    // reshuffle within a group or the header sort stops meaning anything.
    const rows = [row("a"), row("b"), row("c"), row("d")];
    const out = partitionBySignal(rows, {
      c: badged({ comments: 1 }),
      a: badged({ comments: 1 }),
    });
    expect(out.map((r) => r.id)).toEqual(["a", "c", "b", "d"]);
  });

  it("returns the input order unchanged when nothing is badged", () => {
    const rows = [row("a"), row("b")];
    expect(partitionBySignal(rows, {}).map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("ignores a badge entry whose record is not in the list", () => {
    const rows = [row("a")];
    expect(
      partitionBySignal(rows, { ghost: badged({ mentioned: true }) }).map(
        (r) => r.id
      )
    ).toEqual(["a"]);
  });
});
