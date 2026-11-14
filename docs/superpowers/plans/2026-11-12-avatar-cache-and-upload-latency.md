# Avatar cache và thời gian upload đính kèm — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cho avatar hiện ngay từ cache trình duyệt, bỏ khoảng 900 lượt hỏi lại server mỗi ngày. Đồng thời cắt 0,15–0,3 giây mỗi lượt upload đính kèm mà không đụng tới cơ chế an toàn của luồng 50 MiB.

**Architecture:**
- **Avatar:** ảnh mới được ghi với `Cache-Control: max-age=31536000`. Ảnh cũ được ghi lại một lần bằng script chạy tay.
- **Upload:** bước kiểm file sau upload được tách làm hai.
  - Phần **đọc** (kích thước, loại, 512 byte đầu) chạy song song và bắt đầu ngay khi route biết đường dẫn.
  - Phần **phán quyết** (có thể xoá file) giữ đúng chỗ cũ, sau khi kiểm quyền và kiểm upload intent.
  - Trình duyệt mở sẵn kết nối tới Storage trong lúc chờ bước prepare.

**Tech Stack:** Next.js 16.2 App Router route handlers, `@supabase/supabase-js` 2.105 (storage-js 2.105.1), `tus-js-client` 4.3, Vitest 2 (`environment: "node"`), script Node `.mjs` chạy tay.

## Global Constraints

- **Không đổi giao thức 50 MiB:** prepare → TUS → finalize, bảng `attachment_upload_intents`, confirmation probe, recovery khi mở detail (xem `docs/attachment-50mb-rebuild.md`). Plan này **không** chuyển TUS sang PUT.
- **Chỗ xoá file:** bước xoá file sai (`removeTaskFile`) chỉ được chạy SAU khi người gọi đã qua kiểm quyền và `requireUploadIntent`, đúng như bây giờ. Gửi một kích thước sai là đủ làm file bị xoá, nên tuyệt đối không được để bước phán quyết chạy trước khi kiểm quyền.
- **Bucket avatar:** `avatars` là bucket công khai. Mỗi lần đổi ảnh là một UUID mới (`uploadAvatar`). Giữ nguyên.
- **Region:** Supabase ở `ap-southeast-2` (Sydney), Vercel function ở `syd1` (`vercel.json`: `"regions": ["syd1"]`). Không đổi.
- **Đo đạc:** không bật `ROUTE_PERF_LOGS` trên production. Chỉ đo bằng log gateway của Supabase và bảng `attachment_upload_intents`.
- **Script ghi production:** chỉ chạy `--write` khi user đã duyệt, và luôn chạy thử (không `--write`) trước.
- **Quy trình:**
  - Mỗi commit một việc. Ghi `changelog.md` cho mọi thay đổi logic.
  - Không commit file plan này trước khi có code.
  - Không push khi user chưa bảo.
- **Lệnh kiểm** (shell của Claude Code có thể thiếu PATH, khi đó thêm `export PATH=/opt/homebrew/bin:$PATH`):
  - `npx tsc --noEmit -p .`
  - `npx vitest run <file>` (cả bộ: `npx vitest run`)
  - `npx eslint <file…>`

---

## 1. Kết quả điều tra (12/11/2026, log 24–48 giờ tính tới 18:30 VN)

### 1.1 Avatar: trình duyệt phải hỏi lại server mỗi giờ cho từng ảnh

Log gateway Supabase 24 giờ, đường dẫn `/storage/v1/object/public/avatars/%`:

| Chỉ số | Giá trị |
|---|---|
| Request | 938 (cho đúng 14 ảnh, từ 45 IP, 410 cặp ảnh × IP) |
| `304 Not Modified`, `cf-cache-status: HIT` | 862 (92%), p50 208 ms, p95 497 ms |
| `200`, HIT | 69, p50 131 ms |
| Theo vùng (p50 / p95) | VN-HKG 258/513 ms · VN-SIN 250/439 · VN-SGN 631/1.215 · US-LAX 155/246 · US-IAH 126/176 |
| Query string | không request nào có (không có cache-busting) |

Header thật khi GET một ảnh (`curl -s -D - -o /dev/null https://cxdgupxfhvtsitmcmpiw.supabase.co/storage/v1/object/public/avatars/1bb9d270-2e32-417b-a7cf-b7249de38d7f.webp`):

```
cf-cache-status: HIT
cache-control: public, max-age=3600
etag: "c92ae2a8dfb58dbc10522771f186f7a9"
```

Một request `HEAD` sẽ ra `private, no-cache` vì đi vòng qua CDN. Đó không phải header thật mà trình duyệt nhận.

Trong `storage.objects`, cả 15 ảnh của bucket `avatars` đều có `metadata->>'cacheControl' = 'max-age=3600'`.

**Nguyên nhân.** `src/lib/people/avatar-storage.ts:134-136` tải ảnh lên mà không truyền `cacheControl`:

```ts
  const { error } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(path, data, { contentType, upsert: false });
```

storage-js 2.105.1 lấy mặc định `cacheControl: "3600"` (`node_modules/@supabase/storage-js/dist/index.mjs`: `M={cacheControl:'3600',…}`). Với body là `ArrayBuffer`, nó gửi header `cache-control: max-age=${options.cacheControl}` (dòng 597). Hết một giờ, mỗi `<img>` avatar (`src/app/(authed)/tasks/_components/board-ui.tsx:210`, thẻ `<img loading="lazy">` thường) phải chờ một lượt 304 rồi mới hiện. Ở VN, mỗi lượt như vậy mất 250–630 ms.

**Vì sao cache một năm là an toàn.** URL avatar không bao giờ trỏ sang nội dung khác:
- Mỗi lần đổi ảnh ghi vào UUID mới: `const path = \`${globalThis.crypto.randomUUID()}.${extension}\`` (`avatar-storage.ts:132`). Chú thích của hàm ghi rõ: "Mỗi lần gọi ghi vào một UUID MỚI, không ghi đè đường dẫn cũ".
- `portal_account.avatar_url` được trỏ sang URL mới, còn ảnh cũ bị xoá (`deleteAvatarByUrl` trong `src/app/api/settings/avatar/route.ts:95,102,122`).
- Đây là nơi duy nhất gọi `uploadAvatar`.

**Sau khi sửa:** trình duyệt dùng ảnh trong cache mà không hỏi lại. Request avatar sẽ giảm từ khoảng 940 xuống dưới khoảng 100 mỗi ngày, chỉ còn máy mới hoặc cache bị xoá.

### 1.2 Upload: không phải "chậm lúc bắt đầu", mà là khoảng 3 giây cho ba chặng đi-về Sydney

Báo cáo ngày 12/11 nói "phải chờ vài giây mới bắt đầu chạy" là **chưa đúng**. Không có request `PATCH` nào, tức không file nào trên 6 MiB, nên mọi file đều lên trọn trong **một** request `POST /storage/v1/upload/resumable/sign`. Lý do là `uploadDataDuringCreation: true` trong `src/lib/tasks/tus-upload.ts:41`. Con số p95 2,8 giây của POST đó là thời gian gửi cả file, không phải thời gian chờ để bắt đầu.

Luồng một lượt upload (`src/lib/tasks/upload-attachment.ts:195-330`):
1. `POST <route>/attachments {action:"prepare"}`: route kiểm quyền, ghi intent, kiểm bucket, xin token ký.
2. Trình duyệt gửi file thẳng tới `https://<ref>.storage.supabase.co/storage/v1/upload/resumable/sign` (TUS).
3. `POST <route>/attachments {action:"finalize"}`: route kiểm file trong Storage rồi ghi dòng đính kèm.

