// Domain types cho đăng ký khách hàng Health (health_entries).
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
