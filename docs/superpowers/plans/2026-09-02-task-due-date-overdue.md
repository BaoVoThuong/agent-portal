# Due Date Overdue — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development hoặc superpowers:executing-plans. Các bước dùng checkbox (`- [ ]`).

**Goal:** Task quá hạn theo **Due Date** (hạn cứng do admin đặt) thì bắn thông báo cho admin / agent / assistant của agent / người được giao, tô nền hồng đỏ nhạt trong bảng cho **mọi người** thấy, và ghi một dòng vào activity.

**Architecture:** Bám đúng bộ máy overdue-theo-SLA đang chạy — RPC nguyên tử làm cổng chống bắn trùng, cron 15 phút quét, `task_notifications` + `task_activity` là nơi lưu. Luật "quá hạn" tách thành hàm thuần trong `src/lib/tasks/due-date.ts` để **một** định nghĩa phục vụ cả cron (server) lẫn màu nền (browser).

**Tech Stack:** Next.js 16.2.4, TypeScript, Supabase (PostgREST + PL/pgSQL), vitest 2.1.9, Tailwind v4, GitHub Actions cron.

---

## Quyết định đã chốt với người dùng (2026-09-02)

| Câu hỏi | Chốt | Hệ quả |
| --- | --- | --- |
| "Hết ngày" theo múi giờ nào? | **Texas → `America/Chicago`** | Task hạn `Oct 9` thành quá hạn lúc **00:00 giờ Central ngày Oct 10**. So theo UTC như hàm hôm qua thì noti bay từ 7 giờ tối Oct 9 giờ Texas — agent vẫn đang trong ngày làm việc. |
| Nhắc lại thế nào? | **Mỗi 24 giờ**, tới khi xong | Giống `overdue_reminder` của SLA. Cần cột `due_overdue_reminded_at` riêng. |
| Đổi Due Date rồi lại quá hạn? | **Bắn lại** | Dời hạn là một cam kết mới, vỡ cam kết mới thì phải báo lại. Cần **xoá dấu đã-báo mỗi khi `due_date` đổi** — làm bằng trigger DB, không làm ở route. |

**Ghi chú về Texas:** gần như toàn bang là Central; chỉ vùng El Paso ở cực tây là Mountain. Plan này dùng `America/Chicago` cho toàn hệ thống. Nếu sau này cần theo từng người thì đó là việc khác.

---

## Global Constraints

- **Thư mục làm việc**: `/Users/vothuongbao/Project/Web/agent-portal`.
- **Test**: vitest `environment: "node"`, `include: ["src/**/*.test.ts"]`. **`.tsx` KHÔNG được thu thập** — đừng viết `*.test.tsx`.
- **Bốn lệnh kiểm tra** trước mỗi commit: `npm run typecheck` · `npm run lint` · `npm run test:run` · `npm run build`
- **Changelog bắt buộc**: mỗi thay đổi logic thêm một mục vào `changelog.md`, mới nhất **trên cùng**.
- **KHÔNG tự push.** Quyền push theo từng lần, phải nêu tên remote. `origin` = GitHub. `vercel` = deploy eps-portal.vercel.app.
- **Trước khi push**: `node scripts/check-tracked-imports.mjs`, rồi build từ checkout sạch.
- **SQL** ở `supabase/rollouts/`, **idempotent**. **Người dùng tự chạy**; agent không chạy migration. Task có SQL phải dừng chờ xác nhận.
- **Ngôn ngữ**: comment giải thích *tại sao* viết tiếng Việt; chuỗi hiển thị cho người dùng cuối viết **tiếng Anh**.

---

## Bối cảnh: những gì ĐANG có (đã đối chiếu source)

Đọc kỹ phần này trước khi gõ dòng nào — plan bám sát bộ máy sẵn có chứ không dựng cái mới.

**Due Date là custom column, không phải cột bảng.** Scope `cs`, `key = due_date`, type `date`, lưu trong `tasks.custom_values.due_date` dạng `"YYYY-MM-DD"`. Hàm đọc/format đã có ở `src/lib/tasks/due-date.ts` (làm hôm 2026-09-01).

**Overdue theo SLA — bộ máy mẫu để bắt chước:**
- `mark_task_overdue_atomic(p_task_id, p_due_at, p_sla_minutes)` (`supabase/schema.sql:3018`) — cập nhật cờ **có điều kiện** rồi `get diagnostics v_updated = row_count`, trả `false` nếu không đổi được dòng nào. Đó chính là **cổng chống bắn trùng** khi hai lượt cron chồng nhau.
- Cron `GET /api/cron/check-overdue` (`src/app/api/cron/check-overdue/route.ts`), chạy **mỗi 15 phút** qua `.github/workflows/task-reminders.yml`, xác thực bằng `checkCronAuthorization`.
- Người nhận lấy từ `fetchTaskAssigneeEmails(taskId)`, `fetchAgentOwnerAndAssistantEmails(agentEmail)` (**gộp sẵn agent + assistant**), `fetchAdminEmails()`.
- `insertNotifications(rows)` ghi bảng rồi broadcast realtime.

**Hai chỗ có danh sách đóng, thêm giá trị mới phải sửa cả hai:**
- `task_notifications.type` có **CHECK constraint** trong DB (`supabase/schema.sql:2763`) **và** mảng `TASK_NOTIFICATION_TYPES` trong `src/lib/tasks/notifications.ts`. Thiếu một bên là insert nổ lúc chạy.
- `task_activity.type` là `text` **không có** CHECK constraint — chỉ cần sửa `ALLOWED_TASK_ACTIVITY_TYPES` và `activity-labels.ts`.

**Khác biệt cố ý so với SLA:** SLA chỉ leo thang lên agent/admin khi priority là `urgent`/`high`. Due Date thì **luôn** báo cả bốn nhóm — người dùng chốt vậy vì đây là hạn cứng do admin đặt, quan trọng hơn SLA.

---

## File Structure

**Tạo mới**

