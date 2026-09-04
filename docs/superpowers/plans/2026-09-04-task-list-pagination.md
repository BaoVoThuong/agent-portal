# Task List Pagination — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **For a reviewer:** this document is written to be read cold. Section 1 is the context you need; sections 2–3 are the evidence; section 5 onwards is the work. Section 8 lists what I deliberately did **not** do and the questions I want pushed back on.

**Goal:** Stop the Health CS task board from hard-crashing when the number of active tasks passes 1.000, without changing a single thing a user sees.

**Architecture:** `fetchTasksForActor` currently issues one un-ranged `SELECT` and then *deliberately throws* if PostgREST returned fewer rows than the exact count. PostgREST on this project caps every response at 1.000 rows (measured, see §3). The fix is to page the query — first page alone because it carries the count, remaining pages in bounded parallel — reusing the page-planning helpers written and shipped for Event Leads earlier today. Truncation moves from "throw" to a reported flag at a much higher ceiling, matching the pattern already used by `/api/leads` and `/api/leads/overview`.

**Tech Stack:** Next.js 16.2.4 (a fork — read `node_modules/next/dist/docs/` before assuming upstream behaviour), React 19.2.4, Supabase JS 2.x through `getSupabaseAdmin()` (service-role, called only after Next.js has done authn/authz), PostgREST, vitest 2.1.9 with `environment: "node"` (so **no `.tsx` file in this repo can be unit-tested** — that constraint shapes where logic lives).

---

## 1. Context for a reviewer with zero background

**The product.** `agent-portal` is an internal Next.js app for an insurance agency: ~50 agents plus a CS (customer service) team. The "Health CS task board" at `/tasks` is where CS staff work tickets. A task has a status (`backlog` → `todo` → `in_progress` → `waiting` → `done`/`cancel`), an assignee, an owning agent, comments, file attachments, an SLA timer, and a QC review step (`done_reviewed_at`).

**How the board loads today.** One server component (`src/app/(authed)/tasks/page.tsx`) calls `fetchTasksForActor(actor)`, which returns **every** non-archived task the actor may see. That whole array is handed to a client component (`TaskBoardClient`), and **all filtering happens in the browser** — date range, status, agent, category, priority, quick filters. Changing a filter issues **zero** network requests. This is deliberate and users like it; the plan does not change it.

**Two facts that matter and are easy to miss:**

1. **The date filter is cosmetic with respect to load.** `TaskBoardClient.tsx:1027` is literally `const scopedTasks = tasks;` and `:1158` runs `filterTasks(scopedTasks, …)` client-side. A user looking at "Today" has still downloaded every active task. So no filter setting can rescue the board from the cap.
2. **Visibility scope narrows the query for some users but not others.** A manager or a "plain-CS" user sees the company-wide queue (no `.or()` clause at all). An agent/assistant gets a `.or(...)` of their own email, their agents, their assigned ids and their participant ids. **Managers and plain-CS therefore hit the cap first**, and they are the people who most need the board.

**Related work shipped earlier today** (same repo, same day, already on `main` and deployed): the Event Leads list had the same "load everything" shape. It was paged first-page-then-parallel, its table was windowed with `@tanstack/react-virtual`, and a small pure module `src/lib/leads/page-plan.ts` was written and tested for the paging arithmetic. That module is the reusable part and this plan leans on it. It survived an independent review that caught a real blocker in its first draft (a row cap expressed in pages rather than rows) — §6 explains why this plan does not repeat that mistake.

---

## 2. The failure, precisely

`src/lib/tasks/queries.ts:26-32` — one query, no `.range()`:

```ts
let query = supabase
  .from("tasks")
  .select(TASK_COLUMNS, { count: TASK_LIST_COUNT_MODE })   // "exact"
  .is("archived_at", null)
  .order("position", { ascending: true })
  .order("created_at", { ascending: true })
  .order("id", { ascending: true });
```

`src/lib/tasks/queries.ts:168-181` — the guard that turns a capped response into a crash:

```ts
/**
 * PostgREST can cap an un-ranged response without returning an error. Exact
 * count lets us fail closed instead of presenting a silently incomplete task
 * board or export. Pagination/windowing is a separate, measured follow-up.
 */
export function assertTaskListComplete(
  rows: unknown[] | null,
  count: number | null | undefined
): void {
  const loaded = rows?.length ?? 0;
  if (typeof count === "number" && count > loaded) {
    throw new TaskListTruncatedError(count, loaded);
  }
}
```

This is not a bug — it is a documented, deliberate fail-closed with an explicit "pagination is a separate, measured follow-up" TODO. **This plan is that follow-up.** Failing closed was the right call: the alternative was a board that silently omits tasks.

**What each entry point does at active task #1.001:**

| Entry point | File | Handles the throw? | Result |
|---|---|---|---|
| Board page render | `src/app/(authed)/tasks/page.tsx:50` | **No** | Server component throws → error boundary → **nobody can open `/tasks`** |
| Client refetch | `src/app/api/tasks/route.ts:85` | Yes, `:89-99` | HTTP 503 with `code: "TASK_LIST_TRUNCATED"` |
| CSV export | `src/app/api/tasks/export/route.ts:63` | **No** | Unhandled → 500 |

Note the 503's `code` is produced but **never consumed** — `TaskBoardClient.tsx:462-469` just reads `data.error` and shows the raw message. Grep confirms `TASK_LIST_TRUNCATED` appears in exactly one file.

---

## 3. Measurements (production, 2026-09-04, read-only)

