# Sửa `TaskScopeTooLargeError`: đưa phạm vi task của Agent/Assistant xuống database

Ngày: 2026-10-16. Trạng thái: **đã làm, đã deploy production 2026-10-16** (code `eef54d5`, rollout
`29c1b7d`). Đây là bước B0 của plan cũ
`docs/superpowers/plans/2026-09-04-task-list-pagination.md` §13 (mục "B0 — Move visibility scope
into SQL"), viết lại theo code hiện tại.

Khác plan khi làm:
- Hàm là `security definer`, tự lọc `archived_at is null` và trả rỗng khi email rỗng. Bản cuối nằm ở
  `supabase/schema.sql`.
- Cờ `viewer_is_participant` không tải toàn bộ lịch sử participant: chỉ tra các id của trang vừa
  tải, mỗi lần 300 id (`fetchViewerParticipantTaskIds`). Không lọc embed `task_participants` trên kết
  quả RPC, vì PostgREST báo `column pgrst_call.email does not exist`.
- Tìm kiếm (`search.ts`) chưa đổi: vẫn tải hai danh sách id vào Node (P3 của plan
  `2026-10-16-task-scope-too-large.md`).

## 1. Lỗi

Mở `/tasks` bằng một tài khoản Agent hoặc Assistant thì trang sập:

```
Runtime TaskScopeTooLargeError (Server)
Task visibility scope is too large to send as a query filter (6246 bytes, 155 ids).
This needs the database-side scope.
src/lib/tasks/queries.ts (175:53) @ fetchTasksForActor
src/app/(authed)/tasks/page.tsx (55:55) @ TasksPage
```

Lỗi không liên quan P1 Account/Role (commit `695c35a`): P1 không đụng `queries.ts` hay cách tính
phạm vi. Lỗi xuất hiện vì dữ liệu tăng dần.

## 2. Nguyên nhân

`fetchTasksForActor` (`src/lib/tasks/queries.ts:120-169`) chia người xem thành 2 loại:
- **Manager và CS thường** thấy cả công ty, nên không có bộ lọc phạm vi.
- **Agent và Assistant không có `task.manage`** chỉ thấy task trong phạm vi của mình. Code gom
  phạm vi thành một chuỗi `.or()` gửi trong URL.

```ts
// queries.ts:139-154
if (!actor.isManager) {
  const scope = await resolveTaskQueueScope(actor);
  seeAll = scope.seesAllTasks;
  if (!seeAll) {
    const [assignedIds, participantIds] = await Promise.all([
      fetchAssignedTaskIdsForEmail(actor.email, supabase),   // MỌI task_id trong task_assignees
      fetchParticipantTaskIds(actor.email),                  // MỌI task_id trong task_participants
    ]);
    workerScope = { agents: scope.agentEmails, assistantAgents: scope.assistantAgentEmails, assignedIds, participantIds };
  }
}
```

```ts
// queries.ts:475-509 — buildWorkerTaskOrs
const ors = [
  `assignee_email.eq.${quotedEmail}`,
  `agent_email.eq.${quotedEmail}`,
  `reporter_email.eq.${quotedEmail}`,
];
if (workerScope.agents.length > 0) ors.push(`agent_email.in.(${...})`);
if (workerScope.participantIds.length > 0) ors.push(`id.in.(${...participantIds})`);
if (workerScope.assignedIds.length > 0) ors.push(`id.in.(${...assignedIds})`);
```

Hai danh sách id **không có trần và chỉ tăng**:
- `fetchAssignedTaskIdsForEmail` (`assignees.ts:266-286`) lấy mọi dòng `task_assignees` của người
  đó, kể cả task đã xong, đã huỷ hay đã archive.
- `fetchParticipantTaskIds` (`participants.ts`) lấy mọi task người đó từng được @mention hoặc thêm vào.
- Một id có trong cả hai danh sách thì bị gửi hai lần.

Mỗi UUID có dấu nháy và dấu phẩy tốn khoảng 39 byte. Phase A (2026-09-04) cố ý đặt trần
`SCOPE_FILTER_MAX_BYTES = 6_000` (`queries.ts:60`), vì proxy hay gateway cắt URL ở 8–16 KB với một
lỗi không rõ nghĩa. Vượt trần thì code **cố ý báo lỗi to**: bỏ bộ lọc phạm vi sẽ cho ra một bảng
thiếu dòng mà không ai biết là thiếu (xem chú thích ở `queries.ts:45-59`). Khi đó người ta đã ghi
rõ đây là giải pháp tạm, và việc đưa phạm vi xuống SQL dời sang Phase B (B0).

Khoảng 150 id là chạm trần. Người trong ảnh lỗi có 155 id, tức 6.246 byte. Ai là Agent hoặc
Assistant và làm việc đủ lâu đều sẽ chạm trần này.

## 3. Ai bị ảnh hưởng, ở đâu

- **Chỉ** Agent và Assistant không có `task.manage`. Manager và CS thường không bao giờ dựng danh
  sách id này.
- Ba đường cùng gọi `fetchTasksForActor` nên cùng hỏng:
  - trang `/tasks` (server component): sập cả trang;
  - `GET /api/tasks` (làm mới bảng mỗi 60 s): trả 503 `TASK_SCOPE_TOO_LARGE` (`route.ts:86-99`);
  - `GET /api/tasks/export`: xuất file thất bại.
- **Không** ảnh hưởng tìm kiếm. `search.ts:333-345` cũng tải hai danh sách này nhưng chỉ dùng trong
  Node (Set), không nhét vào URL.
- Production chạy đúng code này từ 2026-09-04. Chưa biết bao nhiêu tài khoản thật đã hoặc sắp chạm
  trần: §5 Bước 0 đo việc này.

## 4. Hướng fix

### 4.1 Khuyến nghị: một hàm SQL trả về các task người đó được thấy

Thêm hàm `tasks_visible_to_worker(p_email text, p_agent_emails text[]) returns setof tasks`.
`fetchTasksForActor` gọi hàm này qua `supabase.rpc(...)` thay cho `from("tasks").or(...)`.
- Request chỉ mang email và danh sách Agent mà người đó làm Assistant, nằm trong **body** của POST.
  Không còn danh sách id, nên không còn giới hạn URL, dù lịch sử dài bao nhiêu.
- Điều kiện lọc giữ **đúng** như hôm nay, so khớp email chính xác như các lệnh `.eq` hiện có:
  `assignee_email`, `agent_email`, `reporter_email` bằng email; `agent_email` thuộc danh sách
  Agent; có dòng `task_assignees`; có dòng `task_participants`.
- `p_agent_emails` do TS tính sẵn (`resolveTaskQueueScope` → `fetchAssistantAgentsForCs`, so khớp
  chính xác `cs_email`). Nhờ vậy luật Assistant vẫn chỉ nằm ở một chỗ, và kết quả không lệch với
  hôm nay.
- PostgREST cho phép lọc, sắp xếp, `limit` và `count: exact` trên kết quả của hàm `returns setof`.
  supabase-js 2.105.1 có `rpc(fn, args, { count })` trả về `PostgrestFilterBuilder` (xem
  `node_modules/@supabase/postgrest-js/dist/index.d.mts`, ví dụ `list_stored_countries`). Vì vậy
  phân trang keyset (`gt("id")`, `order("id")`, `limit(1000)`, đếm ở trang đầu) giữ nguyên.
- Lớp kiểm `canViewTask` trong Node (`queries.ts:240-262`) giữ nguyên, làm lớp phòng thủ thứ hai.
- Index cần đã có sẵn: `task_assignees_email_idx` và `task_participants_email_idx`
  (`schema.sql:3082-3095`). Bước 0 kiểm lại trên production.

### 4.2 Các hướng đã cân nhắc và không chọn

| Hướng | Vì sao không |
|---|---|
| Nâng trần 6 KB | URL quá 8–16 KB hỏng ở tầng mạng với lỗi khó hiểu; chỉ dời ngày sập. |
| Thu gọn danh sách id (bỏ task đã archive, bỏ id đã có ở nhánh email/agent) | Chỉ sửa code, kết quả giữ y nguyên, nhưng danh sách vẫn tăng nên chỉ hoãn được một thời gian. Có thể làm như bản vá tạm nếu cần chạy ngay hôm nay mà chưa muốn đụng database. |
| Tách thành 3 truy vấn (`task_assignees!inner`, `task_participants!inner`, nhánh email) rồi gộp trong Node | Chỉ sửa code và dùng lâu dài được, nhưng tốn 3 lần truy vấn mỗi lượt tải (cộng lượt làm mới 60 s mỗi tab), và phải tự gộp, đếm, cắt trần trong TS. Là phương án dự phòng nếu không muốn thêm hàm SQL. |
| Bỏ phạm vi rồi lọc ở Node | Plan cũ đã bác: trần 5.000 dòng áp lên tập cả công ty **trước** `canViewTask`, nên task được phép xem có thể bị cắt mà không ai biết. |

## 5. Các bước

### Bước 0 — Đo trên production (chỉ đọc, hỏi user trước khi chạy)

```sql
-- 0.1 Số id mỗi người đang gửi trong URL, đếm đúng như code:
--     assignedIds + participantIds, cộng dồn, không lọc archived hay done.
with a as (select email, count(*) as n from task_assignees group by email),
     p as (select email, count(*) as n from task_participants group by email)
select coalesce(a.email, p.email) as email,
       coalesce(a.n, 0) + coalesce(p.n, 0) as ids_in_url,
       exists (select 1 from task_agents ta where ta.email = coalesce(a.email, p.email)) as is_agent,
       exists (select 1 from agent_members m
               where m.cs_email = coalesce(a.email, p.email) and m.is_assistant) as is_assistant,
       exists (select 1 from portal_account acc
               join user_roles ur on ur.user_id = acc.id
               join roles r on r.id = ur.role_id and r.is_active
               join role_permissions rp on rp.role_id = r.id and rp.permission_key = 'task.manage'
               where acc.email = coalesce(a.email, p.email)) as is_manager
from a full join p on p.email = a.email
where coalesce(a.n, 0) + coalesce(p.n, 0) >= 100
order by ids_in_url desc;

-- 0.2 Index theo email có mặt trên production
select tablename, indexname from pg_indexes
where tablename in ('task_assignees', 'task_participants') order by 1, 2;
```

Đọc kết quả:
- Người **hỏng ngay** hôm nay: `is_manager = false`, `is_agent` hoặc `is_assistant` = true, và
  `ids_in_url ≥ ~150`.
- Từ 100 tới 150 là sắp hỏng.

### Bước 1 — Rollout SQL (file local, chạy trước khi deploy code, hỏi user trước)

File `supabase/rollouts/2026-10-16-tasks-visible-to-worker.sql`. Theo quy ước, file rollout để local
và chỉ commit khi user bảo. Chép cùng nội dung vào `supabase/schema.sql`, cạnh định nghĩa
`task_participants` và `task_assignees` (khoảng dòng 3073-3096).

```sql
-- Phạm vi task của một Agent/Assistant (không có task.manage), tính trong database.
-- Thay cho chuỗi `.or(id.in.(...))` trong URL, vốn lớn dần theo lịch sử và sập ở ~150 id
-- (TaskScopeTooLargeError). Điều kiện y hệt buildWorkerTaskOrs cũ; so khớp email chính xác.
-- p_agent_emails: các Agent mà người này làm Assistant, do app tính (resolveTaskQueueScope).
create or replace function public.tasks_visible_to_worker(p_email text, p_agent_emails text[])
returns setof public.tasks
language sql
stable
set search_path = public, pg_temp
as $$
  select t.*
  from public.tasks t
  where t.assignee_email = p_email
     or t.agent_email = p_email
     or t.reporter_email = p_email
     or t.agent_email = any(coalesce(p_agent_emails, '{}'))
     or exists (select 1 from public.task_assignees a where a.task_id = t.id and a.email = p_email)
     or exists (select 1 from public.task_participants p where p.task_id = t.id and p.email = p_email);
$$;

revoke all on function public.tasks_visible_to_worker(text, text[]) from public, anon, authenticated;
grant execute on function public.tasks_visible_to_worker(text, text[]) to service_role;

notify pgrst, 'reload schema';
```

Ghi chú:
- **Không** lọc `archived_at` trong hàm. App vẫn thêm `.is("archived_at", null)` như hôm nay, nên
  hàm chỉ thay đúng phần phạm vi.
- `security invoker` (mặc định). App luôn gọi bằng service role, vốn bỏ qua RLS. Quyền chạy hàm
  bị thu khỏi `anon` và `authenticated`, theo quy ước ở `schema.sql:262-367`.
- Email luôn lấy từ session ở server, không bao giờ từ trình duyệt.

### Bước 2 — Code

**2.1 `src/lib/tasks/queries.ts`**

- `TaskQueryShape` đổi từ `scopedOrs: string[] | null` sang
  `workerScope: { email: string; agentEmails: string[] } | null`.
- `buildTaskQuery`:

```ts
function buildTaskQuery(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  shape: TaskQueryShape,
  afterId: string | null,
) {
  const countOption = afterId === null ? { count: TASK_LIST_COUNT_MODE } : {};
  // Agent/Assistant: phạm vi tính trong database (tasks_visible_to_worker).
  // Manager và CS thường: cả công ty.
  let query = (
    shape.workerScope
      ? supabase
          .rpc(
            "tasks_visible_to_worker",
            { p_email: shape.workerScope.email, p_agent_emails: shape.workerScope.agentEmails },
            countOption,
          )
          .select(shape.columns)
      : supabase.from("tasks").select(shape.columns, countOption)
  )
    .is("archived_at", null)
    .order("id", { ascending: true })
    .limit(TASK_PAGE_SIZE);
  if (afterId !== null) query = query.gt("id", afterId);
  return query;
}
```

  Nếu TypeScript không chịu kiểu hợp của hai builder trong biểu thức `? :`, tách thành hai nhánh
  `if`, mỗi nhánh tự gắn `.is/.order/.limit/.gt`.
- `fetchTasksForActor`:
  - bỏ `fetchAssignedTaskIdsForEmail` (không còn cần);
  - **giữ** `fetchParticipantTaskIds`, vì cờ `viewer_is_participant` (`queries.ts:240-245`) cần nó
    trong Node, không gửi lên URL;
  - truyền `workerScope = { email: actor.email, agentEmails: scope.agentEmails }`;
  - xoá khối đo byte (`queries.ts:156-169`).
- Nhánh legacy thiếu cột `custom_values` (`queries.ts:193-221`) đang nguội vì production đã có cột
  này. Đổi theo cùng cách: scoped thì dùng `rpc(...).select(TASK_COLUMNS_LEGACY)`. Xoá hẳn nhánh
  `.or(scopedOrs)`.
- Xoá `SCOPE_FILTER_MAX_BYTES`, `TaskScopeTooLargeError`, `buildWorkerTaskOrs`. Xoá luôn
  `quotePostgrestFilterValue` và test của nó (`queries.test.ts:125-133`): ngoài
  `buildWorkerTaskOrs` không còn chỗ nào dùng (đã grep 2026-10-16).

**2.2 `src/app/api/tasks/route.ts`**

Bỏ import `TaskScopeTooLargeError` và nhánh 503 `TASK_SCOPE_TOO_LARGE` (`:86-99`). Sửa chú thích
`:81-84`, chỗ còn nhắc nhánh 503.

**2.3 Test `src/lib/tasks/queries.test.ts`**

Harness `loadFetchTasksForActor` (`:276-360`) đang cho `rpc` trả một Promise, phục vụ RPC
metadata. Sửa:
- `rpc("tasks_visible_to_worker", ...)` trả về `builder` (đi tiếp `.select/.is/.order/.limit/.gt`);
- các RPC khác giữ nguyên.

Các test cần viết lại:
- "applies the same scope predicate to every page" (`:190`): mọi trang gọi `rpc` với **cùng**
  `{ p_email, p_agent_emails }`, và `orCalls` rỗng.
- "keeps agent workers scoped" (`:244`) và "keeps assistant workers scoped" (`:260`): có lời gọi
  `rpc("tasks_visible_to_worker", { p_email: "agent@example.com", p_agent_emails: [...] }, ...)`,
  không có `.or()`.
- "does not scope plain-CS workers" (`:229`) và manager: **không** gọi `tasks_visible_to_worker`,
  đi `from("tasks")`.
- Test mới: một worker có 1.000 participant id thì **không** throw, và URL không chứa id nào
  (`orCalls` rỗng).

**2.4 `changelog.md`**

Thêm entry: "Agent/Assistant mở được Task Board bất kể lịch sử dài bao nhiêu. Phạm vi tính bằng
hàm SQL `tasks_visible_to_worker`, bỏ `TaskScopeTooLargeError`."

### Bước 3 — Kiểm

1. `npm run typecheck`, `npm run test:run`, `npm run lint`, `npx next build`.
2. Sau khi chạy rollout (Bước 1), mở localhost bằng **đúng** tài khoản trong ảnh lỗi (profile
   "School"). Bản dev dùng chung database production, và các thao tác dưới đây chỉ đọc:
   - `/tasks` mở được;
   - con số "N of M tasks" bằng kết quả truy vấn 3.1 bên dưới;
   - chờ hơn 60 s để bảng tự làm mới, không có lỗi 503;
   - Export chạy được.
3. Đăng nhập manager và một CS thường: bảng y như trước, vì hai loại này không gọi hàm mới.

```sql
-- 3.1 (chỉ đọc) Số task một người được thấy, dùng đúng hàm mới.
--     Thay email; mảng là các Agent mà người đó làm Assistant.
select count(*) from tasks_visible_to_worker('<email>', array(
  select agent_email from agent_members where cs_email = '<email>' and is_assistant
)) where archived_at is null;
```

### Bước 4 — Thứ tự deploy và rollback

1. Chạy rollout trên production (hỏi user trước). Hàm phải có **trước** khi code gọi tới nó.
2. Commit code, push `origin`, rồi push `vercel` (deploy production) khi user đồng ý.
3. Rollback: revert commit code. Hàm có thể giữ lại vì không ai gọi, hoặc
   `drop function public.tasks_visible_to_worker(text, text[]);`.

## 6. Rủi ro

- **Hàm không được inline** vì có `set search_path`, nên mỗi trang keyset chạy lại hàm một lần
  (tối đa 5 trang). Với vài trăm đến vài nghìn task, mỗi lần quét `tasks` một lượt, còn các
  `exists` dùng index theo email. Muốn chắc thì chạy `explain analyze` truy vấn 3.1 (chỉ đọc).
- **PostgREST chưa thấy hàm mới** (schema cache): rollout có `notify pgrst, 'reload schema'`. Nếu
  vẫn báo `PGRST202` thì chạy lại lệnh notify.
- **Lệch kết quả với hôm nay**: điều kiện chép đúng `buildWorkerTaskOrs`, và `p_agent_emails` lấy
  từ cùng hàm TS. Bước 3 kiểm bằng tài khoản thật.

## 7. Không làm trong plan này

- B1–B7 của plan 2026-09-04: cửa sổ ngày, virtualize, đếm sẵn, budget.
- Không đổi ai thấy task nào; chỉ đổi **chỗ** tính phạm vi.
- Không đổi tìm kiếm (`search.ts`), vì nó không gửi id lên URL.
