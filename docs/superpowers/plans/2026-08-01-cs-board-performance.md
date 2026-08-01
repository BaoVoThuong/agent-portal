# CS Task Board — Data-Load Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Giảm thời gian load `/tasks` (CS Task Board) — hiện chậm và sẽ "sập" ở quy mô 30 agent — bằng cách bỏ over-fetch, song song hoá round-trip, gỡ query trùng/N+1, và (phase sau) phân trang + virtualize + delta refetch. KHÔNG đổi kết quả nghiệp vụ, chỉ đổi cách lấy dữ liệu.

**Architecture:** 3 phase tăng dần rủi ro: (A) tối ưu cách gọi query hiện có mà không đổi logic; (B) đẩy phần aggregation nặng nhất xuống 1 Postgres RPC; (C) phân trang/windowing + virtualize list + delta-refetch realtime.

**Tech Stack:** Next.js 16 (RSC, `force-dynamic`), React 19 (`cache()`), Supabase Postgres (`supabase.rpc`, SQL functions), TypeScript, vitest.

## Global Constraints

- **Không đổi hành vi nhìn thấy:** cùng danh sách task, cùng quyền, cùng số comment/attachment/last-activity. Chỉ đổi *cách* lấy.
- **Next.js fork:** đọc `node_modules/next/dist/docs/` trước khi viết RSC/route. `getSupabaseAdmin()` chỉ dùng server-side (service-role, bỏ RLS).
- **SQL vào `supabase/schema.sql`** theo style hiện có (`create or replace function ... language sql|plpgsql`). RPC gọi qua `supabase.rpc(name, args)` (đã dùng ở `assign/route.ts`, `rotation.ts`…). User tự chạy schema.sql — plan chỉ ghi SQL + báo cần chạy.
- **Fallback an toàn:** mọi thay đổi phụ thuộc schema mới (RPC) phải có nhánh fallback về code cũ nếu RPC chưa deploy (mirror `isMissingTaskCustomValuesColumn` trong `queries.ts`).
- **Test:** logic thuần (group/merge) test vitest; phần I/O đo bằng benchmark thủ công (curl + `Prefer: count`, hoặc `\timing` trong psql).
- **Đo trước–sau:** mỗi phase ghi lại số round-trip + thời gian load để chứng minh cải thiện (evidence before assertions).

---

## Background & Existing Codebase Context

> Đọc kỹ trước khi làm. Mục này mô tả pipeline hiện tại + số đo thật để senior zero-context hiểu vì sao từng task cần thiết.

### Đường đi dữ liệu khi vào `/tasks`
`src/app/(authed)/tasks/page.tsx` là server component (`export const dynamic = "force-dynamic"` → chạy lại toàn bộ mỗi lần điều hướng, không cache). Nó:
- **Wave 1** — `Promise.all` ~10 fetch song song: `fetchTasksForActor`, `fetchTaskAssignees`, `fetchTaskAgents`, `fetchTaskAgentCandidates`, (worker) `fetchAgentsForCs`/`fetchAssistantAgentsForCs`, `task_categories`, `fetchTableColumns("cs")`, `fetchTableColumnOptions("cs")`, `canActorExportImport`.
- **Wave 2** — dựng `agentMembersByAgent` bằng `agentEmailsForMembers.map(fetchCsForAgent)` (1 query/agent).

### `fetchTasksForActor` (src/lib/tasks/queries.ts) — nội bộ là 1 waterfall
1. (worker) `Promise.all` 4 query scope.
2. 1 query `tasks` (manager: mọi task non-archived).
3. `attachAssigneesToTasks` → `fetchTaskAssigneeRowsForTaskIds`: **for-loop chunk 50, `await` tuần tự**.
4. `attachTaskListMetadata`: `Promise.all` 3 nhánh (activity/comments/attachments), **mỗi nhánh lại for-loop chunk 50 tuần tự**, kéo *toàn bộ* dòng về Node rồi đếm/tìm-mới-nhất bằng tay:
```ts
// queries.ts (hiện tại) — kéo MỌI dòng chỉ để tính 3 con số
const [activityRows, commentRows, attachmentRows] = await Promise.all([
  fetchTaskActivityRows(ids, supabase),   // select task_id,actor_email,created_at — KHÔNG limit
  fetchTaskCommentRows(ids, supabase),    // select task_id (đếm)
  fetchTaskAttachmentRows(ids, supabase), // select task_id (đếm)
]);
// last_activity_by_email = actor của dòng activity mới nhất/ task
// comment_count / attachment_count = đếm số dòng/ task
```

