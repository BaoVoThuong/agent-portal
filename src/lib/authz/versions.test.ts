import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: () => {
    throw new Error("test này không được chạm database");
  },
}));

const { ACCESS_VERSION_TTL_MS, createAccessVersionCache, isAccessVersionStale } = await import(
  "./versions"
);

describe("isAccessVersionStale", () => {
  it("lệch version thì làm mới", () => {
    expect(isAccessVersionStale(1, { status: "ok", version: 2 })).toBe(true);
    expect(isAccessVersionStale(2, { status: "ok", version: 2 })).toBe(false);
  });

  it("token cũ chưa có version được coi là 0", () => {
    expect(isAccessVersionStale(undefined, { status: "ok", version: 0 })).toBe(false);
    expect(isAccessVersionStale(undefined, { status: "ok", version: 1 })).toBe(true);
  });

  it("account không còn: làm mới ngay để phiên kết thúc", () => {
    expect(isAccessVersionStale(3, { status: "missing" })).toBe(true);
  });

  it("không biết (lỗi / cột chưa có): không làm mới, không đăng xuất ai", () => {
    expect(isAccessVersionStale(3, { status: "unknown" })).toBe(false);
  });
});

describe("createAccessVersionCache — SLA thu hồi ≤ 30 giây trên nhiều instance", () => {
  it("mỗi instance tự hỏi DB tối đa một lần mỗi TTL, và cả hai thấy version mới sau TTL", async () => {
    let dbVersion = 1;
    const fetcher = vi.fn(async () => ({ status: "ok" as const, version: dbVersion }));
    const instanceA = createAccessVersionCache(fetcher);
    const instanceB = createAccessVersionCache(fetcher);

    await expect(instanceA.get("u1", 0)).resolves.toEqual({ status: "ok", version: 1 });
    dbVersion = 2; // admin vừa khoá / đổi role
    // B chưa từng hỏi → thấy ngay version mới; A còn trong TTL → thấy version cũ.
    await expect(instanceB.get("u1", 10)).resolves.toEqual({ status: "ok", version: 2 });
    await expect(instanceA.get("u1", ACCESS_VERSION_TTL_MS - 1)).resolves.toEqual({
      status: "ok",
      version: 1,
    });
    // Hết TTL: A cũng thấy version mới.
    await expect(instanceA.get("u1", ACCESS_VERSION_TTL_MS)).resolves.toEqual({
      status: "ok",
      version: 2,
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("remember ghi đè cache sau khi làm mới quyền", async () => {
    const fetcher = vi.fn(async () => ({ status: "ok" as const, version: 9 }));
    const cache = createAccessVersionCache(fetcher);
    cache.remember("u1", { status: "ok", version: 5 }, 0);
    await expect(cache.get("u1", 1)).resolves.toEqual({ status: "ok", version: 5 });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