| File | Trách nhiệm |
| --- | --- |
| `supabase/rollouts/2026-09-04-task-due-date-overdue.sql` | 2 cột, index, trigger reset, mở rộng CHECK type, RPC `mark_task_due_date_overdue_atomic` |

**Sửa**

| File | Sửa gì |
| --- | --- |
| `src/lib/tasks/due-date.ts` | Luật quá hạn theo giờ Texas; thêm `isTaskRowDueDateOverdue` |
| `src/lib/tasks/due-date.test.ts` | Test cho luật mới |
| `src/lib/tasks/types.ts` | 2 trường mới trên `TaskRow` |
| `src/lib/tasks/notifications.ts` | 2 loại thông báo mới |
| `src/lib/tasks/activity-events.ts` | 1 loại activity mới |
| `src/app/(authed)/tasks/_components/activity-labels.ts` | Nhãn cho loại activity mới |
| `src/app/(authed)/_components/NotificationBell.tsx` | Nhãn cho 2 loại thông báo mới |
| `src/app/(authed)/tasks/_components/TaskRowItem.tsx` | Nền hồng đỏ nhạt |
| `src/app/api/cron/check-overdue/route.ts` | Lượt quét due-date |
| `changelog.md` | Một mục mỗi task |

---

## Task 1: Schema cho overdue theo Due Date

**Files:** Create `supabase/rollouts/2026-09-04-task-due-date-overdue.sql`

**Interfaces:**
- Produces: cột `tasks.due_overdue_flagged_at`, `tasks.due_overdue_reminded_at`
- Produces: RPC `mark_task_due_date_overdue_atomic(p_task_id uuid, p_due_date text) returns boolean`

- [ ] **Step 1: Viết SQL**

```sql
-- supabase/rollouts/2026-09-04-task-due-date-overdue.sql
-- =====================================================================
-- Overdue theo DUE DATE — hạn cứng do admin đặt, tách hẳn khỏi overdue SLA.
--
-- Vì sao tách: SLA đo "task nằm In Progress bao lâu"; Due Date là ngày admin
-- cam kết với khách. Một task có thể vỡ cái này mà không vỡ cái kia, và người
-- dùng chốt Due Date quan trọng hơn — nên nó có cờ riêng, thông báo riêng, và
-- dòng activity riêng.
--
-- Idempotent. Chạy lại lần hai là no-op.
-- =====================================================================

-- ---------- 1. Hai dấu ----------
-- `flagged` = đã báo lần đầu. `reminded` = lần nhắc gần nhất (nhắc mỗi 24h).
-- Hai dấu riêng vì chúng trả lời hai câu khác nhau, và gộp lại thì không phân
-- biệt được "vừa quá hạn" với "quá hạn từ tuần trước".
alter table tasks add column if not exists due_overdue_flagged_at timestamptz;
alter table tasks add column if not exists due_overdue_reminded_at timestamptz;

-- ---------- 2. Index cho lượt quét của cron ----------
-- Cron hỏi "task nào có due_date và chưa xong". Không có index thì mỗi 15 phút
-- là một lượt quét toàn bảng.
create index if not exists tasks_due_date_idx
  on tasks ((custom_values ->> 'due_date'))
  where archived_at is null and (custom_values ->> 'due_date') is not null;

-- ---------- 3. Đổi Due Date thì xoá dấu đã-báo ----------
-- Người dùng chốt: dời hạn là một CAM KẾT MỚI, vỡ cam kết mới thì phải báo lại.
--
-- Làm bằng trigger chứ không làm ở route: due_date sửa được qua PATCH inline,
-- qua modal chi tiết, và qua patch_task_atomic. Ba đường thì sớm muộn cũng có
-- một đường quên xoá dấu, và lỗi đó im lặng — task vỡ hạn lần hai mà không ai
-- được báo. Trigger thì không đường nào lách được.
create or replace function task_reset_due_overdue_marks()
returns trigger
language plpgsql as $$
begin
  if (new.custom_values ->> 'due_date') is distinct from (old.custom_values ->> 'due_date') then
    new.due_overdue_flagged_at := null;
    new.due_overdue_reminded_at := null;
  end if;
  return new;
end $$;

drop trigger if exists task_reset_due_overdue_marks_trg on tasks;
create trigger task_reset_due_overdue_marks_trg
  before update of custom_values on tasks
  for each row execute function task_reset_due_overdue_marks();

-- ---------- 4. Hai loại thông báo mới ----------
-- `task_notifications.type` có CHECK constraint liệt kê từng giá trị, nên thêm
-- loại mới mà không sửa đây là insert nổ lúc chạy — và nổ trong cron, tức không
-- ai nhìn thấy cho tới khi có người hỏi vì sao không nhận được thông báo.
do $$
begin
  if exists (
    select 1 from pg_constraint where conname = 'task_notifications_type_check'
  ) then
    alter table task_notifications drop constraint task_notifications_type_check;
  end if;

  alter table task_notifications
  add constraint task_notifications_type_check
  check (
    type in (
      'assigned', 'mentioned', 'commented', 'reacted', 'overdue',
      'todo_reminder', 'overdue_reminder', 'waiting_reminder', 'unassigned',
      'reopened', 'qc_needed', 'due_soon', 'stale', 'overdue_unlocked',
      'qc_stale', 'sla_escalated', 'qc_reviewed', 'cancelled',
      'attachment_added', 'backlog_attention',
      -- Mới: hạn cứng theo Due Date.
      'due_date_overdue', 'due_date_overdue_reminder'
    )
  );
end $$;

-- ---------- 5. RPC đánh dấu quá hạn ----------
-- Cùng hình dạng với mark_task_overdue_atomic: cập nhật CÓ ĐIỀU KIỆN rồi đếm
-- số dòng đã đổi. Trả false nghĩa là "ai đó đã làm rồi" — đó là cổng duy nhất
-- ngăn hai lượt cron chồng nhau bắn hai lần cùng một thông báo.
--
-- Điều kiện `status not in ('done','cancel')`: task đã xong hoặc đã huỷ thì
-- không còn hạn nào để vỡ. Kiểm ở đây chứ không chỉ ở Node, vì giữa lúc cron
-- đọc và lúc nó ghi, người ta có thể vừa bấm Done.
create or replace function mark_task_due_date_overdue_atomic(
  p_task_id uuid,
  p_due_date text
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_now timestamptz := clock_timestamp();
  v_updated integer;
begin
  update tasks
  set due_overdue_flagged_at = v_now,
      due_overdue_reminded_at = v_now
  where id = p_task_id
    and archived_at is null
    and status not in ('done', 'cancel')
    and due_overdue_flagged_at is null;
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    return false;
  end if;

  insert into task_activity (task_id, actor_email, type, meta)
  values (
    p_task_id,
    'system',
    'due_date_overdue',
    jsonb_build_object('due_date', p_due_date, 'flagged_at', v_now)
  );
  return true;
end $$;

revoke all on function mark_task_due_date_overdue_atomic(uuid, text)
  from public, anon, authenticated;
grant execute on function mark_task_due_date_overdue_atomic(uuid, text)
  to service_role;

-- ---------- Kiểm chứng ----------
-- Một dòng, cả bốn cột phải đọc 'ok'.
select
  case when (select count(*) from information_schema.columns
             where table_name = 'tasks'
               and column_name in ('due_overdue_flagged_at', 'due_overdue_reminded_at')) = 2
       then 'ok' else 'FAIL: thiếu cột' end                                as cols,
  case when exists (select 1 from pg_indexes where indexname = 'tasks_due_date_idx')
       then 'ok' else 'FAIL: thiếu index' end                              as idx,
  case when exists (select 1 from pg_trigger where tgname = 'task_reset_due_overdue_marks_trg')
       then 'ok' else 'FAIL: thiếu trigger' end                            as trg,
  case when exists (select 1 from pg_proc where proname = 'mark_task_due_date_overdue_atomic')
       then 'ok' else 'FAIL: thiếu RPC' end                                as rpc;
```

