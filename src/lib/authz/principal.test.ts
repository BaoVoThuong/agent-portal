import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: () => {
    throw new Error("test này không được chạm database");
  },
}));
vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));

const { clearRoleCache, grantsForRoles, loadRoleDefinitions, ROLE_CACHE_TTL_MS } = await import(
  "./principal"
);
const { hasGrant } = await import("./grants");

const taskCs = {
  id: "r-cs",
  name: "Task CS",
  isActive: true,
  permissions: ["task.work", "settings.access"],
  grants: null,
};

describe("grantsForRoles", () => {
  it("role chưa chuyển: suy tương thích từ permission + tên role", () => {
    const grants = grantsForRoles([taskCs], "agent");
    expect(hasGrant(grants, "task.read", "shared_queue")).toBe(true);
    expect(hasGrant(grants, "task.read", "all")).toBe(false);
  });

  it("role đã có grant tường minh: dùng đúng grant đó, bỏ qua permission cũ", () => {
    const grants = grantsForRoles([{ ...taskCs, grants: ["task.read:assigned"] }], "agent");
    expect(grants).toEqual(["task.read:assigned"]);
  });

  it("role tắt không cấp gì", () => {
    expect(grantsForRoles([{ ...taskCs, isActive: false }], "agent")).toEqual([]);
  });

  it("legacy admin không role vẫn nhận quyền theo tài khoản (lead, leo thang)", () => {
    const grants = grantsForRoles([], "admin");
    expect(hasGrant(grants, "lead.read", "all")).toBe(true);
    expect(hasGrant(grants, "notify.task.escalation")).toBe(true);
    expect(hasGrant(grants, "task.read")).toBe(false);
  });
});

describe("loadRoleDefinitions", () => {
  beforeEach(() => clearRoleCache());

  it("chỉ tải role chưa có trong cache, và tải lại khi hết TTL", async () => {
    const fetcher = vi.fn(async (ids: readonly string[]) => new Map(ids.map((id) => [id, { ...taskCs, id }])));

    await loadRoleDefinitions(["a", "b"], 0, fetcher);
    await loadRoleDefinitions(["a", "b"], 1_000, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);

    await loadRoleDefinitions(["a"], ROLE_CACHE_TTL_MS + 1, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenLastCalledWith(["a"]);
  });

  it("role không tồn tại được nhớ và không trả về", async () => {
    const fetcher = vi.fn(async () => new Map());
    await expect(loadRoleDefinitions(["gone"], 0, fetcher)).resolves.toEqual([]);
    await loadRoleDefinitions(["gone"], 10, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