Ghép 173/187 intent 24 giờ (`created_at` = lúc prepare ghi intent, `completed_at` = lúc finalize xong) với request TUS trong log gateway theo thời gian:

| Chặng | p50 | p95 | Ghi chú |
|---|---|---|---|
| prepare ghi intent → POST tới Storage | 520 ms | — | US 877 ms, VN 370 ms |
| POST TUS (gửi cả file) | 1.362 ms | 2.861 ms | File < 200 KB vẫn mất 1.146 ms. US 1.561, VN 1.119 |
| POST xong → finalize ghi xong | 898 ms | 1.232 ms | Gần như không đổi theo kích thước |
| **Tổng (intent → completed)** | **2,94 s** | **5,30 s** | File < 200 KB: 2,64 s / 3,59 s |

Phía server:
- **Thời gian route** (Vercel, 2 ngày):
  - `/api/enrollment/[id]/attachments`: function p50 575 ms / p95 1.046 ms, TTFB p50 547 / p95 912 ms (721 lượt gọi).
  - `/api/tasks/[id]/attachments`: TTFB p50 451 / p95 893 ms.
- **Các lệnh gọi Storage từ server** (log gateway, user-agent `node`, 24 giờ):

| Lệnh | Lượt | p50 | p95 | Bước |
|---|---|---|---|---|
| `GET /storage/v1/object/sign/…` (đọc 512 byte đầu) | 190 | **310 ms** | 418 ms | finalize (`readTaskFileHead`) |
| `GET /storage/v1/object/info/…` | 230 | 18 ms | 109 ms | finalize + probe |
| `POST /storage/v1/object/upload/sign/…` | 187 | 19 ms | 72 ms | prepare |
| `GET /storage/v1/bucket/…` | 187 | 14 ms | 80 ms | prepare (`verifyTaskBucket`) |

- **Preflight CORS:** Storage trả `access-control-max-age: 3600`, khớp với chỉ 67 OPTIONS cho 174 POST. Preflight không phải chỗ tốn thời gian.
- **Không có upload nào bị xếp hàng:** comment Task chạy song song bằng worker (`CommentThread.tsx:1164-1180`), Enrollment dùng `runBackgroundUploads`. Upload chạy nền nên không chặn người dùng gõ tiếp.

**Plan này cắt được gì:**
1. **finalize:** `verifyDirectUpload` (`src/lib/tasks/direct-upload.ts:135-180`) đọc `info` rồi mới đọc 512 byte (310 ms), và chỉ bắt đầu sau 2–3 truy vấn kiểm quyền/intent. Đọc song song và bắt đầu sớm cắt được khoảng 80–150 ms mỗi finalize.
2. **Kết nối tới Storage:** trình duyệt chỉ mở kết nối DNS/TCP/TLS tới `<ref>.storage.supabase.co` khi đã cầm được token. Mở sẵn trong lúc chờ prepare (khoảng 0,5–0,9 giây) cắt được khoảng 50–200 ms khi chưa có kết nối ấm.

**Plan này không cắt được:** phần còn lại là ba chặng đi-về, mỗi chặng đều phải tới Sydney (Supabase và function `syd1`), trong khi người dùng ở Mỹ và Việt Nam. Kỳ vọng thực tế: p50 tổng từ khoảng 2,9 giây xuống khoảng 2,6–2,75 giây.

### 1.3 Không làm trong plan này (và lý do)

- **Dùng PUT thay TUS cho file ≤ 6 MiB:**
  - Có thể bỏ được một phần trong 1,1 giây của POST TUS. Nhưng chưa đo được: 7 ngày log không còn request PUT nào để so.
  - Lượt dùng `uploadToSignedUrl` trước 24/10 từng làm mất đính kèm, phải rollback (`docs/attachment-50mb-rebuild.md`, "Sự cố và bài học", mục 2).
  - Chỉ nên mở plan riêng khi user muốn đổi tiếp và chấp nhận chạy canary có đo.
- **Báo "đã xong" trước khi finalize xong:** đi ngược bài học "tách hai công đoạn" trong cùng tài liệu đó.
- **Chuyển region Supabase:** di chuyển toàn bộ dữ liệu, ngoài tầm plan này.
- **Phát hiện thêm, nên làm plan riêng nếu muốn:** người dùng tải/xem file đính kèm qua signed URL 774 lượt/ngày, p50 868 ms.
  - Mỗi lần mở chi tiết, URL được ký lại (`signAttachmentsSafely` → `createSignedUrls`). Token mới nằm trong query string nên trình duyệt không dùng lại được cache: ảnh trong comment bị tải lại mỗi lần mở.
  - Server ký 9.509 lượt/ngày, p50 13 ms.

---

## 2. Cấu trúc file

| File | Việc | Task |
|---|---|---|
| `src/lib/people/avatar-storage.ts` | Thêm hằng `AVATAR_CACHE_SECONDS`, truyền `cacheControl` khi upload | A1 |
| `src/lib/people/avatar-upload.test.ts` (mới) | Test `uploadAvatar` gửi cache một năm | A1 |
| `scripts/lib/avatar-cache.mjs` (mới) | Hàm thuần: đọc `max-age`, chọn ảnh cần ghi lại | A2 |
| `scripts/lib/avatar-cache.test.mjs` (mới) | Test hai hàm trên (vitest đã include `scripts/**/*.test.mjs`) | A2 |
| `scripts/avatar-cache-control.mjs` (mới) | Script chạy tay: chạy thử / `--write` ghi lại ảnh cũ | A2 |
| `src/lib/tasks/direct-upload.ts` | Tách `inspectDirectUpload` (chỉ đọc) và `judgeDirectUpload` (phán quyết + xoá) | B1 |
| `src/lib/tasks/direct-upload.test.ts` | Test cho hai hàm mới, sửa 2 test cũ | B1 |
| `src/app/api/enrollment/[id]/attachments/route.ts` | finalize: bắt đầu đọc sớm, phán quyết đúng chỗ cũ | B2 |
| `src/app/api/tasks/[id]/attachments/route.ts` | Như trên | B2 |
| `src/app/api/leads/[id]/attachments/route.ts` | Như trên | B2 |
| `src/lib/tasks/storage-host.ts` (mới) | `storageUploadOrigin`, `preconnectStorageUploads` | B3 |
| `src/lib/tasks/storage-host.test.ts` (mới) | Test hai hàm trên | B3 |
| `src/lib/tasks/tus-upload.ts` | Dùng `storageUploadOrigin` thay đoạn đổi hostname tự viết | B3 |
| `src/lib/tasks/upload-attachment.ts` | Gọi `preconnectStorageUploads()` ngay trước prepare | B3 |
| `changelog.md` | Một entry mỗi task có đổi logic | A1, A2, B1+B2, B3 |

Hai phần A và B độc lập, ship riêng được. **Thứ tự đề xuất:** A1 → A2 (thắng rõ, rủi ro thấp) → B1 → B2 → B3 → C1.

---

## Phase A — Avatar

### Task A1: Ảnh avatar mới được cache một năm

**Files:**
- Modify: `src/lib/people/avatar-storage.ts:17` (thêm hằng) và `:134-136` (lệnh upload)
- Create: `src/lib/people/avatar-upload.test.ts`
- Modify: `changelog.md`

**Interfaces:**
- Produces: `export const AVATAR_CACHE_SECONDS = 31_536_000` trong `src/lib/people/avatar-storage.ts`. Task A2 dùng **cùng giá trị** (viết lại trong `.mjs`, vì script không import được TS).

