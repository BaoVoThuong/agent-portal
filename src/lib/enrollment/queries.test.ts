import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertEnrollmentRecordsComplete,
  chunkEnrollmentRecordIds,
  EnrollmentListTruncatedError,
  fetchEnrollmentListChildStats,
} from "@/lib/enrollment/queries";

describe("fetchEnrollmentListChildStats", () => {
  afterEach(() => vi.restoreAllMocks());

  const thenable = (rows: unknown[]) => {
    const result = Promise.resolve({ data: rows, error: null });
    const builder = {
      select: () => builder,
      in: () => builder,
      is: () => result,
      then: result.then.bind(result),
    };
    return builder;
  };

  it("loads stats in one RPC request", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { a: { comment_count: 2, attachment_count: 1, comment_search_text: "x y" } },
      error: null,
    });
    const from = vi.fn();
    const stats = await fetchEnrollmentListChildStats({ rpc, from } as never, ["a", "b"]);
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("enrollment_list_child_stats", {
      p_record_ids: ["a", "b"],
    });
    expect(from).not.toHaveBeenCalled();
    expect(stats.get("a")).toEqual({
      comment_count: 2,
      attachment_count: 1,
      comment_search_text: "x y",
    });
    expect(stats.get("b")).toBeUndefined();
  });

  it("skips the RPC for an empty list", async () => {
    const rpc = vi.fn();
    await fetchEnrollmentListChildStats({ rpc, from: vi.fn() } as never, []);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("uses the old reads only when the RPC is missing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "PGRST202", message: "Could not find the function" },
    });
    const from = vi.fn((table: string) =>
      table === "enrollment_comments"
        ? thenable([{ record_id: "a", body: "hi" }, { record_id: "a", body: "" }])
        : thenable([{ record_id: "a" }]),
    );
    const stats = await fetchEnrollmentListChildStats({ rpc, from } as never, ["a", "b"]);
    expect(stats.get("a")).toEqual({
      comment_count: 2,
      attachment_count: 1,
      comment_search_text: "hi",
    });
    expect(stats.get("b")).toEqual({
      comment_count: 0,
      attachment_count: 0,
      comment_search_text: "",
    });
    expect(warn).toHaveBeenCalledOnce();
  });

  it("throws on database errors other than a missing function", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "57014", message: "statement timeout" },
    });
    await expect(fetchEnrollmentListChildStats({ rpc, from: vi.fn() } as never, ["a"]))
      .rejects.toThrow("statement timeout");
  });
});

describe("chunkEnrollmentRecordIds", () => {
  it("keeps list hydration requests bounded", () => {
    expect(chunkEnrollmentRecordIds(["1", "2", "3", "4", "5"], 2)).toEqual([
      ["1", "2"],
      ["3", "4"],
      ["5"],
    ]);
  });

  it("rejects an invalid chunk size", () => {
    expect(() => chunkEnrollmentRecordIds(["1"], 0)).toThrow(
      "chunkSize must be a positive integer.",
    );
  });
});

describe("assertEnrollmentRecordsComplete", () => {
  it("fails closed when PostgREST returns fewer rows than the exact count", () => {
    expect(() => assertEnrollmentRecordsComplete([{ id: "one" }], 2)).toThrow(
      EnrollmentListTruncatedError
    );
  });

  it("accepts complete or count-unavailable responses", () => {
    expect(() => assertEnrollmentRecordsComplete([{ id: "one" }], 1)).not.toThrow();
    expect(() => assertEnrollmentRecordsComplete([{ id: "one" }], null)).not.toThrow();
    expect(() => assertEnrollmentRecordsComplete(null, undefined)).not.toThrow();
  });
});