### Số đo thật (DB dev, team test nhỏ) + suy ra prod
| bảng | dev | prod ước lượng (30 agent) |
|------|-----|---------------------------|
| tasks (non-archived) | 423 | vài nghìn task active + archived tích luỹ vô hạn |
| task_activity | 769 | hàng chục nghìn (~10–30 dòng/task) |
| task_comments | 18 | hàng nghìn |
| task_assignees | 422 | ~1/task |
Hệ quả ở prod: `attachTaskListMetadata` kéo ~**45.000 dòng** mỗi lần vào trang; chunk 50 tuần tự = ~**60 round-trip nối đuôi/bảng**.

### Index — KHÔNG phải vấn đề (đã kiểm)
`task_assignees` PK `(task_id,email)`; `task_activity(task_id,created_at)`; `task_comments(task_id,created_at)`; `agent_members(cs_email)` + `(agent_email)`; `tasks(status,position)`,`tasks(assignee_email)`,`tasks(agent_email)`,`tasks(archived_at)`. Đủ. Vấn đề là **pattern**, không phải index — đừng thêm index vô ích.

### Query trùng / N+1 hiện có
- `enrichTaskPeopleRoles` (assignees.ts) bị gọi 3 lần (assignees/agents/candidates), mỗi lần tự query `task_agents` + `agent_members` → trùng ~4–5 lần/load.
- `fetchTableColumns("cs")` chạy 2 lần: 1 lần trực tiếp ở page.tsx, 1 lần trong `fetchTableColumnOptions("cs")` (xem `src/lib/table-config/queries.ts`).
- Wave 2 `fetchCsForAgent` (membership.ts): 1 query/agent, `agent_members` chỉ 15 dòng — thừa sức 1 query.

### Client (TaskBoardClient.tsx)
- `refetchTasks` ([:362-380]) gọi `/api/tasks` chạy lại **toàn bộ** `fetchTasksForActor` mỗi realtime ping. Có guard chống race nhưng vẫn là full load.
- `TaskListView` render `rows.map(...)` — **không virtualize** (grep: chưa có react-virtual/react-window trong deps).
- Mount còn fetch overview/assignment-queue/categories/sla-rules/layout/notifications — burst request sau SSR nặng.

### Quy ước
`supabase.rpc(name, args)` đã dùng (assign/route.ts, rotation.ts…). SQL function style: `refresh_health_mart()` trong schema.sql. Test vitest ở `src/lib/**/*.test.ts`.

---

## File Structure

**Modify:**
- `src/lib/tasks/queries.ts` — parallel chunk fetch (A1); RPC metadata (B).
- `src/lib/tasks/assignees.ts` — parallel chunk in `fetchTaskAssigneeRowsForTaskIds` (A1); `cache()` shared lookups (A3).
- `src/lib/tasks/membership.ts` — `fetchCsForAgents` batch (A2).
- `src/app/(authed)/tasks/page.tsx` — dùng `fetchCsForAgents` (A2); một lần columns+options (A3).
- `src/lib/table-config/queries.ts` — `fetchTableColumnsWithOptions` (A3).
- `supabase/schema.sql` — `task_list_metadata` RPC (B).
- `src/app/api/tasks/route.ts` + `TaskBoardClient.tsx` — delta refetch (C3).
- `src/app/(authed)/tasks/_components/TaskListView.tsx` — virtualize (C2).

**Create:**
- `src/lib/tasks/membership.test.ts` — group helper test (A2).
- `src/lib/tasks/list-window.ts` (+ test) — windowing predicate (C1).

---

# PHASE A — Quick wins (không đổi logic, rủi ro thấp)

## Task A1: Song song hoá các vòng lặp chunk

