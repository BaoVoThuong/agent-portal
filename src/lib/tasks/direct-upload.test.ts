import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({
  readTaskFileInfo: vi.fn(),
  readTaskFileHead: vi.fn(),
  removeTaskFile: vi.fn(),
}));
vi.mock("./storage", () => storage);

import { parseDirectUploadRequest, verifyDirectUpload } from "./direct-upload";
import { TASK_ATTACHMENT_MAX_BYTES } from "./attachments";

const REQUEST_ID = "3f2b8a1e-5c4d-4e6f-8a9b-0c1d2e3f4a5b";
const PDF_HEAD = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]).buffer;

function body(overrides: Record<string, unknown> = {}) {
  return {
    action: "prepare",
    file_name: "Medicaid application.pdf",
    size: 18 * 1024 * 1024,
    client_request_id: REQUEST_ID,
    ...overrides,
  };
}

describe("parseDirectUploadRequest", () => {
  it("accepts a file over the old 4MB cap, up to 50MB", () => {
    const parsed = parseDirectUploadRequest(body());
    expect(parsed).toEqual({
      ok: true,
      upload: {
        action: "prepare",
        fileName: "Medicaid application.pdf",
        size: 18 * 1024 * 1024,
        commentId: null,
        clientRequestId: REQUEST_ID,
        silent: false,
      },
    });
    expect(parseDirectUploadRequest(body({ size: TASK_ATTACHMENT_MAX_BYTES })).ok).toBe(true);
  });

  it("rejects a file over 50MB with the split-it message", () => {
    const parsed = parseDirectUploadRequest(body({ size: TASK_ATTACHMENT_MAX_BYTES + 1 }));
    expect(parsed).toEqual({ ok: false, error: expect.stringContaining("max 50MB") });
  });

  it("requires a request id, because the storage path is built from it", () => {
    expect(parseDirectUploadRequest(body({ client_request_id: undefined })).ok).toBe(false);
    expect(parseDirectUploadRequest(body({ client_request_id: "../../other" })).ok).toBe(false);
  });

  it("normalizes the request id so prepare and finalize build the same path", () => {
    const parsed = parseDirectUploadRequest(body({ client_request_id: REQUEST_ID.toUpperCase() }));
    expect(parsed.ok && parsed.upload.clientRequestId).toBe(REQUEST_ID);
  });

  it("rejects unknown actions, unsupported types, empty and missing files", () => {
    expect(parseDirectUploadRequest(body({ action: "upload" })).ok).toBe(false);
    expect(parseDirectUploadRequest(body({ file_name: "run.exe" }))).toEqual({
      ok: false,
      error: "Unsupported file type.",
    });
    expect(parseDirectUploadRequest(body({ size: 0 })).ok).toBe(false);
    expect(parseDirectUploadRequest(body({ size: "big" })).ok).toBe(false);
    expect(parseDirectUploadRequest(body({ file_name: "" })).ok).toBe(false);
    expect(parseDirectUploadRequest(null).ok).toBe(false);
  });

  it("reads comment id and silent flag", () => {
    const parsed = parseDirectUploadRequest(
      body({ action: "finalize", comment_id: " c-1 ", silent: true }),
    );
    expect(parsed.ok && parsed.upload).toMatchObject({
      action: "finalize",
      commentId: "c-1",
      silent: true,
    });
  });
});

