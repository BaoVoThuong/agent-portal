# Dán ảnh vào comment (Ctrl+V) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development hoặc superpowers:executing-plans. Các bước dùng checkbox (`- [ ]`).

**Goal:** Chụp màn hình rồi Ctrl+V thẳng vào ô soạn comment là ảnh được đính kèm, không phải lưu ra file rồi bấm nút kẹp giấy.

**Architecture:** Một hàm thuần đọc `ClipboardEvent` ra danh sách `File` **đã được đặt tên tử tế**, đặt trong `src/lib/tasks/` để test được; component chỉ gọi nó rồi đưa vào `addFiles` sẵn có. Không có route mới, không có SQL — ảnh dán đi đúng đường upload mà nút kẹp giấy đang đi.

**Tech Stack:** Next.js 16.2.4, TypeScript, vitest.

---

## Vì sao hiện không dùng được

**Không phải lỗi — chưa từng có.** Tìm khắp `src/`:

```
grep -rn "onPaste|clipboardData|ClipboardEvent" src/   →  0 kết quả
```

Trình duyệt chỉ đính kèm ảnh khi trang **tự bắt** sự kiện `paste` và đọc `clipboardData`. Không có handler thì Ctrl+V vào một `<textarea>` chỉ dán được **chữ**; ảnh trong clipboard bị bỏ qua hoàn toàn.

---

## Cái bẫy: ảnh dán KHÔNG có tên file dùng được

Đây là chỗ một bản làm ẩu sẽ "chạy được trong ô soạn nhưng upload thất bại", và lỗi chỉ hiện ra sau khi người dùng đã bấm gửi.

**Cổng phía client** — `CommentThread.tsx:188` — nhận file dựa vào `file.type` trước:

```ts
export function inferAttachmentMimeType(fileName: string, browserType?: string): string {
  if (browserType) return browserType;      // ← ảnh dán có type = "image/png", qua được
  ...
}
```

**Cổng phía server** — `src/lib/tasks/attachments.ts:58-64` — lại tra theo **ĐUÔI FILE**, không nhìn `type`:

```ts
export function validateAttachmentFile(fileName: string, data: ArrayBuffer) {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  const contentType = MIME_BY_EXTENSION[extension];
  if (!contentType) { ... }               // ← tên rỗng hoặc không đuôi là TỪ CHỐI
```

Ảnh chụp màn hình dán vào, tuỳ trình duyệt, có `name` là `"image.png"`, `""`, hoặc một chuỗi không đuôi. Trường hợp không đuôi thì **qua cổng client, chết ở cổng server** — người dùng thấy ảnh nằm trong ô soạn, bấm gửi, rồi nhận lỗi upload.

**Nên hàm đọc clipboard phải TỰ ĐẶT TÊN có đuôi đúng, trước khi file chạm vào `addFiles`.**

Thêm một lý do nữa phải đặt tên: `addFiles` chống trùng bằng `name + size + lastModified`. Mọi ảnh dán đều tên `"image.png"`, nên hai ảnh chụp khác nhau cùng kích thước (hiếm nhưng có, ví dụ hai ảnh chụp cùng một vùng màn hình) sẽ bị coi là trùng và cái thứ hai bị từ chối. Tên có mốc thời gian giải quyết luôn chuyện đó, và người dùng cũng đọc được "cái nào là cái nào" trong danh sách đính kèm.

---

## Global Constraints

- **Thư mục làm việc**: `/Users/vothuongbao/Project/Web/agent-portal`.
- **Test**: vitest `environment: "node"`, `include: ["src/**/*.test.ts"]`. **`.tsx` KHÔNG chạy test được** — nên phần quyết định phải nằm trong `src/lib/`.
- **Bốn lệnh kiểm tra** trước mỗi commit: `npm run typecheck` · `npm run lint` · `npm run test:run` · `npm run build`
- **Changelog bắt buộc**, mới nhất trên cùng.
- **KHÔNG tự push.** Phải nêu tên remote.
- **Không có SQL.** Ảnh dán đi đúng đường upload mà nút kẹp giấy đang đi.
- **React Compiler lint**: cấm gọi `setState` trong thân `useEffect`.
- **Ngôn ngữ**: comment giải thích *tại sao* viết tiếng Việt; chuỗi hiển thị viết **tiếng Anh**.

