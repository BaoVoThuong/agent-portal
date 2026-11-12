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
    const builder = {
      select: () => builder,
      in: () => builder,
      is: () => builder,
      gt: () => builder,
      order: () => builder,
      limit: () => Promise.resolve({ data: rows, error: null, count: rows.length }),
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
        ? thenable([{ id: "1", record_id: "a", body: "hi" }, { id: "2", record_id: "a", body: "" }])
        : thenable([{ id: "1", record_id: "a" }]),
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

describe("fetchEnrollmentRecords paging", () => {
  type Row = { id: string; program: string; created_at: string; updated_at: string };
  type Served = {
    data: unknown[] | null;
    error: { code?: string; message: string } | null;
    count: number | null;
    status?: number;
  };
  type Request = {
    columns: string;
    withCount: boolean;
    afterId: string | null;
    limit: number | null;
    scoped: string | null;
  };

  afterEach(() => {
    vi.doUnmock("@/lib/supabase");
    vi.resetModules();
    vi.restoreAllMocks();
  });

  const makeRows = (length: number) =>
    Array.from({ length }, (_, index): Row => ({
      id: `rec-${String(index).padStart(5, "0")}`,
      program: "aca",
      created_at: "2026-11-11T00:00:00.000Z",
      updated_at: `2026-11-11T00:${String(index % 60).padStart(2, "0")}:00.000Z`,
    }));

  /** Each page is its own query chain, served by id keyset like PostgREST. */
  async function load(options: {
    rows: () => Row[];
    /** Replace or observe the response to the n-th request (0-based). */
    respond?: (request: number, served: Served) => Served;
  }) {
    vi.resetModules();
    const requests: Request[] = [];
    const from = vi.fn(() => {
      const request: Request = {
        columns: "",
        withCount: false,
        afterId: null,
        limit: null,
        scoped: null,
      };
      const builder = {
        select: (columns: string, opts?: { count?: string }) => {
          request.columns = columns;
          request.withCount = opts?.count === "exact";
          return builder;
        },
        eq: () => builder,
        is: () => builder,
        or: (filter: string) => {
          request.scoped = filter;
          return builder;
        },
        gt: (_column: string, value: string) => {
          request.afterId = value;
          return builder;
        },
        order: () => builder,
        limit: (size: number) => {
          request.limit = size;
          return builder;
        },
        then: (
          resolve: (value: Served) => unknown,
          reject?: (reason: unknown) => unknown,
        ) => {
          const index = requests.push(request) - 1;
          const all = options.rows();
          const cursor = request.afterId;
          const found = cursor === null ? 0 : all.findIndex((row) => row.id > cursor);
          const begin = found === -1 ? all.length : found;
          let served: Served = {
            data: all.slice(begin, begin + (request.limit ?? all.length)),
            error: null,
            count: request.withCount ? all.length : null,
            status: 200,
          };
          if (options.respond) served = options.respond(index, served);
          return Promise.resolve(served).then(resolve, reject);
        },
      };
      return builder;
    });
    const rpc = vi.fn(async () => ({ data: {}, error: null }));
    vi.doMock("@/lib/supabase", () => ({
      getSupabaseAdmin: () => ({ from, rpc }),
    }));
    const queries = await import("@/lib/enrollment/queries");
    return { queries, requests, rpc };
  }

  it("reads every record past the 1,000-row cap, 500 per request", async () => {
    const all = makeRows(1060);
    const { queries, requests, rpc } = await load({ rows: () => all });
    const records = await queries.fetchEnrollmentRecords("aca", { seeAll: true });
    expect(records).toHaveLength(1060);
    expect(new Set(records.map((record) => record.id)).size).toBe(1060);
    expect(requests.map((request) => [request.afterId, request.limit, request.withCount])).toEqual([
      [null, 500, true],
      ["rec-00499", 500, false],
      ["rec-00999", 500, false],
    ]);
    const stamps = records.map((record) => record.updated_at);
    expect([...stamps].sort().reverse()).toEqual(stamps);
    expect(rpc).toHaveBeenCalledOnce();
  });

  it("applies the viewer's scope to every page", async () => {
    const all = makeRows(1001);
    const { queries, requests } = await load({ rows: () => all });
    await queries.fetchEnrollmentRecords("aca", {
      seeAll: false,
      agentEmails: ["agent@example.com"],
      viewerEmail: "cs@example.com",
      personColumns: [],
    } as never);
    expect(requests).toHaveLength(3);
    expect(requests[0].scoped).toContain("agent_email.in.");
    expect(requests.every((request) => request.scoped === requests[0].scoped)).toBe(true);
  });

  it("keeps an existing record when another is created mid-read", async () => {
    const all = makeRows(1000);
    const { queries } = await load({
      rows: () => all,
      respond: (request, served) => {
        // Lands above the cursor after page 1. Stopping once the loaded rows
        // reach page 1's count (1,000) would drop rec-00999.
        if (request === 0) all.splice(601, 0, { ...all[600], id: "rec-00600a" });
        return served;
      },
    });
    const records = await queries.fetchEnrollmentRecords("aca", { seeAll: true });
    expect(records).toHaveLength(1001);
    expect(records.map((record) => record.id)).toContain("rec-00999");
  });

  it("does not fail the page when a record is archived mid-read", async () => {
    const all = makeRows(1001);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { queries } = await load({
      rows: () => all,
      respond: (request, served) => {
        if (request === 0) all.splice(600, 1);
        return served;
      },
    });
    const records = await queries.fetchEnrollmentRecords("aca", { seeAll: true });
    expect(records).toHaveLength(1000);
    expect(records.some((record) => record.id === "rec-00600")).toBe(false);
    expect(warn).toHaveBeenCalledWith("[enrollment-list] list changed while paging", {
      program: "aca",
      total: 1001,
      loaded: 1000,
    });
  });

  it("pages the schema fallback too", async () => {
    const all = makeRows(600);
    const { queries, requests } = await load({
      rows: () => all,
      respond: (request, served) =>
        request === 0
          ? {
              data: null,
              error: {
                code: "42703",
                message: "column enrollment_records.carrier_ids does not exist",
              },
              count: null,
              status: 400,
            }
          : served,
    });
    const records = await queries.fetchEnrollmentRecords("aca", { seeAll: true });
    expect(records).toHaveLength(600);
    expect(requests[0].columns).toContain("carrier_ids");
    expect(requests.slice(1).every((request) => !request.columns.includes("carrier_ids"))).toBe(true);
    expect(requests.slice(1).map((request) => request.afterId)).toEqual([null, "rec-00499"]);
  });

  it("fails instead of returning a partial list when a later page errors", async () => {
    const all = makeRows(1001);
    const timeout = { code: "57014", message: "canceling statement due to statement timeout" };
    const { queries } = await load({
      rows: () => all,
      respond: (request, served) =>
        request >= 1 ? { data: null, error: timeout, count: null, status: 500 } : served,
    });
    await expect(queries.fetchEnrollmentRecords("aca", { seeAll: true })).rejects.toThrow(
      "canceling statement due to statement timeout",
    );
  });
});
