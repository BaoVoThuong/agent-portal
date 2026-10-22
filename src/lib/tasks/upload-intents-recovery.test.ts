import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ from: vi.fn(), info: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: () => ({ from: mock.from }),
}));
vi.mock("./storage", () => ({ readTaskFileInfo: mock.info }));

import { recoverUploadIntents, type UploadIntent } from "./upload-intents";

const intent: UploadIntent = {
  kind: "task", record_id: "task-1", uploaded_by: "author@example.com",
  client_request_id: "request-1", comment_id: "comment-1",
  file_name: "photo.png", size_bytes: 5,
  storage_path: "tasks/task-1/request-1-photo.png", silent: false,
};

function selectRows(rows: UploadIntent[]) {
  const query = {
    select: () => query,
    eq: () => query,
    is: () => query,
    lte: () => query,
    order: () => query,
    limit: async () => ({ data: rows, error: null }),
  };
  mock.from.mockReturnValueOnce(query);
}

beforeEach(() => vi.clearAllMocks());

describe("recovery after a browser disappears", () => {
  it("finalizes the server-owned intent when its object has committed", async () => {
    selectRows([intent]);
    mock.info.mockResolvedValue({ size: 5, contentType: "image/png" });
    const finalize = vi.fn().mockResolvedValue(true);
    expect(await recoverUploadIntents("task", "task-1", finalize)).toBe(1);
    expect(finalize).toHaveBeenCalledWith(intent);
  });

  it("defers a partial upload instead of claiming it succeeded", async () => {
    selectRows([intent]);
    mock.info.mockResolvedValue(null);
    let checks = 0;
    const query = {
      update: vi.fn(() => query),
      eq: vi.fn(() => query),
      is: vi.fn(() => ++checks === 1 ? query : Promise.resolve({ error: null })),
    };
    mock.from.mockReturnValueOnce(query);
    const finalize = vi.fn();
    expect(await recoverUploadIntents("task", "task-1", finalize)).toBe(0);
    expect(finalize).not.toHaveBeenCalled();
    expect(query.update).toHaveBeenCalledWith({
      next_check_at: expect.any(String),
    });
  });
});
