# Dọn thông báo Task CS — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) hoặc superpowers:executing-plans. Các bước dùng checkbox (`- [ ]`).

**Goal:** Mỗi sự kiện của Task CS chỉ báo **một lần** cho mỗi người trên mỗi trình duyệt. Câu chữ nói đúng hoàn cảnh. Mở task là coi như đã đọc thông báo của task đó.

**Architecture:** Có hai lớp sửa độc lập.
- **Lớp ghi (server):** mỗi người chỉ nhận một dòng khi tạo task, và `stale` không còn chồng lên các lời nhắc khác.
- **Lớp báo (trình duyệt):** tiếng chuông và popup hệ điều hành chỉ phát ở **một** tab, nhờ Web Locks theo id thông báo. Popup của cái chuông chỉ bật khi cửa sổ không focus **và** máy chưa có Web Push. Service worker xét `focused` thay cho `visible`. Tag chia hai họ: `direct` là loại gọi đích danh, được kêu lại khi thay thế; `activity` là phần còn lại, thay thế im lặng.

Mọi luật mới nằm trong hàm thuần có test. Component chỉ nối dây.

**Tech Stack:** Next.js 16.2.4 (App Router), React 19, TypeScript 5.9.3, Supabase (PostgREST), vitest 2.1.9, Web Push (`web-push`), service worker thuần JS.

## Global Constraints

- **Thư mục làm việc:** `/Users/vothuongbao/Project/Web/agent-portal`.
- **Node 22:** mọi lệnh npm/npx chạy sau `export PATH="$HOME/.nvm/versions/node/v22.12.0/bin:$PATH"`. Node 18 mặc định làm vitest hỏng (`File`, `crypto.randomUUID`).
- **Nhánh:** làm trên `task-noti-cleanup`, tách từ `main` (`b425853`). **KHÔNG push, KHÔNG merge.** Người dùng review xong mới đưa lên main.

> [codex] Review — `b425853` không còn là `main` hiện tại. Trước khi tạo nhánh phải cập nhật `main` bằng `git pull --ff-only` (hoặc base vào `origin/main` mới), nếu không plan sẽ vô tình bỏ các thay đổi đã lên main sau commit này.

- **Test:** vitest `environment: "node"`, `include: ["src/**/*.test.ts"]`. **`.tsx` KHÔNG được thu thập**, nên đừng viết `*.test.tsx`. Luật nào cần test thì tách ra file `.ts` thuần.
- **Kiểm tra trước mỗi commit:** `npm run typecheck` và `npm run lint`, cộng test của task đó. Task cuối chạy thêm `npm run test:run` toàn bộ và `npm run build`.
- **KHÔNG chạy `npm run build` khi dev server đang chạy**, vì nó ghi đè `.next` và dev server trả 500. Build trong worktree tách riêng (xem Task 7).
- **Không có SQL phải chạy.** Plan này không đổi schema. Task 2 chỉ sửa **nội dung** một file rollout cũ, không ai chạy lại nó.

> [codex] Blocker — sửa một rollout lịch sử không thay đổi database đã chạy rollout đó. Nếu production từng nhận `2026-09-04`, CHECK constraint đã bị dựng lại ở thời điểm ấy; cần kiểm tra constraint thật trên production và, nếu thiếu `task_created`, thêm một forward migration idempotent. Không được coi việc edit file cũ là bản vá production.

- **Changelog bắt buộc:** thêm một mục vào `changelog.md`, mới nhất ở trên cùng (Task 7).
- **Ngôn ngữ:** comment giải thích *tại sao* viết tiếng Việt. Chuỗi hiển thị cho người dùng cuối viết **tiếng Anh**.
- **Commit:** mỗi task một commit. Message kết thúc bằng dòng `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

> [codex] Attribution — nếu plan này cần ghi nhận Codex thì thay hoặc bỏ trailer Claude. Không tự đặt email/identity Codex khi chưa có giá trị người dùng chốt.

---

## Quyết định đã có trong plan này

Mỗi điểm đều có dữ liệu production đi kèm (14 ngày tới 15/09/2026), và không cần hỏi thêm người dùng.

| Vấn đề | Chốt | Vì sao |
| --- | --- | --- |
| Tạo task ra 2 thông báo cho cùng người (ảnh chụp CS-237) | Ai nhận `backlog_attention` thì không nhận `task_created`. Ai được giao lúc tạo thì chỉ nhận `assigned`. | CS-237: 4 trên 12 người nhận đôi. Tính cả 21 ngày có 47 lần. Loại cụ thể hơn thắng. |
| Popup nhân theo số tab | Web Locks theo id thông báo: một tab giành quyền kêu chuông và bật popup. Toast vẫn hiện ở mọi tab. | `NotificationBell` hiện gọi `new Notification` ở **mọi** tab, kể cả tab đang focus. |
| Bỏ hẳn popup của cái chuông? | **Không.** Chỉ bật khi `!document.hasFocus()` **và** máy chưa có push. | Chỉ 6 trên 30 người nhận có đăng ký Web Push. Bỏ hẳn thì 24 người mất hết cảnh báo ngoài trình duyệt. |
| Service worker nuốt push khi có cửa sổ `visible` | Đổi sang `focused` | Cửa sổ portal mở ở màn hình phụ hoặc nằm cạnh cửa sổ khác: người dùng không thấy toast, nhưng push vẫn bị nuốt. |
| Tag trùng thì im lặng thay thế | Hai họ tag: `<kind>:<id>:direct` (mentioned, assigned, unassigned, reopened) có `renotify: true`, và `<kind>:<id>:activity` thay thế im lặng | Tag hiện là `task:<id>`. Được @ ngay sau một bình luận cùng task thì không có tiếng. |
| Nhiều ping realtime liền nhau | Gom thành một lần `load()` sau 1,5 giây | Cron gửi một ping cho mỗi task mỗi loại. Có lượt cron gửi 12 ping cho cùng một người. |
| `stale` chồng lên lời nhắc khác | `stale` chỉ cho task In Progress **chưa** quá hạn SLA | stale + waiting_reminder 28 lần, stale + todo_reminder 3 lần. To Do và Waiting/Billing đã có lời nhắc riêng. In Progress quá hạn đã có `overdue_reminder`. |
| Billing nhận câu "still waiting" | Giữ loại `waiting_reminder`, cron ghi `detail = "billing"`, câu chữ đọc `detail` | Thêm loại mới nghĩa là thêm rollout CHECK constraint trước khi deploy. Không đáng cho một câu chữ. |
| "system Task passed its due date" | Thêm hai loại Due Date vào `isSystemNotification` | Hai loại này có `actor_email = "system"` nhưng nằm ngoài danh sách, nên bị ghép chữ "system" vào đầu. |
| "commented on a task assigned to you" | Đổi thành "commented on a task" | Người nhận gồm cả agent, participant, reporter, không phải ai cũng là assignee. |
| Mở task không xoá thông báo | Mở task thì đánh dấu đã đọc **mọi** thông báo của task đó, rồi báo cái chuông cập nhật số ngay | Hiện chỉ xoá `assigned`. Tổng 9.198 dòng chưa đọc, riêng khang 2.575. |
| File rollout 09-04 dựng lại CHECK mà thiếu `task_created` | Thêm `'task_created'` vào danh sách trong file | Ai chạy lại file đó thì insert thông báo tạo task nổ, kéo theo cả dòng `assigned` cùng lượt insert. |

### Cố ý KHÔNG làm

- **Gom mọi insert của cron thành một lượt cuối tick.** Nhiều loại đã ghi dấu `*_reminded_at` hoặc đã chạy RPC gắn cờ trước khi insert. Gom lại thì một dòng lỗi làm mất thông báo của mọi task trong tick. Chuông kêu nhiều lần đã được gom ping ở phía trình duyệt xử lý.
- **Đổi danh sách người nhận** (bỏ agent, bỏ admin cũ, thay bằng người có `task.manage`): cần người dùng quyết, xem mục dưới.
- **Gom thông báo theo task trong chuông, tự dọn dòng cũ, tuỳ chọn tắt từng loại:** để plan sau.

### Cần người dùng quyết (plan riêng, sau plan này)

1. Agent có thôi nhận mọi thông báo tự động của task (comment, QC, task mới, Due Date) và chỉ nhận khi bị @ không? Mọi agent đọc 0%. Riêng khang nhận 1.321 dòng trong 14 ngày.
2. Quá Due Date hiện báo assignee, agent, phụ tá và admin mỗi 24 giờ; đây là quyết định ngày 02/09. Giữ nguyên, hay lần đầu báo assignee + phụ tá, còn nhắc lại chỉ báo assignee? Có nhắc tiếp khi task đang Waiting hoặc Billing không?
3. Task mới: 9 người có `task.manage` nhận thông báo cho **mọi** task (đang đọc 21%), chỉ task Urgent/High, hay không nhận gì? Trong thông báo, "admin" là 9 người `task.manage` hay 3 admin cũ?
4. Người bị @ một lần có tiếp tục nhận **mọi** bình luận sau đó của task không? Hiện @ là thành participant vĩnh viễn.
5. Có đánh dấu đã đọc mọi thông báo chưa đọc cũ hơn 14 ngày, và tự xoá dòng đã đọc sau 60 ngày không?

---

## Bối cảnh: những gì ĐANG có (đã đối chiếu source)

**Ba kênh báo cho một dòng `task_notifications`.** Server gọi `insertNotifications(rows)` ở `src/lib/tasks/notifications.ts:86-108`. Hàm này làm 3 việc:
1. Insert một lượt.
2. `broadcastNotif(recipients)`: gửi ping realtime, không kèm nội dung.
3. `after()` → `pushForTaskNotifications(rows)`: gửi Web Push.

**Cái chuông** `src/app/(authed)/_components/NotificationBell.tsx`: mỗi tab portal có một bản trong TopBar.
- Nhận ping thì gọi `load()` (khoảng L300-302). Hàm này lấy 30 thông báo mới nhất và lọc ra dòng chưa từng thấy (`seenIds`).
- Với dòng mới, hiện tại nó làm như sau (L195-217):

```tsx
      // One chime per batch, not per item, so a burst doesn't overlap tones.
      if (fresh.length > 0) playNotificationChime();

      // Oldest first so the newest toast ends up on top of the stack.
      for (const n of [...fresh].reverse()) {
        setToasts((cur) => [n, ...cur].slice(0, 4));
        ...
        // Native OS popup too — fires regardless of whether the tab is
        // focused, not just when it's hidden.
        if (... Notification.permission === "granted") {
          new Notification(`${entityKey(n)} · ${notificationHeading(n)}`, {
            body: nativeNotificationBody(n),
          });
        }
      }
