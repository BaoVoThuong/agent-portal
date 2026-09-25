import { beforeEach, describe, expect, it, vi } from "vitest";

const { supabaseMock } = vi.hoisted(() => ({ supabaseMock: { from: vi.fn() } }));
vi.mock("@/lib/supabase", () => ({ getSupabaseAdmin: () => supabaseMock }));

const { fetchScopeAgentName } = await import("./agent-identity");

function queryReturning(result: { data: unknown; error: unknown }) {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
  supabaseMock.from.mockReturnValue(query);
  return query;
}

describe("fetchScopeAgentName", () => {
  beforeEach(() => vi.clearAllMocks());

  it("đọc tên từ portal_account và chuẩn hoá như normalizeAgentName", async () => {
    const query = queryReturning({ data: { name: "  ann   strambler " }, error: null });

    await expect(fetchScopeAgentName("ann@x.com")).resolves.toBe("ANN STRAMBLER");
    expect(query.eq).toHaveBeenCalledWith("email", "ann@x.com");
    expect(query.eq).toHaveBeenCalledWith("is_active", true);
  });

  it("không có account active thì trả chuỗi rỗng (không thấy gì)", async () => {
    queryReturning({ data: null, error: null });

    await expect(fetchScopeAgentName("ghost@x.com")).resolves.toBe("");
  });

  it("email rỗng không truy vấn", async () => {
    await expect(fetchScopeAgentName("  ")).resolves.toBe("");
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });

  it("truy vấn lỗi thì ném, không rơi về tên trong phiên", async () => {
    queryReturning({ data: null, error: { message: "boom" } });

    await expect(fetchScopeAgentName("ann@x.com")).rejects.toThrow("boom");
  });
});