- [ ] **Step 1: Viết test hỏng**

Tạo `src/lib/people/avatar-upload.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const supabase = vi.hoisted(() => {
  const upload = vi.fn();
  const bucket = {
    upload,
    getPublicUrl: vi.fn((path: string) => ({
      data: { publicUrl: `https://project.supabase.co/storage/v1/object/public/avatars/${path}` },
    })),
  };
  return {
    upload,
    client: {
      storage: {
        getBucket: vi.fn(async () => ({ data: { id: "avatars" }, error: null })),
        createBucket: vi.fn(async () => ({ data: null, error: null })),
        updateBucket: vi.fn(async () => ({ data: null, error: null })),
        from: vi.fn(() => bucket),
      },
    },
  };
});
vi.mock("@/lib/supabase", () => ({ getSupabaseAdmin: () => supabase.client }));

import { AVATAR_CACHE_SECONDS, uploadAvatar } from "./avatar-storage";

describe("uploadAvatar", () => {
  beforeEach(() => {
    supabase.upload.mockReset().mockResolvedValue({ data: { path: "x" }, error: null });
  });

  // Mỗi lần đổi ảnh là một UUID mới, nên nội dung sau một URL không bao giờ
  // đổi. Cache một giờ (mặc định của supabase-js) chỉ khiến mỗi <img> phải chờ
  // một lượt 304 mỗi giờ: 862/938 request avatar ngày 12/11 là như vậy.
  it("stores a new avatar under a fresh UUID with a one-year cache", async () => {
    const result = await uploadAvatar(new Uint8Array([1, 2, 3]).buffer, "image/webp", "webp");

    expect(AVATAR_CACHE_SECONDS).toBe(31_536_000);
    expect(supabase.upload).toHaveBeenCalledWith(
      expect.stringMatching(/^[0-9a-f-]{36}\.webp$/),
      expect.any(ArrayBuffer),
      { contentType: "image/webp", upsert: false, cacheControl: "31536000" },
    );
    expect(result.publicUrl).toContain("/storage/v1/object/public/avatars/");
  });
});
```

- [ ] **Step 2: Chạy để thấy hỏng**

Run: `npx vitest run src/lib/people/avatar-upload.test.ts`
Expected: FAIL. `AVATAR_CACHE_SECONDS` chưa được export (undefined), và `upload` được gọi với `{ contentType: "image/webp", upsert: false }`, thiếu `cacheControl`.

- [ ] **Step 3: Sửa code**

Trong `src/lib/people/avatar-storage.ts`, ngay dưới `export const AVATAR_BUCKET = "avatars";`, thêm:

```ts
/**
 * Một URL avatar không bao giờ đổi nội dung: mỗi lần tải lên là một UUID mới
 * (xem `uploadAvatar`), ảnh cũ bị xoá. Nên trình duyệt được giữ ảnh một năm.
 *
 * Mặc định của supabase-js là 3600 giây. Hết một giờ, mỗi ảnh trên mỗi trang
 * phải chờ một lượt 304 mới hiện — 92% request avatar ngày 12/11/2026, mỗi
 * lượt 250–630 ms ở Việt Nam. `scripts/avatar-cache-control.mjs` ghi lại các
 * ảnh tải lên trước thay đổi này với cùng giá trị.
 */
export const AVATAR_CACHE_SECONDS = 31_536_000;
```

Và đổi lệnh upload trong `uploadAvatar` (đoạn `avatar-storage.ts:134-136`) thành:

```ts
  const { error } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(path, data, {
      contentType,
      upsert: false,
      cacheControl: String(AVATAR_CACHE_SECONDS),
    });
```

- [ ] **Step 4: Chạy lại test**

Run: `npx vitest run src/lib/people/avatar-upload.test.ts src/lib/people/avatar-storage.test.ts`
Expected: PASS, cả hai file.

- [ ] **Step 5: Ghi changelog**

Thêm lên đầu `changelog.md`, ngay dưới dòng "Mới nhất ở trên cùng…":

```markdown
## 2026-11-12 — Avatar: ảnh mới được trình duyệt giữ một năm

- Trước: `uploadAvatar` không đặt `cacheControl`, supabase-js mặc định `max-age=3600`. Hết một giờ, mỗi avatar trên mỗi trang phải chờ một lượt 304 mới hiện (862/938 request avatar trong 24 giờ, 250–630 ms mỗi lượt ở VN).
- Giờ: ảnh mới ghi với `cacheControl` 31.536.000 giây. An toàn vì mỗi lần đổi ảnh là một UUID mới và ảnh cũ bị xoá, nên một URL không bao giờ đổi nội dung.
```

- [ ] **Step 6: Typecheck, lint, commit**

```bash
npx tsc --noEmit -p .
npx eslint src/lib/people/avatar-storage.ts src/lib/people/avatar-upload.test.ts
git add src/lib/people/avatar-storage.ts src/lib/people/avatar-upload.test.ts changelog.md
git commit -m "perf(avatar): cache new avatars for a year"
```

---

### Task A2: Ghi lại các ảnh avatar cũ với cache một năm

**Files:**
- Create: `scripts/lib/avatar-cache.mjs`
- Create: `scripts/lib/avatar-cache.test.mjs`
- Create: `scripts/avatar-cache-control.mjs`
- Modify: `changelog.md`

**Interfaces:**
- Consumes: giá trị `31536000` của Task A1. Script `.mjs` không import được TS nên viết lại hằng này.
- Produces: `maxAgeSeconds(cacheControl: unknown): number | null` và `avatarsToRecache(objects: Array<{ id: string | null; name: string; metadata?: { cacheControl?: string; mimetype?: string } | null }>): typeof objects`.

- [ ] **Step 1: Viết test hỏng**

Tạo `scripts/lib/avatar-cache.test.mjs`:

```js
import { describe, expect, it } from "vitest";
import { AVATAR_CACHE_SECONDS, avatarsToRecache, maxAgeSeconds } from "./avatar-cache.mjs";

describe("maxAgeSeconds", () => {
  it("reads the seconds Storage recorded for an object", () => {
    expect(maxAgeSeconds("max-age=3600")).toBe(3600);
    expect(maxAgeSeconds("public, max-age=31536000")).toBe(31536000);
    expect(maxAgeSeconds(undefined)).toBeNull();
    expect(maxAgeSeconds("no-cache")).toBeNull();
  });
});

describe("avatarsToRecache", () => {
  it("picks files still on a shorter cache, skips folders and files already done", () => {
    const objects = [
      { id: "1", name: "a.webp", metadata: { cacheControl: "max-age=3600", mimetype: "image/webp" } },
      { id: "2", name: "b.webp", metadata: { cacheControl: `max-age=${AVATAR_CACHE_SECONDS}` } },
      { id: null, name: "folder", metadata: null },
      { id: "3", name: "c.png", metadata: {} },
    ];
    expect(avatarsToRecache(objects).map((object) => object.name)).toEqual(["a.webp", "c.png"]);
  });
});
```

- [ ] **Step 2: Chạy để thấy hỏng**

Run: `npx vitest run scripts/lib/avatar-cache.test.mjs`
Expected: FAIL với "Failed to load url ./avatar-cache.mjs" (file chưa có).

- [ ] **Step 3: Viết hàm thuần**

Tạo `scripts/lib/avatar-cache.mjs`:

```js
/**
 * Phải bằng `AVATAR_CACHE_SECONDS` trong src/lib/people/avatar-storage.ts.
 * Script .mjs không import được file TS nên viết lại ở đây.
 */
