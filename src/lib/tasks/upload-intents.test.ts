import { describe, expect, it } from "vitest";
import { sameUploadIntent, savedAttachmentMatchesIntent, type UploadIntent } from "./upload-intents";

const intent: UploadIntent = {
  kind: "task",
  record_id: "task-1",
  uploaded_by: "user@example.com",
  client_request_id: "request-1",
  comment_id: "comment-1",
  file_name: "photo.png",
  size_bytes: 42,
  storage_path: "tasks/task-1/request-1-photo.png",
  silent: false,
};

describe("durable upload intent", () => {
  it("accepts an exact retry", () => {
    expect(sameUploadIntent(intent, { ...intent })).toBe(true);
  });

  it("refuses to move a signed object to another comment or file", () => {
    expect(sameUploadIntent(intent, { ...intent, comment_id: "comment-2" })).toBe(false);
    expect(sameUploadIntent(intent, { ...intent, file_name: "other.png" })).toBe(false);
    expect(sameUploadIntent(intent, { ...intent, storage_path: "other/path" })).toBe(false);
    expect(sameUploadIntent(intent, { ...intent, size_bytes: 50 })).toBe(false);
  });

  it("does not return an attachment from another request as a successful retry", () => {
    expect(savedAttachmentMatchesIntent({
      storage_path: intent.storage_path, file_name: intent.file_name, size_bytes: 42,
    }, intent)).toBe(true);
    expect(savedAttachmentMatchesIntent({
      storage_path: "tasks/task-1/another-file.png", file_name: intent.file_name, size_bytes: 42,
    }, intent)).toBe(false);
  });
});