**The PostgREST ceiling is 1.000.** Asked `task_notifications` (9.128 rows) for `.range(0, 99999)` and for a bare un-ranged select. Both returned exactly **1.000** rows with `count = 9128`. So the cap is real, it is 1.000, and an un-ranged select silently hits it.

**Current volumes:**

| Table | Rows | Per active task |
|---|---|---|
| `tasks` (active, what the board loads) | **141** | — |
| `tasks` (archived) | 21 | — |
| `task_comments` | 2.157 | 13,3 |
| `task_activity` | 3.665 | 22,6 |
| `task_attachments` | 202 | 1,25 |
| `task_notifications` | 9.128 | 56,0 |

**Status split of the 141 active tasks:** `done` 99 · `waiting` 24 · `in_progress` 14 · `todo` 4 · `backlog` 0 · `cancel` 0. (99 of 141 are `done` and not archived — see §8 for why this plan does **not** archive them.)

**Growth:** oldest task 2026-08-17, newest 2026-09-03 → 162 tasks over 17 days = **9,4 tasks/day**. At that rate the board reaches 1.000 active tasks in **~92 days**. The product owner independently estimated ~2 months, so treat 92 days as an upper bound.

**Payload:** serialising all 141 active rows over the exact `TASK_COLUMNS` list gives **1.372 bytes/task** (`description` median 156 chars, max 490 — it is not the bloat risk one might assume).

| Active tasks | Raw | ~gzip (3,5:1) |
|---|---|---|
| 500 | 0,65 MB | 0,19 MB |
| 1.000 | 1,31 MB | 0,37 MB |
| 2.000 | 2,62 MB | 0,75 MB |
| 5.000 | 6,54 MB | 1,87 MB |

For comparison, the Event Leads list shipped today carries ~0,8 MB gzipped at 2.000 rows and is considered acceptable. So paging to a much higher ceiling does not create a new payload problem at any volume this product will see soon.

---

## 4. Global Constraints

- **No user-visible behaviour change.** Same tasks, same order, same client-side filters, same speed. If a step changes what someone sees, it is wrong. This is the whole reason this approach was chosen over archiving or server-side date filtering.
- **Truncation must never be silent.** Established twice in this repo already: `assertTaskListComplete`'s own comment, and `src/app/api/leads/overview/route.ts:18-23` — *"a dashboard that quietly under-reports is worse than one that errors, because nobody thinks to doubt it. Page explicitly, and say so when the ceiling is hit."* Whatever ceiling this plan introduces must be reported.
- **The row cap is expressed in ROWS, never in pages.** A page-based cap is really "N × whatever the server ceiling turns out to be", which moves when the server config moves. This exact mistake was caught in review of the Leads plan this morning; do not reintroduce it.
- **Language:** comments and changelog in Vietnamese, matching surrounding files. Commit subjects follow existing history (`type(scope): summary`).
- **Changelog:** every logic change gets an entry at the top of `agent-portal/changelog.md`.
- **Push:** `origin` and `vercel` only when the user asks.
- **Commits** end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

## 5. File Structure

**Task 1 — make the paging helpers shared (they are not lead-specific)**
- Move: `src/lib/leads/page-plan.ts` → `src/lib/pagination/page-plan.ts`, renaming `dedupeLeadsById` → `dedupeById<T extends { id: string }>` and `LEAD_MAX_ROWS` → stays lead-specific in the leads caller. Rationale: `src/lib/tasks/*` must not import from `src/lib/leads/*`.
- Move: `src/lib/leads/page-plan.test.ts` → `src/lib/pagination/page-plan.test.ts`
- Modify: `src/lib/leads/queries.ts` — update the import.

**Task 2 — page `fetchTasksForActor`**
- Modify: `src/lib/tasks/queries.ts` — extract query building, page it, return `{ tasks, total, truncated }`.
- Modify: `src/lib/tasks/queries.test.ts` — extend the existing scope tests.

**Task 3 — update the three callers**
- Modify: `src/app/(authed)/tasks/page.tsx:50`
- Modify: `src/app/api/tasks/route.ts:84-99`
- Modify: `src/app/api/tasks/export/route.ts:63`

**Task 4 — bound the metadata fan-out**
- Modify: `src/lib/tasks/queries.ts` — `fetchTaskListMetadata` currently does `Promise.all` over *every* chunk.

**Task 5 — surface truncation + changelog**
- Modify: `src/app/(authed)/tasks/_components/TaskBoardClient.tsx` — a warning banner.
- Modify: `agent-portal/changelog.md`

---

### Task 1: Move the paging helpers out of `lib/leads`

**Files:**
- Create: `src/lib/pagination/page-plan.ts` (moved from `src/lib/leads/page-plan.ts`)
- Create: `src/lib/pagination/page-plan.test.ts` (moved)
- Delete: `src/lib/leads/page-plan.ts`, `src/lib/leads/page-plan.test.ts`
- Modify: `src/lib/leads/queries.ts` (import path + one symbol rename)

**Interfaces produced:**
- `planLeadPageOffsets(firstPageRowCount, total, maxRows): number[]` — renamed to `planPageOffsets`
- `chunkPageOffsets(offsets, size): number[][]`
- `dedupeById<T extends { id: string }>(rows: readonly T[]): T[]` — was `dedupeLeadsById`
- `PAGE_FETCH_CONCURRENCY = 4` — was `LEAD_PAGE_FETCH_CONCURRENCY`

`LEAD_MAX_ROWS = 20_000` stays a **leads** concern and moves to `src/lib/leads/queries.ts`; tasks will declare its own `TASK_MAX_ROWS`. The row ceiling is a per-module product decision, not a property of the arithmetic.

