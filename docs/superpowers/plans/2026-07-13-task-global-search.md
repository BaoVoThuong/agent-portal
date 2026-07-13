# Global Task Search — Implementation Plan

> **For a human implementer:** hand-coding plan. Pure logic is TDD'd first; wiring is verified with `npm run typecheck && npm run lint && npm run test:run && npm run build`. Spec: `docs/superpowers/specs/2026-07-13-task-global-search-design.md`.

**Goal:** A Slack-style global search palette that finds tasks by **title**, comments by **body**, and attachments by **file name**, scoped to what the actor can already see, and jumps to the task (comment hits scroll+highlight the comment). The board is never keyword-filtered.

**Architecture:** New `GET /api/tasks/search` backed by Postgres `pg_trgm` ILIKE. Visibility reuses the board's `canViewTask` (single source of truth) over the small match set — no per-keystroke full fetch. A new `SearchPalette` overlay replaces the toolbar keyword filter as the search entry point. A comment anchor is added to the existing deep-link.

**Tech Stack:** Next.js App Router, Supabase (service role), Postgres `pg_trgm`, Vitest, TypeScript. (See `agent-portal/AGENTS.md`.)

## Global Constraints
- Pure helpers (`src/lib/tasks/search.ts`) stay unit-tested; DB access is thin around them.
- **Access scope is a hard rule** — every hit passes `canViewTask` with the same inputs as `fetchTasksForActor`. Enforced server-side only.
- English UI copy. Don't push to `vercel`. Commit after each task. Min query length: **2 chars**.

## Types (single source, in `src/lib/tasks/search.ts`)
```ts
import type { TaskStatus } from "./types";

export type SearchSnippet = { text: string; matchStart: number; matchLen: number };
export type TaskHit = { id: string; key: string; title: string; agent_email: string | null; status: TaskStatus };
export type CommentHit = { comment_id: string; task_id: string; task_title: string; snippet: SearchSnippet; author_email: string; created_at: string };
export type FileHit = { attachment_id: string; task_id: string; task_title: string; comment_id: string | null; file_name: string };
export type SearchResults = {
  tasks: TaskHit[]; comments: CommentHit[]; files: FileHit[];
  truncated: { tasks: boolean; comments: boolean; files: boolean };
};

// Minimal task metadata needed to decide visibility of any hit.
export type TaskVisibilityMeta = { task_id: string; agent_email: string | null; assignee_email: string | null };
export type VisibilityScope = {
  agents: string[]; assistantAgents: string[];
  assignedIds: Set<string>; participantIds: Set<string>; assigneeByTask: Map<string, string[]>;
};
```

---

## Task 1: Migration — pg_trgm + GIN indexes

**Files:** modify `supabase/schema.sql`.

- [ ] **Step 1:** Append (idempotent — safe to re-run):

```sql
-- Global task search (trigram substring match on title / comment body / file name).
create extension if not exists pg_trgm;
create index if not exists tasks_title_trgm_idx on tasks using gin (title gin_trgm_ops);
create index if not exists task_comments_body_trgm_idx on task_comments using gin (body gin_trgm_ops);
create index if not exists task_attachments_file_name_trgm_idx on task_attachments using gin (file_name gin_trgm_ops);
```

- [ ] **Step 2:** Run the statements against the Supabase DB (SQL editor). Verify with
  `explain analyze select id from task_comments where body ilike '%test%';` → uses the GIN index.
- [ ] **Step 3:** Commit (`feat(tasks): trigram indexes for global search`).

---

## Task 2: Pure helpers — snippet + visibility (TDD)

**Files:** create `src/lib/tasks/search.ts`, `src/lib/tasks/search.test.ts`.

**Interfaces — Produces:**
- `buildSnippet(body: string, query: string, radius?: number): SearchSnippet`
- `isHitVisible(actor: TaskActor, meta: TaskVisibilityMeta, scope: VisibilityScope): boolean`

- [ ] **Step 1: Failing tests** (`search.test.ts`):

