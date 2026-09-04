# Task List Pagination — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **For a reviewer:** Section 1 is the context; §2–§3 the evidence; §9 and §11 are two rounds of [codex] review; **§12 is the only executable section.**
>
> **⛔ §5–§8 ARE A REJECTED DRAFT — DO NOT EXECUTE THEM.** They contain working code snippets for an approach review rejected (parallel OFFSET, `position` ordering, a 20.000 cap, unconditional retry, moving the live Leads helper). They are kept only so the review trail reads in order. Everything executable lives in §12.

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

## 5. [REJECTED DRAFT — DO NOT EXECUTE] File Structure

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

---

## 9. [codex] Review — changes requested

**[codex] Kết luận:** plan này là một hotfix hợp lý cho trần PostgREST 1.000
dòng, nhưng chưa phải giải pháp pagination/scale hoàn chỉnh. Nó vẫn tải, enrich,
truyền sang browser và render toàn bộ active task. Vì vậy plan hiện tại có thể làm
`/tasks` hết hard-crash ở dòng 1.001 nhưng chưa đạt mục tiêu "scale lên mà không
chậm". Không nên triển khai nguyên trạng dưới tên một giải pháp scale hoàn chỉnh.

### [codex] Blockers và high-risk findings

1. **[codex][blocker] Đây vẫn là full-load, không phải pagination theo viewport.**
   `fetchAllTaskPages` chỉ chia một lần tải toàn bộ thành nhiều request rồi ghép lại
   trước khi trả response. `TaskBoardClient` tiếp tục gọi `/api/tasks` cho realtime,
   reconnect, focus và polling (60 giây khi live, 15 giây khi degraded). Ở quy mô
   lớn, một thay đổi nhỏ vẫn khiến server đọc và enrich lại toàn bộ danh sách.

   **[codex][solution]** Tách rõ hai mục tiêu:
   - Phase hotfix: page toàn bộ để bỏ crash ở mốc 1.000.
   - Phase scale: API cursor pagination có `limit`, `cursor` và server-side filters;
     realtime cập nhật theo `taskId` thay vì full snapshot; periodic reconcile chỉ
     tải lại query/page đang xem.

2. **[codex][blocker] List và Board vẫn mount toàn bộ task.** `TaskListView` dùng
   `rows.map(...)`; Kanban dùng `tasks.map(...)` bên trong `SortableContext`. Plan
   cũng tự ước tính 2.000 task có thể tạo khoảng 30.000 mounted components nhưng
   lại để windowing ngoài scope. Đây là blocker performance, không chỉ là một tối
   ưu tùy chọn.

   **[codex][solution]** Thêm virtualization cho List trong cùng chương trình scale.
   Board cần window/load-more theo từng column và phải kiểm tra tương tác drag/drop
   với item chưa mount. Nếu chưa làm được Board virtualization trong hotfix, đặt
   một giới hạn hiển thị có thông báo rõ ràng thay vì mount hàng nghìn card.

3. **[codex][high] Task 4 bỏ sót fan-out của assignee.** Trước metadata,
   `attachAssigneesToTasks` gọi `fetchTaskAssigneeRowsForTaskIds`; hàm này cũng chia
   50 ids/chunk rồi chạy `Promise.all` trên tất cả chunks. 2.000 task tạo 40 query
   đồng thời; 20.000 task tạo 400 query đồng thời.

   **[codex][solution]** Áp dụng cùng concurrency helper cho cả assignee và metadata,
   có unit test chứng minh số request in-flight không vượt giới hạn. Tốt hơn ở phase
   scale là trả assignee và metadata cùng page từ một SQL function/view thay vì hai
   vòng fan-out riêng.

4. **[codex][high] Thiếu index khớp query phân trang.** Query lọc
   `archived_at is null` rồi order theo `(position, created_at, id)`, trong khi schema
   chỉ có index riêng cho `archived_at` và `(status, position)`. Offset càng sâu càng
   phải scan/sort và bỏ qua nhiều dòng.

   **[codex][solution]** Thêm migration cho partial composite index khớp filter/order,
   ví dụ `(position, created_at, id) where archived_at is null`, sau đó lưu kết quả
   `EXPLAIN (ANALYZE, BUFFERS)` ở 1.000/5.000/20.000 rows trước khi chốt index.

5. **[codex][high] Scope filter có thể vượt giới hạn URL.** Worker scope lấy toàn bộ
   `assignedIds` và `participantIds`, rồi nhét vào `.or(id.in.(...))`. Khi lịch sử
   tham gia/được assign tăng, request có thể lỗi 414/431 trước khi task table chạm
   `TASK_MAX_ROWS`; cùng chuỗi filter lớn còn bị gửi lại ở từng page.

   **[codex][solution]** Chuyển visibility scope vào SQL RPC/view và join trực tiếp
   với `task_assignees`/`task_participants`. Không đưa một danh sách UUID tăng không
   giới hạn vào query string.

6. **[codex][high] Offset trên một thứ tự mutable không cho snapshot đáng tin cậy.**
   `position` thay đổi khi kéo task. Trong lúc các page chạy song song, một task có
   thể bị lặp hoặc bị bỏ sót. Dedupe chỉ bỏ được bản trùng, không thể khôi phục row
   bị miss; `rows.length === total` cũng không chứng minh hai tập dữ liệu giống nhau
   nếu insert/delete/move bù trừ nhau.

   **[codex][solution]** Dùng cursor/keyset với thứ tự ổn định hoặc một database
   snapshot. Nếu vẫn dùng offset cho hotfix, khi count/dedupe không khớp phải retry
   toàn bộ snapshot một lần rồi fail/warn rõ ràng; không xem realtime là cơ chế bảo
   đảm correctness.

7. **[codex][high] Bounding metadata concurrency chỉ giảm spike, không giảm tổng
   workload.** Với chunk 50, 20.000 task vẫn tạo 400 RPC calls; mỗi call chạy hai
   correlated count subqueries cho từng task.

   **[codex][solution]** Chỉ enrich page đang hiển thị, hoặc trả metadata bằng một
   aggregate query theo page. Phương án dài hạn là duy trì `comment_count` và
   `attachment_count` bằng mutation/trigger để list không phải đếm lại toàn bộ ở
   mỗi lần refresh.

8. **[codex][medium] `TASK_MAX_ROWS = 20_000` quá cao so với client architecture
   hiện tại.** Khoảng 26 MB raw chưa gồm overhead của RSC/JSON, object allocations,
   metadata, assignees và DOM. Đây là mức mà app có thể timeout hoặc treo browser
   trước khi banner truncation xuất hiện. Ngoài ra helper chưa bảo đảm cap chính
   xác nếu server page size thực tế không chia hết cho `maxRows`, vì page cuối vẫn
   dùng range theo `TASK_PAGE_SIZE`.

   **[codex][solution]** Trong hotfix dùng ceiling an toàn hơn (đề xuất bắt đầu ở
   5.000 nhưng phải chốt bằng benchmark), và giới hạn `to = min(offset + pageSize,
   maxRows) - 1` cho page cuối. Phase scale không nên dựa vào một all-load ceiling.