**Current content of `src/lib/leads/page-plan.ts`** (shipped today, 11 tests passing — reproduce it verbatim at the new path with only the two renames applied):

```ts
export const LEAD_MAX_ROWS = 20_000;          // → moves to lib/leads/queries.ts
export const LEAD_PAGE_FETCH_CONCURRENCY = 4; // → rename PAGE_FETCH_CONCURRENCY

export function planLeadPageOffsets(          // → rename planPageOffsets
  firstPageRowCount: number,
  total: number,
  maxRows: number,
): number[] {
  if (firstPageRowCount <= 0) return [];
  const ceiling = Math.min(total, maxRows);
  const offsets: number[] = [];
  for (let offset = firstPageRowCount; offset < ceiling; offset += firstPageRowCount) {
    offsets.push(offset);
  }
  return offsets;
}

export function dedupeLeadsById(rows) { … }   // → rename dedupeById, generic
export function chunkPageOffsets(offsets, size) { … }  // unchanged
```

**Why the step is `firstPageRowCount` and not the requested page size** — carry this reasoning across with the code, it is the reason the function exists. PostgREST enforces its own `db-max-rows`. If the deployment caps a response at 500 while we ask for 1.000, a sequential loop stays correct (it advances by what actually came back) but a *parallel* plan built from the **requested** size would ask for offsets 1000, 2000, 3000 … and silently skip rows 500–999, 1500–1999. Stepping by what page one actually returned makes the plan self-correcting against any ceiling.

- [ ] **Step 1: Move the files and apply the renames**

```bash
cd agent-portal
mkdir -p src/lib/pagination
git mv src/lib/leads/page-plan.ts src/lib/pagination/page-plan.ts
git mv src/lib/leads/page-plan.test.ts src/lib/pagination/page-plan.test.ts
```

In `src/lib/pagination/page-plan.ts`:
- delete the `LEAD_MAX_ROWS` export and its doc comment (it moves to `lib/leads/queries.ts` in step 2)
- rename `LEAD_PAGE_FETCH_CONCURRENCY` → `PAGE_FETCH_CONCURRENCY`
- rename `planLeadPageOffsets` → `planPageOffsets`
- rename `dedupeLeadsById` → `dedupeById` and generalise its signature:

```ts
export function dedupeById<T extends { id: string }>(rows: readonly T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    result.push(row);
  }
  return result;
}
```

Update `src/lib/pagination/page-plan.test.ts` to the new names, and replace its `LeadRow` import with a local `type Row = { id: string }` so the pagination module has no dependency on the leads domain.

- [ ] **Step 2: Move `LEAD_MAX_ROWS` into the leads query module**

In `src/lib/leads/queries.ts`, replace the `page-plan` import with:

```ts
import {
  chunkPageOffsets,
  dedupeById,
  PAGE_FETCH_CONCURRENCY,
  planPageOffsets,
} from "@/lib/pagination/page-plan";
```

and add, next to `MAX_PAGE_SIZE`:

```ts
/**
 * Trần số DÒNG một lượt nạp danh sách lead được phép kéo về. Theo DÒNG chứ
 * không theo TRANG: trần "N trang" thực chất là "N × trần của server", mà chính
 * lý do planPageOffsets tồn tại là server có thể trả trang nhỏ hơn ta xin.
 * Khớp `SUMMARY_MAX_ROWS` của src/app/api/leads/overview/route.ts.
 */
const LEAD_MAX_ROWS = 20_000;
```

Then fix the three call sites in `fetchAllLeads`: `planLeadPageOffsets(` → `planPageOffsets(`, `LEAD_PAGE_FETCH_CONCURRENCY` → `PAGE_FETCH_CONCURRENCY`, `dedupeLeadsById(` → `dedupeById(`.

- [ ] **Step 3: Verify nothing else referenced the old module**

```bash
cd agent-portal
grep -rn "leads/page-plan\|planLeadPageOffsets\|dedupeLeadsById\|LEAD_PAGE_FETCH_CONCURRENCY" src/
```
Expected: **no output**.

```bash
npx tsc --noEmit 2>&1 | tail -3
npx vitest run src/lib/pagination src/lib/leads 2>&1 | tail -6
```
Expected: `tsc` silent; every pagination test (11) and every leads test still passes. This step is the whole safety net for the move — the leads list is live in production, so a regression here is a live regression.

- [ ] **Step 4: Commit**

```bash
cd agent-portal
git add -A src/lib/pagination src/lib/leads
git commit -m "refactor(pagination): share the page-plan helpers outside lib/leads

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Page `fetchTasksForActor`

**Files:**
- Modify: `src/lib/tasks/queries.ts`
- Modify: `src/lib/tasks/queries.test.ts`

**Interfaces:**
- Consumes: `planPageOffsets`, `chunkPageOffsets`, `dedupeById`, `PAGE_FETCH_CONCURRENCY` from `@/lib/pagination/page-plan`.
- Produces: `fetchTasksForActor(actor)` now returns `Promise<{ tasks: TaskRow[]; total: number; truncated: boolean }>` instead of `Promise<TaskRow[]>`. Task 3 updates the three callers.
- Produces: `export const TASK_MAX_ROWS = 20_000;` and `export const TASK_PAGE_SIZE = 1000;`

**The structural problem this task solves.** Today the query is built once as a mutable `query` variable and awaited once. To page it, the same query must be rebuildable at different offsets. Complicating it: there are **two** query shapes (`TASK_COLUMNS` and `TASK_COLUMNS_LEGACY`) and the scope `.or(...)` is assembled inline for the first shape but by a separate `buildWorkerTaskOrs()` helper for the second — i.e. the OR logic is already duplicated in the file. Extracting one builder removes that duplication as a side effect.

**About the legacy fallback.** `isMissingTaskCustomValuesColumn` exists for a deployment whose `tasks` table predates the `custom_values` column. Production **has** that column (verified: a production select over the full `TASK_COLUMNS` list including `custom_values` succeeded). The fallback is therefore cold. **This plan leaves it single-shot and keeps `assertTaskListComplete` guarding it** — that keeps `assertTaskListComplete` and `TaskListTruncatedError` live (their tests at `queries.test.ts:103-119` keep passing unchanged) and avoids paging a code path that cannot be exercised.

- [ ] **Step 1: Extract a query builder**

In `src/lib/tasks/queries.ts`, add above `fetchTasksForActor`:

```ts
export const TASK_PAGE_SIZE = 1000;

