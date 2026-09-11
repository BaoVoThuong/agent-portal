# Web Push — đẩy thông báo ra ngoài trình duyệt

**Ngày:** 2026-09-10
**Yêu cầu gốc:** *"noti pop up bên ngoài màn hình luôn — không chỉ ở trên web"*
**Phạm vi đã chốt với người dùng:**
- Chỉ **máy tính** (Chrome/Edge trên Mac & Windows). Điện thoại tách đợt sau.
- Đẩy **mọi loại** thông báo, nhưng **chỉ khi người nhận không mở tab** portal.

---

## 1. Hiện trạng — thông báo đang chạy thế nào

Toàn bộ thông báo đi qua **đúng hai cửa**, và đây là lý do việc này khả thi mà
không phải sờ vào 13 route:

| Cửa | File | Ghi vào bảng |
|---|---|---|
| Task | `insertNotifications()` — `src/lib/tasks/notifications.ts:86` | `task_notifications` |
| Enrollment | `insertEnrollmentNotifications()` — `src/lib/enrollment/notifications.ts:14` | `enrollment_notifications` |

Cả hai kết thúc bằng cùng một việc:

```ts
// tasks/notifications.ts:96
// Realtime "ping" so recipients' open tabs toast instantly (content stays in DB).
return broadcastNotif(rows.map((r) => r.recipient_email));
```

Nghĩa là hôm nay thông báo **chỉ tồn tại khi tab đang mở**: `broadcastNotif` đẩy
một tín hiệu qua Supabase Realtime, `NotificationBell` nghe được thì kêu chuông
(`src/lib/tasks/sound.ts` — arpeggio tự tổng hợp, không có file âm thanh) và
hiện toast. Đóng tab là không ai biết gì cho tới lần mở sau.

Nội dung hiển thị (`"tagged you in a comment"`, `"assigned you to a task"`) được
dựng **ở client**, trong `NotificationBell.tsx:122 actionText()` và
`notificationHref()`. Server chưa bao giờ cần biết câu chữ.

Chưa có: service worker, manifest, package `web-push`, bảng subscription. Kiểm
bằng `grep -rn "web-push\|serviceWorker" package.json src` → không kết quả.

---

## 2. Web Push hoạt động ra sao (đủ để đọc plan)

Bốn mảnh, thiếu một là không chạy:

1. **Service worker** — file JS chạy nền, sống cả khi tab đóng. Nó là thứ *duy
   nhất* có quyền hiện thông báo hệ điều hành khi không có tab nào.
2. **Subscription** — trình duyệt cấp cho mỗi người-mỗi-máy một "địa chỉ đẩy"
   (endpoint URL + 2 khoá mã hoá). Server phải lưu lại để sau này gửi tới.
3. **VAPID** — một cặp khoá công/tư định danh server mình với dịch vụ đẩy của
   Google/Microsoft. Khoá công gửi cho trình duyệt lúc đăng ký, khoá tư ký mỗi
   lần gửi.
4. **Người gửi** — server gọi tới endpoint đó kèm payload đã mã hoá. Dịch vụ đẩy
   chuyển tiếp xuống máy người dùng, đánh thức service worker.

Điểm quan trọng: **server không gửi thẳng tới máy người dùng**. Nó gửi tới
Google/Microsoft, và họ chuyển tiếp. Nên máy người nhận tắt cũng không sao —
thông báo được xếp hàng và giao khi máy bật lại.

---

## 3. Quyết định thiết kế

### 3.1 "Chỉ khi không mở tab" — để service worker tự quyết, không dùng presence

Cách sai (tốn kém): server theo dõi ai đang online rồi mới quyết định gửi. Phải
dựng heartbeat, phải xử lý mất kết nối, và vẫn sai khi người dùng vừa đóng máy.

Cách đúng: **cứ gửi**, và service worker kiểm ngay trước khi hiện:

```js
const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
const hasVisibleTab = windows.some((client) => client.visibilityState === "visible");
if (hasVisibleTab) return; // chuông + toast trong web đã lo rồi
```

Rẻ, luôn đúng, và không thêm hạ tầng nào. Đổi lại là một lần gửi thừa khi người
dùng đang mở tab — không đáng kể so với việc dựng presence.

