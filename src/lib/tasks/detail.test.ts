import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  TASK_ACTIVITY_LIMIT,
  groupCommentAttachments,
  loadActivity,
} from "@/lib/tasks/detail";

const att = (id: string) => ({
  id,
  file_name: `${id}.png`,
  mime_type: "image/png",
  size_bytes: 1,
  url: `https://x/${id}`,
});

describe("groupCommentAttachments", () => {
  it("attaches signed files to their comment, empty array otherwise", () => {
    const comments = [{ id: "c1", body: "a" }, { id: "c2", body: "b" }];
    const signed = [
      { comment_id: "c1", att: att("f1") },
      { comment_id: "c1", att: att("f2") },
    ];

    const out = groupCommentAttachments(comments, signed);

    expect(out[0]).toMatchObject({ id: "c1", body: "a" });
    expect(out[0].attachments.map((a) => a.id)).toEqual(["f1", "f2"]);
    expect(out[1].attachments).toEqual([]);
  });

  it("preserves comment order and all original fields", () => {
    const comments = [{ id: "c2", body: "second" }, { id: "c1", body: "first" }];

    const out = groupCommentAttachments(comments, []);

    expect(out.map((c) => c.id)).toEqual(["c2", "c1"]);
    expect(out[0].body).toBe("second");
  });
});

describe("loadActivity", () => {
  it("caps activity to the latest 200 rows", async () => {
    const calls: { limit?: number; order?: unknown } = {};
    const query = {
      select: () => query,
      eq: () => query,
      order: (_column: string, options: unknown) => {
        calls.order = options;
        return query;
      },
      limit: async (limit: number) => {
        calls.limit = limit;
        return { data: [], error: null };
      },
    };
    const supabase = {
      from: (table: string) => {
        expect(table).toBe("task_activity");
        return query;
      },
    } as unknown as SupabaseClient;

    await loadActivity(supabase, "task-1");

    expect(calls.limit).toBe(TASK_ACTIVITY_LIMIT);
    expect(calls.order).toEqual({ ascending: false });
  });
});