**Context:** 4 hàm (`fetchTaskAssigneeRowsForTaskIds`, `fetchTaskActivityRows`, `fetchTaskCommentRows`, `fetchTaskAttachmentRows`) đang `for (chunk) { await query }` — ở prod là ~60 round-trip nối đuôi/bảng. Đổi sang `Promise.all` toàn bộ chunk → cùng kết quả, gộp thành 1 đợt song song. Kết quả bảng con giống hệt (thứ tự vẫn được sort lại sau), nên không đổi hành vi.

**Files:** Modify `src/lib/tasks/queries.ts`, `src/lib/tasks/assignees.ts`

- [ ] **Step 1:** `fetchTaskActivityRows` — thay for-loop bằng:
```ts
async function fetchTaskActivityRows(taskIds, supabase = getSupabaseAdmin()) {
  const chunks = chunkValues(taskIds, TASK_METADATA_TASK_ID_CHUNK_SIZE);
  const results = await Promise.all(
    chunks.map((chunk) =>
      supabase.from("task_activity")
        .select("task_id,actor_email,created_at")
        .in("task_id", chunk)
        .order("created_at", { ascending: false })
    )
  );
  const rows: TaskActivityListRow[] = [];
  for (const { data, error } of results) {
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as unknown as TaskActivityListRow[]));
  }
  return rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}
```
- [ ] **Step 2:** Áp cùng khuôn cho `fetchTaskCommentRows`, `fetchTaskAttachmentRows` (queries.ts) và `fetchTaskAssigneeRowsForTaskIds` (assignees.ts) — giữ nguyên xử lý lỗi đặc thù của assignees (`isTaskAssigneesMissingError`/`isFetchFailedError` → `return null`; nếu bất kỳ chunk nào báo missing thì trả `null` như cũ).
- [ ] **Step 3: Verify** — `npx vitest run` (các test hiện có của tasks vẫn xanh); mở `/tasks` dev, so số round-trip trong Network/log trước–sau.
- [ ] **Step 4: Commit**
```bash
git add src/lib/tasks/queries.ts src/lib/tasks/assignees.ts
git commit -m "perf(tasks): parallelize chunked child-table fetches"
```

## Task A2: Gộp N+1 `fetchCsForAgent` thành 1 batch query

**Context:** page.tsx Wave 2 gọi `fetchCsForAgent` cho từng agent (30+ ở prod). `agent_members` nhỏ — 1 query `.in("agent_email", emails)` là đủ. Thêm helper batch + group in-memory, thay vòng map.

**Files:** Modify `src/lib/tasks/membership.ts`, `src/app/(authed)/tasks/page.tsx`; Create `src/lib/tasks/membership.test.ts`

**Interfaces:**
- Produces: `fetchCsForAgents(agentEmails: string[]): Promise<Record<string, string[]>>` — map agentEmail → danh sách cs_email (assistant), agent không có member trả `[]`.
- Produces (pure, test được): `groupAssistantMembers(rows: {agent_email:string; cs_email:string}[], agentEmails: string[]): Record<string,string[]>`.