/**
 * Trần số DÒNG một lượt nạp bảng task. Theo DÒNG chứ không theo TRANG — trần
 * "N trang" thực chất là "N × trần của server", và trần server có thể đổi.
 * Khớp cách lib/leads và /api/leads/overview đang chặn.
 *
 * Ở tốc độ 9,4 task/ngày (đo 2026-09-04) thì 20.000 là khoảng 6 năm.
 */
export const TASK_MAX_ROWS = 20_000;

type TaskQueryShape = {
  columns: string;
  scopedOrs: string[] | null;
};

/**
 * Dựng lại đúng một truy vấn cho một trang. Phải là HÀM chứ không phải một biến
 * `query` dùng lại được: mỗi trang cần một `.range()` khác, và builder của
 * Supabase là mutable nên tái sử dụng một instance sẽ cộng dồn bộ lọc.
 *
 * `count: "exact"` CHỈ xin ở trang đầu. Xin ở mọi trang là chạy lại một
 * COUNT(*) trên toàn bộ tập đã lọc cho mỗi trang — cùng một câu trả lời, trả
 * tiền nhiều lần.
 */
function buildTaskQuery(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  shape: TaskQueryShape,
  offset: number,
  withCount: boolean,
) {
  let query = supabase
    .from("tasks")
    .select(shape.columns, withCount ? { count: TASK_LIST_COUNT_MODE } : {})
    .is("archived_at", null)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .range(offset, offset + TASK_PAGE_SIZE - 1);
  if (shape.scopedOrs) {
    query =
      shape.scopedOrs.length > 0
        ? query.or(shape.scopedOrs.join(","))
        : query.eq("id", "00000000-0000-0000-0000-000000000000");
  }
  return query;
}
```

> The `.eq("id", "0000…")` branch reproduces the existing "no scope means see nothing" behaviour at `queries.ts:85` and `:105`. It must be preserved exactly — it is a fail-closed, and dropping it would show an unscoped user the entire company queue.

- [ ] **Step 2: Add the paging loop**

Still in `src/lib/tasks/queries.ts`, add:

```ts
/**
 * Nạp mọi trang của một truy vấn task: trang đầu đi một mình (nó giữ
 * `count: exact` và cho biết `total`), các trang sau đi song song theo chùm.
 *
 * Bước nhảy theo số dòng trang đầu THỰC SỰ trả về, không theo TASK_PAGE_SIZE —
 * xem chú thích của planPageOffsets: server có trần riêng, và một kế hoạch dựng
 * theo con số ta yêu cầu sẽ bỏ lọt im lặng cả một khoảng dòng.
 */
