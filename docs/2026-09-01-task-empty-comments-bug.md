# Bug — comment rỗng bị lưu lại khi upload attachment thất bại hoặc bị bỏ dở

**Found:** 2026-09-01 · **Reported by:** Bao Vo · **Diagnosed against:** working tree hiện tại  
**Status:** open · **Severity:** medium — không làm sai dữ liệu task, nhưng tạo comment rỗng gây nhiễu lịch sử trao đổi và làm người dùng tưởng hệ thống bị duplicate comment.

---

## Điều người dùng nhìn thấy

Trong task **CS-119 — Thanh Tuan Tran** (`660a8ae7-1935-4cf7-a9dc-b3ac388e60d6`), tab **Comments** hiển thị nhiều comment của Kay Huynh/Khang Nguyen chỉ có avatar, tên, thời gian và hành động `Reply · React`, nhưng không có nội dung.

Một số row rỗng có thumbnail ảnh; một số khác không có text **và** không có attachment. Vì cùng được render như một comment bình thường, người dùng không thể biết đó là:

1. comment chỉ gửi file (hợp lệ), hay
2. comment placeholder bị bỏ lại (lỗi).

---

## Evidence từ dữ liệu thật

Đã đọc riêng dữ liệu của task nêu trên ngày 2026-09-01. Có **6** `task_comments` còn hoạt động (`deleted_at IS NULL`) của Kay Huynh với `body = ''`.

| Thời điểm (UTC) | Comment ID | Attachment đang hoạt động | Kết luận |
| --- | --- | --- | --- |
| 2026-09-01 13:49:xx | `eb51a2e0-…` | `Dr out of network.png` | Hợp lệ: attachment-only comment |
| 2026-09-01 16:03:xx | `abb0faaa-…` | `phoi.png` | Hợp lệ: attachment-only comment |
| 2026-09-01 16:04:31 | `ed3419fd-…` | Không có | **Orphan empty comment** |
| 2026-09-01 16:04:53 | `b3e81945-…` | Không có | **Orphan empty comment** |
| 2026-09-01 16:06:xx | `7b63de03-…` | `bsi 1.png`, `bsi 2.png` | Hợp lệ: attachment-only comment |
| 2026-09-01 16:07:44 | `00d57e38-…` | Không có | **Orphan empty comment** |

Vì vậy ảnh chụp của user không phải do renderer tự nhân bản cùng một comment: đây là các database row khác nhau, được tạo ở các thời điểm khác nhau. Mỗi row có `client_request_id` riêng, nên cũng không phải duplicate do retry cùng một request.

> Không tự xóa sáu row này trong lúc audit. Ba row có attachment là lịch sử hợp lệ; ba row orphan cần được xác nhận trước khi cleanup production.

---

## Root cause

Luồng hiện tại cố ý tạo một comment trước rồi mới upload từng file. Điều này cho phép comment chỉ có attachment, nhưng khi **mọi file upload đều fail hoặc bị bỏ dở**, comment đã được ghi vào DB không được rollback/xóa.

### 1. API cho phép `body = ''` chỉ dựa vào cờ do client gửi

`src/app/api/tasks/[id]/comments/route.ts:119-125`

```ts
const text = typeof body?.body === "string" ? body.body.trim() : "";
// An attachment-only comment is valid: the client creates the comment first,
// then uploads files against its id, so the text can legitimately be empty.
const hasAttachments = body?.hasAttachments === true;
if (!text && !hasAttachments)
  return NextResponse.json({ error: "Comment is empty." }, { status: 400 });
```

Khi người dùng đã chọn ít nhất một file, frontend gửi `hasAttachments: true`; API tạo comment dù tại thời điểm đó **chưa hề có attachment metadata/server row**.

### 2. Frontend tạo durable comment trước khi upload file

`src/app/(authed)/tasks/_components/CommentThread.tsx:1058-1072`

```ts
const res = await fetch(`${apiBase}/${taskId}/comments`, {
  method: "POST",
  body: JSON.stringify({
    body,
    parentId,
    hasAttachments: files.length > 0,
    client_request_id: requestId,
  }),
});
({ comment } = await res.json());
```

Sau request này, comment đã tồn tại bền vững trong `task_comments`.

### 3. Upload từng file có thể fail, nhưng không có cleanup cho comment rỗng

`src/app/(authed)/tasks/_components/CommentThread.tsx:1163-1185`

```ts
const upload = await fetch(`${apiBase}/${taskId}/attachments`, {
  method: "POST",
  headers: mutationHeaders(),
  body: form,
});
if (!upload.ok) {
  throw new Error(await readResponseError(upload, "Failed to upload attachment."));
}
```

Khi upload fail, code đánh dấu file optimistic là `failed` và trả `false`. Sau toàn bộ batch, code chỉ reload UI; không gọi API để xóa comment nếu `uploadedAny === false`.

```ts
const uploadFailed = outcomes.some((ok) => !ok);
const uploadedAny = outcomes.some(Boolean);
if (uploadedAny) onCommitted?.();
// Không có nhánh delete comment khi !uploadedAny && body.trim() === ""
```

