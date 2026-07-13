"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Loader2,
  MessageSquareText,
  Search,
  SquareCheckBig,
} from "lucide-react";
import { dispatchOpenTask } from "@/lib/tasks/client-events";
import { personLabel } from "@/lib/tasks/people";
import type {
  CommentHit,
  SearchResults,
  SearchSnippet,
  TaskHit,
} from "@/lib/tasks/search";

type FlatRow = {
  id: string;
  taskId: string;
  commentId?: string;
};

export function TaskSearchBox({
  labelByEmail,
}: {
  labelByEmail: Map<string, string>;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      abortRef.current?.abort();
      const timer = window.setTimeout(() => {
        setResults(null);
        setLoading(false);
        setError(false);
      }, 0);
      return () => window.clearTimeout(timer);
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

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const flat = useMemo<FlatRow[]>(() => {
    if (!results) return [];
    return [
      ...results.tasks.map((task) => ({
        id: taskRowId(task),
        taskId: task.id,
      })),
      ...results.comments.map((comment) => ({
        id: commentRowId(comment),
        taskId: comment.task_id,
        commentId: comment.comment_id,
      })),
    ];
  }, [results]);

  function choose(row: FlatRow) {
    dispatchOpenTask(row.taskId, row.commentId);
    setOpen(false);
    setQuery("");
  }

  const maxActiveIndex = Math.max(0, flat.length - 1);
  const activeIndex = Math.min(active, maxActiveIndex);
  const activeId = flat[activeIndex]?.id ?? null;
  const hasResults = Boolean(
    results &&
      (results.tasks.length > 0 || results.comments.length > 0)
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
          setActive((current) => Math.min(current + 1, maxActiveIndex));
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
        placeholder="Search tasks and comments..."
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
            <EmptyState text="No matching tasks or comments." />
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
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function TaskGroup({
  items,
  truncated,
  activeId,
  onChoose,
  labelByEmail,
}: {
  items: TaskHit[];
  truncated: boolean;
  activeId: string | null;
  onChoose: (row: FlatRow) => void;
  labelByEmail: Map<string, string>;
}) {
  if (items.length === 0) return null;

  return (
    <SearchGroupHeader
      icon={<SquareCheckBig className="h-4 w-4" />}
      label="Tasks"
      count={items.length}
      truncated={truncated}
    >
      {items.map((task) => {
        const id = taskRowId(task);
        return (
          <SearchRow
            key={id}
            active={id === activeId}
            onClick={() => onChoose({ id, taskId: task.id })}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-[#172b4d]">
                {task.title}
              </span>
              <span className="block truncate text-xs font-medium text-[#6b778c]">
                {task.key}
                {task.agent_email
                  ? ` · ${personLabel(task.agent_email, labelByEmail)}`
                  : ""}
              </span>
            </span>
            <span className="rounded bg-[#f4f5f7] px-2 py-0.5 text-[11px] font-bold uppercase text-[#44546f]">
              {task.status.replace("_", " ")}
            </span>
          </SearchRow>
        );
      })}
    </SearchGroupHeader>
  );
}

function CommentGroup({
  items,
  truncated,
  activeId,
  onChoose,
  labelByEmail,
}: {
  items: CommentHit[];
  truncated: boolean;
  activeId: string | null;
  onChoose: (row: FlatRow) => void;
  labelByEmail: Map<string, string>;
}) {
  if (items.length === 0) return null;

  return (
    <SearchGroupHeader
      icon={<MessageSquareText className="h-4 w-4" />}
      label="Comments"
      count={items.length}
      truncated={truncated}
    >
      {items.map((comment) => {
        const id = commentRowId(comment);
        return (
          <SearchRow
            key={id}
            active={id === activeId}
            onClick={() =>
              onChoose({
                id,
                taskId: comment.task_id,
                commentId: comment.comment_id,
              })
            }
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-[#172b4d]">
                {comment.task_title}
              </span>
              <span className="block truncate text-xs leading-5 text-[#44546f]">
                <HighlightedSnippet snippet={comment.snippet} />
              </span>
              <span className="block truncate text-[11px] font-medium text-[#7a869a]">
                {personLabel(comment.author_email, labelByEmail)} ·{" "}
                {formatSearchDate(comment.created_at)}
              </span>
            </span>
          </SearchRow>
        );
      })}
    </SearchGroupHeader>
  );
}

function SearchGroupHeader({
  icon,
  label,
  count,
  truncated,
  children,
}: {
  icon: ReactNode;
  label: string;
  count: number;
  truncated: boolean;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="flex h-8 items-center gap-2 px-2 text-xs font-bold uppercase tracking-wide text-[#6b778c]">
        <span className="text-[#0c66e4]">{icon}</span>
        <span>{label}</span>
        <span className="rounded bg-[#f4f5f7] px-1.5 py-0.5 text-[10px] text-[#44546f]">
          {count}
          {truncated ? "+" : ""}
        </span>
      </div>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

function SearchRow({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-14 w-full items-center gap-3 rounded px-3 py-2 text-left transition ${
        active
          ? "bg-[#e9f2ff] ring-1 ring-inset ring-[#85b8ff]"
          : "hover:bg-[#f4f5f7]"
      }`}
    >
      {children}
    </button>
  );
}

function HighlightedSnippet({ snippet }: { snippet: SearchSnippet }) {
  if (snippet.matchLen <= 0) return <>{snippet.text}</>;

  const before = snippet.text.slice(0, snippet.matchStart);
  const match = snippet.text.slice(
    snippet.matchStart,
    snippet.matchStart + snippet.matchLen
  );
  const after = snippet.text.slice(snippet.matchStart + snippet.matchLen);

  return (
    <>
      {before}
      <mark className="rounded bg-[#fff0b3] px-0.5 font-semibold text-[#172b4d]">
        {match}
      </mark>
      {after}
    </>
  );
}

function EmptyState({
  text,
  tone = "muted",
}: {
  text: string;
  tone?: "muted" | "error";
}) {
  return (
    <div
      className={`rounded border border-dashed px-4 py-8 text-center text-sm font-semibold ${
        tone === "error"
          ? "border-[#ffbdad] bg-[#ffebe6] text-[#ae2a19]"
          : "border-[#dfe1e6] bg-[#fafbfc] text-[#6b778c]"
      }`}
    >
      {text}
    </div>
  );
}

function taskRowId(task: TaskHit) {
  return `task:${task.id}`;
}

function commentRowId(comment: CommentHit) {
  return `comment:${comment.comment_id}`;
}

function formatSearchDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