```ts
import { describe, expect, it } from "vitest";
import { buildSnippet, isHitVisible, type VisibilityScope } from "@/lib/tasks/search";
import { buildTaskActor } from "@/lib/tasks/access";

describe("buildSnippet", () => {
  it("windows around the first match and reports the span", () => {
    const body = "The quick brown fox jumps over the lazy dog again and again";
    const s = buildSnippet(body, "fox", 8);
    expect(s.text.slice(s.matchStart, s.matchStart + s.matchLen).toLowerCase()).toBe("fox");
    expect(s.text.length).toBeLessThan(body.length);
    expect(s.text).toContain("fox");
  });
  it("no match → head of string, zero-length span", () => {
    const s = buildSnippet("hello world", "zzz", 5);
    expect(s.matchLen).toBe(0);
    expect(s.text.startsWith("hello")).toBe(true);
  });
});

describe("isHitVisible", () => {
  const scope: VisibilityScope = {
    agents: ["agentA@x.com"], assistantAgents: ["agentB@x.com"],
    assignedIds: new Set(["t-assigned"]), participantIds: new Set(["t-part"]),
    assigneeByTask: new Map([["t-assigned", ["cs@x.com"]]]),
  };
  const cs = buildTaskActor(["task.work"], "cs@x.com");
  const admin = buildTaskActor(["task.manage"], "admin@x.com", { isAdmin: true });

  it("admin sees every hit", () => {
    expect(isHitVisible(admin, { task_id: "x", agent_email: "other@x.com", assignee_email: null }, scope)).toBe(true);
  });
  it("worker sees their agent-owner / assisted / assigned / participant hits", () => {
    expect(isHitVisible(cs, { task_id: "t1", agent_email: "agentB@x.com", assignee_email: null }, scope)).toBe(true); // assistant → owner
    expect(isHitVisible(cs, { task_id: "t-part", agent_email: "other@x.com", assignee_email: null }, scope)).toBe(true); // participant
  });
  it("worker sees a member-team hit only when the task has an assignee", () => {
    expect(isHitVisible(cs, { task_id: "t2", agent_email: "agentA@x.com", assignee_email: "someone@x.com" }, scope)).toBe(true);
    expect(isHitVisible(cs, { task_id: "t3", agent_email: "agentA@x.com", assignee_email: null }, scope)).toBe(false); // backlog of a team they're only a member of
  });
  it("worker cannot see an unrelated task's hit", () => {
    expect(isHitVisible(cs, { task_id: "zzz", agent_email: "stranger@x.com", assignee_email: "x@x.com" }, scope)).toBe(false);
  });
});
```

- [ ] **Step 2:** Run `npx vitest run src/lib/tasks/search.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** `search.ts` (types block above, plus):

```ts
import { canViewTask } from "./access";
import type { TaskActor } from "./types";

export function buildSnippet(body: string, query: string, radius = 60): SearchSnippet {
  const lower = body.toLowerCase();
  const idx = lower.indexOf(query.trim().toLowerCase());
  if (idx < 0) {
    const text = body.length > radius * 2 ? `${body.slice(0, radius * 2)}…` : body;
    return { text, matchStart: 0, matchLen: 0 };
  }
  const start = Math.max(0, idx - radius);
  const end = Math.min(body.length, idx + query.length + radius);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < body.length ? "…" : "";
  const text = `${prefix}${body.slice(start, end)}${suffix}`;
  return { text, matchStart: prefix.length + (idx - start), matchLen: query.length };
}