export const AVATAR_CACHE_SECONDS = 31536000;

/** Số giây trong một giá trị `max-age=N` Storage đã lưu; null nếu không có. */
export function maxAgeSeconds(cacheControl) {
  const match = /max-age=(\d+)/.exec(String(cacheControl ?? ""));
  return match ? Number(match[1]) : null;
}

/**
 * Ảnh còn mang cache ngắn hơn ảnh mới. `list()` của Storage trả cả thư mục
 * (id null) — bỏ qua chúng.
 */
export function avatarsToRecache(objects) {
  return objects.filter(
    (object) =>
      Boolean(object.id) &&
      (maxAgeSeconds(object.metadata?.cacheControl) ?? 0) < AVATAR_CACHE_SECONDS,
  );
}
```

- [ ] **Step 4: Chạy lại test**

Run: `npx vitest run scripts/lib/avatar-cache.test.mjs`
Expected: PASS.

- [ ] **Step 5: Viết script chạy tay**

Tạo `scripts/avatar-cache-control.mjs`. Cách nạp `.env.local` và tạo client chép đúng khuôn `scripts/geocode-providers.mjs:30-61`:

```js
/**
 * Ghi lại các ảnh đại diện tải lên TRƯỚC thay đổi cache một năm (Task A1),
 * để chúng cũng được trình duyệt giữ một năm. Nội dung, đường dẫn và loại ảnh
 * giữ nguyên; chỉ đổi Cache-Control. An toàn vì một URL avatar không bao giờ
 * đổi nội dung (mỗi lần đổi ảnh là một UUID mới).
 *
 *   node scripts/avatar-cache-control.mjs          # thử khan, KHÔNG ghi gì
 *   node scripts/avatar-cache-control.mjs --write  # ghi thật
 *
 * Trình duyệt đang giữ bản max-age=3600 sẽ hỏi lại đúng một lần; câu trả lời
 * 304 mang header mới, từ đó ảnh được giữ một năm.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createClient } from "@supabase/supabase-js";
import { AVATAR_CACHE_SECONDS, avatarsToRecache } from "./lib/avatar-cache.mjs";

const require = createRequire(import.meta.url);
const { loadEnv } = require("../datasync/lib/env");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv(path.resolve(__dirname, "../.env.local"));

const BUCKET = "avatars";
const WRITE = process.argv.includes("--write");

function supabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY trong .env.local");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

async function main() {
  const supabase = supabaseAdmin();
  const { data, error } = await supabase.storage.from(BUCKET).list("", { limit: 1000 });
  if (error) throw new Error(error.message);
  const files = (data ?? []).filter((object) => object.id);
  const targets = avatarsToRecache(files);
  console.log(`Ảnh trong bucket: ${files.length}, cần ghi lại: ${targets.length}`);

  if (!WRITE) {
    for (const object of targets) {
      console.log(`  ${object.name}  ${object.metadata?.cacheControl ?? "(trống)"}`);
    }
    console.log("\nCHẾ ĐỘ THỬ KHAN — không ghi gì. Thêm --write để ghi thật.");
    return;
  }

  let done = 0;
  for (const object of targets) {
    const { data: blob, error: downloadError } = await supabase.storage
      .from(BUCKET)
      .download(object.name);
    if (downloadError || !blob) {
      throw new Error(`${object.name}: ${downloadError?.message ?? "không tải được"}`);
    }
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(object.name, await blob.arrayBuffer(), {
        upsert: true,
        // Body là ArrayBuffer: thiếu contentType thì storage-js gửi text/plain.
        contentType: object.metadata?.mimetype ?? blob.type,
        cacheControl: String(AVATAR_CACHE_SECONDS),
      });
    if (uploadError) throw new Error(`${object.name}: ${uploadError.message}`);
    done += 1;
    console.log(`  ✓ ${object.name}`);
  }
  console.log(`\nĐã ghi lại ${done}/${targets.length} ảnh.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 6: Chạy thử khan (chỉ đọc)**

Run: `node scripts/avatar-cache-control.mjs`
Expected: dòng `Ảnh trong bucket: 15, cần ghi lại: 15` (số có thể khác nếu có người vừa đổi ảnh), mỗi ảnh in kèm `max-age=3600`, rồi dòng "CHẾ ĐỘ THỬ KHAN".

- [ ] **Step 7: Ghi changelog, typecheck, lint, commit (chưa chạy `--write`)**

Thêm lên đầu `changelog.md`:

```markdown
## 2026-11-12 — Avatar: script ghi lại ảnh cũ với cache một năm

- `scripts/avatar-cache-control.mjs` (chạy tay, mặc định thử khan) tải từng ảnh trong bucket `avatars` còn `max-age` ngắn hơn một năm rồi ghi đè đúng đường dẫn đó với `cacheControl` 31.536.000. Nội dung và đường dẫn không đổi.
```

```bash
npx tsc --noEmit -p .
npx eslint scripts/avatar-cache-control.mjs scripts/lib/avatar-cache.mjs scripts/lib/avatar-cache.test.mjs
git add scripts/avatar-cache-control.mjs scripts/lib/avatar-cache.mjs scripts/lib/avatar-cache.test.mjs changelog.md
git commit -m "chore(avatar): script to re-store existing avatars with a one-year cache"
```

- [ ] **Step 8: Ghi thật — CHỈ khi user duyệt, và sau khi Task A1 đã deploy**

Run: `node scripts/avatar-cache-control.mjs --write`
Expected: một dòng `✓ <tên>.webp` cho mỗi ảnh, rồi `Đã ghi lại N/N ảnh.`

Kiểm lại bằng SQL (Supabase CLI):

```bash
supabase db query --linked --project-ref cxdgupxfhvtsitmcmpiw "select metadata->>'cacheControl' as cache, count(*) from storage.objects where bucket_id = 'avatars' group by 1" -o json
```

Expected: chỉ còn một nhóm `max-age=31536000`.

Kiểm header một ảnh: `curl -s -D - -o /dev/null <avatar_url>` → `cache-control: public, max-age=31536000`. Nếu CDN còn trả `3600` thì chờ khoảng một giờ cho bản cũ hết hạn ở CDN, rồi kiểm lại.

---

## Phase B — Upload đính kèm

### Task B1: Tách kiểm file sau upload thành "đọc" và "phán quyết"

**Files:**
- Modify: `src/lib/tasks/direct-upload.ts:122-180`
- Modify: `src/lib/tasks/direct-upload.test.ts:87-175`

**Interfaces:**
- Produces (trong `src/lib/tasks/direct-upload.ts`):
  - `export type DirectUploadInspection = { kind: "missing" } | { kind: "unreadable" } | { kind: "found"; size: number; contentType: string | null; head: ArrayBuffer | null }`
  - `export async function inspectDirectUpload(path: string): Promise<DirectUploadInspection>`. **Không bao giờ reject, không bao giờ xoá gì.**
  - `export async function judgeDirectUpload(path: string, fileName: string, expectedSize: number | undefined, inspection: DirectUploadInspection): Promise<VerifiedUpload>`. Có thể xoá file sai.
  - `verifyDirectUpload(path, fileName, expectedSize?)` giữ nguyên chữ ký, giờ bằng `judgeDirectUpload(…, await inspectDirectUpload(path))`. `src/lib/tasks/upload-recovery.ts:19` vẫn gọi nó.

- [ ] **Step 1: Viết test hỏng cho hai hàm mới**

Trong `src/lib/tasks/direct-upload.test.ts`, đổi dòng import thành:

```ts
import {
  inspectDirectUpload,
  judgeDirectUpload,
  parseDirectUploadRequest,
  verifyDirectUpload,
} from "./direct-upload";
```

Thêm vào cuối file:

```ts
describe("inspectDirectUpload", () => {
  const path = `enrollment/r-1/${REQUEST_ID}-Medicaid_application.pdf`;

  beforeEach(() => {
    storage.readTaskFileInfo.mockReset();
    storage.readTaskFileHead.mockReset();
    storage.removeTaskFile.mockReset().mockResolvedValue(undefined);
  });

  it("reads size, type and the first bytes together, and never deletes", async () => {
    storage.readTaskFileInfo.mockResolvedValue({ size: 1000, contentType: "text/html" });
    storage.readTaskFileHead.mockResolvedValue(PDF_HEAD);

    await expect(inspectDirectUpload(path)).resolves.toEqual({
      kind: "found",
      size: 1000,
      contentType: "text/html",
      head: PDF_HEAD,
    });
    expect(storage.readTaskFileInfo).toHaveBeenCalledWith(path);
    expect(storage.readTaskFileHead).toHaveBeenCalledWith(path);
    expect(storage.removeTaskFile).not.toHaveBeenCalled();
  });

  it("reports a missing object even though reading its bytes failed", async () => {
    storage.readTaskFileInfo.mockResolvedValue(null);
    storage.readTaskFileHead.mockRejectedValue(new Error("Object not found"));
    await expect(inspectDirectUpload(path)).resolves.toEqual({ kind: "missing" });
  });

  it("reports Storage failure instead of rejecting", async () => {
    storage.readTaskFileInfo.mockRejectedValue(new Error("storage down"));
    storage.readTaskFileHead.mockRejectedValue(new Error("storage down"));
    await expect(inspectDirectUpload(path)).resolves.toEqual({ kind: "unreadable" });
  });
});

describe("judgeDirectUpload", () => {
  const path = `enrollment/r-1/${REQUEST_ID}-Medicaid_application.pdf`;

  beforeEach(() => {
    storage.removeTaskFile.mockReset().mockResolvedValue(undefined);
  });

  it("accepts a real PDF of the expected size", async () => {
    const inspection = { kind: "found", size: 1000, contentType: "application/pdf", head: PDF_HEAD } as const;
    await expect(judgeDirectUpload(path, "Medicaid application.pdf", 1000, inspection)).resolves.toEqual({
      ok: true,
      contentType: "application/pdf",
      size: 1000,
    });
    expect(storage.removeTaskFile).not.toHaveBeenCalled();
  });

  it("removes the object only when judging, never while inspecting", async () => {
    const inspection = {
      kind: "found",
      size: 1000,
      contentType: "application/pdf",
      head: new TextEncoder().encode("MZ not a pdf").buffer,
    } as const;
    const result = await judgeDirectUpload(path, "Medicaid application.pdf", 1000, inspection);
    expect(result).toEqual({ ok: false, status: 400, error: "File contents do not match the file type." });
    expect(storage.removeTaskFile).toHaveBeenCalledWith(path);
  });

  it("asks for a retry when the object is there but its bytes could not be read", async () => {
    const inspection = { kind: "found", size: 1000, contentType: "application/pdf", head: null } as const;
    await expect(judgeDirectUpload(path, "Medicaid application.pdf", 1000, inspection)).resolves.toEqual({
      ok: false,
      status: 500,
      error: "Could not check the uploaded file. Please try again.",
    });
    expect(storage.removeTaskFile).not.toHaveBeenCalled();
  });

  it("keeps the object and asks for a retry when Storage was unreadable or the upload has not landed", async () => {
    await expect(judgeDirectUpload(path, "Medicaid application.pdf", 1000, { kind: "unreadable" })).resolves.toMatchObject({ ok: false, status: 500 });
    await expect(judgeDirectUpload(path, "Medicaid application.pdf", 1000, { kind: "missing" })).resolves.toEqual({
      ok: false,
      status: 400,
      error: "The upload did not finish. Please try again.",
    });
    expect(storage.removeTaskFile).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Chạy để thấy hỏng**

Run: `npx vitest run src/lib/tasks/direct-upload.test.ts`
Expected: FAIL, `inspectDirectUpload is not a function` (và `judgeDirectUpload`).

- [ ] **Step 3: Sửa code**

Trong `src/lib/tasks/direct-upload.ts`, thay toàn bộ hàm `verifyDirectUpload` hiện tại (từ dòng chú thích `/** Checks the object the browser uploaded…` tới hết hàm, khoảng `:130-180`) bằng:

```ts
/** What Storage holds at a direct-upload path, read without changing anything. */
export type DirectUploadInspection =
  | { kind: "missing" }
  | { kind: "unreadable" }
  | { kind: "found"; size: number; contentType: string | null; head: ArrayBuffer | null };

