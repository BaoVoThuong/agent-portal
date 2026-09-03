"use client";

import {
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  HeartPulse,
  Palmtree,
  Plus,
  Search,
  Umbrella,
  UserRound,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type {
  TimeOffDashboardData,
  TimeOffBalanceAdjustment,
  TimeOffCalendarEvent,
  TimeOffHoliday,
  TimeOffPolicy,
  TimeOffRequest,
  TimeOffTeamMember,
} from "@/lib/time-off/types";

type Tab = "overview" | "requests" | "admin";
type AdminSection = "balances" | "history" | "company-days";

type Props = {
  canManage: boolean;
  monthKey: string;
  initialTab: Tab;
  initialData: TimeOffDashboardData;
};

type CalendarData = {
  month: string;
  holidays: TimeOffHoliday[];
  calendar_requests: TimeOffCalendarEvent[];
};

type StoredCalendarData = {
  expiresAt: number;
  calendar: CalendarData;
};

const CALENDAR_CACHE_PREFIX = "time-off:calendar:v1:";
const CALENDAR_CACHE_TTL = 10 * 60 * 1000;

function calendarStorageKey(month: string) {
  return `${CALENDAR_CACHE_PREFIX}${month}`;
}

function getStoredCalendar(month: string): CalendarData | null {
  if (typeof window === "undefined") return null;

  try {
    const rawValue = window.sessionStorage.getItem(calendarStorageKey(month));
    if (!rawValue) return null;

    const stored = JSON.parse(rawValue) as StoredCalendarData;
    if (!stored?.calendar || stored.expiresAt <= Date.now()) {
      window.sessionStorage.removeItem(calendarStorageKey(month));
      return null;
    }

    return stored.calendar;
  } catch {
    return null;
  }
}

function storeCalendar(calendar: CalendarData) {
  if (typeof window === "undefined") return;

  try {
    const payload: StoredCalendarData = {
      expiresAt: Date.now() + CALENDAR_CACHE_TTL,
      calendar,
    };
    window.sessionStorage.setItem(calendarStorageKey(calendar.month), JSON.stringify(payload));
  } catch {
    // Calendar navigation still works when browser storage is unavailable.
  }
}

function removeStoredCalendar(month: string) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(calendarStorageKey(month));
  } catch {
    // Storage may be disabled; in-memory invalidation still runs.
  }
}

const STATUS_STYLE: Record<TimeOffRequest["status"], string> = {
  pending: "bg-amber-50 text-amber-700 ring-amber-200",
  approved: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  rejected: "bg-rose-50 text-rose-700 ring-rose-200",
  cancelled: "bg-slate-100 text-slate-600 ring-slate-200",
};

function dateAt(value: string) {
  return new Date(`${value}T00:00:00Z`);
}

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function formatDate(value: string, options: Intl.DateTimeFormatOptions = {}) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    ...options,
  }).format(dateAt(value));
}

function formatDateRange(start: string, end: string) {
  if (start === end) return formatDate(start, { month: "long", day: "numeric", year: "numeric" });
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  return `${formatDate(start, { month: "short", day: "numeric" })} – ${formatDate(end, {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  })}`;
}

function monthLabel(monthKey: string) {
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(dateAt(`${monthKey}-01`));
}

function nextMonth(monthKey: string, delta: number) {
  const [year, month] = monthKey.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1 + delta, 1));
  return next.toISOString().slice(0, 7);
}

function calendarDays(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1, 1));
  const firstVisible = new Date(first);
  firstVisible.setUTCDate(firstVisible.getUTCDate() - first.getUTCDay());
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const visibleDays = Math.max(35, Math.ceil((first.getUTCDay() + lastDay) / 7) * 7);
  return Array.from({ length: visibleDays }, (_, index) => {
    const day = new Date(firstVisible);
    day.setUTCDate(firstVisible.getUTCDate() + index);
    return { key: dateKey(day), day: day.getUTCDate(), inMonth: day.getUTCMonth() === month - 1 };
  });
}

function initials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : parts[0]?.slice(0, 2) ?? "?").toUpperCase();
}

function PolicyIcon({ code }: { code: string }) {
  if (code === "vacation") return <Palmtree className="h-5 w-5" />;
  if (code === "sick") return <HeartPulse className="h-5 w-5" />;
  if (code === "personal") return <UserRound className="h-5 w-5" />;
  return <Umbrella className="h-5 w-5" />;
}

function readableStatus(status: TimeOffRequest["status"]) {
  return status[0].toUpperCase() + status.slice(1);
}

