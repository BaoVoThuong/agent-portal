import { describe, expect, it } from "vitest";
import {
  attachmentTooLargeMessage,
  validateAttachmentFile,
} from "./attachments";

describe("attachment validation", () => {
  it("rejects an unsupported extension before upload", () => {
    expect(validateAttachmentFile("customer.exe", new ArrayBuffer(4))).toEqual({
      ok: false,
      error: "Unsupported file type.",
    });
  });

  it("rejects a mislabeled PDF", () => {
    expect(validateAttachmentFile("document.pdf", new ArrayBuffer(8))).toEqual({
      ok: false,
      error: "File contents do not match the file type.",
    });
  });

  it("keeps the size limit in the user-facing validation contract", () => {
    expect(attachmentTooLargeMessage(1024 * 1024)).toBe("File too large (max 1.0MB).");
  });
});