- [ ] **Step 2: DỪNG — nhờ người dùng chạy SQL**

Nói nguyên văn: *"Chạy `supabase/rollouts/2026-09-04-task-due-date-overdue.sql`. Câu cuối phải trả về bốn cột `ok`."* Không đi tiếp cho tới khi có xác nhận.

- [ ] **Step 3: Commit**

```bash
git add supabase/rollouts/2026-09-04-task-due-date-overdue.sql
git commit -m "feat(tasks): schema cho overdue theo Due Date"
```

---

## Task 2: Luật quá hạn theo giờ Texas

**Files:** Modify `src/lib/tasks/due-date.ts`, `src/lib/tasks/due-date.test.ts`, `src/lib/tasks/types.ts`, `changelog.md`

**Interfaces:**
- Produces: `TASK_DUE_DATE_TIMEZONE = "America/Chicago"`
- Produces: `businessToday(now?: Date): string` — `"YYYY-MM-DD"` của hôm nay theo giờ Texas
- Produces: `isTaskDueDateOverdue(value: string | null, now?: Date): boolean` — **sửa lại**, so theo giờ Texas
- Produces: `isTaskRowDueDateOverdue(task: { status: TaskStatus; custom_values?: Record<string, unknown> }, now?: Date): boolean`

**Vấn đề với bản hôm qua:** `isTaskDueDateOverdue` dựng `new Date(...)` rồi so với `now` theo **giờ máy đang chạy**. Trên trình duyệt của agent đó là giờ Texas (đúng), nhưng trong cron trên Vercel đó là **UTC** — sớm hơn Texas 5–6 tiếng. Task hạn `Oct 9` sẽ bị cron coi là quá hạn từ **7 giờ tối Oct 9 giờ Texas**, tức thông báo bay đi khi agent vẫn đang trong ngày làm việc. Cùng một hàm mà server và browser cho hai câu trả lời khác nhau.

Cách sửa: chốt một múi giờ, và **so chuỗi** `"YYYY-MM-DD"` thay vì làm toán trên `Date`. Chuỗi ISO so từ điển ra đúng thứ tự thời gian, và không kéo múi giờ vào một phép so sánh vốn chỉ cần biết "ngày nào".

- [ ] **Step 1: Viết test thất bại**

Thay toàn bộ `describe("isTaskDueDateOverdue", ...)` trong `src/lib/tasks/due-date.test.ts` bằng:

```ts
describe("businessToday", () => {
  it("trả về ngày theo giờ Texas, không theo giờ máy chạy", () => {
    // 2026-10-10T02:00:00Z = 9 giờ tối ngày 09/10 giờ Central. Máy chủ đã sang
    // ngày mới, Texas thì chưa — và Texas mới là nơi người ta làm việc.
    expect(businessToday(new Date("2026-10-10T02:00:00Z"))).toBe("2026-10-09");
  });

  it("sang ngày mới đúng lúc nửa đêm giờ Texas", () => {
    // 05:00Z = 00:00 Central (giờ mùa hè CDT, UTC-5).
    expect(businessToday(new Date("2026-10-10T04:59:00Z"))).toBe("2026-10-09");
    expect(businessToday(new Date("2026-10-10T05:00:00Z"))).toBe("2026-10-10");
  });
});

describe("isTaskDueDateOverdue", () => {
  // 9 giờ tối ngày 09/10 giờ Texas. Máy chủ UTC đã sang ngày 10.
  const toiNgay9 = new Date("2026-10-10T02:00:00Z");

  it("KHÔNG quá hạn khi vẫn còn trong ngày đến hạn ở Texas", () => {
    // Đây chính là ca mà bản cũ báo sai: nó so theo UTC nên coi là đã quá hạn.
    expect(isTaskDueDateOverdue("2026-10-09", toiNgay9)).toBe(false);
  });

  it("quá hạn ngay khi Texas sang ngày mới", () => {
    expect(isTaskDueDateOverdue("2026-10-09", new Date("2026-10-10T05:00:00Z"))).toBe(true);
  });

  it("hạn đã qua nhiều ngày là quá hạn", () => {
    expect(isTaskDueDateOverdue("2004-10-09", toiNgay9)).toBe(true);
  });

  it("hạn tương lai không quá hạn", () => {
    expect(isTaskDueDateOverdue("2026-12-25", toiNgay9)).toBe(false);
  });

  it("chưa có hạn hoặc giá trị hỏng thì không bao giờ quá hạn", () => {
    expect(isTaskDueDateOverdue(null, toiNgay9)).toBe(false);
    expect(isTaskDueDateOverdue("khong-phai-ngay", toiNgay9)).toBe(false);
  });
});

describe("isTaskRowDueDateOverdue", () => {
  const now = new Date("2026-10-10T05:00:00Z"); // đã sang ngày 10 ở Texas
  const row = (status: TaskStatus, dueDate: string | null) => ({
    status,
    custom_values: dueDate ? { due_date: dueDate } : {},
  });

  it("task chưa xong mà quá hạn thì đúng là quá hạn", () => {
    expect(isTaskRowDueDateOverdue(row("in_progress", "2026-10-09"), now)).toBe(true);
    expect(isTaskRowDueDateOverdue(row("todo", "2026-10-09"), now)).toBe(true);
    expect(isTaskRowDueDateOverdue(row("waiting", "2026-10-09"), now)).toBe(true);
    expect(isTaskRowDueDateOverdue(row("backlog", "2026-10-09"), now)).toBe(true);
  });

  it("task ĐÃ XONG thì không còn hạn nào để vỡ", () => {
    expect(isTaskRowDueDateOverdue(row("done", "2026-10-09"), now)).toBe(false);
  });

  it("task ĐÃ HUỶ cũng vậy", () => {
    // Huỷ là một kết cục hợp lệ. Tô đỏ một task đã huỷ là đòi người ta làm một
    // việc đã được quyết định là không làm nữa.
    expect(isTaskRowDueDateOverdue(row("cancel", "2026-10-09"), now)).toBe(false);
  });

  it("task chưa đặt hạn thì không quá hạn", () => {
    expect(isTaskRowDueDateOverdue(row("in_progress", null), now)).toBe(false);
  });
});
```

Thêm vào phần import đầu file:

```ts
import {
  businessToday,
  formatTaskDueDate,
  isTaskDueDateOverdue,
  isTaskRowDueDateOverdue,
  readTaskDueDate,
  TASK_DUE_DATE_KEY,
} from "./due-date";
import type { TaskStatus } from "./types";
```

(bỏ dòng import cũ).

- [ ] **Step 2: Chạy để thấy hỏng**

Run: `npx vitest run src/lib/tasks/due-date.test.ts`
Expected: FAIL — `businessToday` và `isTaskRowDueDateOverdue` chưa tồn tại.

- [ ] **Step 3: Sửa `due-date.ts`**

Thay hàm `isTaskDueDateOverdue` cũ và thêm hai hàm mới:

```ts
import type { TaskStatus } from "./types";

/**
 * Múi giờ quyết định "hết ngày".
 *
 * Người dùng chốt Texas (2026-09-02). Gần như toàn bang là Central; chỉ vùng
 * El Paso ở cực tây là Mountain, và một tiếng lệch cho một góc bang không đáng
 * để dựng cấu hình theo từng người.
 */
export const TASK_DUE_DATE_TIMEZONE = "America/Chicago";

/**
 * Hôm nay là ngày nào, theo giờ Texas — dạng "YYYY-MM-DD".
 *
 * `en-CA` là locale cho ra đúng định dạng ISO, nên không phải tự ghép chuỗi.
 */
export function businessToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TASK_DUE_DATE_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * Quá hạn = ngày đến hạn nằm TRƯỚC hôm nay, tính theo giờ Texas.
 *
 * So CHUỖI "YYYY-MM-DD" chứ không làm toán trên `Date`. Hai lý do:
 *
 *  - Chuỗi ISO so từ điển đã ra đúng thứ tự thời gian, nên không cần dựng Date.
 *  - Bản trước dựng `new Date(...)` rồi so theo giờ MÁY ĐANG CHẠY. Trên trình
 *    duyệt của agent đó là giờ Texas (đúng), nhưng trong cron trên Vercel đó là
 *    UTC — sớm hơn 5–6 tiếng. Task hạn "Oct 9" bị cron coi là quá hạn từ 7 giờ
 *    tối Oct 9 giờ Texas, tức thông báo bay đi khi agent vẫn đang làm việc.
 *    Cùng một hàm mà server và browser cho hai câu trả lời khác nhau.
 *
 * "Đến hạn hôm nay" cố ý KHÔNG tính là quá hạn: còn cả ngày để làm.
 */
export function isTaskDueDateOverdue(
  value: string | null,
  now: Date = new Date()
): boolean {
  if (!value) return false;
  const due = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return false;
  return due < businessToday(now);
}

/** Trạng thái đã kết thúc thì không còn hạn nào để vỡ. */
const TERMINAL_STATUSES = new Set<TaskStatus>(["done", "cancel"]);

/**
 * Dòng task này có đang quá hạn Due Date không.
 *
 * Gộp hai điều kiện vào một chỗ vì chúng luôn đi cùng nhau: quá hạn **và** chưa
 * xong. `cancel` cũng tính là xong — huỷ là một kết cục hợp lệ, và tô đỏ một
 * task đã huỷ là đòi người ta làm một việc đã được quyết định là không làm nữa.
 */
export function isTaskRowDueDateOverdue(
  task: { status: TaskStatus; custom_values?: Record<string, unknown> | null },
  now: Date = new Date()
): boolean {
  if (TERMINAL_STATUSES.has(task.status)) return false;
  return isTaskDueDateOverdue(readTaskDueDate(task.custom_values), now);
}
```

- [ ] **Step 4: Chạy để thấy xanh**

