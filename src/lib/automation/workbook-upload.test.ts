import { describe, expect, it } from "vitest";
import {
  parseWorkbooksSequentially,
  validateWorkbookUploads,
} from "@/lib/automation/workbook-upload";

function file(name: string, size: number, type = "") {
  return { name, size, type } as File;
}

function statusOf(result: ReturnType<typeof validateWorkbookUploads>) {
  if (result.ok) throw new Error("expected validation failure");
  return result.status;
}

describe("workbook upload validation", () => {
  it("accepts supported files and rejects extension/MIME mismatch", () => {
    expect(validateWorkbookUploads([file("statement.xlsx", 1)])).toEqual({ ok: true });
    expect(validateWorkbookUploads([file("statement.xls", 1, "application/vnd.ms-excel")])).toEqual({ ok: true });
    expect(statusOf(validateWorkbookUploads([file("statement.xlsx", 1, "application/vnd.ms-excel")]))).toBe(400);
    expect(statusOf(validateWorkbookUploads([file("statement.csv", 1)]))).toBe(400);
  });

  it("enforces count, per-file, and aggregate boundaries", () => {
    const limits = { maxFiles: 2, maxFileBytes: 10, maxTotalBytes: 15 } as const;
    expect(validateWorkbookUploads([file("a.xlsx", 10)], limits)).toEqual({ ok: true });
    expect(statusOf(validateWorkbookUploads([file("a.xlsx", 11)], limits))).toBe(413);
    expect(statusOf(validateWorkbookUploads([file("a.xlsx", 8), file("b.xlsx", 8)], limits))).toBe(413);
    expect(statusOf(validateWorkbookUploads([file("a.xlsx", 1), file("b.xlsx", 1), file("c.xlsx", 1)], limits))).toBe(400);
  });

  it("parses sequentially", async () => {
    const order: string[] = [];
    const result = await parseWorkbooksSequentially(
      [file("a.xlsx", 1), file("b.xlsx", 1)],
      async (input) => {
        order.push(`start:${input.name}`);
        await Promise.resolve();
        order.push(`end:${input.name}`);
        return input.name;
      }
    );
    expect(result).toEqual(["a.xlsx", "b.xlsx"]);
    expect(order).toEqual(["start:a.xlsx", "end:a.xlsx", "start:b.xlsx", "end:b.xlsx"]);
  });
});