// Reuses canViewTask so search visibility can never drift from board visibility.
export function isHitVisible(actor: TaskActor, meta: TaskVisibilityMeta, scope: VisibilityScope): boolean {
  const assignees = scope.assigneeByTask.get(meta.task_id) ?? [];
  return canViewTask(
    actor,
    { assignee_email: meta.assignee_email },
    {
      isAssignee: assignees.includes(actor.email) || meta.assignee_email === actor.email,
      isAgentMember: Boolean(meta.agent_email && scope.agents.includes(meta.agent_email)),
      isAgentOwner: Boolean(
        meta.agent_email &&
          (meta.agent_email === actor.email || scope.assistantAgents.includes(meta.agent_email))
      ),
      isParticipant: scope.participantIds.has(meta.task_id),
    }
  );
}
```

- [ ] **Step 4:** Tests PASS. Commit (`feat(tasks): pure snippet + hit-visibility helpers`).

---

## Task 3: Search query layer

**Files:** modify `src/lib/tasks/search.ts` (add `runTaskSearch`).

**Interfaces — Produces:** `runTaskSearch(actor: TaskActor, rawQuery: string): Promise<SearchResults>`.
**Consumes:** `fetchAgentsForCs`, `fetchAssistantAgentsForCs` (membership), `fetchAssignedTaskIdsForEmail` (assignees), `fetchParticipantTaskIds` (participants), `taskKey` (sorting), `isHitVisible`, `buildSnippet`.

- [ ] **Step 1:** Implement. Strategy: run 3 capped ILIKE queries, gather all task ids, load their
  meta once, drop archived, filter every candidate through `isHitVisible` (skipped for managers).

```ts
import { getSupabaseAdmin } from "@/lib/supabase";
import { fetchAgentsForCs, fetchAssistantAgentsForCs } from "./membership";
import { fetchAssignedTaskIdsForEmail } from "./assignees";
import { fetchParticipantTaskIds } from "./participants";
import { taskKey } from "./sorting";

const GROUP_LIMIT = 6;
const CANDIDATE_LIMIT = 40; // per source, before visibility filtering

function escapeIlike(q: string): string {
  return q.replace(/[\\%_]/g, (c) => `\\${c}`); // treat wildcards literally
}

