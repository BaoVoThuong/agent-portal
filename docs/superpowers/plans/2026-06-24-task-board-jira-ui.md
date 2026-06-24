# Task Board — Jira-fidelity UI Pass — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Board/List/Backlog views with a shared Jira-style filter toolbar, a sortable List view with inline editing, and a redesigned drag-to-order Backlog — UI-only on the existing task model.

**Architecture:** Two pure, unit-tested helpers (`sortTasks`, `filterTasks`) hold all list logic. `TaskBoardClient` lifts filter+sort+view state, feeds a shared `TaskToolbar`, and renders one of `KanbanBoard` / `TaskListView` / `BacklogBoard`. Inline edits reuse the existing optimistic `patchTask`; creates reuse `createTask`; backlog reorder reuses `midpoint` + `patchTask`. No data-model or API change.

**Tech Stack:** Next.js 16 App Router, TypeScript, Tailwind v4, lucide-react, @dnd-kit, vitest.

**Depends on:** existing task board on branch `feat/task-board` (TaskBoardClient, KanbanBoard, TaskDetailDrawer, TaskSelect, TaskPrioritySelect, board-ui, lib/tasks/*).

## Global Constraints

- UI-only. No changes to `src/app/api/tasks/**` or `supabase/schema.sql`. Reuse existing `patchTask`/`createTask`/`archiveTask` and the API they call.
- Identity by email; authorization stays server-side. The UI disables an inline control when `!canEdit` for that task (`canEdit = isManager || task.assignee_email === currentEmail`). Never rely on the client for security.
- Jira palette: `#172b4d` text, `#0c66e4` primary/active, `#42526e`/`#44546f`/`#6b778c` muted, `#f4f5f7`/`#ebecf0` surfaces, `#dfe1e6` borders, `#e9f2ff`/`#deebff` selected.
- Views: `board | list | backlog`. CS sees Board + List only; Backlog is manager-only. Board + List share `visibleTasks`; Backlog reads `status === "backlog"`.
- Priority order low < medium < high < urgent. Nullable fields sort last.
- vitest with `@/` alias; tests are unit tests for pure logic only (UI verified by tsc + next build + manual).

---

### Task 1: `sortTasks` pure helper

**Files:**
- Create: `src/lib/tasks/sorting.ts`
- Test: `src/lib/tasks/sorting.test.ts`

**Interfaces:**
- Produces:
  - `type SortKey = "title" | "status" | "priority" | "agent" | "assignee" | "category" | "due" | "updated" | "key"`
  - `type SortDir = "asc" | "desc"`
  - `taskKey(id: string): string` — the displayed `TASK-xxx` (same algorithm currently in TaskCard).
  - `sortTasks(tasks: TaskRow[], key: SortKey, dir: SortDir, categoryName?: (id: string | null) => string | null): TaskRow[]` — stable, pure, never mutates input; nullable values sort last regardless of dir.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/tasks/sorting.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { sortTasks, taskKey, type SortKey } from "@/lib/tasks/sorting";
import type { TaskRow } from "@/lib/tasks/types";

function task(p: Partial<TaskRow>): TaskRow {
  return {
    id: "id",
    title: "",
    description: null,
    status: "todo",
    priority: "medium",
    category_id: null,
    agent_email: null,
    assignee_email: null,
    reporter_email: "r@x.com",
    due_date: null,
    waiting_reason: null,
    position: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    archived_at: null,
    ...p,
  };
}

describe("sortTasks", () => {
  it("does not mutate the input array", () => {
    const input = [task({ id: "b", title: "B" }), task({ id: "a", title: "A" })];
    const copy = [...input];
    sortTasks(input, "title", "asc");
    expect(input).toEqual(copy);
  });

  it("sorts by title asc/desc", () => {
    const rows = [task({ title: "B" }), task({ title: "A" }), task({ title: "C" })];
    expect(sortTasks(rows, "title", "asc").map((t) => t.title)).toEqual(["A", "B", "C"]);
    expect(sortTasks(rows, "title", "desc").map((t) => t.title)).toEqual(["C", "B", "A"]);
  });

  it("sorts by priority rank (low<medium<high<urgent)", () => {
    const rows = [
      task({ id: "1", priority: "high" }),
      task({ id: "2", priority: "low" }),
      task({ id: "3", priority: "urgent" }),
      task({ id: "4", priority: "medium" }),
    ];
    expect(sortTasks(rows, "priority", "asc").map((t) => t.priority)).toEqual([
      "low",
      "medium",
      "high",
      "urgent",
    ]);
  });

  it("puts null due dates last in both directions", () => {
    const rows = [
      task({ id: "1", due_date: null }),
      task({ id: "2", due_date: "2026-03-01" }),
      task({ id: "3", due_date: "2026-01-01" }),
    ];
    expect(sortTasks(rows, "due", "asc").map((t) => t.id)).toEqual(["3", "2", "1"]);
    expect(sortTasks(rows, "due", "desc").map((t) => t.id)).toEqual(["2", "3", "1"]);
  });

  it("sorts by category name via the resolver", () => {
    const rows = [
      task({ id: "1", category_id: "c1" }),
      task({ id: "2", category_id: "c2" }),
      task({ id: "3", category_id: null }),
    ];
    const name = (id: string | null) => (id === "c1" ? "Zebra" : id === "c2" ? "Alpha" : null);
    expect(sortTasks(rows, "category", "asc", name).map((t) => t.id)).toEqual(["2", "1", "3"]);
  });

  it("taskKey is stable for the same id", () => {
    expect(taskKey("abc")).toBe(taskKey("abc"));
    expect(taskKey("abc")).toMatch(/^TASK-\d+$/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/tasks/sorting.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/tasks/sorting.ts`:

```typescript
import type { TaskPriority, TaskRow, TaskStatus } from "./types";

export type SortKey =
  | "title"
  | "status"
  | "priority"
  | "agent"
  | "assignee"
  | "category"
  | "due"
  | "updated"
  | "key";
export type SortDir = "asc" | "desc";

const PRIORITY_RANK: Record<TaskPriority, number> = {
  low: 0,
  medium: 1,
  high: 2,
  urgent: 3,
};
const STATUS_RANK: Record<TaskStatus, number> = {
  backlog: 0,
  todo: 1,
  in_progress: 2,
  waiting: 3,
  done: 4,
};

// Deterministic display key, matching the one shown on cards.
export function taskKey(id: string): string {
  let hash = 0;
  for (const character of id) {
    hash = (hash * 31 + character.charCodeAt(0)) % 900;
  }
  return `TASK-${hash + 100}`;
}

// A comparable value for a task on a given key. `null` => sorts last.
function sortValue(
  task: TaskRow,
  key: SortKey,
  categoryName: (id: string | null) => string | null
): string | number | null {
  switch (key) {
    case "title":
      return task.title.toLowerCase();
    case "status":
      return STATUS_RANK[task.status];
    case "priority":
      return PRIORITY_RANK[task.priority];
    case "agent":
      return task.agent_email?.toLowerCase() ?? null;
    case "assignee":
      return task.assignee_email?.toLowerCase() ?? null;
    case "category":
      return categoryName(task.category_id)?.toLowerCase() ?? null;
    case "due":
      return task.due_date ?? null;
    case "updated":
      return task.updated_at;
    case "key":
      return taskKey(task.id);
  }
}

export function sortTasks(
  tasks: TaskRow[],
  key: SortKey,
  dir: SortDir,
  categoryName: (id: string | null) => string | null = () => null
): TaskRow[] {
  const factor = dir === "asc" ? 1 : -1;
  return [...tasks].sort((a, b) => {
    const av = sortValue(a, key, categoryName);
    const bv = sortValue(b, key, categoryName);
    if (av === null && bv === null) return 0;
    if (av === null) return 1; // nulls last regardless of direction
    if (bv === null) return -1;
    if (av < bv) return -1 * factor;
    if (av > bv) return 1 * factor;
    return 0;
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/tasks/sorting.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tasks/sorting.ts src/lib/tasks/sorting.test.ts
git commit -m "feat(tasks): add sortTasks helper for the list view"
```

---

### Task 2: `filterTasks` pure helper

**Files:**
- Create: `src/lib/tasks/filtering.ts`
- Test: `src/lib/tasks/filtering.test.ts`

**Interfaces:**
- Consumes: `TaskRow`, `TaskPriority`, `TaskStatus` from `./types`.
- Produces:
  - `ALL_AGENTS = "__all_agents__"`, `NO_AGENT = "__no_agent__"` (exported constants).
  - `type QuickFilter = "overdue" | "dueThisWeek" | "highPriority" | "recentlyUpdated" | "mine" | "triage"`
  - `type FilterCriteria = { query: string; agent: string; quick: QuickFilter[]; priority: "" | TaskPriority; category: "" | string; status: "" | TaskStatus; currentEmail: string; now?: Date; searchText?: (task: TaskRow) => string }`
  - `filterTasks(tasks: TaskRow[], c: FilterCriteria): TaskRow[]`

This consolidates the search + agent + quick-filter logic currently inline in `TaskBoardClient`, and adds the new Priority/Category/Status facets. `QuickFilter` moves here (TaskBoardClient imports it).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/tasks/filtering.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  filterTasks,
  ALL_AGENTS,
  NO_AGENT,
  type FilterCriteria,
} from "@/lib/tasks/filtering";
import type { TaskRow } from "@/lib/tasks/types";

function task(p: Partial<TaskRow>): TaskRow {
  return {
    id: "id", title: "", description: null, status: "todo", priority: "medium",
    category_id: null, agent_email: null, assignee_email: null,
    reporter_email: "r@x.com", due_date: null, waiting_reason: null, position: 0,
    created_at: "2026-01-01T00:00:00Z", updated_at: "2026-06-24T00:00:00Z",
    archived_at: null, ...p,
  };
}

const base: FilterCriteria = {
  query: "", agent: ALL_AGENTS, quick: [], priority: "", category: "",
  status: "", currentEmail: "me@x.com", now: new Date("2026-06-24T12:00:00Z"),
};

describe("filterTasks", () => {
  it("ALL_AGENTS returns everything; agent email narrows; NO_AGENT keeps only untagged", () => {
    const rows = [task({ id: "1", agent_email: "a@x.com" }), task({ id: "2", agent_email: null })];
    expect(filterTasks(rows, base).length).toBe(2);
    expect(filterTasks(rows, { ...base, agent: "a@x.com" }).map((t) => t.id)).toEqual(["1"]);
    expect(filterTasks(rows, { ...base, agent: NO_AGENT }).map((t) => t.id)).toEqual(["2"]);
  });

  it("search matches title (case-insensitive)", () => {
    const rows = [task({ id: "1", title: "Renew policy" }), task({ id: "2", title: "Call client" })];
    expect(filterTasks(rows, { ...base, query: "renew" }).map((t) => t.id)).toEqual(["1"]);
  });

  it("priority + category + status facets narrow (AND)", () => {
    const rows = [
      task({ id: "1", priority: "high", category_id: "c1", status: "todo" }),
      task({ id: "2", priority: "low", category_id: "c1", status: "todo" }),
      task({ id: "3", priority: "high", category_id: "c2", status: "done" }),
    ];
    expect(filterTasks(rows, { ...base, priority: "high" }).map((t) => t.id)).toEqual(["1", "3"]);
    expect(filterTasks(rows, { ...base, category: "c1" }).map((t) => t.id)).toEqual(["1", "2"]);
    expect(filterTasks(rows, { ...base, status: "done" }).map((t) => t.id)).toEqual(["3"]);
  });

  it("quick: overdue and dueThisWeek", () => {
    const rows = [
      task({ id: "1", due_date: "2026-06-01", status: "todo" }), // overdue
      task({ id: "2", due_date: "2026-06-26", status: "todo" }), // this week
      task({ id: "3", due_date: "2026-08-01", status: "todo" }), // later
      task({ id: "4", due_date: "2026-06-01", status: "done" }), // done -> not overdue
    ];
    expect(filterTasks(rows, { ...base, quick: ["overdue"] }).map((t) => t.id)).toEqual(["1"]);
    expect(filterTasks(rows, { ...base, quick: ["dueThisWeek"] }).map((t) => t.id)).toEqual(["2"]);
  });

  it("quick: mine and triage", () => {
    const rows = [
      task({ id: "1", assignee_email: "me@x.com" }),
      task({ id: "2", reporter_email: "me@x.com" }),
      task({ id: "3", assignee_email: "other@x.com", reporter_email: "other@x.com" }),
      task({ id: "4", category_id: "c1", agent_email: "a@x.com" }), // fully tagged
    ];
    expect(filterTasks(rows, { ...base, quick: ["mine"] }).map((t) => t.id).sort()).toEqual(["1", "2"]);
    expect(filterTasks(rows, { ...base, quick: ["triage"] }).map((t) => t.id)).toContain("1");
    expect(filterTasks(rows, { ...base, quick: ["triage"] }).map((t) => t.id)).not.toContain("4");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/tasks/filtering.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/tasks/filtering.ts`:

```typescript
import type { TaskPriority, TaskRow, TaskStatus } from "./types";

export const ALL_AGENTS = "__all_agents__";
export const NO_AGENT = "__no_agent__";

export type QuickFilter =
  | "overdue"
  | "dueThisWeek"
  | "highPriority"
  | "recentlyUpdated"
  | "mine"
  | "triage";

export type FilterCriteria = {
  query: string;
  agent: string;
  quick: QuickFilter[];
  priority: "" | TaskPriority;
  category: "" | string;
  status: "" | TaskStatus;
  currentEmail: string;
  now?: Date;
  searchText?: (task: TaskRow) => string;
};

function defaultSearchText(task: TaskRow): string {
  return [
    task.title,
    task.description,
    task.agent_email,
    task.assignee_email,
    task.reporter_email,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function matchesQuick(task: TaskRow, filter: QuickFilter, currentEmail: string, now: Date): boolean {
  switch (filter) {
    case "overdue":
      if (!task.due_date || task.status === "done") return false;
      return new Date(`${task.due_date}T23:59:59`) < now;
    case "dueThisWeek": {
      if (!task.due_date || task.status === "done") return false;
      const due = new Date(`${task.due_date}T23:59:59`);
      const week = new Date(now);
      week.setDate(now.getDate() + 7);
      return due >= now && due <= week;
    }
    case "highPriority":
      return task.priority === "high" || task.priority === "urgent";
    case "recentlyUpdated": {
      const cutoff = new Date(now);
      cutoff.setDate(now.getDate() - 3);
      return new Date(task.updated_at) >= cutoff;
    }
    case "mine":
      return task.assignee_email === currentEmail || task.reporter_email === currentEmail;
    case "triage":
      return !task.category_id || !task.agent_email;
  }
}

export function filterTasks(tasks: TaskRow[], c: FilterCriteria): TaskRow[] {
  const now = c.now ?? new Date();
  const query = c.query.trim().toLowerCase();
  const searchText = c.searchText ?? defaultSearchText;

  return tasks.filter((task) => {
    if (c.agent === NO_AGENT ? !!task.agent_email : c.agent !== ALL_AGENTS && task.agent_email !== c.agent) {
      return false;
    }
    if (c.priority && task.priority !== c.priority) return false;
    if (c.category && task.category_id !== c.category) return false;
    if (c.status && task.status !== c.status) return false;
    if (query && !searchText(task).includes(query)) return false;
    return c.quick.every((filter) => matchesQuick(task, filter, c.currentEmail, now));
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/tasks/filtering.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tasks/filtering.ts src/lib/tasks/filtering.test.ts
git commit -m "feat(tasks): add filterTasks helper (search/agent/quick/facets)"
```

---

### Task 3: `TaskListView` — sortable table with inline edit

**Files:**
- Create: `src/app/(authed)/tasks/_components/TaskListView.tsx`

**Interfaces:**
- Consumes: `sortTasks`, `SortKey`, `SortDir`, `taskKey` (Task 1); `TaskRow`, `TaskCategory`, `TaskStatus`, `TaskPriority`, `TASK_STATUSES` from types; `TaskSelect`, `TaskPrioritySelect`, `Initials`, `PriorityIcon`, `DueBadge` (existing); `TaskAssignee` from assignees.
- Produces: `TaskListView({ tasks, categories, assignees, isManager, currentEmail, onOpen, onPatch })` where `onPatch(id, patch) => void` (same shape `TaskBoardClient.patchTask` expects).

- [ ] **Step 1: Implement the component**

Create `src/app/(authed)/tasks/_components/TaskListView.tsx`. Requirements:
- Local `const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "key", dir: "asc" })`; a header click toggles dir if same key else sets key+asc.
- `const categoryName = (id) => categories.find(c => c.id === id)?.name ?? null;`
- `const rows = sortTasks(tasks, sort.key, sort.dir, categoryName);`
- A `<table>` with `sticky top-0` header. Header cells for: Key, Title, Status, Priority, Agent, Assignee, Category, Due, Updated. Each sortable header is a button showing a ChevronUp/ChevronDown when active (lucide `ChevronUp`/`ChevronDown`).
- Each row: `canEdit = isManager || task.assignee_email === currentEmail`.
  - Key cell: `taskKey(task.id)` muted mono.
  - Title cell: a button → `onOpen(task.id)` (hover `text-[#0c66e4]`).
  - Status cell: `TaskSelect` with options from `TASK_STATUSES` (label via a `STATUS_LABEL` map: To Do/In Progress/Waiting/Done/Backlog), `disabled={!canEdit}`, `onChange={(v) => onPatch(task.id, { status: v })}`.
  - Priority cell: `TaskPrioritySelect` `value={task.priority}` `disabled={!canEdit}` `onChange={(v) => onPatch(task.id, { priority: v })}`.
  - Agent cell: `TaskSelect` of agents (option "" = No agent) `disabled={!canEdit}` `onChange={(v) => onPatch(task.id, { agent_email: v || null })}`. (Agents passed via a new `agents` prop — see Task 4 wiring; reuse `TaskAgent`.)
  - Assignee cell: `TaskSelect` of assignees `disabled={!isManager}` (only managers reassign) `onChange={(v) => onPatch(task.id, v ? { assignee_email: v, status: task.status === "backlog" ? "todo" : task.status } : { assignee_email: null, status: "backlog" })}`; show `Initials` next to it.
  - Category cell: `TaskSelect` of categories (option "" = No category) `disabled={!canEdit}` `onChange={(v) => onPatch(task.id, { category_id: v || null })}`.
  - Due cell: `DueBadge`.
  - Updated cell: `new Date(task.updated_at).toLocaleDateString()`.
- Styling: Jira palette, `divide-y divide-[#ebecf0]`, row hover `bg-[#f4f5f7]`, header `bg-[#f4f5f7] text-[#6b778c] text-xs font-bold uppercase`. Horizontal `overflow-x-auto` wrapper so narrow screens scroll the table (not the page).
- Add `agents: TaskAgent[]` to the props (used by the Agent cell). Update the Produces signature accordingly.

- [ ] **Step 2: Verify type-check**

Run: `npx tsc --noEmit`
Expected: No errors. (Component not yet mounted; Task 4 wires it.)

- [ ] **Step 3: Commit**

```bash
git add "src/app/(authed)/tasks/_components/TaskListView.tsx"
git commit -m "feat(tasks): add sortable List view with inline edit"
```

---

### Task 4: `TaskToolbar` + `TaskBoardClient` integration (3 views + facets)

**Files:**
- Create: `src/app/(authed)/tasks/_components/TaskToolbar.tsx`
- Modify: `src/app/(authed)/tasks/_components/TaskBoardClient.tsx`

**Interfaces:**
- `TaskToolbar` consumes the agent avatar group + quick-filter menu (move these out of TaskBoardClient into TaskToolbar, OR keep them in TaskBoardClient and pass as children — implementer's choice, but the avatar group + quick filters must end up rendered by the toolbar). Props: `{ view, onViewChange, isManager, query, onQuery, agentStats, agentFilter, onAgentFilter, quickOptions, quickValue, onQuickChange, priorities, priority, onPriority, categories, category, onCategory, statuses?, status?, onStatus?, showStatusFacet, resultCount, totalCount, onClearAll }`.
- `TaskBoardClient` produces: `view` state, `priorityFilter`/`categoryFilter`/`statusFilter` state, uses `filterTasks` for `visibleTasks`, renders toolbar + the active view.

- [ ] **Step 1: Refactor TaskBoardClient filter logic to use `filterTasks`**

In `TaskBoardClient.tsx`: import `filterTasks`, `ALL_AGENTS`, `NO_AGENT`, `type QuickFilter` from `@/lib/tasks/filtering` (remove the local `ALL_AGENTS`/`NO_AGENT`/`QuickFilter` definitions and the inline `.filter(...)` body of `visibleTasks`). Add state:
```tsx
const [view, setView] = useState<"board" | "list" | "backlog">("board");
const [priorityFilter, setPriorityFilter] = useState<"" | TaskPriority>("");
const [categoryFilter, setCategoryFilter] = useState<"" | string>("");
const [statusFilter, setStatusFilter] = useState<"" | TaskStatus>("");
```
Rewrite `visibleTasks` to call `filterTasks(tasks, { query, agent: agentFilter, quick: quickFilters, priority: priorityFilter, category: categoryFilter, status: view === "list" ? statusFilter : "", currentEmail, searchText })` where `searchText` builds the richer string (title, description, agent label, assignee, reporter, category name) using `agentLabelByEmail`/`categoryById`. Keep `agentStats`/`agentChoices` as-is (they already use ALL_AGENTS/NO_AGENT — now imported).

- [ ] **Step 2: Build `TaskToolbar` and replace the inline toolbar markup**

Create `TaskToolbar.tsx` containing: the search input, the agent avatar group (move `AgentFilterBar`/`AgentAvatar`/`AgentOverflowMenu` here, or import them), facet `TaskSelect` dropdowns for Priority and Category (and Status when `showStatusFacet`), the `QuickFilterMenu` (move here or import), a "Clear all" button (resets query/agent/quick/priority/category/status), the "X of Y" count, and a right-aligned **view switcher** segmented control (Board / List / Backlog — Backlog shown only when `isManager`). Use the Jira palette. In `TaskBoardClient`, replace the existing header filter row with `<TaskToolbar ... />`, passing all state + setters; `showStatusFacet={view === "list"}`.

- [ ] **Step 3: Render the three views by `view`**

In `TaskBoardClient` body:
```tsx
{view === "board" && (
  <KanbanBoard tasks={visibleTasks} onOpen={setOpenId} onMove={moveTask} categories={categories} />
)}
{view === "list" && (
  <TaskListView
    tasks={visibleTasks}
    categories={categories}
    assignees={assignees}
    agents={agents}
    isManager={isManager}
    currentEmail={currentEmail}
    onOpen={setOpenId}
    onPatch={patchTask}
  />
)}
{view === "backlog" && isManager && (
  <BacklogBoard tasks={tasks} assignees={assignees} agents={agents} categories={categories}
    onOpen={setOpenId} onAssign={(id, email) => patchTask(id, { assignee_email: email, status: "todo" })}
    onReorder={(id, position) => patchTask(id, { position })} onCreate={createTask} />
)}
```
Import `TaskListView` (Task 3) and `BacklogBoard` (Task 6). Remove the old `tab` state, the `Tab` type, the old `<TabButton>` usage, and the direct `BacklogList` import (BacklogList is removed in Task 6).

- [ ] **Step 4: Verify build**

Run: `npx tsc --noEmit` then `npx next build`
Expected: No type errors; build succeeds. (BacklogBoard must exist — do Task 6 before building, or temporarily render the old BacklogList until Task 6; recommended order: Task 6 then this step.)

- [ ] **Step 5: Commit**

```bash
git add "src/app/(authed)/tasks/_components/TaskToolbar.tsx" "src/app/(authed)/tasks/_components/TaskBoardClient.tsx"
git commit -m "feat(tasks): add 3-view switcher + shared toolbar with facets"
```

---

### Task 5: Status label map shared by Board/List/Toolbar

**Files:**
- Modify: `src/lib/tasks/types.ts` (append a `STATUS_LABEL` constant) OR add to `board-ui.tsx`.

- [ ] **Step 1: Add the label map**

Append to `src/lib/tasks/types.ts`:
```typescript
export const STATUS_LABEL: Record<TaskStatus, string> = {
  backlog: "Backlog",
  todo: "To Do",
  in_progress: "In Progress",
  waiting: "Waiting",
  done: "Done",
};
```
Use it in `TaskListView` (status options/labels) and the toolbar Status facet. (KanbanBoard already has a local `COLUMN_LABEL`; leave it or switch to `STATUS_LABEL` — optional.)

- [ ] **Step 2: tsc + commit**

Run: `npx tsc --noEmit` (Expected: clean).
```bash
git add src/lib/tasks/types.ts
git commit -m "feat(tasks): add shared STATUS_LABEL map"
```

---

### Task 6: `BacklogBoard` — rich rows + drag-to-reorder + inline create

**Files:**
- Create: `src/app/(authed)/tasks/_components/BacklogBoard.tsx`
- Remove: `src/app/(authed)/tasks/_components/BacklogList.tsx`

**Interfaces:**
- Consumes: `@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities`; `midpoint` from `@/lib/tasks/ordering`; `TaskRow`, `TaskCategory` types; `TaskAgent`/`TaskAssignee` from assignees; `TaskSelect`, `PriorityIcon`, `DueBadge`, `Initials` from existing.
- Produces: `BacklogBoard({ tasks, assignees, agents, categories, onOpen, onAssign, onReorder, onCreate })` where `onReorder(taskId, position) => void` and `onCreate(payload) => Promise<void>` (same `NewTaskPayload` shape; status defaults to backlog on the server when no assignee).

- [ ] **Step 1: Implement the component**

Create `BacklogBoard.tsx`. Requirements:
- `const backlog = tasks.filter(t => t.status === "backlog").sort((a,b) => a.position - b.position);`
- Vertical dnd: wrap rows in `DndContext` (PointerSensor, distance 5) + `SortableContext` (verticalListSortingStrategy). Each row is a `useSortable` item. On `onDragEnd`, compute the destination index in the backlog array, derive `before`/`after` neighbour positions, `position = midpoint(before, after)`, call `onReorder(activeId, position)`. (Mirror the KanbanBoard ordering math; single column.)
- Each row shows: drag handle (lucide `GripVertical`), `PriorityIcon`, `taskKey(id)` (import from sorting), title button → `onOpen`, category chip + agent chip (small), `DueBadge`, and an **Assign** `TaskSelect` (option "" = "Assign…") → `onAssign(id, email)`.
- **Inline create row** at the bottom: an always-present row with a text input ("+ Create task") + Enter/blur → `onCreate({ title, description: "", priority: "medium", due_date: "" })`; clear after success. Manager-only (the whole BacklogBoard is manager-only, so always shown here).
- Empty state: keep the existing dashed "Backlog is empty." panel (still show the inline-create row above/below it).
- Jira palette, card-like container with header "Backlog {count}".

- [ ] **Step 2: Remove BacklogList**

```bash
git rm "src/app/(authed)/tasks/_components/BacklogList.tsx"
```
Ensure `TaskBoardClient` imports `BacklogBoard` (Task 4 Step 3) and no longer references `BacklogList`.

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit` then `npx next build`
Expected: No type errors; build succeeds; `/tasks` route builds.

- [ ] **Step 4: Manual verification**

`npm run dev`, sign in: switch Board/List/Backlog; in List sort each column both ways and inline-edit status/priority/assignee/category (as Manager any row; as CS only own rows are enabled); in Backlog drag to reorder and inline-create a task; confirm Search/Agent/Priority/Category/Status filters apply on Board + List.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(authed)/tasks/_components/BacklogBoard.tsx"
git commit -m "feat(tasks): redesign Backlog (rich rows, drag-to-order, inline create)"
```

---

## Self-Review

**Spec coverage:**
- 3 views Board/List/Backlog + switcher → Task 4. ✓
- Shared toolbar + facets (Priority/Category/Status) → Tasks 2, 4. ✓
- List view: flat sortable + inline edit + row→drawer → Tasks 1, 3. ✓
- Backlog: rich rows + drag-reorder + inline create → Task 6. ✓
- Board polish: kept (already shipped); column labels via STATUS_LABEL optional → Task 5. ✓
- Pure helpers `sortTasks` + `filterTasks` unit-tested → Tasks 1, 2. ✓
- CS scope / `canEdit` disabling inline controls → Tasks 3, 4 (per-row canEdit), server unchanged. ✓
- No API/schema change → enforced by Global Constraints. ✓

**Placeholder scan:** Tasks 1, 2 carry complete code + tests. Tasks 3, 4, 6 are component specs with exact props/interfaces, per-cell behavior, and palette — concrete enough to implement without guesswork; no "TBD"/"handle edge cases".

**Type consistency:** `onPatch(id, patch)` matches `TaskBoardClient.patchTask`. `QuickFilter`/`ALL_AGENTS`/`NO_AGENT` defined once in `filtering.ts` and imported by TaskBoardClient + toolbar. `SortKey`/`SortDir`/`taskKey` from `sorting.ts` used by TaskListView. `STATUS_LABEL` (Task 5) consumed by List + toolbar. `BacklogBoard` `onReorder`/`onCreate` match the wiring in Task 4 Step 3.

**Build-order note:** Task 6 (BacklogBoard) should be implemented before Task 4's `next build` step (Task 4 references BacklogBoard). Suggested execution order: 1 → 2 → 5 → 3 → 6 → 4.
