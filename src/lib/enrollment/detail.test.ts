import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadEnrollmentComments } from "@/lib/enrollment/detail";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("loadEnrollmentComments", () => {
  it("starts display-name and attachment-row reads concurrently", async () => {
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
          record_id: "record-1",
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
        if (table === "enrollment_comments") return commentQuery;
        if (table === "enrollment_attachments") return attachmentQuery;
        throw new Error(`Unexpected enrollment detail table: ${table}`);
      },
    } as unknown as SupabaseClient;

    const request = loadEnrollmentComments(supabase, "record-1", {
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
      comments: [{ id: "c1", author_name: "Person", attachments: [] }],
      hasMore: false,
    });
  });
});
