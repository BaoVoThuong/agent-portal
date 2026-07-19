# Task Board Latency Reduction

> **For a human implementer:** hand-coding plan. Each task is independently shippable; verify with `npm run typecheck && npm run lint && npm run test:run && npm run build` plus the latency measurement in Phase 0.

**Goal:** Cut the perceived latency of the three slow interactions — opening a task (2–3 s for comments), the search dropdown, and the category/board load — by removing **sequential DB round-trips**, verifying **indexes**, **caching the visibility scope**, and **prefetching**.

## Root causes (read from the code, not guessed)

| # | Symptom | Cause (evidence) | Fix |
|---|---|---|---|
| 1 | Whole board slow to load | `page.tsx:31-57` runs **~8 sequential** `await`s (tasks → assignees → agents → agentCandidates → myAgents → myAssistantAgents → agentMembersByAgent → categories), most independent | Phase 1.1 — parallelize |
| 2 | Task modal 2–3 s | `[id]/detail/route.ts` waves: task → `await isAgentOwnerOrAssistant` → `Promise.all(3 scope)` → `loadTaskDetail` = **~4 sequential waves** before responding; drawer only fetches **after** click (`TaskDetailDrawer.tsx:93`) | Phase 1.2 + Phase 3.1 (prefetch) |
| 3 | Search slow | `search.ts`: `Promise.all(3 ILIKE)` → meta → `Promise.all(4 scope)` → assignees = **~4 waves**; scope is independent of the ILIKE yet runs after it; scope recomputed **every keystroke** | Phase 1.3 + Phase 2 |
| 4 | Search slow (worse if…) | trigram indexes exist in `schema.sql:1854-1860` but may **not be applied** in the live DB → `ILIKE '%q%'` = full scan | Phase 0 |
| 5 | Category dropdown lag | admin `CategoryManager` refetches `/api/tasks/categories` on open; task-side category selects already use the SSR `categories` prop | mostly resolved by Phase 1.1; Phase 4.3 |

**Cross-cutting:** every route is `force-dynamic` (no HTTP cache) and each Supabase call is a network round-trip, so **reducing the number of *sequential* round-trips is the highest-leverage change**. No caching layer exists today (`cache()`/`unstable_cache` unused).

---

## Phase 0 — Measure + verify indexes (do FIRST; cheap, decisive)