describe("verifyDirectUpload", () => {
  const path = `enrollment/r-1/${REQUEST_ID}-Medicaid_application.pdf`;

  beforeEach(() => {
    storage.readTaskFileInfo.mockReset();
    storage.readTaskFileHead.mockReset();
    storage.removeTaskFile.mockReset().mockResolvedValue(undefined);
  });

  it("accepts a real PDF and reports the size Storage recorded", async () => {
    storage.readTaskFileInfo.mockResolvedValue({ size: 18_000_000, contentType: "application/pdf" });
    storage.readTaskFileHead.mockResolvedValue(PDF_HEAD);
    await expect(verifyDirectUpload(path, "Medicaid application.pdf")).resolves.toEqual({
      ok: true,
      contentType: "application/pdf",
      size: 18_000_000,
    });
    expect(storage.removeTaskFile).not.toHaveBeenCalled();
  });

  it("asks for a retry when nothing was uploaded, without deleting anything", async () => {
    storage.readTaskFileInfo.mockResolvedValue(null);
    await expect(verifyDirectUpload(path, "Medicaid application.pdf")).resolves.toEqual({
      ok: false,
      status: 400,
      error: "The upload did not finish. Please try again.",
    });
    expect(storage.removeTaskFile).not.toHaveBeenCalled();
  });

  it("removes a file whose bytes are not what its name says", async () => {
    storage.readTaskFileInfo.mockResolvedValue({ size: 1000, contentType: "application/pdf" });
    storage.readTaskFileHead.mockResolvedValue(new TextEncoder().encode("MZ not a pdf").buffer);
    const result = await verifyDirectUpload(path, "Medicaid application.pdf");
    expect(result).toEqual({ ok: false, status: 400, error: "File contents do not match the file type." });
    expect(storage.removeTaskFile).toHaveBeenCalledWith(path);
  });

  it("removes a file stored with a different content type", async () => {
    storage.readTaskFileInfo.mockResolvedValue({ size: 1000, contentType: "text/html" });
    const result = await verifyDirectUpload(path, "Medicaid application.pdf");
    expect(result.ok).toBe(false);
    expect(storage.readTaskFileHead).not.toHaveBeenCalled();
    expect(storage.removeTaskFile).toHaveBeenCalledWith(path);
  });

  it("rejects a truncated or different file even when its signature is valid", async () => {
    storage.readTaskFileInfo.mockResolvedValue({ size: 1000, contentType: "application/pdf" });
    const result = await verifyDirectUpload(path, "Medicaid application.pdf", 2000);
    expect(result).toEqual({
      ok: false,
      status: 400,
      error: "Uploaded file size does not match the selected file.",
    });
    expect(storage.readTaskFileHead).not.toHaveBeenCalled();
    expect(storage.removeTaskFile).toHaveBeenCalledWith(path);
  });

  it("tolerates a charset suffix on the recorded type", async () => {
    storage.readTaskFileInfo.mockResolvedValue({ size: 10, contentType: "text/plain;charset=UTF-8" });
    storage.readTaskFileHead.mockResolvedValue(new TextEncoder().encode("hello").buffer);
    await expect(verifyDirectUpload(path, "notes.txt")).resolves.toMatchObject({ ok: true });
  });

  it("removes an over-limit or empty object", async () => {
    storage.readTaskFileInfo.mockResolvedValue({
      size: TASK_ATTACHMENT_MAX_BYTES + 1,
      contentType: "application/pdf",
    });
    expect((await verifyDirectUpload(path, "Medicaid application.pdf")).ok).toBe(false);
    storage.readTaskFileInfo.mockResolvedValue({ size: 0, contentType: "application/pdf" });
    expect((await verifyDirectUpload(path, "Medicaid application.pdf")).ok).toBe(false);
    expect(storage.removeTaskFile).toHaveBeenCalledTimes(2);
  });

  it("keeps the object when Storage itself fails, so a retry can finalize it", async () => {
    storage.readTaskFileInfo.mockRejectedValue(new Error("storage down"));
    expect(await verifyDirectUpload(path, "Medicaid application.pdf")).toMatchObject({
      ok: false,
      status: 500,
    });
    storage.readTaskFileInfo.mockResolvedValue({ size: 1000, contentType: "application/pdf" });
    storage.readTaskFileHead.mockRejectedValue(new Error("storage down"));
    expect(await verifyDirectUpload(path, "Medicaid application.pdf")).toMatchObject({
      ok: false,
      status: 500,
    });
    expect(storage.removeTaskFile).not.toHaveBeenCalled();
  });
});