---

## File Structure

**Tạo mới**

| File | Trách nhiệm |
| --- | --- |
| `src/lib/tasks/clipboard-files.ts` | Đọc `ClipboardEvent` ra `File[]` đã đặt tên tử tế |
| `src/lib/tasks/clipboard-files.test.ts` | Test, gồm ca file không tên |

**Sửa**

| File | Sửa gì |
| --- | --- |
| `src/app/(authed)/tasks/_components/CommentThread.tsx` | `addFiles` nhận thêm `File[]`; `onPaste` trên ô soạn |
| `changelog.md` | Một mục |

---

## Task 1: Hàm đọc clipboard

**Files:** Create `src/lib/tasks/clipboard-files.ts`, `src/lib/tasks/clipboard-files.test.ts`

**Interfaces:**
- Produces: `filesFromClipboard(data: DataTransferLike | null, now?: Date): File[]`
- Produces: `type DataTransferLike = { files?: ArrayLike<File> | null; items?: ArrayLike<DataTransferItemLike> | null }`

- [ ] **Step 1: Viết test thất bại**

Tạo `src/lib/tasks/clipboard-files.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { filesFromClipboard } from "./clipboard-files";

const png = (name: string, size = 1024) => {
  const file = new File([new Uint8Array(size)], name, { type: "image/png" });
  return file;
};

const clipboard = (files: File[]) => ({ files, items: null });

const NOW = new Date("2026-09-02T14:30:05Z");

describe("filesFromClipboard", () => {
  it("đặt tên mới cho ảnh dán, kèm đuôi đúng", () => {
    // Bẫy chính: validateAttachmentFile phía server tra MIME theo ĐUÔI FILE,
    // không nhìn file.type. Ảnh không đuôi qua được cổng client rồi chết ở
    // server — người dùng thấy ảnh trong ô soạn, bấm gửi, rồi nhận lỗi upload.
    const out = filesFromClipboard(clipboard([png("image.png")]), NOW);
    expect(out).toHaveLength(1);
    expect(out[0].name).toMatch(/^pasted-image-.*\.png$/);
    expect(out[0].type).toBe("image/png");
  });

  it("file KHÔNG CÓ TÊN vẫn ra được tên có đuôi", () => {
    const out = filesFromClipboard(clipboard([png("")]), NOW);
    expect(out[0].name).toMatch(/\.png$/);
  });

  it("hai ảnh dán trong cùng một lượt có tên khác nhau", () => {
    // addFiles chống trùng bằng name+size+lastModified. Cùng tên "image.png"
    // và cùng kích thước là cái thứ hai bị từ chối oan.
    const out = filesFromClipboard(clipboard([png("image.png"), png("image.png")]), NOW);
    expect(out[0].name).not.toBe(out[1].name);
  });

  it("giữ nguyên tên của file người dùng copy từ máy", () => {
    // Copy một file thật trong Finder rồi dán: tên đó có ý nghĩa với họ, đừng
    // đổi. Chỉ ảnh chụp màn hình mới cần đặt tên hộ.
    const out = filesFromClipboard(
      clipboard([new File([new Uint8Array(10)], "hop-dong-2026.pdf", { type: "application/pdf" })]),
      NOW
    );
    expect(out[0].name).toBe("hop-dong-2026.pdf");
  });

  it("bỏ qua kiểu file không nằm trong danh sách cho phép", () => {
    const out = filesFromClipboard(
      clipboard([new File([new Uint8Array(10)], "script.exe", { type: "application/x-msdownload" })]),
      NOW
    );
    expect(out).toEqual([]);
  });

  it("dán CHỮ thuần thì không trả file nào", () => {
    // Quan trọng: dán chữ phải hoạt động như cũ. Trả về mảng rỗng để nơi gọi
    // biết là KHÔNG được chặn sự kiện paste.
    expect(filesFromClipboard(clipboard([]), NOW)).toEqual([]);
    expect(filesFromClipboard(null, NOW)).toEqual([]);
  });
});
```

