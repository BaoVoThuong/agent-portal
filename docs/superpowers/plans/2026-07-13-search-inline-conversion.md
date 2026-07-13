# Search: convert modal palette → inline dropdown

> **For a human implementer:** hand-coding plan. Verify each task with `npm run typecheck && npm run lint && npm run test:run && npm run build`.

**Goal:** The global search already works (`SearchPalette` modal + `/api/tasks/search` + comment-anchor deep link + name display). This plan **only** changes the presentation: a **modal you open (button / ⌘K)** → an **inline search box in the toolbar whose results drop down right under it**. Board stays exactly as-is (it's already not keyword-filtered — `filterTasks({ query: "" })`).

**Architecture:** Rewrite the top-level `SearchPalette` component (the modal shell) into a self-contained inline `TaskSearchBox` (input + absolute dropdown), reusing every child unchanged (`TaskGroup`/`CommentGroup`/`FileGroup`/`SearchRow`/`HighlightedSnippet`/`EmptyState`/snippet + id helpers). Move it from a modal rendered by `TaskBoardClient` to an inline box rendered by `TaskToolbar`. Remove the modal open-state + ⌘K.

**Tech Stack:** Next.js App Router, TypeScript. No API/schema/test-logic changes.

## Global Constraints
- Reuse the existing sub-components and `/api/tasks/search`; do NOT touch `search.ts`, the route, or the deep-link. Keep `labelByEmail` name resolution (already added).
- English UI copy. Don't push to `vercel`. Commit after each task.

## File Structure
- Rename `src/app/(authed)/tasks/_components/SearchPalette.tsx` → `TaskSearchBox.tsx` (the file already holds all the group/row helpers — keep them). Export `TaskSearchBox` instead of `SearchPalette`.
- `TaskToolbar.tsx` — renders the inline box (replaces the current "Search…" trigger button).
- `TaskBoardClient.tsx` — drops the modal open-state, the ⌘K listener, the modal render, and the `onOpenSearch` wiring; passes `labelByEmail` down to the toolbar.

---

## Task 1: Turn the modal into an inline `TaskSearchBox`

**Files:** rename `SearchPalette.tsx` → `TaskSearchBox.tsx`; rewrite ONLY its top-level exported function. Leave `TaskGroup`, `CommentGroup`, `FileGroup`, `SearchGroupHeader`, `SearchRow`, `HighlightedSnippet`, `EmptyState`, `taskRowId`/`commentRowId`/`fileRowId`, `formatSearchDate`, and the `FlatRow` type **unchanged** (they already take `labelByEmail`).

- [ ] **Step 1:** `git mv src/app/(authed)/tasks/_components/SearchPalette.tsx src/app/(authed)/tasks/_components/TaskSearchBox.tsx`.

- [ ] **Step 2:** Replace the exported `SearchPalette({ open, onClose, labelByEmail })` function (the modal — the `fixed inset-0` overlay + `role="dialog"` wrapper + close ✕) with this self-contained inline version. It manages its own open state (focus + query ≥ 2), closes on outside-click / Esc / select, and renders the dropdown `absolute` under the input:

```tsx
export function TaskSearchBox({ labelByEmail }: { labelByEmail: Map<string, string> }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Debounced, abortable search. Never touches the board — only this dropdown.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      abortRef.current?.abort();
      setResults(null);
      setLoading(false);
      setError(false);
      return;
    }
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(false);
      try {
        const response = await fetch(
          `/api/tasks/search?q=${encodeURIComponent(trimmed)}`,
          { signal: controller.signal }
        );
        if (!response.ok) throw new Error("Search failed.");
        setResults((await response.json()) as SearchResults);
      } catch {
        if (!controller.signal.aborted) {
          setError(true);
          setResults(null);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 200);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  // Close the dropdown when clicking outside the box.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const flat = useMemo<FlatRow[]>(() => {
    if (!results) return [];
    return [
      ...results.tasks.map((task) => ({ id: taskRowId(task), taskId: task.id })),
      ...results.comments.map((comment) => ({
        id: commentRowId(comment),
        taskId: comment.task_id,
        commentId: comment.comment_id,
      })),
      ...results.files.map((file) => ({
        id: fileRowId(file),
        taskId: file.task_id,
        commentId: file.comment_id ?? undefined,
      })),
    ];
  }, [results]);

  function choose(row: FlatRow) {
    dispatchOpenTask(row.taskId, row.commentId);
    setOpen(false);
    setQuery("");
  }

  const activeIndex = Math.min(active, Math.max(0, flat.length - 1));
  const activeId = flat[activeIndex]?.id ?? null;
  const hasResults = Boolean(
    results &&
      (results.tasks.length > 0 ||
        results.comments.length > 0 ||
        results.files.length > 0)
  );
  const showDropdown = open && query.trim().length >= 2;

  return (
    <div
      ref={rootRef}
      className="relative w-full"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setOpen(false);
          return;
        }
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setActive((current) => Math.min(current + 1, flat.length - 1));
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          setActive((current) => Math.max(current - 1, 0));
        }
        if (event.key === "Enter" && flat[activeIndex]) {
          event.preventDefault();
          choose(flat[activeIndex]);
        }
      }}
    >
      <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#44546f]" />
      <input
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search tasks, comments, files..."
        className="h-10 w-full rounded border-2 border-transparent bg-[#f4f5f7] pl-10 pr-9 text-sm font-medium text-[#172b4d] outline-none transition placeholder:text-[#44546f] hover:bg-[#ebecf0] focus:border-[#0c66e4] focus:bg-white"
      />
      {loading ? (
        <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-[#0c66e4]" />
      ) : null}

      {showDropdown ? (
        <div className="absolute left-0 right-0 top-full z-[120] mt-1 max-h-[60vh] overflow-y-auto rounded-lg border border-[#dfe1e6] bg-white p-2 shadow-[0_12px_32px_rgba(9,30,66,0.2)]">
          {error ? (
            <EmptyState text="Search is unavailable. Try again." tone="error" />
          ) : !loading && !hasResults ? (
            <EmptyState text="No matching tasks, comments, or files." />
          ) : null}

          {results ? (
            <div className="space-y-2">
              <TaskGroup
                items={results.tasks}
                truncated={results.truncated.tasks}
                activeId={activeId}
                onChoose={choose}
                labelByEmail={labelByEmail}
              />
              <CommentGroup
                items={results.comments}
                truncated={results.truncated.comments}
                activeId={activeId}
                onChoose={choose}
                labelByEmail={labelByEmail}
              />
              <FileGroup
                items={results.files}
                truncated={results.truncated.files}
                activeId={activeId}
                onChoose={choose}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3:** Fix imports in the file: `X` (close icon) is no longer used — drop it from the `lucide-react` import; keep `Search`, `Loader2`, `FileText`, `MessageSquareText`, `SquareCheckBig`. Keep `useMemo`/`useRef`/`useState`/`useEffect` and the `dispatchOpenTask` + `personLabel` + type imports.
- [ ] **Step 4:** `npm run typecheck` — will be red only at the old `SearchPalette` importer (`TaskBoardClient`), fixed in Task 2. Confirm no errors *inside* `TaskSearchBox.tsx` itself.

---

## Task 2: Render the box in the toolbar; delete the modal + ⌘K

**Files:** modify `TaskToolbar.tsx`, `TaskBoardClient.tsx`.

- [ ] **Step 1: `TaskToolbar.tsx`** — import the box and swap the trigger:
  - `import { TaskSearchBox } from "./TaskSearchBox";`
  - Props: **remove** `onOpenSearch` (both the destructure and the `onOpenSearch: () => void` type); **add** `labelByEmail: Map<string, string>`.
  - Replace the current trigger button (the `<button … onClick={onOpenSearch}>` with the `Search` icon + "Search tasks, comments, files" label, ~lines 337-343) with:
    ```tsx
    <TaskSearchBox labelByEmail={labelByEmail} />
    ```
    Keep it in the same slot/width the button occupied so the toolbar layout is unchanged.

- [ ] **Step 2: `TaskBoardClient.tsx`** — remove the modal machinery:
  - Delete `const [searchOpen, setSearchOpen] = useState(false);` (~line 87).
  - Delete the ⌘K `useEffect` (the `keydown` listener that does `setSearchOpen(true)` on `(metaKey||ctrlKey) && key === "k"`, ~lines 177-183).
  - Delete the `<SearchPalette open={searchOpen} onClose={…} labelByEmail={…} />` render (~lines 1091-1095) and its `import { SearchPalette } from "./SearchPalette";`.
  - On the `<TaskToolbar … />`: remove `onOpenSearch={() => setSearchOpen(true)}`; add `labelByEmail={searchLabelByEmail}` (the names-only map already built for search).
  - Leave `filterTasks({ … query: "" … })` as-is (board already unfiltered). If `query`/`setQuery` state is now completely unused, delete it (lint will flag it).

- [ ] **Step 3:** `npm run typecheck && npm run lint && npm run test:run && npm run build` → all green.
- [ ] **Step 4:** Manual acceptance:
  - The toolbar shows a real **search input** (not a button). Typing ≥2 chars opens a **dropdown right under it**; the board below is unchanged.
  - Rows show **names** (agent, comment author); ↑/↓/Enter + click work; a comment hit opens the drawer and scrolls+flashes the comment.
  - Clicking outside or Esc closes the dropdown; selecting a result clears the input.
  - No modal appears anywhere; ⌘K no longer opens anything.
  Commit (`refactor(tasks): inline search box instead of modal palette`).

---

## Self-Review
- **Scope:** presentation-only. `search.ts`, `/api/tasks/search`, the comment-anchor deep link, and name resolution are untouched — only the shell (modal → inline) and its wiring move. ✓
- **Reuse:** all group/row/snippet/empty-state children and the fetch/debounce/keyboard/choose logic are carried over verbatim; the only new behavior is self-managed `open` + outside-click close. ✓
- **Board untouched:** `filterTasks` already passes `query: ""`; this plan removes the leftover modal, not the (already-gone) keyword filter. ✓
- **Watch-outs:** (a) after removing `SearchPalette`'s modal, ensure no stray `onOpenSearch`/`searchOpen` references remain (typecheck catches them); (b) drop the now-unused `X` icon import and any unused `query`/`setQuery`/⌘K remnants or lint fails; (c) the dropdown's `z-[120]` must sit above the board but the toolbar container must not `overflow-hidden` clip it — if it does, the dropdown needs to render at the toolbar's top-level flex row (it already lives there).