/**
 * Reads the object's size/type and its first bytes at the same time. The byte
 * read is ~310 ms (12/11/2026), so routes start this as soon as they know the
 * path and run their permission and intent checks meanwhile. It never rejects
 * and never deletes: a caller who turns out not to be allowed only costs two
 * Storage reads, and its result is dropped.
 */
export async function inspectDirectUpload(path: string): Promise<DirectUploadInspection> {
  const [info, head] = await Promise.allSettled([readTaskFileInfo(path), readTaskFileHead(path)]);
  if (info.status === "rejected") return { kind: "unreadable" };
  if (!info.value) return { kind: "missing" };
  return {
    kind: "found",
    size: info.value.size,
    contentType: info.value.contentType,
    head: head.status === "fulfilled" && head.value ? head.value : null,
  };
}

/**
 * Decides on an inspection before any row points at the object. A file that
 * fails is removed so it cannot linger unreferenced; a Storage outage leaves it
 * in place so the user's retry can finalize it without re-uploading.
 *
 * Call this only after the caller passed the permission and upload-intent
 * checks: a request with a wrong `expectedSize` alone is enough to delete the
 * object.
 */
export async function judgeDirectUpload(
  path: string,
  fileName: string,
  expectedSize: number | undefined,
  inspection: DirectUploadInspection,
): Promise<VerifiedUpload> {
  const expectedType = attachmentContentType(fileName);
  if (!expectedType) return { ok: false, status: 400, error: "Unsupported file type." };
  if (inspection.kind === "unreadable") {
    return { ok: false, status: 500, error: "Could not check the uploaded file. Please try again." };
  }
  if (inspection.kind === "missing") {
    return { ok: false, status: 400, error: "The upload did not finish. Please try again." };
  }

  const reject = async (error: string): Promise<VerifiedUpload> => {
    await removeTaskFile(path).catch((cleanupError) =>
      console.warn("[attachment] failed to remove a rejected direct upload", cleanupError),
    );
    return { ok: false, status: 400, error };
  };

  if (inspection.size <= 0) return reject("Empty files cannot be uploaded.");
  if (inspection.size > TASK_ATTACHMENT_MAX_BYTES) return reject(attachmentTooLargeMessage());
  if (expectedSize !== undefined && inspection.size !== expectedSize) {
    return reject("Uploaded file size does not match the selected file.");
  }
  if (inspection.contentType && baseContentType(inspection.contentType) !== expectedType) {
    return reject("File contents do not match the file type.");
  }
  if (!inspection.head) {
    return { ok: false, status: 500, error: "Could not check the uploaded file. Please try again." };
  }
  const validation = validateAttachmentFile(fileName, inspection.head);
  if (!validation.ok) return reject(validation.error);

  return { ok: true, contentType: validation.contentType, size: inspection.size };
}