export default function TimeOffClient({ canManage, monthKey, initialTab, initialData }: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [adminSection, setAdminSection] = useState<AdminSection>("balances");
  const [showRequest, setShowRequest] = useState(false);
  const [showHoliday, setShowHoliday] = useState(false);
  const [showBalanceSetup, setShowBalanceSetup] = useState(false);
  const [decisionRequest, setDecisionRequest] = useState<TimeOffRequest | null>(null);
  const [decisionAction, setDecisionAction] = useState<"approve" | "reject" | null>(null);
  const [decisionNote, setDecisionNote] = useState("");
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [requestPolicy, setRequestPolicy] = useState(initialData.policies[0]?.code ?? "vacation");
  const [requestStart, setRequestStart] = useState("");
  const [requestEnd, setRequestEnd] = useState("");
  const [requestReason, setRequestReason] = useState("");
  const [holidayDate, setHolidayDate] = useState("");
  const [holidayName, setHolidayName] = useState("");
  const [balanceAccountId, setBalanceAccountId] = useState("");
  const [balancePolicy, setBalancePolicy] = useState(
    initialData.policies.find((policy) => policy.counts_toward_balance)?.code ?? "vacation"
  );
  const [balanceMonth, setBalanceMonth] = useState(monthKey);
  const [balanceDelta, setBalanceDelta] = useState("");
  const [balanceNote, setBalanceNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const initialCalendarData: CalendarData = {
    month: monthKey,
    holidays: initialData.holidays,
    calendar_requests: initialData.calendar_requests,
  };
  const calendarCache = useRef(new Map<string, CalendarData>([[monthKey, initialCalendarData]]));
  const calendarYearPreloads = useRef(new Map<string, Promise<void>>());
  const calendarYearVersions = useRef(new Map<string, number>());
  const [calendarData, setCalendarData] = useState<CalendarData>(initialCalendarData);
  const [calendarLoading, setCalendarLoading] = useState(false);

  function selectTab(nextTab: Tab) {
    setTab(nextTab);
    const url = new URL(window.location.href);
    if (nextTab === "overview") url.searchParams.delete("tab");
    else url.searchParams.set("tab", nextTab);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }

  const policiesByCode = useMemo(
    () => new Map(initialData.policies.map((policy) => [policy.code, policy])),
    [initialData.policies]
  );
  const balancesByPolicy = useMemo(
    () => new Map(initialData.balances.map((balance) => [balance.policy_code, balance])),
    [initialData.balances]
  );
  const holidaysByDate = useMemo(
    () => new Map(calendarData.holidays.map((holiday) => [holiday.date, holiday])),
    [calendarData.holidays]
  );
  const cells = useMemo(() => calendarDays(calendarData.month), [calendarData.month]);
  const balanceYear = monthKey.slice(0, 4);
  const adjustablePolicies = useMemo(
    () => initialData.policies.filter((policy) => policy.counts_toward_balance),
    [initialData.policies]
  );
  const selectedBalanceMember = initialData.team_members.find((member) => member.id === balanceAccountId);
  const selectedBalance = selectedBalanceMember?.balances.find((balance) => balance.policy_code === balancePolicy);
  const selectedBalancePolicy = policiesByCode.get(balancePolicy);
  const selectedBalanceTotal = selectedBalance?.entitlement_days === null || selectedBalance?.entitlement_days === undefined
    ? null
    : selectedBalance.entitlement_days + selectedBalance.adjustment_days;
  const selectedBalanceAvailable = selectedBalanceTotal === null
    ? null
    : Math.max(0, selectedBalanceTotal - (selectedBalance?.used_days ?? 0));
  const selectedBalanceHistory = initialData.balance_adjustments
    .filter((adjustment) => adjustment.account_id === balanceAccountId && adjustment.policy_code === balancePolicy)
    .slice(0, 4);
  const personalUpcoming = initialData.my_requests
    .filter((request) => request.status === "approved" && request.end_date >= dateKey(new Date()))
    .sort((a, b) => a.start_date.localeCompare(b.start_date))
    .slice(0, 4);

  function openRequest(date?: string) {
    setError(null);
    setRequestStart(date ?? "");
    setRequestEnd(date ?? "");
    setRequestReason("");
    setShowRequest(true);
  }

  function openBalanceSetup(accountId?: string) {
    setError(null);
    setBalanceAccountId(accountId ?? "");
    setBalancePolicy(adjustablePolicies[0]?.code ?? "vacation");
    setBalanceMonth(monthKey);
    setBalanceDelta("");
    setBalanceNote("");
    setShowBalanceSetup(true);
  }

  const rememberCalendar = useCallback((calendar: CalendarData) => {
    calendarCache.current.set(calendar.month, calendar);
    storeCalendar(calendar);
  }, []);

  const prefetchCalendarYear = useCallback(async (year: string) => {
    const existingPreload = calendarYearPreloads.current.get(year);
    if (existingPreload) return existingPreload;

    const version = calendarYearVersions.current.get(year) ?? 0;
    const preload = (async () => {
      try {
        const response = await fetch(`/api/time-off/calendar?year=${encodeURIComponent(year)}`);
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.error ?? "Unable to load the calendar.");
        if (!Array.isArray(payload?.calendars)) throw new Error("Calendar data is unavailable.");

        if ((calendarYearVersions.current.get(year) ?? 0) === version) {
          for (const calendar of payload.calendars as CalendarData[]) rememberCalendar(calendar);
        }
      } finally {
        // An invalidation may have started a newer preload for this year.
        if ((calendarYearVersions.current.get(year) ?? 0) === version) {
          calendarYearPreloads.current.delete(year);
        }
      }
    })();

    calendarYearPreloads.current.set(year, preload);
    return preload;
  }, [rememberCalendar]);

  const fetchCalendarMonth = useCallback(async (targetMonth: string): Promise<CalendarData> => {
    const cached = calendarCache.current.get(targetMonth);
    if (cached) return cached;

    const stored = getStoredCalendar(targetMonth);
    if (stored) {
      calendarCache.current.set(targetMonth, stored);
      return stored;
    }

    const pendingYearPreload = calendarYearPreloads.current.get(targetMonth.slice(0, 4));
    if (pendingYearPreload) {
      await pendingYearPreload.catch(() => undefined);
      const preloaded = calendarCache.current.get(targetMonth) ?? getStoredCalendar(targetMonth);
      if (preloaded) {
        calendarCache.current.set(targetMonth, preloaded);
        return preloaded;
      }
    }

    const response = await fetch(`/api/time-off/calendar?month=${encodeURIComponent(targetMonth)}`);
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error ?? "Unable to load the calendar.");
    const calendar = payload as CalendarData;
    rememberCalendar(calendar);
    return calendar;
  }, [rememberCalendar]);

  useEffect(() => {
    const serverCalendar: CalendarData = {
      month: monthKey,
      holidays: initialData.holidays,
      calendar_requests: initialData.calendar_requests,
    };
    rememberCalendar(serverCalendar);
  }, [initialData.calendar_requests, initialData.holidays, monthKey, rememberCalendar]);

  useEffect(() => {
    void prefetchCalendarYear(calendarData.month.slice(0, 4)).catch(() => undefined);
  }, [calendarData.month, prefetchCalendarYear]);

  const refreshVisibleCalendar = useCallback(async () => {
    const activeMonth = calendarData.month;
    const activeYear = activeMonth.slice(0, 4);
    for (const cachedMonth of calendarCache.current.keys()) {
      if (cachedMonth.startsWith(`${activeYear}-`)) {
        calendarCache.current.delete(cachedMonth);
        removeStoredCalendar(cachedMonth);
      }
    }
    calendarYearVersions.current.set(activeYear, (calendarYearVersions.current.get(activeYear) ?? 0) + 1);
    calendarYearPreloads.current.delete(activeYear);
    const freshCalendar = await fetchCalendarMonth(activeMonth);
    setCalendarData(freshCalendar);
  }, [calendarData.month, fetchCalendarMonth]);

  async function navigateMonth(delta: number) {
    if (calendarLoading) return;
    const targetMonth = nextMonth(calendarData.month, delta);
    setCalendarLoading(true);
    setError(null);
    try {
      const calendar = await fetchCalendarMonth(targetMonth);
      setCalendarData(calendar);
      const url = new URL(window.location.href);
      url.searchParams.set("month", targetMonth);
      window.history.pushState(null, "", `${url.pathname}${url.search}${url.hash}`);
    } catch (calendarError) {
      setError(calendarError instanceof Error ? calendarError.message : "Unable to load the calendar.");
    } finally {
      setCalendarLoading(false);
    }
  }

  async function readResponse(response: Response) {
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error ?? "Something went wrong. Please try again.");
    return payload;
  }

  async function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("request");
    setError(null);
    try {
      await readResponse(await fetch("/api/time-off", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          policy_code: requestPolicy,
          start_date: requestStart,
          end_date: requestEnd,
          reason: requestReason,
        }),
      }));
      setShowRequest(false);
      setNotice("Time-off request sent for approval.");
      router.refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to send request.");
    } finally {
      setBusy(null);
    }
  }

  function openDecision(request: TimeOffRequest, action: "approve" | "reject") {
    setError(null);
    setDecisionError(null);
    setDecisionRequest(request);
    setDecisionAction(action);
    setDecisionNote("");
  }

  async function decide(request: TimeOffRequest, action: "approve" | "reject" | "cancel", note = "") {
    setBusy(`${action}-${request.id}`);
    setError(null);
    setDecisionError(null);
    try {
      await readResponse(await fetch(`/api/time-off/requests/${request.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, note }),
      }));
      if (action === "approve") await refreshVisibleCalendar();
      setDecisionRequest(null);
      setDecisionAction(null);
      setDecisionNote("");
      setDecisionError(null);
      setNotice(action === "approve" ? "Request approved." : action === "reject" ? "Request declined." : "Request cancelled.");
      if (action === "approve" || action === "reject") selectTab("admin");
      router.refresh();
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "Unable to update request.";
      setError(message);
      if (action === "approve" || action === "reject") setDecisionError(message);
    } finally {
      setBusy(null);
    }
  }

  async function submitHoliday(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("holiday");
    setError(null);
    try {
      await readResponse(await fetch("/api/time-off/holidays", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: holidayDate, name: holidayName }),
      }));
      setShowHoliday(false);
      setHolidayDate("");
      setHolidayName("");
      setNotice("Company day off added to the calendar.");
      await refreshVisibleCalendar();
      router.refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to add company day off.");
    } finally {
      setBusy(null);
    }
  }

  async function submitBalanceAdjustment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("balance-adjustment");
    setError(null);
    try {
      await readResponse(await fetch("/api/time-off/balances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: balanceAccountId,
          policy_code: balancePolicy,
          month: balanceMonth,
          delta_days: Number(balanceDelta),
          note: balanceNote,
        }),
      }));
      setShowBalanceSetup(false);
      setNotice("Leave balance updated and recorded in the monthly audit history.");
      router.refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to update the leave balance.");
    } finally {
      setBusy(null);
    }
  }

  async function removeHoliday(holiday: TimeOffHoliday) {
    if (!confirm(`Remove ${holiday.name} from the company calendar?`)) return;
    setBusy(`holiday-${holiday.id}`);
    setError(null);
    try {
      await readResponse(await fetch(`/api/time-off/holidays/${holiday.id}`, { method: "DELETE" }));
      setNotice("Company day off removed.");
      await refreshVisibleCalendar();
      router.refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to remove company day off.");
    } finally {
      setBusy(null);
    }
  }

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "overview", label: "Overview" },
    { id: "requests", label: "My requests", count: initialData.my_requests.filter((item) => item.status === "pending").length },
    ...(canManage ? [
      { id: "admin" as const, label: "Administration" },
    ] : []),
  ];

  const calendar = (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-2.5">
        <div className="flex items-baseline gap-2.5">
          <h2 className="text-base font-semibold text-[#172e55]">Team calendar</h2>
          <p className="hidden text-[12px] text-slate-500 sm:block">Approved time off and US federal holidays.</p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-slate-200 p-1">
          <button type="button" disabled={calendarLoading} onClick={() => navigateMonth(-1)} className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-[#172e55] disabled:cursor-wait disabled:opacity-50" aria-label="Previous month"><ChevronLeft className="h-4 w-4" /></button>
          <span className="min-w-32 px-1 text-center text-[13px] font-semibold text-[#172e55]">{calendarLoading ? "Loading…" : monthLabel(calendarData.month)}</span>
          <button type="button" disabled={calendarLoading} onClick={() => navigateMonth(1)} className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-[#172e55] disabled:cursor-wait disabled:opacity-50" aria-label="Next month"><ChevronRight className="h-4 w-4" /></button>
        </div>
      </div>
      <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 px-2 py-1">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <div key={day} className="px-2 text-center text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">{day}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((cell) => {
          const holiday = holidaysByDate.get(cell.key);
          const requests = calendarData.calendar_requests.filter((item) => item.start_date <= cell.key && item.end_date >= cell.key);
          const isToday = cell.key === dateKey(new Date());
          return (
            <button
              type="button"
              key={cell.key}
              onClick={() => cell.inMonth && openRequest(cell.key)}
              className={`min-h-[56px] border-b border-r border-slate-100 p-1.5 text-left transition hover:bg-blue-50/50 sm:min-h-[64px] sm:p-2 ${cell.inMonth ? "bg-white" : "bg-slate-50/60"}`}
              aria-label={`Request time off starting ${cell.key}`}
            >
              <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold ${isToday ? "bg-[#1769e8] text-white" : cell.inMonth ? "text-slate-600" : "text-slate-300"}`}>{cell.day}</span>
              <div className="mt-1 space-y-0.5">
                {holiday && <div className={`truncate rounded px-1.5 py-0.5 text-[9px] font-semibold ${holiday.source === "company" ? "bg-violet-100 text-violet-700" : "bg-sky-100 text-sky-700"}`} title={holiday.name}>{holiday.name}</div>}
                {requests.slice(0, 1).map((request) => {
                  return <div key={request.id} className="truncate rounded bg-blue-50 px-1.5 py-0.5 text-[9px] font-semibold text-[#1769e8]" title={`${request.requester_name} is out`}>{request.requester_name}</div>;
                })}
                {requests.length > 1 && <p className="px-1 text-[9px] font-medium text-slate-400">+{requests.length - 1} more</p>}
              </div>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-100 px-4 py-2 text-[10px] text-slate-500">
        <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-sky-400" />US federal holiday</span>
        <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-violet-500" />Company day off</span>
        <span>Click a date to request time off.</span>
      </div>
    </section>
  );

  const requestsTable = <MyRequestsTable requests={initialData.my_requests} policiesByCode={policiesByCode} busy={Boolean(busy)} onCancel={(request) => decide(request, "cancel")} />;
  const recentMyRequests = initialData.my_requests.slice(0, 3);

  const sidebar = (
    <aside className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-4"><div className="flex items-center gap-2"><Clock3 className="h-4 w-4 text-[#1769e8]" /><h2 className="text-sm font-semibold text-[#172e55]">Upcoming time off</h2></div>{personalUpcoming.length === 0 ? <p className="mt-3 text-[13px] leading-5 text-slate-500">Nothing approved yet. Your planned time away will show here.</p> : <div className="mt-3 space-y-3">{personalUpcoming.map((request) => { const policy = policiesByCode.get(request.policy_code); return <div key={request.id} className="flex gap-3"><span className="mt-0.5 h-8 w-1 rounded-full" style={{ backgroundColor: policy?.color ?? "#64748b" }} /><div><p className="text-sm font-semibold text-[#1e355c]">{policy?.label ?? request.policy_code}</p><p className="mt-0.5 text-[13px] text-slate-500">{formatDateRange(request.start_date, request.end_date)}</p></div></div>; })}</div>}</section>
      <section className="rounded-xl border border-slate-200 bg-white p-4"><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><Building2 className="h-4 w-4 text-violet-600" /><h2 className="text-sm font-semibold text-[#172e55]">Upcoming days off</h2></div>{canManage && <button type="button" onClick={() => { setError(null); setShowHoliday(true); }} className="text-sm font-semibold text-[#1769e8] hover:text-[#115bca]">Add</button>}</div><div className="mt-3 space-y-2.5">{calendarData.holidays.slice(0, 5).map((holiday) => <div key={holiday.id} className="min-w-0"><p className="truncate text-sm font-medium text-[#1e355c]">{holiday.name}</p><p className="mt-0.5 text-xs text-slate-500">{formatDate(holiday.date, { weekday: "short", month: "short", day: "numeric" })}{holiday.source === "us_federal" ? " · US federal" : " · Company"}</p></div>)}</div></section>
      <section className="rounded-xl border border-slate-200 bg-white p-4"><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-[#1769e8]" /><h2 className="text-sm font-semibold text-[#172e55]">My requests</h2></div><button type="button" onClick={() => selectTab("requests")} className="text-sm font-semibold text-[#1769e8] hover:text-[#115bca]">View all</button></div>{recentMyRequests.length === 0 ? <p className="mt-3 text-[13px] leading-5 text-slate-500">You have not submitted any time-off requests yet.</p> : <div className="mt-3 divide-y divide-slate-100">{recentMyRequests.map((request) => { const policy = policiesByCode.get(request.policy_code); return <div key={request.id} className="py-2.5 first:pt-0 last:pb-0"><div className="flex items-start justify-between gap-2"><p className="min-w-0 truncate text-sm font-semibold text-[#1e355c]">{policy?.label ?? request.policy_code}</p><StatusBadge status={request.status} /></div><p className="mt-1 text-xs text-slate-500">{formatDateRange(request.start_date, request.end_date)} · {request.total_days} day{request.total_days === 1 ? "" : "s"}</p></div>; })}</div>}</section>
    </aside>
  );

  const administration = canManage ? (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-start sm:justify-between"><div><h2 className="text-base font-semibold text-[#172e55]">Leave administration</h2><p className="mt-0.5 text-[13px] text-slate-500">Manage team balances, leave history, and company closures.</p></div>{adminSection === "company-days" && <button type="button" onClick={() => { setError(null); setShowHoliday(true); }} className="inline-flex w-fit items-center gap-2 rounded-lg bg-[#1769e8] px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#115bca]"><Plus className="h-4 w-4" />Add company day off</button>}</div>
      <div className="mt-4 inline-flex max-w-full flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
        {(["balances", "history", "company-days"] as const).map((section) => <button key={section} type="button" onClick={() => setAdminSection(section)} className={`rounded-md px-3 py-2 text-sm font-semibold transition ${adminSection === section ? "bg-white text-[#1769e8] shadow-sm" : "text-slate-500 hover:bg-slate-50 hover:text-[#172e55]"}`}>{section === "balances" ? "Balances" : section === "history" ? "Leave history" : "Company days off"}</button>)}
      </div>
      <div className="mt-4">
        {adminSection === "balances" && <div className="space-y-4"><TeamBalanceTable members={initialData.team_members} policies={initialData.policies} onAdjust={openBalanceSetup} /><BalanceAdjustmentLog adjustments={initialData.balance_adjustments} members={initialData.team_members} policiesByCode={policiesByCode} /></div>}
        {adminSection === "history" && <div className="space-y-4">{initialData.pending_approvals.length > 0 && <ApprovalQueue requests={initialData.pending_approvals} policiesByCode={policiesByCode} busy={Boolean(busy)} onDecide={openDecision} />}<TeamLeaveLog requests={initialData.team_leave_log} members={initialData.team_members} policiesByCode={policiesByCode} /></div>}
        {adminSection === "company-days" && <CompanyDaysTable days={initialData.company_days} busy={Boolean(busy)} onRemove={removeHoliday} />}
      </div>
    </section>
  ) : null;

  return (
    <div className="min-h-full bg-[#f7f9fc] px-5 py-4 sm:px-7 lg:px-8">
      <div className="mx-auto max-w-[1320px]">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between"><div className="flex flex-wrap items-baseline gap-x-3 gap-y-1"><h1 className="text-[28px] font-bold tracking-tight text-[#172e55]">Time off</h1><p className="text-[13px] text-slate-500">Plan time away, see who is out, and keep your team covered.</p></div><button type="button" onClick={() => openRequest()} className="inline-flex w-fit items-center gap-2 rounded-lg bg-[#1769e8] px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#115bca]"><Plus className="h-4 w-4" />Request time off</button></div>

        {(error || notice) && <div role={error ? "alert" : "status"} className={`fixed left-4 right-4 top-24 z-[80] flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg sm:left-auto sm:right-5 sm:w-[420px] ${error ? "border-rose-200 bg-rose-50 text-rose-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}><span>{error ?? notice}</span><button type="button" onClick={() => { setError(null); setNotice(null); }} className="shrink-0 opacity-70 hover:opacity-100"><X className="h-4 w-4" /></button></div>}

        <div className="mt-3 inline-flex max-w-full flex-wrap gap-1 rounded-lg bg-slate-100 p-1">{tabs.map((item) => <button key={item.id} type="button" onClick={() => selectTab(item.id)} className={`rounded-md px-4 py-2 text-sm font-semibold transition ${tab === item.id ? "bg-white text-[#1769e8] shadow-sm" : "text-slate-500 hover:bg-slate-50 hover:text-[#172e55]"}`}>{item.label}{item.count ? <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[11px] ${tab === item.id ? "bg-blue-100 text-[#1769e8]" : "bg-white/70 text-slate-500"}`}>{item.count}</span> : null}</button>)}</div>

        {tab === "overview" && <><section className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{initialData.policies.map((policy) => <BalanceCard key={policy.code} policy={policy} balance={balancesByPolicy.get(policy.code)} />)}</section><div className="mt-3 grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">{calendar}{sidebar}</div></>}
        {tab === "requests" && <div className="mt-3">{requestsTable}</div>}
        {tab === "admin" && canManage && <div className="mt-3">{administration}</div>}
      </div>

      {showRequest && <Modal title="Request time off" onClose={() => setShowRequest(false)}><form onSubmit={submitRequest} className="space-y-5"><p className="-mt-2 text-sm leading-6 text-slate-500">Your request excludes weekends, US federal holidays, and company days off automatically.</p><PolicyPicker label="Time-off type" policies={initialData.policies} value={requestPolicy} onChange={setRequestPolicy} /><div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-semibold text-[#304767]">Start date<input required type="date" value={requestStart} onChange={(event) => setRequestStart(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-[#1e355c] outline-none focus:border-[#1769e8] focus:ring-2 focus:ring-blue-100" /></label><label className="block text-sm font-semibold text-[#304767]">End date<input required type="date" min={requestStart || undefined} value={requestEnd} onChange={(event) => setRequestEnd(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-[#1e355c] outline-none focus:border-[#1769e8] focus:ring-2 focus:ring-blue-100" /></label></div><label className="block text-sm font-semibold text-[#304767]">Note <span className="font-normal text-slate-400">(optional)</span><textarea value={requestReason} onChange={(event) => setRequestReason(event.target.value)} maxLength={1000} rows={3} placeholder="Anything your manager should know?" className="mt-2 w-full resize-none rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-[#1e355c] outline-none placeholder:text-slate-400 focus:border-[#1769e8] focus:ring-2 focus:ring-blue-100" /></label><div className="flex justify-end gap-3 border-t border-slate-100 pt-4"><button type="button" onClick={() => setShowRequest(false)} className="rounded-lg px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100">Cancel</button><button disabled={busy === "request"} type="submit" className="inline-flex items-center gap-2 rounded-lg bg-[#1769e8] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#115bca] disabled:opacity-60">{busy === "request" ? "Sending…" : "Send request"}</button></div></form></Modal>}
      {showHoliday && <Modal title="Add company day off" onClose={() => setShowHoliday(false)}><form onSubmit={submitHoliday} className="space-y-5"><p className="-mt-2 text-sm leading-6 text-slate-500">Use this for company closures in addition to the automatically included US federal holidays.</p><label className="block text-sm font-semibold text-[#304767]">Date<input required type="date" value={holidayDate} onChange={(event) => setHolidayDate(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-[#1e355c] outline-none focus:border-[#1769e8] focus:ring-2 focus:ring-blue-100" /></label><label className="block text-sm font-semibold text-[#304767]">Name<input required value={holidayName} onChange={(event) => setHolidayName(event.target.value)} maxLength={120} placeholder="e.g. Company winter break" className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-[#1e355c] outline-none placeholder:text-slate-400 focus:border-[#1769e8] focus:ring-2 focus:ring-blue-100" /></label><div className="flex justify-end gap-3 border-t border-slate-100 pt-4"><button type="button" onClick={() => setShowHoliday(false)} className="rounded-lg px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100">Cancel</button><button disabled={busy === "holiday"} type="submit" className="rounded-lg bg-[#1769e8] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#115bca] disabled:opacity-60">{busy === "holiday" ? "Adding…" : "Add day off"}</button></div></form></Modal>}
      {showBalanceSetup && <Modal title="Manage leave balance" onClose={() => setShowBalanceSetup(false)}><form onSubmit={submitBalanceAdjustment} className="space-y-4"><p className="-mt-2 text-sm leading-5 text-slate-500">Credit or deduct leave for a specific month. Every update is retained in the balance audit history.</p><EmployeePicker members={initialData.team_members} value={balanceAccountId} onChange={setBalanceAccountId} /><div className="grid gap-3 sm:grid-cols-2"><PolicyPicker label="Leave type" policies={adjustablePolicies} value={balancePolicy} onChange={setBalancePolicy} /><label className="block text-sm font-semibold text-[#304767]">Effective month<input required type="month" min={`${balanceYear}-01`} max={`${balanceYear}-12`} value={balanceMonth} onChange={(event) => setBalanceMonth(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-[#1e355c] outline-none focus:border-[#1769e8] focus:ring-2 focus:ring-blue-100" /></label></div><label className="block text-sm font-semibold text-[#304767]">Monthly adjustment<input required type="number" step="0.5" min="-366" max="366" value={balanceDelta} onChange={(event) => setBalanceDelta(event.target.value)} placeholder="e.g. +1.5 or -0.5" className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-[#1e355c] outline-none placeholder:text-slate-400 focus:border-[#1769e8] focus:ring-2 focus:ring-blue-100" /><span className="mt-1 block text-xs font-normal text-slate-500">Use a positive value to credit days and a negative value to deduct them.</span></label>{selectedBalancePolicy && <div className="grid grid-cols-3 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-center"><div><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Allowance</p><p className="mt-1 text-sm font-bold text-[#172e55]">{selectedBalance?.entitlement_days ?? selectedBalancePolicy.annual_allowance ?? "—"}</p></div><div><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Adjusted</p><p className={`mt-1 text-sm font-bold ${(selectedBalance?.adjustment_days ?? 0) < 0 ? "text-rose-600" : "text-emerald-600"}`}>{(selectedBalance?.adjustment_days ?? 0) > 0 ? "+" : ""}{selectedBalance?.adjustment_days ?? 0}</p></div><div><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Available</p><p className="mt-1 text-sm font-bold text-[#172e55]">{selectedBalanceAvailable ?? "—"}</p></div></div>}<label className="block text-sm font-semibold text-[#304767]">Note <span className="font-normal text-slate-400">(optional)</span><textarea value={balanceNote} onChange={(event) => setBalanceNote(event.target.value)} maxLength={500} rows={2} placeholder="Why is this balance changing?" className="mt-1.5 w-full resize-none rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-[#1e355c] outline-none placeholder:text-slate-400 focus:border-[#1769e8] focus:ring-2 focus:ring-blue-100" /></label>{selectedBalanceHistory.length > 0 && <div className="border-t border-slate-100 pt-3"><p className="text-xs font-bold uppercase tracking-[0.08em] text-slate-500">Recent adjustments</p><div className="mt-2 space-y-2">{selectedBalanceHistory.map((adjustment) => <div key={adjustment.id} className="flex items-start justify-between gap-3 text-sm"><div className="min-w-0"><p className="font-medium text-[#304767]">{formatDate(adjustment.effective_month, { month: "short", year: "numeric" })}{adjustment.note ? ` · ${adjustment.note}` : ""}</p><p className="mt-0.5 text-xs text-slate-500">by {adjustment.created_by_name}</p></div><span className={`shrink-0 font-bold ${adjustment.delta_days > 0 ? "text-emerald-600" : "text-rose-600"}`}>{adjustment.delta_days > 0 ? "+" : ""}{adjustment.delta_days} d</span></div>)}</div></div>}<div className="flex justify-end gap-3 border-t border-slate-100 pt-4"><button type="button" onClick={() => setShowBalanceSetup(false)} className="rounded-lg px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100">Cancel</button><button disabled={busy === "balance-adjustment" || !balanceAccountId || !balancePolicy} type="submit" className="rounded-lg bg-[#1769e8] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#115bca] disabled:opacity-60">{busy === "balance-adjustment" ? "Saving…" : "Save adjustment"}</button></div></form></Modal>}
      {decisionRequest && decisionAction && (
        <Modal
          title={decisionAction === "approve" ? "Approve time-off request" : "Decline time-off request"}
          onClose={() => {
            if (!busy) {
              setDecisionRequest(null);
              setDecisionAction(null);
              setDecisionError(null);
            }
          }}
        >
          <form onSubmit={(event) => { event.preventDefault(); void decide(decisionRequest, decisionAction, decisionNote); }} className="space-y-4">
            <div className="rounded-lg bg-slate-50 px-3.5 py-3"><p className="font-semibold text-[#1e355c]">{decisionRequest.requester_name}</p><p className="mt-1 text-sm text-slate-500">{formatDateRange(decisionRequest.start_date, decisionRequest.end_date)} · {decisionRequest.total_days} day{decisionRequest.total_days === 1 ? "" : "s"}</p>{decisionRequest.reason && <p className="mt-1 text-sm text-slate-600">“{decisionRequest.reason}”</p>}</div>
            {decisionError && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm leading-5 text-rose-700">{decisionError}</p>}
            <label className="block text-sm font-semibold text-[#304767]">Review note <span className="font-normal text-slate-400">(optional)</span><textarea value={decisionNote} onChange={(event) => setDecisionNote(event.target.value)} maxLength={1000} rows={3} placeholder={decisionAction === "approve" ? "Add context for the employee (optional)" : "Explain why this request was declined (optional)"} className="mt-1.5 w-full resize-none rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-[#1e355c] outline-none placeholder:text-slate-400 focus:border-[#1769e8] focus:ring-2 focus:ring-blue-100" /></label>
            <div className="flex justify-end gap-3 border-t border-slate-100 pt-4"><button type="button" disabled={Boolean(busy)} onClick={() => { setDecisionRequest(null); setDecisionAction(null); setDecisionError(null); }} className="rounded-lg px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100">Cancel</button><button disabled={Boolean(busy)} type="submit" className={`rounded-lg px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60 ${decisionAction === "approve" ? "bg-[#1769e8] hover:bg-[#115bca]" : "bg-rose-600 hover:bg-rose-700"}`}>{busy ? "Saving…" : decisionAction === "approve" ? "Approve request" : "Decline request"}</button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function BalanceCard({ policy, balance }: { policy: TimeOffPolicy; balance?: { entitlement_days: number | null; adjustment_days: number; used_days: number } }) {
  const total = balance?.entitlement_days === null || balance?.entitlement_days === undefined ? null : balance.entitlement_days + (balance?.adjustment_days ?? 0);
  const remaining = total === null ? null : Math.max(0, total - (balance?.used_days ?? 0));
  return <section className="rounded-xl border border-slate-200 bg-white p-3.5"><div className="flex items-center gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: `${policy.color}18`, color: policy.color }}><PolicyIcon code={policy.code} /></span><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><p className="truncate text-[13px] font-semibold text-[#304767]">{policy.label}</p><span className="shrink-0 text-[11px] font-semibold text-slate-400">{total === null ? "No limit" : `${balance?.used_days ?? 0} used`}</span></div><p className="mt-0.5 text-[24px] font-bold leading-7 tracking-tight text-[#172e55]">{remaining === null ? "—" : remaining}<span className="ml-1 text-[12px] font-medium text-slate-400">{remaining === null ? "tracked" : "days left"}</span></p></div></div>{total !== null ? <div className="mt-3 h-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${Math.min(100, ((balance?.used_days ?? 0) / Math.max(total, 1)) * 100)}%`, backgroundColor: policy.color }} /></div> : <div className="mt-3 h-1" />}</section>;
}

function StatusBadge({ status }: { status: TimeOffRequest["status"] }) {
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${STATUS_STYLE[status]}`}>{readableStatus(status)}</span>;
}

function MyRequestsTable({
  requests,
  policiesByCode,
  busy,
  onCancel,
}: {
  requests: TimeOffRequest[];
  policiesByCode: Map<string, TimeOffPolicy>;
  busy: boolean;
  onCancel: (request: TimeOffRequest) => void;
}) {
  return <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3.5">
      <div><h2 className="text-base font-semibold text-[#172e55]">My requests</h2><p className="mt-0.5 text-[13px] text-slate-500">Track the status and decisions for your time-off requests.</p></div>
      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-500">{requests.length} requests</span>
    </div>
    {requests.length === 0 ? <EmptyState message="You have not submitted any time-off requests yet." /> : <div className="overflow-x-auto"><table className="w-full min-w-[860px] text-left"><thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500"><tr><th className="px-4 py-3">Leave type</th><th className="px-4 py-3">Dates</th><th className="px-4 py-3">Days</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Reviewed by</th><th className="px-4 py-3">Review note</th><th className="px-4 py-3 text-right" /></tr></thead><tbody>{requests.map((request) => { const policy = policiesByCode.get(request.policy_code); return <tr key={request.id} className="border-t border-slate-100 text-sm"><td className="px-4 py-3"><span className="inline-flex items-center gap-2 font-semibold text-[#304767]"><i className="h-2 w-2 rounded-full" style={{ backgroundColor: policy?.color ?? "#94a3b8" }} />{policy?.label ?? request.policy_code}</span></td><td className="px-4 py-3 whitespace-nowrap text-slate-600">{formatDateRange(request.start_date, request.end_date)}</td><td className="px-4 py-3 whitespace-nowrap text-slate-600">{request.total_days} day{request.total_days === 1 ? "" : "s"}</td><td className="px-4 py-3"><StatusBadge status={request.status} /></td><td className="px-4 py-3 text-slate-500">{request.reviewer_name ?? "—"}</td><td className="max-w-[240px] px-4 py-3 text-slate-500"><span className="block truncate" title={request.reviewer_note ?? undefined}>{request.reviewer_note ?? "—"}</span></td><td className="px-4 py-3 text-right">{request.status === "pending" && <button type="button" disabled={busy} onClick={() => onCancel(request)} className="text-sm font-semibold text-rose-600 hover:text-rose-700 disabled:opacity-50">Cancel</button>}</td></tr>; })}</tbody></table></div>}
  </section>;
}

function ApprovalQueue({
  requests,
  policiesByCode,
  busy,
  onDecide,
}: {
  requests: TimeOffRequest[];
  policiesByCode: Map<string, TimeOffPolicy>;
  busy: boolean;
  onDecide: (request: TimeOffRequest, action: "approve" | "reject") => void;
}) {
  return <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3.5">
      <div><h2 className="text-base font-semibold text-[#172e55]">Requests to review</h2><p className="mt-0.5 text-[13px] text-slate-500">Approve or decline requests from other team members.</p></div>
      <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700">{requests.length} pending</span>
    </div>
    {requests.length === 0 ? <EmptyState message="There are no pending requests to review." /> : <div className="divide-y divide-slate-100">{requests.map((request) => { const policy = policiesByCode.get(request.policy_code); return <div key={request.id} className="flex flex-col gap-3 px-4 py-4 lg:flex-row lg:items-center lg:justify-between"><div className="flex min-w-0 items-start gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-[#1769e8]">{initials(request.requester_name)}</span><div className="min-w-0"><div className="flex flex-wrap items-center gap-x-2 gap-y-1"><p className="font-semibold text-[#1e355c]">{request.requester_name}</p><span className="text-xs text-slate-400">requested {formatDate(request.created_at.slice(0, 10), { month: "short", day: "numeric", year: "numeric" })}</span></div><p className="mt-1 text-sm text-slate-600"><span className="font-semibold text-[#304767]">{policy?.label ?? request.policy_code}</span> · {formatDateRange(request.start_date, request.end_date)} · {request.total_days} day{request.total_days === 1 ? "" : "s"}</p>{request.reason && <p className="mt-1 max-w-2xl truncate text-sm text-slate-500" title={request.reason}>{request.reason}</p>}</div></div><div className="flex shrink-0 gap-2 pl-12 lg:pl-0"><button type="button" disabled={busy} onClick={() => onDecide(request, "reject")} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-600 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50">Decline</button><button type="button" disabled={busy} onClick={() => onDecide(request, "approve")} className="rounded-lg bg-[#1769e8] px-3 py-2 text-sm font-semibold text-white hover:bg-[#115bca] disabled:opacity-50">Approve</button></div></div>; })}</div>}
  </section>;
}

function BalanceAdjustmentLog({
  adjustments,
  members,
  policiesByCode,
}: {
  adjustments: TimeOffBalanceAdjustment[];
  members: TimeOffTeamMember[];
  policiesByCode: Map<string, TimeOffPolicy>;
}) {
  const memberById = new Map(members.map((member) => [member.id, member]));
  return <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3.5"><div><h2 className="text-base font-semibold text-[#172e55]">Balance adjustment log</h2><p className="mt-0.5 text-[13px] text-slate-500">Credits and deductions retained for audit.</p></div><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-500">{adjustments.length} records</span></div>
    {adjustments.length === 0 ? <EmptyState message="No balance adjustments have been recorded yet." /> : <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left"><thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500"><tr><th className="px-4 py-3">Member</th><th className="px-4 py-3">Leave type</th><th className="px-4 py-3">Effective month</th><th className="px-4 py-3">Change</th><th className="px-4 py-3">Note</th><th className="px-4 py-3">Updated by</th></tr></thead><tbody>{adjustments.map((adjustment) => { const member = memberById.get(adjustment.account_id); const policy = policiesByCode.get(adjustment.policy_code); return <tr key={adjustment.id} className="border-t border-slate-100 text-sm"><td className="px-4 py-3"><p className="font-semibold text-[#1e355c]">{member?.name ?? "Unknown employee"}</p><p className="mt-0.5 text-xs text-slate-500">{member?.email ?? "—"}</p></td><td className="px-4 py-3 text-slate-600">{policy?.label ?? adjustment.policy_code}</td><td className="px-4 py-3 whitespace-nowrap text-slate-600">{formatDate(adjustment.effective_month, { month: "short", year: "numeric" })}</td><td className={`px-4 py-3 font-bold ${adjustment.delta_days > 0 ? "text-emerald-600" : "text-rose-600"}`}>{adjustment.delta_days > 0 ? "+" : ""}{adjustment.delta_days} d</td><td className="max-w-[240px] px-4 py-3 text-slate-500"><span className="block truncate" title={adjustment.note ?? undefined}>{adjustment.note ?? "—"}</span></td><td className="px-4 py-3 text-slate-500">{adjustment.created_by_name}</td></tr>; })}</tbody></table></div>}
  </section>;
}

function CompanyDaysTable({
  days,
  busy,
  onRemove,
}: {
  days: TimeOffHoliday[];
  busy: boolean;
  onRemove: (holiday: TimeOffHoliday) => void;
}) {
  return <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3.5"><div><h2 className="text-base font-semibold text-[#172e55]">Company days off</h2><p className="mt-0.5 text-[13px] text-slate-500">Company closures added on top of the US federal holiday calendar.</p></div><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-500">{days.length} days</span></div>
    {days.length === 0 ? <EmptyState message="No company days off have been added for this year." /> : <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left"><thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500"><tr><th className="px-4 py-3">Date</th><th className="px-4 py-3">Name</th><th className="px-4 py-3">Source</th><th className="px-4 py-3 text-right" /></tr></thead><tbody>{days.map((holiday) => <tr key={holiday.id} className="border-t border-slate-100 text-sm"><td className="px-4 py-3 whitespace-nowrap font-medium text-[#304767]">{formatDate(holiday.date, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}</td><td className="px-4 py-3 font-semibold text-[#1e355c]">{holiday.name}</td><td className="px-4 py-3 text-slate-500">Company</td><td className="px-4 py-3 text-right"><button type="button" disabled={busy} onClick={() => onRemove(holiday)} className="text-sm font-semibold text-rose-600 hover:text-rose-700 disabled:opacity-50">Remove</button></td></tr>)}</tbody></table></div>}
  </section>;
}

function TeamBalanceTable({ members, policies, onAdjust }: { members: TimeOffTeamMember[]; policies: TimeOffPolicy[]; onAdjust: (accountId: string) => void }) {
  return <section className="overflow-hidden rounded-xl border border-slate-200 bg-white"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3.5"><div><h2 className="text-base font-semibold text-[#172e55]">Team leave balances</h2><p className="mt-0.5 text-[13px] text-slate-500">Remaining leave for every active team member this year.</p></div><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-500">{members.length} members</span></div><div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left"><thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500"><tr><th className="px-4 py-3">Member</th>{policies.map((policy) => <th key={policy.code} className="px-4 py-3">{policy.label}</th>)}<th className="px-4 py-3 text-right" /></tr></thead><tbody>{members.map((member) => <tr key={member.id} className="border-t border-slate-100 text-sm"><td className="px-4 py-3"><p className="font-semibold text-[#1e355c]">{member.name}</p><p className="mt-0.5 text-xs text-slate-500">{member.email}</p></td>{policies.map((policy) => { const balance = member.balances.find((item) => item.policy_code === policy.code); const total = balance?.entitlement_days === null || balance?.entitlement_days === undefined ? null : balance.entitlement_days + balance.adjustment_days; const remaining = total === null ? null : Math.max(0, total - (balance?.used_days ?? 0)); return <td key={policy.code} className="px-4 py-3"><p className="font-semibold text-[#1e355c]">{remaining === null ? "No limit" : `${remaining} days`}</p>{total !== null && <p className="mt-0.5 text-xs text-slate-500">{balance?.used_days ?? 0} used{(balance?.adjustment_days ?? 0) !== 0 ? ` · ${(balance?.adjustment_days ?? 0) > 0 ? "+" : ""}${balance?.adjustment_days ?? 0} adjusted` : ""}</p>}</td>; })}<td className="px-4 py-3 text-right"><button type="button" onClick={() => onAdjust(member.id)} className="text-sm font-semibold text-[#1769e8] hover:text-[#115bca]">Adjust</button></td></tr>)}</tbody></table></div></section>;
}

function TeamLeaveLog({
  requests,
  members,
  policiesByCode,
}: {
  requests: TimeOffRequest[];
  members: TimeOffTeamMember[];
  policiesByCode: Map<string, TimeOffPolicy>;
}) {
  const [memberId, setMemberId] = useState("");
  const selectedMember = members.find((member) => member.id === memberId);
  const filteredRequests = memberId
    ? requests.filter((request) => request.requester_id === memberId)
    : requests;
  const emptyMessage = selectedMember
    ? `No leave requests were recorded for ${selectedMember.name}.`
    : "No team leave requests have been recorded.";

  return <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
    <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3.5 xl:flex-row xl:items-end xl:justify-between">
      <div><h2 className="text-base font-semibold text-[#172e55]">Team leave log</h2><p className="mt-0.5 text-[13px] text-slate-500">Every time-off request recorded across the team.</p></div>
      <div className="flex flex-wrap items-end gap-2"><div className="w-full sm:w-72"><EmployeePicker label="Employee" placeholder="All team members" members={members} value={memberId} onChange={setMemberId} /></div>{selectedMember && <button type="button" onClick={() => setMemberId("")} className="rounded-lg px-3 py-2.5 text-sm font-semibold text-slate-500 hover:bg-slate-100 hover:text-[#172e55]">Clear</button>}<span className="mb-0.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-500">{filteredRequests.length} records</span></div>
    </div>
    {filteredRequests.length === 0 ? <EmptyState message={emptyMessage} /> : <div className="overflow-x-auto"><table className="w-full min-w-[820px] text-left"><thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500"><tr><th className="px-4 py-3">Member</th><th className="px-4 py-3">Leave type</th><th className="px-4 py-3">Dates</th><th className="px-4 py-3">Days</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Reviewed by</th></tr></thead><tbody>{filteredRequests.map((request) => { const policy = policiesByCode.get(request.policy_code); return <tr key={request.id} className="border-t border-slate-100 text-sm"><td className="px-4 py-3"><p className="font-semibold text-[#1e355c]">{request.requester_name}</p><p className="mt-0.5 text-xs text-slate-500">{request.requester_email}</p></td><td className="px-4 py-3"><span className="inline-flex items-center gap-2 font-medium text-[#304767]"><i className="h-2 w-2 rounded-full" style={{ backgroundColor: policy?.color ?? "#94a3b8" }} />{policy?.label ?? request.policy_code}</span></td><td className="px-4 py-3 text-slate-600">{formatDateRange(request.start_date, request.end_date)}</td><td className="px-4 py-3 text-slate-600">{request.total_days} day{request.total_days === 1 ? "" : "s"}</td><td className="px-4 py-3"><StatusBadge status={request.status} /></td><td className="px-4 py-3 text-slate-500">{request.reviewer_name ?? "—"}</td></tr>; })}</tbody></table></div>}
  </section>;
}

function EmployeePicker({ members, value, onChange, label = "Employee", placeholder = "Choose an employee" }: { members: TimeOffTeamMember[]; value: string; onChange: (accountId: string) => void; label?: string; placeholder?: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = members.find((member) => member.id === value);
  const matches = members.filter((member) => {
    const haystack = `${member.name} ${member.email}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  });

  return <div className="relative"><p className="text-sm font-semibold text-[#304767]">{label}</p><button type="button" onClick={() => setIsOpen((open) => !open)} aria-expanded={isOpen} className="mt-1.5 flex w-full items-center justify-between gap-3 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-left outline-none transition hover:border-slate-400 focus:border-[#1769e8] focus:ring-2 focus:ring-blue-100"><span className="min-w-0">{selected ? <><span className="block truncate text-sm font-semibold text-[#1e355c]">{selected.name}</span><span className="block truncate text-xs text-slate-500">{selected.email}</span></> : <span className="text-sm text-slate-400">{placeholder}</span>}</span><ChevronDown className={`h-4 w-4 shrink-0 text-slate-500 transition ${isOpen ? "rotate-180" : ""}`} /></button>{isOpen && <div className="absolute z-20 mt-1.5 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl"><div className="border-b border-slate-100 p-2"><label className="flex items-center gap-2 rounded-md bg-slate-50 px-2.5 py-2"><Search className="h-4 w-4 text-slate-400" /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name or email" className="w-full bg-transparent text-sm text-[#1e355c] outline-none placeholder:text-slate-400" /></label></div><div className="max-h-56 overflow-y-auto p-1">{matches.length === 0 ? <p className="px-3 py-4 text-center text-sm text-slate-500">No employee found.</p> : matches.map((member) => <button key={member.id} type="button" onClick={() => { onChange(member.id); setQuery(""); setIsOpen(false); }} className={`flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left transition ${member.id === value ? "bg-blue-50" : "hover:bg-slate-50"}`}><span className="min-w-0"><span className="block truncate text-sm font-semibold text-[#1e355c]">{member.name}</span><span className="block truncate text-xs text-slate-500">{member.email}</span></span>{member.id === value && <Check className="h-4 w-4 shrink-0 text-[#1769e8]" />}</button>)}</div></div>}</div>;
}

function PolicyPicker({ label, policies, value, onChange }: { label: string; policies: TimeOffPolicy[]; value: string; onChange: (code: string) => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const selected = policies.find((policy) => policy.code === value);

  return <div className="relative"><p className="text-sm font-semibold text-[#304767]">{label}</p><button type="button" onClick={() => setIsOpen((open) => !open)} aria-expanded={isOpen} className="mt-1.5 flex w-full items-center justify-between gap-3 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-left outline-none transition hover:border-slate-400 focus:border-[#1769e8] focus:ring-2 focus:ring-blue-100"><span className="inline-flex min-w-0 items-center gap-2"><i className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: selected?.color ?? "#94a3b8" }} /><span className="truncate text-sm font-semibold text-[#1e355c]">{selected?.label ?? "Choose leave type"}</span></span><ChevronDown className={`h-4 w-4 shrink-0 text-slate-500 transition ${isOpen ? "rotate-180" : ""}`} /></button>{isOpen && <div className="absolute z-20 mt-1.5 w-full overflow-hidden rounded-lg border border-slate-200 bg-white p-1 shadow-xl">{policies.map((policy) => <button key={policy.code} type="button" onClick={() => { onChange(policy.code); setIsOpen(false); }} className={`flex w-full items-center justify-between gap-3 rounded-md px-3 py-2.5 text-left transition ${policy.code === value ? "bg-blue-50" : "hover:bg-slate-50"}`}><span className="inline-flex min-w-0 items-center gap-2"><i className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: policy.color }} /><span className="truncate text-sm font-semibold text-[#1e355c]">{policy.label}</span></span>{policy.code === value && <Check className="h-4 w-4 shrink-0 text-[#1769e8]" />}</button>)}</div>}</div>;
}

function EmptyState({ message }: { message: string }) {
  return <div className="flex flex-col items-center px-6 py-10 text-center"><CalendarDays className="h-8 w-8 text-slate-300" /><p className="mt-2.5 max-w-md text-sm leading-6 text-slate-500">{message}</p></div>;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#091e42]/40 p-4" role="dialog" aria-modal="true" aria-label={title}><div className="w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-2xl"><div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><h2 className="text-lg font-bold text-[#172e55]">{title}</h2><button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close"><X className="h-5 w-5" /></button></div><div className="px-5 py-4">{children}</div></div></div>;
}
