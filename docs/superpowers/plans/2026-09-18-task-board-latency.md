# Giảm độ trễ Task Board — Implementation Plan

> **Cho người thực hiện:** dùng `superpowers:subagent-driven-development` hoặc
> `superpowers:executing-plans`. Các bước có ô `- [ ]` để đánh dấu.

**Mục tiêu:** Cắt phần lớn độ trễ mà người dùng cảm nhận trên Task Board, bằng
cách sửa ba thứ đã ĐO ĐƯỢC, không đụng vào những thứ đã đo và thấy vô can.

**Kiến trúc:** Next.js 16.2.4 App Router · React 19 · Supabase PostgREST ·
Vercel (sin1) · NextAuth v5 beta · ~43 người dùng nội bộ.

## Ràng buộc chung

- Node 22: `export PATH="$HOME/.nvm/versions/node/v22.12.0/bin:$PATH"`
- **Không chạy `npm run build`** khi dev server đang chạy. Dùng `npx tsc --noEmit`.
- Mọi thay đổi logic phải ghi vào `changelog.md`.
- Kiểm chứng bắt buộc sau mỗi task: `npx tsc --noEmit` và `npx vitest run`
  (mốc hiện tại: **172 file, 1.387 bài, đạt hết**).

---

## 1. Cách đo (dựng sẵn, dùng lại cho mọi task)

Route `src/app/api/tasks/notifications/route.ts` và vài route khác đã trả header
`Server-Timing`. Để tự gọi endpoint có xác thực mà không cần trình duyệt, mint
một cookie phiên bằng chính `AUTH_SECRET` của dự án:

```js
// đặt tạm ở gốc repo rồi XOÁ sau khi chạy
import fs from "node:fs";
import { encode } from "@auth/core/jwt";
const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; })
);
const cookie = await encode({
  salt: "authjs.session-token",
  secret: env.AUTH_SECRET,
  token: {
    email: "khang.nguyen@excelplannings.com",
    sub: "khang.nguyen@excelplannings.com",
    role: "admin", roles: ["admin"],
    permissions: ["task.manage", "task.work", "automation.provider_finder"],
    agentId: null,
    rbacRefreshedAt: Date.now(),   // đổi thành Date.now() - 3600_000 để ép làm mới RBAC
  },
});
fs.writeFileSync("/tmp/cookie.txt", cookie);
```

Đo:

```bash
curl -s -D - -o /dev/null -w "wall=%{time_total}s bytes=%{size_download}\n" \
  -H "Cookie: authjs.session-token=$(cat /tmp/cookie.txt)" \
  "http://localhost:3000/api/tasks" | grep -iE "^server-timing|wall="
```

**`wall − route_total` = thời gian tiêu trước khi vào route handler.** Đó chính
là chỗ `proxy.ts` chạy, và là con số quan trọng nhất của Task 1.

---

## 2. Số đo hiện trạng (dev server, 2026-09-18)

| Đường | wall | route_total | Khoảng trống (proxy) |
| --- | ---: | ---: | ---: |
| `/api/auth/csrf` (NGOÀI matcher) | 60–64 ms | — | — |
| `/api/tasks/notifications?mode=summary` | 1,22–1,50 s | 703–838 ms | **480–660 ms** |
| `/api/tasks` | 2,11–2,57 s | 1.802–1.959 ms | ~300–600 ms |

Chi tiết `/api/tasks`: `auth;dur=291–371` · `tasks;dur=1478–1572` ·
**400.107 byte** trả về.

Dữ liệu production: 272 task · 4.361 comment (**~250/ngày thường**) ·
19.746 thông báo (**2,31/comment** sau bản sửa 16/09) · 52% chưa đọc.

> **[Claude]** Mọi con số trên đo từ **dev server trên laptop**, nên chặng
> laptop→Supabase (~300–400 ms cho một truy vấn đơn) nằm trong đó. Trên
> production Vercel sin1 ↔ Supabase gần nhau, chặng này co lại nhiều. **Điều đó
> KHÔNG làm Task 1 và Task 2 mất giá trị**, vì cả hai đo bằng *số lần* lặp công
> việc chứ không phải bằng mili giây mạng: proxy chạy `auth()` thừa một lần cho
> mọi request, và một comment làm mọi board nạp lại 400 KB. Nhưng **phải đo lại
> trên production** bằng `Server-Timing` trong DevTools trước khi tuyên bố thắng.

## 3. Những thứ ĐÃ ĐO và thấy VÔ CAN — đừng làm lại

