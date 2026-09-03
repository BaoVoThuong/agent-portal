import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase";
import { monthBounds } from "./business-days";
import type {
  TimeOffBalance,
  TimeOffBalanceAdjustment,
  TimeOffCalendarEvent,
  TimeOffDashboardData,
  TimeOffHoliday,
  TimeOffPolicy,
  TimeOffRequest,
  TimeOffRequestStatus,
  TimeOffTeamMember,
} from "./types";
import { getUsFederalHolidaysInRange } from "./us-holidays";

type AccountRow = { id: string; email: string; name: string | null };
type RequestRow = {
  id: string;
  requester_id: string;
  policy_code: string;
  start_date: string;
  end_date: string;
  total_days: number | string;
  reason: string | null;
  status: TimeOffRequestStatus;
  reviewer_id: string | null;
  reviewer_note: string | null;
  reviewed_at: string | null;
  created_at: string;
};

function asRequest(row: RequestRow, accounts: Map<string, AccountRow>): TimeOffRequest {
  const requester = accounts.get(row.requester_id);
  const reviewer = row.reviewer_id ? accounts.get(row.reviewer_id) : null;
  return {
    id: row.id,
    requester_id: row.requester_id,
    requester_name: requester?.name?.trim() || requester?.email || "Unknown employee",
    requester_email: requester?.email ?? "",
    policy_code: row.policy_code,
    start_date: row.start_date,
    end_date: row.end_date,
    total_days: Number(row.total_days),
    reason: row.reason,
    status: row.status,
    reviewer_name: reviewer?.name?.trim() || reviewer?.email || null,
    reviewer_note: row.reviewer_note,
    reviewed_at: row.reviewed_at,
    created_at: row.created_at,
  };
}

function asCalendarEvent(row: RequestRow): TimeOffCalendarEvent {
  return {
    id: row.id,
    policy_code: row.policy_code,
    start_date: row.start_date,
    end_date: row.end_date,
  };
}