Nếu người dùng refresh, đóng drawer hoặc optimistic state bị thay thế sau đó, dấu hiệu upload-failed biến mất; DB còn một comment hoàn toàn rỗng.

### 4. Schema không thể ngăn trạng thái này

`supabase/schema.sql:1947-1956` khai báo `task_comments.body text not null`, nhưng `NOT NULL` vẫn chấp nhận chuỗi rỗng `''`.

Không thể chỉ thêm `CHECK (btrim(body) <> '')`, vì attachment-only comment là use case hợp lệ. Một `CHECK` row-level cũng không thể kiểm tra trực tiếp sự tồn tại của row bên `task_attachments`.

---

## Luồng tái hiện

1. Mở một task và để phần comment trống.
2. Chọn ít nhất một file/ảnh rồi bấm gửi.
3. Request `POST /api/tasks/:id/comments` thành công, vì `hasAttachments: true`.
4. Làm upload attachment thất bại (mất mạng, file bị backend từ chối, đóng tab/drawer, hoặc hủy request sau khi comment đã tạo).
5. Mở lại task hoặc reload trang.
6. Một comment không body và không attachment vẫn hiện trong timeline.

Với upload thành công, cùng luồng này tạo comment không body **có** thumbnail — đó là hành vi hợp lệ, không phải bug.

---

## Impact

- Timeline bị nhiễu bởi activity trống; user có thể tin rằng app đã gửi duplicate comment.
- Badge comment count tăng dù không có trao đổi hữu ích.
- Người quản lý/auditor không phân biệt được failed upload với attachment-only comment hợp lệ sau khi reload.
- Càng upload qua mạng yếu hoặc gửi nhiều file, khả năng để lại orphan càng cao.

Không thấy dấu hiệu làm mất hoặc ghi nhầm attachment: attachment metadata hợp lệ vẫn liên kết đúng `comment_id` và `task_id`.

---

## Hướng sửa đề xuất

### Fix bắt buộc — cleanup sau batch upload thất bại hoàn toàn

Trong `CommentThread.persistComment`, sau khi chờ toàn bộ `outcomes`:

- nếu `body.trim() === ''`;
- và `uploadedAny === false`;
- gọi endpoint/RPC soft-delete comment vừa tạo;
- bỏ optimistic row và báo lỗi upload rõ ràng cho user.

Không cleanup khi có ít nhất một attachment upload thành công: comment attachment-only là hợp lệ, kể cả khi một file khác trong batch fail.

### Cải thiện kiến trúc — không tạo comment rỗng trước khi có attachment hợp lệ

Ưu tiên một trong hai thiết kế sau:

1. Upload object/metadata thành công trước, sau đó tạo comment và attach các file trong một server command; hoặc
2. Vẫn tạo comment trước để giữ UX hiện tại, nhưng API lưu trạng thái `pending_attachment` riêng và chỉ publish/render timeline sau khi có attachment đầu tiên. Job/endpoint cleanup xóa các pending comment quá hạn.

Phương án 1 cho dữ liệu sạch nhất, nhưng cần thay đổi API upload để có một upload session/token thay vì bắt buộc `comment_id` từ đầu.

### Guard ở backend

Không tin riêng `hasAttachments` của client như điều kiện dữ liệu cuối cùng. Có thể giữ cờ đó để mở upload session, nhưng cần một server-side invariant ở bước hoàn tất:

- comment có body khác rỗng; **hoặc**
- comment có ít nhất một `task_attachments` active.

Vì invariant liên bảng, nên thực hiện qua RPC/transaction hoặc periodic audit + cleanup, không nên dùng `CHECK` đơn giản trên `task_comments`.

### Cleanup dữ liệu cũ

Trước khi xóa, query các comment có:

```sql
where c.deleted_at is null
  and btrim(c.body) = ''
  and not exists (
    select 1
    from task_attachments a
    where a.comment_id = c.id
      and a.deleted_at is null
  )
```

Tạo report/backup danh sách trước; sau khi product owner xác nhận, dùng existing soft-delete command để không mất audit trail. Không hard-delete các comment attachment-only.

---

## Acceptance criteria

- Gửi file thành công với body trống vẫn tạo đúng một comment có attachment.
- Gửi body trống và tất cả upload thất bại/ bị hủy không để lại comment trong timeline sau reload.
- Gửi text không attachment vẫn hoạt động như hiện tại.
- Batch gồm nhiều file: nếu ít nhất một file thành công, comment được giữ lại và file fail có retry state rõ ràng.
- Comment count chỉ tính comment có text hoặc tối thiểu một attachment active.
- Có migration/script audit cho existing orphan empty comments; script mặc định chỉ report, không tự xóa.

---

## Out of scope

- Không coi attachment-only comment là lỗi.
- Không cleanup tự động các record production đã tồn tại khi chưa có xác nhận owner.
- Không thay đổi quyền comment hay luồng edit/delete comment ngoài invariant nêu trên.