- [ ] **Step 2: Chạy để thấy hỏng**

Run: `npx vitest run src/lib/tasks/clipboard-files.test.ts`
Expected: FAIL — không tìm thấy module `./clipboard-files`.

- [ ] **Step 3: Viết hàm**

Tạo `src/lib/tasks/clipboard-files.ts`:

```ts
import {
  ATTACHMENT_ALLOWED_MIME_TYPES,
  inferAttachmentMimeType,
} from "./attachments";

/** Đủ dùng cho `ClipboardEvent.clipboardData` lẫn `DragEvent.dataTransfer`. */
export type DataTransferLike = {
  files?: ArrayLike<File> | null;
  items?: ArrayLike<{ kind: string; getAsFile: () => File | null }> | null;
};

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function hasUsableExtension(name: string): boolean {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  return extension.length > 0 && extension !== name.toLowerCase();
}

/**
 * Đọc clipboard ra danh sách file đính kèm được.
 *
 * **Vì sao phải đặt tên lại:** `validateAttachmentFile` phía server tra MIME
 * theo ĐUÔI FILE chứ không nhìn `file.type`. Ảnh chụp màn hình dán vào, tuỳ
 * trình duyệt, có tên là `"image.png"`, `""`, hoặc một chuỗi không đuôi —
 * trường hợp không đuôi thì qua được cổng client rồi chết ở cổng server, và
 * người dùng chỉ biết sau khi đã bấm gửi.
 *
 * **Vì sao tên phải khác nhau:** `addFiles` chống trùng bằng
 * `name + size + lastModified`. Mọi ảnh dán đều tên `"image.png"`, nên hai ảnh
 * chụp cùng kích thước sẽ bị coi là trùng và cái thứ hai bị từ chối oan.
 *
 * **File người dùng copy từ máy thì GIỮ NGUYÊN tên** — tên đó có ý nghĩa với
 * họ. Chỉ đặt tên hộ khi trình duyệt không cho cái tên nào dùng được.
 */
export function filesFromClipboard(
  data: DataTransferLike | null | undefined,
  now: Date = new Date()
): File[] {
  if (!data) return [];

  // `files` là đường chính và được mọi trình duyệt hiện đại hỗ trợ. `items` là
  // đường lùi cho bản cũ hơn, nơi ảnh chỉ xuất hiện dưới dạng item kind="file".
  const raw: File[] = data.files?.length
    ? Array.from(data.files)
    : Array.from(data.items ?? [])
        .filter((item) => item.kind === "file")
        .map((item) => item.getAsFile())
        .filter((file): file is File => file !== null);

  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join("");

  const out: File[] = [];
  raw.forEach((file, index) => {
    const mime = inferAttachmentMimeType(file.name, file.type || undefined);
    // Cùng danh sách cho phép với nút kẹp giấy. Dán một file .exe thì im lặng
    // bỏ qua chứ không báo lỗi: người dùng thường chỉ định dán chữ, và một hộp
    // lỗi đỏ cho thao tác họ không cố ý làm là phiền vô cớ.
    if (!ATTACHMENT_ALLOWED_MIME_TYPES.includes(mime)) return;

    if (hasUsableExtension(file.name)) {
      out.push(file);
      return;
    }

    const extension = EXTENSION_BY_MIME[mime];
    if (!extension) return;
    // Thêm chỉ số khi dán nhiều ảnh cùng lúc: cùng một giây thì mốc thời gian
    // không đủ để phân biệt.
    const suffix = raw.length > 1 ? `-${index + 1}` : "";
    out.push(
      new File([file], `pasted-image-${stamp}${suffix}.${extension}`, {
        type: mime,
        lastModified: file.lastModified,
      })
    );
  });
  return out;
}
```

- [ ] **Step 4: Chạy để thấy xanh**

Run: `npx vitest run src/lib/tasks/clipboard-files.test.ts`
Expected: PASS 6 test.

