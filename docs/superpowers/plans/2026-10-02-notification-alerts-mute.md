# Plan — Admin bật/tắt chuông & popup thông báo cho từng người

Ngày lập: 2026-10-02. Spec đã chốt với Bao trong buổi bàn cùng ngày.

**Liên quan:** [`2026-10-02-enrollment-golive-fixes.md`](./2026-10-02-enrollment-golive-fixes.md). Task 12 của plan đó cho Agent nhận thêm thông báo Enrollment, nên tính năng này nên ra **cùng đợt release**.

**Baseline đã deploy:** commit `a317b94` (`main`) đã pass full test/typecheck/lint/build và
được push lên cả `origin/main` và `vercel/main` ngày 2026-10-02. Plan này là đợt
tiếp theo, chưa triển khai code. Không chạy rollout hoặc deploy N1 trước khi
kiểm tra production schema và quyền RBAC hiện tại.

## Quy ước

- **Lệnh kiểm:** `npm run typecheck`, `npm run test:run`, `npm run lint`, `npm run build`.
- **Next.js 16:** đọc `node_modules/next/dist/docs/` trước khi dùng API của Next (xem `AGENTS.md`).
- **Changelog:** mọi thay đổi logic ghi vào `changelog.md`.
- **Commit:** plan này chỉ vào git cùng lượt với code hiện thực nó.
- **Số dòng** tính tại commit `f165592`.

---

## 1. Bối cảnh

Một số agent than nhận quá nhiều tiếng "ting ting". Hiện có **ba nguồn** báo động, và người dùng không tắt được nguồn nào:

| Nguồn | Ở đâu trong code | Khi nào bật |
|---|---|---|
| Tiếng chuông trong web | `playNotificationChime()` (`src/lib/tasks/sound.ts`), gọi từ `alertFreshNotifications` (`src/app/(authed)/_components/NotificationBell.tsx:159-195`) | Mỗi **đợt** thông báo mới: một đoạn arpeggio dài 1 giây, chỉ một tab phát (khoá chéo tab `claimNotificationAlert`) |
| Popup của hệ điều hành | `new Notification(...)` trong cùng `alertFreshNotifications` | Tab không được focus **và** máy chưa đăng ký Web Push (`shouldShowNativePopup`, `src/lib/notifications/alert-policy.ts`) |
| Web Push | Server gửi qua `sendPushToEmails` (`src/lib/notifications/push-server.ts`); `public/sw.js` hiện popup | Thông báo của Task CS (`src/lib/tasks/notifications.ts:105-106`) và Enrollment (`src/lib/enrollment/notifications.ts:35-40`). Time Off không có push. Hiện 10 người đã đăng ký |

**Luồng chuông hiện tại** (`NotificationBell.tsx`, hàm `load`):

```ts
const unseen = list.filter((n) => !seenIds.current.has(n.id));
const fresh = unseen.filter((n) => !n.is_read);
// … toast cho mọi `fresh` …
if (fresh.length > 0) {
  void alertFreshNotifications(fresh, pushSubscribedRef.current);   // chuông + popup HĐH
}
```

**Đã có sẵn trong DB.** Rollout `supabase/rollouts/2026-09-10-web-push.sql` đã tạo bảng:

```sql
create table if not exists notification_preferences (
  email text primary key,
  push_enabled boolean not null default true,
  sound_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by_email text   -- "Ai đổi — admin đổi hộ người khác thì phải truy được."
);
```

Ghi chú trong rollout nói cột `sound_enabled` dành cho đúng yêu cầu này: *"noti có tiếng có thể bật tắt — Bảo là người quyết định ai bật ai tắt"*. Hiện trạng đã kiểm (chỉ đọc):
- Production có bảng này, nhưng **0 dòng**.
- RLS đang bật: khoá anon đọc được 0 dòng ở cả `notification_preferences` lẫn `push_subscriptions`.
- **Chưa có code nào ghi** vào bảng. `push_enabled` chỉ được đọc ở `filterByPreference` (`push-server.ts:76-93`) để chặn **mọi** push của người đó.
- `supabase/schema.sql` **chưa có** hai bảng `notification_preferences` và `push_subscriptions`: rollout này chưa được ghi lại vào file schema.

