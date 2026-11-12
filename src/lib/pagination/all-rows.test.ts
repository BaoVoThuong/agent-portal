import { describe, expect, it, vi } from "vitest";
import { readAllRowsById } from "./all-rows";

/** Serves `ids()` by keyset like PostgREST, optionally capping every response. */
function keysetServer(ids: () => string[], serverCap = Infinity) {
  return vi.fn(async (afterId: string | null, size: number, withCount: boolean) => {
    const all = ids();
    const start = afterId === null ? 0 : all.findIndex((id) => id > afterId);
    const from = start === -1 ? all.length : start;
    return {
      data: all.slice(from, from + Math.min(size, serverCap)).map((id) => ({ id })),
      error: null,
      count: withCount ? all.length : null,
    };
  });
}

describe("readAllRowsById", () => {
  it("reads past a server cap that is below the page size", async () => {
    const ids = ["a", "b", "c", "d", "e"];
    const readPage = keysetServer(() => ids, 2);
    const result = await readAllRowsById(readPage, 3);
    expect(result.data?.map((row) => row.id)).toEqual(ids);
    expect(result.count).toBe(5);
    expect(readPage).toHaveBeenCalledTimes(3);
  });

  it("loads all 1001 rows in pages of 500", async () => {
    const ids = Array.from({ length: 1001 }, (_, index) => String(index).padStart(4, "0"));
    const readPage = keysetServer(() => ids);
    const result = await readAllRowsById(readPage);
    expect(result.data).toHaveLength(1001);
    expect(result.data?.[1000].id).toBe("1000");
    expect(readPage).toHaveBeenCalledTimes(3);
    expect(readPage.mock.calls.map(([, , withCount]) => withCount)).toEqual([true, false, false]);
  });

  it("stops after one request when the first page is short and complete", async () => {
    const readPage = keysetServer(() => ["a", "b"]);
    const result = await readAllRowsById(readPage);
    expect(result.data).toHaveLength(2);
    expect(readPage).toHaveBeenCalledTimes(1);
  });

  it("keeps reading past the first-page count when a row is inserted during the walk", async () => {
    // Stopping as soon as rows.length reaches the first page's count would end
    // the walk after page 2 here and silently drop "d".
    const ids = ["a", "b", "c", "d"];
    const readPage = keysetServer(() => ids);
    readPage.mockImplementationOnce(async () => {
      ids.splice(2, 0, "bb"); // lands above the cursor ("b") after page 1
      return { data: [{ id: "a" }, { id: "b" }], error: null, count: 4 };
    });
    const result = await readAllRowsById(readPage, 2);
    expect(result.data?.map((row) => row.id)).toEqual(["a", "b", "bb", "c", "d"]);
    expect(readPage).toHaveBeenCalledTimes(3);
  });

  it("returns the rows that stayed when the set shrinks during the walk", async () => {
    const readPage = vi.fn()
      .mockResolvedValueOnce({ data: [{ id: "a" }], error: null, count: 2 })
      .mockResolvedValueOnce({ data: [], error: null, count: null });
    const result = await readAllRowsById(readPage, 1);
    expect(result).toEqual({ data: [{ id: "a" }], error: null, count: 2 });
    expect(readPage).toHaveBeenCalledTimes(2);
  });

  it("walks to an empty page when the server sends no count", async () => {
    const readPage = vi.fn()
      .mockResolvedValueOnce({ data: [{ id: "a" }], error: null, count: null })
      .mockResolvedValueOnce({ data: [], error: null, count: null });
    const result = await readAllRowsById(readPage);
    expect(result.data).toEqual([{ id: "a" }]);
    expect(readPage).toHaveBeenCalledTimes(2);
  });

  it("retries a transient error once", async () => {
    const timeout = { code: "57014", message: "statement timeout" };
    const readPage = vi.fn()
      .mockResolvedValueOnce({ data: null, error: timeout, count: null, status: 500 })
      .mockResolvedValueOnce({ data: [{ id: "a" }], error: null, count: 1 });
    const result = await readAllRowsById(readPage);
    expect(result.data).toEqual([{ id: "a" }]);
    expect(readPage).toHaveBeenCalledTimes(2);
  });

  it("returns an error from a later page without returning partial rows", async () => {
    const error = { code: "42501", message: "permission denied" };
    const readPage = vi.fn()
      .mockResolvedValueOnce({ data: [{ id: "a" }], error: null, count: 2 })
      .mockResolvedValueOnce({ data: null, error, count: null });
    expect(await readAllRowsById(readPage, 1)).toEqual({ data: null, error, count: 2 });
  });

  it("rejects a repeated cursor", async () => {
    const readPage = vi.fn().mockResolvedValue({ data: [{ id: "a" }, { id: "a" }], error: null, count: 2 });
    await expect(readAllRowsById(readPage, 2)).rejects.toThrow("cursor did not advance");
  });
});