Nếu ca "hai ảnh dán có tên khác nhau" hỏng, kiểm lại: khi `raw.length > 1` thì `suffix` phải khác nhau cho từng file.

- [ ] **Step 5: Bốn lệnh kiểm tra + commit**

Run: `npm run typecheck && npm run lint && npm run test:run && npm run build`

```bash
git add src/lib/tasks/clipboard-files.ts src/lib/tasks/clipboard-files.test.ts
git commit -m "feat(attachments): hàm đọc file từ clipboard"
```

---

## Task 2: Nối vào ô soạn comment

**Files:** Modify `src/app/(authed)/tasks/_components/CommentThread.tsx`, `changelog.md`

**Interfaces:** Consumes `filesFromClipboard` từ Task 1.

`addFiles` hiện có chữ ký `(list: FileList | null)` (dòng 2771). Clipboard cho ra `File[]`, nên phải nới kiểu.

- [ ] **Step 1: Nới kiểu `addFiles`**

Đổi dòng 2771:

```ts
  function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const selected = Array.from(list);
```
thành
```ts
  // Nhận cả FileList (từ <input type="file">) lẫn File[] (từ clipboard).
  function addFiles(list: FileList | readonly File[] | null) {
    if (!list || list.length === 0) return;
    const selected = Array.from(list);
```

Phần còn lại của hàm không đổi — kiểm MIME, chống trùng, giới hạn dung lượng đều dùng được nguyên.

- [ ] **Step 2: Bắt sự kiện paste**

Tìm `<textarea>` trong `Composer` (khoảng dòng 2900–2960; xác định chính xác bằng `grep -n "<textarea" "src/app/(authed)/tasks/_components/CommentThread.tsx"`), thêm prop:

```tsx
          onPaste={(event) => {
            const pasted = filesFromClipboard(event.clipboardData);
            // Mảng rỗng = clipboard chỉ có chữ. KHÔNG chặn sự kiện, để việc dán
            // chữ hoạt động y như cũ — đó là thứ người ta dùng nhiều nhất.
            if (pasted.length === 0) return;
            event.preventDefault();
            addFiles(pasted);
          }}
```

Thêm import ở đầu file:
```ts
import { filesFromClipboard } from "@/lib/tasks/clipboard-files";
```

- [ ] **Step 3: Gợi ý cho người dùng biết là dán được**

Trong ô soạn, `placeholder` hiện tại chỉ nói về việc gõ. Tìm bằng `grep -n "placeholder=" "src/app/(authed)/tasks/_components/CommentThread.tsx"` và bổ sung, ví dụ:

```tsx
placeholder="Write a comment… paste a screenshot to attach it"
```

Một tính năng không ai biết là có thì cũng như không có.

- [ ] **Step 4: Bốn lệnh kiểm tra**

Run: `npm run typecheck && npm run lint && npm run test:run && npm run build`

- [ ] **Step 5: Kiểm tay — đủ sáu ca**

`npm run dev`, mở một task, vào tab Comments:

1. **Chụp màn hình rồi Ctrl+V vào ô soạn.** Expected: ảnh xuất hiện trong danh sách đính kèm, tên dạng `pasted-image-20260902143005.png`.
2. **Bấm gửi.** Expected: comment đăng được, ảnh hiện thumbnail. **Đây là ca chứng minh cái bẫy tên file đã được xử lý** — nếu tên không có đuôi thì chính bước này sẽ báo lỗi upload.
3. **Dán chữ thuần.** Expected: chữ vào ô soạn như cũ, không có gì lạ.
4. **Dán hai ảnh liên tiếp.** Expected: cả hai đều vào, tên khác nhau.
5. **Copy một file PDF trong Finder rồi dán.** Expected: vào được, **giữ nguyên tên gốc**.
6. **Dán một ảnh vượt 15 MB.** Expected: báo đúng thông điệp giới hạn sẵn có, không phải lỗi lạ.

- [ ] **Step 6: Changelog + commit**