| Nghi can | Vì sao loại |
| --- | --- |
| Chỉ mục `task_notifications` | Truy vấn danh sách ~0 ms trên mốc sàn mạng. DB nhàn ở quy mô này. |
| Payload task board quá nặng vì nhiều cột | 419 KB thô ≈ 113 KB sau gzip. Bình thường. |
| `auth()` đi database mỗi request | Response CÓ `set-cookie: authjs.session-token`, token xoay vòng; làm mới RBAC 5 phút/lần (`src/auth.ts:33`). |
| Leaflet nạp nặng | `await import("leaflet")` — nạp động. Dòng import ở đầu file là `import type`, biên dịch xong biến mất. |
| `fetchAvatarDirectory` chạy mọi trang | Đã bọc `cache()` (`src/lib/people/avatar-directory.ts:21`). |
| Khuếch đại ghi thông báo gây chậm | Nằm trong `after()` (`comments/route.ts:189`) → **không chặn phản hồi**. Vẫn là nợ, nhưng không phải nợ latency. |

---

## Task 1 — `proxy.ts` không được kéo cả NextAuth vào middleware

**Khoản lớn nhất đo được: 480–660 ms trên MỌI request.**

`src/proxy.ts` (7 dòng, toàn bộ):

```ts
export { auth as proxy } from "@/auth";

export const config = {
  matcher: [
    "/((?!api/auth|api/cron|signin|_next/static|_next/image|favicon.ico|image|images|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico)$).*)",
  ],
};
```

Next.js 16 đổi tên `middleware.ts` → **`proxy.ts`**. File này export thẳng `auth`
từ `@/auth`, mà `@/auth` kéo theo `bcryptjs`, `@supabase/supabase-js` và
`@/lib/rbac/access`. Middleware vì thế chạy **toàn bộ** cấu hình NextAuth — kể cả
nhánh làm mới RBAC có truy vấn database — cho mọi trang và mọi `/api/*`.

**Files:**
- Tạo: `src/auth.config.ts`
- Sửa: `src/auth.ts`
- Sửa: `src/proxy.ts`

**Các bước:**

- [ ] **Bước 1: Đo mốc trước khi sửa**

```bash
curl -s -D - -o /dev/null -w "wall=%{time_total}s\n" \
  -H "Cookie: authjs.session-token=$(cat /tmp/cookie.txt)" \
  "http://localhost:3000/api/tasks/notifications?mode=summary" | grep -iE "^server-timing|wall="
```
Ghi lại `wall` và `route_total`. Kỳ vọng hiện tại: wall ≈ 1,2–1,5 s, khoảng
trống 480–660 ms.

- [ ] **Bước 2: Tách phần cấu hình KHÔNG cần database**

Tạo `src/auth.config.ts` — **không provider, không callback chạm database**:

```ts
import type { NextAuthConfig } from "next-auth";

/**
 * Cấu hình dùng cho `proxy.ts` (middleware của Next 16).
 *
 * CỐ Ý không có providers và không có callback nào chạm database: middleware
 * chạy trước MỌI request, nên mọi thứ kéo vào đây đều nhân lên theo lượt truy
 * cập. Trước đây `proxy.ts` export thẳng `auth` từ `@/auth`, kéo theo bcryptjs +
 * supabase-js + lớp RBAC, tốn 480–660 ms mỗi request.
 *
 * Việc kiểm quyền thật vẫn nằm ở `requireAnyPermission` trong route/page.
 */
export const authConfig = {
  providers: [],
  pages: { signIn: "/signin" },
  callbacks: {
    // Chỉ quyết định "đã đăng nhập hay chưa" từ JWT đã giải mã. Không tra cứu gì.
    authorized({ auth }) {
      return Boolean(auth?.user?.email);
    },
  },
} satisfies NextAuthConfig;
```

- [ ] **Bước 3: Cho `src/auth.ts` dùng lại nền đó**

Ở đầu `src/auth.ts`, thêm import và trải cấu hình nền vào lời gọi `NextAuth({...})`:

```ts
import { authConfig } from "./auth.config";

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  providers: [ /* Google + Credentials như cũ */ ],
  // callbacks jwt/session giữ nguyên
});
```

- [ ] **Bước 4: Cho `proxy.ts` dùng bản nhẹ**

```ts
import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

// Chỉ dựng instance từ cấu hình nhẹ. KHÔNG import từ "@/auth" — làm vậy là kéo
// lại bcryptjs/supabase/rbac vào bundle middleware.
export const { auth: proxy } = NextAuth(authConfig);

export const config = {
  matcher: [
    "/((?!api/auth|api/cron|signin|_next/static|_next/image|favicon.ico|image|images|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico)$).*)",
  ],
};
```