export async function runTaskSearch(actor: TaskActor, rawQuery: string): Promise<SearchResults> {
  const q = rawQuery.trim();
  const empty: SearchResults = { tasks: [], comments: [], files: [], truncated: { tasks: false, comments: false, files: false } };
  if (q.length < 2) return empty;

  const sb = getSupabaseAdmin();
  const pattern = `%${escapeIlike(q)}%`;

  const [titleRows, commentRows, fileRows] = await Promise.all([
    sb.from("tasks").select("id,title,agent_email,assignee_email,status,archived_at")
      .ilike("title", pattern).is("archived_at", null).limit(CANDIDATE_LIMIT + 1),
    sb.from("task_comments").select("id,task_id,body,author_email,created_at")
      .ilike("body", pattern).is("deleted_at", null).order("created_at", { ascending: false }).limit(CANDIDATE_LIMIT + 1),
    sb.from("task_attachments").select("id,task_id,comment_id,file_name")
      .ilike("file_name", pattern).limit(CANDIDATE_LIMIT + 1),
  ]);
  const titles = titleRows.data ?? [];
  const comments = commentRows.data ?? [];
  const files = fileRows.data ?? [];

  // Load meta for every task referenced by any hit (comments/files don't carry it).
  const taskIds = [...new Set([
    ...titles.map((t) => t.id),
    ...comments.map((c) => c.task_id),
    ...files.map((f) => f.task_id),
  ])];
  const metaById = new Map<string, { title: string; agent_email: string | null; assignee_email: string | null; status: string }>();
  if (taskIds.length > 0) {
    const { data: metaRows } = await sb.from("tasks")
      .select("id,title,agent_email,assignee_email,status,archived_at")
      .in("id", taskIds).is("archived_at", null);
    for (const m of metaRows ?? []) metaById.set(m.id, m);
  }

  // Scope inputs — same sources as fetchTasksForActor. Managers skip visibility filtering.
  let scope: VisibilityScope | null = null;
  if (!actor.isManager) {
    const [agents, assistantAgents, assignedIds, participantIds] = await Promise.all([
      fetchAgentsForCs(actor.email),
      fetchAssistantAgentsForCs(actor.email),
      fetchAssignedTaskIdsForEmail(actor.email, sb),
      fetchParticipantTaskIds(actor.email),
    ]);
    const assigneeByTask = new Map<string, string[]>();
    if (taskIds.length > 0) {
      const { data: aRows } = await sb.from("task_assignees").select("task_id,assignee_email").in("task_id", taskIds);
      for (const r of aRows ?? []) {
        const list = assigneeByTask.get(r.task_id) ?? [];
        list.push(r.assignee_email);
        assigneeByTask.set(r.task_id, list);
      }
    }
    scope = { agents, assistantAgents, assignedIds: new Set(assignedIds), participantIds: new Set(participantIds), assigneeByTask };
  }

  const visible = (meta: { task_id: string; agent_email: string | null; assignee_email: string | null }) =>
    !scope || isHitVisible(actor, meta, scope);

  const taskHits: TaskHit[] = [];
  for (const t of titles) {
    const m = metaById.get(t.id);
    if (!m) continue;
    if (!visible({ task_id: t.id, agent_email: m.agent_email, assignee_email: m.assignee_email })) continue;
    taskHits.push({ id: t.id, key: taskKey(t.id), title: m.title, agent_email: m.agent_email, status: m.status as TaskStatus });
  }
  const commentHits: CommentHit[] = [];
  for (const c of comments) {
    const m = metaById.get(c.task_id);
    if (!m) continue;
    if (!visible({ task_id: c.task_id, agent_email: m.agent_email, assignee_email: m.assignee_email })) continue;
    commentHits.push({ comment_id: c.id, task_id: c.task_id, task_title: m.title, snippet: buildSnippet(c.body, q), author_email: c.author_email, created_at: c.created_at });
  }
  const fileHits: FileHit[] = [];
  for (const f of files) {
    const m = metaById.get(f.task_id);
    if (!m) continue;
    if (!visible({ task_id: f.task_id, agent_email: m.agent_email, assignee_email: m.assignee_email })) continue;
    fileHits.push({ attachment_id: f.id, task_id: f.task_id, task_title: m.title, comment_id: f.comment_id, file_name: f.file_name });
  }

  return {
    tasks: taskHits.slice(0, GROUP_LIMIT),
    comments: commentHits.slice(0, GROUP_LIMIT),
    files: fileHits.slice(0, GROUP_LIMIT),
    truncated: { tasks: taskHits.length > GROUP_LIMIT, comments: commentHits.length > GROUP_LIMIT, files: fileHits.length > GROUP_LIMIT },
  };
}
```

> Note: confirm the multi-assignee table name is `task_assignees` (matches `attachAssigneesToTasks`); adjust the select if the column differs.

- [ ] **Step 2:** `npm run typecheck` clean. Commit (`feat(tasks): scoped runTaskSearch`).

---

## Task 4: Search API route

**Files:** create `src/app/api/tasks/search/route.ts`.

- [ ] **Step 1:** Implement (mirror the auth pattern of `api/tasks/route.ts`):

```ts
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { buildTaskActor, canAccessBoard, isTaskViewAdmin } from "@/lib/tasks/access";
import { runTaskSearch } from "@/lib/tasks/search";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const actor = buildTaskActor(session.user.permissions, email, { isAdmin: isTaskViewAdmin(session.user) });
  if (!canAccessBoard(actor)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const q = new URL(request.url).searchParams.get("q") ?? "";
  const results = await runTaskSearch(actor, q);
  return NextResponse.json(results);
}
```

- [ ] **Step 2:** `npm run typecheck && npm run lint` clean. Manual: `curl` as a CS session → confirm no comment/file hit from a task outside scope; as admin → hits across tasks. Commit (`feat(tasks): GET /api/tasks/search`).

---

## Task 5: Comment-anchor deep link

**Files:** modify `src/lib/tasks/client-events.ts`, `TaskBoardClient.tsx`, `TaskDetailDrawer.tsx`, `CommentThread.tsx`.

- [ ] **Step 1:** `client-events.ts` — carry an optional comment id:

```ts
type OpenTaskEventDetail = { taskId: string; commentId?: string };