- [ ] **0.1 Verify indexes are live.** In the Supabase SQL editor run:
  ```sql
  explain analyze select id from task_comments where body ilike '%test%';
  explain analyze select id from tasks where title ilike '%test%';
  ```
  If either shows **Seq Scan** (not a `Bitmap Index Scan` on the `*_trgm_idx`), the migration never ran — **re-run `supabase/schema.sql`** (it's idempotent). Do the same sanity check that `task_comments(task_id)`, `task_activity(task_id)`, `task_assignees(email)` indexes exist.
- [ ] **0.2 Add the one missing hot-path index** (search filters `task_assignees` by `task_id`, but only an `email` index exists). Append to `schema.sql` and run:
  ```sql
  create index if not exists task_assignees_task_idx on task_assignees (task_id);
  ```
- [ ] **0.3 Time the endpoints.** Temporarily wrap `runTaskSearch`, the detail route body, and `page.tsx` data-loading in `console.time`/`console.timeEnd` (or add a `Server-Timing` header). Open the browser **Network** tab and record the current ms for: `/api/tasks/[id]/detail`, `/api/tasks/search?q=…`, and the page document. Keep these numbers — they're the before/after baseline for every task below. Remove the logs before committing.

Commit 0.2 (`perf(tasks): index task_assignees by task_id`).

---

## Phase 1 — Collapse sequential DB round-trips (biggest win)

### Task 1.1 — Parallelize the SSR page load
**File:** `src/app/(authed)/tasks/page.tsx`.

- [ ] Replace the sequential `await`s (lines ~31-57) so all **independent** fetches run in one `Promise.all`, then derive the dependent pieces:

```ts
const [
  tasks,
  assignees,
  agents,
  agentCandidates,
  csAgents,        // only meaningful for non-managers
  myAssistantAgents,
  categoryRows,
] = await Promise.all([
  fetchTasksForActor(actor),
  fetchTaskAssignees(),
  fetchTaskAgents(),
  fetchTaskAgentCandidates(),
  actor.isManager ? Promise.resolve([]) : fetchAgentsForCs(email),
  actor.isManager ? Promise.resolve([]) : fetchAssistantAgentsForCs(email),
  getSupabaseAdmin()
    .from("task_categories")
    .select("id,name,color")
    .eq("is_active", true)
    .order("position", { ascending: true })
    .order("name", { ascending: true })
    .then((r) => r.data ?? []),
]);
const myAgents = actor.isManager ? agents.map((a) => a.email) : csAgents;
const categories = categoryRows as TaskCategory[];

// agentMembersByAgent depends on the above → its own (second) parallel wave.
const agentEmailsForMembers = [
  ...new Set([
    ...agents.map((a) => a.email),
    ...tasks.map((t) => t.agent_email).filter(Boolean),
    ...myAgents,
  ] as string[]),
];
const agentMembersByAgent = Object.fromEntries(
  await Promise.all(
    agentEmailsForMembers.map(async (agentEmail) => [
      agentEmail,
      await fetchCsForAgent(agentEmail),
    ])
  )
);
```

- [ ] `npm run build` and reload the board — the document TTFB should drop from ~8 waves to ~2. Commit (`perf(tasks): parallelize task board SSR data load`).

### Task 1.2 — One scope wave in the detail route
**File:** `src/app/api/tasks/[id]/detail/route.ts`.

- [ ] After fetching the task, run **all** scope checks in a single `Promise.all` (fold the separate `await isAgentOwnerOrAssistant`), and — for the common authorized case — start `loadTaskDetail` **in parallel** with the scope check, gating only the *response* on the result:

```ts
if (actor.isManager) {
  return NextResponse.json(
    await loadTaskDetail(supabase, id, {
      includeActivity: true, includeCommentAttachments: false, includeTaskAttachments: false,
    })
  );
}

// Non-manager: scope + detail computed together (one wave), response gated on scope.
const [isAgentOwner, isParticipant, isAssignee, agents, detail] = await Promise.all([
  isAgentOwnerOrAssistant(taskScope.agent_email, actor.email),
  isTaskParticipant(id, actor.email),
  isTaskAssignee(id, actor.email, supabase),
  fetchAgentsForCs(actor.email),
  loadTaskDetail(supabase, id, {
    includeActivity: true, // trimmed below if not allowed
    includeCommentAttachments: false,
    includeTaskAttachments: false,
  }),
]);
const isAgentMember = Boolean(taskScope.agent_email && agents.includes(taskScope.agent_email));
if (!canViewTask(actor, taskScope, { isParticipant, isAgentMember, isAgentOwner, isAssignee })) {
  return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
}
// Activity is owner/assistant-only: drop it if this viewer isn't one.
return NextResponse.json(isAgentOwner ? detail : { ...detail, activity: [] });
```

> Trade-off: an *unauthorized* viewer causes one wasted `loadTaskDetail` (2 small indexed queries) that's then discarded — acceptable, and it's their own request. If you'd rather not, keep the same single `Promise.all` for the 4 scope checks and run `loadTaskDetail` after (still 3 waves → down from 4). The parallel version is ~2 waves.

- [ ] Verify a CS still gets 403 on a task outside their scope. Commit (`perf(tasks): single-wave scope + detail in detail route`).

### Task 1.3 — Parallelize search scope with the ILIKEs
**File:** `src/lib/tasks/search.ts` (`runTaskSearch`).

- [ ] The scope inputs (`fetchAgentsForCs`/`fetchAssistantAgentsForCs`/`fetchAssignedTaskIdsForEmail`/`fetchParticipantTaskIds`) depend only on `actor.email`, not on the ILIKE results — start them **together** with the 3 ILIKE queries instead of after. Structure:

```ts
const scopePromise = actor.isManager
  ? Promise.resolve(null)
  : Promise.all([
      fetchAgentsForCs(actor.email),
      fetchAssistantAgentsForCs(actor.email),
      fetchAssignedTaskIdsForEmail(actor.email, supabase),
      fetchParticipantTaskIds(actor.email),
    ]);

const [titleRows, commentRows, fileRows, scopeParts] = await Promise.all([
  /* 3 ILIKE queries */,
  scopePromise,
]);
// build taskIds from the rows, then ONE more wave for meta + assignees:
const [metaRows, assigneeRows] = await Promise.all([
  taskIds.length ? sb.from("tasks").select("…").in("id", taskIds).is("archived_at", null) : Promise.resolve({ data: [] }),
  scopeParts && taskIds.length ? sb.from("task_assignees").select("task_id,email").in("task_id", taskIds) : Promise.resolve({ data: [] }),
]);
```

This turns ~4 waves into **2**. Keep the visibility filtering (`isHitVisible`) exactly as-is.

- [ ] Confirm scoping still holds (CS gets no out-of-scope hit). Commit (`perf(tasks): parallelize search scope with ILIKE queries`).

---

## Phase 2 — Cache the visibility scope (search per-keystroke)

**File:** new `src/lib/tasks/scope-cache.ts`; use in `search.ts`.

Search recomputes 4 membership queries on **every** debounced keystroke. Membership changes rarely, so a short TTL cache keyed by email is safe.

- [ ] Implement a tiny in-memory TTL cache (module-level `Map<email, { value, expires }>`, TTL 60 s) returning the scope tuple; call it from `runTaskSearch` instead of the raw fetches. Reuse the same helper for the detail route if desired.

```ts
type Scope = { agents: string[]; assistantAgents: string[]; assignedIds: string[]; participantIds: string[] };
const cache = new Map<string, { value: Scope; expires: number }>();
const TTL_MS = 60_000;

export async function getViewerScope(email: string, supabase: SupabaseClient): Promise<Scope> {
  const hit = cache.get(email);
  if (hit && hit.expires > Date.now()) return hit.value;
  const [agents, assistantAgents, assignedIds, participantIds] = await Promise.all([
    fetchAgentsForCs(email), fetchAssistantAgentsForCs(email),
    fetchAssignedTaskIdsForEmail(email, supabase), fetchParticipantTaskIds(email),
  ]);
  const value = { agents, assistantAgents, assignedIds, participantIds };
  cache.set(email, { value, expires: Date.now() + TTL_MS });
  return value;
}
```

> Trade-off: a brand-new membership/assignment shows up in *search scope* up to 60 s late (the board fetch is unaffected). If that's not acceptable, invalidate `cache.delete(email)` in the assign/agent-member routes, or skip this phase — Phase 1.3 alone already halves search waves.

- [ ] Commit (`perf(tasks): cache viewer scope for search`).

---

## Phase 3 — Prefetch + perceived latency

### Task 3.1 — Prefetch task detail on hover/press
**Files:** `TaskCard.tsx` / `TaskRowItem.tsx` (the openers), `TaskDetailDrawer.tsx` (expose the cache warmer).

- [ ] Export a `prefetchTaskDetail(id)` that does the same `fetch(`/api/tasks/${id}/detail`)` and writes `detailCache` (extract the drawer's `reload` body into a shared function using the existing `detailCache`). On a card's `onMouseEnter`/`onPointerDown`, call `prefetchTaskDetail(task.id)` (fire-and-forget, dedupe in-flight). By the time the click opens the drawer, the cache is usually warm → **instant**.
- [ ] Commit (`perf(tasks): prefetch task detail on hover`).

### Task 3.2 — Loading skeletons
**Files:** `TaskDetailDrawer.tsx`, `SearchPalette`/`TaskSearchBox`.

- [ ] While `detail === null`, show a lightweight comment/activity **skeleton** instead of blank, so the 1st open reads as "loading" not "frozen". The search dropdown already has a spinner; add a 2–3 row skeleton on first query. Perceived-latency only. Commit.

---

## Phase 4 — Payload + misc (lower priority)

- [ ] **4.1 Attachment signing:** `signTaskFile` = one `createSignedUrl` round-trip **per file** (`detail.ts:173`). The detail-open path already skips attachments, but the **Attachments tab** signs N files on open. Batch/lazy-sign (sign only visible ones, or on click) if that tab is slow.
- [ ] **4.2 Trim columns:** `TASK_COLUMNS` (`queries.ts`) selects ~35 columns for every board task. If the board render only needs a subset, select the subset for the list fetch (smaller payload, faster parse). Measure first.
- [ ] **4.3 Category manager:** `CategoryManager` refetches on open; seed it from the `categories` prop the board already holds and refetch in the background, so it renders instantly.

---

## Self-Review
- **Evidence-first:** every task cites the file:line it fixes; Phase 0 forces a measured before/after so we don't optimize blind.
- **Highest leverage first:** Phase 1 (parallelizing waves) is pure in-app refactor, no infra, and targets the exact 3 slow paths. Phase 0 catches the "indexes never applied" cliff cheaply.
- **Safety preserved:** every change keeps the visibility rules — detail route still gates the response on `canViewTask`; search still filters through `isHitVisible`. The only behavioral trade-offs (speculative detail fetch for unauthorized users; 60 s scope-cache staleness in search) are called out with opt-outs.
- **Independently shippable:** tasks can land one at a time, each measurable against the Phase 0 baseline.
- **Watch-outs:** (a) Phase 1.1 — `myAgents` for managers derives from `agents`, so it can't sit *inside* the same Promise.all; compute it after. (b) Phase 1.2 speculative fetch wastes one detail query for unauthorized viewers — use the non-speculative variant if you dislike that. (c) Phase 2 module cache is per-serverless-instance and can serve slightly stale membership for ≤60 s.
