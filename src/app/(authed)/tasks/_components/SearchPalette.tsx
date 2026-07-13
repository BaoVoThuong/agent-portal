"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  FileText,
  Loader2,
  MessageSquareText,
  Search,
  SquareCheckBig,
  X,
} from "lucide-react";
import { dispatchOpenTask } from "@/lib/tasks/client-events";
import { personLabel } from "@/lib/tasks/people";
import type {
  CommentHit,
  FileHit,
  SearchResults,
  SearchSnippet,
  TaskHit,
} from "@/lib/tasks/search";

type FlatRow = {
  id: string;
  taskId: string;
  commentId?: string;
};

export function SearchPalette({
  open,
  onClose,
  labelByEmail,
}: {
  open: boolean;
  onClose: () => void;
  labelByEmail: Map<string, string>;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) {
      abortRef.current?.abort();
      abortRef.current = null;
      const timer = window.setTimeout(() => {
        setQuery("");
        setResults(null);
        setActive(0);
        setError(false);
        setLoading(false);
      }, 0);
      return () => window.clearTimeout(timer);
    }

    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const trimmedQuery = query.trim();
    if (trimmedQuery.length < 2) {
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
          `/api/tasks/search?q=${encodeURIComponent(trimmedQuery)}`,
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
  }, [open, query]);

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
      ...results.files.map((file) => ({
        id: fileRowId(file),
        taskId: file.task_id,
        commentId: file.comment_id ?? undefined,
      })),
    ];
  }, [results]);

  function choose(row: FlatRow) {
    dispatchOpenTask(row.taskId, row.commentId);
    onClose();
  }

  if (!open) return null;

  const activeIndex = Math.min(active, Math.max(0, flat.length - 1));
  const activeId = flat[activeIndex]?.id ?? null;
  const hasResults = Boolean(
    results &&
      (results.tasks.length > 0 ||
        results.comments.length > 0 ||
        results.files.length > 0)
  );

  return (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center bg-[#091e42]/35 px-4 pt-[12vh]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search tasks"
        className="w-[min(42rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-[#dfe1e6] bg-white shadow-[0_18px_48px_rgba(9,30,66,0.28)]"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
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
        <div className="flex h-12 items-center gap-3 border-b border-[#dfe1e6] px-4">
          <Search className="h-5 w-5 shrink-0 text-[#44546f]" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            placeholder="Search tasks, comments, files..."
            className="h-full min-w-0 flex-1 bg-transparent text-sm font-semibold text-[#172b4d] outline-none placeholder:text-[#7a869a]"
          />
          {loading ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#0c66e4]" />
          ) : null}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close search"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-[#6b778c] transition hover:bg-[#f4f5f7] hover:text-[#172b4d]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[62vh] overflow-y-auto p-2">
          {query.trim().length < 2 ? (
            <EmptyState text="Type at least 2 characters to search." />
          ) : error ? (
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
      </div>
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

function FileGroup({
  items,
  truncated,
  activeId,
  onChoose,
}: {
  items: FileHit[];
  truncated: boolean;
  activeId: string | null;
  onChoose: (row: FlatRow) => void;
}) {
  if (items.length === 0) return null;

  return (
    <SearchGroupHeader
      icon={<FileText className="h-4 w-4" />}
      label="Files"
      count={items.length}
      truncated={truncated}
    >
      {items.map((file) => {
        const id = fileRowId(file);
        return (
          <SearchRow
            key={id}
            active={id === activeId}
            onClick={() =>
              onChoose({
                id,
                taskId: file.task_id,
                commentId: file.comment_id ?? undefined,
              })
            }
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-[#172b4d]">
                {file.file_name}
              </span>
              <span className="block truncate text-xs font-medium text-[#6b778c]">
                {file.task_title}
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

function fileRowId(file: FileHit) {
  return `file:${file.attachment_id}`;
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
