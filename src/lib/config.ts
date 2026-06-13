export type EntryInput = {
  selected_agent: string;
  carrier_name: string;
  state: string;
  zipcode: string;
  effective_date: string;
  customer_name: string;
  policy_id: string;
  number_of_members: number | null;
  fub_link: string;
};

export type Entry = EntryInput & {
  id: string;
  agent_email: string;
  agent_name: string | null;
  created_at: string;
};

export type PcEntryInput = {
  selected_agent: string;
  agency: string;
  insured_name: string;
  address: string;
  type: string;
  company: string;
  policy_number: string;
  pay_plan: string;
  premium: string;
  effective_date: string;
  expired_date: string;
};

export type PcEntry = PcEntryInput & {
  id: string;
  agent_email: string;
  agent_name: string | null;
  created_at: string;
};

export type UserRole = "admin" | "agent";

export const PORTAL_ACCOUNT_TABLE = "portal_account";

export type AccountUser = {
  id: string;
  email: string;
  name: string | null;
  agent_id: string | null;
  role: UserRole;
  is_active: boolean;
  created_at: string;
};
