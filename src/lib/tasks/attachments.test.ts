import { describe, expect, it } from "vitest";
import {
  attachmentTooLargeMessage,
  TASK_ATTACHMENT_MAX_BYTES,
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
    // Bảo người dùng CHIA tệp ra, không bảo nén nhỏ lại.
    expect(attachmentTooLargeMessage(1024 * 1024)).toBe(
      "File is too large (max 1MB). Please break it down into smaller files and upload them separately.",
    );
  });

  // Tệp đi xuyên qua API route, và Vercel chặn mọi request body trên 4.5MB
  // trước khi tới code — người dùng chỉ thấy "upload failed" và thử lại mãi.
  // Trần của app phải thấp hơn để câu báo "chia nhỏ" hiện ra trước.
  it("stays under Vercel's 4.5MB request body limit", () => {
    expect(TASK_ATTACHMENT_MAX_BYTES).toBeLessThan(4.5 * 1024 * 1024);
  });
});