**Nhóm thông báo "gọi đích danh"** đã có sẵn trong `src/lib/notifications/alert-policy.ts`:

```ts
const DIRECT_TYPES: ReadonlySet<NotificationCopyType> = new Set(["mentioned", "assigned", "unassigned", "reopened"]);
export function isDirectNotification(type: NotificationCopyType): boolean { return DIRECT_TYPES.has(type); }
```

---

## 2. Spec đã chốt

| | |
|---|---|
| **Ở đâu** | Account Manager. Mỗi dòng user có một công tắc **"Alerts"** On/Off. Rê chuột thấy "Muted by &lt;tên&gt; · Oct 2" |
| **Off nghĩa là** | Không tiếng chuông, không popup hệ điều hành, không Web Push |
| **Vẫn kêu khi** | Thông báo gọi đích danh: @mention, được giao (`assigned`), bị gỡ (`unassigned`), việc bị mở lại (`reopened`) |
| **Vẫn giữ** | Danh sách trong cái chuông, số đỏ, toast trong trang (không có tiếng). Agent không bỏ sót việc |
| **Áp dụng cho** | Mọi thông báo đi qua cái chuông: Task CS, Enrollment, Time Off |
| **Ai được đổi** | Chỉ người có quyền RBAC mới **`management.notification_alerts`** ("Notification Alerts"). Vẫn cần quyền Account Manager để vào trang. Agent **không** tự đổi được |
| **Mặc định gán quyền cho** | Role hệ thống "Admin". DB không có role tên "Super Admin". Muốn cho role khác (Sub Admin, Admin Health Task…) thì bật trong Role Manager |
| **Có hiệu lực** | Từ thông báo kế tiếp, không cần reload |

---

## 3. Thiết kế

- **Lưu ở đâu:** dùng lại `notification_preferences.sound_enabled`, với `false` nghĩa là "đã tắt chuông/popup". Không thêm cột. Ghi kèm `updated_by_email` và `updated_at`.
  - **Không** dùng `push_enabled`, vì cờ này chặn mọi push, kể cả thông báo gọi đích danh.
  - Người chưa có dòng nào trong bảng = đang bật (đúng mặc định của bảng), nên không cần backfill.
- **Đọc ở hai chỗ:**
  - **Chuông (client):** `GET /api/tasks/notifications` (bản đầy đủ) trả thêm `alertsMuted`. `NotificationBell.load()` chỉ đưa thông báo gọi đích danh vào `alertFreshNotifications` khi `alertsMuted` là true. Toast vẫn hiện cho mọi thông báo mới.
  - **Web Push (server):** `sendPushToEmails` nhận thêm `direct`. Người có `sound_enabled = false` bị loại khi thông báo **không** gọi đích danh.
- **Vì sao có hiệu lực ngay:** chuông gọi `load()` mỗi khi có thông báo mới (ping realtime hoặc poll), nên cờ được đọc lại đúng lúc cần phát tiếng. Không cần kênh realtime riêng cho việc đổi cờ.

---

## 4. Tasks

### N1 — Quyền RBAC mới + ghi lại vào schema