export function dispatchOpenTask(taskId: string, commentId?: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<OpenTaskEventDetail>(OPEN_TASK_EVENT, { detail: { taskId, commentId } }));
}
```
Extend `writeTaskDeepLink(taskId, mode, commentId?)` to `set`/`delete` the `comment` search param alongside `task`.

- [ ] **Step 2:** `TaskBoardClient.tsx` — add `const [openCommentId, setOpenCommentId] = useState<string | null>(() => searchParams.get("comment"))`. In the `OPEN_TASK_EVENT` handler, `setOpenCommentId(detail.commentId ?? null)` and pass the comment id to `writeTaskDeepLink`. Pass `highlightCommentId={openCommentId}` to `<TaskDetailDrawer>`. Clear it when the drawer closes.

- [ ] **Step 3:** `TaskDetailDrawer.tsx` — accept `highlightCommentId?: string | null` and forward it to `<CommentThread highlightCommentId={highlightCommentId} />`.

- [ ] **Step 4:** `CommentThread.tsx` — give each rendered comment wrapper a stable anchor and scroll+flash on match. At the `topLevel.map((c) => <div key={c.id} …>)` (and the reply wrapper), add `data-comment-id={c.id}`. Add:

```ts
useEffect(() => {
  if (!highlightCommentId) return;
  const el = rootRef.current?.querySelector(`[data-comment-id="${highlightCommentId}"]`);
  if (!el) return;
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  el.classList.add("comment-flash");
  const t = window.setTimeout(() => el.classList.remove("comment-flash"), 2000);
  return () => window.clearTimeout(t);
}, [highlightCommentId, rows]); // rows so it re-runs once the thread has loaded
```
Add a `rootRef` on the thread container and a `.comment-flash` CSS rule (brief background pulse).

- [ ] **Step 5:** `npm run typecheck && npm run lint && npm run build` clean. Manual: open `?task=X&comment=Y` → drawer opens, thread scrolls to + flashes comment Y. Commit (`feat(tasks): comment-anchor deep link`).

---

## Task 6: Inline search box + results dropdown

**Files:** create `src/app/(authed)/tasks/_components/TaskSearchBox.tsx`.

**Interfaces — Produces:** `<TaskSearchBox labelByEmail={Map<string,string>} />` — a self-contained
search **input** with a results **dropdown anchored directly below it** (no modal, no ⌘K). Fetches,
renders grouped results, navigates via `dispatchOpenTask`. `labelByEmail` maps email → display name
so every row shows a **name, not an email**.

- [ ] **Step 1:** Implement the input + inline dropdown:

```tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { dispatchOpenTask } from "@/lib/tasks/client-events";
import type { SearchResults } from "@/lib/tasks/search";

export function TaskSearchBox({ labelByEmail }: { labelByEmail: Map<string, string> }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const nameOf = (email: string | null) => (email ? labelByEmail.get(email) ?? email : "");

  // Debounced, abortable. The board is NEVER touched — this only drives the dropdown.
  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) { setResults(null); setLoading(false); return; }
    setLoading(true); setError(false);
    const ctrl = new AbortController();
    abortRef.current?.abort();
    abortRef.current = ctrl;
    const t = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/tasks/search?q=${encodeURIComponent(query)}`, { signal: ctrl.signal });
        if (!res.ok) throw new Error();
        setResults((await res.json()) as SearchResults);
      } catch {
        if (!ctrl.signal.aborted) { setError(true); setResults(null); }
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 200);
    return () => { window.clearTimeout(t); ctrl.abort(); };
  }, [q]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (e.target instanceof Node && !rootRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const flat = results
    ? [
        ...results.tasks.map((t) => ({ taskId: t.id })),
        ...results.comments.map((c) => ({ taskId: c.task_id, commentId: c.comment_id })),
        ...results.files.map((f) => ({ taskId: f.task_id, commentId: f.comment_id ?? undefined })),
      ]
    : [];

  const choose = (row: { taskId: string; commentId?: string }) => {
    dispatchOpenTask(row.taskId, row.commentId);
    setOpen(false); setQ("");
  };

  const showDropdown = open && q.trim().length >= 2;
  return (
    <div ref={rootRef} className="relative w-full">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#44546f]" />
      <input
        value={q}
        onChange={(e) => { setQ(e.target.value); setActive(0); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") { setOpen(false); return; }
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, flat.length - 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
          if (e.key === "Enter" && flat[active]) choose(flat[active]);
        }}
        placeholder="Search tasks, comments, files…"
        className="h-10 w-full rounded border-2 border-transparent bg-[#f4f5f7] pl-10 pr-3 text-sm outline-none focus:border-[#0c66e4] focus:bg-white"
      />
      {showDropdown ? (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-[60vh] overflow-auto rounded-lg border border-[#dfe1e6] bg-white p-2 shadow-lg">
          {/* loading / error / empty; then 3 groups. Track a running flat index i
              (tasks, then comments, then files) to compare with `active` for highlight.
              - Tasks:    title + #key + nameOf(agent_email)
              - Comments: task_title + author nameOf(author_email) + snippet with the
                          matched span (snippet.text[matchStart..+matchLen]) wrapped in <mark>
              - Files:    file_name + task_title
              Each group header: label + count, "+ more" when truncated[group].
              Row onMouseEnter sets active; onClick={() => choose(row)}. */}
        </div>
      ) : null}
    </div>
  );
}
```