### 3.2 Nội dung thông báo phải chuyển lên server

`actionText()` đang nằm trong `NotificationBell.tsx` (client component). Push cần
`title` và `body` **lúc gửi**, tức ở server. Bước 2 dưới đây tách hàm này ra
`src/lib/notifications/copy.ts` để cả bell lẫn push đọc cùng một nguồn — nếu
không, câu chữ trong web và câu chữ ngoài màn hình sẽ trôi lệch nhau theo thời gian.

### 3.3 Gửi push KHÔNG được nằm trong đường request

Một comment có thể sinh 10 thông báo. Gọi 10 lượt HTTP tới Google trước khi trả
lời request là biến một thao tác 200ms thành 2 giây.

Next 16 có `after()` (`import { after } from "next/server"`) — chạy sau khi
response đã gửi, và trên Vercel nó giữ function sống đủ lâu để hoàn tất. Đây là
lý do **không** dùng `void promise` thả trôi: serverless kết thúc tiến trình ngay
sau response, promise thả trôi sẽ bị giết giữa chừng.

### 3.4 Một người có nhiều máy

Agent dùng cả máy bàn lẫn laptop → nhiều subscription cho cùng một email. Bảng
lưu theo `endpoint` (khoá chính tự nhiên, duy nhất toàn cầu), không theo email.

---

## 4. Các bước triển khai

### Bước 1 — Schema + cấu hình (rollout SQL, không đổi hành vi)

`supabase/rollouts/2026-09-XX-web-push.sql`:

```sql
create table if not exists push_subscriptions (
  endpoint text primary key,
  recipient_email text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  -- Đếm số lần gửi hỏng liên tiếp; xem §6 về việc dọn subscription chết.
  failure_count integer not null default 0
);

create index if not exists push_subscriptions_recipient_idx
  on push_subscriptions (recipient_email);

-- Bật/tắt theo từng người. Gộp luôn cả cờ ÂM THANH ở đây, vì đó là một yêu cầu
-- riêng trong cùng đợt feedback ("noti có tiếng có thể bật tắt, Bảo quyết định
-- ai bật ai tắt") và hai thứ này luôn được đọc cùng nhau.
create table if not exists notification_preferences (
  email text primary key,
  push_enabled boolean not null default true,
  sound_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by_email text
);
```

Env cần thêm (Vercel + `.env.local`):
```
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:bao.vo@excelplannings.com
```
Sinh bằng `npx web-push generate-vapid-keys`. **Đổi khoá về sau là giết toàn bộ
subscription đã đăng ký** — sinh một lần rồi giữ.

`npm i web-push` (chỉ chạy ở server, Node runtime — không dùng được trên edge).

### Bước 2 — Tách câu chữ thông báo ra khỏi component

Chuyển `actionText()`, `notificationHref()`, `entityKind()`, `entityLabel()` từ
`NotificationBell.tsx` sang `src/lib/notifications/copy.ts` (hàm thuần, có test).
`NotificationBell` import lại từ đó. Không đổi hành vi — đây là bước dọn đường.

### Bước 3 — Service worker + đăng ký ở client

- `public/sw.js`: nghe `push`, dựng `showNotification`, và xử lý `notificationclick`
  → focus tab đang mở hoặc mở `notificationHref`. Kèm nhánh bỏ qua khi có tab
  visible (§3.1).
- `src/lib/notifications/push-client.ts`: `subscribeToPush()` /
  `unsubscribeFromPush()` — đăng ký service worker, xin quyền, gửi subscription
  lên `/api/notifications/push/subscribe`.
- Nút bật/tắt trong Settings (không phải trong chuông): **chỉ xin quyền khi người
  dùng bấm**. Xin lúc tải trang là Chrome chặn và người dùng bấm Deny theo phản xạ
  — mà **Deny thì không hỏi lại được**, phải vào cài đặt trình duyệt gỡ tay.

### Bước 4 — API + người gửi