export async function fetchTimeOffDashboard(
  params: { accountId: string; isManager: boolean; monthKey: string },
  supabase: SupabaseClient = getSupabaseAdmin()
): Promise<TimeOffDashboardData> {
  const bounds = monthBounds(params.monthKey);
  if (!bounds) throw new Error("Invalid calendar month.");
  const year = Number(params.monthKey.slice(0, 4));
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;

  const [
    policiesResult,
    accountsResult,
    holidaysResult,
    calendarResult,
    myRequestsResult,
    usedResult,
    balancesResult,
    pendingResult,
    teamBalancesResult,
    teamUsedResult,
    adjustmentsResult,
    teamLeaveLogResult,
    companyDaysResult,
  ] = await Promise.all([
    supabase
      .from("time_off_policies")
      .select("code,label,color,annual_allowance,counts_toward_balance,requires_approval,position")
      .eq("is_active", true)
      .order("position"),
    supabase
      .from("portal_account")
      .select("id,email,name")
      .eq("is_active", true),
    supabase
      .from("time_off_holidays")
      .select("id,holiday_date,name")
      .gte("holiday_date", bounds.start)
      .lte("holiday_date", bounds.end)
      .order("holiday_date"),
    supabase
      .from("time_off_requests")
      .select("id,requester_id,policy_code,start_date,end_date,total_days,reason,status,reviewer_id,reviewer_note,reviewed_at,created_at")
      .eq("requester_id", params.accountId)
      .eq("status", "approved")
      .lte("start_date", bounds.end)
      .gte("end_date", bounds.start)
      .order("start_date"),
    supabase
      .from("time_off_requests")
      .select("id,requester_id,policy_code,start_date,end_date,total_days,reason,status,reviewer_id,reviewer_note,reviewed_at,created_at")
      .eq("requester_id", params.accountId)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("time_off_requests")
      .select("policy_code,total_days")
      .eq("requester_id", params.accountId)
      .eq("status", "approved")
      .gte("start_date", yearStart)
      .lte("end_date", yearEnd),
    supabase
      .from("time_off_balances")
      .select("policy_code,entitlement_days,adjustment_days")
      .eq("account_id", params.accountId)
      .eq("leave_year", year),
    params.isManager
      ? supabase
          .from("time_off_requests")
          .select("id,requester_id,policy_code,start_date,end_date,total_days,reason,status,reviewer_id,reviewer_note,reviewed_at,created_at")
          .eq("status", "pending")
          .order("created_at")
          .limit(100)
      : Promise.resolve({ data: [], error: null }),
    params.isManager
      ? supabase
          .from("time_off_balances")
          .select("account_id,policy_code,entitlement_days,adjustment_days")
          .eq("leave_year", year)
      : Promise.resolve({ data: [], error: null }),
    params.isManager
      ? supabase
          .from("time_off_requests")
          .select("requester_id,policy_code,total_days")
          .eq("status", "approved")
          .gte("start_date", yearStart)
          .lte("end_date", yearEnd)
      : Promise.resolve({ data: [], error: null }),
    params.isManager
      ? supabase
          .from("time_off_balance_adjustments")
          .select("id,account_id,policy_code,leave_year,effective_month,delta_days,note,created_by_id,created_at")
          .eq("leave_year", year)
          .order("created_at", { ascending: false })
          .limit(200)
      : Promise.resolve({ data: [], error: null }),
    params.isManager
      ? supabase
          .from("time_off_requests")
          .select("id,requester_id,policy_code,start_date,end_date,total_days,reason,status,reviewer_id,reviewer_note,reviewed_at,created_at")
          .order("created_at", { ascending: false })
          .limit(250)
      : Promise.resolve({ data: [], error: null }),
    params.isManager
      ? supabase
          .from("time_off_holidays")
          .select("id,holiday_date,name")
          .gte("holiday_date", yearStart)
          .lte("holiday_date", yearEnd)
          .order("holiday_date")
      : Promise.resolve({ data: [], error: null }),
  ]);

  const results = [
    policiesResult,
    accountsResult,
    holidaysResult,
    calendarResult,
    myRequestsResult,
    usedResult,
    balancesResult,
    pendingResult,
    teamBalancesResult,
    teamUsedResult,
    adjustmentsResult,
    teamLeaveLogResult,
    companyDaysResult,
  ];
  const failure = results.find((result) => result.error)?.error;
  if (failure) throw new Error(failure.message);

  const accounts = new Map(
    ((accountsResult.data ?? []) as AccountRow[]).map((account) => [account.id, account])
  );
  // Personal Day was retired. Filter it here as well as in the rollout so the
  // UI stays on the agreed three policies even before a pending migration runs.
  const policies = ((policiesResult.data ?? []) as TimeOffPolicy[])
    .filter((policy) => policy.code !== "personal");
  const usedByPolicy = new Map<string, number>();
  for (const row of (usedResult.data ?? []) as { policy_code: string; total_days: number | string }[]) {
    usedByPolicy.set(row.policy_code, (usedByPolicy.get(row.policy_code) ?? 0) + Number(row.total_days));
  }
  const storedBalances = new Map(
    ((balancesResult.data ?? []) as {
      policy_code: string;
      entitlement_days: number | null;
      adjustment_days: number | string;
    }[]).map((row) => [row.policy_code, row])
  );
  const balances: TimeOffBalance[] = policies.map((policy) => {
    const stored = storedBalances.get(policy.code);
    return {
      policy_code: policy.code,
      entitlement_days: stored?.entitlement_days ?? policy.annual_allowance,
      adjustment_days: Number(stored?.adjustment_days ?? 0),
      used_days: usedByPolicy.get(policy.code) ?? 0,
    };
  });
  const companyHolidays: TimeOffHoliday[] = ((holidaysResult.data ?? []) as {
    id: string;
    holiday_date: string;
    name: string;
  }[]).map((row) => ({ id: row.id, date: row.holiday_date, name: row.name, source: "company" }));
  const holidayByDate = new Map<string, TimeOffHoliday>();
  for (const holiday of [...getUsFederalHolidaysInRange(bounds.start, bounds.end), ...companyHolidays]) {
    // A company closure is more specific and should be labelled as such.
    holidayByDate.set(holiday.date, holiday);
  }

  const teamBalanceRows = (teamBalancesResult.data ?? []) as {
    account_id: string;
    policy_code: string;
    entitlement_days: number | null;
    adjustment_days: number | string;
  }[];
  const teamBalanceByAccount = new Map<string, Map<string, { entitlement_days: number | null; adjustment_days: number | string }>>();
  for (const row of teamBalanceRows) {
    const byPolicy = teamBalanceByAccount.get(row.account_id) ?? new Map();
    byPolicy.set(row.policy_code, row);
    teamBalanceByAccount.set(row.account_id, byPolicy);
  }
  const teamUsedByAccountPolicy = new Map<string, number>();
  for (const row of (teamUsedResult.data ?? []) as { requester_id: string; policy_code: string; total_days: number | string }[]) {
    const key = `${row.requester_id}:${row.policy_code}`;
    teamUsedByAccountPolicy.set(key, (teamUsedByAccountPolicy.get(key) ?? 0) + Number(row.total_days));
  }
  const teamMembers: TimeOffTeamMember[] = params.isManager
    ? ((accountsResult.data ?? []) as AccountRow[]).map((account) => {
        const storedForAccount = teamBalanceByAccount.get(account.id);
        return {
          id: account.id,
          name: account.name?.trim() || account.email,
          email: account.email,
          balances: policies.map((policy) => {
            const stored = storedForAccount?.get(policy.code);
            return {
              policy_code: policy.code,
              entitlement_days: stored?.entitlement_days ?? policy.annual_allowance,
              adjustment_days: Number(stored?.adjustment_days ?? 0),
              used_days: teamUsedByAccountPolicy.get(`${account.id}:${policy.code}`) ?? 0,
            };
          }),
        };
      }).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
    : [];
  const balanceAdjustments: TimeOffBalanceAdjustment[] = ((adjustmentsResult.data ?? []) as {
    id: string;
    account_id: string;
    policy_code: string;
    leave_year: number;
    effective_month: string;
    delta_days: number | string;
    note: string | null;
    created_by_id: string;
    created_at: string;
  }[]).map((row) => ({
    id: row.id,
    account_id: row.account_id,
    policy_code: row.policy_code,
    leave_year: Number(row.leave_year),
    effective_month: row.effective_month,
    delta_days: Number(row.delta_days),
    note: row.note,
    created_by_name: accounts.get(row.created_by_id)?.name?.trim() || accounts.get(row.created_by_id)?.email || "Unknown manager",
    created_at: row.created_at,
  }));
  const companyDays: TimeOffHoliday[] = ((companyDaysResult.data ?? []) as {
    id: string;
    holiday_date: string;
    name: string;
  }[]).map((row) => ({ id: row.id, date: row.holiday_date, name: row.name, source: "company" }));

  return {
    policies,
    balances,
    holidays: [...holidayByDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
    calendar_requests: ((calendarResult.data ?? []) as RequestRow[]).map(asCalendarEvent),
    my_requests: ((myRequestsResult.data ?? []) as RequestRow[]).map((row) => asRequest(row, accounts)),
    pending_approvals: ((pendingResult.data ?? []) as RequestRow[]).map((row) => asRequest(row, accounts)),
    team_members: teamMembers,
    balance_adjustments: balanceAdjustments,
    team_leave_log: ((teamLeaveLogResult.data ?? []) as RequestRow[]).map((row) => asRequest(row, accounts)),
    company_days: companyDays,
  };
}
