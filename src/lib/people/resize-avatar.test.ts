import { describe, expect, it } from "vitest";
import { avatarUploadFileName } from "@/lib/people/resize-avatar";
import { validateAvatarFile } from "@/lib/people/avatar-storage";

/** Chữ ký byte thật của một PNG — thứ Safari trả về khi được yêu cầu webp. */
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
]).buffer;

describe("avatarUploadFileName", () => {
  it("names each blob type with the extension the server expects", () => {
    expect(avatarUploadFileName("image/webp")).toBe("avatar.webp");
    expect(avatarUploadFileName("image/jpeg")).toBe("avatar.jpg");
    expect(avatarUploadFileName("image/png")).toBe("avatar.png");
  });

  it("falls back to .png for an empty or unknown blob type", () => {
    expect(avatarUploadFileName("")).toBe("avatar.png");
  });

  // Lỗi thật trên Safari: xin webp nhưng nhận PNG. Hai dòng dưới khoá cả nguyên
  // nhân lẫn cách sửa ở cùng một chỗ.
  it("was broken on Safari: a PNG blob named .webp is rejected by the server", () => {
    expect(validateAvatarFile("avatar.webp", PNG_BYTES)).toMatchObject({ ok: false });
  });

  it("is fixed: naming by the real blob type lets the same PNG through", () => {
    expect(
      validateAvatarFile(avatarUploadFileName("image/png"), PNG_BYTES),
    ).toMatchObject({ ok: true, contentType: "image/png" });
  });
});