9. **[codex][medium] Retry hiện tại retry mọi lỗi ngay lập tức.** Lỗi quyền, schema,
   query hoặc request 4xx là lỗi permanent; retry chỉ nhân đôi tải và độ trễ.

   **[codex][solution]** Chỉ retry network error/timeout/5xx/429, tối đa một lần với
   backoff + jitter. Trả nguyên lỗi non-transient ngay lần đầu.

10. **[codex][medium] Test plan chưa kiểm tra đường pagination thật.** Hai test được
    đề xuất chỉ kiểm tra first-page exact count và fail-closed scope. Chúng không
    chứng minh page assembly, boundary, cap, retry, dedupe, stable order, scope trên
    mọi page hoặc concurrency limit.

    **[codex][solution]** Bổ sung test cho:
    - nhiều page với server cap nhỏ hơn requested page size;
    - page cuối và strict row ceiling;
    - duplicate/missing row detection;
    - transient retry và permanent error không retry;
    - cùng scope predicate trên mọi page;
    - max in-flight của metadata **và assignee**;
    - API/page/export contract khi `truncated`.

11. **[codex][medium] Không nên làm refactor Leads thành prerequisite của hotfix
    Tasks.** Move helper đang chạy production tạo thêm regression surface nhưng
    không góp phần giải quyết outage ở mốc 1.000.

    **[codex][solution]** Tạo generic helper mới kèm test và dùng cho Tasks trước.
    Migrate Leads sang helper shared ở một commit/PR độc lập sau khi hotfix ổn định.

### [codex] Revised execution plan

#### Phase A — hotfix an toàn trước mốc 1.000

- [ ] Giữ `assertTaskListComplete` cho đến khi multi-page tests pass.
- [ ] Page main query với strict row ceiling và chỉ retry transient error.
- [ ] Không refactor live Leads trong cùng hotfix.
- [ ] Bound concurrency cho cả metadata, legacy metadata và assignee fan-out.
- [ ] Thêm partial composite index và kiểm tra execution plan.
- [ ] Trả `truncated` nhất quán cho page/API; export phải fail closed.
- [ ] Thêm test multi-page, scope, cap, retry và concurrency.
- [ ] Benchmark end-to-end ở 1.000/2.000/5.000 active tasks trước khi deploy.

#### Phase B — scale thật sự

- [ ] Thiết kế `/api/tasks` theo cursor + server-side filters; initial page khoảng
      100–200 records thay vì toàn bộ active tasks.
- [ ] Virtualize Task List; thiết kế window/load-more cho từng Kanban column.
- [ ] Dùng delta endpoint/realtime payload theo task id; bỏ full-list refetch cho
      mỗi mutation, focus và broadcast.
- [ ] Enrich assignee + metadata theo page bằng một DB query/RPC; loại bỏ N-chunk
      fan-out khỏi normal list path.
- [ ] Chuyển worker visibility scope thành DB-side joins/RPC.
- [ ] Đặt performance budget và test ở 1k/5k/20k: TTFB/API p95, payload size,
      query count, DB time, React commit time và số mounted rows/cards.

### [codex] Approval condition

**[codex] Có thể approve Phase A sau khi findings 3, 4, 8, 9 và 10 được đưa vào
plan. Không được tuyên bố mục tiêu "scale không chậm" hoàn tất cho đến khi Phase B
xử lý full refetch, server-side pagination/filtering và DOM virtualization.**

---

## 10. Revised plan after review — SUPERSEDES §5–§8

Written 2026-09-04 after the [codex] review in §9 and a product decision from the owner.
**§5–§8 above are kept as history; build from this section.**

### 10.1 What changed and why

Two things invalidated the original plan:

1. **The goal moved.** The original goal was "stop crashing, change nothing a user
   sees". The owner has since restated it: *the board must still load smoothly at
   1.000 and 5.000 active tasks.* §9 finding 1 is correct — the original plan was a
   hotfix for the PostgREST cap, not a scale solution, and it should not have been
   presented as one.
2. **The owner chose instant filtering.** Asked whether changing a filter may cost a
   ~200 ms round-trip, the answer was **instant**. That rules out [codex]'s Phase B
   shape (cursor + server-side filters + 100–200 initial records): every filter
   change would become a request.

Those two together force a conclusion neither the original plan nor the review
stated: **the board must load a bounded window, and everything the user filters over
must be inside that window.**

### 10.2 The measurement that settles it

At 5.000 active tasks, **one** full load costs:

| | |
|---|---|
| Payload | 6,54 MB raw / 1,87 MB gzip |
| Task page queries | 5 |
| Metadata RPC calls (chunk 50) | 100 |
| Assignee queries (chunk 50) | 100 |
| **Total DB queries per load** | **205** |

And `TASK_LIVE_RECONCILE_MS = 60_000` (`src/lib/tasks/live-sync.ts:12`) makes every
visible tab repeat that every 60 seconds — a 5× more aggressive poll than the Leads
list, which sits at 300 s. With ~20 CS tabs open:

> **37 MB/min egress · 4.100 DB queries/min**

This is [codex] finding 7 expressed as a number: bounding concurrency flattens the
spike, it does not reduce the work. **No amount of DOM virtualization fixes this**,
because the cost is paid before a single row is rendered. The data volume itself has
to shrink.

### 10.3 Architecture: a bounded window that preserves instant filtering

**Always loaded, no date limit:** every task whose status is *not* `done`/`cancel`.
This is the working set. It is bounded by team capacity, not by history — 42 today,
and it stays flat as long as throughput matches the 9,4 tasks/day inflow. A task
opened three months ago and still `waiting` must always be visible, whatever date
range is selected.

**Plus, inside the selected date range:** `done`/`cancel` tasks by `closed_at`, and
any task with `done_reviewed_at IS NULL` regardless of age (QC still owes it — this
is exactly the `.or()` at `src/app/api/leads/../overview-data.ts:57-60`, already
established in this codebase).

**Stays instant (client-side, zero requests):** status, agent, assignee, category,
priority, quick filters, text search — the filters people flip constantly.

**Costs one request:** changing the date range. That control is semantically "how
much history do I want loaded", so it is the honest place to put the round-trip.

**Anything older:** `runTaskSearch` (`src/lib/tasks/search.ts`) is already a
server-side search across the whole table with no date limit, covering task titles,
comment bodies and attachment filenames, already on the toolbar. Nothing is deleted
and nothing becomes unreachable.