/** Inspect then judge in one call, for callers with nothing to overlap (upload recovery). */
export async function verifyDirectUpload(
  path: string,
  fileName: string,
  expectedSize?: number,
): Promise<VerifiedUpload> {
  return judgeDirectUpload(path, fileName, expectedSize, await inspectDirectUpload(path));
}
```

- [ ] **Step 4: Sửa 2 test cũ đã khoá thứ tự đọc tuần tự**

Hai test sau đang khẳng định không đọc byte khi `info` đã đủ lý do từ chối. Giờ hai bước đọc chạy song song nên byte luôn được đọc, chỉ là không dùng tới. Trong `direct-upload.test.ts`:
- Ở test `"removes a file stored with a different content type"`, xoá dòng `expect(storage.readTaskFileHead).not.toHaveBeenCalled();`.
- Ở test `"rejects a truncated or different file even when its signature is valid"`, xoá dòng `expect(storage.readTaskFileHead).not.toHaveBeenCalled();`.

Giữ nguyên các dòng `expect(storage.removeTaskFile).toHaveBeenCalledWith(path)` và mọi `expect(result)…` của hai test này.

- [ ] **Step 5: Chạy lại test**

Run: `npx vitest run src/lib/tasks/direct-upload.test.ts src/lib/tasks/upload-recovery.test.ts`
Expected: PASS, cả hai file.

- [ ] **Step 6: Typecheck, lint, commit**

```bash
npx tsc --noEmit -p .
npx eslint src/lib/tasks/direct-upload.ts src/lib/tasks/direct-upload.test.ts
git add src/lib/tasks/direct-upload.ts src/lib/tasks/direct-upload.test.ts
git commit -m "refactor(attachments): split upload checks into a read-only inspection and a judgment"
```

(Changelog ghi chung ở Task B2, vì B1 một mình chưa đổi hành vi của route nào.)

---

### Task B2: finalize bắt đầu đọc file sớm, phán quyết đúng chỗ cũ (3 route)

**Files:**
- Modify: `src/app/api/enrollment/[id]/attachments/route.ts` (import `:20-26`, sau `:140`, chỗ verify `:294`)
- Modify: `src/app/api/tasks/[id]/attachments/route.ts` (import, sau `:196`, chỗ verify `:306-311`)
- Modify: `src/app/api/leads/[id]/attachments/route.ts` (import, sau `const fileName = …` khoảng `:193`, chỗ verify `:287`)
- Modify: `changelog.md`

**Interfaces:**
- Consumes: `inspectDirectUpload(path)` và `judgeDirectUpload(path, fileName, expectedSize, inspection)` từ Task B1.

**Luật cho cả 3 route:**
- Bắt đầu `inspectDirectUpload` ngay sau khi đọc body (`readDirectUploadRequest`) và chỉ khi `direct.action === "finalize"`. Ở cả 3 route, lúc đó người gọi **đã đăng nhập**:
  - Enrollment: `loadRecordContext`.
  - Task: `loadActorAndTask` + `canViewResolved`, cố ý chạy trước khi đọc body (chú thích `:155`).
  - Lead: `loadContext` + `canEdit`.
- Giữ nguyên **vị trí** gọi phán quyết: đúng chỗ đang gọi `verifyDirectUpload`, tức sau kiểm quyền và `requireUploadIntent`.
- Nếu route trả lỗi sớm (403, 409…), promise đọc bị bỏ dở. Không sao, vì `inspectDirectUpload` không bao giờ reject.

- [ ] **Step 1: Route Enrollment**

Đổi import (đoạn `:20-26`):

```ts
import {
  directUploadTicketBody,
  inspectDirectUpload,
  isDirectUploadRequest,
  judgeDirectUpload,
  readDirectUploadRequest,
  type DirectUploadRequest,
} from "@/lib/tasks/direct-upload";
```

Ngay sau dòng `const fileName = direct ? direct.fileName : file!.name;` (`:140`), thêm:

```ts
  // Read the uploaded object now (~310 ms for its first bytes) while the
  // permission, intent and replay checks below run. Nothing is decided or
  // deleted until judgeDirectUpload, at the same point as before.
  const inspection = direct?.action === "finalize"
    ? inspectDirectUpload(buildEnrollmentStoragePath(id, fileName, direct.clientRequestId))
    : null;
```

Thay dòng `const verified = await verifyDirectUpload(storagePath, fileName, direct.size);` (`:294`) bằng:

```ts
    const verified = await judgeDirectUpload(
      storagePath,
      fileName,
      direct.size,
      await (inspection ?? inspectDirectUpload(storagePath)),
    );
```

- [ ] **Step 2: Route Task**

Trong khối import từ `@/lib/tasks/direct-upload` của `src/app/api/tasks/[id]/attachments/route.ts`, thay `verifyDirectUpload,` bằng hai dòng `inspectDirectUpload,` và `judgeDirectUpload,`, giữ nguyên các tên còn lại.

Ngay sau dòng `const fileName = direct ? direct.fileName : file!.name;` (`:196`), thêm:

```ts
  // The caller is already authenticated and allowed to view this task (above).
  // Read the uploaded object meanwhile; judgeDirectUpload below decides.
  const inspection = direct?.action === "finalize"
    ? inspectDirectUpload(buildStoragePath(id, fileName, direct.clientRequestId))
    : null;
