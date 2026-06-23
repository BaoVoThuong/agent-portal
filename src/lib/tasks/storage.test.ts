import { describe, expect, it } from "vitest";
import { sanitizeFileName, buildStoragePath } from "@/lib/tasks/storage";

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