- [ ] **Step 1: Test trước (pure group)**
```ts
import { describe, it, expect } from "vitest";
import { groupAssistantMembers } from "./membership";

describe("groupAssistantMembers", () => {
  it("groups cs_email by agent_email, dedupes, and includes empty agents", () => {
    const rows = [
      { agent_email: "a@x", cs_email: "c1@x" },
      { agent_email: "a@x", cs_email: "c1@x" },
      { agent_email: "a@x", cs_email: "c2@x" },
      { agent_email: "b@x", cs_email: "c3@x" },
    ];
    expect(groupAssistantMembers(rows, ["a@x", "b@x", "z@x"])).toEqual({
      "a@x": ["c1@x", "c2@x"],
      "b@x": ["c3@x"],
      "z@x": [],
    });
  });
});
```
- [ ] **Step 2: Run → FAIL** — `npx vitest run src/lib/tasks/membership.test.ts` (chưa export).
- [ ] **Step 3: Implement**
```ts
export function groupAssistantMembers(
  rows: { agent_email: string; cs_email: string }[],
  agentEmails: string[]
): Record<string, string[]> {
  const byAgent = new Map<string, Set<string>>(agentEmails.map((e) => [e, new Set<string>()]));
  for (const row of rows) {
    if (!byAgent.has(row.agent_email)) byAgent.set(row.agent_email, new Set());
    byAgent.get(row.agent_email)!.add(row.cs_email);
  }
  return Object.fromEntries([...byAgent].map(([agent, set]) => [agent, [...set]]));
}

export async function fetchCsForAgents(agentEmails: string[]): Promise<Record<string, string[]>> {
  const emails = [...new Set(agentEmails.filter(Boolean))];
  if (emails.length === 0) return {};
  const { data, error } = await getSupabaseAdmin()
    .from("agent_members")
    .select("agent_email,cs_email")
    .in("agent_email", emails)
    .eq("is_assistant", true);
  if (error) return Object.fromEntries(emails.map((e) => [e, []]));
  return groupAssistantMembers(
    (data ?? []) as { agent_email: string; cs_email: string }[],
    emails
  );
}
```
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5:** page.tsx — thay Wave 2:
```ts
const agentMembersByAgent = await fetchCsForAgents(agentEmailsForMembers);
```
(xoá import `fetchCsForAgent` nếu không còn dùng chỗ khác — grep trước).
- [ ] **Step 6: Verify + Commit**
```bash
git add src/lib/tasks/membership.ts src/lib/tasks/membership.test.ts "src/app/(authed)/tasks/page.tsx"
git commit -m "perf(tasks): batch agent-members lookup, remove N+1"
```

## Task A3: Dedupe query trùng (columns 2×, enrich lookups 3×)

**Context:** `fetchTableColumns("cs")` chạy 2 lần/load; `enrichTaskPeopleRoles` query `task_agents`+`agent_members` 3 lần. Dùng React `cache()` (memo per-request) cho các lookup không tham số, và gộp columns+options thành 1 lần fetch columns.

**Files:** Modify `src/lib/tasks/assignees.ts`, `src/lib/table-config/queries.ts`, `src/app/(authed)/tasks/page.tsx`

- [ ] **Step 1:** assignees.ts — tách 2 lookup dùng chung ra helper bọc `cache()`:
```ts
import { cache } from "react";
const fetchSelectedAgentEmails = cache(async (): Promise<Set<string>> => {
  const { data, error } = await getSupabaseAdmin().from("task_agents").select("email");
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((r) => (r as { email: string }).email));
});
const fetchAssistantMemberRows = cache(async (): Promise<{ agent_email: string; cs_email: string }[]> => {
  const { data, error } = await getSupabaseAdmin()
    .from("agent_members").select("agent_email,cs_email").eq("is_assistant", true);
  if (error) throw new Error(error.message);
  return (data ?? []) as { agent_email: string; cs_email: string }[];
});
```
Trong `enrichTaskPeopleRoles`, thay 2 query trực tiếp bằng `await Promise.all([fetchSelectedAgentEmails(), fetchAssistantMemberRows()])`. 3 lần gọi enrich trong cùng request → chỉ 1 query mỗi bảng (cache dedupe).
- [ ] **Step 2:** table-config/queries.ts — thêm `fetchTableColumnsWithOptions(scope)` fetch columns 1 lần rồi options theo columns đó (tránh `fetchTableColumnOptions` gọi lại `fetchTableColumns`). Hoặc đơn giản: bọc `fetchTableColumns` bằng `cache()` để 2 call cùng scope trong 1 request dedupe (kiểm tra `getSupabaseAdmin()` trả cùng instance để cache key ổn định; nếu không, dùng phương án `WithOptions`).
- [ ] **Step 3:** page.tsx — nếu dùng `fetchTableColumnsWithOptions`, thay 2 dòng `fetchTableColumns("cs")`/`fetchTableColumnOptions("cs")` bằng 1 call, destructure `{ columns, options }`.
- [ ] **Step 4: Verify** — `/tasks` load đúng cột/option như cũ; log xác nhận `task_agents`/`agent_members`/`table_column` mỗi cái query 1 lần.
- [ ] **Step 5: Commit**
```bash
git add src/lib/tasks/assignees.ts src/lib/table-config/queries.ts "src/app/(authed)/tasks/page.tsx"
git commit -m "perf(tasks): dedupe repeated people + column lookups via request cache"
```

