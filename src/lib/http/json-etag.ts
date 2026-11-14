import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

/**
 * ETag cho các route danh sách bị poll liên tục (Enrollment, Task Board).
 *
 * Mỗi lần poll trước đây trả lại nguyên danh sách (~120–200 KB) dù không có gì
 * đổi, và Vercel tính tiền từng byte server gửi ra (Fast Origin Transfer). Nay
 * server vẫn đọc DB như cũ, nhưng nếu client gửi lên đúng ETag của danh sách
 * hiện tại thì trả 304 không body. Client giữ bản cũ (xem `etag-fetch.ts`).
 */

export function etagFor(json: string): string {
  return `"${createHash("sha1").update(json).digest("base64url")}"`;
}

// CDN nén response có thể đổi ETag mạnh thành yếu (`W/"…"`); so phần trong ngoặc.
function opaque(tag: string): string {
  return tag.trim().replace(/^W\//, "");
}

export function ifNoneMatchHits(header: string | null, etag: string): boolean {
  if (!header) return false;
  const target = opaque(etag);
  return header.split(",").some((tag) => opaque(tag) === target);
}

export function jsonWithEtag(request: Request, body: unknown): NextResponse {
  const json = JSON.stringify(body);
  const etag = etagFor(json);
  // private + no-store: dữ liệu khách hàng theo quyền từng người, không để CDN
  // hay đĩa trình duyệt giữ; client tự gửi If-None-Match từ bản trong bộ nhớ.
  const headers = { ETag: etag, "Cache-Control": "private, no-store" };
  if (ifNoneMatchHits(request.headers.get("if-none-match"), etag)) {
    return new NextResponse(null, { status: 304, headers });
  }
  return new NextResponse(json, {
    status: 200,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}
