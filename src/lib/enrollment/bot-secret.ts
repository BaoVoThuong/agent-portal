import { createHash, timingSafeEqual } from "node:crypto";

/**
 * So header Authorization với BOT_PORTAL_SECRET mà không lộ độ dài hay vị trí
 * ký tự sai qua thời gian chạy: băm cả hai về 32 byte rồi timingSafeEqual.
 */
export function botSecretMatches(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header || !header.startsWith("Bearer ")) return false;
  const given = createHash("sha256").update(header.slice("Bearer ".length)).digest();
  const expected = createHash("sha256").update(secret).digest();
  return timingSafeEqual(given, expected);
}
