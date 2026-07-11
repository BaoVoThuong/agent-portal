"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, X } from "lucide-react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { taskKey } from "@/lib/tasks/sorting";
import { getBrowserSupabase } from "@/lib/supabase-browser";
import { dispatchOpenTask } from "@/lib/tasks/client-events";
import { playNotificationChime, primeNotificationSound } from "@/lib/tasks/sound";

type Notif = {
  id: string;
  task_id: string;
  type:
    | "assigned"
    | "mentioned"
    | "commented"
    | "overdue"
    | "overdue_reminder"
    | "waiting_reminder"
    | "unassigned"
    | "reopened"
    | "qc_needed"
    | "due_soon"
    | "stale";
  actor_email: string;
  actor_name: string | null;
  task_title: string | null;
  comment_body: string | null;
  is_read: boolean;
  created_at: string;
};

// Polling interval: slow safety net when realtime is configured (broadcast handles
// instant delivery), faster when it isn't so notifications still feel responsive.
const POLL_REALTIME_MS = 20000;
const POLL_FALLBACK_MS = 10000;
const TOAST_MS = 7000;
const MENTION_TOKEN = /@\[([^\]]+)\]\(([^()\s]+@[^()\s]+)\)/g;

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  return new Date(iso).toLocaleDateString();
}

function actorName(n: Notif): string {
  return n.actor_name ?? n.actor_email;
}

function cleanCommentBody(body: string | null): string | null {
  const cleaned = (body ?? "")
    .replace(MENTION_TOKEN, "@$1")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || null;
}

function commentPreview(n: Notif): string | null {
  const cleaned = cleanCommentBody(n.comment_body);
  if (!cleaned) return null;
  return cleaned.length > 180 ? `${cleaned.slice(0, 177)}...` : cleaned;
}

function actionText(n: Notif): string {
  switch (n.type) {
    case "assigned":
      return "assigned you to a task";
    case "mentioned":
      return "tagged you in a comment";
    case "commented":
      return "commented on a task assigned to you";
    case "unassigned":
      return "removed you from a task";
    case "reopened":
      return "reopened this task";
    case "qc_needed":
      return "marked a Done task for QC";
    case "overdue":
      return "Task just went overdue";
    case "overdue_reminder":
      return "Task is still overdue — reminder";
    case "waiting_reminder":
      return "Task is still waiting for follow-up";
    case "due_soon":
      return "Task is due soon";
    case "stale":
      return "Task has had no activity";
  }
}

// System-triggered (cron) notifications aren't "from" anyone — actionText is
// already a complete sentence for these, so skip the actor-name prefix.
function isSystemNotif(n: Notif): boolean {
  return (
    n.type === "overdue" ||
    n.type === "overdue_reminder" ||
    n.type === "waiting_reminder" ||
    n.type === "due_soon" ||
    n.type === "stale"
  );
}

function notificationHeading(n: Notif): string {
  return isSystemNotif(n) ? actionText(n) : `${actorName(n)} ${actionText(n)}`;
}

