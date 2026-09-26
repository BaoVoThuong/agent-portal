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

describe("grantsForRoles (Phase H: chỉ từ định nghĩa role)", () => {
  it("role chưa chuyển sang grant: KHÔNG có grant nào (fail-closed)", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(grantsForRoles([taskCs])).toEqual([]);
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it("role đã có grant tường minh: dùng đúng grant đó, bỏ qua permission cũ", () => {
    const grants = grantsForRoles([{ ...taskCs, grants: ["task.read:assigned"] }]);
    expect(grants).toEqual(["task.read:assigned"]);
  });

  it("role tắt không cấp gì", () => {
    expect(grantsForRoles([{ ...taskCs, grants: ["task.read:assigned"], isActive: false }])).toEqual([]);
  });

  it("super_admin: mọi grant từ code, không phụ thuộc permission hay tên", () => {
    const grants = grantsForRoles([
      { id: "a", name: "Tên gì cũng được", isActive: true, systemKey: "super_admin", permissions: [], grants: null },
    ]);
    expect(hasGrant(grants, "role.manage")).toBe(true);
    expect(hasGrant(grants, "task.read", "all")).toBe(true);
    expect(hasGrant(grants, "notify.task.escalation")).toBe(true);
    // Admin không ở hàng đợi CS.
    expect(hasGrant(grants, "task.queue.member")).toBe(false);
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
