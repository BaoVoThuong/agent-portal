import { beforeEach, describe, expect, it, vi } from "vitest";

const { supabaseMock } = vi.hoisted(() => ({ supabaseMock: { from: vi.fn() } }));
vi.mock("@/lib/supabase", () => ({ getSupabaseAdmin: () => supabaseMock }));

const { fetchScopeAgentName } = await import("./agent-identity");

function queryReturning(...results: { data: unknown; error: unknown }[]) {
  const queries = results.map((result) => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  }));
  for (const query of queries) supabaseMock.from.mockReturnValueOnce(query);
  return queries;
}

describe("fetchScopeAgentName", () => {
  beforeEach(() => vi.clearAllMocks());

  it("đọc tên hoa hồng của account active, chuẩn hoá như normalizeAgentName", async () => {
    const [query] = queryReturning({
      data: { id: "a", agent_commission_names: { agent_name: "  ann   strambler " } },
      error: null,
    });

    await expect(fetchScopeAgentName("ann@x.com")).resolves.toBe("ANN STRAMBLER");
    expect(query.select).toHaveBeenCalledWith("id,agent_commission_names(agent_name)");
    expect(query.eq).toHaveBeenCalledWith("email", "ann@x.com");
    expect(query.eq).toHaveBeenCalledWith("is_active", true);
  });

  it("KHÔNG dùng tên hiển thị: account chưa có tên hoa hồng thì trả rỗng (S1)", async () => {
    queryReturning({ data: { id: "a", name: "Ann Strambler", agent_commission_names: null }, error: null });

    await expect(fetchScopeAgentName("ann@x.com")).resolves.toBe("");
  });

  it("không có account active thì trả chuỗi rỗng (không thấy gì)", async () => {
    queryReturning({ data: null, error: null });

    await expect(fetchScopeAgentName("ghost@x.com")).resolves.toBe("");
  });

  it("email rỗng không truy vấn", async () => {
    await expect(fetchScopeAgentName("  ")).resolves.toBe("");
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });

  it("bảng chưa có (rollout chưa chạy): rơi về tên hiển thị như trước", async () => {
    queryReturning(
      { data: null, error: { code: "PGRST200", message: "Could not find a relationship" } },
      { data: { name: " bob " }, error: null }
    );

    await expect(fetchScopeAgentName("bob@x.com")).resolves.toBe("BOB");
  });

  it("lỗi khác thì ném, không rơi về tên hiển thị", async () => {
    queryReturning({ data: null, error: { code: "57014", message: "boom" } });

    await expect(fetchScopeAgentName("ann@x.com")).rejects.toThrow("boom");
  });
});