Steady-state board size: ~42 open + ~66 done in a 7-day window ≈ **110 rows**;
≈ **320 rows** with a 30-day window. Permanently, at any company size this product
reaches. That turns 205 queries/load into ~10 and 37 MB/min into ~2 MB/min.

> **Assumption to challenge before building Phase B:** that a round-trip on the date
> range only is acceptable. If the owner wants even that instant, the fallback is to
> load a fixed generous window (say 30 days of done) and offer an explicit
> "load older" button instead of making the date picker fetch.

### 10.4 Disposition of every [codex] finding

| # | [codex] finding | Decision |
|---|---|---|
| 1 | Still a full load, not real pagination | **Accepted.** Resolved by §10.3, not by cursors. |
| 2 | List and Kanban mount every task | **Accepted as Phase B blocker.** With a ~320-row window this is far less acute, but still done. |
| 3 | Assignee fan-out missed in Task 4 | **Accepted.** Verified at `src/lib/tasks/assignees.ts:331`. |
| 4 | Missing index for filter+order | **Accepted, simpler fix — see §10.5.** No composite index needed. |
| 5 | Scope UUID list may blow the URL (414/431) | **Accepted, and promoted into Phase A.** It is a Phase A correctness bug, not a Phase B concern. |
| 6 | Offset over mutable `position` can miss rows | **Accepted, simpler fix — see §10.5.** No cursor infrastructure needed. |
| 7 | Bounding concurrency ≠ less total work | **Accepted.** Quantified in §10.2; it is the argument for §10.3. |
| 8 | `TASK_MAX_ROWS = 20_000` too high; last-page overshoot | **Accepted.** Ceiling drops to 5.000 and the last page clamps to the ceiling. |
| 9 | Retry retries permanent errors | **Accepted.** |
| 10 | Test plan does not exercise paging | **Accepted.** |
| 11 | Do not make the Leads refactor a prerequisite | **Accepted.** Task 1 of §5 is dropped from Phase A; a new generic helper is written for tasks, and Leads migrates later in its own commit. |

**One inconsistency in the review:** its approval condition lists findings 3, 4, 8, 9,
10 but omits 5 and 6, which the same review labels `[high]` and which are correctness
bugs *in Phase A itself* — the review even notes that dedupe cannot recover a missed
row. Both are therefore in the Phase A gate below.

### 10.5 A simpler resolution for findings 4 and 6 than the review proposed

The review proposes cursor/keyset pagination because `position` is mutable
(drag-and-drop) and offset paging over a mutable order can duplicate or drop rows.
The premise is right. The remedy is heavier than it needs to be.

`src/app/(authed)/tasks/_components/TaskListView.tsx:112-117`:

```ts
  const ranked =
    sortKey === null
      ? managerView
        ? rankTasksForManager(tasks, rules, now)
        : rankTasks(tasks, rules, now)
      : sortTasks(tasks, sortKey, sortDir, categoryName);
```

**The client always re-ranks or re-sorts. The SQL ordering is never what the user
sees** — it only decides *which* rows come back, never the order they appear in.

So order the paged query by **`id` alone**: immutable, unique, and already the
primary key, so the index exists.

- Finding 6 disappears: dragging a task cannot shift another task's page.
- Finding 4 disappears: no `(position, created_at, id) where archived_at is null`
  composite index is needed; the PK ordering plus the existing `tasks_archived_idx`
  serves it.

**Verify before relying on this:** confirm nothing downstream depends on the SQL
order — in particular that `KanbanBoard.tsx` derives its card order from the
`position` *field* on each row rather than from array order. If it does depend on
array order, sort by `position` in Node after assembly (cheap at ≤ 5.000 rows)
rather than reintroducing it into the SQL.

### 10.6 Phase A — stop the crash. Ship first, alone.

Deadline is real: 141 active tasks, 9,4/day, ~92 days to the cap.
Phase A does **not** claim to meet the "smooth at 5.000" goal — it buys the room to
build Phase B properly.

- [ ] **A1.** New generic paging helper `src/lib/pagination/page-plan.ts` **written
      fresh with its own tests**. Do **not** move `src/lib/leads/page-plan.ts`
      ([codex] 11) — Leads went live today and must not be touched by a task hotfix.
      Duplication here is deliberate and temporary; a follow-up commit migrates Leads.
- [ ] **A2.** Page `fetchTasksForActor`, **ordered by `id`** (§10.5). First page
      carries `count: exact`; later pages in bounded parallel; step by the rows page
      one actually returned.
- [ ] **A3.** `TASK_MAX_ROWS = 5_000`, and clamp the final page:
      `.range(offset, Math.min(offset + pageSize, TASK_MAX_ROWS) - 1)` ([codex] 8).
- [ ] **A4.** Retry only transient failures — network/timeout/5xx/429, once, with
      jitter. Return permanent errors (permission, schema, malformed query)
      immediately ([codex] 9).
- [ ] **A5.** Move worker visibility scope out of the query string ([codex] 5).
      `assignedIds` + `participantIds` grow without bound and are now re-sent on
      every page. Either resolve the scope in SQL (a view or RPC joining
      `task_assignees` / `task_participants`), or — if that is too large for a
      hotfix — cap the id list, detect the cap, and fall back to a scope-free query
      plus the existing Node-side `canViewTask` filter, which is already the
      authority. **Do not ship an unbounded UUID list in a URL.**
- [ ] **A6.** Bound the fan-out in `fetchTaskListMetadata`, its three legacy helpers,
      **and `fetchTaskAssigneeRowsForTaskIds`** ([codex] 3) with one shared helper.
- [ ] **A7.** Report `truncated`: banner on the board, field on `/api/tasks`, and
      **export refuses outright** — a short CSV leaves the building and nobody can
      tell it is short.
- [ ] **A8.** Tests ([codex] 10): multi-page assembly with a server cap below the
      requested size; last page against the ceiling; duplicate and missing-row
      detection; transient retried once vs permanent not retried; the same scope
      predicate on every page; max in-flight for metadata **and** assignees; the
      `truncated` contract on page, API and export.
- [ ] **A9.** Verify at volume before deploy: seed a scratch environment to 1.000 /
      2.000 / 5.000 tasks and record TTFB, `/api/tasks` p95, payload size and DB
      query count. Numbers, not assertions.

### 10.7 Phase B — actually smooth at 5.000

- [ ] **B1.** Server loads the bounded window of §10.3: all non-`done`/`cancel`
      tasks, plus `done`/`cancel` inside the requested date range, plus anything with
      `done_reviewed_at IS NULL`. `fetchTasksForActor` takes the range; the board
      passes its current range.