- [ ] **Bước 5: Kiểm chứng**

```bash
npx tsc --noEmit && npx vitest run
```
Rồi đo lại đúng lệnh ở Bước 1. **Kỳ vọng: khoảng trống `wall − route_total` tụt
xuống dưới 100 ms.**

Kiểm bằng tay, bắt buộc: đăng xuất → vào `/tasks` phải bị đẩy về `/signin`;
đăng nhập lại phải vào được; một tài khoản KHÔNG có quyền task phải bị đẩy đi
đúng như trước.

- [ ] **Bước 6: Ghi changelog và commit**

```bash
git add src/auth.config.ts src/auth.ts src/proxy.ts changelog.md
git commit -m "perf(auth): proxy.ts dùng cấu hình nhẹ, không kéo bcrypt/supabase vào middleware"
```

> **[Claude]** Tôi **không** đề xuất bỏ hẳn kiểm tra ở middleware. Nó vẫn cần để
> chặn người chưa đăng nhập trước khi vào trang. Thứ phải bỏ là *việc tra cứu
> database và giải mã nặng* trong middleware, không phải bản thân việc gác cửa.

---

## Task 2 — Comment không được làm mọi board nạp lại toàn bộ danh sách

**Cơ chế duy nhất tăng theo khối lượng comment — đúng khiếu nại gốc.**

Hiện tại: mỗi comment → `broadcastTasksChanged(sourceId)`
(`src/app/api/tasks/[id]/comments/route.ts:239`) → bắn vào **một topic toàn cục**
`TASKS_TOPIC = "tasks-stream"` (`src/lib/tasks/realtime-topics.ts:6`) → **mọi**
board đang mở nhận được (`TaskBoardClient.tsx:832`) → `clearCachedTaskDetails()`
(xoá cache detail của *tất cả* task, dòng 838) + nạp lại `/api/tasks`.

Chi phí đo được mỗi lần nạp lại: **400.107 byte, wall 2,1–2,6 s**.
Tần suất: **~250 comment/ngày thường** (15/09: 368, 17/09: 266).
Có throttle 5 giây (`TASK_LIVE_REFRESH_THROTTLE_MS`, `src/lib/tasks/live-sync.ts:11`),
nên trần là 720 lượt/giờ mỗi tab — nhưng trong giờ cao điểm vẫn là liên tục.

Đã có sẵn cơ chế hẹp hơn: `broadcastTaskRoom` / `taskRoomTopic`.

**Files:**
- Sửa: `src/app/api/tasks/[id]/comments/route.ts:239`
- Sửa: `src/app/(authed)/tasks/_components/TaskBoardClient.tsx:828-840`
- Test: `src/lib/tasks/live-sync.test.ts` (hoặc tạo mới nếu chưa có)

**Các bước:**

- [ ] **Bước 1: Viết bài kiểm thử thất bại trước**

Kiểm rằng một sự kiện comment **không** kích hoạt nạp lại danh sách:

```ts
import { describe, expect, it } from "vitest";
import { taskListScopeForEvent } from "@/lib/tasks/live-sync";

describe("taskListScopeForEvent", () => {
  it("comment KHÔNG làm nạp lại danh sách task", () => {
    // Comment chỉ đổi nội dung thảo luận của MỘT task. Nạp lại cả danh sách
    // 400KB cho mọi người đang mở board là cái giá không ai được lợi.
    expect(taskListScopeForEvent({ kind: "comment", taskId: "t1" })).toBeNull();
  });

  it("đổi trạng thái/assignee VẪN làm nạp lại danh sách", () => {
    expect(taskListScopeForEvent({ kind: "status", taskId: "t1" })).toBe("tasks-only");
  });
});
```

- [ ] **Bước 2: Chạy cho nó trượt**

```bash
npx vitest run src/lib/tasks/live-sync.test.ts
```
Kỳ vọng: FAIL — `taskListScopeForEvent` chưa tồn tại.

- [ ] **Bước 3: Cài đặt tối thiểu**

Thêm vào `src/lib/tasks/live-sync.ts`:

```ts
export type TaskLiveEvent = { kind: string; taskId: string };

/**
 * Sự kiện này có đáng nạp lại CẢ danh sách task không?
 *
 * Comment thì không: nó chỉ đổi phần thảo luận bên trong một task, mà danh sách
 * không hiển thị thảo luận. Trước đây mọi comment đều bắn vào topic toàn cục
 * `tasks-stream`, khiến mọi board đang mở nạp lại 400KB — với ~250 comment/ngày
 * thì đó là hàng trăm lượt nạp lại mà không ai được lợi.
 */
export function taskListScopeForEvent(event: TaskLiveEvent): "tasks-only" | null {
  return event.kind === "comment" ? null : "tasks-only";
}
```