```

Thay khối (`:306-311`):

```ts
  if (direct?.action === "finalize") {
    const result = await verifyDirectUpload(
      buildStoragePath(id, fileName, direct.clientRequestId),
      fileName,
      direct.size,
    );
```

bằng:

```ts
  if (direct?.action === "finalize") {
    const path = buildStoragePath(id, fileName, direct.clientRequestId);
    const result = await judgeDirectUpload(
      path,
      fileName,
      direct.size,
      await (inspection ?? inspectDirectUpload(path)),
    );
```

- [ ] **Step 3: Route Lead**

Trong khối import từ `@/lib/tasks/direct-upload` của `src/app/api/leads/[id]/attachments/route.ts`, thay `verifyDirectUpload,` bằng `inspectDirectUpload,` và `judgeDirectUpload,`.

Ngay sau dòng `const fileName = direct ? direct.fileName : file!.name;`, thêm:

```ts
  // Already authenticated and allowed to edit this lead (above). Read the
  // uploaded object meanwhile; judgeDirectUpload below decides.
  const inspection = direct?.action === "finalize"
    ? inspectDirectUpload(leadStoragePath(id, fileName, direct.clientRequestId))
    : null;
```

Thay dòng `const verified = await verifyDirectUpload(path, fileName, direct.size);` (`:287`) bằng:

```ts
    const verified = await judgeDirectUpload(
      path,
      fileName,
      direct.size,
      await (inspection ?? inspectDirectUpload(path)),
    );
```

- [ ] **Step 4: Kiểm không còn route nào gọi `verifyDirectUpload`, và lệnh phán quyết nằm sau kiểm intent**

Run: `grep -rn "verifyDirectUpload\|judgeDirectUpload\|requireUploadIntent(intent)" src/app/api/*/\[id\]/attachments/route.ts`
Expected:
- Không còn dòng `verifyDirectUpload`.
- Ở mỗi route, số dòng của `judgeDirectUpload` lớn hơn số dòng của `requireUploadIntent(intent)` đầu tiên.

- [ ] **Step 5: Chạy test liên quan và typecheck**

Run: `npx vitest run src/lib/tasks && npx tsc --noEmit -p .`
Expected: PASS, tsc exit 0.

- [ ] **Step 6: Ghi changelog, lint, commit**

Thêm lên đầu `changelog.md`:

```markdown
## 2026-11-12 — Đính kèm: finalize đọc file trong Storage song song với các bước kiểm

- Trước: finalize (Task, Enrollment, Lead) kiểm quyền và intent xong mới đọc `info` rồi 512 byte đầu của file (p50 310 ms), tuần tự.
- Giờ: ngay khi route đọc xong body của lượt finalize (người gọi đã đăng nhập), nó đọc `info` và 512 byte đầu song song (`inspectDirectUpload`, không xoá gì), trong lúc các bước kiểm quyền và intent chạy. Bước phán quyết có thể xoá file sai (`judgeDirectUpload`) vẫn ở đúng chỗ cũ, sau kiểm quyền và `requireUploadIntent`.
```

```bash
npx eslint "src/app/api/enrollment/[id]/attachments/route.ts" "src/app/api/tasks/[id]/attachments/route.ts" "src/app/api/leads/[id]/attachments/route.ts"
git add "src/app/api/enrollment/[id]/attachments/route.ts" "src/app/api/tasks/[id]/attachments/route.ts" "src/app/api/leads/[id]/attachments/route.ts" changelog.md
git commit -m "perf(attachments): read the uploaded object while finalize checks run"
```

- [ ] **Step 7: Thử tay trên local (local dùng chung DB production, nên dọn ngay sau khi thử)**

Mở một Task và một hồ sơ Enrollment, thử 3 trường hợp:
1. Đính kèm một PDF thật. Phải thấy file trong danh sách, reload vẫn còn.
2. Đính kèm một ảnh PNG. Phải thấy như trên.
3. Đổi tên một file `.txt` thành `.pdf` rồi đính kèm. Phải thấy lỗi "File contents do not match the file type.", và không có dòng đính kèm nào.

Sau khi thử: xoá các đính kèm thử bằng nút xoá trên giao diện.

---

### Task B3: Mở sẵn kết nối tới Storage trong lúc chờ prepare

**Files:**
- Create: `src/lib/tasks/storage-host.ts`
- Create: `src/lib/tasks/storage-host.test.ts`
- Modify: `src/lib/tasks/tus-upload.ts:17-27`
- Modify: `src/lib/tasks/upload-attachment.ts:227`
- Modify: `changelog.md`

**Interfaces:**
- Produces:
  - `export function storageUploadOrigin(base: string): string`. Trả `https://<ref>.storage.supabase.co` cho `https://<ref>.supabase.co`, giữ nguyên các host khác.
  - `export function preconnectStorageUploads(base?: string, doc?: Document): void`.

- [ ] **Step 1: Viết test hỏng**

Tạo `src/lib/tasks/storage-host.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { preconnectStorageUploads, storageUploadOrigin } from "./storage-host";

type FakeLink = {
  rel: string;
  href: string;
  crossOrigin: string | null;
  dataset: Record<string, string>;
  remove(): void;
};

function fakeDocument() {
  const links: FakeLink[] = [];
  const doc = {
    head: {
      appendChild: (link: FakeLink) => {
        links.push(link);
        return link;
      },
    },
    createElement: (): FakeLink => {
      const link: FakeLink = {
        rel: "",
        href: "",
        crossOrigin: null,
        dataset: {},
        remove: () => {
          links.splice(links.indexOf(link), 1);
        },
      };
      return link;
    },
    querySelectorAll: () => links.filter((link) => link.dataset.storagePreconnect === "1"),
  };
  return { doc: doc as unknown as Document, links };
}

describe("storageUploadOrigin", () => {
  it("uses Supabase's direct Storage host for a project URL", () => {
    expect(storageUploadOrigin("https://abc.supabase.co")).toBe("https://abc.storage.supabase.co");
    expect(storageUploadOrigin("https://abc.storage.supabase.co/")).toBe("https://abc.storage.supabase.co");
  });

  it("leaves a custom domain alone", () => {
    expect(storageUploadOrigin("https://db.example.com")).toBe("https://db.example.com");
  });
});

describe("preconnectStorageUploads", () => {
  it("adds one anonymous preconnect hint to the Storage host, replacing an older one", () => {
    const { doc, links } = fakeDocument();
    preconnectStorageUploads("https://abc.supabase.co", doc);
    preconnectStorageUploads("https://abc.supabase.co", doc);

    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      rel: "preconnect",
      href: "https://abc.storage.supabase.co",
      crossOrigin: "anonymous",
    });
  });

  it("does nothing without a document or a configured URL", () => {
    expect(() => preconnectStorageUploads("https://abc.supabase.co", undefined)).not.toThrow();
    const { doc, links } = fakeDocument();
    preconnectStorageUploads(undefined, doc);
    expect(links).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Chạy để thấy hỏng**

Run: `npx vitest run src/lib/tasks/storage-host.test.ts`
Expected: FAIL, "Failed to load url ./storage-host" hoặc "Cannot find module".

- [ ] **Step 3: Viết `storage-host.ts`**

Tạo `src/lib/tasks/storage-host.ts`:

```ts
/**
 * Supabase's direct Storage host (`<ref>.storage.supabase.co`), the one browser
 * uploads go to. Moved here from tus-upload.ts so the preconnect hint and the
 * upload use the very same host.
 */
export function storageUploadOrigin(base: string): string {
  const url = new URL(base);
  if (url.hostname.endsWith(".supabase.co") && !url.hostname.endsWith(".storage.supabase.co")) {
    url.hostname = url.hostname.replace(/\.supabase\.co$/, ".storage.supabase.co");
  }
  return url.origin;
}

/**
 * Lets the browser open DNS/TCP/TLS to Storage while `prepare` is in flight
 * (~0.5–0.9 s), instead of after the token arrives. `crossOrigin` must be
 * "anonymous": tus-js-client sends the upload without credentials, which uses
 * that connection pool.
 *
 * The hint is removed and inserted again on every upload: re-inserting is what
 * makes the browser open a fresh connection after an idle one was closed.
 */
export function preconnectStorageUploads(
  base: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL,
  doc: Document | undefined = typeof document === "undefined" ? undefined : document,
): void {
  if (!base || !doc?.head) return;
  let origin: string;
  try {
    origin = storageUploadOrigin(base);
  } catch {
    return;
  }
  doc.querySelectorAll("link[data-storage-preconnect]").forEach((node) => node.remove());
  const link = doc.createElement("link");
  link.rel = "preconnect";
  link.href = origin;
  link.crossOrigin = "anonymous";
  link.dataset.storagePreconnect = "1";
  doc.head.appendChild(link);
}
```

- [ ] **Step 4: Cho `tus-upload.ts` dùng chung host**

Trong `src/lib/tasks/tus-upload.ts`, thêm import `import { storageUploadOrigin } from "./storage-host";` dưới dòng import `tus-js-client`. Thay đoạn `:17-27`:

```ts
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const apiKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!base || !apiKey) return Promise.reject(new Error("File uploads are not configured."));
  const url = new URL(base);
  if (url.hostname.endsWith(".supabase.co") && !url.hostname.endsWith(".storage.supabase.co")) {
    url.hostname = url.hostname.replace(/\.supabase\.co$/, ".storage.supabase.co");
  }
  // `/sign` is the TUS endpoint that accepts a signed upload token in
  // `x-signature`; plain `/upload/resumable` wants a user JWT and answers
  // "Invalid Compact JWS" (403) — every upload failed that way on 2026-10-24.
  const endpoint = new URL("/storage/v1/upload/resumable/sign", url).toString();
```

bằng:

```ts
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const apiKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!base || !apiKey) return Promise.reject(new Error("File uploads are not configured."));
  // `/sign` is the TUS endpoint that accepts a signed upload token in
  // `x-signature`; plain `/upload/resumable` wants a user JWT and answers
  // "Invalid Compact JWS" (403) — every upload failed that way on 2026-10-24.
  const endpoint = new URL(
    "/storage/v1/upload/resumable/sign",
    storageUploadOrigin(base),
  ).toString();
