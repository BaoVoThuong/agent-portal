import { describe, expect, it } from "vitest";
import {
  AVATAR_MAX_BYTES,
  avatarPathFromUrl,
  validateAvatarFile,
} from "@/lib/people/avatar-storage";

function bytes(...values: number[]): ArrayBuffer {
  return new Uint8Array(values).buffer;
}

/** Chữ ký thật của từng định dạng, đủ dài để qua bước kiểm magic bytes. */
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0);
const JPG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0);
const PDF = bytes(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0, 0, 0, 0);

describe("validateAvatarFile", () => {
  it("accepts a real PNG and a real JPG", () => {
    expect(validateAvatarFile("me.png", PNG)).toMatchObject({
      ok: true,
      contentType: "image/png",
      extension: "png",
    });
    expect(validateAvatarFile("me.jpg", JPG)).toMatchObject({
      ok: true,
      contentType: "image/jpeg",
      extension: "jpg",
    });
  });

  // Cái bẫy thật: đổi tên tệp là việc dễ nhất trên đời, nên kiểu phải suy từ
  // byte chứ không từ phần mở rộng.
  it("rejects a PDF wearing a .jpg extension", () => {
    expect(validateAvatarFile("me.jpg", PDF)).toMatchObject({ ok: false });
  });

  // validateAttachmentFile còn cho cả PDF/CSV/Excel, nên avatar phải lọc lại một
  // lớp nữa — một PDF đặt tên đúng vẫn không có chỗ trong ô avatar.
  it("rejects a correctly-named PDF, which the attachment validator would allow", () => {
    expect(validateAvatarFile("resume.pdf", PDF)).toMatchObject({ ok: false });
  });

  it("rejects an empty file", () => {
    expect(validateAvatarFile("me.png", new ArrayBuffer(0))).toMatchObject({
      ok: false,
    });
  });

  it("rejects anything over the size cap", () => {
    const tooBig = new Uint8Array(AVATAR_MAX_BYTES + 1);
    tooBig.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(validateAvatarFile("me.png", tooBig.buffer)).toMatchObject({
      ok: false,
    });
  });
});

describe("avatarPathFromUrl", () => {
  const base = "https://abc.supabase.co/storage/v1/object/public/avatars/";

  it("recovers the stored path from a public URL", () => {
    expect(avatarPathFromUrl(`${base}9f8e.webp`)).toBe("9f8e.webp");
  });

  it("drops a cache-busting query string", () => {
    expect(avatarPathFromUrl(`${base}9f8e.webp?v=2`)).toBe("9f8e.webp");
  });

  // Cột có thể chứa thứ gì đó do người khác ghi vào. Một chuỗi lạ KHÔNG được
  // phép điều khiển việc xoá tệp.
  it("refuses URLs outside the avatars bucket", () => {
    expect(
      avatarPathFromUrl(
        "https://abc.supabase.co/storage/v1/object/public/task-attachments/x.png",
      ),
    ).toBeNull();
    expect(avatarPathFromUrl("https://evil.example.com/avatars/x.webp")).toBeNull();
  });

  it("returns null for empty input instead of throwing", () => {
    expect(avatarPathFromUrl(null)).toBeNull();
    expect(avatarPathFromUrl(undefined)).toBeNull();
    expect(avatarPathFromUrl("")).toBeNull();
  });
});
