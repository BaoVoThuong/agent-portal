import { describe, expect, it } from "vitest";
import { sanitizeFileName, buildStoragePath } from "@/lib/tasks/storage";
import { validateAttachmentFile } from "@/lib/tasks/attachments";

describe("sanitizeFileName", () => {
  it("keeps word chars, dot and dash; replaces the rest with _", () => {
    expect(sanitizeFileName("My File (1).pdf")).toBe("My_File_1_.pdf");
  });
  it("collapses runs of unsafe chars to a single _", () => {
    expect(sanitizeFileName("a   b///c.png")).toBe("a_b_c.png");
  });
  it("falls back to 'file' for empty/space-only names", () => {
    expect(sanitizeFileName("   ")).toBe("file");
  });
});

describe("buildStoragePath", () => {
  it("nests under tasks/{taskId}/ and ends with the sanitized name", () => {
    const p = buildStoragePath("task-1", "Report 2.pdf");
    expect(p.startsWith("tasks/task-1/")).toBe(true);
    expect(p.endsWith("Report_2.pdf")).toBe(true);
  });
});

describe("validateAttachmentFile", () => {
  it("accepts files whose signature matches the extension", () => {
    const data = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]).buffer;
    expect(validateAttachmentFile("doc.pdf", data)).toEqual({
      ok: true,
      contentType: "application/pdf",
    });
  });

  it("rejects spoofed binary extensions", () => {
    const data = new TextEncoder().encode("not a pdf").buffer;
    expect(validateAttachmentFile("doc.pdf", data).ok).toBe(false);
  });

  it("rejects html disguised as text", () => {
    const data = new TextEncoder().encode("<script>alert(1)</script>").buffer;
    expect(validateAttachmentFile("notes.csv", data).ok).toBe(false);
  });

  it("rejects unknown extensions", () => {
    const data = new TextEncoder().encode("hello").buffer;
    expect(validateAttachmentFile("run.exe", data).ok).toBe(false);
  });
});
