"use client";

import {
  hasNewerNotification,
  newestNotificationAt,
} from "@/lib/notifications/delivery-cursor";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Check, Undo2, X } from "lucide-react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { taskDisplayKey } from "@/lib/tasks/sorting";
import { enrollmentDisplayKey } from "@/lib/enrollment/helpers";
import type { EnrollmentProgram } from "@/lib/enrollment/types";
import { getBrowserSupabase } from "@/lib/supabase-browser";
import {
  dispatchOpenTask,
  publishTaskDataInvalidation,
  subscribeNotificationsRead,
} from "@/lib/tasks/client-events";
import { resolveNotificationInvalidation } from "@/lib/tasks/notification-invalidation";
import { playNotificationChime, primeNotificationSound } from "@/lib/tasks/sound";
import { claimNotificationAlert } from "@/lib/notifications/alert-lock";
import {
  alertClaimDelayMs,
  notificationAlertTag,
  shouldRenotify,
  shouldShowNativePopup,
} from "@/lib/notifications/alert-policy";
import { alertableNotifications } from "@/lib/notifications/alert-preferences";
import { mergeFirstPage, mergeNotifs, type BellList } from "@/lib/notifications/bell-list";
import { UNREAD_SINCE } from "@/lib/notifications/unread-cutoff";
import { isPushEnabledOnThisDevice } from "@/lib/notifications/push-client";
import {
  isSystemNotification,
  notificationActionText,
  notificationEntityId,
  notificationEntityKind,
  notificationEntityLabel,
  notificationHref as sharedNotificationHref,
  type NotificationCopyType,
  type NotificationEntityKind,
} from "@/lib/notifications/copy";

type Notif = {
  id: string;
  task_id: string;
  entity_type?: "task" | "enrollment" | "time_off" | "provider";
  entity_id?: string;
  type: NotificationCopyType;
  actor_email: string;
  actor_name: string | null;
  task_title: string | null;
  comment_body: string | null;
  entity_display_number?: number | null;
  entity_program?: EnrollmentProgram;
  entity_accessible?: boolean;
  detail: string | null;
  is_read: boolean;
  created_at: string;
};

// Polling is only a safety net. Realtime delivers new-notification signals
// immediately, so an active socket can use a much longer interval and hidden
// tabs skip the request entirely.
const POLL_REALTIME_MS = 120000;
const POLL_FALLBACK_MS = 30000;
const TOAST_MS = 7000;
// Cron gửi một ping cho mỗi task mỗi loại — có lượt 12 ping cho cùng một người.
// Gom lại thành một lần tải để một đợt chỉ kêu một tiếng.
const REALTIME_PING_DEBOUNCE_MS = 1500;
const MENTION_TOKEN = /@\[([^\]]+)\]\(([^()\s]+@[^()\s]+)\)/g;

type ListTab = "all" | "unread";

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

function entityKind(n: Notif): NotificationEntityKind {
  return notificationEntityKind(n);
}

function entityId(n: Notif): string {
  return notificationEntityId(n);
}

function entityLabel(n: Notif): string {
  return notificationEntityLabel(n);
}

function notificationHref(n: Notif): string {
  if (n.entity_accessible === false) return "#";
  return sharedNotificationHref(n);
}

function entityKey(n: Notif): string {
  if (entityKind(n) === "provider") return "Provider";
  return entityKind(n) === "enrollment"
    ? enrollmentDisplayKey(n.entity_display_number, n.entity_program)
    : taskDisplayKey(n.entity_display_number);
}

function actionText(n: Notif): string {
  return notificationActionText(n);
}

// System-triggered (cron) notifications aren't "from" anyone — actionText is
// already a complete sentence for these, so skip the actor-name prefix.
function isSystemNotif(n: Notif): boolean {
  return isSystemNotification(n);
}

function detailLabel(n: Notif): string {
  if (n.type === "overdue_unlocked") return "Reason";
  if (n.type === "attachment_added") return "File";
  if (n.type === "sla_escalated") return "SLA";
  if (n.type === "reacted") return "Reaction";
  return "Detail";
}

