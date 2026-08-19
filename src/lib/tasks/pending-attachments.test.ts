import { describe, expect, it } from "vitest";
import {
  addPendingFiles,
  ATTACHMENT_ACCEPT_ATTRIBUTE,
  removePendingFile,
  summariseUploadResults,
  type PendingFile,
} from "./pending-attachments";
import { LIMITS } from "./attachment-limits";

function file(name: string, size = 10): File {
  return new File([new Uint8Array(size)], name, { type: "application/pdf" });
}

function pending(name: string, key = name): PendingFile {
  const value = file(name);
  return { key, name: value.name, size: value.size, file: value };
}

describe("pending task attachments", () => {
  it("accepts a supported file", () => {
    const result = addPendingFiles([], [file("brief.pdf")]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.files[0].name).toBe("brief.pdf");
  });

  it("rejects an unsupported extension before task creation", () => {
    const result = addPendingFiles([], [file("payload.exe")]);
    expect(result).toMatchObject({ ok: false, limit: "type" });
  });

  it("accepts all configured extensions", () => {
    expect(ATTACHMENT_ACCEPT_ATTRIBUTE.split(",")).toEqual(
      expect.arrayContaining([".pdf", ".png", ".xlsx"])
    );
  });

  it("enforces the aggregate limit", () => {
    const existing = [pending("big.pdf")];
    Object.defineProperty(existing[0].file, "size", { value: LIMITS.maxAggregateBytes });
    existing[0].size = LIMITS.maxAggregateBytes;
    const result = addPendingFiles(existing, [file("more.pdf")]);
    expect(result).toMatchObject({ ok: false, limit: "aggregate" });
  });

  it("enforces the count limit", () => {
    const existing = Array.from({ length: LIMITS.maxFiles }, (_, index) => pending(`${index}.pdf`));
    const result = addPendingFiles(existing, [file("extra.pdf")]);
    expect(result).toMatchObject({ ok: false, limit: "count" });
  });

  it("enforces the per-file limit", () => {
    const oversized = file("large.pdf", 1);
    Object.defineProperty(oversized, "size", { value: 15 * 1024 * 1024 + 1 });
    const result = addPendingFiles([], [oversized]);
    expect(result).toMatchObject({ ok: false, limit: "per_file" });
  });

  it("preserves existing files when adding new files", () => {
    const existing = [pending("old.pdf")];
    const result = addPendingFiles(existing, [file("new.pdf")]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.files.map((item) => item.name)).toEqual(["old.pdf", "new.pdf"]);
  });

  it("removes a file immutably", () => {
    const existing = [pending("a.pdf", "a"), pending("b.pdf", "b")];
    expect(removePendingFile(existing, "a").map((item) => item.key)).toEqual(["b"]);
    expect(existing).toHaveLength(2);
  });

  it("summarises one failed upload", () => {
    expect(summariseUploadResults([{ name: "a.pdf", ok: false }])).toContain("1 of 1 file");
  });

  it("summarises multiple failed uploads", () => {
    expect(
      summariseUploadResults([
        { name: "a.pdf", ok: false },
        { name: "b.pdf", ok: true },
        { name: "c.pdf", ok: false },
      ])
    ).toContain("2 of 3 files");
  });

  it("returns no summary when every upload succeeds", () => {
    expect(summariseUploadResults([{ name: "a.pdf", ok: true }])).toBeNull();
  });

  it("keeps file names in a retry summary", () => {
    expect(summariseUploadResults([{ name: "failed.pdf", ok: false }])).toContain("failed.pdf");
  });
});
