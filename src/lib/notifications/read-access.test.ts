import { beforeEach, describe, expect, it, vi } from "vitest";

const { taskMock, enrollmentMock, timeOffRows } = vi.hoisted(() => ({
  taskMock: vi.fn(),
  enrollmentMock: vi.fn(),
  timeOffRows: { value: [] as { id: string }[] },
}));

vi.mock("./audience", () => ({
  audienceKey: (id: string, email: string) => `${id}|${email.trim().toLowerCase()}`,
  taskViewersAmong: taskMock,
  enrollmentViewersAmong: enrollmentMock,
}));
vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: () => {
    const chain = {
      select: () => chain,
      in: () => chain,
      eq: () => chain,
      then: (resolve: (value: unknown) => unknown) => resolve({ data: timeOffRows.value, error: null }),
    };
    return { from: () => chain };
  },
}));

const { visibleNotificationEntities } = await import("./read-access");

const refs = [
  { entity_type: "task" as const, entity_id: "t1" },
  { entity_type: "task" as const, entity_id: "t2" },
  { entity_type: "enrollment" as const, entity_id: "r1" },
  { entity_type: "time_off" as const, entity_id: "o1" },
  { entity_type: "time_off" as const, entity_id: "o2" },
];

describe("visibleNotificationEntities", () => {
  beforeEach(() => {
    taskMock.mockResolvedValue(new Set(["t1|me@x.com"]));
    enrollmentMock.mockResolvedValue(new Set());
    timeOffRows.value = [{ id: "o1" }];
  });

  it("chỉ giữ bản ghi còn xem được; đơn nghỉ: của chính mình", async () => {
    const visible = await visibleNotificationEntities(
      { email: "me@x.com", accountId: "acc", grants: ["timeoff.request:*"] },
      refs
    );
    expect([...visible].sort()).toEqual(["task:t1", "time_off:o1"]);
  });

  it("người duyệt nghỉ thấy mọi đơn", async () => {
    const visible = await visibleNotificationEntities(
      { email: "me@x.com", accountId: "acc", grants: ["timeoff.manage:*"] },
      refs
    );
    expect(visible.has("time_off:o2")).toBe(true);
  });

  it("lỗi kiểm quyền: rút gọn tất cả (fail-closed)", async () => {
    taskMock.mockRejectedValue(new Error("boom"));
    const visible = await visibleNotificationEntities(
      { email: "me@x.com", accountId: "acc", grants: [] },
      refs
    );
    expect(visible.size).toBe(0);
  });
});