function notificationHeading(n: Notif): string {
  if (n.entity_accessible === false) {
    return `${entityLabel(n)} is no longer accessible`;
  }
  return isSystemNotif(n) ? actionText(n) : `${actorName(n)} ${actionText(n)}`;
}

function nativeNotificationBody(n: Notif): string {
  if (n.entity_accessible === false) {
    return notificationHeading(n);
  }
  return [
    n.task_title
      ? `${entityLabel(n)}: ${n.task_title}`
      : `${entityLabel(n)}: ${entityKey(n)}`,
    commentPreview(n) ? `Comment: "${commentPreview(n)}"` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Tiếng chuông + popup hệ điều hành cho các thông báo MỚI — đúng một lần cho cả
 * trình duyệt, dù mở bao nhiêu tab. Toast không đi qua đây: nó nằm trong trang,
 * người dùng chỉ thấy toast của tab đang nhìn.
 */
async function alertFreshNotifications(
  fresh: Notif[],
  pushSubscribedOnThisDevice: boolean
): Promise<void> {
  const delay = alertClaimDelayMs(document.visibilityState);
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));

  const claimed = (
    await Promise.all(
      fresh.map(async (n) => ((await claimNotificationAlert(n.id)) ? n : null))
    )
  ).filter((n): n is Notif => n !== null);
  if (claimed.length === 0) return;

  // Một tiếng cho cả đợt, không phải mỗi dòng một tiếng.
  playNotificationChime();

  const permission = "Notification" in window ? Notification.permission : null;
  if (
    !shouldShowNativePopup({
      permission,
      documentHasFocus: document.hasFocus(),
      pushSubscribedOnThisDevice,
    })
  ) {
    return;
  }
  for (const n of [...claimed].reverse()) {
    // lib.dom của TypeScript 5.9 chưa khai `renotify`, dù Chrome có hỗ trợ.
    const options: NotificationOptions & { renotify?: boolean } = {
      body: nativeNotificationBody(n),
      tag: notificationAlertTag(n),
      renotify: shouldRenotify(n),
    };
    new Notification(
      `${n.entity_accessible === false ? "Unavailable" : entityKey(n)} · ${notificationHeading(n)}`,
      options,
    );
  }
}

type ListState = BellList<Notif>;

const ROW_ACTION_CLASS =
  "absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 opacity-0 shadow-sm transition hover:border-[#0c66e4] hover:text-[#0c66e4] focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100";

/**
 * Only notifications since UNREAD_SINCE can go back to unread: older ones
 * count as read whatever their row says.
 */
function canMarkUnread(n: Notif) {
  return n.entity_accessible !== false && Date.parse(n.created_at) >= Date.parse(UNREAD_SINCE);
}

const EMPTY_LIST: ListState = { items: [], hasMore: false, fetchedAt: null };
// Opening the bell refetches a tab only when its list is older than this:
// realtime pings and polls already keep the Unread list current.
const LIST_STALE_MS = 60000;

type NotificationPage = {
  list: Notif[];
  hasMore: boolean;
  unread: number | null;
  latestAt: string | null;
  alertsMuted: boolean;
  topic: string | null;
};

/**
 * One page from the server. `after` is the list already shown: the next page
 * starts below its last row, skipping rows shown at that same instant.
 */
