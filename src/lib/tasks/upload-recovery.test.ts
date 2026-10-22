import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  verify: vi.fn(),
  sign: vi.fn(),
  rpc: vi.fn(),
  complete: vi.fn(),
  fail: vi.fn(),
}));
vi.mock("./direct-upload", () => ({ verifyDirectUpload: mock.verify }));
vi.mock("./storage", () => ({ signTaskFile: mock.sign }));
vi.mock("./upload-intents", () => ({ completeUploadIntent: mock.complete, failUploadIntent: mock.fail }));
vi.mock("@/lib/supabase", () => ({ getSupabaseAdmin: () => ({ rpc: mock.rpc }) }));

import { finalizeSavedIntent } from "./upload-recovery";
import type { UploadIntent } from "./upload-intents";

const intent: UploadIntent = {
  kind: "task",
  record_id: "task-1",
  uploaded_by: "author@example.com",
  client_request_id: "request-1",
  comment_id: "comment-1",
  file_name: "photo.png",
  size_bytes: 5,
  storage_path: "tasks/task-1/request-1-photo.png",
  silent: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mock.verify.mockResolvedValue({ ok: true, contentType: "image/png", size: 5 });
  mock.sign.mockResolvedValue("https://signed");
  mock.rpc.mockReturnValue({ single: async () => ({ data: { attachment: { id: "a-1" } }, error: null }) });
  mock.complete.mockResolvedValue(undefined);
  mock.fail.mockResolvedValue(undefined);
});

describe("server-side upload recovery", () => {
  it("attaches a committed object to its original comment and author after reload", async () => {
    expect(await finalizeSavedIntent(intent)).toBe(true);
    expect(mock.verify).toHaveBeenCalledWith(intent.storage_path, "photo.png", 5);
    expect(mock.rpc).toHaveBeenCalledWith("create_task_attachment_atomic", {
      p_task_id: "task-1",
      p_comment_id: "comment-1",
      p_storage_path: intent.storage_path,
      p_file_name: "photo.png",
      p_mime_type: "image/png",
      p_size_bytes: 5,
      p_uploaded_by: "author@example.com",
      p_client_request_id: "request-1",
    });
    expect(mock.complete).toHaveBeenCalledWith(intent);
  });

  it("runs notifications only for the transaction that created the row", async () => {
    mock.rpc.mockReturnValue({ single: async () => ({ data: { was_created: true }, error: null }) });
    const emit = vi.fn().mockResolvedValue(undefined);
    expect(await finalizeSavedIntent(intent, emit)).toBe(true);
    expect(emit).toHaveBeenCalledOnce();
    mock.rpc.mockReturnValue({ single: async () => ({ data: { was_created: false }, error: null }) });
    emit.mockClear();
    expect(await finalizeSavedIntent(intent, emit)).toBe(true);
    expect(emit).not.toHaveBeenCalled();
  });

  it("leaves an invalid object unlinked and retryable", async () => {
    mock.verify.mockResolvedValue({ ok: false, status: 400, error: "Bad file" });
    expect(await finalizeSavedIntent(intent)).toBe(false);
    expect(mock.rpc).not.toHaveBeenCalled();
    expect(mock.complete).not.toHaveBeenCalled();
    expect(mock.fail).toHaveBeenCalledWith(intent, "Bad file");
  });

  it("does not mark an intent complete when the metadata transaction fails", async () => {
    mock.rpc.mockReturnValue({ single: async () => ({ data: null, error: { message: "DB unavailable" } }) });
    await expect(finalizeSavedIntent(intent)).rejects.toThrow("DB unavailable");
    expect(mock.complete).not.toHaveBeenCalled();
  });
});
