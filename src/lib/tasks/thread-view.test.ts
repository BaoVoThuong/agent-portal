import { describe, expect, it } from "vitest";
import {
  activeCommentCount,
  isNearBottom,
  shouldFollowNewRows,
} from "@/lib/tasks/thread-view";

describe("thread follow behaviour", () => {
  it("follows when the reader is already at the bottom", () => {
    expect(shouldFollowNewRows({ nearBottom: true, ownSend: false, deepLink: false })).toBe(true);
  });

  it("follows the reader's own successful send even when scrolled up", () => {
    expect(shouldFollowNewRows({ nearBottom: false, ownSend: true, deepLink: false })).toBe(true);
  });

  it("does not yank a reader who is reading older messages", () => {
    expect(shouldFollowNewRows({ nearBottom: false, ownSend: false, deepLink: false })).toBe(false);
  });

  it("never overrides a deep link", () => {
    expect(shouldFollowNewRows({ nearBottom: true, ownSend: true, deepLink: true })).toBe(false);
  });
});

describe("activeCommentCount", () => {
  it("counts replies and excludes deleted rows", () => {
    expect(
      activeCommentCount([
        { deleted_at: null },
        { deleted_at: null },
        { deleted_at: "2026-08-09T00:00:00Z" },
      ]),
    ).toBe(2);
  });
});

describe("isNearBottom", () => {
  it("treats a small remaining scroll distance as near the bottom", () => {
    expect(isNearBottom({ scrollTop: 900, clientHeight: 100, scrollHeight: 1010 })).toBe(true);
    expect(isNearBottom({ scrollTop: 0, clientHeight: 100, scrollHeight: 1010 })).toBe(false);
  });
});