- [ ] **B2.** Refetch on date-range change only, through the existing path at
      `TaskBoardClient.tsx:462` (which already handles overlapping refetches and
      write-version races — read it before touching it). Every other filter stays
      client-side and instant.
- [ ] **B3.** Cut the standing cost of `TASK_LIVE_RECONCILE_MS = 60_000`. With a
      ~320-row window a full reconcile is affordable, but the id-scoped realtime
      patch path that Leads uses (`patchLeadsById`) is the better model. At minimum,
      justify 60 s with a measurement instead of inheriting it.
- [ ] **B4.** Virtualize `TaskListView` ([codex] 2). `@tanstack/react-virtual` is
      already a dependency. Use `top`, not `transform` — every pinned cell is
      `position: sticky` and sticky inside a transformed ancestor is the classic
      breakage (learned on `LeadTable` this morning).
- [ ] **B5.** Kanban: window or load-more per column. **Verify drag-and-drop against
      unmounted cards** — `KanbanBoard.tsx:285` wraps the column in
      `SortableContext`, and dnd-kit needs its items registered. If windowing and
      dnd-kit cannot be reconciled cheaply, cap cards per column with a visible
      "showing N of M" instead of mounting thousands.
- [ ] **B6.** Stop recounting comments and attachments on every load. `task_list_metadata`
      runs two correlated subqueries per task, per load, per user. Either enrich only
      the rendered page, or maintain `comment_count` / `attachment_count` on `tasks`
      via trigger ([codex] 7).
- [ ] **B7.** Performance budget, measured at 1k / 5k: API p95, payload, DB query
      count, React commit time, mounted row count. Ship against numbers.

### 10.8 Definition of done

Phase A is done when the board cannot crash and the paging path is proven by tests
plus a seeded 5.000-task run.

**The "smooth at 1.000–5.000" goal is met only when B1, B4 and B6 are shipped and
B7's numbers say so** — [codex] is right that it must not be declared before then.

---

## 11. [codex] Second review of §10 — changes still required

**[codex] Review status: NOT APPROVED YET.** Section 10 is materially better than
the original plan: it separates the 1.000-row outage hotfix from the real scale
work, includes assignee fan-out, lowers/clamps the cap, narrows retries, adds real
paging tests, and stops making the Leads refactor a prerequisite. Those points are
accepted below. However, the revised plan still contains correctness blockers that
would either omit tasks or make older tasks searchable but impossible to open.

### 11.1 [codex] Resolution status from the first review

| Finding | Second-review status | [codex] comment |
|---|---|---|
| 1. Full-load architecture | **Partially resolved** | Bounded history is the right direction, but open tasks and the `All` preset are still unbounded. |
| 2. List/Kanban mount all rows | **Resolved in plan** | B4/B5 now include virtualization/windowing with a DnD caveat. |
| 3. Assignee fan-out omitted | **Resolved in plan** | A6 now explicitly includes `fetchTaskAssigneeRowsForTaskIds`. |
| 4. Missing supporting index | **Not resolved** | Ordering by `id` changes the required index; it does not prove that no index is required. |
| 5. UUID scope in URL | **Accepted but solution unresolved** | A5 still offers a fallback that can silently omit authorized rows. |
| 6. Offset consistency | **Not resolved** | Immutable ordering removes reorder races, not insert/delete offset races. |
| 7. Metadata total workload | **Resolved in direction** | B6 addresses the root cause; choose one canonical design before implementation. |
| 8. 20.000 cap/overshoot | **Resolved in plan** | A3 lowers to 5.000 and clamps the last range. |
| 9. Retry permanent errors | **Resolved in plan** | A4 now limits retries to transient failures. |
| 10. Missing pagination tests | **Resolved in plan** | A8 covers the important boundaries; add the races described below. |
| 11. Leads refactor prerequisite | **Resolved in plan** | A1 keeps the live Leads implementation untouched. |

### 11.2 [codex][blocker] Ordering by immutable `id` does not make OFFSET safe

Section 10.5 correctly proves that the SQL array order is not the final UI order:
both `TaskListView` and `KanbanBoard` rank a copied array. Therefore removing
`position` from the database order is safe for presentation.

It does **not** make parallel offset pagination a stable snapshot. Given pages
`0..999` and `1000..1999` ordered by UUID:

- inserting a UUID before offset 1.000 shifts an existing row onto the next page;
- deleting a row before offset 1.000 shifts an existing row onto the previous page;
- one page can duplicate or skip a row even though `id` itself never changes;
- insert/delete pairs can leave `rows.length === total`, so count + dedupe cannot
  detect every wrong snapshot.

**[codex][solution]** Replace A2's parallel OFFSET loop with sequential keyset
pagination: `order("id")`, then `id > lastSeenId`, with the exact count requested
only on the first page. Five sequential pages are acceptable for an outage hotfix
and correctness is more important than saving four round trips. If Phase A must be
parallel, use one database-side snapshot/RPC; do not claim OFFSET is race-free.

Add a test where rows are inserted/deleted before the next boundary. The expected
contract must distinguish rows present at snapshot start from rows created while
the snapshot is loading.

### 11.3 [codex][high] Finding 4 needs EXPLAIN, not an assertion

The claim that the primary-key index plus `tasks_archived_idx` "serves" this query
is not guaranteed. PostgreSQL may scan the PK and filter archived rows, or scan
`tasks_archived_idx` and sort by UUID. It generally cannot assume two independent
B-tree indexes satisfy both filtering and ordering efficiently.

**[codex][solution]** Keep A9's seeded measurements, but explicitly compare:

- current PK + `tasks_archived_idx` plan;
- `create index ... on tasks (id) where archived_at is null`;
- the Phase-B bounded-window predicates and their supporting indexes.

Record `EXPLAIN (ANALYZE, BUFFERS)` with both mostly-active and mostly-archived
datasets. Add only the index the measured plan needs. Finding 4 is therefore
**pending measurement**, not "disappeared".

### 11.4 [codex][blocker] Remove the unsafe A5 fallback

A5 currently allows capping `assignedIds`/`participantIds`, querying without SQL
scope, and applying `canViewTask` in Node. That is not a safe fallback:

1. The 5.000-row cap is applied to the company-wide set before Node authorization.
2. Authorized tasks may fall outside those first 5.000 rows and never reach Node.
3. Capping the ID lists also removes part of the information `canViewTask` needs.
4. The result can be silently incomplete while `truncated` only describes the
   company-wide query, not the actor's authorized result.

**[codex][solution]** A5 must choose the DB-side solution: an RPC/view/query that
joins `task_assignees` and `task_participants`, applies actor visibility before
pagination/count, and deduplicates task ids in SQL. Keep the existing Node check as
defense-in-depth, not as the primary scope mechanism. Do not ship the capped-ID
fallback.

