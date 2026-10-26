import { describe, expect, it } from "vitest";
import { nextCommentPageCursor } from "./comment-pagination";

describe("nextCommentPageCursor", () => {
  it("continues after the query page even when a reply pulls in an older parent", () => {
    const page = [
      { id: "reply", created_at: "2026-10-25T12:00:00Z" },
      { id: "boundary", created_at: "2026-10-25T11:00:00Z" },
    ];
    const cursor = nextCommentPageCursor(page, true);
    const response = [...page, { id: "parent", created_at: "2026-10-01T00:00:00Z" }];

    expect(response.at(-1)?.id).toBe("parent");
    expect(cursor).toEqual(page[1]);
  });

  it("stops at the last page", () => {
    expect(nextCommentPageCursor([{ id: "only", created_at: "2026-10-25T12:00:00Z" }], false)).toBeNull();
  });
});
