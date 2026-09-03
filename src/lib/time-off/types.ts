export type TimeOffRequestStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled";

export type TimeOffPolicy = {
  code: string;
  label: string;
  color: string;
  annual_allowance: number | null;
  counts_toward_balance: boolean;
  requires_approval: boolean;
  position: number;
};

export type TimeOffHoliday = {
  id: string;
  date: string;
  name: string;
  source: "us_federal" | "company";
};

export type TimeOffRequest = {
  id: string;
  requester_id: string;
  requester_name: string;
  requester_email: string;
  policy_code: string;
  start_date: string;
  end_date: string;
  total_days: number;
  reason: string | null;
  status: TimeOffRequestStatus;
  reviewer_name: string | null;
  reviewer_note: string | null;
  reviewed_at: string | null;
  created_at: string;
};

/** A personal approved leave event shown on the signed-in user's calendar. */
export type TimeOffCalendarEvent = {
  id: string;
  policy_code: string;
  start_date: string;
  end_date: string;
};

export type TimeOffBalance = {
  policy_code: string;
  entitlement_days: number | null;
  adjustment_days: number;
  used_days: number;
};

export type TimeOffTeamMember = {
  id: string;
  name: string;
  email: string;
  balances: TimeOffBalance[];
};

export type TimeOffBalanceAdjustment = {
  id: string;
  account_id: string;
  policy_code: string;
  leave_year: number;
  effective_month: string;
  delta_days: number;
  note: string | null;
  created_by_name: string;
  created_at: string;
};

export type TimeOffDashboardData = {
  policies: TimeOffPolicy[];
  balances: TimeOffBalance[];
  holidays: TimeOffHoliday[];
  calendar_requests: TimeOffCalendarEvent[];
  my_requests: TimeOffRequest[];
  pending_approvals: TimeOffRequest[];
  team_members: TimeOffTeamMember[];
  balance_adjustments: TimeOffBalanceAdjustment[];
  team_leave_log: TimeOffRequest[];
  company_days: TimeOffHoliday[];
};