```markdown
## 2026-09-02 — Dán ảnh thẳng vào comment (Ctrl+V)

- **Loại**: feature.
- Trước đây không dùng được vì **chưa từng có** handler nào: tìm khắp `src/` không có một chỗ nào đọc `clipboardData`. Trình duyệt chỉ đính kèm ảnh khi trang tự bắt sự kiện `paste`; không có handler thì Ctrl+V vào `<textarea>` chỉ dán được chữ.
- **Ảnh dán phải được ĐẶT TÊN LẠI**, và đây là chỗ dễ làm hỏng nhất: cổng client nhận file theo `file.type`, nhưng `validateAttachmentFile` phía **server tra MIME theo ĐUÔI FILE**. Ảnh chụp màn hình tuỳ trình duyệt có tên `"image.png"`, `""`, hoặc không đuôi — trường hợp không đuôi thì qua cổng client rồi **chết ở server**, và người dùng chỉ biết sau khi đã bấm gửi.
- Tên có mốc thời gian còn giải quyết chuyện chống trùng: `addFiles` so `name + size + lastModified`, mà mọi ảnh dán đều tên `"image.png"` — hai ảnh chụp cùng kích thước sẽ bị từ chối oan.
- **File copy từ máy thì giữ nguyên tên** — tên đó có ý nghĩa với người dùng. Chỉ đặt tên hộ khi trình duyệt không cho cái tên nào dùng được.
- **Dán chữ hoạt động y như cũ**: chỉ chặn sự kiện khi clipboard thật sự có file.
- Kiểu file không cho phép thì **im lặng bỏ qua**, không báo lỗi đỏ — người ta thường chỉ định dán chữ, và một hộp lỗi cho thao tác không cố ý là phiền vô cớ.
- Phần quyết định nằm ở `src/lib/tasks/clipboard-files.ts` + 6 test; `.tsx` ở repo này không test được nên để trong component là không có lưới an toàn.
- Khung soạn comment dùng chung nên **Enrollment được luôn**, không phải sửa gì thêm.
```

```bash
git add "src/app/(authed)/tasks/_components/CommentThread.tsx" changelog.md
git commit -m "feat(comments): dán ảnh thẳng vào ô soạn bằng Ctrl+V"
```

---

## Task 3: Cổng kiểm cuối

- [ ] **Step 1:** `node scripts/check-tracked-imports.mjs` → `ok`
- [ ] **Step 2:** Build từ checkout sạch:

```bash
SCRATCH=$(mktemp -d)/clean
mkdir -p "$SCRATCH"
git archive HEAD | tar -x -C "$SCRATCH"
cp .env.local "$SCRATCH/.env.local"
cp -R node_modules "$SCRATCH/node_modules"   # symlink KHÔNG dùng được: Turbopack từ chối symlink trỏ ra ngoài gốc dự án
cd "$SCRATCH" && npm run build
```
Expected: `✓ Compiled successfully`. Dọn: `rm -rf "$SCRATCH"`.

- [ ] **Step 3:** Hỏi remote. **Không tự push.**

---

## Phụ lục: cố ý KHÔNG làm

- **Kéo-thả file vào ô soạn.** `filesFromClipboard` nhận cả `DataTransfer` nên nối thêm chỉ là một `onDrop`, nhưng kéo-thả cần thêm phản hồi hình ảnh (viền sáng khi rê file qua) — đó là việc riêng, không nhét chung vào một bản vá.
- **`NewTaskDialog` và `AttachmentPanel`** cũng có ô đính kèm và cũng chưa dán được. Người dùng nói "trong comment", nên plan này chỉ làm comment. Hàm ở Task 1 dùng lại được nguyên vẹn cho hai chỗ kia khi cần.
- **Không nén ảnh trước khi gửi.** Ảnh chụp màn hình thường 1–3 MB, còn xa giới hạn 15 MB mỗi file. Nén là đánh đổi chất lượng lấy dung lượng, cần người dùng quyết chứ không tự làm.
- **Không dán được ảnh copy từ một trang web khác** trong trường hợp trình duyệt chỉ đưa vào clipboard một URL chứ không phải dữ liệu ảnh. Lúc đó URL sẽ được dán như chữ — đúng hành vi, vì tải hộ ảnh từ tên miền khác là chuyện của server và vướng CORS.