> **Names, not emails:** every person shown (comment author, agent) goes through `nameOf`. See the
> app-wide name rule below — `labelByEmail` is built from all `portal_account` rows so it covers
> everyone who can appear, falling back to the email only if that account has no name.

- [ ] **Step 2:** Fill the group rendering per the comment block (names via `nameOf`, snippet `<mark>`, active-row highlight, loading/empty/error states). `npm run typecheck && npm run lint && npm run build` clean. Commit (`feat(tasks): inline search box with results dropdown`).

---

## Task 7: Replace the toolbar keyword filter with the search box

**Files:** modify `TaskBoardClient.tsx`, `TaskToolbar.tsx`.

- [ ] **Step 1:** `TaskBoardClient.tsx` — build the name map and stop keyword-filtering the board:
  - `const labelByEmail = useMemo(() => new Map(assignees.map((a) => [a.email, a.name ?? a.email])), [assignees]);` (`assignees` = all `portal_account`, so this covers everyone shown).
  - In the `filterTasks({ … })` call set `query: ""` — the board no longer narrows by keyword.
  - Remove the now-unused `query`/`setQuery` state (lint will flag it otherwise).
- [ ] **Step 2:** `TaskToolbar.tsx` — replace the bottom search `<input>` (the old filter box, ~lines 339-348) with `<TaskSearchBox labelByEmail={labelByEmail} />`. Drop the `query`/`onQuery` props and add `labelByEmail` to `TaskToolbar`'s props; pass `labelByEmail` from `TaskBoardClient`. No ⌘K, no modal, no overlay.
- [ ] **Step 3:** `npm run typecheck && npm run lint && npm run test:run && npm run build` → all green.
- [ ] **Step 4:** Manual acceptance:
  - Typing ≥2 chars in the toolbar search shows a dropdown **right under the box** (Tasks/Comments/Files); the board below is **unchanged**.
  - Rows show **names, not emails** (comment author, agent).
  - ↑/↓/Enter + click work; a comment hit opens the drawer and scrolls+flashes that comment; outside-click/Esc closes the dropdown.
  - As a **CS**, a term only in a task they can't see → **no** hit; as **admin** → hit.
  Commit (`feat(tasks): inline global search wired into toolbar`).

---

## Self-Review
- **Spec coverage:** title/comment/file search → Tasks 1-4; scoping via `canViewTask` → Task 2/3 (tested); palette + board-untouched → Tasks 6-7; comment scroll+highlight → Task 5; pg_trgm infra → Task 1. ✓
- **Scope is a hard rule:** `runTaskSearch` filters every hit through `isHitVisible` (managers exempt), reusing `canViewTask` + the exact `fetchTasksForActor` inputs — search visibility cannot drift from board visibility. Enforced server-side; the client never receives out-of-scope hits. ✓
- **Consistency:** if the pending agent/assistant view-scope tightening lands in `fetchTasksForActor`/`canViewTask`, search follows automatically (same predicate). ✓
- **Type consistency:** `SearchResults`/`TaskHit`/`CommentHit`/`FileHit` defined once in `search.ts`, consumed by the route + palette unchanged. `dispatchOpenTask(taskId, commentId?)` used identically by the palette and handled in `TaskBoardClient`. ✓
- **No placeholders:** migration, pure helpers, query layer, route, and deep-link are complete code; only the palette's group markup (Task 6 Step 2) is left as structured guidance since it's pure presentation.
- **Watch-outs:** (a) confirm the multi-assignee table/column names (`task_assignees.assignee_email`) before shipping Task 3; (b) `escapeIlike` keeps user `%`/`_` literal; (c) removing `query` from the board filter must not leave a dangling unused var (lint) — delete the state if nothing else uses it; (d) `⌘K` listener must not fire while typing in another input — the global handler is fine because it only opens the palette (non-destructive).
```
