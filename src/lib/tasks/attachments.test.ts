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

  // Tệp tải thẳng lên Supabase Storage (không qua Vercel nữa), và hằng này
  // cũng là trần của bucket. Bucket không được vượt "Global file size limit"
  // của project — gói Free tối đa 50MB. Nâng quá thì updateBucket lỗi và mọi
  // lượt upload đều hỏng, nên phải nâng cả trần chung trước.
  it("fits within Supabase's 50MB global upload cap", () => {
    expect(TASK_ATTACHMENT_MAX_BYTES).toBeLessThanOrEqual(50 * 1024 * 1024);
  });
});
