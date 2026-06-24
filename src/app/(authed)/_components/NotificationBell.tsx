"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";

type Notif = {
  id: string;
  task_id: string;
  type: "assigned" | "mentioned" | "commented";
  actor_email: string;
  is_read: boolean;
  created_at: string;
};

const LABEL: Record<Notif["type"], string> = {
  assigned: "assigned you a task",
  mentioned: "mentioned you",
  commented: "commented on your task",
};

const POLL_MS = 60000;

export function NotificationBell() {
  const [items, setItems] = useState<Notif[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/tasks/notifications");
    if (!res.ok) return;
    const data = await res.json();
    setItems(data.notifications as Notif[]);
    setUnread(data.unread as number);
  }, []);

  useEffect(() => {
    let isCurrent = true;

    void fetch("/api/tasks/notifications")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!isCurrent || !data) return;
        setItems(data.notifications as Notif[]);
        setUnread(data.unread as number);
      });

    const t = setInterval(() => void load(), POLL_MS);
    return () => {
      isCurrent = false;
      clearInterval(t);
    };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  async function openAndMarkRead() {
    setOpen((o) => !o);
    if (!open && unread > 0) {
      await fetch("/api/tasks/notifications/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      setUnread(0);
      setItems((cur) => cur.map((n) => ({ ...n, is_read: true })));
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={openAndMarkRead}
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
        <div className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          <div className="border-b border-slate-100 px-3 py-2 text-xs font-semibold text-slate-500">
            Notifications
          </div>
          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-slate-400">Nothing yet.</p>
            ) : (
              items.map((n) => (
                <Link
                  key={n.id}
                  href="/tasks"
                  onClick={() => setOpen(false)}
                  className={`block px-3 py-2 text-xs hover:bg-slate-50 ${n.is_read ? "text-slate-500" : "text-slate-800"}`}
                >
                  <span className="font-medium">{n.actor_email}</span> {LABEL[n.type]}
                  <span className="ml-1 text-slate-300">{new Date(n.created_at).toLocaleDateString()}</span>
                </Link>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
