"use client";

import {
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
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
  TimeOffMonthlyAccrualRule,
  TimeOffPolicy,
  TimeOffRequest,
  TimeOffTeamMember,
} from "@/lib/time-off/types";

type AdminSection = "balances" | "accruals" | "approvals" | "history" | "company-days";
/** Một hàng tab duy nhất: mục của tôi + các mục quản trị, không lồng hai tầng. */
type Tab = "overview" | AdminSection;

type Props = {
  accountId: string;
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

type RequestBalancePreview = {
  tracks_balance: boolean;
  available_days: number | null;
  requested_days: number;
  remaining_days: number | null;
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

export default function TimeOffClient({ accountId, canManage, monthKey, initialTab, initialData }: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [showRequest, setShowRequest] = useState(false);
  const [showMyRequests, setShowMyRequests] = useState(false);
  const [showHoliday, setShowHoliday] = useState(false);
  const [showBalanceSetup, setShowBalanceSetup] = useState(false);
  const [showMonthlyAccrual, setShowMonthlyAccrual] = useState(false);
  const [showBulkAdjustment, setShowBulkAdjustment] = useState(false);
  const [decisionRequest, setDecisionRequest] = useState<TimeOffRequest | null>(null);
  const [decisionAction, setDecisionAction] = useState<"approve" | "reject" | "cancel" | null>(null);
  // Đơn vừa được quyết trong phiên này. `router.refresh()` là đường chính để
  // dữ liệu mới về, nhưng nó không đảm bảo kịp trước lần render kế — nên đơn đã
  // duyệt vẫn nằm trong hàng đợi, bấm lần nữa thì nhận
  // "This request has already been decided." Giữ danh sách id ở client để bỏ
  // dòng đó ra NGAY, refresh về sau chỉ xác nhận lại.
  const [decidedIds, setDecidedIds] = useState<ReadonlySet<string>>(new Set());
  const [decisionNote, setDecisionNote] = useState("");
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [requestPolicy, setRequestPolicy] = useState(initialData.policies[0]?.code ?? "vacation");
  const [requestStart, setRequestStart] = useState("");
  const [requestEnd, setRequestEnd] = useState("");
  const [requestReason, setRequestReason] = useState("");
  const [requestBalancePreview, setRequestBalancePreview] = useState<RequestBalancePreview | null>(null);
  const [requestBalancePreviewError, setRequestBalancePreviewError] = useState<string | null>(null);
  const [requestBalancePreviewLoading, setRequestBalancePreviewLoading] = useState(false);
  const [holidayDate, setHolidayDate] = useState("");
  const [holidayName, setHolidayName] = useState("");
  const [balanceAccountId, setBalanceAccountId] = useState("");
  const [balancePolicy, setBalancePolicy] = useState(
    initialData.policies.find((policy) => policy.counts_toward_balance)?.code ?? "vacation"
  );
  const [balanceMonth, setBalanceMonth] = useState(monthKey);
  const [balanceDelta, setBalanceDelta] = useState("");
  const [balanceNote, setBalanceNote] = useState("");
  const [accrualPolicy, setAccrualPolicy] = useState(initialData.policies.find((policy) => policy.counts_toward_balance)?.code ?? "vacation");
  const [accrualCredit, setAccrualCredit] = useState("1");
  const [accrualStartMonth, setAccrualStartMonth] = useState(monthKey);
  const [accrualActive, setAccrualActive] = useState(true);
  const [accrualRunMonth, setAccrualRunMonth] = useState(monthKey);
  const [bulkPolicy, setBulkPolicy] = useState(initialData.policies.find((policy) => policy.counts_toward_balance)?.code ?? "vacation");
  const [bulkMonth, setBulkMonth] = useState(monthKey);
  const [bulkDelta, setBulkDelta] = useState("");
  const [bulkNote, setBulkNote] = useState("");
  const [bulkIdempotencyKey, setBulkIdempotencyKey] = useState("");
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
  const requestPolicyInfo = policiesByCode.get(requestPolicy);
  const requestBalanceInfo = balancesByPolicy.get(requestPolicy);
  const requestAvailableNow = requestPolicyInfo?.counts_toward_balance
    ? Math.max(0, (requestBalanceInfo?.entitlement_days ?? requestPolicyInfo.annual_allowance ?? 0) + (requestBalanceInfo?.adjustment_days ?? 0) - (requestBalanceInfo?.used_days ?? 0))
    : null;
  const requestPreviewAvailable = requestBalancePreview?.available_days ?? requestAvailableNow;
  const requestPreviewRequested = requestBalancePreview?.requested_days ?? null;
  const requestPreviewRemaining = requestBalancePreview?.remaining_days ?? null;
  const requestTracksBalance = requestBalancePreview?.tracks_balance ?? requestPolicyInfo?.counts_toward_balance ?? false;
  const requestAllowance = requestTracksBalance
    ? (requestBalanceInfo?.entitlement_days ?? requestPolicyInfo?.annual_allowance ?? 0) + (requestBalanceInfo?.adjustment_days ?? 0)
    : null;
  const requestUsedDays = requestBalanceInfo?.used_days ?? 0;
  const requestExceedsBalance = requestPreviewRemaining !== null && requestPreviewRemaining < 0;
  // Không có chuyện âm ngày phép: vượt quỹ thì đơn bị chặn. Nhưng chặn suông
  // để người ta tự đoán phải làm gì là dở — lối thoát đúng là loại nghỉ không
  // trừ quỹ, nên đưa thẳng nút chuyển sang đó.
  const unpaidFallbackPolicy = initialData.policies.find(
    (policy) => !policy.counts_toward_balance && policy.code !== requestPolicy
  );
  const requestShortfallDays = requestExceedsBalance && requestPreviewRemaining !== null
    ? Math.abs(requestPreviewRemaining)
    : 0;
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
  // Lấy theo NGƯỜI ở tầng truy vấn, không lọc từ cửa sổ 200 dòng toàn công ty:
  // tích luỹ hằng tháng ghi 43 dòng mỗi tháng, nên chưa tới 5 tháng là cửa sổ
  // đó không còn chứa lần chỉnh tay nào của người đang được chọn.
  const [selectedBalanceHistory, setSelectedBalanceHistory] = useState<TimeOffBalanceAdjustment[]>([]);
  useEffect(() => {
    if (!showBalanceSetup || !balanceAccountId || !balancePolicy) return;
    const controller = new AbortController();
    const params = new URLSearchParams({
      account_id: balanceAccountId,
      policy_code: balancePolicy,
      leave_year: String(balanceYear),
    });
    fetch(`/api/time-off/balances/adjustments?${params}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : { adjustments: [] }))
      .then((payload) => setSelectedBalanceHistory(payload.adjustments ?? []))
      .catch(() => {
        // Huỷ giữa chừng khi người dùng đổi nhân viên là chuyện bình thường;
        // lịch sử trống chỉ làm mất phần tham khảo, không chặn việc chỉnh quỹ.
      });
    return () => controller.abort();
  }, [showBalanceSetup, balanceAccountId, balancePolicy, balanceYear]);

  useEffect(() => {
    const controller = new AbortController();
    // Nhánh "chưa đủ dữ liệu để hỏi" nằm TRONG callback debounce chứ không ở
    // thân effect: luật react-hooks/set-state-in-effect cấm gọi setState thẳng
    // trong thân effect. Đặt vào đây còn hợp lý hơn — người dùng đang gõ dở
    // ngày thì ô xem trước không chớp tắt theo từng ký tự.
    const timeout = window.setTimeout(async () => {
      if (!showRequest || !requestStart || !requestEnd || requestStart > requestEnd) {
        setRequestBalancePreview(null);
        setRequestBalancePreviewError(null);
        setRequestBalancePreviewLoading(false);
        return;
      }

      setRequestBalancePreviewLoading(true);
      setRequestBalancePreviewError(null);
      try {
        const params = new URLSearchParams({
          policy_code: requestPolicy,
          start_date: requestStart,
          end_date: requestEnd,
        });
        const response = await fetch(`/api/time-off?${params}`, { signal: controller.signal });
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.error ?? "Unable to calculate the leave balance.");
        setRequestBalancePreview(payload as RequestBalancePreview);
      } catch (previewError) {
        if (controller.signal.aborted) return;
        setRequestBalancePreview(null);
        setRequestBalancePreviewError(previewError instanceof Error ? previewError.message : "Unable to calculate the leave balance.");
      } finally {
        if (!controller.signal.aborted) setRequestBalancePreviewLoading(false);
      }
    }, 150);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [requestEnd, requestPolicy, requestStart, showRequest]);

  function openRequest(date?: string) {
    setError(null);
    setRequestStart(date ?? "");
    setRequestEnd(date ?? "");
    setRequestReason("");
    setRequestBalancePreview(null);
    setRequestBalancePreviewError(null);
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

  function openMonthlyAccrual(policyCode?: string) {
    const code = policyCode ?? adjustablePolicies[0]?.code ?? "vacation";
    const existing = initialData.monthly_accrual_rules.find((rule) => rule.policy_code === code);
    setError(null);
    setAccrualPolicy(code);
    setAccrualCredit(String(existing?.credit_days ?? 1));
    setAccrualStartMonth(existing?.start_month.slice(0, 7) ?? monthKey);
    setAccrualActive(existing?.is_active ?? true);
    setShowMonthlyAccrual(true);
  }

  function openBulkAdjustment() {
    setError(null);
    setBulkPolicy(adjustablePolicies[0]?.code ?? "vacation");
    setBulkMonth(monthKey);
    setBulkDelta("");
    setBulkNote("");
    setBulkIdempotencyKey(crypto.randomUUID());
    setShowBulkAdjustment(true);
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

  function openDecision(request: TimeOffRequest, action: "approve" | "reject" | "cancel") {
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
      setDecidedIds((current) => new Set(current).add(request.id));
      setDecisionRequest(null);
      setDecisionAction(null);
      setDecisionNote("");
      setDecisionError(null);
      setNotice(action === "approve" ? "Request approved." : action === "reject" ? "Request declined." : "Request cancelled.");
      if (action === "approve" || action === "reject") selectTab("approvals");
      router.refresh();
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "Unable to update request.";
      setError(message);
      setDecisionError(message);
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

  async function submitMonthlyAccrual(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("monthly-accrual");
    setError(null);
    try {
      await readResponse(await fetch("/api/time-off/accruals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          policy_code: accrualPolicy,
          credit_days: Number(accrualCredit),
          start_month: accrualStartMonth,
          is_active: accrualActive,
        }),
      }));
      setShowMonthlyAccrual(false);
      setNotice(accrualActive ? "Monthly accrual rule saved." : "Monthly accrual rule paused.");
      router.refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to save the monthly accrual rule.");
    } finally {
      setBusy(null);
    }
  }

  async function applyMonthlyAccruals() {
    setBusy("apply-monthly-accruals");
    setError(null);
    try {
      const payload = await readResponse(await fetch("/api/time-off/accruals/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: accrualRunMonth }),
      })) as { results?: { member_count?: number; applied?: boolean }[] };
      const applied = (payload.results ?? []).filter((result) => result.applied);
      const recipients = applied.reduce((total, result) => total + (result.member_count ?? 0), 0);
      setNotice(applied.length > 0 ? `Monthly accrual applied to ${recipients} team balances.` : "All active monthly accruals were already applied for this month.");
      router.refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to apply monthly accruals.");
    } finally {
      setBusy(null);
    }
  }

  async function submitBulkAdjustment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("bulk-adjustment");
    setError(null);
    try {
      const payload = await readResponse(await fetch("/api/time-off/balances/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          policy_code: bulkPolicy,
          month: bulkMonth,
          delta_days: Number(bulkDelta),
          note: bulkNote,
          idempotency_key: bulkIdempotencyKey,
        }),
      })) as { adjustment?: { member_count?: number; applied?: boolean } };
      setShowBulkAdjustment(false);
      setNotice(payload.adjustment?.applied ? `Team adjustment applied to ${payload.adjustment.member_count ?? 0} active employees.` : "This team adjustment was already applied.");
      router.refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to adjust team balances.");
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

  // MỘT hàng tab cho tất cả. Trước đây "Administration" là một tab chứa năm tab
  // con ở hàng thứ hai — hai tầng cho cùng một việc chọn màn hình, và hàng thứ
  // hai đẩy nội dung xuống thấp hơn một nhịp.
  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "overview", label: "My leave" },
    ...(canManage
      ? ([
          { id: "balances", label: "Balances" },
          { id: "accruals", label: "Monthly accruals" },
          { id: "approvals", label: "Approvals", count: initialData.pending_approvals.length },
          { id: "history", label: "Leave history" },
          { id: "company-days", label: "Company days off" },
        ] as { id: Tab; label: string; count?: number }[])
      : []),
  ];

  const calendar = (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-2.5">
        <div className="flex items-baseline gap-2.5">
          <h2 className="text-base font-semibold text-[#172e55]">My calendar</h2>
          <p className="hidden text-[12px] text-slate-500 sm:block">Your approved time off, company days off, and US federal holidays.</p>
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
                  const policy = policiesByCode.get(request.policy_code);
                  const label = policy?.label ?? "Time off";
                  return <div key={request.id} className="truncate rounded bg-blue-50 px-1.5 py-0.5 text-[9px] font-semibold text-[#1769e8]" title={label}>{label}</div>;
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

  const visiblePendingApprovals = initialData.pending_approvals.filter(
    (request) => !decidedIds.has(request.id)
  );
  const recentMyRequests = initialData.my_requests.slice(0, 3);

  const sidebar = (
    <aside className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-4"><div className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-[#1769e8]" /><h2 className="text-sm font-semibold text-[#172e55]">My requests</h2></div>{recentMyRequests.length === 0 ? <p className="mt-3 text-[13px] leading-5 text-slate-500">You have not submitted any time-off requests yet.</p> : <div className="mt-3 divide-y divide-slate-100">{recentMyRequests.map((request) => { const policy = policiesByCode.get(request.policy_code); const isCancelling = busy === `cancel-${request.id}`; return <div key={request.id} className="py-2.5 first:pt-0 last:pb-0"><div className="flex items-start justify-between gap-2"><p className="min-w-0 truncate text-sm font-semibold text-[#1e355c]">{policy?.label ?? request.policy_code}</p><StatusBadge status={request.status} /></div><p className="mt-1 text-xs text-slate-500">{formatDateRange(request.start_date, request.end_date)} · {request.total_days} day{request.total_days === 1 ? "" : "s"}</p>{request.status === "pending" && !decidedIds.has(request.id) && <button type="button" disabled={Boolean(busy)} onClick={() => openDecision(request, "cancel")} className="mt-2 text-xs font-semibold text-rose-600 hover:text-rose-700 disabled:cursor-wait disabled:opacity-60">{isCancelling ? "Cancelling…" : "Cancel request"}</button>}</div>; })}</div>}{initialData.my_requests.length > 0 && <button type="button" onClick={() => setShowMyRequests(true)} className="mt-3 text-xs font-semibold text-[#1769e8] hover:text-[#115bca]">View full history ({initialData.my_requests.length})</button>}</section>
      <section className="rounded-xl border border-slate-200 bg-white p-4"><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><Building2 className="h-4 w-4 text-violet-600" /><h2 className="text-sm font-semibold text-[#172e55]">Upcoming days off</h2></div>{canManage && <button type="button" onClick={() => { setError(null); setShowHoliday(true); }} className="text-sm font-semibold text-[#1769e8] hover:text-[#115bca]">Add</button>}</div><div className="mt-3 space-y-2.5">{calendarData.holidays.slice(0, 5).map((holiday) => <div key={holiday.id} className="min-w-0"><p className="truncate text-sm font-medium text-[#1e355c]">{holiday.name}</p><p className="mt-0.5 text-xs text-slate-500">{formatDate(holiday.date, { weekday: "short", month: "short", day: "numeric" })}{holiday.source === "us_federal" ? " · US federal" : " · Company"}</p></div>)}</div></section>
    </aside>
  );

  const administration = canManage ? (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      {tab === "company-days" && <div className="flex justify-end pb-4"><button type="button" onClick={() => { setError(null); setShowHoliday(true); }} className="inline-flex w-fit items-center gap-2 rounded-lg bg-[#1769e8] px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#115bca]"><Plus className="h-4 w-4" />Add company day off</button></div>}
      <div className="mt-4">
        {tab === "balances" && <div className="space-y-4"><TeamBalanceTable members={initialData.team_members} policies={initialData.policies} onAdjust={openBalanceSetup} /></div>}
        {tab === "accruals" && <AccrualSettings policies={adjustablePolicies} rules={initialData.monthly_accrual_rules} teamSize={initialData.team_members.length} runMonth={accrualRunMonth} onRunMonthChange={setAccrualRunMonth} busy={Boolean(busy)} onConfigure={openMonthlyAccrual} onApply={applyMonthlyAccruals} onBulkAdjust={openBulkAdjustment} />}
        {tab === "approvals" && <ApprovalQueue accountId={accountId} requests={visiblePendingApprovals} policiesByCode={policiesByCode} busy={Boolean(busy)} onDecide={openDecision} />}
        {tab === "history" && <TeamLeaveLog requests={initialData.team_leave_log} members={initialData.team_members} policiesByCode={policiesByCode} />}
        {tab === "company-days" && <CompanyDaysTable days={initialData.company_days} busy={Boolean(busy)} onRemove={removeHoliday} />}
      </div>
    </section>
  ) : null;

  return (
    <div className="min-h-full bg-[#f7f9fc] px-5 py-4 sm:px-7 lg:px-8">
      <div className="mx-auto max-w-[1320px]">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between"><div className="flex flex-wrap items-baseline gap-x-3 gap-y-1"><h1 className="text-[28px] font-bold tracking-tight text-[#172e55]">Time off</h1><p className="text-[13px] text-slate-500">Plan time away, see who is out, and keep your team covered.</p></div>{tab === "overview" && <button type="button" onClick={() => openRequest()} className="inline-flex w-fit items-center gap-2 rounded-lg bg-[#1769e8] px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#115bca]"><Plus className="h-4 w-4" />Request time off</button>}</div>

        {(error || notice) && <div role={error ? "alert" : "status"} className={`fixed left-4 right-4 top-24 z-[80] flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg sm:left-auto sm:right-5 sm:w-[420px] ${error ? "border-rose-200 bg-rose-50 text-rose-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}><span>{error ?? notice}</span><button type="button" onClick={() => { setError(null); setNotice(null); }} className="shrink-0 opacity-70 hover:opacity-100"><X className="h-4 w-4" /></button></div>}

        {initialData.section_errors.length > 0 && <div role="status" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3"><p className="text-sm font-semibold text-amber-900">Some sections could not be loaded.</p><ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-amber-800">{initialData.section_errors.map((message) => <li key={message}>{message}</li>)}</ul><p className="mt-2 text-xs text-amber-700">Everything else on this page is up to date.</p></div>}
        <div className="mt-3 inline-flex max-w-full flex-wrap gap-1 rounded-lg bg-slate-100 p-1">{tabs.map((item) => <button key={item.id} type="button" onClick={() => selectTab(item.id)} className={`rounded-md px-4 py-2 text-sm font-semibold transition ${tab === item.id ? "bg-white text-[#1769e8] shadow-sm" : "text-slate-500 hover:bg-slate-50 hover:text-[#172e55]"}`}>{item.label}{item.count ? <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[11px] ${tab === item.id ? "bg-blue-100 text-[#1769e8]" : "bg-white/70 text-slate-500"}`}>{item.count}</span> : null}</button>)}</div>

        {tab === "overview" && <><section className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{initialData.policies.map((policy) => <BalanceCard key={policy.code} policy={policy} balance={balancesByPolicy.get(policy.code)} />)}</section><div className="mt-3 grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">{calendar}{sidebar}</div></>}
        {tab !== "overview" && canManage && <div className="mt-3">{administration}</div>}
      </div>

      {showRequest && (
        <Modal title="Request time off" onClose={() => setShowRequest(false)}>
          <form onSubmit={submitRequest} className="space-y-5">
            <p className="-mt-2 text-sm leading-6 text-slate-500">Your request excludes weekends, US federal holidays, and company days off automatically.</p>
            <PolicyPicker label="Time-off type" policies={initialData.policies} value={requestPolicy} onChange={setRequestPolicy} />
            <div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-semibold text-[#304767]">Start date<input required type="date" value={requestStart} onChange={(event) => setRequestStart(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-[#1e355c] outline-none focus:border-[#1769e8] focus:ring-2 focus:ring-blue-100" /></label><label className="block text-sm font-semibold text-[#304767]">End date<input required type="date" min={requestStart || undefined} value={requestEnd} onChange={(event) => setRequestEnd(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-[#1e355c] outline-none focus:border-[#1769e8] focus:ring-2 focus:ring-blue-100" /></label></div>
            {requestPolicyInfo && <section aria-live="polite" className="rounded-xl border border-blue-100 bg-blue-50/60 p-3.5"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold text-[#1e355c]">Leave balance</p><p className="mt-0.5 text-xs text-slate-500">{requestPolicyInfo.label}</p></div>{requestBalancePreviewLoading && <span className="text-xs font-medium text-[#1769e8]">Calculating…</span>}</div><div className="mt-3 grid grid-cols-3 divide-x divide-blue-100"><div className="pr-3"><p className="text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500">Available now</p><p className="mt-1 text-lg font-bold text-[#172e55]">{requestTracksBalance ? `${requestPreviewAvailable ?? 0} d` : "—"}</p></div><div className="px-3"><p className="text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500">This request</p><p className="mt-1 text-lg font-bold text-[#172e55]">{requestPreviewRequested === null ? "—" : `${requestPreviewRequested} d`}</p></div><div className="pl-3"><p className="text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500">After request</p><p className={`mt-1 text-lg font-bold ${requestExceedsBalance ? "text-rose-600" : "text-[#1769e8]"}`}>{requestTracksBalance ? requestPreviewRemaining === null ? "—" : `${requestPreviewRemaining} d` : "—"}</p></div></div>{requestTracksBalance && <p className="mt-3 text-xs text-slate-500">{requestUsedDays} used of {requestAllowance ?? 0} days this year.</p>}{requestBalancePreviewError && <p className="mt-3 text-xs font-medium text-rose-700">{requestBalancePreviewError}</p>}{requestExceedsBalance && <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5"><p className="text-xs font-semibold text-rose-700">This request is {requestShortfallDays} day{requestShortfallDays === 1 ? "" : "s"} over the available balance, so it cannot be submitted.</p>{unpaidFallbackPolicy && <button type="button" onClick={() => setRequestPolicy(unpaidFallbackPolicy.code)} className="mt-2 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700">Switch to {unpaidFallbackPolicy.label}</button>}</div>}</section>}
            <label className="block text-sm font-semibold text-[#304767]">Note <span className="font-normal text-slate-400">(optional)</span><textarea value={requestReason} onChange={(event) => setRequestReason(event.target.value)} maxLength={1000} rows={3} placeholder="Anything your manager should know?" className="mt-2 w-full resize-none rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-[#1e355c] outline-none placeholder:text-slate-400 focus:border-[#1769e8] focus:ring-2 focus:ring-blue-100" /></label>
            <div className="flex justify-end gap-3 border-t border-slate-100 pt-4"><button type="button" onClick={() => setShowRequest(false)} className="rounded-lg px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100">Cancel</button><button disabled={busy === "request" || requestBalancePreviewLoading || requestExceedsBalance} type="submit" className="inline-flex items-center gap-2 rounded-lg bg-[#1769e8] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#115bca] disabled:opacity-60">{busy === "request" ? "Sending…" : "Send request"}</button></div>
          </form>
        </Modal>
      )}
      {showMyRequests && <Modal title="My requests" onClose={() => setShowMyRequests(false)}><div className="max-h-[65vh] space-y-2 overflow-y-auto pr-1">{initialData.my_requests.map((request) => { const policy = policiesByCode.get(request.policy_code); return <section key={request.id} className="rounded-lg border border-slate-200 p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-semibold text-[#1e355c]">{policy?.label ?? request.policy_code}</p><p className="mt-1 text-sm text-slate-500">{formatDateRange(request.start_date, request.end_date)} · {request.total_days} day{request.total_days === 1 ? "" : "s"}</p></div><StatusBadge status={request.status} /></div>{request.status === "pending" && !decidedIds.has(request.id) && <button type="button" disabled={Boolean(busy)} onClick={() => { setShowMyRequests(false); openDecision(request, "cancel"); }} className="mt-3 text-sm font-semibold text-rose-600 hover:text-rose-700 disabled:cursor-wait disabled:opacity-60">Cancel request</button>}</section>; })}</div></Modal>}
      {showHoliday && <Modal title="Add company day off" onClose={() => setShowHoliday(false)}><form onSubmit={submitHoliday} className="space-y-5"><p className="-mt-2 text-sm leading-6 text-slate-500">Use this for company closures in addition to the automatically included US federal holidays.</p><label className="block text-sm font-semibold text-[#304767]">Date<input required type="date" value={holidayDate} onChange={(event) => setHolidayDate(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-[#1e355c] outline-none focus:border-[#1769e8] focus:ring-2 focus:ring-blue-100" /></label><label className="block text-sm font-semibold text-[#304767]">Name<input required value={holidayName} onChange={(event) => setHolidayName(event.target.value)} maxLength={120} placeholder="e.g. Company winter break" className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-[#1e355c] outline-none placeholder:text-slate-400 focus:border-[#1769e8] focus:ring-2 focus:ring-blue-100" /></label><div className="flex justify-end gap-3 border-t border-slate-100 pt-4"><button type="button" onClick={() => setShowHoliday(false)} className="rounded-lg px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100">Cancel</button><button disabled={busy === "holiday"} type="submit" className="rounded-lg bg-[#1769e8] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#115bca] disabled:opacity-60">{busy === "holiday" ? "Adding…" : "Add day off"}</button></div></form></Modal>}
      {showBalanceSetup && <Modal title="Manage leave balance" onClose={() => setShowBalanceSetup(false)}><form onSubmit={submitBalanceAdjustment} className="space-y-4"><p className="-mt-2 text-sm leading-5 text-slate-500">Credit or deduct leave for a specific month. Every update is retained in the balance audit history.</p><EmployeePicker members={initialData.team_members} value={balanceAccountId} onChange={setBalanceAccountId} /><div className="grid gap-3 sm:grid-cols-2"><PolicyPicker label="Leave type" policies={adjustablePolicies} value={balancePolicy} onChange={setBalancePolicy} /><label className="block text-sm font-semibold text-[#304767]">Effective month<input required type="month" min={`${balanceYear}-01`} max={`${balanceYear}-12`} value={balanceMonth} onChange={(event) => setBalanceMonth(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-[#1e355c] outline-none focus:border-[#1769e8] focus:ring-2 focus:ring-blue-100" /></label></div><label className="block text-sm font-semibold text-[#304767]">Monthly adjustment<input required type="number" step="0.5" min="-366" max="366" value={balanceDelta} onChange={(event) => setBalanceDelta(event.target.value)} placeholder="e.g. +1.5 or -0.5" className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-[#1e355c] outline-none placeholder:text-slate-400 focus:border-[#1769e8] focus:ring-2 focus:ring-blue-100" /><span className="mt-1 block text-xs font-normal text-slate-500">Use a positive value to credit days and a negative value to deduct them.</span></label>{selectedBalancePolicy && <div className="grid grid-cols-3 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-center"><div><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Allowance</p><p className="mt-1 text-sm font-bold text-[#172e55]">{selectedBalance?.entitlement_days ?? selectedBalancePolicy.annual_allowance ?? "—"}</p></div><div><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Adjusted</p><p className={`mt-1 text-sm font-bold ${(selectedBalance?.adjustment_days ?? 0) < 0 ? "text-rose-600" : "text-emerald-600"}`}>{(selectedBalance?.adjustment_days ?? 0) > 0 ? "+" : ""}{selectedBalance?.adjustment_days ?? 0}</p></div><div><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Available</p><p className="mt-1 text-sm font-bold text-[#172e55]">{selectedBalanceAvailable ?? "—"}</p></div></div>}<label className="block text-sm font-semibold text-[#304767]">Note <span className="font-normal text-slate-400">(optional)</span><textarea value={balanceNote} onChange={(event) => setBalanceNote(event.target.value)} maxLength={500} rows={2} placeholder="Why is this balance changing?" className="mt-1.5 w-full resize-none rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-[#1e355c] outline-none placeholder:text-slate-400 focus:border-[#1769e8] focus:ring-2 focus:ring-blue-100" /></label>{selectedBalanceHistory.length > 0 && <div className="border-t border-slate-100 pt-3"><p className="text-xs font-bold uppercase tracking-[0.08em] text-slate-500">Recent adjustments</p><div className="mt-2 space-y-2">{selectedBalanceHistory.map((adjustment) => <div key={adjustment.id} className="flex items-start justify-between gap-3 text-sm"><div className="min-w-0"><p className="font-medium text-[#304767]">{formatDate(adjustment.effective_month, { month: "short", year: "numeric" })}{adjustment.note ? ` · ${adjustment.note}` : ""}</p><p className="mt-0.5 text-xs text-slate-500">by {adjustment.created_by_name}</p></div><span className={`shrink-0 font-bold ${adjustment.delta_days > 0 ? "text-emerald-600" : "text-rose-600"}`}>{adjustment.delta_days > 0 ? "+" : ""}{adjustment.delta_days} d</span></div>)}</div></div>}<div className="flex justify-end gap-3 border-t border-slate-100 pt-4"><button type="button" onClick={() => setShowBalanceSetup(false)} className="rounded-lg px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100">Cancel</button><button disabled={busy === "balance-adjustment" || !balanceAccountId || !balancePolicy} type="submit" className="rounded-lg bg-[#1769e8] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#115bca] disabled:opacity-60">{busy === "balance-adjustment" ? "Saving…" : "Save adjustment"}</button></div></form></Modal>}
      {showMonthlyAccrual && <Modal title="Set monthly accrual" onClose={() => setShowMonthlyAccrual(false)}><form onSubmit={submitMonthlyAccrual} className="space-y-4"><p className="-mt-2 text-sm leading-6 text-slate-500">Credits every active employee on the first of each month. This is added on top of the existing annual allowance.</p><PolicyPicker label="Leave type" policies={adjustablePolicies} value={accrualPolicy} onChange={setAccrualPolicy} /><div className="grid gap-3 sm:grid-cols-2"><label className="block text-sm font-semibold text-[#304767]">Credit per month<input required type="number" min="0.1" max="31" step="0.1" value={accrualCredit} onChange={(event) => setAccrualCredit(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-[#1e355c] outline-none focus:border-[#1769e8] focus:ring-2 focus:ring-blue-100" /></label><label className="block text-sm font-semibold text-[#304767]">Starts in<input required type="month" value={accrualStartMonth} onChange={(event) => setAccrualStartMonth(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-[#1e355c] outline-none focus:border-[#1769e8] focus:ring-2 focus:ring-blue-100" /></label></div><label className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold text-[#304767]"><input type="checkbox" checked={accrualActive} onChange={(event) => setAccrualActive(event.target.checked)} className="h-4 w-4 accent-[#1769e8]" />Enable this monthly accrual</label><div className="flex justify-end gap-3 border-t border-slate-100 pt-4"><button type="button" onClick={() => setShowMonthlyAccrual(false)} className="rounded-lg px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100">Cancel</button><button disabled={busy === "monthly-accrual"} type="submit" className="rounded-lg bg-[#1769e8] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#115bca] disabled:opacity-60">{busy === "monthly-accrual" ? "Saving…" : "Save rule"}</button></div></form></Modal>}
      {showBulkAdjustment && <Modal title="Adjust all team balances" onClose={() => setShowBulkAdjustment(false)}><form onSubmit={submitBulkAdjustment} className="space-y-4"><div className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm leading-5 text-amber-800">This applies one adjustment to all {initialData.team_members.length} active employees. Every employee receives a separate audit-log entry.</div><div className="grid gap-3 sm:grid-cols-2"><PolicyPicker label="Leave type" policies={adjustablePolicies} value={bulkPolicy} onChange={setBulkPolicy} /><label className="block text-sm font-semibold text-[#304767]">Effective month<input required type="month" value={bulkMonth} onChange={(event) => setBulkMonth(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-[#1e355c] outline-none focus:border-[#1769e8] focus:ring-2 focus:ring-blue-100" /></label></div><label className="block text-sm font-semibold text-[#304767]">Days to add or deduct<input required type="number" step="0.1" min="-366" max="366" value={bulkDelta} onChange={(event) => setBulkDelta(event.target.value)} placeholder="e.g. 1 or -0.5" className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-[#1e355c] outline-none placeholder:text-slate-400 focus:border-[#1769e8] focus:ring-2 focus:ring-blue-100" /><span className="mt-1 block text-xs font-normal text-slate-500">Positive credits leave; negative deducts leave.</span></label><label className="block text-sm font-semibold text-[#304767]">Reason <span className="font-normal text-slate-400">(optional)</span><textarea value={bulkNote} onChange={(event) => setBulkNote(event.target.value)} maxLength={500} rows={2} placeholder="Why is the whole team receiving this adjustment?" className="mt-1.5 w-full resize-none rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-[#1e355c] outline-none placeholder:text-slate-400 focus:border-[#1769e8] focus:ring-2 focus:ring-blue-100" /></label><div className="flex justify-end gap-3 border-t border-slate-100 pt-4"><button type="button" onClick={() => setShowBulkAdjustment(false)} className="rounded-lg px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100">Cancel</button><button disabled={busy === "bulk-adjustment" || !bulkIdempotencyKey} type="submit" className="rounded-lg bg-[#1769e8] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#115bca] disabled:opacity-60">{busy === "bulk-adjustment" ? "Applying…" : "Apply to all employees"}</button></div></form></Modal>}
      {decisionRequest && decisionAction && (
        <Modal
          title={decisionAction === "approve" ? "Approve time-off request" : decisionAction === "reject" ? "Decline time-off request" : "Cancel time-off request"}
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
            {decisionAction === "cancel" ? <p className="text-sm leading-6 text-slate-600">This withdraws your pending request. You can submit a new request later if needed.</p> : <label className="block text-sm font-semibold text-[#304767]">Review note <span className="font-normal text-slate-400">(optional)</span><textarea value={decisionNote} onChange={(event) => setDecisionNote(event.target.value)} maxLength={1000} rows={3} placeholder={decisionAction === "approve" ? "Add context for the employee (optional)" : "Explain why this request was declined (optional)"} className="mt-1.5 w-full resize-none rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-[#1e355c] outline-none placeholder:text-slate-400 focus:border-[#1769e8] focus:ring-2 focus:ring-blue-100" /></label>}
            <div className="flex justify-end gap-3 border-t border-slate-100 pt-4"><button type="button" disabled={Boolean(busy)} onClick={() => { setDecisionRequest(null); setDecisionAction(null); setDecisionError(null); }} className="rounded-lg px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100">{decisionAction === "cancel" ? "Keep request" : "Cancel"}</button><button disabled={Boolean(busy)} type="submit" className={`rounded-lg px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60 ${decisionAction === "approve" ? "bg-[#1769e8] hover:bg-[#115bca]" : "bg-rose-600 hover:bg-rose-700"}`}>{busy ? "Saving…" : decisionAction === "approve" ? "Approve request" : decisionAction === "reject" ? "Decline request" : "Cancel request"}</button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function BalanceCard({ policy, balance }: { policy: TimeOffPolicy; balance?: { entitlement_days: number | null; adjustment_days: number; used_days: number } }) {
  const total = balance?.entitlement_days === null || balance?.entitlement_days === undefined ? null : balance.entitlement_days + (balance?.adjustment_days ?? 0);
  const remaining = total === null ? null : Math.max(0, total - (balance?.used_days ?? 0));
  // Thẻ chỉ còn nhãn + con số, nên nới padding rộng như cũ là thừa chỗ trống.
  return <section className="rounded-xl border border-slate-200 bg-white px-3.5 py-3"><div className="flex items-center gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: `${policy.color}18`, color: policy.color }}><PolicyIcon code={policy.code} /></span><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><p className="truncate text-[13px] font-semibold text-[#304767]">{policy.label}</p><span className="shrink-0 text-[11px] font-semibold text-slate-400">{`${balance?.used_days ?? 0} used`}</span></div><p className="mt-0.5 text-[24px] font-bold leading-7 tracking-tight text-[#172e55]">{remaining === null ? (balance?.used_days ?? 0) : remaining}<span className="ml-1 text-[12px] font-medium text-slate-400">{remaining === null ? "days used" : "days left"}</span></p></div></div></section>;
}

function StatusBadge({ status }: { status: TimeOffRequest["status"] }) {
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${STATUS_STYLE[status]}`}>{readableStatus(status)}</span>;
}

function AccrualSettings({
  policies,
  rules,
  teamSize,
  runMonth,
  onRunMonthChange,
  busy,
  onConfigure,
  onApply,
  onBulkAdjust,
}: {
  policies: TimeOffPolicy[];
  rules: TimeOffMonthlyAccrualRule[];
  teamSize: number;
  runMonth: string;
  onRunMonthChange: (month: string) => void;
  busy: boolean;
  onConfigure: (policyCode?: string) => void;
  onApply: () => void;
  onBulkAdjust: () => void;
}) {
  const rulesByPolicy = new Map(rules.map((rule) => [rule.policy_code, rule]));

  return <div className="space-y-4">
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-4 py-3.5"><h2 className="text-base font-semibold text-[#172e55]">Monthly accruals</h2><p className="mt-0.5 text-[13px] leading-5 text-slate-500">Automatically credit every active employee each month. Existing annual allowances remain unchanged.</p></div>
      <div className="divide-y divide-slate-100">{policies.map((policy) => { const rule = rulesByPolicy.get(policy.code); return <div key={policy.code} className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: policy.color }} /><p className="font-semibold text-[#1e355c]">{policy.label}</p>{rule && <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${rule.is_active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{rule.is_active ? "Active" : "Paused"}</span>}</div><p className="mt-1 text-sm text-slate-500">{rule ? `${rule.credit_days} day${rule.credit_days === 1 ? "" : "s"} per month · starts ${formatDate(rule.start_month, { month: "short", year: "numeric" })}` : "No recurring credit configured."}</p></div><button type="button" disabled={busy} onClick={() => onConfigure(policy.code)} className="w-fit rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-[#1769e8] hover:border-blue-200 hover:bg-blue-50 disabled:opacity-50">{rule ? "Edit rule" : "Set up"}</button></div>; })}</div>
    </section>
    <section className="rounded-xl border border-slate-200 bg-white p-4"><div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><h2 className="text-base font-semibold text-[#172e55]">Run monthly credits</h2><p className="mt-0.5 text-[13px] leading-5 text-slate-500">The scheduled job runs automatically. Use this to backfill a configured month; rerunning the same month cannot double-credit anyone.</p></div><div className="flex flex-wrap items-end gap-2"><label className="block text-sm font-semibold text-[#304767]">Month<input type="month" value={runMonth} onChange={(event) => onRunMonthChange(event.target.value)} className="mt-1.5 block rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-[#1e355c] outline-none focus:border-[#1769e8] focus:ring-2 focus:ring-blue-100" /></label><button type="button" disabled={busy || rules.every((rule) => !rule.is_active)} onClick={onApply} className="rounded-lg bg-[#1769e8] px-3.5 py-2 text-sm font-semibold text-white hover:bg-[#115bca] disabled:cursor-not-allowed disabled:opacity-50">Apply monthly credits</button></div></div></section>
    <section className="rounded-xl border border-slate-200 bg-white p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-base font-semibold text-[#172e55]">One-time team adjustment</h2><p className="mt-0.5 text-[13px] leading-5 text-slate-500">Credit or deduct one leave type for all {teamSize} active employees with a separate audit entry per employee.</p></div><button type="button" disabled={busy || policies.length === 0} onClick={onBulkAdjust} className="w-fit rounded-lg border border-slate-300 px-3.5 py-2 text-sm font-semibold text-[#1769e8] hover:border-blue-200 hover:bg-blue-50 disabled:opacity-50">Adjust all employees</button></div></section>
  </div>;
}

function ApprovalQueue({
  accountId,
  requests,
  policiesByCode,
  busy,
  onDecide,
}: {
  accountId: string;
  requests: TimeOffRequest[];
  policiesByCode: Map<string, TimeOffPolicy>;
  busy: boolean;
  onDecide: (request: TimeOffRequest, action: "approve" | "reject") => void;
}) {
  return <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3.5">
      <div><h2 className="text-base font-semibold text-[#172e55]">Requests to review</h2><p className="mt-0.5 text-[13px] text-slate-500">All pending requests. Your own request is visible but needs another admin to decide.</p></div>
      <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700">{requests.length} pending</span>
    </div>
    {requests.length === 0 ? <EmptyState message="No pending time-off requests are waiting for review." /> : <div className="divide-y divide-slate-100">{requests.map((request) => { const policy = policiesByCode.get(request.policy_code); const isOwnRequest = request.requester_id === accountId; return <div key={request.id} className="flex flex-col gap-3 px-4 py-4 lg:flex-row lg:items-center lg:justify-between"><div className="flex min-w-0 items-start gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-[#1769e8]">{initials(request.requester_name)}</span><div className="min-w-0"><div className="flex flex-wrap items-center gap-x-2 gap-y-1"><p className="font-semibold text-[#1e355c]">{request.requester_name}</p>{isOwnRequest && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">Your request</span>}<span className="text-xs text-slate-400">requested {formatDate(request.created_at.slice(0, 10), { month: "short", day: "numeric", year: "numeric" })}</span></div><p className="mt-1 text-sm text-slate-600"><span className="font-semibold text-[#304767]">{policy?.label ?? request.policy_code}</span> · {formatDateRange(request.start_date, request.end_date)} · {request.total_days} day{request.total_days === 1 ? "" : "s"}</p>{request.reason && <p className="mt-1 max-w-2xl truncate text-sm text-slate-500" title={request.reason}>{request.reason}</p>}</div></div>{isOwnRequest ? <p className="pl-12 text-sm font-medium text-slate-500 lg:pl-0">Awaiting another admin</p> : <div className="flex shrink-0 gap-2 pl-12 lg:pl-0"><button type="button" disabled={busy} onClick={() => onDecide(request, "reject")} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-600 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50">Decline</button><button type="button" disabled={busy} onClick={() => onDecide(request, "approve")} className="rounded-lg bg-[#1769e8] px-3 py-2 text-sm font-semibold text-white hover:bg-[#115bca] disabled:opacity-50">Approve</button></div>}</div>; })}</div>}
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
  return <section className="overflow-hidden rounded-xl border border-slate-200 bg-white"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3.5"><div><h2 className="text-base font-semibold text-[#172e55]">Team leave balances</h2><p className="mt-0.5 text-[13px] text-slate-500">Remaining leave for every active team member this year.</p></div><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-500">{members.length} members</span></div><div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left"><thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500"><tr><th className="px-4 py-3">Member</th>{policies.map((policy) => <th key={policy.code} className="px-4 py-3">{policy.label}</th>)}<th className="px-4 py-3 text-right" /></tr></thead><tbody>{members.map((member) => <tr key={member.id} className="border-t border-slate-100 text-sm"><td className="px-4 py-3"><p className="font-semibold text-[#1e355c]">{member.name}</p><p className="mt-0.5 text-xs text-slate-500">{member.email}</p></td>{policies.map((policy) => { const balance = member.balances.find((item) => item.policy_code === policy.code); const total = balance?.entitlement_days === null || balance?.entitlement_days === undefined ? null : balance.entitlement_days + balance.adjustment_days; const remaining = total === null ? null : Math.max(0, total - (balance?.used_days ?? 0)); return <td key={policy.code} className="px-4 py-3"><p className="font-semibold text-[#1e355c]">{remaining === null ? `${balance?.used_days ?? 0} days used` : `${remaining} days`}</p>{total !== null && <p className="mt-0.5 text-xs text-slate-500">{balance?.used_days ?? 0} used{(balance?.adjustment_days ?? 0) !== 0 ? ` · ${(balance?.adjustment_days ?? 0) > 0 ? "+" : ""}${balance?.adjustment_days ?? 0} adjusted` : ""}</p>}</td>; })}<td className="px-4 py-3 text-right"><button type="button" onClick={() => onAdjust(member.id)} className="text-sm font-semibold text-[#1769e8] hover:text-[#115bca]">Adjust</button></td></tr>)}</tbody></table></div></section>;
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