---

# PHASE B — Aggregation RPC (bỏ cú kéo 45k dòng)

## Task B1: Postgres RPC `task_list_metadata`

**Context:** Thay vì kéo mọi dòng activity/comment/attachment về Node để đếm, tính thẳng trong Postgres và chỉ trả 1 dòng nhỏ/task. Dùng index sẵn có (`task_activity(task_id,created_at)` cho `limit 1`; `task_comments(task_id)` cho count). Đây là fix giảm tải mạnh nhất.

**Files:** Modify `supabase/schema.sql`

- [ ] **Step 1:** Thêm function (cạnh các RPC task khác):
```sql
create or replace function task_list_metadata(task_ids uuid[])
returns table (
  task_id uuid,
  last_activity_by_email text,
  comment_count integer,
  attachment_count integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    t.id as task_id,
    (select a.actor_email
       from task_activity a
      where a.task_id = t.id
      order by a.created_at desc
      limit 1) as last_activity_by_email,
    (select count(*)::int
       from task_comments c
      where c.task_id = t.id and c.deleted_at is null) as comment_count,
    (select count(*)::int
       from task_attachments att
      where att.task_id = t.id) as attachment_count
  from unnest(task_ids) as t(id);
$$;
```
- [ ] **Step 2: User áp schema.sql** rồi verify + benchmark:
```sql
-- correctness: khớp cách đếm cũ
select * from task_list_metadata(array(select id from tasks where archived_at is null limit 5));
-- timing
\timing on
select * from task_list_metadata(array(select id from tasks where archived_at is null));
```
Expected: trả đúng 1 dòng/task; thời gian nhỏ hơn nhiều so với select-all cũ.
- [ ] **Step 3: Commit**
```bash
git add supabase/schema.sql
git commit -m "perf(tasks): task_list_metadata aggregation RPC"
```

## Task B2: Dùng RPC trong `attachTaskListMetadata` (kèm fallback)

**Context:** Đổi `attachTaskListMetadata` sang 1 call `supabase.rpc("task_list_metadata", { task_ids })`. Nếu RPC chưa deploy (dev chưa chạy schema), fallback về đường cũ để không vỡ — mirror `isMissingTaskCustomValuesColumn`.

**Files:** Modify `src/lib/tasks/queries.ts`

- [ ] **Step 1:** Viết fallback-guard `isMissingRpc(error)`: true nếu `code === "PGRST202"` hoặc message chứa `task_list_metadata` + (`does not exist`|`could not find`).
- [ ] **Step 2:** Rewrite:
```ts
async function attachTaskListMetadata(tasks, supabase = getSupabaseAdmin()) {
  if (tasks.length === 0) return tasks;
  const ids = tasks.map((t) => t.id);
  const { data, error } = await supabase.rpc("task_list_metadata", { task_ids: ids });
  if (error) {
    if (isMissingRpc(error)) return attachTaskListMetadataLegacy(tasks, supabase); // đường cũ (Task A1)
    throw new Error(error.message);
  }
  const byId = new Map(
    (data as MetaRow[]).map((r) => [r.task_id, r])
  );
  return tasks.map((task) => {
    const m = byId.get(task.id);
    return {
      ...task,
      last_activity_by_email: m?.last_activity_by_email ?? null,
      comment_count: m?.comment_count ?? 0,
      attachment_count: m?.attachment_count ?? 0,
    };
  });
}
```
Giữ hàm cũ đổi tên `attachTaskListMetadataLegacy` (đã song song hoá ở A1) làm fallback.
- [ ] **Step 3: Verify** — với RPC deployed: `/tasks` hiện đúng last-activity/counts, 1 round-trip thay vì kéo cả bảng; tạm rename RPC để ép nhánh fallback → vẫn đúng.
- [ ] **Step 4: Commit**
```bash
git add src/lib/tasks/queries.ts
git commit -m "perf(tasks): use task_list_metadata RPC with legacy fallback"
```

---