async function fetchAllTaskPages(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  shape: TaskQueryShape,
): Promise<{
  rows: unknown[];
  total: number;
  truncated: boolean;
  error: { code?: string; message?: string } | null;
}> {
  const first = await buildTaskQuery(supabase, shape, 0, true);
  if (first.error) {
    return { rows: [], total: 0, truncated: false, error: first.error };
  }
  const firstRows = (first.data ?? []) as unknown[];
  const total = first.count ?? firstRows.length;

  const offsets = planPageOffsets(firstRows.length, total, TASK_MAX_ROWS);
  const rest: unknown[] = [];
  for (const chunk of chunkPageOffsets(offsets, PAGE_FETCH_CONCURRENCY)) {
    const pages = await Promise.all(
      chunk.map(async (offset) => {
        // Thử lại đúng một lần: trước đây cả lượt nạp là MỘT truy vấn, giờ là
        // nhiều, nên xác suất "ít nhất một cái hỏng" cao hơn hẳn — và một trang
        // hỏng thì cả server component chết.
        const attempt = await buildTaskQuery(supabase, shape, offset, false);
        if (!attempt.error) return attempt;
        return buildTaskQuery(supabase, shape, offset, false);
      }),
    );
    for (const page of pages) {
      if (page.error) {
        return { rows: [], total, truncated: false, error: page.error };
      }
      rest.push(...((page.data ?? []) as unknown[]));
    }
  }

  const rows = dedupeById([...firstRows, ...rest] as { id: string }[]);
  return {
    rows,
    total,
    // Chạm trần TASK_MAX_ROWS, hoặc mất dòng do có người chèn giữa lượt phân
    // trang. Cả hai đều là "màn hình đang thiếu", và cả hai đều phải nói ra.
    truncated: firstRows.length > 0 && rows.length < total,
    error: null,
  };
}
```

- [ ] **Step 3: Rewrite `fetchTasksForActor` to use it**

Replace the body of `fetchTasksForActor` from the `let query = supabase…` line through `if (queryError) throw new Error(queryError.message);` with the version below. **Everything after that point — `attachAssigneesToTasks`, the `workerScope` visibility filter, `attachTaskListMetadata` — stays exactly as it is**, only the return shape changes.

```ts
export async function fetchTasksForActor(
  actor: TaskActor
): Promise<{ tasks: TaskRow[]; total: number; truncated: boolean }> {
  const supabase = getSupabaseAdmin();

  let workerScope: {
    agents: string[];
    assistantAgents: string[];
    assignedIds: string[];
    participantIds: string[];
  } | null = null;
  let seeAll = actor.isManager;
  if (!actor.isManager) {
    const scope = await resolveTaskQueueScope(actor);
    seeAll = scope.seesAllTasks;
    if (!seeAll) {
      const [assignedIds, participantIds] = await Promise.all([
        fetchAssignedTaskIdsForEmail(actor.email, supabase),
        fetchParticipantTaskIds(actor.email),
      ]);
      workerScope = {
        agents: scope.agentEmails,
        assistantAgents: scope.assistantAgentEmails,
        assignedIds,
        participantIds,
      };
    }
  }

  // Một chỗ dựng mệnh đề phạm vi cho cả truy vấn chính lẫn nhánh legacy. Trước
  // đây nó được viết hai lần — inline ở trên và trong buildWorkerTaskOrs — nên
  // hai bản có thể trôi lệch nhau mà không ai thấy.
  const scopedOrs = seeAll ? null : buildWorkerTaskOrs(actor.email, workerScope);

  let page = await fetchAllTaskPages(supabase, {
    columns: TASK_COLUMNS,
    scopedOrs,
  });

  if (isMissingTaskCustomValuesColumn(page.error)) {
    // Nhánh tương thích cho DB chưa có cột custom_values. Production ĐÃ có cột
    // này (kiểm 2026-09-04), nên nhánh này nguội — giữ nguyên kiểu một-phát và
    // giữ assertTaskListComplete canh, không phân trang một đường không chạy.
    let fallback = supabase
      .from("tasks")
      .select(TASK_COLUMNS_LEGACY, { count: TASK_LIST_COUNT_MODE })
      .is("archived_at", null)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (scopedOrs) {
      fallback =
        scopedOrs.length > 0
          ? fallback.or(scopedOrs.join(","))
          : fallback.eq("id", "00000000-0000-0000-0000-000000000000");
    }
    const fallbackResult = await fallback;
    assertTaskListComplete(
      fallbackResult.data as unknown[] | null,
      fallbackResult.count,
    );
    page = {
      rows: (fallbackResult.data ?? []) as unknown[],
      total: fallbackResult.count ?? 0,
      truncated: false,
      error: fallbackResult.error as { code?: string; message?: string } | null,
    };
  }

  if (page.error) throw new Error(page.error.message ?? "Could not load tasks.");

  const tasks = await attachAssigneesToTasks(
    (page.rows as unknown as TaskRow[]).map((task) => ({
      ...task,
      custom_values: task.custom_values ?? {},
    })),
    supabase,
    { currentEmail: actor.email }
  );

  if (!workerScope) {
    return {
      tasks: await attachTaskListMetadata(tasks, supabase),
      total: page.total,
      truncated: page.truncated,
    };
  }

  const participantIdSet = new Set(workerScope.participantIds);
  const visibleTasks = tasks
    .map((task) => ({
      ...task,
      viewer_is_participant: participantIdSet.has(task.id),
    }))
    .filter((task) => {
      const effectiveAssigneeEmail = task.assignees[0] ?? task.assignee_email;
      return canViewTask(actor, { assignee_email: effectiveAssigneeEmail }, {
        isAssignee:
          task.assignees.includes(actor.email) ||
          task.assignee_email === actor.email,
        isAgentMember: Boolean(
          task.agent_email && workerScope.agents.includes(task.agent_email)
        ),
        isAgentOwner: Boolean(
          task.agent_email &&
            (task.agent_email === actor.email ||
              workerScope.assistantAgents.includes(task.agent_email))
        ),
        isParticipant: task.viewer_is_participant,
        isReporter: task.reporter_email === actor.email,
      });
    });

  return {
    tasks: await attachTaskListMetadata(visibleTasks, supabase),
    total: page.total,
    truncated: page.truncated,
  };
}
```

> **Note for the reviewer:** `total` here is the count of rows the *SQL* matched, before the Node-side `canViewTask` filter for scoped workers. The board's own "N tasks" display is computed client-side from the array, so this `total` is used only to decide `truncated`. Flag it if you think exposing it invites misuse.

- [ ] **Step 4: Extend the tests**

`src/lib/tasks/queries.test.ts` already has a `describe("fetchTasksForActor view scope", …)` block (line 130) with a `loadFetchTasksForActor` harness that stubs Supabase and records `.or()` calls. Read that harness before writing — it is the only existing way this function is tested.

Add to that block:

```ts
  it("asks for an exact count on the first page only", async () => {
    // Trang đầu là trang DUY NHẤT được xin count: exact. Xin ở mọi trang là
    // chạy lại COUNT(*) trên toàn bộ tập đã lọc cho từng trang.
    const { fetchTasksForActor, selectCalls } = await loadFetchTasksForActor({
      /* same options the neighbouring tests use */
    });
    await fetchTasksForActor({ email: "mgr@x.com", isManager: true } as never);
    const withCount = selectCalls.filter(([, opts]) => opts?.count === "exact");
    expect(withCount).toHaveLength(1);
  });

  it("still fails closed for an actor with no scope at all", async () => {
    // `.eq("id", "0000…")` là cổng fail-closed: mất nó thì một người không có
    // phạm vi nào lại nhìn thấy toàn bộ hàng đợi công ty.
    const { fetchTasksForActor, eqCalls } = await loadFetchTasksForActor({
      /* actor with empty scope */
    });
    await fetchTasksForActor({ email: "nobody@x.com", isManager: false } as never);
    expect(eqCalls).toContainEqual(["id", "00000000-0000-0000-0000-000000000000"]);
  });