Run: `npx vitest run src/lib/tasks/due-date.test.ts`
Expected: PASS toàn bộ file.

- [ ] **Step 5: Thêm hai trường mới vào `TaskRow`**

Trong `src/lib/tasks/types.ts`, ngay dưới `due_soon_notified_at`:

```ts
  /** Lần đầu phát hiện vỡ hạn Due Date. Trigger xoá về null khi due_date đổi. */
  due_overdue_flagged_at?: string | null;
  /** Lần nhắc gần nhất; nhắc lại mỗi 24 giờ tới khi task xong. */
  due_overdue_reminded_at?: string | null;
```

Để **tuỳ chọn** (`?`) vì hầu hết đường đọc không `select` hai cột này, và bắt chúng bắt buộc sẽ khiến mọi fixture test phải khai thêm hai trường không liên quan.

- [ ] **Step 6: Bốn lệnh kiểm tra**

Run: `npm run typecheck && npm run lint && npm run test:run && npm run build`
Expected: xanh. Card trên Board (làm hôm qua) tự hưởng luật mới vì nó gọi cùng hàm.

- [ ] **Step 7: Changelog + commit**

```markdown
## 2026-09-02 — Luật quá hạn Due Date tính theo giờ Texas

- **Loại**: fix + chuẩn bị cho tính năng thông báo.
- Bản hôm qua dựng `new Date(...)` rồi so theo **giờ máy đang chạy**. Trên trình duyệt của agent đó là giờ Texas (đúng), nhưng trong cron trên Vercel đó là **UTC** — sớm hơn 5–6 tiếng. Task hạn "Oct 9" bị coi là quá hạn từ **7 giờ tối Oct 9 giờ Texas**, tức thông báo sẽ bay đi khi agent vẫn đang trong ngày làm việc. Cùng một hàm mà server và browser cho hai câu trả lời khác nhau.
- Chốt `America/Chicago` (người dùng chọn Texas). So **chuỗi** `"YYYY-MM-DD"` thay vì làm toán trên `Date`: chuỗi ISO so từ điển đã đúng thứ tự thời gian, và không kéo múi giờ vào phép so sánh vốn chỉ cần biết "ngày nào".
- Thêm `isTaskRowDueDateOverdue`: gộp "quá hạn" **và** "chưa xong" vào một chỗ vì chúng luôn đi cùng nhau. `cancel` tính như `done` — huỷ là kết cục hợp lệ, tô đỏ một task đã huỷ là đòi người ta làm việc đã quyết định không làm.
- Card trên Board tự hưởng luật mới vì dùng chung hàm.
```

```bash
git add src/lib/tasks/due-date.ts src/lib/tasks/due-date.test.ts src/lib/tasks/types.ts changelog.md
git commit -m "fix(tasks): quá hạn Due Date tính theo giờ Texas, không theo giờ máy chạy"
```

---

## Task 3: Nền hồng đỏ nhạt trong bảng

**Files:** Modify `src/app/(authed)/tasks/_components/TaskRowItem.tsx`, `changelog.md`

**Interfaces:** Consumes `isTaskRowDueDateOverdue` từ Task 2.

**Yêu cầu:** task quá hạn Due Date mà chưa done thì nền dòng màu hồng đỏ nhạt, **mọi người đều thấy** — không phân quyền.

`TaskRowItem` đã nhận sẵn `now?: Date` (dòng 270), nên không phải kéo thêm prop nào.