```

Mở 3 tab là 3 tiếng chuông và 3 popup, không có tag.

**Service worker** `public/sw.js:31-37` bỏ push khi có cửa sổ `visible`:

```js
async function hasVisibleWindow() {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  return windows.some((client) => client.visibilityState === "visible");
}
```

Tag push dựng ở `src/lib/notifications/push-server.ts:189`: `` `${entity_type ?? "task"}:${entity_id ?? task_id}` ``.

**Câu chữ** dùng chung cho chuông và push, nằm ở `src/lib/notifications/copy.ts`: `notificationActionText`, `isSystemNotification` (L177-191), và `notificationSentence`. Push gom dòng theo `type|entity_id|actor_email` ở `src/lib/notifications/push-dispatch.ts:75-101`.

**Tạo task** `src/app/api/tasks/route.ts:397-449` dựng ba danh sách độc lập rồi chỉ gộp trùng **cùng loại** (`uniqueNotificationRows` gộp theo recipient+task+type+actor+comment+detail):
- `task_created`: `fetchTaskManagerEmails()` cộng agent.
- `assigned`: người được giao.
- `backlog_attention`: `fetchAgentOwnerAndAssistantEmails(agent)` cộng `fetchAdminEmails()`, chỉ khi task ở Backlog, Urgent/High, chưa ai nhận.

**Cron** `src/app/api/cron/check-overdue/route.ts`, GitHub Actions chạy mỗi 15 phút. Luật stale hiện tại (L222-242):

```ts
  const { data: staleRows, error: staleError } = await supabase
    .from("tasks")
    .select("id,status,last_activity_at,stale_reminded_at")
    .in("status", ["todo", "in_progress", "waiting", "billing"])
    .is("archived_at", null);
```

Hàm SLA ở `src/lib/tasks/sla.ts`. `isTaskOverdue(task, rules, now)` chỉ true khi `isSlaActiveInProgress` đúng (In Progress, có `in_progress_at`, `overdue_count === 0`, chưa từng đỗ Waiting/Billing) và quỹ SLA đã hết. `effectiveSlaMinutes` **luôn** trả về một số (mặc định theo priority), nên không có chuyện "task không có SLA".

**Đánh dấu đã đọc:** `POST /api/tasks/notifications/read` với `{ taskId }` và không kèm `type` thì đánh dấu mọi thông báo task của người gọi (`read/route.ts:118-127`). API **không cần sửa**. Board hiện chỉ gọi với `type: "assigned"` (`TaskBoardClient.tsx:501-518`).

**Web Push trên client:** `isPushEnabledOnThisDevice()` ở `src/lib/notifications/push-client.ts:164-171` trả `true` khi máy có quyền và có subscription.

**TypeScript 5.9.3:** `NotificationOptions` **không** khai `renotify` (lib.dom.d.ts:1252-1262), nên dùng `NotificationOptions & { renotify?: boolean }`. `navigator.locks: LockManager` có sẵn.

---

## File Structure

| File | Trạng thái | Trách nhiệm |
| --- | --- | --- |
| `src/lib/notifications/copy.ts` | Sửa | Câu chữ: hai loại Due Date là thông báo hệ thống; comment trung tính; Billing đọc `detail` |
| `src/lib/notifications/push-dispatch.ts` | Sửa | Mang `detail` vào nguồn câu chữ của push |
| `src/lib/tasks/create-notifications.ts` | **Tạo** | Hàm thuần: các dòng thông báo lúc tạo task, mỗi người đúng một dòng |
| `src/lib/tasks/reminders.ts` | Sửa | Hàm thuần `shouldSendStaleReminder` |
| `src/lib/notifications/alert-policy.ts` | **Tạo** | Hàm thuần: tag hai họ, renotify, khi nào chuông bật popup, độ trễ giành quyền |
| `src/lib/notifications/alert-lock.ts` | **Tạo** | Giành quyền báo động qua Web Locks, cho phép tiêm lock manager giả để test |
| `src/lib/tasks/client-events.ts` | Sửa | Sự kiện "thông báo của task X vừa được đọc" |
| `src/app/api/tasks/route.ts` | Sửa | Dùng `buildCreateTaskNotificationRows` |
| `src/app/api/cron/check-overdue/route.ts` | Sửa | Luật stale mới; `detail` cho Billing |
| `src/app/(authed)/_components/NotificationBell.tsx` | Sửa | Gom ping; báo động qua policy + lock; nghe sự kiện đã đọc; ẩn dòng detail của waiting_reminder |
| `src/app/(authed)/tasks/_components/TaskBoardClient.tsx` | Sửa | Mở task thì đọc mọi thông báo của task |
| `src/lib/notifications/push-server.ts` | Sửa | Tag hai họ + `renotify` trong payload |
| `public/sw.js` | Sửa | `focused` thay `visible`; `renotify`; tăng `SW_VERSION` |
| `supabase/rollouts/2026-09-04-task-due-date-overdue.sql` | Sửa | Thêm `'task_created'` vào danh sách CHECK |
| `changelog.md` | Sửa | Mục mới |

Test: `copy.test.ts`, `push-dispatch.test.ts`, `create-notifications.test.ts` (tạo mới), `reminders.test.ts`, `alert-policy.test.ts` (tạo mới), `alert-lock.test.ts` (tạo mới).

---

### Task 1: Câu chữ nói đúng hoàn cảnh

**Files:**
- Modify: `src/lib/notifications/copy.ts` (type `NotificationCopySource` ~L57-63, `commented` ~L113-116, `waiting_reminder` ~L153-154, `isSystemNotification` ~L177-191)
- Modify: `src/lib/notifications/push-dispatch.ts` (`DispatchRow` ~L22-27, `groupPushRows` ~L75-101, tham số `pushForTaskNotifications` ~L129-136)
- Modify: `src/app/api/cron/check-overdue/route.ts` (import ~L10-20, insert `waiting_reminder` ~L336-350)
- Modify: `src/app/(authed)/_components/NotificationBell.tsx` (dòng detail trong `NotifContent`)
- Test: `src/lib/notifications/copy.test.ts`, `src/lib/notifications/push-dispatch.test.ts`

**Interfaces:**
- Produces: `export const WAITING_REMINDER_BILLING_DETAIL = "billing"` từ `copy.ts`. `NotificationCopySource` có thêm `detail?: string | null`. `DispatchRow` có thêm `detail?: string | null`.

- [ ] **Step 1: Tạo nhánh**

```bash
cd /Users/vothuongbao/Project/Web/agent-portal
git switch main && git switch -c task-noti-cleanup
```

- [ ] **Step 2: Viết test hỏng cho câu chữ**

Trong `src/lib/notifications/copy.test.ts`, thêm `WAITING_REMINDER_BILLING_DETAIL` vào import từ `"./copy"`:

```ts
import {
  NOTIFICATION_COPY_TYPES,
  WAITING_REMINDER_BILLING_DETAIL,
  isSystemNotification,
  notificationActionText,
  notificationEntityId,
  notificationEntityKind,
  notificationHref,
  notificationSentence,
  type NotificationCopySource,
  type NotificationCopyType,
} from "./copy";
```

Thay mảng `systemTypes` trong `describe("thông báo hệ thống không có người thực hiện"` bằng:

```ts
  const systemTypes: NotificationCopyType[] = [
    "overdue",
    "todo_reminder",
    "overdue_reminder",
    "due_date_overdue",
    "due_date_overdue_reminder",
    "waiting_reminder",
    "due_soon",
    "stale",
    "qc_stale",
    "sla_escalated",
  ];
```

Thêm vào cuối describe đó, ngay trước `});` đóng:

```ts
  it("thông báo quá Due Date không bị ghép chữ 'system' vào đầu", () => {
    // Cron ghi actor_email = "system"; không nhận diện là hệ thống thì chuông
    // và push hiện "system Task passed its due date".
    expect(notificationSentence(notif({ type: "due_date_overdue" }), "system")).toBe(
      "Task passed its due date"
    );
    expect(
      notificationSentence(notif({ type: "due_date_overdue_reminder" }), "system")
    ).toBe("Task is still past its due date — reminder");
  });
```

Thêm describe mới ở cuối file:

```ts
describe("câu chữ không nói sai hoàn cảnh", () => {
  it("bình luận không khẳng định task được giao cho người nhận", () => {
    // Người nhận gồm cả agent, participant, reporter — không phải ai cũng là assignee.
    expect(notificationActionText(notif({ type: "commented" }))).toBe("commented on a task");
  });

  it("lời nhắc của Billing nói đúng chặng Billing", () => {
    expect(
      notificationActionText(
        notif({ type: "waiting_reminder", detail: WAITING_REMINDER_BILLING_DETAIL })
      )
    ).toBe("Task is still in Billing — reminder");
    expect(notificationActionText(notif({ type: "waiting_reminder" }))).toBe(
      "Task is still waiting for follow-up"
    );
  });
});
```

- [ ] **Step 3: Chạy test, xác nhận hỏng**

Run: `npx vitest run src/lib/notifications/copy.test.ts`
Expected: FAIL. Các test "nhận diện đúng loại do cron sinh ra", "không bị ghép chữ 'system'", "bình luận không khẳng định", "Billing" đều hỏng.

- [ ] **Step 4: Sửa `copy.ts`**

Ngay sau dòng `export type NotificationCopyType = (typeof NOTIFICATION_COPY_TYPES)[number];` thêm:

```ts
/**
 * `detail` mà cron ghi lên `waiting_reminder` khi task đang ở Billing.
 *
 * Billing dùng chung loại thông báo với Waiting (chung ngưỡng giờ trong Reminder
 * Setup). Thêm hẳn một loại mới nghĩa là một rollout sửa CHECK constraint trước
 * khi deploy — không đáng cho một câu chữ; một giá trị `detail` là đủ.
 */
