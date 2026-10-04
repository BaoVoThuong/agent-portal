import { describe, expect, it, vi } from "vitest";
import { saveUserTableLayout } from "./save-layout";

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("saveUserTableLayout", () => {
  it("saves with the version it was given", async () => {
    const fetchImpl = vi.fn<FetchFn>(async () => reply(200, { updated_at: "v2" }));
    await expect(saveUserTableLayout("lead", [], "v1", fetchImpl)).resolves.toEqual({ ok: true, updatedAt: "v2" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body)).expected_updated_at).toBe("v1");
  });

  // Màn hình chưa đọc được bản đã lưu (expected = null) hoặc tab khác vừa lưu:
  // lấy version mới nhất rồi ghi lại đúng lựa chọn hiện tại.
  it("re-reads the latest version once after a 409 and saves again", async () => {
    const fetchImpl = vi
      .fn<FetchFn>()
      .mockResolvedValueOnce(reply(409, { error: "Layout changed elsewhere. Reload before saving again." }))
      .mockResolvedValueOnce(reply(200, { layout: [], updated_at: "v5" }))
      .mockResolvedValueOnce(reply(200, { updated_at: "v6" }));
    await expect(saveUserTableLayout("lead", [], null, fetchImpl)).resolves.toEqual({ ok: true, updatedAt: "v6" });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(JSON.parse(String(fetchImpl.mock.calls[2][1]?.body)).expected_updated_at).toBe("v5");
  });

  it("gives up after one retry and reports the error", async () => {
    const conflict = { error: "Layout changed elsewhere. Reload before saving again." };
    const fetchImpl = vi
      .fn<FetchFn>()
      .mockResolvedValueOnce(reply(409, conflict))
      .mockResolvedValueOnce(reply(200, { updated_at: "v5" }))
      .mockResolvedValueOnce(reply(409, conflict));
    await expect(saveUserTableLayout("lead", [], "v1", fetchImpl)).resolves.toEqual({ ok: false, error: conflict.error });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});