The RPC must receive actor context only from the authenticated server path; never
trust an actor email supplied directly by a browser request.

### 11.5 [codex][blocker] The `All` date preset breaks the bounded-window model

The current UI has an `all` preset and resolves it to `{ from: "", to: "" }`.
Section 10.3 does not define what Phase B does for this case:

- loading every terminal task makes the window unbounded again;
- loading no reviewed terminal history makes `All` lie;
- silently applying a hidden 30-day cap changes the meaning of the control.

**[codex][solution]** Make an explicit product decision before B1:

- Recommended: `All` becomes a server-paginated historical mode with visible
  "load more"/result count; other presets use the bounded working window.
- Or remove `All` and replace it with a documented maximum history window.

In either case, export must use the same server-side filter/pagination contract and
must not export only the currently mounted virtual rows.

### 11.6 [codex][high] The proposed window does not match current date semantics

Current `matchesDateWindow` includes a terminal task when **either**:

- `created_at` falls inside the selected range; or
- `closed_at` falls inside the range; or
- for legacy rows without `closed_at`, `updated_at` falls inside the range.

Section 10.3 says terminal tasks are loaded only "by `closed_at`". That drops the
first rule and the legacy fallback, so the same date selection can show fewer rows
after Phase B.

**[codex][solution]** Define one shared, unit-tested date-window contract and use it
in both SQL and `filterTasks`:

```text
open task
OR terminal created in range
OR terminal coalesce(closed_at, updated_at) in range
OR terminal still awaiting QC (only if product explicitly wants QC to ignore range)
```

Also define timezone boundaries. The browser currently converts timestamps to a
local `YYYY-MM-DD`; comparing database timestamptz directly to bare date strings can
move rows across midnight for users outside UTC. Pass an explicit timezone or UTC
start/end instants derived from the agreed business timezone.

The unconditional `done_reviewed_at IS NULL` clause is also ambiguous: those rows
are loaded, but today's `filterTasks` will still hide them when outside the date
range. Decide whether they bypass the range, and test that exact behavior.

### 11.7 [codex][high] Initial range cannot currently be known by the server

The saved Task date preset lives only in browser `localStorage`. The server component
always starts with the fallback `thisMonth`; hydration later reads localStorage and
changes `dateRange`. After B1 this means a user whose saved range is `last30`, fixed,
or `All` receives the wrong initial window and immediately needs a second request.
It can also flash an incomplete count before the second response wins.

**[codex][solution]** Persist the selected range in a server-readable source
(URL query is preferred for shareability/back-forward behavior; a cookie or account
preference is also valid). The server render and `/api/tasks` must use the same
normalized range. If localStorage remains during migration, explicitly perform one
client correction and suppress stale-window rendering until it settles.

### 11.8 [codex][blocker] Search results outside the window are not currently openable

Section 10.3 says older tasks remain reachable through `runTaskSearch`. Search does
find them through `/api/tasks/search`, but `TaskBoardClient` derives `openTask` with:

```ts
const openTask = tasks.find((task) => task.id === openId) ?? null;
```

When an old search result is outside the bounded board array, the existing recovery
only refetches `/api/tasks`. After B1 that refetch returns the same bounded window,
so the task remains absent and the detail drawer cannot open.

**[codex][solution]** Add a scoped `GET /api/tasks/:id` list-row/detail bootstrap.
When `openId` is absent from the window, fetch that id after authorization and hold
it as an ephemeral open task without adding it to board counts/columns. Closing the
drawer may discard it. Cover direct URLs and search results for archived/out-of-
window/unauthorized tasks with tests. Until this exists, the statement "nothing
becomes unreachable" is false.

### 11.9 [codex][high] Date-window requests need their own race/version guard

B2 says to reuse `refetchTasks`, but its current race guard tracks task mutation
versions, not query/range versions. If range A is loading and the user selects range
B, response A may temporarily replace the board before the queued B request runs.
Realtime/focus/poll requests also need to carry the latest active range, not a stale
closure.

**[codex][solution]** Add a normalized query key/generation:

- every request includes the range/query key;
- only a response matching the latest key may apply;
- AbortController cancels an obsolete range request when practical;
- realtime/focus/poll read the latest range from a ref;
- changing range shows an in-place loading state without clearing the previous
  valid snapshot or applying a stale one.

Test rapid A → B → C selection with responses arriving C → A → B.

### 11.10 [codex][high] "Bounded by team capacity" is an assumption, not a bound

All non-terminal tasks can grow indefinitely when backlog accumulates, waiting tasks
are abandoned, or company/team size increases. Likewise, 30 days of completed work
grows with throughput. The claim that the board remains ~320 rows "permanently, at
any company size" is unsupported.

**[codex][solution]** Treat 320 as today's estimate, not an invariant. Keep an
explicit maximum per working set, surface truncation separately for open and
terminal rows, and add monitoring/alerts before either reaches the cap. Product
policy must decide how stale open work is resolved; performance code must not hide
it automatically.

### 11.11 [codex][medium] Clarify metadata and search claims

- Toolbar text search is already server-side and debounced by 200 ms; it is not one
  of the zero-request client filters listed in §10.3.
- "Enrich only the rendered page" conflicts with instant client sorting/filtering
  and columns that display comment/attachment counts for any row entering the
  viewport. The bounded window does not currently have numbered pages.

**[codex][solution]** Correct the text-search statement. For B6, prefer durable
`comment_count`/`attachment_count` counters (with backfill and consistency tests),
or enrich the whole bounded window in one aggregate query. Do not leave two
incompatible alternatives in the execution plan.

### 11.12 [codex][high] Performance budget needs pass/fail numbers

A9/B7 currently say to record metrics but do not define success. An implementation
could measure a slow result and still mark the checkbox complete.

**[codex][solution]** Before implementation, set explicit budgets for seeded 1k/5k
datasets, at minimum:

- initial server render and `/api/tasks` p50/p95;
- DB query count and slowest query;
- compressed response size;
- React commit time and mounted node/row/card count;
- one realtime update and one date-range transition;
- 20 concurrent visible sessions, matching §10.2's load model.

The exact thresholds are a product/SLO decision, but every metric needs a numerical
pass/fail threshold and a repeatable benchmark command.

### 11.13 [codex][high] Make one canonical executable plan

The document header still says §5 onward is the work, while §5–§8 contain detailed,
obsolete instructions (`position` ordering, 20.000 cap, unconditional retry, Leads
move). Section 10 says it supersedes them but provides only high-level checklists.
An executing agent can still copy code from the obsolete sections and produce the
exact implementation the review rejected.

**[codex][solution]** Before execution:

1. Move §5–§8 under an explicit "Rejected historical draft — do not execute"
   appendix, or delete them after preserving history in git.