export const WAITING_REMINDER_BILLING_DETAIL = "billing";
```

Trong `export type NotificationCopySource = { ... }`, thêm trường cuối:

```ts
  /** Chi tiết của dòng thông báo. Hiện chỉ `waiting_reminder` đọc nó (Waiting hay Billing). */
  detail?: string | null;
```

Thay nhánh `commented`:

```ts
    case "commented":
      return kind === "enrollment"
        ? "commented on an enrollment record"
        : "commented on a task";
```

Thay nhánh `waiting_reminder`:

```ts
    case "waiting_reminder":
      return notification.detail === WAITING_REMINDER_BILLING_DETAIL
        ? "Task is still in Billing — reminder"
        : "Task is still waiting for follow-up";
```

Trong `isSystemNotification`, thêm hai `case` ngay sau `case "overdue_reminder":`:

```ts
    case "due_date_overdue":
    case "due_date_overdue_reminder":
```

- [ ] **Step 5: Chạy test, xác nhận qua**

Run: `npx vitest run src/lib/notifications/copy.test.ts`
Expected: PASS.

- [ ] **Step 6: Viết test hỏng cho push mang `detail`**

Trong `src/lib/notifications/push-dispatch.test.ts`, thêm vào cuối `describe("gom thông báo trước khi đẩy"`:

```ts
  it("khác detail thì tách riêng, và câu chữ nhận được detail", () => {
    // Waiting và Billing cùng loại waiting_reminder; câu chữ đọc detail, nên
    // gộp hai detail khác nhau là một nửa người nhận đọc sai chặng.
    const groups = groupPushRows(
      [
        row({ type: "waiting_reminder", detail: "billing" }),
        row({ type: "waiting_reminder", recipient_email: "b@x.com", detail: null }),
      ],
      "task"
    );
    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.source.detail)).toEqual(["billing", null]);
  });
```

- [ ] **Step 7: Chạy test, xác nhận hỏng**

Run: `npx vitest run src/lib/notifications/push-dispatch.test.ts`
Expected: FAIL. `expected [ …(1) ] to have a length of 2`.

- [ ] **Step 8: Sửa `push-dispatch.ts`**

Thay `DispatchRow`:

```ts
export type DispatchRow = {
  recipient_email: string;
  actor_email: string;
  type: string;
  entity_id: string;
  detail?: string | null;
};
```

Trong `groupPushRows`, thay dòng `const key = ...` và object `source`:

```ts
  for (const row of rows) {
    // `detail` nằm trong khoá vì câu chữ đọc nó (Waiting hay Billing).
    const key = `${row.type}|${row.entity_id}|${row.actor_email}|${row.detail ?? ""}`;
    const existing = groups.get(key);
    if (existing) {
      if (!existing.emails.includes(row.recipient_email)) {
        existing.emails.push(row.recipient_email);
      }
      continue;
    }
    groups.set(key, {
      source: {
        type: row.type as NotificationCopyType,
        entity_type: entityType,
        entity_id: row.entity_id,
        task_id: row.entity_id,
        detail: row.detail ?? null,
      },
      actorEmail: row.actor_email,
      emails: [row.recipient_email],
    });
  }