function nativeNotificationBody(n: Notif): string {
  return [
    n.task_title ? `Task: ${n.task_title}` : `Task: ${taskKey(n.task_id)}`,
    commentPreview(n) ? `Comment: "${commentPreview(n)}"` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export function NotificationBell() {
  const [items, setItems] = useState<Notif[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [toasts, setToasts] = useState<Notif[]>([]);
  const [topic, setTopic] = useState<string | null>(null);
  const pathname = usePathname();
  const ref = useRef<HTMLDivElement>(null);
  // Notification ids we have already processed, so a poll never re-pops a toast.
  const seenIds = useRef<Set<string>>(new Set());
  const initialized = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/tasks/notifications");
      if (!res.ok) return;
      const data = await res.json();
      const list = data.notifications as Notif[];
      setItems(list);
      setUnread(data.unread as number);
      setTopic((data.topic as string | null) ?? null);

      if (!initialized.current) {
        // First load: remember what already exists; don't pop toasts for old items.
        list.forEach((n) => seenIds.current.add(n.id));
        initialized.current = true;
        return;
      }

      const fresh = list.filter((n) => !seenIds.current.has(n.id) && !n.is_read);
      list.forEach((n) => seenIds.current.add(n.id));

      // One chime per batch, not per item, so a burst doesn't overlap tones.
      if (fresh.length > 0) playNotificationChime();

      // Oldest first so the newest toast ends up on top of the stack.
      for (const n of [...fresh].reverse()) {
        setToasts((cur) => [n, ...cur].slice(0, 4));
        const id = n.id;
        setTimeout(
          () => setToasts((cur) => cur.filter((t) => t.id !== id)),
          TOAST_MS
        );

        // Native OS popup too — fires regardless of whether the tab is
        // focused, not just when it's hidden.
        if (
          typeof window !== "undefined" &&
          "Notification" in window &&
          Notification.permission === "granted"
        ) {
          new Notification(`${taskKey(n.task_id)} · ${notificationHeading(n)}`, {
            body: nativeNotificationBody(n),
          });
        }
      }
    } catch {
      // Transient network error (HMR reload, offline, navigation abort) —
      // ignore; the next poll / realtime ping retries.
    }
  }, []);

  useEffect(() => {
    const pollMs = getBrowserSupabase() ? POLL_REALTIME_MS : POLL_FALLBACK_MS;
    const first = setTimeout(() => void load(), 0);
    const t = setInterval(() => void load(), pollMs);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [load]);

  // Ask once for OS-notification permission (so background toasts can fire).
  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      "Notification" in window &&
      Notification.permission === "default"
    ) {
      void Notification.requestPermission();
    }
  }, []);

  // Prime the shared AudioContext on the first user gesture anywhere in the
  // app — autoplay policy suspends it until then, so a chime fired before
  // this would otherwise be silently skipped.
  useEffect(() => {
    function prime() {
      primeNotificationSound();
    }
    document.addEventListener("pointerdown", prime, { once: true });
    return () => document.removeEventListener("pointerdown", prime);
  }, []);

  // Realtime: subscribe to this user's broadcast topic. A ping just re-runs load()
  // (which dedups + toasts new items); no content travels over the channel.
  useEffect(() => {
    if (!topic) return;
    const sb = getBrowserSupabase();
    if (!sb) return;
    const channel = sb
      .channel(topic)
      .on("broadcast", { event: "new" }, () => void load())
      .subscribe();
    return () => {
      void sb.removeChannel(channel);
    };
  }, [topic, load]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  function toggleNotifications() {
    setOpen((current) => !current);
  }

  async function markRead(ids: string[]) {
    if (ids.length === 0) return;
    setItems((cur) => cur.map((n) => (ids.includes(n.id) ? { ...n, is_read: true } : n)));
    setUnread((current) => Math.max(0, current - ids.length));
    await fetch("/api/tasks/notifications/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    }).catch(() => {});
  }

  async function markAllRead() {
    if (unread === 0) return;
    setUnread(0);
    setItems((cur) => cur.map((n) => ({ ...n, is_read: true })));
    setToasts([]);
    await fetch("/api/tasks/notifications/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }).catch(() => {});
  }

  const dismissToast = (id: string) =>
    setToasts((cur) => cur.filter((t) => t.id !== id));

  function handleOpenNotification(
    n: Notif,
    event?: ReactMouseEvent<HTMLAnchorElement>
  ) {
    setOpen(false);
    dismissToast(n.id);
    if (!n.is_read) void markRead([n.id]);
    if (pathname === "/tasks") {
      event?.preventDefault();
      dispatchOpenTask(n.task_id);
    }
  }

  return (
    <>
      <div className="relative" ref={ref}>
        <button
          type="button"
          onClick={toggleNotifications}
          aria-label="Notifications"
          className="relative flex h-9 w-9 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"
        >
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>
        {open && (
          <div className="absolute right-0 z-50 mt-2 w-96 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-3 py-2">
              <div>
                <p className="text-xs font-semibold text-slate-600">Notifications</p>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  {unread > 0 ? `${unread} unread` : "All caught up"}
                </p>
              </div>
              {unread > 0 ? (
                <button
                  type="button"
                  onClick={() => void markAllRead()}
                  className="shrink-0 rounded px-2 py-1 text-xs font-semibold text-[#0c66e4] transition hover:bg-[#e9f2ff]"
                >
                  Mark all read
                </button>
              ) : null}
            </div>
            <div className="max-h-80 overflow-y-auto">
              {items.length === 0 ? (
                <p className="px-3 py-6 text-center text-xs text-slate-400">
                  Nothing yet.
                </p>
              ) : (
                items.map((n) => (
                  <Link
                    key={n.id}
                    href={`/tasks?task=${n.task_id}`}
                    onClick={(event) => handleOpenNotification(n, event)}
                    className={`block px-3 py-2.5 hover:bg-slate-50 ${
                      n.is_read ? "" : "bg-blue-50/40"
                    }`}
                  >
                    <NotifContent n={n} />
                  </Link>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Messenger-style toast stack */}
      {toasts.length > 0 && (
        <div className="fixed right-4 top-16 z-[300] flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-2">
          {toasts.map((n) => (
            <Link
              key={n.id}
              href={`/tasks?task=${n.task_id}`}
              onClick={(event) => handleOpenNotification(n, event)}
              className="notif-toast block rounded-xl border border-slate-200 bg-white p-3 shadow-[0_10px_30px_rgba(9,30,66,0.18)] hover:border-[#c1c7d0]"
            >
              <div className="flex items-start gap-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#deebff] text-[#0c66e4]">
                  <Bell className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <NotifContent n={n} />
                </div>
                <button
                  type="button"
                  aria-label="Dismiss"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    dismissToast(n.id);
                  }}
                  className="-mr-1 -mt-1 shrink-0 rounded p-0.5 text-slate-400 transition hover:text-slate-600"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

function NotifContent({ n }: { n: Notif }) {
  return (
    <>
      <div className="flex items-center gap-2">
        <span className="font-mono text-[11px] font-bold text-[#0c66e4]">
          {taskKey(n.task_id)}
        </span>
        {!n.is_read && <span className="h-1.5 w-1.5 rounded-full bg-[#0c66e4]" />}
        <span className="ml-auto text-[10px] text-slate-400">
          {timeAgo(n.created_at)}
        </span>
      </div>
      <p
        className={`mt-0.5 text-xs leading-5 ${
          n.is_read ? "text-slate-500" : "text-slate-800"
        }`}
      >
        {isSystemNotif(n) ? (
          actionText(n)
        ) : (
          <>
            <span className="font-semibold">{actorName(n)}</span> {actionText(n)}
          </>
        )}
      </p>
      {n.task_title && (
        <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-slate-500" title={n.task_title}>
          <span className="font-semibold text-slate-600">Task:</span> {n.task_title}
        </p>
      )}
      {commentPreview(n) && (
        <p
          className="mt-0.5 line-clamp-2 text-xs leading-5 text-slate-500"
          title={commentPreview(n) ?? undefined}
        >
          <span className="font-semibold text-slate-600">Comment:</span>{" "}
          &quot;{commentPreview(n)}&quot;
        </p>
      )}
    </>
  );
}