2. Rewrite §10 into the same task-by-task format: exact files, interfaces,
   migrations, tests, verification commands and commit boundaries.
3. Resolve every `either/or` choice (especially A5, `All`, B6 and timezone) so an
   implementation agent does not make product/security decisions implicitly.
4. Update the top-level Goal and Architecture to describe Phase A + Phase B.

### 11.14 [codex] Revised approval gate

**Phase A may be approved only after:**

- [ ] A2 uses keyset/snapshot pagination, not parallel OFFSET.
- [ ] A5 uses DB-side authorization scope; the capped scope-free fallback is removed.
- [ ] Index behavior is measured with `EXPLAIN`, not assumed.
- [ ] The canonical Phase-A steps replace/supersede executable obsolete snippets.
- [ ] Tests define snapshot semantics plus truncation and authorization behavior.

**Phase B may be approved only after:**

- [ ] `All` semantics are decided.
- [ ] SQL and client date-window semantics, legacy fallback and timezone match.
- [ ] Initial range persistence and request-race behavior are specified.
- [ ] Search/direct-link opening works for tasks outside the board window.
- [ ] Open-task growth has a real cap/monitoring policy.
- [ ] B6 chooses one metadata architecture.
- [ ] B7 contains numerical performance budgets and repeatable load tests.

**[codex] Once these items are folded into a single executable section, the revised
architecture is directionally sound and can be reviewed for final approval.**

---

## 12. CANONICAL EXECUTABLE PLAN — Phase A

Supersedes §5–§8 entirely. Folds in both [codex] reviews. **This is the only section to execute.**

### 12.1 Findings accepted from review round 2

All 13 verified against source before accepting:

| # | Accepted change |
|---|---|
| 11.2 | **Keyset, not OFFSET.** Immutable `id` ordering stops reorder races but not insert/delete races: a UUID inserted before the boundary shifts every later row onto the next page, and an insert/delete pair can leave `rows.length === total` so count+dedupe cannot detect it. Paging is now `where id > lastSeenId order by id limit N`, **sequential**. 5 sequential round-trips is the right price for a correct snapshot. |
| 11.3 | Index is **pending measurement**, not "disappeared". A9 must compare plans with `EXPLAIN (ANALYZE, BUFFERS)`. |
| 11.4 | **The capped scope-free fallback is removed.** It applied the 5.000-row cap to the company-wide set *before* Node authorization, so an authorized task could fall outside the first 5.000 and never reach `canViewTask` — silently incomplete, with `truncated` describing the wrong query. Phase A now **fails loudly** instead (12.4/A5); DB-side scope is a Phase B prerequisite. |
| 11.5 | `All` preset semantics: **Phase B decision, blocking B1.** Phase A does not change date behaviour at all. |
| 11.6 | Date-window contract mismatch: **Phase B**, blocking B1. Phase A does not touch `matchesDateWindow`. |
| 11.7 | Range lives in `localStorage` (`TaskBoardClient.tsx:99,2417,2451`), unreadable by the server: **Phase B**, blocking B1. |
| 11.8 | `openTask = tasks.find(...)` (`:1224`) — a search hit outside the window cannot open. **Phase B, blocking B1.** The §10.3 claim "nothing becomes unreachable" was false and is retracted. |
| 11.9 | Range/query generation guard: **Phase B**, blocking B2. |
| 11.10 | "Bounded by team capacity" downgraded from invariant to today's estimate; open and terminal truncation reported separately. |
| 11.11 | Toolbar text search is server-side + 200 ms debounced (`TaskSearchBox.tsx:67,81`) — removed from the "zero-request client filters" list. B6 picks **one** design: durable counters. |
| 11.12 | A9/B7 need numeric pass/fail thresholds, not "record metrics". |
| 11.13 | This section; §5–§8 marked rejected in the header. |

### 12.2 Phase A scope

Stop the crash. Nothing else. **Phase A explicitly does NOT claim the "smooth at 5.000" goal** — that is Phase B, gated by 11.5/11.6/11.7/11.8/11.9.

### A1 — Generic keyset paging helper

**Create:** `src/lib/pagination/keyset.ts`, `src/lib/pagination/keyset.test.ts`
**Do NOT touch** `src/lib/leads/page-plan.ts` — Leads is live ([codex] 11).

```ts
export type KeysetPage<T> = {
  rows: T[] | null;
  error: { code?: string; message?: string } | null;
  count?: number | null;
};

export type KeysetResult<T> = {
  rows: T[];
  total: number;
  truncated: boolean;
};

/**
 * Nạp hết một bảng bằng KEYSET (`id > lastSeenId`), tuần tự.
 *
 * KHÔNG dùng OFFSET song song. Sắp theo `id` bất biến chỉ bỏ được race do
 * kéo-thả; nó KHÔNG bỏ được race do insert/delete: một UUID chèn vào trước biên
 * trang đẩy mọi dòng sau sang trang kế, và một cặp insert+delete có thể để
 * `rows.length === total` nên đếm + khử trùng không phát hiện được. Keyset thì
 * con trỏ là một dòng cụ thể, nên chèn/xoá ở nơi khác không dịch được nó.
 *
 * `fetchPage(afterId)` phải: lọc `id > afterId` khi afterId khác null, sắp theo
 * `id` tăng dần, và chỉ xin `count: exact` khi afterId === null.
 */
export async function fetchAllByKeyset<T extends { id: string }>(
  fetchPage: (afterId: string | null) => Promise<KeysetPage<T>>,
  opts: { maxRows: number; isTransient: (e: { code?: string; message?: string }) => boolean },
): Promise<KeysetResult<T>>
```

Behaviour, each of which gets a test:
1. one page → returns it, `truncated` false
2. several pages → concatenated in order, cursor is the last row's id
3. a page shorter than the previous one still continues (server ceiling may vary)
4. empty page ends the loop
5. stops at `maxRows`, `truncated: true`, and does **not** fetch further
6. transient error → retried **once**; permanent error → thrown immediately, not retried
7. `total` comes from the first page's count; `truncated` is `rows.length < total`

### A2 — Keyset-page `fetchTasksForActor`

**Modify:** `src/lib/tasks/queries.ts`

- `TASK_PAGE_SIZE = 1000`, `TASK_MAX_ROWS = 5_000`.
- Order **`id` ascending only**. Justification (verified): `TaskListView.tsx:112-117` always re-ranks via `rankTasks`/`rankTasksForManager`/`sortTasks`, so the SQL order is never the displayed order. **Verify `KanbanBoard` reads the `position` field, not array order**; if it relies on array order, sort by `position` in Node after assembly.
- One `buildTaskQuery(supabase, shape, afterId, withCount)` used for every page; `count: "exact"` only when `afterId === null`.
- Preserve the `.eq("id","00000000-0000-0000-0000-000000000000")` fail-closed branch for an actor with empty scope.
- Return `{ tasks, total, truncated }`.
- Legacy `custom_values` fallback stays single-shot with `assertTaskListComplete` (production has the column; the branch is cold).