```

`src/lib/tasks/tus-upload.test.ts` đã khoá endpoint `https://project.storage.supabase.co/storage/v1/upload/resumable/sign`. Nó phải tiếp tục pass mà không sửa gì.

- [ ] **Step 5: Gọi preconnect ngay trước prepare**

Trong `src/lib/tasks/upload-attachment.ts`:
- Thêm import `import { preconnectStorageUploads } from "./storage-host";` dưới dòng `import { uploadFileWithTus } from "./tus-upload";`.
- Thay dòng `const prepared = await post("prepare");` (`:227`) bằng:

```ts
  // Open the connection to Storage while the route prepares the token.
  preconnectStorageUploads();
  const prepared = await post("prepare");
```

Test của `upload-attachment.ts` chạy ở môi trường `node`, không có `document`, nên hàm này không làm gì và test cũ không đổi.

- [ ] **Step 6: Chạy test**

Run: `npx vitest run src/lib/tasks/storage-host.test.ts src/lib/tasks/tus-upload.test.ts src/lib/tasks/upload-attachment.test.ts`
Expected: PASS, cả ba file.

- [ ] **Step 7: Ghi changelog, typecheck, lint, commit**

Thêm lên đầu `changelog.md`:

```markdown
## 2026-11-12 — Đính kèm: mở sẵn kết nối tới Storage trong lúc chờ prepare

- Trình duyệt chèn `<link rel="preconnect" crossorigin="anonymous">` tới `<ref>.storage.supabase.co` ngay trước khi gọi prepare. Kết nối DNS/TCP/TLS được mở trong lúc route chuẩn bị token (~0,5–0,9 s), thay vì sau đó. Host lấy từ cùng một hàm `storageUploadOrigin` mà TUS dùng.
```

```bash
npx tsc --noEmit -p .
npx eslint src/lib/tasks/storage-host.ts src/lib/tasks/storage-host.test.ts src/lib/tasks/tus-upload.ts src/lib/tasks/upload-attachment.ts
git add src/lib/tasks/storage-host.ts src/lib/tasks/storage-host.test.ts src/lib/tasks/tus-upload.ts src/lib/tasks/upload-attachment.ts changelog.md
git commit -m "perf(attachments): preconnect to Storage while the upload token is prepared"
```

---

## Phase C — Đo lại sau deploy

### Task C1: So với số liệu gốc ngày 12/11

**Files:** không đổi file nào. Chỉ chạy đo và báo user.

Cần:
- Personal Access Token Supabase trong `~/.supabase_pat`, hoặc user cấp lại.
- Supabase CLI đã login.

Log API mỗi lần đọc tối đa 24 giờ.

- [ ] **Step 1: Avatar (sau Task A1 + A2, đo một ngày làm việc trọn)**

Query cho `GET https://api.supabase.com/v1/projects/cxdgupxfhvtsitmcmpiw/analytics/endpoints/logs?sql=…&iso_timestamp_start=…&iso_timestamp_end=…` (header `Authorization: Bearer <PAT>`):

```sql
select log_attributes['response.status_code'] as st,
       log_attributes['response.headers.cf_cache_status'] as cf,
       count() as n,
       round(quantile(0.5)(toFloat64OrZero(log_attributes['response.origin_time']))) as p50
from logs
where source = 'edge_logs'
  and log_attributes['request.path'] like '/storage/v1/object/public/avatars/%'
group by st, cf
order by n desc
limit 20
```

Gốc 12/11: tổng 938, trong đó 862 dòng `304/HIT`.
Đạt: tổng < 150/ngày và `304` < 20% tổng.

- [ ] **Step 2: Bước đọc 512 byte và TTFB của finalize (sau Task B2)**

```sql
select log_attributes['request.method'] as m, count() as n,
       round(quantile(0.5)(toFloat64OrZero(log_attributes['response.origin_time']))) as p50
from logs
where source = 'edge_logs'
  and log_attributes['request.path'] like '/storage/v1/object/sign/%'
  and log_attributes['request.headers.user_agent'] = 'node'
group by m
```

Trên Vercel:

```bash
vercel metrics vercel.function_invocation.ttfb_ms -f "route:/api/enrollment/[id]/attachments" --prod --since 2d -a p50 --json
```

Lặp lại cho `/api/tasks/[id]/attachments` và `-a p95`.

Gốc 12/11: Enrollment TTFB p50 547 / p95 912 ms, Task p50 451 / p95 893 ms. Bước đọc byte (`GET`) p50 310 ms.
Đạt: TTFB p50 của Enrollment giảm ít nhất 60 ms (≤ 490 ms).

- [ ] **Step 3: Tổng thời gian upload (sau Task B2 + B3)**

```bash
supabase db query --linked --project-ref cxdgupxfhvtsitmcmpiw "select count(*) as n, round(percentile_cont(0.5) within group (order by extract(epoch from completed_at - created_at))::numeric, 2) as p50_s, round(percentile_cont(0.95) within group (order by extract(epoch from completed_at - created_at))::numeric, 2) as p95_s from attachment_upload_intents where created_at > now() - interval '24 hours' and completed_at is not null" -o json
```

Gốc 12/11: p50 2,94–2,95 s, p95 5,3–5,4 s (n = 187).
Đạt: p50 ≤ 2,8 s.

Kiểm thêm: không có intent nào treo hoặc lỗi mới:

```bash
supabase db query --linked --project-ref cxdgupxfhvtsitmcmpiw "select count(*) filter (where failed_at is not null) as failed, count(*) filter (where completed_at is null and failed_at is null and created_at < now() - interval '30 minutes') as stuck from attachment_upload_intents where created_at > now() - interval '24 hours'" -o json
```

Expected: `failed` và `stuck` đều bằng 0, như ngày 12/11 (389/389 hoàn tất trong 48 giờ).

- [ ] **Step 4: Báo user và nhắc dọn PAT**

Báo các số trên cạnh số gốc. Nhắc user revoke token trong Supabase rồi xoá `~/.supabase_pat` nếu không cần đo tiếp.

---

## Self-review

- **Độ phủ:**
  - Avatar: nguyên nhân là `max-age=3600` (1.1); ảnh mới được sửa ở A1, ảnh cũ ở A2, đo ở C1.
  - Upload: ba chặng (1.2); finalize được sửa ở B1+B2, kết nối ở B3, đo ở C1.
  - Phần không sửa được (khoảng cách tới Sydney, TUS) đã ghi ở 1.2 và 1.3.
- **Placeholder:** không có TBD. Mọi bước sửa code đều có code đầy đủ. Số dòng là của `main` cfe96b7 (12/11), sai lệch vài dòng thì tìm theo đoạn code được trích.
- **Tên khớp nhau:**
  - `inspectDirectUpload` / `judgeDirectUpload` / `DirectUploadInspection` dùng giống nhau ở B1, B2.
  - `AVATAR_CACHE_SECONDS` giống nhau ở A1, A2, giá trị `31536000`.
  - `storageUploadOrigin` / `preconnectStorageUploads` giống nhau ở B3.
