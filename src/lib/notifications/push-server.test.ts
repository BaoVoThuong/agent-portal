import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("web-push", () => ({
  default: { setVapidDetails: vi.fn(), sendNotification: vi.fn() },
}));

const { supabaseMock } = vi.hoisted(() => ({ supabaseMock: { from: vi.fn() } }));
vi.mock("@/lib/supabase", () => ({ getSupabaseAdmin: () => supabaseMock }));

const { filterActiveAccounts, revokePushSubscriptions } = await import("./push-server");

describe("filterActiveAccounts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("chỉ giữ email của account còn active, không phân biệt hoa thường", async () => {
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: [{ email: "A@x.com" }], error: null }),
    };
    supabaseMock.from.mockReturnValue(query);

    await expect(filterActiveAccounts(["a@x.com", "gone@x.com"])).resolves.toEqual(["a@x.com"]);
    expect(supabaseMock.from).toHaveBeenCalledWith("portal_account");
    expect(query.eq).toHaveBeenCalledWith("is_active", true);
  });

  it("truy vấn lỗi thì không gửi cho ai (chuông vẫn còn)", async () => {
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } }),
    };
    supabaseMock.from.mockReturnValue(query);

    await expect(filterActiveAccounts(["a@x.com"])).resolves.toEqual([]);
  });

  it("danh sách rỗng không truy vấn", async () => {
    await expect(filterActiveAccounts([])).resolves.toEqual([]);
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });
});

describe("revokePushSubscriptions", () => {
  it("xoá mọi subscription theo email đã chuẩn hoá", async () => {
    const query = {
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: null }),
    };
    supabaseMock.from.mockReturnValue(query);

    await revokePushSubscriptions("  Ann@X.com ");

    expect(supabaseMock.from).toHaveBeenCalledWith("push_subscriptions");
    expect(query.eq).toHaveBeenCalledWith("recipient_email", "ann@x.com");
  });
});
