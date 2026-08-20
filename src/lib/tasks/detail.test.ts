import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  TASK_ACTIVITY_LIMIT,
  groupCommentAttachments,
  loadActivity,
  loadComments,
  signAttachmentsSafely,
} from "@/lib/tasks/detail";

const att = (id: string) => ({
  id,
  file_name: `${id}.png`,
  mime_type: "image/png",
  size_bytes: 1,
  url: `https://x/${id}`,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

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

describe("loadComments", () => {
  it("loads names and attachments concurrently without a reaction query", async () => {
    const names = deferred<Map<string, string>>();
    const attachmentRows = deferred<{ data: unknown[]; error: null }>();
    const started = new Set<string>();
    const commentQuery = {
      select: () => commentQuery,
      eq: () => commentQuery,
      is: () => commentQuery,
      order: () => commentQuery,
      limit: async () => ({
        data: [{
          id: "c1",
          task_id: "task-1",
          parent_id: null,
          author_email: "person@example.com",
          body: "hello",
          created_at: "2026-08-19T00:00:00.000Z",
          updated_at: "2026-08-19T00:00:00.000Z",
          deleted_at: null,
        }],
        error: null,
      }),
    };
    const attachmentQuery = {
      select: () => attachmentQuery,
      in: () => attachmentQuery,
      not: () => attachmentQuery,
      is: () => attachmentQuery,
      order: () => {
        started.add("attachments");
        return attachmentRows.promise;
      },
    };
    const supabase = {
      from: (table: string) => {
        if (table === "task_comments") return commentQuery;
        if (table === "task_attachments") return attachmentQuery;
        throw new Error(`Unexpected comment-loader table: ${table}`);
      },
    } as unknown as SupabaseClient;

    const request = loadComments(supabase, "task-1", {
      displayNameResolver: () => {
        started.add("names");
        return names.promise;
      },
    });

    await vi.waitFor(() => {
      expect(started).toEqual(new Set(["names", "attachments"]));
    });
    names.resolve(new Map([["person@example.com", "Person"]]));
    attachmentRows.resolve({ data: [], error: null });

    await expect(request).resolves.toMatchObject({
      comments: [{
        id: "c1",
        author_name: "Person",
        attachments: [],
      }],
      hasMore: false,
    });
  });
});

describe("signAttachmentsSafely", () => {
  it("isolates one signing failure", async () => {
    const rows = [
      { id: "a", file_name: "ok.pdf", mime_type: null, size_bytes: 1, storage_path: "good" },
      { id: "b", file_name: "gone.pdf", mime_type: null, size_bytes: 1, storage_path: "missing" },
    ];
    const signed = await signAttachmentsSafely(rows, async (path) => {
      if (path === "missing") throw new Error("Object not found");
      return `https://signed/${path}`;
    });
    expect(signed[0]).toMatchObject({ id: "a", url: "https://signed/good" });
    expect(signed[1]).toMatchObject({ id: "b", url: null, unavailable: true });
  });

  it("uses one batch request while preserving per-file failures", async () => {
    const rows = [
      { id: "a", file_name: "ok.pdf", mime_type: null, size_bytes: 1, storage_path: "good" },
      { id: "b", file_name: "gone.pdf", mime_type: null, size_bytes: 1, storage_path: "missing" },
    ];
    const signOne = vi.fn(async (path: string) => `https://single/${path}`);
    const signMany = vi.fn(async () => [
      { path: "good", signedUrl: "https://batch/good", error: null },
      { path: "missing", signedUrl: null, error: "Object not found" },
    ]);

    const signed = await signAttachmentsSafely(rows, signOne, signMany);

    expect(signMany).toHaveBeenCalledWith(["good", "missing"]);
    expect(signOne).not.toHaveBeenCalled();
    expect(signed[0]).toMatchObject({ id: "a", url: "https://batch/good" });
    expect(signed[1]).toMatchObject({ id: "b", url: null, unavailable: true });
  });

  it("never assigns another file's URL when a batch result is missing", async () => {
    const rows = [
      { id: "a", file_name: "a.pdf", mime_type: null, size_bytes: 1, storage_path: "a" },
      { id: "b", file_name: "b.pdf", mime_type: null, size_bytes: 1, storage_path: "b" },
    ];
    const signed = await signAttachmentsSafely(
      rows,
      async () => "unused",
      async () => [{ path: "b", signedUrl: "https://batch/b", error: null }],
    );

    expect(signed[0]).toMatchObject({ id: "a", url: null, unavailable: true });
    expect(signed[1]).toMatchObject({ id: "b", url: "https://batch/b" });
  });

  it("falls back to isolated signing after a batch transport failure", async () => {
    const rows = [
      { id: "a", file_name: "a.pdf", mime_type: null, size_bytes: 1, storage_path: "a" },
      { id: "b", file_name: "b.pdf", mime_type: null, size_bytes: 1, storage_path: "b" },
    ];
    const signOne = vi.fn(async (path: string) => `https://single/${path}`);
    const signMany = vi.fn(async () => {
      throw new Error("Storage unavailable");
    });

    const signed = await signAttachmentsSafely(rows, signOne, signMany);

    expect(signOne).toHaveBeenCalledTimes(2);
    expect(signed.map((file) => file.url)).toEqual([
      "https://single/a",
      "https://single/b",
    ]);
  });
});
