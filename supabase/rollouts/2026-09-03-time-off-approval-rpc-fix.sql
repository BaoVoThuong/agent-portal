-- Fix approval RPC variable/column ambiguity.
--
-- The function returns a `total_days` field, so that name is also a PL/pgSQL
-- variable. Qualify the approved-request columns to avoid PostgreSQL treating
-- `total_days` (and `status`) as ambiguous during an approval.

begin;

create or replace function public.approve_time_off_request(
  p_request_id uuid,
  p_reviewer_id uuid,
  p_reviewer_note text default null
) returns table (id uuid, status text, total_days numeric)
language plpgsql security definer set search_path = public as $$
declare
  request_value public.time_off_requests%rowtype;
  policy_value public.time_off_policies%rowtype;
  balance_value public.time_off_balances%rowtype;
  used_days numeric(10,1);
  available_days numeric(10,1);
  leave_year_value integer;
begin
  select * into request_value from public.time_off_requests
  where time_off_requests.id = p_request_id for update;
  if not found then raise exception 'TIME_OFF_REQUEST_NOT_FOUND'; end if;
  if request_value.status <> 'pending' then raise exception 'TIME_OFF_REQUEST_ALREADY_DECIDED'; end if;
  if request_value.requester_id = p_reviewer_id then raise exception 'TIME_OFF_SELF_APPROVAL_FORBIDDEN'; end if;

  select * into policy_value from public.time_off_policies
  where code = request_value.policy_code and is_active;
  if not found then raise exception 'TIME_OFF_POLICY_NOT_FOUND'; end if;
  leave_year_value := extract(year from request_value.start_date);

  if policy_value.counts_toward_balance then
    insert into public.time_off_balances (account_id, policy_code, leave_year)
    values (request_value.requester_id, request_value.policy_code, leave_year_value)
    on conflict (account_id, policy_code, leave_year) do nothing;

    select * into balance_value from public.time_off_balances
    where account_id = request_value.requester_id and policy_code = request_value.policy_code
      and leave_year = leave_year_value for update;

    select coalesce(sum(approved_request.total_days), 0) into used_days
    from public.time_off_requests as approved_request
    where approved_request.requester_id = request_value.requester_id
      and approved_request.policy_code = request_value.policy_code
      and approved_request.status = 'approved'
      and approved_request.start_date >= make_date(leave_year_value, 1, 1)
      and approved_request.end_date <= make_date(leave_year_value, 12, 31);

    available_days := coalesce(balance_value.entitlement_days, policy_value.annual_allowance)
      + balance_value.adjustment_days - used_days;
    if request_value.total_days > available_days then raise exception 'TIME_OFF_INSUFFICIENT_BALANCE'; end if;
  end if;

  update public.time_off_requests set
    status = 'approved', reviewer_id = p_reviewer_id,
    reviewer_note = nullif(btrim(coalesce(p_reviewer_note, '')), ''),
    reviewed_at = now(), updated_at = now()
  where time_off_requests.id = p_request_id
  returning time_off_requests.id, time_off_requests.status, time_off_requests.total_days
  into id, status, total_days;
  return next;
end;
$$;

revoke all on function public.approve_time_off_request(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.approve_time_off_request(uuid, uuid, text)
  to service_role;

commit;

notify pgrst, 'reload schema';