Dòng gốc hiện tại (dòng ~341):
```tsx
      className={`group flex bg-white transition hover:bg-[#f7f8f9] ${
```

- [ ] **Step 1: Tính cờ trong component**

Thêm ngay dưới `const liveNow = now ?? null;` (dòng ~324):

```tsx
  // Không phân quyền: người dùng chốt nền đỏ thì AI CŨNG thấy. Đây là tín hiệu
  // về tình trạng công việc, không phải dữ liệu riêng của ai.
  const dueDateOverdue = isTaskRowDueDateOverdue(task, liveNow ?? undefined);
```

- [ ] **Step 2: Đổi nền dòng**

```tsx
      className={`group flex transition ${
        dueDateOverdue
          // Hồng đỏ nhạt, không phải đỏ gắt: nó phải đọc được là "cần chú ý"
          // khi liếc qua cả bảng, mà chữ đen trên nền vẫn phải rõ. Trạng thái
          // hover đậm hơn một nấc để dòng vẫn phản hồi khi rê chuột.
          ? "bg-[#fdecef] hover:bg-[#fbdde3]"
          : "bg-white hover:bg-[#f7f8f9]"
      } ${
        configuredColumns
          ? "min-h-11 min-w-max items-stretch gap-0 whitespace-nowrap px-0 py-0 [&>*]:flex [&>*]:items-center [&>*]:whitespace-nowrap [&>*]:px-3 [&>*]:py-2.5"
          : "items-center gap-3 whitespace-nowrap px-4 py-2.5"
      } ${isOverdue && !configuredColumns ? "border-l-4 border-[#f97316]" : ""}`}
```

**Giữ nguyên** viền trái cam của overdue SLA. Hai thứ khác nhau và có thể xảy ra cùng lúc: viền cam = vỡ SLA, nền hồng = vỡ hạn cứng. Gộp làm một là mất một trong hai tín hiệu.

- [ ] **Step 3: Thêm import**

```ts
import { isTaskRowDueDateOverdue } from "@/lib/tasks/due-date";
```

(file đã import `TASK_DUE_DATE_KEY` từ module này — gộp vào cùng một lời import).

- [ ] **Step 4: Bốn lệnh kiểm tra**

Run: `npm run typecheck && npm run lint && npm run test:run && npm run build`
Expected: xanh.

- [ ] **Step 5: Kiểm tay**

1. `npm run dev`, mở `http://localhost:3000/tasks`, chuyển sang List view.
2. Đặt Due Date của một task đang `In Progress` về **hôm qua**.
3. Expected: dòng đó nền hồng đỏ nhạt, các dòng khác vẫn trắng. Rê chuột lên vẫn đổi màu.
4. Đổi status task đó sang **Done**. Expected: nền trở lại trắng ngay.
5. Đổi sang **Cancel**. Expected: cũng trắng.
6. Đặt Due Date về **hôm nay**. Expected: trắng — còn cả ngày để làm.

- [ ] **Step 6: Changelog + commit**

```markdown
## 2026-09-02 — Task vỡ hạn Due Date có nền hồng đỏ nhạt trong bảng

- **Loại**: feature (UI).
- Task quá hạn Due Date mà **chưa xong** thì cả dòng đổi nền `#fdecef`, hover `#fbdde3`. Hồng đỏ nhạt chứ không đỏ gắt: phải đọc được là "cần chú ý" khi liếc qua cả bảng mà chữ đen vẫn rõ.
- **Không phân quyền** — người dùng chốt ai cũng thấy. Đây là tín hiệu về tình trạng công việc, không phải dữ liệu riêng của ai.
- **Giữ nguyên viền trái cam của overdue SLA.** Hai thứ khác nhau và có thể xảy ra cùng lúc: viền cam = vỡ SLA (nằm In Progress quá lâu), nền hồng = vỡ hạn cứng do admin đặt. Gộp làm một là mất một trong hai tín hiệu.
- `done` và `cancel` đều trả nền về trắng.
```

```bash
git add "src/app/(authed)/tasks/_components/TaskRowItem.tsx" changelog.md
git commit -m "feat(tasks): nền hồng đỏ nhạt cho task vỡ hạn Due Date"
```

---

## Task 4: Từ vựng thông báo và activity

**Files:** Modify `src/lib/tasks/notifications.ts`, `src/lib/tasks/activity-events.ts`, `src/app/(authed)/tasks/_components/activity-labels.ts`, `src/app/(authed)/_components/NotificationBell.tsx`, `changelog.md`

**Phụ thuộc:** CHECK constraint trong Task 1 phải chạy trước, nếu không insert sẽ nổ lúc chạy.

- [ ] **Step 1: Hai loại thông báo**

Trong `src/lib/tasks/notifications.ts`, thêm vào cuối mảng `TASK_NOTIFICATION_TYPES`, trước `] as const;`:

```ts
  // Hạn cứng do admin đặt (Due Date). Tách khỏi 'overdue'/'overdue_reminder'
  // của SLA: một task có thể vỡ cái này mà không vỡ cái kia, và người đọc
  // thông báo cần biết mình đang vỡ cái nào.
  "due_date_overdue",
  "due_date_overdue_reminder",
```

- [ ] **Step 2: Một loại activity**

Trong `src/lib/tasks/activity-events.ts`, thêm vào `ALLOWED_TASK_ACTIVITY_TYPES` trước `] as const;`:

```ts
  "due_date_overdue",
```

Không cần đụng DB: `task_activity.type` là `text` **không có** CHECK constraint (khác `task_notifications.type`).

- [ ] **Step 3: Nhãn activity**

Trong `src/app/(authed)/tasks/_components/activity-labels.ts`, ngay dưới dòng `went_overdue`:

```ts
  due_date_overdue: "passed its due date",
```

- [ ] **Step 4: Nhãn thông báo**

Trong `src/app/(authed)/_components/NotificationBell.tsx`, thêm vào union kiểu (cạnh `"overdue_reminder"`):

```ts
    | "due_date_overdue"
    | "due_date_overdue_reminder"
```

và thêm hai nhánh vào `switch`, ngay dưới nhánh `"overdue_reminder"`:

```tsx
    case "due_date_overdue":
      return "Task passed its due date";
    case "due_date_overdue_reminder":
      return "Task is still past its due date — reminder";
```

- [ ] **Step 5: Bốn lệnh kiểm tra**

Run: `npm run typecheck && npm run lint && npm run test:run && npm run build`
Expected: xanh. Nếu `activity-events.test.ts` liệt kê cứng danh sách loại, thêm `"due_date_overdue"` vào kỳ vọng đó.

- [ ] **Step 6: Changelog + commit**

```markdown
## 2026-09-02 — Từ vựng cho overdue theo Due Date