1. **Rollout `supabase/rollouts/2026-10-0X-notification-alerts-permission.sql`.** Theo mẫu `2026-09-21-task-import-permission.sql`. Phải chạy **trước** khi deploy code, vì `role_permissions.permission_key` có khoá ngoại tới `permissions(key)`.

   ```sql
   begin;
   insert into permissions (key, label, description, group_key, group_label, sort_order)
   values (
     'management.notification_alerts',
     'Notification Alerts',
     'Turn notification sounds, pop-ups and push on or off for each user in Account Manager. @mentions and assignments still alert.',
     'management', 'Management', 150
   )
   on conflict (key) do update set
     label = excluded.label, description = excluded.description,
     group_key = excluded.group_key, group_label = excluded.group_label, sort_order = excluded.sort_order;

   -- Role Admin vốn có mọi quyền, nên phải cấp quyền mới cho nó.
   insert into role_permissions (role_id, permission_key)
   select r.id, 'management.notification_alerts' from roles r where r.name = 'Admin'
   on conflict (role_id, permission_key) do nothing;
   commit;

   -- Kiểm chứng
   select key, label, sort_order from permissions where group_key = 'management' order by sort_order;
   select r.name, rp.permission_key from role_permissions rp join roles r on r.id = rp.role_id
   where rp.permission_key = 'management.notification_alerts';
   notify pgrst, 'reload schema';
   ```

   Đảo ngược: `delete from role_permissions where permission_key = 'management.notification_alerts'; delete from permissions where key = 'management.notification_alerts';`
2. **`src/lib/rbac/permissions.ts`:**
   - thêm `NOTIFICATION_ALERTS: "management.notification_alerts"` vào `PERMISSIONS`;
   - thêm một mục vào `PERMISSION_DEFINITIONS`: nhóm `management`, `sortOrder: 150`, label và description như SQL. Mục này nằm giữa Account Manager (100) và Role Manager (200).
3. **`supabase/schema.sql`:**
   - thêm dòng `management.notification_alerts` vào khối `insert into permissions` (khoảng dòng 163);
   - chép phần tạo bảng `notification_preferences` và `push_subscriptions` từ `2026-09-10-web-push.sql` vào schema;
   - đưa hai bảng này vào mảng `protected_tables`, để dựng lại DB từ schema cũng bật RLS.
4. **`src/lib/rbac/permissions.test.ts`:** thêm test cho key mới và definition của nó.

### N2 — Logic thuần, có test

File mới `src/lib/notifications/alert-preferences.ts`:

```ts
import { isDirectNotification } from "./alert-policy";
import type { NotificationCopyType } from "./copy";

/** Không có dòng = đang bật (mặc định của bảng). */
export function alertsMutedFromRow(row: { sound_enabled?: boolean | null } | null | undefined): boolean {
  return row?.sound_enabled === false;
}

/** Thông báo nào được phép kêu / bật popup cho người này. */
export function alertableNotifications<T extends { type: NotificationCopyType }>(
  items: readonly T[],
  alertsMuted: boolean,
): T[] {
  return alertsMuted ? items.filter((item) => isDirectNotification(item.type)) : [...items];
}

/** Ai còn được nhận Web Push cho một thông báo. */
export function pushAllowedEmails(
  emails: readonly string[],
  rows: readonly { email: string; push_enabled?: boolean | null; sound_enabled?: boolean | null }[],
  direct: boolean,
): string[] {
  const blocked = new Set(
    rows
      .filter((row) => row.push_enabled === false || (!direct && row.sound_enabled === false))
      .map((row) => row.email.trim().toLowerCase()),
  );
  return emails.filter((email) => !blocked.has(email.trim().toLowerCase()));
}
```

**Test `alert-preferences.test.ts`:**
- `alertsMutedFromRow`: không có dòng → false; `true` → false; `false` → true.
- `alertableNotifications`:
  - không bị tắt → giữ nguyên;
  - bị tắt → chỉ còn `mentioned`, `assigned`, `unassigned`, `reopened`;
  - các loại `commented`, `due_soon`, `overdue_reminder`, `record_created`, `stage_changed`, `qc_needed`… bị bỏ.
- `pushAllowedEmails`:
  - `push_enabled = false` → luôn bị chặn;
  - `sound_enabled = false` → bị chặn khi `direct = false`, vẫn được khi `direct = true`;
  - so email không phân biệt hoa/thường.

### N3 — API bật/tắt

