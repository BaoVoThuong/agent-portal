import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getUserAccessByEmail: vi.fn(),
  getSupabaseAdmin: vi.fn(),
}));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/rbac/access", () => ({ getUserAccessByEmail: mocks.getUserAccessByEmail }));
vi.mock("@/lib/supabase", () => ({ getSupabaseAdmin: mocks.getSupabaseAdmin }));

import { GET as getNotifications } from "@/app/api/tasks/notifications/route";
import { POST as markRead } from "@/app/api/tasks/notifications/read/route";
import { POST as subscribePush } from "@/app/api/notifications/push/subscribe/route";

describe("notification endpoints after account deactivation", () => {
  beforeEach(() => {
    mocks.auth.mockReset().mockResolvedValue({ user: { email: "disabled@x.com", permissions: ["task.manage"] } });
    mocks.getUserAccessByEmail.mockReset().mockResolvedValue({
      userId: "disabled-id", permissions: [], isActive: false, agentId: null,
    });
    mocks.getSupabaseAdmin.mockReset();
  });

  it("rejects list and summary before reading notification tables", async () => {
    for (const url of [
      "http://localhost/api/tasks/notifications",
      "http://localhost/api/tasks/notifications?mode=summary",
    ]) {
      const response = await getNotifications(new Request(url));
      expect(response.status).toBe(401);
    }
    expect(mocks.getSupabaseAdmin).not.toHaveBeenCalled();
  });

  it("rejects read mutations before writing notification tables", async () => {
    const response = await markRead(new Request(
      "http://localhost/api/tasks/notifications/read",
      { method: "POST", body: JSON.stringify({ ids: ["task:old"] }) },
    ));
    expect(response.status).toBe(401);
    expect(mocks.getSupabaseAdmin).not.toHaveBeenCalled();
  });

  it("rejects a new push subscription before storing the endpoint", async () => {
    const response = await subscribePush(new Request(
      "http://localhost/api/notifications/push/subscribe",
      { method: "POST", body: JSON.stringify({
        subscription: { endpoint: "https://push.example/device", keys: { p256dh: "x", auth: "y" } },
      }) },
    ));
    expect(response.status).toBe(401);
    expect(mocks.getSupabaseAdmin).not.toHaveBeenCalled();
  });
});
