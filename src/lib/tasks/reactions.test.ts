import { describe, expect, it } from "vitest";
import {
  groupReactions,
  indexReactionRows,
  normalizeReactionEmail,
  reconcileReactionOverrides,
  setReactionPresence,
} from "./reactions";

const rows = [
  { comment_id: "c1", emoji: "🎉", reactor_email: "b@x.com" },
  { comment_id: "c1", emoji: "👍", reactor_email: "a@x.com" },
  { comment_id: "c1", emoji: "👍", reactor_email: "b@x.com" },
  { comment_id: "c2", emoji: "👍", reactor_email: "b@x.com" },
];

describe("groupReactions", () => {
  it("groups by comment then emoji with counts", () => {
    const grouped = groupReactions(rows, "a@x.com");
    expect(grouped.get("c1")).toEqual([
      {
        emoji: "👍",
        count: 2,
        reactedByMe: true,
        reactors: ["a@x.com", "b@x.com"],
      },
      { emoji: "🎉", count: 1, reactedByMe: false, reactors: ["b@x.com"] },
    ]);
  });

  it("marks reactedByMe case-insensitively", () => {
    expect(groupReactions(rows, "A@X.COM").get("c1")?.[0].reactedByMe).toBe(
      true
    );
  });

  it("keeps comments separate", () => {
    expect(groupReactions(rows, "b@x.com").get("c2")).toEqual([
      { emoji: "👍", count: 1, reactedByMe: true, reactors: ["b@x.com"] },
    ]);
  });

  it("breaks count ties by QUICK_EMOJI order, not row order", () => {
    // PostgREST row order is not guaranteed stable across fetches, so a tie
    // broken by insertion order lets the bar reshuffle under the cursor.
    const tied = [
      { comment_id: "c1", emoji: "🎉", reactor_email: "a@x.com" },
      { comment_id: "c1", emoji: "👍", reactor_email: "b@x.com" },
    ];
    expect(groupReactions(tied, "").get("c1")?.map((g) => g.emoji)).toEqual([
      "👍",
      "🎉",
    ]);
  });

  it("sorts higher counts first regardless of QUICK_EMOJI order", () => {
    const weighted = [
      { comment_id: "c1", emoji: "🎉", reactor_email: "a@x.com" },
      { comment_id: "c1", emoji: "🎉", reactor_email: "b@x.com" },
      { comment_id: "c1", emoji: "👍", reactor_email: "c@x.com" },
    ];
    expect(groupReactions(weighted, "").get("c1")?.map((g) => g.emoji)).toEqual([
      "🎉",
      "👍",
    ]);
  });

  it("puts an unknown emoji last rather than dropping it", () => {
    // An emoji retired from QUICK_EMOJI still has rows in the table.
    const legacy = [
      { comment_id: "c1", emoji: "🦄", reactor_email: "a@x.com" },
      { comment_id: "c1", emoji: "👍", reactor_email: "b@x.com" },
    ];
    expect(groupReactions(legacy, "").get("c1")?.map((g) => g.emoji)).toEqual([
      "👍",
      "🦄",
    ]);
  });

  it("tolerates an empty or missing viewer email", () => {
    expect(groupReactions(rows, "").get("c1")?.[0].reactedByMe).toBe(false);
    expect(groupReactions(rows, null).get("c1")?.[0].reactedByMe).toBe(false);
    expect(groupReactions(rows, undefined).get("c1")?.[0].reactedByMe).toBe(
      false
    );
  });

  it("returns an empty map for no rows", () => {
    expect(groupReactions([], "a@x.com").size).toBe(0);
  });
});

describe("reaction state helpers", () => {
  it("normalizes the database identity", () => {
    expect(normalizeReactionEmail("  Person@Example.COM ")).toBe(
      "person@example.com",
    );
  });

  it("adds idempotently and removes case-insensitive duplicates", () => {
    const existing = [
      { comment_id: "c1", emoji: "👍", reactor_email: "ME@X.COM" },
      { comment_id: "c1", emoji: "🎉", reactor_email: "other@x.com" },
    ];
    const added = setReactionPresence(existing, "c1", "👍", " me@x.com ", true);
    expect(added.filter((row) => row.emoji === "👍")).toEqual([
      { comment_id: "c1", emoji: "👍", reactor_email: "me@x.com" },
    ]);
    expect(setReactionPresence(added, "c1", "👍", "ME@X.COM", false)).toEqual([
      { comment_id: "c1", emoji: "🎉", reactor_email: "other@x.com" },
    ]);
  });

  it("indexes rows once by comment", () => {
    const indexed = indexReactionRows(rows);
    expect(indexed.get("c1")).toHaveLength(3);
    expect(indexed.get("c2")).toHaveLength(1);
    expect(indexed.get("missing")).toBeUndefined();
  });

  it("keeps same-task rows across comment refreshes without leaking tasks", () => {
    const current = {
      c1: [{ comment_id: "c1", emoji: "👍", reactor_email: "a@x.com" }],
      removed: [
        { comment_id: "removed", emoji: "🎉", reactor_email: "b@x.com" },
      ],
    };
    const comments = [
      { id: "c1" },
      {
        id: "c2",
        reactions: [
          { comment_id: "c2", emoji: "❤️", reactor_email: "c@x.com" },
        ],
      },
    ];

    expect(reconcileReactionOverrides(comments, current, true)).toEqual({
      c1: current.c1,
      c2: comments[1].reactions,
    });
    expect(reconcileReactionOverrides(comments, current, false)).toEqual({
      c2: comments[1].reactions,
    });
  });
});