File mới `src/app/api/admin/users/[id]/notification-alerts/route.ts`. Theo cách kiểm quyền của `src/app/api/admin/users/[id]/route.ts`, tức `auth()` + `can()` từ `@/lib/rbac/client`.

```ts
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const actorEmail = session?.user?.email;
  if (!actorEmail) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(session.user.permissions, PERMISSIONS.NOTIFICATION_ALERTS)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  if (typeof body?.alertsMuted !== "boolean") {
    return NextResponse.json({ error: "alertsMuted must be true or false." }, { status: 400 });
  }
  const { id } = await params;
  // đọc portal_account(id, email) → 404 nếu không có
  // upsert notification_preferences { email: lower(email), sound_enabled: !alertsMuted,
  //   updated_at: now, updated_by_email: lower(actorEmail) } onConflict "email"
  // trả { alertsMuted, updatedBy, updatedAt }
}
```

- Không cần broadcast: lần `load()` kế tiếp của người đó tự đọc cờ mới.
- Admin tự tắt cho chính mình: cho phép.

### N4 — Giao diện Account Manager

1. **`src/app/(authed)/account-manager/page.tsx`:** nếu người xem có `PERMISSIONS.NOTIFICATION_ALERTS`, đọc thêm `notification_preferences` (`email, sound_enabled, updated_by_email, updated_at`) bằng một truy vấn trong `Promise.all` đã có (`:37-44`). Gắn vào từng user: `alertsMuted`, `alertsUpdatedBy`, `alertsUpdatedAt`. Truyền thêm prop `canManageAlerts`.
2. **`AccountManagerClient.tsx`** (bảng ở `:383-...`):
   - Thêm cột **"Alerts"**, chỉ hiện khi `canManageAlerts`.
   - Điều chỉnh độ rộng các cột (bảng `table-fixed`): User 32%, Role 15%, Status 12%, Alerts 11%, Created Date 18%, Actions 12%. Khi không có cột Alerts thì giữ bề rộng cũ.
   - Công tắc On/Off: bấm → `PATCH /api/admin/users/{id}/notification-alerts`; đổi trạng thái ngay trên màn hình, lỗi thì trả lại và hiện `setError` (state sẵn có).
   - Tooltip khi đang Off: "Muted by &lt;tên&gt; · &lt;ngày&gt;". Tên lấy từ danh sách user của trang. Ngày dùng `formatTableDate` (`src/lib/table-config/date-format.ts`).
   - Không gọi `router.refresh()`: cột này độc lập với role và status.

### N5 — Cái chuông (client)

1. **`src/app/api/tasks/notifications/route.ts`**, nhánh đầy đủ (không phải `mode=summary`):
   - thêm vào `Promise.all` ở `:147-187` truy vấn `notification_preferences.select("sound_enabled").eq("email", email).maybeSingle()`;
   - trả thêm `alertsMuted: alertsMutedFromRow(row)`;
   - đọc lỗi thì coi như không tắt (`false`). Lý do: thà kêu thừa còn hơn làm mất báo động.
2. **`NotificationBell.tsx`:** thêm `alertsMutedRef = useRef(false)`. Trong `load()`, ngay sau khi đọc `data`:

   ```ts
   alertsMutedRef.current = data.alertsMuted === true;
   // … toast giữ nguyên cho mọi `fresh` …
   const alertable = alertableNotifications(fresh, alertsMutedRef.current);
   if (alertable.length > 0) {
     void alertFreshNotifications(alertable, pushSubscribedRef.current);
   }
   ```

### N6 — Web Push (server)

1. **`src/lib/notifications/push-dispatch.ts`**, hàm `dispatch()`: truyền `{ direct: isDirectNotification(group.source.type) }` vào `sendPushToEmails`.
2. **`src/lib/notifications/push-server.ts`:**
   - đổi chữ ký thành `sendPushToEmails(emails, payload, options: { direct?: boolean } = {})`. Mặc định `direct = true`, để chỗ nào khác gọi mà không truyền thì giữ hành vi cũ;
   - `filterByPreference(emails, direct)` select thêm `sound_enabled`, rồi gọi `pushAllowedEmails(emails, rows, direct)`;
   - đọc lỗi thì giữ nguyên danh sách, như hiện tại.