`isTransient`: retry only when there is no `code`, or code is `PGRST504`/`08*`/`57014`, or the message matches `/timeout|fetch failed|network|ECONN|socket/i`. Everything else (permission, schema, malformed filter) throws on the first attempt.

### A5 — Fail loudly on an oversized scope string

**Do not** ship the capped scope-free fallback ([codex] 11.4). Before issuing a scoped query, measure the assembled `.or()` string:

```ts
const SCOPE_FILTER_MAX_BYTES = 6_000;   // ~8 KB proxy/gateway limit, minus headroom
```

Over budget → throw a named `TaskScopeTooLargeError` carrying the byte count and id counts. `/api/tasks` maps it to 503 with a clear message; the board page lets it surface. A loud failure for one scoped worker is correct; a silently short board is not. Moving visibility into SQL is **Phase B prerequisite B0**.

### A6 — Bound every fan-out

`src/lib/tasks/queries.ts`: `fetchTaskListMetadata` plus `fetchTaskActorRows`, `fetchTaskCommentRows`, `fetchTaskAttachmentRows`.
`src/lib/tasks/assignees.ts:331`: `fetchTaskAssigneeRowsForTaskIds` ([codex] 3 — missed in the first draft).

One shared `mapWithConcurrency(items, size, run)` in `src/lib/pagination/concurrency.ts`, limit **6**. Chunk size stays 50 (`queries.test.ts:95-97` asserts it). A test asserts max in-flight never exceeds the limit for **both** metadata and assignees.

### A7 — Report truncation

Board banner; `truncated` on `/api/tasks`; **export refuses outright** (a short CSV leaves the building and nobody can tell). Report open vs terminal truncation separately ([codex] 11.10).

### A9 — Measure, with pass/fail numbers ([codex] 11.12)

Seed 1.000 / 2.000 / 5.000 tasks. Record and gate on:

| Metric | Budget @5.000 |
|---|---|
| `/api/tasks` p95 | ≤ 2.500 ms |
| Server render TTFB | ≤ 3.000 ms |
| DB queries per load | ≤ 30 |
| Response size (gzip) | ≤ 2,5 MB |
| `EXPLAIN` on the keyset page | index scan, no full sort |

Compare `EXPLAIN (ANALYZE, BUFFERS)` for PK + `tasks_archived_idx` vs `create index on tasks (id) where archived_at is null`, on mostly-active and mostly-archived datasets. Add the index only if measurement demands it ([codex] 11.3).

**Phase A is done when the board cannot crash and these numbers pass. It is not the scale goal.**

---

## 13. PHASE B PLAN — actually smooth at 1.000–5.000

Phase A (commits `8260aa4`, `87ad9e8`) stopped the crash. It did **not** meet the
owner's goal. This section is the work that does.

### 13.1 Where Phase A left things

At 5.000 active tasks, one board load still costs:

| | Phase A | Budget |
|---|---|---|
| DB queries | ~32 (5 pages + 10 metadata + 17 assignee) | ≤ 30 |
| Payload | 6,5 MB raw / ~1,9 MB gzip | — |
| Mounted components | ~75.000 (5.000 rows × ~15 cols) | — |

…and `TASK_LIVE_RECONCILE_MS = 60_000` (`src/lib/tasks/live-sync.ts:12`) repeats
the whole thing per visible tab every minute. At ~20 CS tabs that is **37 MB/min
and ~640 DB queries/min**. Phase A did not touch any of that; it only stopped the
1.000-row throw.

### 13.2 The one product constraint that shapes everything