async function requestNotificationPage(
  filter: ListTab,
  after: readonly Notif[] = [],
): Promise<NotificationPage | null> {
  const params = new URLSearchParams();
  if (filter === "unread") params.set("filter", "unread");
  const last = after[after.length - 1];
  if (last) {
    params.set("before", last.created_at);
    params.set(
      "skip",
      after.filter((n) => n.created_at === last.created_at).map((n) => n.id).join(","),
    );
  }
  try {
    const res = await fetch(`/api/tasks/notifications?${params}`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    return {
      list: (data.notifications as Notif[] | undefined) ?? [],
      hasMore: data.hasMore === true,
      unread: typeof data.unread === "number" ? data.unread : null,
      latestAt: (data.latestAt as string | null | undefined) ?? null,
      alertsMuted: data.alertsMuted === true,
      topic: (data.topic as string | null | undefined) ?? null,
    };
  } catch {
    // Transient network error (HMR reload, offline, navigation abort) — the
    // next poll / realtime ping retries.
    return null;
  }
}

export function NotificationBell() {
  // The Unread tab is the main feed: loaded at mount, refreshed by realtime
  // pings and polls, and the source of toasts (a new notification is always
  // unread). All is fetched only when its tab is opened.
  const [unreadList, setUnreadList] = useState<ListState>(EMPTY_LIST);
  const [allList, setAllList] = useState<ListState>(EMPTY_LIST);
  // The bell opens on Unread (user decision 2026-10-19).
  const [tab, setTab] = useState<ListTab>("unread");
  const [loadingMore, setLoadingMore] = useState(false);
  // Bumped each time every read request has reached the server.
  const [readsSettled, setReadsSettled] = useState(0);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [toasts, setToasts] = useState<Notif[]>([]);
  const [topic, setTopic] = useState<string | null>(null);
  const [realtimeLive, setRealtimeLive] = useState(false);
  const pathname = usePathname();
  const ref = useRef<HTMLDivElement>(null);
  // Notification ids we have already processed, so a poll never re-pops a toast.
  const seenIds = useRef<Set<string>>(new Set());
  const initialized = useRef(false);
  // Máy này có đăng ký Web Push không. Có thì popup ngoài trình duyệt là việc
  // của service worker, chuông không bật thêm cái thứ hai.
  const pushSubscribedRef = useRef(false);
  const alertsMutedRef = useRef(false);
  const pingTimerRef = useRef<number | null>(null);

  // Mốc thời điểm của thông báo mới nhất (đã đọc hay chưa) mà chuông đã nạp.
  // Dùng thời điểm chứ không dùng số chưa đọc: số đó là tổng của ba bảng và
  // lên xuống hai chiều, nên một cái mới tới đúng lúc một cái cũ được đọc là
  // tổng không đổi.
  const cursorRef = useRef<string | null>(null);
  const summaryInFlightRef = useRef(false);

  // Reads made in this tab. A response fetched before one of them still says
  // "unread"; these keep it from flipping the item (and the badge) back.
  const readIdsRef = useRef<Set<string>>(new Set());
  /** Put back to unread here ("Mark as unread"); wins over the reads above. */
  const unreadIdsRef = useRef<Set<string>>(new Set());
  /** "Mark all read" covered everything created up to this instant (ms). */
  const allReadUpToRef = useRef<number | null>(null);
  /** Bumped by every read made here: a count fetched across one is stale. */
  const readEpochRef = useRef(0);
  /** Read requests still on their way to the server. */
  const pendingReadsRef = useRef(0);
  /** Newest first-page request per tab; an older response is dropped. */
  const requestSeqRef = useRef<Record<ListTab, number>>({ unread: 0, all: 0 });
  const fetchedAtRef = useRef<Record<ListTab, number | null>>({ unread: null, all: null });
  /** Something new arrived since the All tab was fetched. */
  const allStaleRef = useRef(true);

  const applyLocalReads = useCallback(
    (list: Notif[]) =>
      list.map((n) => {
        if (unreadIdsRef.current.has(n.id)) return n.is_read ? { ...n, is_read: false } : n;
        return !n.is_read &&
          (readIdsRef.current.has(n.id) ||
            (allReadUpToRef.current !== null && Date.parse(n.created_at) <= allReadUpToRef.current))
          ? { ...n, is_read: true }
          : n;
      }),
    [],
  );

  /** Takes the server's unread count unless a read made here may be missing from it. */
  const acceptCount = useCallback((count: number | null, epochAtStart: number) => {
    if (count === null) return;
    if (epochAtStart !== readEpochRef.current || pendingReadsRef.current > 0) return;
    setUnread(count);
  }, []);

  const load = useCallback(async (): Promise<boolean> => {
    const seq = ++requestSeqRef.current.unread;
    const epoch = readEpochRef.current;
    const page = await requestNotificationPage("unread");
    if (!page) return false;
    if (seq !== requestSeqRef.current.unread) return true;

    const list = applyLocalReads(page.list);
    alertsMutedRef.current = page.alertsMuted;
    fetchedAtRef.current.unread = Date.now();
    setUnreadList((current) => ({
      ...mergeFirstPage(list, page.hasMore, current),
      fetchedAt: Date.now(),
    }));
    acceptCount(page.unread, epoch);
    setTopic(page.topic);
    // Mốc chỉ tiến ở ĐÂY, tức sau khi đã thật sự cầm được danh sách. Tiến mốc
    // trước khi nạp là nếu request hỏng, những lượt sau thấy mốc đã bằng nhau
    // rồi thôi — thông báo bị bỏ lỡ vĩnh viễn.
    const previousCursor = cursorRef.current;
    cursorRef.current = page.latestAt ?? newestNotificationAt(list) ?? cursorRef.current;

    if (!initialized.current) {
      // First load: remember what already exists; don't pop toasts for old items.
      list.forEach((n) => seenIds.current.add(n.id));
      initialized.current = true;
      if (
        list.some(
          (notification) =>
            !notification.is_read &&
            notification.entity_accessible !== false &&
            entityKind(notification) === "task",
        )
      ) {
        publishTaskDataInvalidation();
      }
      return true;
    }

    // Only rows newer than the previous mark are news. Reading the top of the
    // Unread list pulls older unread rows into page 1, and those must not pop
    // up as toasts or chime.
    const previousAt = previousCursor ? Date.parse(previousCursor) : null;
    const unseen = list.filter(
      (n) =>
        !seenIds.current.has(n.id) &&
        (previousAt === null || Date.parse(n.created_at) > previousAt),
    );
    const fresh = unseen.filter((n) => !n.is_read);
    list.forEach((n) => seenIds.current.add(n.id));
    if (unseen.length > 0) allStaleRef.current = true;

    // Assignment and other task notifications are a second reliable signal
    // that the board snapshot is stale. This repairs the list immediately
    // even when the separate global tasks-stream ping was missed.
    const invalidation = resolveNotificationInvalidation(
      unseen.filter((notification) => notification.entity_accessible !== false).map((notification) => ({
        kind: entityKind(notification),
        id: entityId(notification),
      })),
    );
    if (invalidation) publishTaskDataInvalidation(invalidation);

    // Toast nằm trong trang nên tab nào cũng dựng được — người dùng chỉ thấy
    // toast của tab đang nhìn. Tiếng chuông và popup hệ điều hành thì thoát ra
    // ngoài tab, nên chỉ MỘT tab được phát (xem alertFreshNotifications).
    // Oldest first so the newest toast ends up on top of the stack.
    for (const n of [...fresh].reverse()) {
      setToasts((cur) => [n, ...cur].slice(0, 4));
      const id = n.id;
      setTimeout(
        () => setToasts((cur) => cur.filter((t) => t.id !== id)),
        TOAST_MS
      );
    }
    if (fresh.length > 0) {
      const alertable = alertableNotifications(fresh, alertsMutedRef.current);
      if (alertable.length > 0) {
        void alertFreshNotifications(alertable, pushSubscribedRef.current);
      }
    }
    return true;
  }, [acceptCount, applyLocalReads]);

  const loadAll = useCallback(async () => {
    const seq = ++requestSeqRef.current.all;
    const epoch = readEpochRef.current;
    allStaleRef.current = false;
    const page = await requestNotificationPage("all");
    if (!page) {
      allStaleRef.current = true;
      return;
    }
    if (seq !== requestSeqRef.current.all) return;
    const list = applyLocalReads(page.list);
    fetchedAtRef.current.all = Date.now();
    setAllList((current) => ({
      ...mergeFirstPage(list, page.hasMore, current),
      fetchedAt: Date.now(),
    }));
    acceptCount(page.unread, epoch);
  }, [acceptCount, applyLocalReads]);

  const loadSummary = useCallback(async () => {
    // Chặn chồng lượt: một lượt chậm trả về sau lượt mới hơn sẽ ghi đè mốc bằng
    // dữ liệu cũ, và lần sau lại tưởng có thông báo mới.
    if (summaryInFlightRef.current) return;
    summaryInFlightRef.current = true;
    const epoch = readEpochRef.current;
    try {
      const res = await fetch("/api/tasks/notifications?mode=summary", {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = await res.json();
      setTopic((data.topic as string | null) ?? null);

      const latestAt = (data.latestAt as string | null) ?? null;
      // Đây là đường dự phòng DUY NHẤT khi realtime im tiếng. Không có nó, con
      // số trên chuông nhảy mà không có gì dựng toast hay kêu chuông, nên người
      // dùng chỉ biết lúc tự bấm vào chuông.
      if (hasNewerNotification(cursorRef.current, latestAt)) {
        allStaleRef.current = true;
        await load();
        return;
      }
      // Lần quan sát đầu tiên: đặt mốc mà KHÔNG nạp, để khỏi dựng toast cho
      // những thông báo cũ người dùng đã đọc từ lâu.
      if (cursorRef.current === null) cursorRef.current = latestAt;
      acceptCount(typeof data.unread === "number" ? data.unread : null, epoch);
    } catch {
      // The full load/realtime signal remains the fallback for transient
      // failures; summary polling is only a badge freshness optimization.
    } finally {
      summaryInFlightRef.current = false;
    }
  }, [acceptCount, load]);

  /** Fetches a tab's first page when the cached one is missing or old. */
  const refreshTab = useCallback(
    (which: ListTab, force = false) => {
      const fetchedAt = fetchedAtRef.current[which];
      const stale =
        force ||
        fetchedAt === null ||
        Date.now() - fetchedAt > LIST_STALE_MS ||
        (which === "all" && allStaleRef.current);
      if (stale) void (which === "unread" ? load() : loadAll());
    },
    [load, loadAll],
  );

  /** Applies a change to every list the dropdown can show. */
  const updateEveryList = useCallback((update: (list: Notif[]) => Notif[]) => {
    setUnreadList((current) => ({ ...current, items: update(current.items) }));
    setAllList((current) => ({ ...current, items: update(current.items) }));
  }, []);

  const activeList = tab === "unread" ? unreadList : allList;
  // A row read here leaves the Unread tab at once, whatever a slower
  // response still says about it.
  const visibleItems =
    tab === "unread" ? activeList.items.filter((n) => !n.is_read) : activeList.items;
  const hasMore = activeList.hasMore;
  const firstPageLoading = activeList.fetchedAt === null;

  async function loadMore() {
    if (loadingMore) return;
    const which = tab;
    const current = which === "unread" ? unreadList : allList;
    setLoadingMore(true);
    try {
      const page = await requestNotificationPage(which, current.items);
      if (!page) return;
      const list = applyLocalReads(page.list);
      // An older page's unread count is not used: the first page owns the badge.
      (which === "unread" ? setUnreadList : setAllList)((latest) => ({
        ...latest,
        items: mergeNotifs(latest.items, list),
        hasMore: page.hasMore,
      }));
    } finally {
      setLoadingMore(false);
    }
  }

  // Reading the whole first page must not leave "No unread notifications"
  // while older unread rows wait on the server: fetch page 1 again. Waits for
  // reads in flight, or the server would still list the rows just read.
  const visibleUnreadCount = unreadList.items.filter((n) => !n.is_read).length;
  useEffect(() => {
    if (visibleUnreadCount > 0 || !unreadList.hasMore || pendingReadsRef.current > 0) return;
    void load();
  }, [load, readsSettled, unreadList.hasMore, visibleUnreadCount]);

  function selectTab(next: ListTab) {
    setTab(next);
    refreshTab(next);
  }

  useEffect(() => {
    const pollMs = realtimeLive ? POLL_REALTIME_MS : POLL_FALLBACK_MS;
    const first = setTimeout(() => {
      if (document.visibilityState !== "visible") return;
      // Populate the initial list once. Every later background request is a
      // summary-only request unless a realtime event asks for full content.
      void (initialized.current ? loadSummary() : load());
    }, 0);
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void loadSummary();
    }, pollMs);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [load, loadSummary, realtimeLive]);

  useEffect(() => {
    const refreshFromForeground = () => {
      if (document.visibilityState !== "visible") return;
      // An open dropdown refreshes the tab it shows. The closed bell only
      // needs its cheap unread summary.
      if (open) refreshTab(tab, true);
      else void (initialized.current ? loadSummary() : load());
    };
    window.addEventListener("focus", refreshFromForeground);
    document.addEventListener("visibilitychange", refreshFromForeground);
    return () => {
      window.removeEventListener("focus", refreshFromForeground);
      document.removeEventListener("visibilitychange", refreshFromForeground);
    };
  }, [load, loadSummary, open, refreshTab, tab]);

  // Máy có push thì service worker lo popup. Đọc lại mỗi lần cửa sổ được focus,
  // vì người dùng có thể vừa bật/tắt push ở Settings trong tab khác.
  useEffect(() => {
    let active = true;
    const refresh = () => {
      void isPushEnabledOnThisDevice()
        .then((enabled) => {
          if (active) pushSubscribedRef.current = enabled;
        })
        .catch(() => {});
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
    };
  }, []);

  // Mở task trên board là đã đọc mọi thông báo của task đó (TaskBoardClient).
  useEffect(
    () =>
      subscribeNotificationsRead((taskId) => {
        const isThisTask = (n: Notif) => entityKind(n) === "task" && entityId(n) === taskId;
        for (const n of [...unreadList.items, ...allList.items]) {
          if (!isThisTask(n)) continue;
          readIdsRef.current.add(n.id);
          unreadIdsRef.current.delete(n.id);
        }
        updateEveryList((cur) =>
          cur.map((n) => (isThisTask(n) && !n.is_read ? { ...n, is_read: true } : n))
        );
        setUnreadList((current) => ({
          ...current,
          items: current.items.filter((n) => !isThisTask(n)),
        }));
        void loadSummary();
      }),
    [allList.items, loadSummary, unreadList.items, updateEveryList]
  );

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
    let active = true;
    const channel = sb
      .channel(topic)
      .on("broadcast", { event: "new" }, () => {
        // Gom các ping liền nhau: một lượt cron có thể ping hàng chục lần cho
        // cùng một người, mỗi ping là một lần tải và một tiếng chuông.
        if (pingTimerRef.current !== null) window.clearTimeout(pingTimerRef.current);
        pingTimerRef.current = window.setTimeout(() => {
          pingTimerRef.current = null;
          allStaleRef.current = true;
          void load();
        }, REALTIME_PING_DEBOUNCE_MS);
      })
      .subscribe((status) => {
        if (!active) return;
        if (status === "SUBSCRIBED") {
          setRealtimeLive(true);
        } else if (
          status === "CHANNEL_ERROR" ||
          status === "TIMED_OUT" ||
          status === "CLOSED"
        ) {
          setRealtimeLive(false);
        }
      });
    return () => {
      active = false;
      if (pingTimerRef.current !== null) {
        window.clearTimeout(pingTimerRef.current);
        pingTimerRef.current = null;
      }
      setRealtimeLive(false);
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
    const next = !open;
    setOpen(next);
    // Show what is cached at once; fetch only the open tab, and only if old.
    if (next) refreshTab(tab);
  }

  /**
   * Đánh dấu đã đọc đổi ngay; lỗi thì chỉ trả lại đúng những thông báo lượt này
   * đã đổi. Xong (dù được hay hỏng) thì lấy số chưa đọc chuẩn từ server thay vì
   * cộng trừ tay — poll/realtime có thể đã đổi con số đó (plan instant feedback T3.5).
   */
  async function postRead(body: { ids?: string[]; before?: string; read?: false }): Promise<boolean> {
    readEpochRef.current += 1;
    pendingReadsRef.current += 1;
    try {
      const response = await fetch("/api/tasks/notifications/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      pendingReadsRef.current -= 1;
      // Counts were held back while this travelled; ask again now it is saved.
      if (pendingReadsRef.current === 0) {
        setReadsSettled((current) => current + 1);
        void loadSummary();
      }
    }
  }

  async function markRead(ids: string[]) {
    if (ids.length === 0) return;
    const known = new Map([...allList.items, ...unreadList.items].map((n) => [n.id, n]));
    // Chỉ những thông báo đang chưa đọc mới làm giảm số trên chuông (trước đây
    // trừ cả thông báo đã đọc rồi). Id chưa có trong danh sách coi như chưa đọc.
    const changedIds = ids.filter((id) => !known.get(id)?.is_read);
    if (changedIds.length === 0) return;
    const changed = new Set(changedIds);
    const wasPutBack = changedIds.filter((id) => unreadIdsRef.current.has(id));
    changedIds.forEach((id) => {
      readIdsRef.current.add(id);
      unreadIdsRef.current.delete(id);
    });
    const removed = unreadList.items.filter((n) => changed.has(n.id));
    updateEveryList((cur) => cur.map((n) => (changed.has(n.id) ? { ...n, is_read: true } : n)));
    setUnreadList((current) => ({
      ...current,
      items: current.items.filter((n) => !changed.has(n.id)),
    }));
    setUnread((current) => Math.max(0, current - changedIds.length));
    if (await postRead({ ids })) return;
    changedIds.forEach((id) => readIdsRef.current.delete(id));
    wasPutBack.forEach((id) => unreadIdsRef.current.add(id));
    updateEveryList((cur) => cur.map((n) => (changed.has(n.id) ? { ...n, is_read: false } : n)));
    setUnreadList((current) => ({
      ...current,
      items: mergeNotifs(current.items, removed.map((n) => ({ ...n, is_read: false }))),
    }));
  }

  /** Puts a read notification back on the Unread tab, to deal with later. */
  async function markUnread(n: Notif) {
    if (!n.is_read) return;
    readIdsRef.current.delete(n.id);
    unreadIdsRef.current.add(n.id);
    const back = { ...n, is_read: false };
    updateEveryList((cur) => cur.map((item) => (item.id === n.id ? back : item)));
    setUnreadList((current) => ({ ...current, items: mergeNotifs([back], current.items) }));
    setUnread((current) => current + 1);
    if (await postRead({ ids: [n.id], read: false })) return;
    unreadIdsRef.current.delete(n.id);
    updateEveryList((cur) => cur.map((item) => (item.id === n.id ? { ...item, is_read: true } : item)));
  }

  async function markAllRead() {
    if (unread === 0) return;
    // Only what this bell has seen. A notification that lands while the
    // request travels stays unread instead of being cleared unseen.
    const upTo = cursorRef.current ?? newestNotificationAt([...unreadList.items, ...allList.items]);
    if (!upTo) return;
    const upToMs = Date.parse(upTo);
    const previousUpTo = allReadUpToRef.current;
    const previousPutBack = new Set(unreadIdsRef.current);
    allReadUpToRef.current = upToMs;
    // Mark all read clears the to-dos too: they were all created before now.
    unreadIdsRef.current.clear();
    const changed = new Set(
      [...unreadList.items, ...allList.items]
        .filter((n) => !n.is_read && Date.parse(n.created_at) <= upToMs)
        .map((n) => n.id),
    );
    const removed = unreadList.items.filter((n) => changed.has(n.id));
    setUnread(0);
    updateEveryList((cur) => cur.map((n) => (changed.has(n.id) ? { ...n, is_read: true } : n)));
    setUnreadList((current) => ({
      ...current,
      items: current.items.filter((n) => !changed.has(n.id)),
    }));
    setToasts([]);
    if (await postRead({ before: upTo })) return;
    allReadUpToRef.current = previousUpTo;
    unreadIdsRef.current = previousPutBack;
    updateEveryList((cur) => cur.map((n) => (changed.has(n.id) ? { ...n, is_read: false } : n)));
    setUnreadList((current) => ({
      ...current,
      items: mergeNotifs(current.items, removed.map((n) => ({ ...n, is_read: false }))),
    }));
  }

  const dismissToast = (id: string) =>
    setToasts((cur) => cur.filter((t) => t.id !== id));

  function handleOpenNotification(
    n: Notif,
    event?: ReactMouseEvent<HTMLAnchorElement>
  ) {
    if (n.entity_accessible === false) {
      event?.preventDefault();
      setOpen(false);
      dismissToast(n.id);
      if (!n.is_read) void markRead([n.id]);
      return;
    }
    setOpen(false);
    dismissToast(n.id);
    if (!n.is_read) void markRead([n.id]);
    if (entityKind(n) === "task" && pathname === "/tasks") {
      event?.preventDefault();
      dispatchOpenTask(entityId(n));
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
            <div role="tablist" className="flex gap-4 border-b border-slate-100 px-3">
              {(
                [
                  ["all", "All"],
                  ["unread", "Unread"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={tab === value}
                  onClick={() => selectTab(value)}
                  className={`-mb-px flex items-center gap-1.5 border-b-2 py-2 text-xs font-semibold transition ${
                    tab === value
                      ? "border-[#0c66e4] text-[#0c66e4]"
                      : "border-transparent text-slate-500 hover:text-slate-800"
                  }`}
                >
                  {label}
                  {value === "unread" && unread > 0 ? (
                    <span className="rounded-full bg-[#e9f2ff] px-1.5 text-[10px] font-bold tabular-nums text-[#0c66e4]">
                      {unread}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
            <div className="max-h-80 overflow-y-auto">
              {visibleItems.length === 0 ? (
                <p className="px-3 py-6 text-center text-xs text-slate-400">
                  {firstPageLoading
                    ? "Loading…"
                    : tab === "unread"
                      ? "No unread notifications."
                      : "Nothing yet."}
                </p>
              ) : (
                visibleItems.map((n) => (
                  // The button sits beside the link, not inside it: a button
                  // inside an <a> is invalid and its click would open the item.
                  <div key={n.id} className="group relative">
                    <Link
                      href={notificationHref(n)}
                      onClick={(event) => handleOpenNotification(n, event)}
                      className={`block py-2.5 pl-3 pr-11 hover:bg-slate-50 ${
                        n.is_read ? "" : "bg-blue-50/40"
                      }`}
                    >
                      <NotifContent n={n} />
                    </Link>
                    {!n.is_read ? (
                      <button
                        type="button"
                        onClick={() => void markRead([n.id])}
                        aria-label="Mark as read"
                        title="Mark as read"
                        className={ROW_ACTION_CLASS}
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                    ) : canMarkUnread(n) ? (
                      <button
                        type="button"
                        onClick={() => void markUnread(n)}
                        aria-label="Mark as unread"
                        title="Mark as unread — keep it on the Unread tab"
                        className={ROW_ACTION_CLASS}
                      >
                        <Undo2 className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </div>
                ))
              )}
              {hasMore && visibleItems.length > 0 ? (
                <button
                  type="button"
                  disabled={loadingMore}
                  onClick={() => void loadMore()}
                  className="w-full border-t border-slate-100 px-3 py-2.5 text-center text-xs font-semibold text-[#0c66e4] transition hover:bg-[#e9f2ff] disabled:cursor-wait disabled:text-slate-400"
                >
                  {loadingMore ? "Loading…" : "Load older"}
                </button>
              ) : null}
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
              href={notificationHref(n)}
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
          {n.entity_accessible === false ? "Unavailable" : entityKey(n)}
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
        {n.entity_accessible === false ? (
          "You no longer have access to this record."
        ) : isSystemNotif(n) ? (
          actionText(n)
        ) : (
          <>
            <span className="font-semibold">{actorName(n)}</span> {actionText(n)}
          </>
        )}
      </p>
      {n.task_title && (
        <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-slate-500" title={n.task_title}>
          <span className="font-semibold text-slate-600">{entityLabel(n)}:</span>{" "}
          {n.task_title}
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
      {/* waiting_reminder dùng detail để phân biệt Waiting với Billing, và câu
          chữ đã nói rõ chặng — in thêm "Detail: billing" chỉ là lặp lại. */}
      {n.detail && n.type !== "waiting_reminder" && (
        <p
          className="mt-0.5 line-clamp-2 text-xs leading-5 text-slate-500"
          title={n.detail}
        >
          <span className="font-semibold text-slate-600">{detailLabel(n)}:</span>{" "}
          &quot;{n.detail}&quot;
        </p>
      )}
    </>
  );
}