```

The harness currently records only `.or()` calls; extend it to also record `.select()` options and `.eq()` args. Keep the existing `assertTaskListComplete` tests (`queries.test.ts:103-119`) **unchanged** — the fallback path still uses it.

- [ ] **Step 5: Verify**

```bash
cd agent-portal
npx tsc --noEmit 2>&1 | tail -3      # will list the 3 callers as errors until Task 3
npx vitest run src/lib/tasks 2>&1 | tail -6
```
Expected: the only `tsc` errors are the three caller files from Task 3. All `src/lib/tasks` tests pass.

- [ ] **Step 6: Commit** (together with Task 3 — the tree does not typecheck in between)

---

### Task 3: Update the three callers

**Files:**
- Modify: `src/app/(authed)/tasks/page.tsx`
- Modify: `src/app/api/tasks/route.ts`
- Modify: `src/app/api/tasks/export/route.ts`

- [ ] **Step 1: Board page**

`src/app/(authed)/tasks/page.tsx:39-67` destructures a `Promise.all`, with `tasks` as the first element:

```ts
  const [
    tasks,
    assignees,
    …
  ] = await Promise.all([
    fetchTasksForActor(actor),
    …
  ]);
```

Change the first element to `taskPage` and derive from it:

```ts
  const [
    taskPage,
    assignees,
    …
  ] = await Promise.all([
    fetchTasksForActor(actor),
    …
  ]);
  const tasks = taskPage.tasks;
```

Then pass the flag to the client component (the prop is added in Task 5):

```tsx
      initialTasksTruncated={taskPage.truncated}