# PHASE C — Scale (phân trang · virtualize · delta) — cần thiết kế/UX, làm sau

## Task C1: Windowing payload mặc định (server)

**Context:** Manager đang nhận MỌI task non-archived. Ở prod nên chỉ trả "cửa sổ" mặc định: status active (`todo`/`in_progress`/`waiting`/`backlog`) + `done`/`cancel` đóng trong N ngày gần đây; phần cũ hơn lấy khi user lọc/scroll. Đây là quyết định UX — chốt N (vd 30 ngày) với user trước khi làm.

**Files:** Create `src/lib/tasks/list-window.ts` (+ test); Modify `src/lib/tasks/queries.ts`, `src/app/api/tasks/route.ts`

- [ ] **Step 1:** Pure predicate `defaultWindowFilter(now, closedWithinDays)` → điều kiện SQL (`archived_at is null and (closed_at is null or closed_at >= <cutoff>)`); test biên.
- [ ] **Step 2:** Áp vào `fetchTasksForActor` khi không có filter mở rộng; thêm param `includeClosedBefore` cho "load more".
- [ ] **Step 3: Verify + Commit.**

## Task C2: Virtualize List view

**Context:** `TaskListView` render mọi dòng. Thêm `@tanstack/react-virtual` (chưa có trong deps) chỉ render dòng trong viewport. Giữ sticky header + sticky cột.

**Files:** Modify `package.json`, `src/app/(authed)/tasks/_components/TaskListView.tsx`

- [ ] **Step 1:** `npm i @tanstack/react-virtual`.
- [ ] **Step 2:** Bọc `<ul>` bằng virtualizer (fixed/estimated row height), render `virtualItems`; giữ `role`/sticky đã có. Kanban không đụng (mỗi cột đã cuộn riêng).
- [ ] **Step 3: Verify** cuộn mượt với vài nghìn dòng giả; **Commit.**

## Task C3: Delta refetch realtime

**Context:** `refetchTasks` chạy lại full list mỗi ping. Thêm `/api/tasks?since=<iso>` trả chỉ task `updated_at > since` (+ id đã archived để client gỡ). Client giữ cursor, merge delta thay vì thay cả list.

**Files:** Modify `src/app/api/tasks/route.ts`, `src/lib/tasks/queries.ts`, `src/app/(authed)/tasks/_components/TaskBoardClient.tsx`

- [ ] **Step 1:** Query hỗ trợ `since` (thêm `.gt("updated_at", since)`); trả `{ tasks, archivedIds, cursor }`.
- [ ] **Step 2:** Client lưu `cursor`, gọi `?since=cursor` trong `refetchTasks`; `mergeRefetchedTasks` áp delta + gỡ archived. Full refetch chỉ khi (re)connect lần đầu.
- [ ] **Step 3: Verify** 2 tab: sửa 1 task ở tab A → tab B chỉ tải delta; **Commit.**

---

## Self-Review (checklist đã chạy)

**Spec coverage (từ audit):** over-fetch metadata (#1 → B1,B2) ✓; chunk tuần tự (#2 → A1) ✓; load-all/không phân trang/không virtualize (#3 → C1,C2) ✓; query trùng (#4 → A3) ✓; N+1 fetchCsForAgent (#5 → A2) ✓; realtime full-reload (#6 → C3) ✓.

**Placeholder scan:** A1/A2/A3/B1/B2 có code cụ thể + test cho phần thuần; C1-C3 mô tả rõ input/output + điểm sửa (cố ý để phần cần chốt UX — N ngày, chọn lib — không hardcode bừa).

**Type consistency:** `groupAssistantMembers`/`fetchCsForAgents`/`task_list_metadata`(cols: task_id,last_activity_by_email,comment_count,attachment_count)/`isMissingRpc`/`attachTaskListMetadataLegacy` dùng nhất quán giữa các task.

**Thứ tự:** A (rủi ro thấp, đo ngay) → B (giảm tải nhất, cần chạy schema) → C (cần chốt UX). Làm A trước.

**Điểm cần bạn chốt ở C:** số ngày cửa sổ mặc định (C1); có chấp nhận thêm dependency `@tanstack/react-virtual` (C2).