- `POST /api/notifications/push/subscribe` — lưu subscription cho email trong session.
- `DELETE /api/notifications/push/subscribe` — gỡ khi người dùng tắt.
- `src/lib/notifications/push-server.ts`:
  ```ts
  export async function sendPushToEmails(
    emails: string[],
    payload: { title: string; body: string; url: string; tag: string }
  ): Promise<void>
  ```
  Bên trong: lọc theo `notification_preferences.push_enabled`, lấy subscription,
  `Promise.allSettled` để một máy chết không chặn máy khác, và **xoá row khi dịch
  vụ đẩy trả 404/410** (subscription đã chết vĩnh viễn).

### Bước 5 — Móc vào hai cửa hiện có

Trong `insertNotifications()` và `insertEnrollmentNotifications()`, ngay cạnh
`broadcastNotif`:

```ts
after(() => sendPushToEmails(recipients, buildPushPayload(rows)));
```

Không sửa 13 route gọi tới. Mọi loại thông báo — 24 loại của task và các loại
của enrollment — có push cùng lúc.

### Bước 6 — Màn quản trị cho admin

Yêu cầu *"Bảo là người quyết định ai bật ai tắt"*: bảng trong Account Manager
liệt kê người + hai công tắc `push_enabled` / `sound_enabled`, ghi
`updated_by_email`. Đây là lý do §4 bước 1 gộp cờ âm thanh vào cùng bảng.

---

## 5. Việc cần người làm, không phải code

1. Sinh cặp khoá VAPID và đặt vào Vercel env (3 biến, cả Production lẫn Preview).
2. **Mỗi agent phải tự bấm "Cho phép"** một lần trên máy của họ. Không có cách
   nào bật hộ từ xa — đây là ràng buộc của trình duyệt.
3. **macOS**: ngoài quyền trong web, Chrome còn phải được bật thông báo ở
   *System Settings → Notifications → Chrome*, và tắt Focus/Do Not Disturb. Đây
   là chỗ vướng phổ biến nhất: web báo "đã cấp quyền" mà máy vẫn im.

---

## 6. Cạm bẫy đã biết

| Vấn đề | Xử lý |
|---|---|
| Subscription chết (đổi máy, xoá dữ liệu trình duyệt) | Dịch vụ đẩy trả **404/410** → xoá row ngay. Không xoá thì mỗi lần gửi đều tốn một request lỗi, và chậm dần theo thời gian. |
| Người dùng bấm Deny | Không hỏi lại được bằng code. Hiện hướng dẫn mở khoá trong cài đặt trình duyệt. |
| Đổi khoá VAPID | Mọi subscription cũ chết im lặng. Sinh một lần, giữ trong env, đừng commit. |
| Payload quá lớn | Giới hạn ~4KB. Chỉ gửi title/body/url/tag, không nhồi cả nội dung comment. |
| Cùng lúc kêu 2 lần | Ngăn bằng §3.1 (bỏ qua khi có tab visible) + `tag` trùng để trình duyệt gộp. |
| Service worker bị cache cũ | Trình duyệt giữ SW rất dai. Đặt số phiên bản trong `sw.js` và gọi `self.skipWaiting()`. |
| Localhost vs production | Web Push cần HTTPS; `localhost` được miễn nên test local vẫn chạy. |

---

## 7. Nghiệm thu

- Agent A đóng hết tab portal → agent B comment vào task của A → A thấy thông báo
  hệ điều hành trong vài giây, bấm vào mở đúng task.
- Agent A **đang mở** tab portal → chỉ nghe chuông trong web, **không** có thông
  báo ngoài màn hình.
- A bật thông báo trên hai máy → cả hai đều nhận.
- Admin tắt `push_enabled` của A → A không nhận nữa, nhưng chuông trong web vẫn kêu.
- Xoá dữ liệu trình duyệt của A rồi gửi tiếp → row subscription của A bị xoá tự
  động, không còn lỗi lặp lại trong log.

## 8. Ước lượng

| Bước | Khối lượng |
|---|---|
| 1 — Schema + env + cài package | 0.5 ngày |
| 2 — Tách câu chữ | 0.5 ngày |
| 3 — Service worker + đăng ký | 1 ngày |
| 4 — API + người gửi | 1 ngày |
| 5 — Móc vào hai cửa | 0.5 ngày |
| 6 — Màn quản trị | 0.5 ngày |

Tổng **~4 ngày công**, chưa tính thời gian đi từng máy agent bật quyền.
