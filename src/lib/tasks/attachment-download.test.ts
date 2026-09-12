import { describe, expect, it } from "vitest";
import { toAttachmentDownloadUrl } from "@/lib/tasks/attachment-download";

const SIGNED =
  "https://abc.supabase.co/storage/v1/object/sign/task-files/tasks/1/x.png?token=eyJhbGc.SIG";

describe("toAttachmentDownloadUrl", () => {
  it("adds the download param without destroying the existing token", () => {
    const result = new URL(toAttachmentDownloadUrl(SIGNED, "hoa-don.png"));
    expect(result.searchParams.get("token")).toBe("eyJhbGc.SIG");
    expect(result.searchParams.get("download")).toBe("hoa-don.png");
  });

  it("keeps the origin and path untouched", () => {
    const result = new URL(toAttachmentDownloadUrl(SIGNED, "x.png"));
    expect(result.origin).toBe("https://abc.supabase.co");
    expect(result.pathname).toBe("/storage/v1/object/sign/task-files/tasks/1/x.png");
  });

  it("escapes names with spaces and unicode so the query stays valid", () => {
    const result = toAttachmentDownloadUrl(SIGNED, "hợp đồng & phụ lục.pdf");
    expect(result).not.toContain(" ");
    expect(new URL(result).searchParams.get("download")).toBe(
      "hợp đồng & phụ lục.pdf",
    );
  });

  it("replaces an existing download param instead of adding a second one", () => {
    const once = toAttachmentDownloadUrl(SIGNED, "a.png");
    const twice = toAttachmentDownloadUrl(once, "b.png");
    expect(new URL(twice).searchParams.getAll("download")).toEqual(["b.png"]);
  });

  // Falling back to the original URL keeps the old (wrong) behaviour, which is
  // still far better than handing the anchor an empty or broken href.
  it("returns the input unchanged when it is not a parseable absolute URL", () => {
    expect(toAttachmentDownloadUrl("/local/path.png", "x.png")).toBe("/local/path.png");
    expect(toAttachmentDownloadUrl("", "x.png")).toBe("");
  });
});
