// Domain types cho đăng ký khách hàng P&C (pc_entries).
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