### N7 (tuỳ chọn, nên làm) — Cho agent biết mình đang bị tắt chuông

Trong Settings (`src/app/(authed)/settings/`, gần `PushNotificationCard.tsx`), nếu `notification_preferences.sound_enabled = false` thì hiện một dòng chỉ đọc:

> "Notification sounds and pop-ups are turned off by an admin. You will still be alerted for @mentions and assignments."

Đọc cờ ở `settings/page.tsx` (server component) rồi truyền xuống. Có dòng này thì agent không tưởng hệ thống bị lỗi.

---

## 5. Thứ tự triển khai

1. **N2** (logic thuần + test) → **N1** code (`permissions.ts`, `schema.sql`, test).
2. **N3, N6, N5, N4, N7**.
3. Chạy `npm run typecheck && npm run test:run && npm run lint && npm run build`. Ghi `changelog.md`.
4. **Chạy rollout N1 trên production trước**, rồi mới deploy code.
5. Admin đăng nhập lại, hoặc chờ tối đa 5 phút (`RBAC_REFRESH_TTL_MS`, `src/auth.ts:34`), là thấy cột Alerts.

**Gate trước khi merge:** chạy trên checkout sạch từ `a317b94`; xác nhận rollout
N1 đã chạy ở production; sau đó chạy đủ `npm run typecheck`, `npm run test:run`,
`npm run lint`, `npm run build`. Push `origin/main` và `vercel/main` chỉ sau khi
Vercel build xanh; kiểm tra một request production trả redirect `/signin` hoặc
HTTP 200 thay vì lỗi build/runtime.

**Phối hợp với plan go-live:**
- Task 2 của plan go-live cũng sửa `src/app/api/tasks/notifications/route.ts` (phần enrich ở `:306-425`). N5 sửa phần `Promise.all` ở `:147-187`. Hai chỗ khác nhau, nhưng làm **sau** Task 2 để tránh xung đột khi ghép code.
- Ra cùng đợt với Task 12 (Agent nhận thêm thông báo).

**Ước lượng:** N1 30 phút, N2 30 phút, N3 1 giờ, N4 2 giờ, N5 1 giờ, N6 1 giờ, N7 1 giờ. Tổng khoảng 1 ngày.

---

## 6. Kiểm tay

Cần 3 tài khoản:
- **Admin**: có quyền mới.
- **Account manager thường**: có Account Manager, không có quyền mới.
- **Agent A**: có đăng ký Web Push trên ít nhất một máy.

- **Quyền:**
  - Admin thấy cột Alerts.
  - Account manager thường **không** thấy cột; gọi thẳng API bị 403.
  - Agent A gọi API bị 403.
- **Tắt cho Agent A**, rồi kiểm:
  - A đang mở portal; có người comment trên task của A → toast hiện, **không** có tiếng.
  - A để tab ở chế độ nền → **không** có popup hệ điều hành, **không** có push trên máy đã đăng ký.
  - Có người @mention A → **có** tiếng, popup và push.
  - Giao một task mới cho A → **có** tiếng, popup và push.
  - Số đỏ trên chuông và danh sách thông báo vẫn tăng đủ.
  - Thông báo Enrollment (comment, nhắc hạn) → im. Được giao hồ sơ (`assigned`) → kêu.
- **Rê chuột** lên công tắc → "Muted by &lt;tên admin&gt; · &lt;ngày&gt;".
- **Bật lại** → mọi thứ như cũ, ngay từ thông báo kế tiếp, không cần reload.
- **Settings của A (nếu làm N7)** hiện dòng "turned off by an admin".
- **RLS:** khoá anon vẫn đọc 0 dòng ở `notification_preferences` (cách kiểm như ngày 2026-10-02).