- **Loại**: feature.
- Hai loại thông báo mới: `due_date_overdue` và `due_date_overdue_reminder`. Tách khỏi `overdue`/`overdue_reminder` của SLA vì một task có thể vỡ cái này mà không vỡ cái kia, và người đọc thông báo cần biết mình đang vỡ cái nào.
- Một loại activity mới: `due_date_overdue`. Người dùng chốt đây là overdue **quan trọng hơn SLA** nên phải để lại vết trong activity.
- `task_notifications.type` có CHECK constraint trong DB nên phải sửa **cả hai nơi**; `task_activity.type` là `text` không ràng buộc nên chỉ sửa TypeScript.
```

```bash
git add src/lib/tasks/notifications.ts src/lib/tasks/activity-events.ts "src/app/(authed)/tasks/_components/activity-labels.ts" "src/app/(authed)/_components/NotificationBell.tsx" changelog.md
git commit -m "feat(tasks): từ vựng thông báo và activity cho overdue Due Date"
```

---

## Task 5: Cron quét vỡ hạn Due Date

**Files:** Modify `src/app/api/cron/check-overdue/route.ts`, `changelog.md`

**Phụ thuộc:** Task 1 (RPC + cột), Task 2 (`businessToday`), Task 4 (loại thông báo).

**Người nhận — người dùng chốt cả bốn nhóm, không phân theo priority:**
- người được giao (`fetchTaskAssigneeEmails`)
- agent của task **và assistant của agent đó** (`fetchAgentOwnerAndAssistantEmails` đã gộp sẵn cả hai)
- admin (`fetchAdminEmails`)

Khác SLA: SLA chỉ leo thang lên agent/admin khi priority là `urgent`/`high`. Due Date thì **luôn** báo cả bốn nhóm, vì đây là hạn cứng do admin đặt.

- [ ] **Step 1: Lấy task có Due Date**

Thêm vào `runReminderSweep`, ngay sau khối lấy `todoRows`:

```ts
  // Task có đặt Due Date và chưa kết thúc. Lọc "quá hạn hay chưa" ở Node chứ
  // không ở SQL: ranh giới ngày phụ thuộc múi giờ Texas, và nhét phép đổi múi
  // giờ vào PostgREST là để hai nơi định nghĩa "hết ngày" theo hai cách.
  const { data: dueRows, error: dueError } = await supabase
    .from("tasks")
    .select(
      "id,status,agent_email,custom_values,due_overdue_flagged_at,due_overdue_reminded_at"
    )
    .is("archived_at", null)
    .not("status", "in", "(done,cancel)")
    .not("custom_values->>due_date", "is", null);
  if (dueError) return NextResponse.json({ error: dueError.message }, { status: 500 });

  type DueTaskRow = Pick<
    TaskRow,
    "id" | "status" | "agent_email" | "custom_values"
  > & {
    due_overdue_flagged_at: string | null;
    due_overdue_reminded_at: string | null;
  };
  const dueTasks = ((dueRows ?? []) as DueTaskRow[]).filter((task) =>
    isTaskRowDueDateOverdue(task, now)
  );

  // Lần đầu vỡ hạn — RPC là cổng chống bắn trùng khi hai lượt cron chồng nhau.
  const newlyDueOverdue = dueTasks.filter((task) => !task.due_overdue_flagged_at);
  // Vẫn đang vỡ hạn — nhắc lại mỗi 24 giờ, đúng như người dùng chốt.
  const stillDueOverdue = dueTasks.filter(
    (task) =>
      Boolean(task.due_overdue_flagged_at) &&
      intervalDue(task.due_overdue_reminded_at, 24 * 3600_000, now)
  );
```

Thêm import ở đầu file:
```ts
import { isTaskRowDueDateOverdue, readTaskDueDate } from "@/lib/tasks/due-date";
```

- [ ] **Step 2: Bắn thông báo lần đầu**

Thêm sau khối `if (newlyOverdue.length > 0) { … }`:

```ts
  if (newlyDueOverdue.length > 0) {
    await Promise.all(
      newlyDueOverdue.map(async (task) => {
        const dueDate = readTaskDueDate(task.custom_values) ?? "";
        const { data: flagged, error: flagError } = await supabase.rpc(
          "mark_task_due_date_overdue_atomic",
          { p_task_id: task.id, p_due_date: dueDate }
        );
        if (flagError) throw new Error(flagError.message);
        // Lượt cron khác, hoặc một thao tác của người dùng, đã thắng cổng này.
        // Không có gì bên dưới thuộc về lần chuyển trạng thái đó, nên không
        // được bắn thông báo lần hai.
        if (flagged !== true) return;

        const [assignees, agentRecipients, adminRecipients] = await Promise.all([
          fetchTaskAssigneeEmails(task.id, supabase),
          // Hàm này đã gộp sẵn agent VÀ assistant của agent đó.
          fetchAgentOwnerAndAssistantEmails(task.agent_email),
          fetchAdminEmails(),
        ]);
        // Người được giao chỉ nhận MỘT thông báo dù họ cũng là agent hay admin.
        const watchers = uniqueNotificationRecipients(
          [...agentRecipients, ...adminRecipients],
          assignees
        );
        const rows: NotificationInsertInput[] = uniqueNotificationRows(
          [...assignees, ...watchers].map((email) => ({
            recipient_email: email,
            task_id: task.id,
            type: "due_date_overdue" as const,
            actor_email: "system",
            detail: `Due ${dueDate}`,
          }))
        );
        await insertNotifications(rows);
      })
    );
  }
```

- [ ] **Step 3: Nhắc lại mỗi 24 giờ**

```ts
  if (stillDueOverdue.length > 0) {
    await Promise.all(
      stillDueOverdue.map(async (task) => {
        // Chốt dấu nhắc TRƯỚC khi gửi, và chỉ ghi khi giá trị chưa đổi. Gửi
        // trước rồi mới ghi dấu thì một lượt cron chồng lên sẽ gửi lần hai.
        const { data: updated, error: markError } = await supabase
          .from("tasks")
          .update({ due_overdue_reminded_at: nowIso })
          .eq("id", task.id)
          .eq("due_overdue_reminded_at", task.due_overdue_reminded_at)
          .select("id");
        if (markError) throw new Error(markError.message);
        if ((updated ?? []).length === 0) return;

        const dueDate = readTaskDueDate(task.custom_values) ?? "";
        const [assignees, agentRecipients, adminRecipients] = await Promise.all([
          fetchTaskAssigneeEmails(task.id, supabase),
          fetchAgentOwnerAndAssistantEmails(task.agent_email),
          fetchAdminEmails(),
        ]);
        const watchers = uniqueNotificationRecipients(
          [...agentRecipients, ...adminRecipients],
          assignees
        );
        const rows: NotificationInsertInput[] = uniqueNotificationRows(
          [...assignees, ...watchers].map((email) => ({
            recipient_email: email,
            task_id: task.id,
            type: "due_date_overdue_reminder" as const,
            actor_email: "system",
            detail: `Due ${dueDate}`,
          }))
        );
        await insertNotifications(rows);
      })
    );
  }
```

- [ ] **Step 4: Đưa vào phần tóm tắt trả về**

Tìm câu `return NextResponse.json({...})` ở cuối `runReminderSweep` và thêm hai số đếm:

```ts
    dueDateOverdue: newlyDueOverdue.length,
    dueDateOverdueReminders: stillDueOverdue.length,
