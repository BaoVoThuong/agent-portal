import { describe, expect, it, vi } from "vitest";
import {
  fetchAllByKeyset,
  isTransientPostgrestError,
  type KeysetPage,
} from "./keyset";

type Row = { id: string };

/** Bảng giả: sắp theo id, trả `size` dòng sau `afterId`. */
function fakeTable(ids: string[], size: number) {
  const sorted = [...ids].sort();
  return (afterId: string | null): KeysetPage<Row> => {
    const start = afterId === null ? 0 : sorted.findIndex((id) => id > afterId);
    const slice = start < 0 ? [] : sorted.slice(start, start + size);
    return {
      rows: slice.map((id) => ({ id })),
      error: null,
      count: afterId === null ? sorted.length : undefined,
    };
  };
}

const permissive = { maxRows: 100_000, isTransient: isTransientPostgrestError };

describe("fetchAllByKeyset", () => {
  it("returns a single page as-is", async () => {
    const table = fakeTable(["a", "b", "c"], 10);
    const result = await fetchAllByKeyset(async (a) => table(a), permissive);
    expect(result.rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(result.total).toBe(3);
    expect(result.truncated).toBe(false);
  });

  it("walks several pages and keeps id order", async () => {
    const ids = Array.from({ length: 25 }, (_, i) => `id-${String(i).padStart(3, "0")}`);
    const table = fakeTable(ids, 10);
    const result = await fetchAllByKeyset(async (a) => table(a), permissive);
    expect(result.rows).toHaveLength(25);
    expect(result.rows.map((r) => r.id)).toEqual([...ids].sort());
    expect(result.truncated).toBe(false);
  });

  it("keeps going when a page comes back smaller than the previous one", async () => {
    // Trần của server có thể đổi giữa chừng; con trỏ là dòng cuối, không phải
    // một phép nhân theo kích thước trang, nên trang ngắn không mở ra khoảng trống.
    const ids = ["a", "b", "c", "d", "e"];
    let call = 0;
    const result = await fetchAllByKeyset<Row>(async (afterId) => {
      call += 1;
      const size = call === 1 ? 3 : 1;
      return fakeTable(ids, size)(afterId);
    }, permissive);
    expect(result.rows.map((r) => r.id)).toEqual(ids);
  });

  it("stops at maxRows and reports truncation", async () => {
    const ids = Array.from({ length: 50 }, (_, i) => `id-${String(i).padStart(3, "0")}`);
    const fetchPage = vi.fn(async (a: string | null) => fakeTable(ids, 10)(a));
    const result = await fetchAllByKeyset(fetchPage, {
      maxRows: 20,
      isTransient: isTransientPostgrestError,
    });
    expect(result.rows).toHaveLength(20);
    expect(result.total).toBe(50);
    expect(result.truncated).toBe(true);
    // Chạm trần thì DỪNG, không đi tiếp cho hết bảng.
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("stops without an extra round trip once it has the whole count", async () => {
    const ids = ["a", "b", "c", "d"];
    const fetchPage = vi.fn(async (a: string | null) => fakeTable(ids, 4)(a));
    await fetchAllByKeyset(fetchPage, permissive);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("retries a transient failure exactly once", async () => {
    const ids = ["a", "b"];
    let calls = 0;
    const fetchPage = vi.fn(async (a: string | null): Promise<KeysetPage<Row>> => {
      calls += 1;
      if (calls === 1) return { rows: null, error: { message: "fetch failed" } };
      return fakeTable(ids, 10)(a);
    });
    const result = await fetchAllByKeyset(fetchPage, permissive);
    expect(result.rows.map((r) => r.id)).toEqual(ids);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry a permanent failure", async () => {
    const fetchPage = vi.fn(
      async (): Promise<KeysetPage<Row>> => ({
        rows: null,
        error: { code: "42501", message: "permission denied for table tasks" },
      }),
    );
    await expect(fetchAllByKeyset(fetchPage, permissive)).rejects.toThrow(
      /permission denied/,
    );
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("throws when a transient failure survives its one retry", async () => {
    const fetchPage = vi.fn(
      async (): Promise<KeysetPage<Row>> => ({
        rows: null,
        error: { message: "network timeout" },
      }),
    );
    await expect(fetchAllByKeyset(fetchPage, permissive)).rejects.toThrow(/timeout/);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("treats an empty first page as an empty result, not an error", async () => {
    const result = await fetchAllByKeyset<Row>(
      async () => ({ rows: [], error: null, count: 0 }),
      permissive,
    );
    expect(result.rows).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.truncated).toBe(false);
  });

  // Đây là lý do keyset tồn tại: một dòng bị xoá giữa hai trang không được phép
  // kéo dòng khác lùi qua biên và biến mất khỏi kết quả.
  it("does not drop a row when another row is deleted mid-walk", async () => {
    const live = new Set(["a", "b", "c", "d", "e", "f"]);
    let call = 0;
    const result = await fetchAllByKeyset<Row>(async (afterId) => {
      call += 1;
      if (call === 2) live.delete("a"); // đã đọc xong, xoá ở phía sau con trỏ
      const sorted = [...live].sort();
      const start = afterId === null ? 0 : sorted.findIndex((id) => id > afterId);
      const slice = start < 0 ? [] : sorted.slice(start, start + 3);
      return {
        rows: slice.map((id) => ({ id })),
        error: null,
        count: afterId === null ? 6 : undefined,
      };
    }, permissive);
    expect(result.rows.map((r) => r.id)).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  // Đây là lỗi mà bản đầu mắc phải: suy `total` từ số dòng đã nhận. Nếu server
  // cắt phản hồi ở trần của nó mà header count lại thiếu, vòng lặp dừng ngay ở
  // trang đầu và báo truncated: false — cắt cụt IM LẶNG.
  it("does not infer total from the first batch when count is missing", async () => {
    const ids = Array.from({ length: 25 }, (_, i) => `id-${String(i).padStart(3, "0")}`);
    const table = fakeTable(ids, 10);
    const result = await fetchAllByKeyset<Row>(async (afterId) => {
      const page = table(afterId);
      return { rows: page.rows, error: null, count: null }; // server không trả count
    }, permissive);
    expect(result.rows).toHaveLength(25);
    expect(result.total).toBe(25);
    expect(result.truncated).toBe(false);
  });

  it("reports truncated when the cap is hit even without a count", async () => {
    const ids = Array.from({ length: 100 }, (_, i) => `id-${String(i).padStart(3, "0")}`);
    const table = fakeTable(ids, 10);
    const result = await fetchAllByKeyset<Row>(
      async (afterId) => ({ rows: table(afterId).rows, error: null, count: null }),
      { maxRows: 30, isTransient: isTransientPostgrestError },
    );
    expect(result.rows).toHaveLength(30);
    expect(result.truncated).toBe(true);
  });

  // Trần của server có thể nhỏ hơn kích thước trang ta xin, khiến MỌI trang đều
  // "ngắn". Dừng khi thấy trang ngắn là mất dữ liệu; chỉ trang RỖNG mới là hết.
  it("keeps walking when every page is shorter than requested", async () => {
    const ids = Array.from({ length: 12 }, (_, i) => `id-${String(i).padStart(3, "0")}`);
    const table = fakeTable(ids, 5); // server luôn cắt ở 5 dù ta xin nhiều hơn
    const result = await fetchAllByKeyset<Row>(
      async (afterId) => ({ rows: table(afterId).rows, error: null, count: null }),
      permissive,
    );
    expect(result.rows).toHaveLength(12);
    expect(result.truncated).toBe(false);
  });

});

describe("isTransientPostgrestError", () => {
  it("retries connection and timeout classes", () => {
    expect(isTransientPostgrestError({ code: "PGRST504" })).toBe(true);
    expect(isTransientPostgrestError({ code: "08006" })).toBe(true);
    expect(isTransientPostgrestError({ code: "57014" })).toBe(true);
    expect(isTransientPostgrestError({ message: "fetch failed" })).toBe(true);
    expect(isTransientPostgrestError({ message: "ECONNRESET" })).toBe(true);
  });

  it("retries 429 and 5xx by HTTP status even without a code", () => {
    expect(isTransientPostgrestError({ status: 429 })).toBe(true);
    expect(isTransientPostgrestError({ status: 502, message: "Bad Gateway" })).toBe(true);
    expect(isTransientPostgrestError({ status: 503 })).toBe(true);
    expect(isTransientPostgrestError({ status: 504 })).toBe(true);
  });

  it("does not retry other 4xx", () => {
    expect(isTransientPostgrestError({ status: 400 })).toBe(false);
    expect(isTransientPostgrestError({ status: 403 })).toBe(false);
  });

  it("does not retry permission, schema or syntax failures", () => {
    expect(isTransientPostgrestError({ code: "42501" })).toBe(false);
    expect(isTransientPostgrestError({ code: "42703" })).toBe(false);
    expect(isTransientPostgrestError({ code: "PGRST100" })).toBe(false);
    expect(isTransientPostgrestError({ message: "column does not exist" })).toBe(false);
  });
});
