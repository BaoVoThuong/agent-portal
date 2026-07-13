# Global Task Search — Design

## Purpose

The toolbar "search" today is a **client-side inline filter** over already-loaded
tasks (title, description, agent, assignee, category — see `TaskBoardClient` `searchText`).
It cannot reach **comments** (comments aren't loaded into the board — they're fetched
per-task in the detail drawer) and it only **narrows the board**. Users need to find a
task by what was said in its **comments** or by an **attachment filename**, and jump
straight to it — Slack-style — without disturbing the board they're looking at.

## Goals

- Search across three sources: task **title**, **comment/reply body**, **attachment file name**.
- A **palette** (Slack-style) that shows grouped results — **Tasks / Comments / Files** —
  with a highlighted snippet, and on click opens the task's **detail drawer**. A comment
  hit scrolls to and highlights that comment; a file hit opens the Attachments area.
- **Strict access scoping:** results are limited to tasks the actor can already view —
  reusing the board's visibility. A CS never gets a comment/file hit from a task they
  can't see.
- The **board is not filtered** by search — the palette is find-and-jump only.

## Non-goals (v1)

- Searching task **description**, activity log, or people/agents. (Tasks match on **title only**.)
- Ranking beyond trigram similarity; no ML relevance, no typo correction beyond trigram tolerance.
- Saved searches / search history / recent searches.
- Keeping the old keyword **board filter** — the keyword box becomes the palette trigger
  (the board's other filters — agent/assignee/category/status/date — are unchanged).

## Decisions (locked with the user)

1. Sources: **title + comment body + attachment file name**. No description.
2. The existing keyword input becomes the **palette trigger**; board is never keyword-filtered.
3. Matching engine: **`pg_trgm` (trigram) + GIN indexes** — best for as-you-type substring
   matching across all three sources, uniform and partial-match friendly.
4. Access scope is a **hard rule** — search reuses the board's `fetchTasksForActor` visibility.

## Architecture

### Matching / data
- Enable Postgres `pg_trgm` and add GIN trigram indexes so substring/as-you-type queries
  are indexed:
  - `tasks.title`
  - `task_comments.body`
  - `task_attachments.file_name`
- Exclusions baked into every query: archived tasks (`tasks.archived_at is not null`),
  deleted comments (`task_comments.deleted_at is not null`).
- Match predicate: case-insensitive substring (`ILIKE %q%`) accelerated by the trigram
  GIN index; ordered by `similarity(col, q)` desc, then recency. Min query length: 2 chars.

### Access scoping (the hard rule)
- The search endpoint computes the actor's **visible task-id scope** using the SAME logic
  as `fetchTasksForActor` (`src/lib/tasks/queries.ts`):
  - Admin (manager view) → all non-archived tasks.
  - Agent / Assistant / CS → their scope only (own/assisted agents' tasks, tasks assigned
    to them, tasks they participate in), via the existing membership helpers
    (`fetchAgentsForCs`, `fetchAssistantAgentsForCs`, assigned ids, participant ids) and
    the `canViewTask` predicate.
- Every match — task, comment, or file — is filtered to `task_id ∈ visibleScope` **server-side**.
  The client can never receive an out-of-scope hit.
- This deliberately inherits whatever `fetchTasksForActor` resolves, so it stays consistent
  with the pending **agent/assistant view-scope tightening** (tracked separately). One source
  of truth for "what can this person see".

### API
- `GET /api/tasks/search?q=<query>` — auth required; returns `400`/empty for `q` under 2 chars.
- Response shape:
  ```ts
  type SearchResults = {
    tasks: { id; key; title; agent_email; status }[];      // title matched
    comments: { comment_id; task_id; task_title; snippet; author_email; created_at }[];
    files: { attachment_id; task_id; task_title; comment_id: string | null; file_name }[];
    truncated: { tasks: boolean; comments: boolean; files: boolean };
  };
  ```
- Each group is capped (~6 rows) with a `truncated` flag driving a "show all" affordance.
- `snippet`: a ~120-char window around the first match in the comment body, with the match
  span marked for the client to highlight. Title/file_name hits carry the whole (short) string
  with the match span marked.

### Client — the palette
- The toolbar search input, and a `⌘K` shortcut, open a palette overlay.
- Debounced (~200 ms) fetch to the search API; in-flight requests are aborted when the query
  changes. States: idle (hint), loading, empty (no results), error (retry inline).
- Grouped sections (Tasks, Comments, Files) each with a header + count; keyboard navigable
  (↑/↓ across all rows, Enter to open, Esc to close).
- Selecting a row navigates (below); the board underneath is untouched throughout.

### Navigation / deep-link
- Reuse `OPEN_TASK_EVENT` / `writeTaskDeepLink` to open the drawer for `task_id`.
- Extend the deep link with an optional **comment anchor**: `?task=<id>&comment=<cid>` (and a
  matching field on the open-task event). When the drawer opens with a comment anchor,
  `CommentThread` scrolls the comment into view and briefly highlights it. Requires giving
  each rendered comment a stable DOM anchor (e.g. `data-comment-id` / `id`).
- A file hit opens the drawer and focuses the Attachments area (optionally the specific
  attachment); if the file is attached to a comment, it may reuse the comment anchor.

## Error handling
- Query < 2 chars or empty → no request, palette shows the idle hint.
- API/network error → inline "Search failed — retry" inside the palette; the board is never affected.
- Out-of-scope access is impossible by construction (server filters to the visible scope);
  the id-scope filter is the single enforcement point.

## Testing
- **Pure/unit:** the snippet+highlight helper (window + match span), and the visible-scope
  builder (given membership inputs → expected task-id set / predicate).
- **API/integration:** scoping is the critical suite —
  - a CS gets **no** comment/file hit from a task outside their scope;
  - an agent/assistant is limited to their agents' tasks;
  - an admin gets matches across all tasks;
  - archived tasks and deleted comments never appear.
- **Matching:** trigram substring sanity (partial word, mid-string, case-insensitive).
- **Client:** palette open/close + `⌘K`, debounce/abort, keyboard nav, click → drawer opens,
  comment hit scrolls+highlights the right comment.

## Rollout / infra
- Migration (idempotent, appended to `supabase/schema.sql`): `create extension if not exists pg_trgm;`
  plus three `create index if not exists … using gin (col gin_trgm_ops)`. Re-run `schema.sql` in Supabase.
- No cron/env/permission changes. No new external dependency.

## Risks / watch-outs
- **Scope cost:** for a worker with a large visible set, the id-scope may be a big `IN (…)`.
  Prefer expressing the scope as a join/EXISTS against the membership + assignment/participant
  sources (mirroring `fetchTasksForActor`'s OR-clause) rather than materializing thousands of ids.
- **Consistency:** search visibility must not diverge from board visibility — both must call the
  same scope resolver. If `fetchTasksForActor` changes (e.g. the agent/assistant tightening),
  search follows automatically only if it reuses that resolver, not a copy.
- **Comment anchor:** introduces a new deep-link param the drawer/thread must handle without
  breaking the existing plain `?task=` path.