```

Trong `pushForTaskNotifications`, thêm `detail` vào kiểu tham số. Thân hàm đã `...row` nên `detail` tự đi theo:

```ts
export async function pushForTaskNotifications(
  rows: readonly {
    recipient_email: string;
    task_id: string;
    type: string;
    actor_email: string;
    detail?: string | null;
  }[]
): Promise<void> {
```

- [ ] **Step 9: Chạy test, xác nhận qua**

Run: `npx vitest run src/lib/notifications/push-dispatch.test.ts src/lib/notifications/copy.test.ts`
Expected: PASS.

- [ ] **Step 10: Cron ghi `detail` cho Billing**

Trong `src/app/api/cron/check-overdue/route.ts`, thêm import ngay dưới dòng `import { isTaskRowDueDateOverdue, readTaskDueDate } from "@/lib/tasks/due-date";`:

```ts
import { WAITING_REMINDER_BILLING_DETAIL } from "@/lib/notifications/copy";
```

Trong khối `if (parkedReminderTasks.length > 0)`, thay lời gọi `insertNotifications(...)`:

```ts
        await insertNotifications(
          assignees.map((email) => ({
            recipient_email: email,
            task_id: task.id,
            type: "waiting_reminder",
            actor_email: "system",
            // Billing dùng chung loại với Waiting; detail cho câu chữ biết chặng.
            detail: task.status === "billing" ? WAITING_REMINDER_BILLING_DETAIL : null,
          }))
        );
```

- [ ] **Step 11: Chuông không in "Detail: billing"**

Trong `NotificationBell.tsx`, hàm `NotifContent`, tìm:

```tsx
      {n.detail && (
        <p
          className="mt-0.5 line-clamp-2 text-xs leading-5 text-slate-500"
          title={n.detail}
```

đổi dòng đầu thành:

```tsx
      {n.detail && n.type !== "waiting_reminder" && (
```

Câu chữ đã nói "in Billing". Dòng "Detail: billing" chỉ lặp lại mà còn là chữ thường.

- [ ] **Step 12: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: không lỗi.

- [ ] **Step 13: Commit**

```bash
git add src/lib/notifications/copy.ts src/lib/notifications/copy.test.ts \
  src/lib/notifications/push-dispatch.ts src/lib/notifications/push-dispatch.test.ts \
  src/app/api/cron/check-overdue/route.ts "src/app/(authed)/_components/NotificationBell.tsx"
git commit -m "fix(notifications): câu chữ đúng hoàn cảnh — Due Date không ghép 'system', comment trung tính, Billing nói đúng chặng" \
  -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Tạo task — mỗi người đúng một thông báo

**Files:**
- Create: `src/lib/tasks/create-notifications.ts`
- Create: `src/lib/tasks/create-notifications.test.ts`
- Modify: `src/app/api/tasks/route.ts` (import L33-38, thân `run` của side-effect `notification_failed` ~L397-449)
- Modify: `supabase/rollouts/2026-09-04-task-due-date-overdue.sql` (danh sách CHECK ~L63-72)

**Interfaces:**
- Consumes: `uniqueNotificationRecipients`, `uniqueNotificationRows`, `NotificationInsertInput` từ `src/lib/tasks/notifications.ts` (đã có).
- Produces: `buildCreateTaskNotificationRows(input: { taskId: string; actorEmail: string; assignees: string[]; createdRecipients: string[]; backlogAttentionRecipients: string[]; priority: string }): NotificationInsertInput[]`

- [ ] **Step 1: Viết test hỏng**

Tạo `src/lib/tasks/create-notifications.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildCreateTaskNotificationRows } from "@/lib/tasks/create-notifications";
import type { NotificationInsertInput } from "@/lib/tasks/notifications";

function typesFor(rows: NotificationInsertInput[], email: string) {
  return rows.filter((row) => row.recipient_email === email).map((row) => row.type);
}

const managers = ["khang@x.com", "bao@x.com", "nam@x.com", "linh@x.com", "kay@x.com"];

describe("buildCreateTaskNotificationRows", () => {
  // Tái hiện CS-237 (15/09/2026): Huy tạo task High ở Backlog, agent là Ann.
  // Khang/Bao/Nam có task.manage VÀ là admin cũ; Ann là agent — cả bốn từng
  // nhận hai dòng cùng một giây.
  it("người nằm trong cả hai danh sách chỉ nhận backlog_attention", () => {
    const rows = buildCreateTaskNotificationRows({
      taskId: "t1",
      actorEmail: "huy@x.com",
      assignees: [],
      createdRecipients: [...managers, "ann@x.com"],
      backlogAttentionRecipients: [
        "ann@x.com",
        "thao@x.com",
        "khang@x.com",
        "bao@x.com",
        "nam@x.com",
      ],
      priority: "high",
    });

    for (const email of ["khang@x.com", "bao@x.com", "nam@x.com", "ann@x.com"]) {
      expect(typesFor(rows, email), email).toEqual(["backlog_attention"]);
    }
    expect(typesFor(rows, "thao@x.com")).toEqual(["backlog_attention"]);
    expect(typesFor(rows, "linh@x.com")).toEqual(["task_created"]);

    const recipients = rows.map((row) => row.recipient_email);
    expect(new Set(recipients).size).toBe(recipients.length);
  });

  it("ghi mức ưu tiên vào detail của backlog_attention", () => {
    const [row] = buildCreateTaskNotificationRows({
      taskId: "t1",
      actorEmail: "huy@x.com",
      assignees: [],
      createdRecipients: [],
      backlogAttentionRecipients: ["ann@x.com"],
      priority: "urgent",
    });
    expect(row).toMatchObject({
      recipient_email: "ann@x.com",
      type: "backlog_attention",
      detail: "urgent backlog task needs assignment",
    });
  });

  it("người được giao lúc tạo chỉ nhận assigned, kể cả khi có task.manage", () => {
    const rows = buildCreateTaskNotificationRows({
      taskId: "t1",
      actorEmail: "huy@x.com",
      assignees: ["kay@x.com"],
      createdRecipients: managers,
      backlogAttentionRecipients: [],
      priority: "medium",
    });
    expect(typesFor(rows, "kay@x.com")).toEqual(["assigned"]);
    expect(typesFor(rows, "khang@x.com")).toEqual(["task_created"]);
  });

  it("không bao giờ báo cho chính người tạo", () => {
    const rows = buildCreateTaskNotificationRows({
      taskId: "t1",
      actorEmail: "khang@x.com",
      assignees: ["khang@x.com"],
      createdRecipients: managers,
      backlogAttentionRecipients: ["khang@x.com"],
      priority: "high",
    });
    expect(typesFor(rows, "khang@x.com")).toEqual([]);
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận hỏng**

Run: `npx vitest run src/lib/tasks/create-notifications.test.ts`
Expected: FAIL. `Failed to resolve import "@/lib/tasks/create-notifications"`.

- [ ] **Step 3: Viết hàm**

Tạo `src/lib/tasks/create-notifications.ts`:

```ts
import {
  uniqueNotificationRecipients,
  uniqueNotificationRows,
  type NotificationInsertInput,
} from "./notifications";

/**
 * Các dòng thông báo lúc TẠO task — mỗi người nhận đúng MỘT dòng.
 *
 * Trước 16/09/2026 route dựng ba danh sách độc lập rồi chỉ gộp trùng khi CÙNG
 * loại. Ai vừa có task.manage vừa là admin cũ, hoặc là agent của task, nằm
 * trong cả `task_created` lẫn `backlog_attention` và nhận hai dòng cùng một
 * giây — CS-237: 4 trên 12 người. Loại cụ thể hơn thắng:
 * được giao việc > task gấp cần người nhận > có task mới.
 *
 * Hàm thuần: route tự tra danh sách người nhận rồi đưa vào đây.
 */
export function buildCreateTaskNotificationRows(input: {
  taskId: string;
  actorEmail: string;
  /** Người được giao ngay lúc tạo. */
  assignees: string[];
  /** Người có task.manage + agent của task. */
  createdRecipients: string[];
  /** Agent + phụ tá + admin; rỗng khi task không phải Backlog Urgent/High chưa ai nhận. */
  backlogAttentionRecipients: string[];
  priority: string;
}): NotificationInsertInput[] {
  const assigned = uniqueNotificationRecipients(input.assignees, [input.actorEmail]);
  const backlog = uniqueNotificationRecipients(input.backlogAttentionRecipients, [
    input.actorEmail,
    ...assigned,
  ]);
  const created = uniqueNotificationRecipients(input.createdRecipients, [
    input.actorEmail,
    ...assigned,
    ...backlog,
  ]);

  return uniqueNotificationRows([
    ...assigned.map((recipient) => ({
      recipient_email: recipient,
      task_id: input.taskId,
      type: "assigned" as const,
      actor_email: input.actorEmail,
    })),
    ...backlog.map((recipient) => ({
      recipient_email: recipient,
      task_id: input.taskId,
      type: "backlog_attention" as const,
      actor_email: input.actorEmail,
      detail: `${input.priority} backlog task needs assignment`,
    })),
    ...created.map((recipient) => ({
      recipient_email: recipient,
      task_id: input.taskId,
      type: "task_created" as const,
      actor_email: input.actorEmail,
    })),
  ]);
}
```

- [ ] **Step 4: Chạy test, xác nhận qua**

Run: `npx vitest run src/lib/tasks/create-notifications.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Nối vào route tạo task**

Trong `src/app/api/tasks/route.ts`, thay khối import:

```ts
import {
  insertNotifications,
  uniqueNotificationRecipients,
  uniqueNotificationRows,
  type NotificationInsertInput,
} from "@/lib/tasks/notifications";
```

bằng:

```ts
import { insertNotifications } from "@/lib/tasks/notifications";
import { buildCreateTaskNotificationRows } from "@/lib/tasks/create-notifications";
```

Trong side-effect `code: "notification_failed"`, thay **toàn bộ** thân `run: async () => { ... }`, từ `const assignedRecipients = assignedEmails.filter(` tới `return insertNotifications(notificationRows);`, bằng:

```ts
          run: async () => {
            const backlogNeedsAttention =
              assignedEmails.length === 0 &&
              assignment.status === "backlog" &&
              (priority === "urgent" || priority === "high");
            const backlogAttentionRecipients = backlogNeedsAttention
              ? [
                  ...(await fetchAgentOwnerAndAssistantEmails(agentEmail)),
                  ...(await fetchAdminEmails()),
                ]
              : [];
            // An Agent Assistant is normally the one creating a task, so the
            // people who can act on it are its Task Admins (they hold
            // `task.manage` and can open it straight from the bell to assign or
            // adjust) and the task's own agent. RBAC, not the legacy
            // `portal_account.role`, defines the manager list.
            const createdRecipients = [
              ...(await fetchTaskManagerEmails()),
              ...(agentEmail ? [agentEmail] : []),
            ];
            const notificationRows = buildCreateTaskNotificationRows({
              taskId,
              actorEmail: email,
              assignees: assignedEmails,
              createdRecipients,
              backlogAttentionRecipients,
              priority,
            });
            if (notificationRows.length === 0) return true;
            return insertNotifications(notificationRows);
          },
```

Các biến `assignedEmails`, `assignment`, `priority`, `agentEmail`, `email`, `taskId` đều đã có trong scope này, giống code cũ.

- [ ] **Step 6: Sửa file rollout 09-04**

> [codex] Xem blocker ở Global Constraints: vẫn có thể sửa file này để source sạch cho install mới, nhưng bắt buộc có migration mới nếu cần sửa production đã deploy. Bước này không được là phương án deploy duy nhất.

Trong `supabase/rollouts/2026-09-04-task-due-date-overdue.sql`, mục `-- ---------- 4. Hai loại thông báo mới ----------`, thay đoạn cuối danh sách:

```sql
      'attachment_added', 'backlog_attention',
      -- Mới: hạn cứng theo Due Date.
      'due_date_overdue', 'due_date_overdue_reminder'
```

bằng:

```sql
      'attachment_added', 'backlog_attention',
      -- Mới: hạn cứng theo Due Date.
      'due_date_overdue', 'due_date_overdue_reminder',
      -- Thêm 16/09/2026: bản đầu của file này quên 'task_created' (có từ rollout
      -- 2026-09-03). Chạy lại bản cũ là mọi insert thông báo tạo task nổ, kéo theo
      -- cả dòng 'assigned' cùng lượt insert.
      'task_created'
```

- [ ] **Step 7: Typecheck, lint, test liên quan**

Run: `npm run typecheck && npm run lint && npx vitest run src/lib/tasks/create-notifications.test.ts src/lib/tasks/notifications.test.ts`
Expected: không lỗi; PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/tasks/create-notifications.ts src/lib/tasks/create-notifications.test.ts \
  src/app/api/tasks/route.ts supabase/rollouts/2026-09-04-task-due-date-overdue.sql
git commit -m "fix(tasks): tạo task — mỗi người chỉ nhận một thông báo (CS-237 ra hai dòng)" \
  -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: `stale` chỉ cho task In Progress chưa quá hạn

**Files:**
- Modify: `src/lib/tasks/reminders.ts` (import L1, thêm hàm cuối file)
- Modify: `src/app/api/cron/check-overdue/route.ts` (import L17, `staleReminderMs` L73, query stale ~L222-242, update stale ~L438-443)
- Test: `src/lib/tasks/reminders.test.ts`

**Interfaces:**
- Produces: `shouldSendStaleReminder(task: Parameters<typeof isTaskOverdue>[0] & { last_activity_at: string | null; stale_reminded_at: string | null }, rules: Pick<TaskSlaRule, "priority" | "category_id" | "duration_minutes">[], staleHours: number, now: Date): boolean`

> [codex] Consistency — tiêu đề nói “In Progress chưa quá hạn”, nhưng test bên dưới cố ý cho `overdue_count: 1` (đã unlock sau quá hạn) nhận `stale`. Có thể đây là business rule đúng, nhưng phải đổi tên/mô tả thành “không còn overdue reminder đang hoạt động” để acceptance criteria không mâu thuẫn với test.

- [ ] **Step 1: Viết test hỏng**

Trong `src/lib/tasks/reminders.test.ts`, đổi dòng import:

```ts
import { intervalDue, isDueSoon, isStale, shouldSendStaleReminder } from "@/lib/tasks/reminders";
```

Thêm vào cuối file:

```ts
describe("shouldSendStaleReminder", () => {
  const now = new Date("2026-07-10T00:00:00.000Z");
  // SLA 7 ngày: task đang làm, CHƯA quá hạn, nhưng im lặng 3 ngày.
  const idle = {
    ...base,
    sla_minutes: 7 * 24 * 60,
    in_progress_at: "2026-07-06T00:00:00.000Z",
    last_activity_at: "2026-07-07T00:00:00.000Z",
    stale_reminded_at: null,
  };

  it("nhắc task In Progress chưa quá hạn mà im lặng quá ngưỡng", () => {
    expect(shouldSendStaleReminder(idle, rules, 48, now)).toBe(true);
  });

  it("không nhắc To Do, Waiting, Billing — mỗi chặng đã có lời nhắc riêng", () => {
    for (const status of ["todo", "waiting", "billing"] as const) {
      expect(shouldSendStaleReminder({ ...idle, status }, rules, 48, now), status).toBe(false);
    }
  });

  it("không nhắc task đang quá hạn SLA — overdue_reminder đã lo", () => {
    expect(shouldSendStaleReminder({ ...idle, sla_minutes: 60 }, rules, 48, now)).toBe(false);
  });

  it("vẫn nhắc task đã mở khoá quá hạn, vì SLA không còn chạy nên không ai khác nhắc", () => {
    expect(
      shouldSendStaleReminder({ ...idle, sla_minutes: 60, overdue_count: 1 }, rules, 48, now)
    ).toBe(true);
  });

  it("không nhắc lại khi chưa hết khoảng", () => {
    expect(
      shouldSendStaleReminder(
        { ...idle, stale_reminded_at: "2026-07-09T00:00:00.000Z" },
        rules,
        48,
        now
      )
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận hỏng**

Run: `npx vitest run src/lib/tasks/reminders.test.ts`
Expected: FAIL. `shouldSendStaleReminder is not a function`.

- [ ] **Step 3: Viết hàm**

Trong `src/lib/tasks/reminders.ts`, đổi dòng 1:

```ts
import { isSlaActiveInProgress, isTaskOverdue, slaRemainingSeconds } from "./sla";
```

Thêm vào cuối file:

```ts
/**
 * Có nên nhắc "task không có hoạt động" không.
 *
 * `stale` từng chạy ở To Do, In Progress, Waiting và Billing. Ba chặng kia đã có
 * lời nhắc riêng (`todo_reminder`, `waiting_reminder`), nên cùng một task nhận
 * hai lời nhắc trong cùng một lượt cron: 14 ngày tới 15/09/2026 có
 * stale + waiting_reminder 28 lần, stale + todo_reminder 3 lần. In Progress đang
 * quá hạn SLA cũng đã có `overdue_reminder`. Chỉ còn In Progress CHƯA quá hạn —
 * SLA dài, hoặc SLA đã ngừng chạy sau khi mở khoá — là không ai nhắc.
 */
export function shouldSendStaleReminder(
  task: Parameters<typeof isTaskOverdue>[0] & {
    last_activity_at: string | null;
    stale_reminded_at: string | null;
  },
  rules: Pick<TaskSlaRule, "priority" | "category_id" | "duration_minutes">[],
  staleHours: number,
  now: Date
): boolean {
  if (task.status !== "in_progress") return false;
  if (isTaskOverdue(task, rules, now)) return false;
  return (
    isStale(task, staleHours, now) &&
    intervalDue(task.stale_reminded_at, staleHours * 3600_000, now)
  );
}
```

- [ ] **Step 4: Chạy test, xác nhận qua**

Run: `npx vitest run src/lib/tasks/reminders.test.ts`
Expected: PASS.

- [ ] **Step 5: Nối vào cron**

> [codex] Race condition — cron đang chọn task, insert notification, rồi mới ghi `stale_reminded_at`. Hai lượt cron chồng nhau có thể cùng chọn một task và cùng insert; `uniqueNotificationRows` chỉ dedupe trong một process. Nếu mục tiêu exact-once là bắt buộc, cần atomic claim/update trước insert hoặc một DB uniqueness/transaction guard.

Trong `src/app/api/cron/check-overdue/route.ts`:

(a) Đổi dòng import 17:

```ts
import { intervalDue, isDueSoon, shouldSendStaleReminder } from "@/lib/tasks/reminders";
```

(b) Xoá dòng `const staleReminderMs = settings.staleHours * 3600_000;`. Hàm mới tự tính khoảng từ `staleHours`.

(c) Thay khối query stale:

```ts
  const { data: staleRows, error: staleError } = await supabase
    .from("tasks")
    .select("id,status,last_activity_at,stale_reminded_at")
    .in("status", ["todo", "in_progress", "waiting", "billing"])
    .is("archived_at", null);
  if (staleError) return NextResponse.json({ error: staleError.message }, { status: 500 });
  const staleReminderTasks = (
    (staleRows ?? []) as Pick<
      TaskRow,
      "id" | "status" | "last_activity_at" | "stale_reminded_at"
    >[]
  ).filter(
    (task) =>
      isStale(task, settings.staleHours, now) &&
      intervalDue(task.stale_reminded_at, staleReminderMs, now)
  );
```

bằng:

```ts
  // Chỉ In Progress — To Do, Waiting, Billing đã có lời nhắc riêng (xem
  // shouldSendStaleReminder). Lấy thêm cột SLA để loại task đang quá hạn.
  const { data: staleRows, error: staleError } = await supabase
    .from("tasks")
    .select(
      "id,status,priority,category_id,sla_minutes,in_progress_at,in_progress_seconds,waiting_started_at,waiting_seconds,billing_started_at,billing_seconds,overdue_count,last_activity_at,stale_reminded_at"
    )
    .eq("status", "in_progress")
    .is("archived_at", null);
  if (staleError) return NextResponse.json({ error: staleError.message }, { status: 500 });
  // `rules` chỉ được nạp khi `tasks` (In Progress có in_progress_at) không rỗng.
  // Khi rỗng, mọi dòng ở đây đều thiếu in_progress_at nên không thể quá hạn —
  // rules rỗng vẫn cho kết quả đúng.
  const staleReminderTasks = (
    (staleRows ?? []) as (Pick<TaskRow, "id"> &
      Parameters<typeof shouldSendStaleReminder>[0])[]
  ).filter((task) => shouldSendStaleReminder(task, rules, settings.staleHours, now));
```

(d) Trong khối `if (staleReminderTasks.length > 0)`, phần update dấu nhắc, thay:

```ts
          .in("status", ["todo", "in_progress", "waiting", "billing"]);
```

bằng:

```ts
          .eq("status", "in_progress");
```

Làm (c) trước (d): trước (c) chuỗi `.in("status", [...])` xuất hiện hai lần.

- [ ] **Step 6: Typecheck, lint, test**

Run: `npm run typecheck && npm run lint && npx vitest run src/lib/tasks/reminders.test.ts`
Expected: không lỗi; PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/tasks/reminders.ts src/lib/tasks/reminders.test.ts src/app/api/cron/check-overdue/route.ts
git commit -m "fix(tasks): stale chỉ nhắc task In Progress chưa quá hạn, hết chồng với todo/waiting reminder" \
  -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Luật báo động (hàm thuần + Web Locks)

**Files:**
- Create: `src/lib/notifications/alert-policy.ts`
- Create: `src/lib/notifications/alert-policy.test.ts`
- Create: `src/lib/notifications/alert-lock.ts`
- Create: `src/lib/notifications/alert-lock.test.ts`

**Interfaces:**
- Consumes: `notificationEntityId`, `notificationEntityKind`, `NotificationCopySource`, `NotificationCopyType` từ `copy.ts`.
- Produces:
  - `isDirectNotification(type: NotificationCopyType): boolean`
  - `notificationAlertTag(notification: NotificationCopySource): string` (dạng `"<kind>:<id>:direct|activity"`)
  - `shouldRenotify(notification: Pick<NotificationCopySource, "type">): boolean`
  - `shouldShowNativePopup(input: { permission: NotificationPermission | null; documentHasFocus: boolean; pushSubscribedOnThisDevice: boolean }): boolean`
  - `HIDDEN_TAB_CLAIM_DELAY_MS = 400`, `alertClaimDelayMs(visibility: string): number`
  - `type AlertLockManager`, `ALERT_LOCK_HOLD_MS = 60_000`, `claimNotificationAlert(notificationId: string, locks?: AlertLockManager | null, holdMs?: number): Promise<boolean>`

> [codex] Review — nhánh fallback "không có Web Locks thì báo luôn" không thể đảm bảo mục tiêu “một lần cho cả trình duyệt”: mọi tab vẫn sẽ alert. Hoặc thêm fallback cross-tab (BroadcastChannel/localStorage), hoặc ghi rõ đây chỉ là best-effort trên browser không hỗ trợ Web Locks.

> [codex] Quyết định còn thiếu — chỉ `mentioned`, `assigned`, `unassigned`, `reopened` là `direct`; vì vậy `overdue`, `due_date_overdue`, `sla_escalated` có thể bị một comment cùng task thay im lặng. Cần chốt rõ các alert khẩn có được phép như vậy không, rồi thêm test cho thứ tự “critical alert sau/before comment”.

- [ ] **Step 1: Viết test hỏng cho policy**

Tạo `src/lib/notifications/alert-policy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  HIDDEN_TAB_CLAIM_DELAY_MS,
  alertClaimDelayMs,
  isDirectNotification,
  notificationAlertTag,
  shouldRenotify,
  shouldShowNativePopup,
} from "./alert-policy";

describe("tag gộp popup", () => {
  it("loại gọi đích danh có họ tag riêng, không bị bình luận cùng task đè mất", () => {
    expect(notificationAlertTag({ type: "mentioned", task_id: "t1" })).toBe("task:t1:direct");
    expect(notificationAlertTag({ type: "commented", task_id: "t1" })).toBe("task:t1:activity");
  });

  it("dùng đúng loại bản ghi và id", () => {
    expect(
      notificationAlertTag({
        type: "assigned",
        entity_type: "enrollment",
        entity_id: "r9",
        task_id: "r9",
      })
    ).toBe("enrollment:r9:direct");
  });

  it("chỉ loại gọi đích danh mới kêu lại khi thay thế popup cũ", () => {
    for (const type of ["mentioned", "assigned", "unassigned", "reopened"] as const) {
      expect(isDirectNotification(type), type).toBe(true);
      expect(shouldRenotify({ type }), type).toBe(true);
    }
    for (const type of ["commented", "waiting_reminder", "task_created"] as const) {
      expect(shouldRenotify({ type }), type).toBe(false);
    }
  });
});

describe("khi nào cái chuông tự bật popup hệ điều hành", () => {
  const base = {
    permission: "granted" as const,
    documentHasFocus: false,
    pushSubscribedOnThisDevice: false,
  };

  it("bật khi cửa sổ không focus và máy chưa có push", () => {
    expect(shouldShowNativePopup(base)).toBe(true);
  });

  it("không bật khi người dùng đang thao tác trên portal — toast đã báo", () => {
    expect(shouldShowNativePopup({ ...base, documentHasFocus: true })).toBe(false);
  });

  it("không bật khi máy có push — service worker lo, bật thêm là kêu hai lần", () => {
    expect(shouldShowNativePopup({ ...base, pushSubscribedOnThisDevice: true })).toBe(false);
  });

  it("không bật khi chưa được cấp quyền", () => {
    expect(shouldShowNativePopup({ ...base, permission: "default" })).toBe(false);
    expect(shouldShowNativePopup({ ...base, permission: null })).toBe(false);
  });
});

describe("tab nào giành quyền báo", () => {
  it("tab đang hiện giành ngay, tab ẩn chờ một nhịp", () => {
    expect(alertClaimDelayMs("visible")).toBe(0);
    expect(alertClaimDelayMs("hidden")).toBe(HIDDEN_TAB_CLAIM_DELAY_MS);
  });
});
```

- [ ] **Step 2: Viết test hỏng cho lock**

Tạo `src/lib/notifications/alert-lock.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ALERT_LOCK_HOLD_MS,
  claimNotificationAlert,
  type AlertLockManager,
} from "./alert-lock";

/** Web Locks giả với `ifAvailable`: tên đang bị giữ thì callback nhận null. */
function fakeLockManager(): AlertLockManager {
  const held = new Set<string>();
  return {
    request(name, _options, callback) {
      if (held.has(name)) return Promise.resolve(callback(null));
      held.add(name);
      return Promise.resolve(callback({ name })).finally(() => held.delete(name));
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("claimNotificationAlert", () => {
  it("chỉ tab đầu tiên giành được quyền báo cho một thông báo", async () => {
    vi.useFakeTimers();
    const locks = fakeLockManager();
    await expect(claimNotificationAlert("task:n1", locks)).resolves.toBe(true);
    await expect(claimNotificationAlert("task:n1", locks)).resolves.toBe(false);
  });

  it("thông báo khác thì giành riêng", async () => {
    vi.useFakeTimers();
    const locks = fakeLockManager();
    await expect(claimNotificationAlert("task:n1", locks)).resolves.toBe(true);
    await expect(claimNotificationAlert("task:n2", locks)).resolves.toBe(true);
  });

  it("nhả khoá sau thời gian giữ", async () => {
    vi.useFakeTimers();
    const locks = fakeLockManager();
    await claimNotificationAlert("task:n1", locks);
    await vi.advanceTimersByTimeAsync(ALERT_LOCK_HOLD_MS);
    await expect(claimNotificationAlert("task:n1", locks)).resolves.toBe(true);
  });

  it("trình duyệt không có Web Locks thì vẫn báo — thừa còn hơn mất", async () => {
    await expect(claimNotificationAlert("task:n1", null)).resolves.toBe(true);
  });

  it("Web Locks ném lỗi thì vẫn báo", async () => {
    const broken: AlertLockManager = {
      request: () => Promise.reject(new Error("boom")),
    };
    await expect(claimNotificationAlert("task:n1", broken)).resolves.toBe(true);
  });
});
```

- [ ] **Step 3: Chạy test, xác nhận hỏng**

Run: `npx vitest run src/lib/notifications/alert-policy.test.ts src/lib/notifications/alert-lock.test.ts`
Expected: FAIL. `Failed to resolve import "./alert-policy"` và `"./alert-lock"`.

- [ ] **Step 4: Viết `alert-policy.ts`**

Tạo `src/lib/notifications/alert-policy.ts`:

```ts
import {
  notificationEntityId,
  notificationEntityKind,
  type NotificationCopySource,
  type NotificationCopyType,
} from "./copy";

/**
 * Luật "báo động" — tiếng chuông và popup hệ điều hành — dùng chung cho cái
 * chuông trong web và Web Push. Toàn hàm thuần.
 */

/**
 * Loại gọi ĐÍCH DANH người nhận. Chúng có họ tag riêng và được kêu lại khi thay
 * thế: trước 16/09/2026 mọi thông báo của một task chung tag `task:<id>`, nên bị
 * @ ngay sau một bình luận cùng task là popup cũ bị thay im lặng — không tiếng.
 */
const DIRECT_TYPES: ReadonlySet<NotificationCopyType> = new Set<NotificationCopyType>([
  "mentioned",
  "assigned",
  "unassigned",
  "reopened",
]);

export function isDirectNotification(type: NotificationCopyType): boolean {
  return DIRECT_TYPES.has(type);
}

/**
 * Tag của popup. Cùng tag thì popup mới thay popup cũ thay vì chồng đống.
 * Hai họ: `direct` (gọi đích danh) và `activity` (bình luận, lời nhắc...).
 */
export function notificationAlertTag(notification: NotificationCopySource): string {
  const family = isDirectNotification(notification.type) ? "direct" : "activity";
  return `${notificationEntityKind(notification)}:${notificationEntityId(notification)}:${family}`;
}

/** Thay popup cùng tag có kêu lại không — chỉ loại gọi đích danh. */
export function shouldRenotify(notification: Pick<NotificationCopySource, "type">): boolean {
  return isDirectNotification(notification.type);
}

/**
 * Cái chuông có tự bật popup hệ điều hành không.
 *
 * - Đang focus portal: không — toast trong trang đã báo.
 * - Máy có Web Push: không — service worker bật popup; chuông bật thêm là hai cái.
 * - Còn lại: có. Chỉ 6/30 người nhận có push (15/09/2026), nên với phần lớn mọi
 *   người đây là cảnh báo DUY NHẤT ra ngoài trình duyệt — không được bỏ hẳn.
 */
export function shouldShowNativePopup(input: {
  permission: NotificationPermission | null;
  documentHasFocus: boolean;
  pushSubscribedOnThisDevice: boolean;
}): boolean {
  if (input.permission !== "granted") return false;
  if (input.documentHasFocus) return false;
  return !input.pushSubscribedOnThisDevice;
}

/**
 * Tab ẩn chờ một nhịp trước khi giành quyền báo, để tab đang hiện thắng: tab
 * chưa từng được bấm thì AudioContext còn bị treo và tiếng chuông không phát.
 */
export const HIDDEN_TAB_CLAIM_DELAY_MS = 400;

export function alertClaimDelayMs(visibility: string): number {
  return visibility === "visible" ? 0 : HIDDEN_TAB_CLAIM_DELAY_MS;
}
```

- [ ] **Step 5: Viết `alert-lock.ts`**

Tạo `src/lib/notifications/alert-lock.ts`:

```ts
/**
 * Giành quyền báo động cho MỘT thông báo trên cả trình duyệt.
 *
 * Mỗi tab portal có một cái chuông riêng, và ping realtime tới mọi tab. Trước
 * 16/09/2026 tab nào cũng tự kêu và tự bật popup: mở 3 tab là 3 tiếng, 3 popup
 * cho cùng một thông báo. Web Locks là khoá dùng chung giữa các tab cùng origin:
 * tab đầu tiên giữ được khoá mang tên id thông báo thì báo, các tab sau nhận
 * `null` và im.
 *
 * Giữ khoá 60 giây: tab ẩn bị trình duyệt làm chậm có thể tải danh sách trễ vài
 * giây; nhả sớm quá thì nó giành lại được và báo lần hai.
 */

/** Phần của `LockManager` mà hàm này dùng — tách kiểu để test tiêm bản giả. */
export type AlertLockManager = {
  request(
    name: string,
    options: { ifAvailable: true },
    callback: (lock: unknown) => Promise<void> | void
  ): Promise<unknown>;
};

export const ALERT_LOCK_HOLD_MS = 60_000;

function browserLockManager(): AlertLockManager | null {
  if (typeof navigator === "undefined" || !("locks" in navigator)) return null;
  return navigator.locks as unknown as AlertLockManager;
}

export function claimNotificationAlert(
  notificationId: string,
  locks: AlertLockManager | null = browserLockManager(),
  holdMs: number = ALERT_LOCK_HOLD_MS
): Promise<boolean> {
  // Không có Web Locks (trình duyệt cũ): báo luôn — thừa một tiếng còn hơn mất.
  if (!locks) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    locks
      .request(`agent-portal:notif-alert:${notificationId}`, { ifAvailable: true }, (lock) => {
        if (!lock) {
          resolve(false);
          return;
        }
        resolve(true);
        return new Promise<void>((release) => {
          setTimeout(release, holdMs);
        });
      })
      .catch(() => resolve(true));
  });
}
```

- [ ] **Step 6: Chạy test, xác nhận qua**

Run: `npx vitest run src/lib/notifications/alert-policy.test.ts src/lib/notifications/alert-lock.test.ts`
Expected: PASS (7 + 5 tests).

- [ ] **Step 7: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: không lỗi.

- [ ] **Step 8: Commit**

```bash
git add src/lib/notifications/alert-policy.ts src/lib/notifications/alert-policy.test.ts \
  src/lib/notifications/alert-lock.ts src/lib/notifications/alert-lock.test.ts
git commit -m "feat(notifications): luật báo động — tag hai họ, popup theo focus/push, giành quyền báo qua Web Locks" \
  -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Nối luật báo động vào chuông, push và service worker

Ba file này **phải đi cùng một commit**. Đổi service worker sang `focused` mà chuông chưa đổi thì máy có push nhận cả push lẫn popup khi cửa sổ không focus. Đổi chuông mà service worker chưa đổi thì máy có push mất cảnh báo khi cửa sổ hiện nhưng không focus.

**Files:**
- Modify: `src/app/(authed)/_components/NotificationBell.tsx`
- Modify: `src/lib/notifications/push-server.ts` (`PushPayload` ~L19-25, `buildPushPayload` ~L176-191)
- Modify: `public/sw.js`

**Interfaces:**
- Consumes (Task 4): `claimNotificationAlert`, `alertClaimDelayMs`, `notificationAlertTag`, `shouldRenotify`, `shouldShowNativePopup`. Cộng `isPushEnabledOnThisDevice` từ `push-client.ts` (đã có).
- Produces: `PushPayload.renotify: boolean`.

- [ ] **Step 1: Import và hằng số trong chuông**

Trong `NotificationBell.tsx`, thêm ba import ngay dưới dòng `import { playNotificationChime, primeNotificationSound } from "@/lib/tasks/sound";`:

```ts
import { claimNotificationAlert } from "@/lib/notifications/alert-lock";
import {
  alertClaimDelayMs,
  notificationAlertTag,
  shouldRenotify,
  shouldShowNativePopup,
} from "@/lib/notifications/alert-policy";
import { isPushEnabledOnThisDevice } from "@/lib/notifications/push-client";
```

Thêm hằng số ngay dưới `const TOAST_MS = 7000;`:

```ts
// Cron gửi một ping cho mỗi task mỗi loại — có lượt 12 ping cho cùng một người.
// Gom lại thành một lần tải để một đợt chỉ kêu một tiếng.
const REALTIME_PING_DEBOUNCE_MS = 1500;
```

- [ ] **Step 2: Hàm báo động ở cấp module**

Thêm ngay **trên** dòng `export function NotificationBell() {`:

```tsx
/**
 * Tiếng chuông + popup hệ điều hành cho các thông báo MỚI — đúng một lần cho cả
 * trình duyệt, dù mở bao nhiêu tab. Toast không đi qua đây: nó nằm trong trang,
 * người dùng chỉ thấy toast của tab đang nhìn.
 */
async function alertFreshNotifications(
  fresh: Notif[],
  pushSubscribedOnThisDevice: boolean
): Promise<void> {
  const delay = alertClaimDelayMs(document.visibilityState);
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));

  const claimed = (
    await Promise.all(
      fresh.map(async (n) => ((await claimNotificationAlert(n.id)) ? n : null))
    )
  ).filter((n): n is Notif => n !== null);
  if (claimed.length === 0) return;

  // Một tiếng cho cả đợt, không phải mỗi dòng một tiếng.
  playNotificationChime();

  const permission = "Notification" in window ? Notification.permission : null;
  if (
    !shouldShowNativePopup({
      permission,
      documentHasFocus: document.hasFocus(),
      pushSubscribedOnThisDevice,
    })
  ) {
    return;
  }
  for (const n of [...claimed].reverse()) {
    // lib.dom của TypeScript 5.9 không khai `renotify`, dù Chrome hỗ trợ.
    const options: NotificationOptions & { renotify?: boolean } = {
      body: nativeNotificationBody(n),
      tag: notificationAlertTag(n),
      renotify: shouldRenotify(n),
    };
    new Notification(`${entityKey(n)} · ${notificationHeading(n)}`, options);
  }
}
```

> [codex] Blocker — lock đang được claim theo **từng notification**. Với batch `[n1, n2]`, tab A có thể thắng `n1`, tab B thắng `n2`; cả hai có `claimed.length > 0` và cùng `playNotificationChime()`. Cần một batch-level lock riêng cho chime (khóa theo danh sách id đã sort hoặc một batch key ổn định), sau đó mới claim từng id nếu vẫn cần popup riêng.

> [codex] Bug — `playNotificationChime()` chạy trước khi xét `pushSubscribedOnThisDevice`. Khi portal không focus và máy có Web Push, service worker sẽ hiện native push còn page vẫn chime, trái với mục tiêu một alert và checklist Task 7. Tách thêm `shouldPlayChime`: khi native push đang là kênh chủ sở hữu alert, page không được chime.

- [ ] **Step 3: Ref trạng thái push và bộ đếm gom ping**

Trong component, ngay dưới dòng `const initialized = useRef(false);`, thêm:

```tsx
  // Máy này có đăng ký Web Push không. Có thì popup ngoài trình duyệt là việc
  // của service worker. Đọc lại mỗi lần cửa sổ được focus, vì người dùng có thể
  // vừa bật/tắt ở Settings.
  const pushSubscribedRef = useRef(false);
  const pingTimerRef = useRef<number | null>(null);
```

- [ ] **Step 4: Thay đoạn chime + popup trong `load()`**

Trong `load`, thay nguyên đoạn từ `// One chime per batch, not per item, so a burst doesn't overlap tones.` tới hết vòng `for (const n of [...fresh].reverse()) { ... }` (có `new Notification` bên trong) bằng:

```tsx
      // Oldest first so the newest toast ends up on top of the stack.
      for (const n of [...fresh].reverse()) {
        setToasts((cur) => [n, ...cur].slice(0, 4));
        const id = n.id;
        setTimeout(
          () => setToasts((cur) => cur.filter((t) => t.id !== id)),
          TOAST_MS
        );
      }
      if (fresh.length > 0) {
        void alertFreshNotifications(fresh, pushSubscribedRef.current);
      }
```

- [ ] **Step 5: Nạp trạng thái push**

Thêm effect ngay **trên** comment `// Ask once for OS-notification permission (so background toasts can fire).`:

```tsx
  useEffect(() => {
    let active = true;
    const refresh = () => {
      void isPushEnabledOnThisDevice()
        .then((enabled) => {
          if (active) pushSubscribedRef.current = enabled;
        })
        .catch(() => {});
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
    };
  }, []);
```

- [ ] **Step 6: Gom ping realtime**

Trong effect realtime, thay:

```tsx
      .on("broadcast", { event: "new" }, () => void load())
```

bằng:

```tsx
      .on("broadcast", { event: "new" }, () => {
        if (pingTimerRef.current !== null) window.clearTimeout(pingTimerRef.current);
        pingTimerRef.current = window.setTimeout(() => {
          pingTimerRef.current = null;
          void load();
        }, REALTIME_PING_DEBOUNCE_MS);
      })
```

Trong hàm dọn của cùng effect, ngay sau `active = false;`, thêm:

```tsx
      if (pingTimerRef.current !== null) {
        window.clearTimeout(pingTimerRef.current);
        pingTimerRef.current = null;
      }
```

- [ ] **Step 7: Payload push mang tag hai họ + renotify**

Trong `src/lib/notifications/push-server.ts`, thêm import ngay dưới khối import từ `"./copy"`:

```ts
import { notificationAlertTag, shouldRenotify } from "./alert-policy";
```

Thay `PushPayload`:

```ts
export type PushPayload = {
  title: string;
  body: string;
  url: string;
  /** Thông báo cùng `tag` sẽ thay thế nhau thay vì chồng đống. */
  tag: string;
  /** Thay thế popup cùng tag có kêu lại không — chỉ loại gọi đích danh. */
  renotify: boolean;
};
```

Trong `buildPushPayload`, thay dòng comment `// Gộp theo bản ghi...` và dòng `tag: ...` bằng:

```ts
    // Hai họ tag theo bản ghi (xem alert-policy): 5 bình luận trong một task chỉ
    // để lại một dòng, nhưng một lần bị @ vẫn kêu.
    tag: notificationAlertTag(notification),
    renotify: shouldRenotify(notification),
```

- [ ] **Step 8: Service worker**

Trong `public/sw.js`:

(a) Đổi `const SW_VERSION = "2026-09-10.1";` thành `const SW_VERSION = "2026-09-16.1";`.

(b) Thay nguyên khối comment + hàm `hasVisibleWindow` bằng:

```js
/**
 * Người dùng có đang THAO TÁC trên portal không.
 *
 * Đang thao tác thì toast trong web đã báo; bắn thêm popup hệ điều hành là kêu
 * hai lần cho cùng một việc.
 *
 * Trước 16/09/2026 hàm này hỏi `visible`: cửa sổ portal mở ở màn hình phụ, hoặc
 * nằm cạnh cửa sổ khác, vẫn tính là "đang nhìn" nên push bị nuốt — mà cái chuông
 * của máy có push cũng không bật popup. Chỉ `focused` mới chắc người dùng thấy toast.
 */
async function hasFocusedWindow() {
  const windows = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  return windows.some((client) => client.focused);
}
```

(c) Trong handler `push`, đổi `if (await hasVisibleWindow()) return;` thành `if (await hasFocusedWindow()) return;`.

(d) Trong `showNotification(title, { ... })`, ngay sau dòng `tag: payload.tag || "agent-portal",` thêm:

```js
        // Thay popup cùng tag mà vẫn kêu — chỉ server bật cho loại gọi đích danh.
        renotify: Boolean(payload.renotify),
```

- [ ] **Step 9: Typecheck, lint, test**

Run: `npm run typecheck && npm run lint && npx vitest run src/lib/notifications`
Expected: không lỗi; PASS.

- [ ] **Step 10: Commit**

```bash
git add "src/app/(authed)/_components/NotificationBell.tsx" src/lib/notifications/push-server.ts public/sw.js
git commit -m "fix(notifications): mỗi thông báo chỉ kêu và bật popup một lần cho cả trình duyệt" \
  -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Mở task là đã đọc thông báo của task đó

**Files:**
- Modify: `src/lib/tasks/client-events.ts` (thêm cuối file)
- Modify: `src/app/(authed)/tasks/_components/TaskBoardClient.tsx` (import L12-18, ~L501-529)
- Modify: `src/app/(authed)/_components/NotificationBell.tsx` (import client-events, thêm một effect)

**Interfaces:**
- Produces: `NOTIFICATIONS_READ_EVENT`, `publishNotificationsRead(taskId: string): void`, `subscribeNotificationsRead(listener: (taskId: string) => void): () => void`

- [ ] **Step 1: Sự kiện trong `client-events.ts`**

Thêm vào cuối `src/lib/tasks/client-events.ts`:

```ts
export const NOTIFICATIONS_READ_EVENT = "agent-portal:notifications-read";

type NotificationsReadDetail = { taskId: string };

/**
 * Báo cho cái chuông trong CÙNG tab rằng thông báo của một task vừa được đánh
 * dấu đã đọc ở chỗ khác (mở task trên board). Không có tín hiệu này thì số trên
 * chuông đứng yên tới lượt hỏi tóm tắt kế tiếp — tới 2 phút. Tab khác tự sửa ở
 * lượt hỏi hoặc lần focus kế tiếp.
 */
export function publishNotificationsRead(taskId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<NotificationsReadDetail>(NOTIFICATIONS_READ_EVENT, {
      detail: { taskId },
    })
  );
}

export function subscribeNotificationsRead(
  listener: (taskId: string) => void
): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (event: Event) => {
    const taskId = (event as CustomEvent<NotificationsReadDetail>).detail?.taskId;
    if (taskId) listener(taskId);
  };
  window.addEventListener(NOTIFICATIONS_READ_EVENT, handler);
  return () => window.removeEventListener(NOTIFICATIONS_READ_EVENT, handler);
}
```

- [ ] **Step 2: Board đánh dấu mọi thông báo của task**

Trong `TaskBoardClient.tsx`, thêm `publishNotificationsRead` vào import từ `"@/lib/tasks/client-events"`:

```ts
import {
  createTaskDataInvalidationSourceId,
  OPEN_TASK_EVENT,
  publishNotificationsRead,
  publishTaskDataInvalidation,
  subscribeTaskDataInvalidation,
  writeTaskDeepLink,
} from "@/lib/tasks/client-events";
```

Thay hai `useCallback` `markAssignedNotificationRead` và `markNewAssignedTaskSeen` (khoảng L501-518) bằng:

```tsx
  // Mở task = đã thấy mọi thông báo của task đó (bình luận, nhắc tên, lời
  // nhắc...), không riêng thông báo được giao việc. Trước 16/09/2026 chỉ
  // `assigned` được xoá, nên người hay mở task từ board vẫn ôm hàng nghìn dòng
  // chưa đọc (khang: 2.575) và cái chuông mất tác dụng.
  const markTaskNotificationsRead = useCallback(async (taskId: string) => {
    const res = await fetch("/api/tasks/notifications/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId }),
    }).catch(() => null);
    if (res?.ok) publishNotificationsRead(taskId);
  }, []);

  // Một lần mở chỉ gửi một yêu cầu, dù openTaskById và effect bên dưới cùng gọi.
  const lastMarkedTaskIdRef = useRef<string | null>(null);

  const markNewAssignedTaskSeen = useCallback((taskId: string) => {
    if (newAssignedTaskIds.has(taskId)) {
      setNewAssignedTaskIds((current) => {
        if (!current.has(taskId)) return current;
        const next = new Set(current);
        next.delete(taskId);
        return next;
      });
    }
    if (lastMarkedTaskIdRef.current === taskId) return;
    lastMarkedTaskIdRef.current = taskId;
    void markTaskNotificationsRead(taskId);
  }, [markTaskNotificationsRead, newAssignedTaskIds]);
```

Thay effect:

```tsx
  useEffect(() => {
    if (!openId || !newAssignedTaskIds.has(openId)) return;
    const timer = window.setTimeout(() => markNewAssignedTaskSeen(openId), 0);
    return () => window.clearTimeout(timer);
  }, [markNewAssignedTaskSeen, newAssignedTaskIds, openId]);
```

bằng:

```tsx
  // Mọi đường mở task (bấm thẻ, deep link, bấm từ chuông) đều đi qua openId.
  // Đóng task thì quên id vừa đánh dấu, để mở lại sau này vẫn xoá được thông báo
  // mới đến trong lúc đóng.
  useEffect(() => {
    if (!openId) {
      lastMarkedTaskIdRef.current = null;
      return;
    }
    const timer = window.setTimeout(() => markNewAssignedTaskSeen(openId), 0);
    return () => window.clearTimeout(timer);
  }, [markNewAssignedTaskSeen, openId]);
```

`openTaskById` giữ nguyên lời gọi `markNewAssignedTaskSeen(id)`. Đường mở khoá task quá hạn không set `openId`, nên vẫn cần lời gọi đó.

> [codex] Bug — `openTaskById` hiện gọi hàm này **trước** khi phát hiện task overdue và chuyển sang modal unlock. Sau khi hàm được đổi thành mark toàn bộ notification, chỉ bấm mở modal unlock cũng sẽ làm tất cả notification của task thành read dù detail chưa mở. Tách việc xoá badge `assigned` khỏi `markTaskNotificationsRead`; chỉ gọi mark-all sau khi `openId` thực sự được set.

- [ ] **Step 3: Chuông cập nhật ngay khi nhận sự kiện**

Trong `NotificationBell.tsx`, thêm `subscribeNotificationsRead` vào import từ `"@/lib/tasks/client-events"`:

```ts
import {
  dispatchOpenTask,
  publishTaskDataInvalidation,
  subscribeNotificationsRead,
} from "@/lib/tasks/client-events";
```

Thêm effect ngay **dưới** effect nạp trạng thái push (Task 5, Step 5):

```tsx
  // Mở task trên board là đã đọc mọi thông báo của task đó (TaskBoardClient).
  useEffect(
    () =>
      subscribeNotificationsRead((taskId) => {
        setItems((cur) =>
          cur.map((n) =>
            entityKind(n) === "task" && entityId(n) === taskId ? { ...n, is_read: true } : n
          )
        );
        void loadSummary();
      }),
    [loadSummary]
  );
```

> [codex] Accuracy — effect chỉ đổi `items` rồi gọi `loadSummary()` bất đồng bộ; badge không giảm “ngay” như phần mô tả. Sau POST thành công, cần giảm `unread` local theo số item chưa đọc của task đó, rồi dùng `loadSummary()` để reconcile.

- [ ] **Step 4: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: không lỗi.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tasks/client-events.ts "src/app/(authed)/tasks/_components/TaskBoardClient.tsx" \
  "src/app/(authed)/_components/NotificationBell.tsx"
git commit -m "fix(tasks): mở task là đánh dấu đã đọc mọi thông báo của task, chuông cập nhật số ngay" \
  -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Changelog, kiểm tra toàn bộ, danh sách thử tay cho người dùng

**Files:**
- Modify: `changelog.md` (chèn ngay dưới đoạn mở đầu, trên mục `## 2026-09-15 — Distribute pool: ...`)

- [ ] **Step 1: Ghi changelog**

Chèn vào `changelog.md`, ngay trên dòng `## 2026-09-15 — Distribute pool: tick agent thì hệ số luôn bằng 1, ô tick xanh ngay`:

```markdown
## 2026-09-16 — Thông báo Task CS: mỗi việc chỉ báo một lần

**Tạo task không còn ra hai thông báo cho cùng người.** Task Backlog Urgent/High
chưa ai nhận từng bắn cả `task_created` lẫn `backlog_attention`; ai có task.manage
và là admin cũ, hoặc là agent của task, nhận cả hai (CS-237: 4/12 người). Giờ loại
cụ thể hơn thắng: được giao > `backlog_attention` > `task_created`
(`buildCreateTaskNotificationRows`).

**Một thông báo chỉ kêu và bật popup một lần cho cả trình duyệt.** Mỗi tab portal
có một cái chuông, và tab nào cũng tự kêu + tự bật popup hệ điều hành, kể cả tab
đang focus. Giờ các tab giành quyền qua Web Locks theo id thông báo; toast vẫn
hiện ở mọi tab. Chuông chỉ bật popup khi cửa sổ không focus VÀ máy chưa đăng ký
Web Push (6/30 người có push — không bỏ hẳn được). Ping realtime liền nhau gom
thành một lần tải sau 1,5 giây.

**Service worker xét `focused` thay `visible`**, nên cửa sổ portal mở mà không
focus vẫn nhận push. Tag chia hai họ `<kind>:<id>:direct` (mentioned, assigned,
unassigned, reopened — kêu lại khi thay thế) và `<kind>:<id>:activity` (thay im
lặng), để bị @ không bị bình luận cùng task đè mất tiếng. Áp cho cả thông báo
enrollment và time off vì dùng chung chuông và service worker.

**`stale` chỉ nhắc task In Progress chưa quá hạn SLA.** To Do, Waiting, Billing
đã có lời nhắc riêng; In Progress quá hạn đã có `overdue_reminder`. Hết cảnh cùng
task nhận hai lời nhắc trong một lượt cron.

**Mở task là đánh dấu đã đọc mọi thông báo của task đó**, không riêng `assigned`,
và chuông cập nhật số ngay trong tab.

**Câu chữ:** hai loại Due Date được coi là thông báo hệ thống (hết "system Task
passed its due date"); bình luận ghi "commented on a task"; lời nhắc của Billing
ghi "Task is still in Billing — reminder" (cron ghi `detail = "billing"`, không
thêm loại mới). File rollout 2026-09-04 bổ sung `task_created` vào danh sách CHECK
— chạy lại bản cũ từng làm nổ mọi insert thông báo tạo task.
```

- [ ] **Step 2: Chạy toàn bộ kiểm tra**

Run: `npm run typecheck && npm run lint && npm run test:run`
Expected: không lỗi. Tất cả test PASS, gồm 6 file test mới hoặc đã sửa.

- [ ] **Step 3: Build trong worktree tách riêng**

Run: `lsof -nP -iTCP:3000 -sTCP:LISTEN`. Nếu **có** process nghĩa là dev server đang chạy, nên build trong worktree:

```bash
BUILD_DIR="$(mktemp -d)/agent-portal-build"
git worktree add --detach "$BUILD_DIR" HEAD
cp -Rc node_modules "$BUILD_DIR/" && cp .env.local "$BUILD_DIR/"
(cd "$BUILD_DIR" && npm run build)
git worktree remove --force "$BUILD_DIR"
```

Nếu **không** có dev server: `npm run build`.
Expected: build thành công, không lỗi TypeScript.

- [ ] **Step 4: Commit**

```bash
git add changelog.md
git commit -m "docs(changelog): thông báo Task CS — mỗi việc chỉ báo một lần" \
  -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Bàn giao cho người dùng review — KHÔNG push**

Báo lại người dùng: tên nhánh, danh sách commit (`git log --oneline main..task-noti-cleanup`), kết quả kiểm tra. Kèm danh sách thử tay dưới đây. Mọi thao tác tạo thông báo thật đều chạm database production, nên để người dùng tự làm bằng hai tài khoản của họ.

1. **Nhiều tab:** mở portal ở 3 tab bằng tài khoản A. Tài khoản B bình luận vào task A đang được giao. Kỳ vọng: **một** tiếng chuông, toast ở tab đang nhìn, **không** popup hệ điều hành (cửa sổ đang focus).
2. **Cửa sổ không focus, máy chưa có push:** bấm sang app khác rồi làm lại bước 1. Kỳ vọng: **một** popup, không phải ba.
3. **Máy có push** (Settings → bật push): làm lại bước 2. Kỳ vọng: **một** popup do service worker bật; chuông không bật thêm. Nếu vẫn thấy hành vi cũ thì đóng hết tab portal rồi mở lại, vì service worker cũ còn giữ tới khi mọi tab đóng. Kiểm `SW_VERSION = 2026-09-16.1` trong DevTools → Application → Service Workers.
4. **@ sau bình luận:** B bình luận rồi @A trong cùng task, cửa sổ A không focus. Kỳ vọng: popup thứ hai **có kêu**.
5. **Tạo task gấp:** B tạo task Backlog, High, không giao ai. Kỳ vọng: tài khoản admin chỉ có **một** dòng "created an urgent/high backlog task".
6. **Mở task:** A có vài thông báo chưa đọc của một task. Mở task đó trên board. Kỳ vọng: số trên chuông giảm ngay; mở chuông thấy các dòng của task đó đã đọc.

Tiêu đề trong changelog dùng `2026-09-16` là ngày dự kiến thực thi. Đổi thành ngày thật lúc làm.