```

Cron này từng hỏng im lặng năm tiếng liền (xem chú thích ở đầu file); con số trong phản hồi là thứ duy nhất nói được nó có làm gì không.

- [ ] **Step 5: Bốn lệnh kiểm tra**

Run: `npm run typecheck && npm run lint && npm run test:run && npm run build`
Expected: xanh.

- [ ] **Step 6: Chạy thử cron bằng tay**

```bash
# CRON_SECRET lấy trong .env.local
curl -s -H "Authorization: Bearer $(grep '^CRON_SECRET=' .env.local | cut -d= -f2-)" \
  http://localhost:3000/api/cron/check-overdue | head -c 600
```
Expected: JSON có `dueDateOverdue` và `dueDateOverdueReminders`. Chạy khi chưa có task nào quá hạn thì cả hai là `0`.

- [ ] **Step 7: Kiểm tay đủ vòng đời**

1. Đặt Due Date của một task `In Progress` về **hôm qua**.
2. Gọi cron (lệnh Step 6). Expected: `dueDateOverdue: 1`.
3. Kiểm DB:
   ```sql
   select due_overdue_flagged_at, due_overdue_reminded_at from tasks where id = '<task>';
   select type, meta, created_at from task_activity where task_id = '<task>' order by created_at desc limit 3;
   select recipient_email, type, detail from task_notifications where task_id = '<task>';
   ```
   Expected: hai dấu đã được đặt; có dòng activity `due_date_overdue`; có thông báo cho **người được giao, agent, assistant của agent, và admin**.
4. Gọi cron **lần nữa ngay**. Expected: `dueDateOverdue: 0`, `dueDateOverdueReminders: 0` — không bắn trùng, và chưa tới 24 giờ nên chưa nhắc.
5. **Kiểm trigger reset**: đổi Due Date của task đó sang **tuần sau**, rồi:
   ```sql
   select due_overdue_flagged_at, due_overdue_reminded_at from tasks where id = '<task>';
   ```
   Expected: **cả hai về `null`**. Đây là điều người dùng chốt — dời hạn là cam kết mới.
6. Đổi Due Date về lại **hôm qua**, gọi cron. Expected: `dueDateOverdue: 1` — bắn lại lần hai.
7. Bấm Done. Gọi cron. Expected: `0` cả hai.

- [ ] **Step 8: Changelog + commit**

```markdown
## 2026-09-02 — Cron báo task vỡ hạn Due Date

- **Loại**: feature.
- Lượt quét mới trong `check-overdue` (đang chạy mỗi 15 phút): task có Due Date, chưa `done`/`cancel`, và hạn đã qua theo **giờ Texas**.
- **Người nhận**: người được giao, agent của task, **assistant của agent đó**, và admin. Khác SLA — SLA chỉ leo thang lên agent/admin khi priority `urgent`/`high`; Due Date thì luôn báo cả bốn nhóm vì đây là hạn cứng do admin đặt. Ai vừa là agent vừa là người được giao chỉ nhận **một** thông báo.
- **Nhắc lại mỗi 24 giờ** tới khi task xong.
- **Ghi vào `task_activity`** loại `due_date_overdue` — người dùng chốt đây là overdue quan trọng hơn SLA nên phải để lại vết.
- **Chống bắn trùng ở hai chỗ**: lần đầu qua RPC `mark_task_due_date_overdue_atomic` (cập nhật có điều kiện rồi đếm dòng đã đổi); lần nhắc bằng cách chốt `due_overdue_reminded_at` **trước** khi gửi và chỉ ghi khi giá trị chưa đổi. Gửi trước rồi mới ghi dấu thì một lượt cron chồng lên sẽ gửi lần hai.
- Lọc "quá hạn hay chưa" ở **Node** chứ không ở SQL: ranh giới ngày phụ thuộc múi giờ Texas, nhét phép đổi múi giờ vào PostgREST là để hai nơi định nghĩa "hết ngày" theo hai cách.
- Thêm hai số đếm vào phản hồi của cron. Cron này từng hỏng im lặng năm tiếng liền; con số trong phản hồi là thứ duy nhất nói được nó có làm gì không.
```

```bash
git add src/app/api/cron/check-overdue/route.ts changelog.md
git commit -m "feat(tasks): cron báo và nhắc task vỡ hạn Due Date"
```

---

## Task 6: Cổng kiểm cuối

- [ ] **Step 1: Kiểm import**

Run: `node scripts/check-tracked-imports.mjs`
Expected: `ok — mọi import nội bộ đều trỏ vào file đã commit`.

- [ ] **Step 2: Build từ checkout sạch**

```bash
SCRATCH=$(mktemp -d)/clean
mkdir -p "$SCRATCH"
git archive HEAD | tar -x -C "$SCRATCH"
cp .env.local "$SCRATCH/.env.local"
cp -R node_modules "$SCRATCH/node_modules"   # symlink KHÔNG dùng được: Turbopack từ chối symlink trỏ ra ngoài gốc dự án
cd "$SCRATCH" && npm run build
```
Expected: `✓ Compiled successfully`. Dọn: `rm -rf "$SCRATCH"`.

- [ ] **Step 3: Hỏi remote**

Hỏi: *"Xong 5 task. Đẩy lên remote nào — `origin`, hay cả `origin` và `vercel`?"* **Không tự push.**

---

## Phụ lục: cố ý KHÔNG làm

- **Card trên Board không đổi nền.** Người dùng nói "nền sẽ màu hồng đỏ trong table". Card đã có dòng "Due Oct 9" chữ đỏ từ hôm qua, và nó tự hưởng luật giờ Texas mới. Muốn card cũng đổi nền thì nói.
- **Không đụng overdue SLA.** Hai cơ chế song song, cố ý. Viền trái cam vẫn là SLA; nền hồng là hạn cứng.
- **Không thêm bộ lọc "quá hạn Due Date"** vào thanh công cụ. Chưa ai yêu cầu; thêm khi cần.
- **Không gửi email.** Hệ thống hiện chỉ có thông báo trong ứng dụng (`task_notifications` + chuông). Gửi email là một hạ tầng khác.
- **Múi giờ cố định `America/Chicago` cho toàn hệ thống**, không theo từng người. Vùng El Paso lệch một tiếng; không đáng dựng cấu hình riêng.
