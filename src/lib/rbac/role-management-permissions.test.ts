import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const rows = [
    { key: "settings.access", label: "Settings", group_key: "settings", group_label: "Settings", description: "Legacy", sort_order: 100 },
    { key: "task.work", label: "Tasks - Work", group_key: "tasks", group_label: "Tasks", description: "Work", sort_order: 200 },
  ];
  const query = {
    select: vi.fn(),
    order: vi.fn(),
    then: (resolve: (value: { data: typeof rows; error: null }) => void) =>
      resolve({ data: rows, error: null }),
  };
  query.select.mockReturnValue(query);
  query.order.mockReturnValue(query);
  return { rows, query, from: vi.fn(() => query) };
});

vi.mock("@/lib/supabase", () => ({ getSupabaseAdmin: () => ({ from: mocks.from }) }));

import { fetchPermissions } from "./role-management";

describe("fetchPermissions", () => {
  it("omits Settings even while its legacy database row still exists", async () => {
    await expect(fetchPermissions()).resolves.toMatchObject([{ key: "task.work" }]);
    expect(mocks.from).toHaveBeenCalledWith("permissions");
  });
});