The owner chose **instant filtering**. Every filter except the date range must stay
client-side with zero requests. That rules out cursor pagination with server-side
filters ([codex] §9's Phase B shape) and forces the alternative: **load a bounded
window, and keep everything the user filters over inside it.**

### 13.3 Resolved since §10

- **Timezone: America/Chicago (Texas).** Already shipped — `cf05906` added
  `src/lib/tasks/business-date.ts` and moved all four date-key sites onto it.
  [codex] §11.6's timezone half is closed; the *contract* half is B1 below.

### 13.4 Still to decide — recommendations, flag disagreement

| Question | Recommendation |
|---|---|
| `All` preset ([codex] 11.5) | **Keep it**, server-paginated with the same `TASK_MAX_ROWS` cap and the Phase A banner. Removing a control people use is worse than a bounded one that says when it is bounded. |
| B6 metadata design ([codex] 11.11) | **Durable counters** on `tasks` maintained by trigger — not "enrich the rendered page", which conflicts with instant client sorting over the whole window. |
| Open-task growth cap ([codex] 11.10) | Report open and terminal truncation **separately** so an accumulating backlog is visible rather than silently squeezing out terminal rows. |

### B0 — Move visibility scope into SQL (prerequisite for B1)

**Why first:** Phase A ships `TaskScopeTooLargeError` — a loud failure once a
worker's `assignedIds + participantIds` exceed 6 KB of query string. That is a
stopgap, not a fix, and B1 makes it worse by adding a date predicate to the same
URL. ([codex] 11.4 rejected the alternative — capping the id list and filtering in
Node — because the row cap applies to the company-wide set *before* `canViewTask`
runs, so an authorized task can fall outside the cap and never reach the check.)

**Shape.** A SQL function that applies visibility **before** pagination and count:

```sql
create or replace function task_ids_visible_to(p_email text)
returns table (task_id uuid)
language sql stable security definer set search_path = public as $$
  select t.id from tasks t where t.archived_at is null and (
    t.assignee_email = p_email or t.agent_email = p_email or t.reporter_email = p_email
  )
  union
  select a.task_id from task_assignees a where a.email = p_email
  union
  select p.task_id from task_participants p where p.email = p_email
  union
  select t.id from tasks t
    join agent_members m on m.agent_email = t.agent_email
   where m.cs_email = p_email and m.is_assistant
$$;
```

**Index needed:** `task_participants` has only `primary key (task_id, email)` —
no index on `email` alone (verified `schema.sql:2801-2808`). Add
`create index on task_participants (email)`. `task_assignees_email_idx` already
exists (`:2822`).

**Actor context comes from the authenticated server path only** ([codex] 11.4) —
never an email supplied by the browser. Keep the Node `canViewTask` filter as
defence in depth, not as the primary gate.

- [ ] Rollout with the function, the index, and `EXPLAIN` evidence.
- [ ] `fetchTasksForActor` joins it instead of assembling `.or()` strings.
- [ ] Delete `TaskScopeTooLargeError` and `SCOPE_FILTER_MAX_BYTES` once unused.
- [ ] Test: a scoped worker sees exactly the same set as today, on every page.

### B1 — The bounded window

**Loaded always, no date limit:** every task whose status is not `done`/`cancel`.
Bounded by team capacity, **an estimate not an invariant** ([codex] 11.10) — 42
today; report its truncation separately.

**Loaded inside the selected range:** terminal tasks, using a contract that must
match `matchesDateWindow` (`src/lib/tasks/filtering.ts:157-177`) **exactly**, or
the same date selection shows fewer rows after B1 than before it ([codex] 11.6):

```
created_at in range
  OR (terminal AND coalesce(closed_at, updated_at) in range)
  OR done_reviewed_at IS NULL          -- QC còn nợ; Overview đã giữ chúng vô hạn
```

Note the first clause applies to **all** tasks including terminal ones — §10.3
said "terminal by closed_at" and that was narrower than today's behaviour.

- [ ] One exported predicate in `src/lib/tasks/date-window.ts`, unit-tested,
      used by **both** the SQL builder and `filterTasks`. Two copies is how the
      three date-key copies happened.
- [ ] Range boundaries converted to UTC instants from Texas day boundaries via
      `businessDateKey` / `shiftBusinessDateKey` (`cf05906`).
- [ ] Decide and test whether `done_reviewed_at IS NULL` rows bypass the range in
      `filterTasks` too — today they would be loaded and then hidden ([codex] 11.6).

### B2 — Range becomes a server-readable, race-guarded input

The saved preset lives in `localStorage` (`TaskBoardClient.tsx:99, 2417, 2451`), so
the server always renders `thisMonth` first and hydration corrects it ([codex] 11.7).
After B1 that means a wrong initial window plus an immediate second request.

- [ ] Move the range to a **URL query param** — shareable, and Back/Forward works.
      Server render and `/api/tasks` read the same normalized range.
- [ ] Refetch on range change through the existing path (`TaskBoardClient.tsx:462`,
      which already handles overlapping refetches and write-version races — read it
      before touching it).
- [ ] **Query-generation guard** ([codex] 11.9): the current guard tracks *mutation*
      versions, not *range* versions, so a slow response for range A can overwrite
      range B. Every request carries a range key; only a response matching the
      latest key may apply; `AbortController` cancels obsolete ones; realtime/focus/
      poll read the latest range from a ref, not a stale closure.
- [ ] Test rapid A → B → C selection with responses arriving C → A → B.

### B3 — Open a task that is outside the window

`const openTask = tasks.find((t) => t.id === openId) ?? null` (`:1224`). After B1 a
search hit or a direct link to an older task is **not in the array**, and the
existing recovery refetches the same bounded window, so the drawer never opens.
§10.3's claim that "nothing becomes unreachable" was false ([codex] 11.8).

- [ ] Scoped `GET /api/tasks/:id` bootstrap. When `openId` is absent from the
      window, fetch it after authorization and hold it as an ephemeral open task
      **without** adding it to board counts or columns; discard on close.
- [ ] Tests: direct URL, search result, archived task, out-of-window task,
      unauthorized task.

### B4 — Virtualize the task list

- [ ] `@tanstack/react-virtual` (already a dependency). Use **`top`, not
      `transform`** — every pinned cell is `position: sticky` and sticky inside a
      transformed ancestor is the classic breakage (learned on `LeadTable`, and the
      React Compiler lint will skip memoizing the component, so the manual
      `memo`/`useMemo` there is load-bearing — same will apply here).
- [ ] `TaskRowItem` gets `React.memo`; handlers passed to it become `useCallback`.
- [ ] Manual checks that actually exercise it: shrink the list while scrolled down;
      re-sort while scrolled; a row whose height differs from the estimate.

### B5 — Kanban windowing (highest technical risk)

`KanbanBoard.tsx:285` wraps each column in dnd-kit's `SortableContext`, which needs
its items registered — and windowing unmounts exactly the items outside the
viewport.

- [ ] Spike first: confirm whether dnd-kit can drag to an unmounted target.
- [ ] If it cannot be reconciled cheaply, **cap cards per column with a visible
      "showing N of M"** rather than mounting thousands. A visible cap beats a
      broken drag.

### B6 — Stop recounting comments and attachments

`task_list_metadata` (`schema.sql:2212-2241`) runs two correlated subqueries **per
task, per load, per user**. Phase A cut the round trips (chunk 50 → 500) but not the
work ([codex] 7).

- [ ] Add `comment_count` / `attachment_count` columns on `tasks`, maintained by
      trigger on `task_comments` / `task_attachments` insert/update/delete
      (including the `deleted_at` soft-delete transitions).
- [ ] Backfill rollout + a consistency test comparing counters against a live count.
- [ ] Then `task_list_metadata` collapses into the main select and the assignee
      fan-out is the only enrich left — which a single `task_id = any($1)` query
      replaces.

### B7 — Performance budget with pass/fail numbers ([codex] 11.12)

Seeded 1.000 / 2.000 / 5.000 datasets. Every metric needs a threshold and a
repeatable command; "recorded a number" is not a passing gate.

| Metric | Budget @5.000 |
|---|---|
| `/api/tasks` p95 | ≤ 800 ms |
| Server render TTFB | ≤ 1.500 ms |
| DB queries per load | ≤ 10 |
| Response size (gzip) | ≤ 400 KB |
| React commit time, filter keystroke | ≤ 50 ms |
| Mounted rows | ≤ 60 regardless of dataset |
| 20 concurrent visible sessions | no error, p95 within budget |

Seeding needs a database that is not production — see §13.6.

### 13.5 Ordering and independence

B0 → B1 → B2 → B3 is one dependency chain and delivers the payload/query win.
**B4/B5 are independent** and can ship first or in parallel; they fix rendering, not
loading. B6 is independent of both. B7 gates the claim, not the code.

### 13.6 The measurement problem, unresolved

There is exactly one Supabase config in `.env.local` and it is **production** (141
real tasks, real emails). Seeding 5.000 rows there would show fake tasks on every
CS board, pollute Overview/KPI, and — above 1.000 — reproduce the very outage this
work prevents. B7 therefore needs either a second (free) Supabase project as a test
database, or an agreed off-hours window with cleanup scripted **before** seeding.
The repo's existing convention is in `scripts/seed-enrollment-performance-samples.mjs`:
marker + prefix, `SEED_PERF_ALLOW=1`, `--dry-run`, `--cleanup`, and its own guard
says "after confirming this is a test database".

**Until that is resolved, B7 cannot pass, and the "smooth at 5.000" claim cannot be
made** — [codex] §9 was right that it must not be declared before then.