```

Everything downstream that reads `tasks` keeps working unchanged.

- [ ] **Step 2: Tasks API**

`src/app/api/tasks/route.ts:84-99`:

```ts
    const tasks = await timing.measure("tasks", async () =>
      fetchTasksForActor(actor),
    );
    return respond({ tasks });
  } catch (error) {
    if (error instanceof TaskListTruncatedError) { … 503 … }
```

becomes:

```ts
    const page = await timing.measure("tasks", async () =>
      fetchTasksForActor(actor),
    );
    // Trước đây quá trần là 503 và bảng không tải được gì. Nay trả về những gì
    // nạp được kèm cờ truncated — thiếu một phần và NÓI RA vẫn dùng được hơn là
    // không có gì. Nhánh 503 dưới đây chỉ còn phục vụ đường legacy.
    return respond({ tasks: page.tasks, truncated: page.truncated });
  } catch (error) {
    if (error instanceof TaskListTruncatedError) { … 503 unchanged … }
```

Keep the `TaskListTruncatedError` catch: the legacy fallback path can still throw it.

- [ ] **Step 3: Export route**

`src/app/api/tasks/export/route.ts:62-72` — same shape as the board page:

```ts
  const [taskPage, columns, customOptions, categories, assignees, agents] =
    await Promise.all([
      fetchTasksForActor(actorResult.actor),
      …
    ]);
  const tasks = taskPage.tasks;
```

**And add a guard the export did not have before.** A CSV that silently omits rows is worse than a failed export — the file leaves the building and nobody can tell it is short:

```ts
  if (taskPage.truncated) {
    return NextResponse.json(
      {
        error:
          `Chỉ nạp được ${taskPage.tasks.length} trên ${taskPage.total} task. ` +
          `Thu hẹp phạm vi rồi xuất lại.`,
      },
      { status: 503 },
    );
  }
```

- [ ] **Step 4: Verify and commit Tasks 2+3 together**

```bash
cd agent-portal
npx tsc --noEmit 2>&1 | tail -3
npx eslint src/lib/tasks/queries.ts "src/app/(authed)/tasks/page.tsx" src/app/api/tasks/route.ts src/app/api/tasks/export/route.ts; echo "exit $?"
npx vitest run 2>&1 | tail -5
npx next build 2>&1 | grep -iE "compiled|failed|error" | head
```
Expected: `tsc` silent, eslint exit 0, all tests pass, `✓ Compiled successfully`.

```bash
git add src/lib/tasks/queries.ts src/lib/tasks/queries.test.ts \
  "src/app/(authed)/tasks/page.tsx" src/app/api/tasks/route.ts src/app/api/tasks/export/route.ts
git commit -m "perf(tasks): page the task list instead of failing closed at 1000 rows

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Bound the metadata fan-out

**Files:** `src/lib/tasks/queries.ts` (`fetchTaskListMetadata`, lines ~223-271)

**The problem.** After the tasks load, `attachTaskListMetadata` calls `fetchTaskListMetadata(ids)`, which chunks ids by `TASK_METADATA_TASK_ID_CHUNK_SIZE = 50` and then:

```ts
  const rpcResults = await Promise.all(
    chunkValues(ids, TASK_METADATA_TASK_ID_CHUNK_SIZE).map((chunk) =>
      supabase.rpc("task_list_metadata", { task_ids: chunk }),
    ),
  );
```

`Promise.all` over **every** chunk. At 141 tasks that is 3 concurrent RPCs — invisible. At 2.000 tasks it is **40 concurrent RPCs**, each running two correlated subqueries per id (`supabase/schema.sql:2212-2241`), against a PostgREST connection pool that is 10 on a small instance. This is exactly the unthrottled fan-out an independent review flagged in the Leads plan this morning; it is being fixed here before it ships rather than after.

The same unbounded `Promise.all` appears three more times in the legacy fallback helpers `fetchTaskActorRows`, `fetchTaskCommentRows`, `fetchTaskAttachmentRows` (lines ~277-340). Those only run when the RPC is missing.

- [ ] **Step 1: Bound the primary RPC path**

```ts
const TASK_METADATA_CONCURRENCY = 6;

// … inside fetchTaskListMetadata, replacing the Promise.all above:
  const chunks = chunkValues(ids, TASK_METADATA_TASK_ID_CHUNK_SIZE);
  const rpcResults: Awaited<ReturnType<typeof supabase.rpc>>[] = [];
  for (let index = 0; index < chunks.length; index += TASK_METADATA_CONCURRENCY) {
    rpcResults.push(
      ...(await Promise.all(
        chunks
          .slice(index, index + TASK_METADATA_CONCURRENCY)
          .map((chunk) => supabase.rpc("task_list_metadata", { task_ids: chunk })),
      )),
    );
  }
```

`TASK_METADATA_TASK_ID_CHUNK_SIZE` stays **50** deliberately: `queries.test.ts:95-97` asserts no RPC call carries more than 50 ids, and that assertion is testing the bounding behaviour, not the number. Raising it is a valid follow-up lever (200 ids → 10 chunks instead of 40) but it should come with a measurement of the RPC's cost at that size, not a guess. Note it, do not do it here.

- [ ] **Step 2: Same treatment for the three legacy helpers**

Apply the identical loop to `fetchTaskActorRows`, `fetchTaskCommentRows` and `fetchTaskAttachmentRows`. A small local helper avoids writing the loop four times:

```ts
/** Chạy `run` trên từng chùm, tối đa `size` chùm cùng lúc. */
async function mapWithConcurrency<T, R>(
  items: T[],
  size: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let index = 0; index < items.length; index += size) {
    results.push(
      ...(await Promise.all(items.slice(index, index + size).map(run))),
    );
  }
  return results;
}
```

- [ ] **Step 3: Verify and commit**

```bash
cd agent-portal
npx vitest run src/lib/tasks/queries.test.ts 2>&1 | tail -5
npx tsc --noEmit 2>&1 | tail -3
git add src/lib/tasks/queries.ts
git commit -m "perf(tasks): bound the task metadata fan-out instead of one Promise.all

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Surface truncation, and the changelog

**Files:**
- Modify: `src/app/(authed)/tasks/_components/TaskBoardClient.tsx`
- Modify: `agent-portal/changelog.md`

- [ ] **Step 1: Accept and store the flag**

Add `initialTasksTruncated?: boolean` to `TaskBoardClient`'s props (Task 3 Step 1 already passes it), default `false`, and hold it in state so a refetch can update it:

```ts
  const [tasksTruncated, setTasksTruncated] = useState(initialTasksTruncated ?? false);
```

In the refetch at `TaskBoardClient.tsx:462-471`, the response now carries the flag:

```ts
          const data = (await res.json()) as { tasks?: TaskRow[]; truncated?: boolean };
          …
          setTasksTruncated(data.truncated === true);
```

- [ ] **Step 2: Render a banner**

Place it next to the existing `error` banner (find where `error` is rendered and follow that markup exactly so it inherits the board's spacing):

```tsx
      {tasksTruncated ? (
        <div className="mx-auto flex max-w-[1760px] items-start gap-2 rounded border border-[#ffc400] bg-[#fffae6] px-4 py-2.5 text-sm font-semibold text-[#974f0c]">
          <span>
            Danh sách task đã chạm trần một lượt nạp — màn hình đang thiếu một
            phần. Báo cho quản trị viên; đây là dấu hiệu cần phân trang sâu hơn.
          </span>
        </div>
      ) : null}
```

- [ ] **Step 3: Changelog**

```markdown
## 2026-09-04 — Tasks: bảng task hết sập khi vượt 1.000 dòng

- **Loại**: fix (bảng không tải được) + perf. **Không đổi hành vi nhìn thấy được.**
- `fetchTasksForActor` gọi MỘT `.select()` không `.range()`. PostgREST của dự án
  cắt mọi phản hồi ở 1.000 dòng (đo 2026-09-04), và `assertTaskListComplete` cố
  ý `throw` khi số dòng nhận về ít hơn `count`. Ở task active thứ 1.001:
  `/tasks` chết ngay trong server component (không ai mở được bảng), export trả
  500. Đo được: 141 task active, 9,4 task/ngày → chạm mốc sau ~92 ngày.
- Nay phân trang: trang đầu đi một mình (nó giữ `count: exact`), các trang sau
  đi song song theo chùm 4, mỗi trang thử lại một lần. Bước nhảy theo số dòng
  trang đầu THỰC SỰ trả về chứ không theo con số yêu cầu — trần server thấp hơn
  thì kế hoạch song song dựng theo con số yêu cầu sẽ bỏ lọt im lặng cả một
  khoảng dòng. Kết quả khử trùng theo id.
- Trần mới `TASK_MAX_ROWS = 20.000`, tính theo DÒNG chứ không theo TRANG (trần
  theo trang thực chất là "N × trần server", đổi theo cấu hình server). Chạm
  trần thì hiện banner chứ không sập; export thì TỪ CHỐI xuất, vì một file CSV
  thiếu dòng mà không ai biết là thiếu thì tệ hơn một lần xuất hỏng.
- `fetchTaskListMetadata` chạy `Promise.all` trên MỌI chùm 50 id: 3 truy vấn
  song song ở 141 task, nhưng 40 ở 2.000 task, mỗi cái hai subquery tương quan
  mỗi id, vào một pool 10 kết nối. Nay giới hạn 6 chùm cùng lúc.
- KHÔNG archive task done, KHÔNG đẩy bộ lọc ngày xuống server. Cả hai đều lấy
  đi thứ gì đó (archive làm task biến mất khỏi Search; lọc theo ngày làm task
  ngoài khoảng không còn nạp) rồi phải xây thêm để bù. Phân trang không lấy đi
  gì cả.
```

- [ ] **Step 4: Verify and commit**

```bash
cd agent-portal
npx tsc --noEmit 2>&1 | tail -3
npx eslint "src/app/(authed)/tasks/_components/TaskBoardClient.tsx"; echo "exit $?"
npx vitest run 2>&1 | tail -5
npx next build 2>&1 | grep -iE "compiled|failed|error" | head
git add "src/app/(authed)/tasks/_components/TaskBoardClient.tsx" changelog.md
git commit -m "feat(tasks): say so when the task list hits its load ceiling

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## 6. Why this shape, and the mistake it avoids

An independent review of the Event Leads plan this morning caught a blocker worth restating, because this plan is built on the same helpers:

> The first draft bounded the parallel fan-out at `MAX_PARALLEL_PAGES = 12`. That is a bound of "12 × whatever the server ceiling turns out to be" — 13.000 rows at 1.000/page, but only **2.600** at 200/page, *below the volume the plan was written for*. And nothing reported the cut, so the page header (untruncated `total`) and the toolbar (truncated array length) would silently contradict each other.

Hence: **`TASK_MAX_ROWS = 20_000` in rows**, and `truncated` reported at three levels (banner, API field, export refusal).

---

## 7. Manual verification

No component in this repo can be unit-tested (`environment: "node"`), and the paging path needs a real database, so these are the checks that actually matter. Run against `/tasks`:

1. **The board looks identical.** Same task count as before the change, same order, same grouping. Compare the "N tasks" number against `select count(*) from tasks where archived_at is null`.
2. **Filters still switch instantly** — Network tab shows **no** request when changing date range, status, agent, category or priority.
3. **A scoped user still sees only their own scope.** Log in as (or impersonate) an agent, not a manager, and confirm the task count is smaller than a manager's. This is the check that catches a broken `.or()` rebuild — the highest-severity way this change could go wrong, because the failure mode is *showing too much*, not too little.
4. **Export still produces the same rows.**
5. **The one path worth simulating:** temporarily set `TASK_PAGE_SIZE = 50` locally and reload. The board must show **exactly the same tasks** as with 1000 — this exercises the multi-page assembly at today's 141-row volume, which is otherwise a single page and would never be tested. Revert afterwards.

Check 5 is the important one. Without it, nothing in this change is exercised until production crosses 1.000 tasks.

---

## 8. What I deliberately did NOT do — push back on any of these

1. **No archiving of done tasks.** 99 of 141 active tasks are `done`; archiving those older than 7 days would drop the board to 85 and is cheap. Rejected because: `src/lib/tasks/search.ts:196` filters `archived_at is null`, so **archived tasks stop being findable by search**; 16 of 162 tasks (10%) have been reopened at least once; and there is **no unarchive path anywhere in the app** (grep: the only `archived_at: null` writes are for table-config columns). It also needs a scheduled job. Pagination solves the same problem without taking anything away.
2. **No server-side date filtering.** Would bound the board permanently, but changing the date filter would then need a round-trip, and any window the user picks that reaches past what is loaded would silently show less. Measured payload does not justify it: 0,75 MB gzipped at 2.000 tasks, versus ~0,8 MB for the Leads list already shipped.
3. **No windowing of `TaskListView`.** `TaskListView` and `TaskRowItem` have no `React.memo` and no virtualization — at 2.000 tasks that is ~30.000 mounted components. This is a real cost, but it is a *rendering* cost that makes the board slow, not a *crash*. It is the natural next plan, and `@tanstack/react-virtual` is already a dependency from this morning's Leads work. Deliberately out of scope so this change stays "no visible behaviour change".
4. **`TASK_METADATA_TASK_ID_CHUNK_SIZE` stays 50**, only the concurrency is bounded. Raising it to 200 would cut 40 RPC round-trips to 10, but it changes what the RPC does per call and there is an existing test asserting ≤50. Wants a measurement first.
5. **The legacy `custom_values` fallback is left un-paged.** Production has the column, so the branch is cold. Paging it would mean maintaining two paged paths for one that cannot run.

**Questions I would like a reviewer to answer:**

- **Is moving `page-plan.ts` to `src/lib/pagination/` worth the risk?** It touches the Leads list, which went live in production hours ago. The alternative — `lib/tasks` importing from `lib/leads` — is worse layering but zero risk to a live path. I chose the move; say if you disagree.
- **Is returning `total` from `fetchTasksForActor` a trap?** For a scoped worker it is the pre-`canViewTask` SQL count, so it is larger than the array. It is only used to compute `truncated`, but it is exported and someone will eventually display it.
- **Should the API keep returning 503 on the legacy truncation path**, now that the main path returns partial data plus a flag? Two different behaviours for "the list is short" may be one too many.
- **Is `TASK_MAX_ROWS = 20_000` right?** At 9,4 tasks/day it is ~6 years. It also caps the payload near 26 MB raw, which is far past what the browser should be handed — arguably the ceiling should be lower (5.000?) precisely so the banner appears *before* the board becomes unusable, rather than after.