- [ ] **Bước 4: Chạy lại cho xanh**

```bash
npx vitest run src/lib/tasks/live-sync.test.ts
```

- [ ] **Bước 5: Đổi đường comment sang room riêng của task**

Ở `src/app/api/tasks/[id]/comments/route.ts:239`, thay `broadcastTasksChanged(sourceId)`
bằng `broadcastTaskRoom(taskId, sourceId)`. Ở `TaskBoardClient.tsx:838`, **bỏ**
`clearCachedTaskDetails()` toàn cục trên nhánh comment — chỉ xoá cache của đúng
task nhận được id.

- [ ] **Bước 6: Kiểm chứng bằng tay, bắt buộc**

Mở hai trình duyệt cùng vào board. Ở trình duyệt A đăng một comment vào một task.
- Trình duyệt B: drawer của **đúng task đó** phải hiện comment mới.
- Trình duyệt B: **không** được thấy cả bảng chớp/nạp lại.
- Kiểm tab Network của B: **không** có lượt gọi `/api/tasks` nào phát sinh.

Rồi đổi trạng thái một task ở A — lúc này B **phải** cập nhật danh sách.

- [ ] **Bước 7: `npx tsc --noEmit && npx vitest run`, ghi changelog, commit**

> **[Claude]** Đây là chỗ tôi **suýt bỏ sót hoàn toàn**. Bốn giả thuyết đầu của
> tôi đều đo *một request đơn lẻ*, trong khi khiếu nại là "nhiều task và comment
> nên chậm" — tức vấn đề nằm ở **số lượng request**, không phải giá của một
> request. Bài học: khi khiếu nại nhắc tới khối lượng, hãy đếm *số lần* trước khi
> đo *mỗi lần*.

---

## Task 3 — `/api/tasks` trả 400 KB cho một bảng không dùng hết

`tasks;dur=1478–1572 ms` và 400.107 byte. Cột `description` chiếm 41,5 KB (10%)
mà bảng danh sách **không hiển thị** — nó chỉ xuất hiện trong drawer chi tiết,
nơi đã có route riêng (`/api/tasks/[id]/detail`).

**Files:**
- Sửa: `src/lib/tasks/queries.ts` (danh sách cột của `fetchTasksForActor`)
- Test: `src/lib/tasks/queries.test.ts`

**Các bước:**

- [ ] **Bước 1: Đo mốc** — ghi lại `bytes` và `tasks;dur` theo lệnh ở mục 1.
- [ ] **Bước 2: Viết test** khẳng định danh sách cột trả về **không** chứa
      `description`, và **có** đủ các cột bảng đang vẽ.
- [ ] **Bước 3: Chạy cho trượt.**
- [ ] **Bước 4: Bỏ `description` khỏi `select` của đường danh sách.**
- [ ] **Bước 5: Chạy lại cho xanh, rồi đo lại** — kỳ vọng bytes giảm ~10%.
- [ ] **Bước 6: Kiểm bằng tay** — mở drawer một task, phần mô tả vẫn phải hiện
      đầy đủ (nó đến từ route detail, không phải từ danh sách).
- [ ] **Bước 7: changelog + commit.**

> **[Claude]** Task này **nhỏ hơn vẻ ngoài của nó**: bỏ 10% của 400 KB chỉ còn
> 360 KB, mà sau Task 2 thì số lần nạp lại đã giảm mạnh rồi. Tôi xếp nó thứ ba
> chính vì vậy — làm sau, và **chỉ làm nếu đo trên production còn thấy chậm**.
> Đừng làm task này trước Task 2.

---

## Task 4 — Gộp `auth()` trùng lặp bằng `cache()`

Sau Task 1, middleware đã nhẹ. Nhưng trên đường dựng trang, `auth()` vẫn chạy
**hai lần**: `src/app/(authed)/layout.tsx:20` và `src/lib/rbac/server.ts:34`
(qua `requireAnyPermission`, gọi từ `src/app/(authed)/tasks/page.tsx:30`).

Đo được: mỗi lần **283–365 ms** khi rơi vào nhịp làm mới RBAC 5 phút.

**Files:**
- Tạo: `src/lib/auth/session.ts`
- Sửa: `src/app/(authed)/layout.tsx`, `src/lib/rbac/server.ts`

**Các bước:**

- [ ] **Bước 1:** Tạo `src/lib/auth/session.ts`:

```ts
import { cache } from "react";
import { auth } from "@/auth";

/**
 * Phiên đăng nhập, chỉ giải mã MỘT lần cho mỗi lượt dựng trang.
 *
 * Layout và lớp kiểm quyền đều cần phiên, nên `auth()` chạy hai lần cho cùng
 * một request. `cache()` của React gộp chúng lại trong phạm vi một request —
 * không có bộ nhớ đệm toàn tiến trình, nên không có chuyện quyền của người này
 * rò sang người khác.
 */
export const getSession = cache(async () => auth());
```

- [ ] **Bước 2:** Thay `auth()` bằng `getSession()` ở `layout.tsx` và
      `rbac/server.ts`. **KHÔNG** đổi trong `src/proxy.ts` — middleware nằm
      ngoài phạm vi request của React, `cache()` không với tới.
- [ ] **Bước 3:** `npx tsc --noEmit && npx vitest run`.
- [ ] **Bước 4: Kiểm bằng tay** — đổi quyền một tài khoản trong `/config`, đợi
      quá 5 phút, tải lại: quyền mới phải có hiệu lực (chứng minh `cache()` chỉ
      gộp trong một request, không giữ qua các request).
- [ ] **Bước 5:** changelog + commit.

---

## Task 5 — Gộp thông báo (ĐỂ CUỐI, chỉ làm khi đã quyết)

19.746 thông báo, +6.000/tuần, **52% chưa đọc**, người nặng nhất 2.617 chưa đọc.
Tỷ lệ hiện tại **2,31 thông báo/comment** (đã giảm từ 3 sau bản sửa 16/09).

> **[Claude]** Tôi **phản đối làm task này như một việc giảm latency**, và đây là
> chỗ tôi không đồng ý với cách đặt vấn đề ban đầu. Toàn bộ khâu sinh thông báo
> nằm trong `after()` (`comments/route.ts:189`) → **đã không chặn phản hồi**.
> Nó là vấn đề **phình database và nhiễu trải nghiệm**, không phải độ trễ. Làm nó
> trước Task 1/2 là sửa sai chỗ.

Nếu vẫn quyết làm, đây là những cạm bẫy phải xử lý trước khi viết dòng code nào:

| Cạm bẫy | Vì sao |
| --- | --- |
| Mất `comment_id` | Chuông đang deep-link tới đúng comment (`detail/route.ts` nhận `comment_id`). Gộp về 1 dòng/(người, task) là mất đường nhảy đó. |
| Mất `actor_email` | Không hiện được "X và 2 người khác". |
| Đua ghi đồng thời | `insertNotifications` (`notifications.ts:94`) là bulk INSERT thuần, **không có upsert**. Cần unique index `(recipient_email, task_id, type)` — **hiện chưa tồn tại**. |
| Sắp xếp sai | Bật lại `is_read=false` trên dòng cũ mà vẫn `order by created_at` thì hoạt động mới bị xếp như tin cũ. Phải theo `updated_at`, mà chỉ mục hiện tại không phủ cột đó. |
| Realtime/push đếm theo `rows.length` | `broadcastNotif` và `pushForTaskNotifications` nhận `rows`; gộp làm số dòng đổi → người dùng mất ping từ comment thứ hai trở đi. |

- [ ] **Việc cần làm trước tiên, độc lập:** kiểm xem `schedulePush`
      (`src/lib/tasks/notifications.ts:124-131`) gọi `after()` **lồng bên trong**
      `after()` của `comments/route.ts:189` có thật sự chạy không. Khối `catch`
      ở đó nuốt lỗi im lặng — nếu Next 16 không cho `after()` lồng nhau thì
      web-push **đã chết** trên đường comment mà không ai biết. Đây là một **lỗi
      tiềm ẩn riêng**, không liên quan tới việc gộp.

---

## 4. Thứ tự thực hiện

1. **Task 1** — khoản lớn nhất, áp lên mọi request.
2. **Task 2** — thứ duy nhất tăng theo khối lượng comment.
3. **Đo lại trên production** bằng `Server-Timing` trong DevTools. *Chỉ làm tiếp
   nếu còn chậm.*
4. Task 3, Task 4.
5. Task 5 — chỉ khi đã quyết đây là vấn đề phình dữ liệu, không phải latency.

## 5. Nhật ký

| Việc | Commit | Kiểm chứng |
| --- | --- | --- |
| Gắn `Server-Timing` vào route chuông | *(chưa commit)* | tsc sạch, 1.387 test đạt |
| Task 1–5 | chưa làm | — |
