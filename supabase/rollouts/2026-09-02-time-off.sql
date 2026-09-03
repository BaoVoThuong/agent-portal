-- ===========================================================================
-- Time Off V1: US federal holiday-aware leave requests and manager approvals.
-- Run once in Supabase SQL Editor / psql. Safe to rerun.
-- ===========================================================================
begin;

-- Dedicated Time Off RBAC. This intentionally does not reuse Account Manager:
-- role configuration decides who can request leave and who can administer it.
insert into public.permissions (key, label, description, group_key, group_label, sort_order)
values
  ('timeoff.user', 'Time Off - User', 'Request personal leave, view own requests, and see the shared availability calendar.', 'time_off', 'Time Off', 100),
  ('timeoff.admin', 'Time Off - Admin', 'Review team leave, manage balances, view leave history, and manage company days off.', 'time_off', 'Time Off', 200)
on conflict (key) do update set
  label = excluded.label,
  description = excluded.description,
  group_key = excluded.group_key,
  group_label = excluded.group_label,
  sort_order = excluded.sort_order;

-- Preserve the current self-service experience: all existing active roles get
-- Time Off user access. Admin receives the separate administration permission.
-- Future custom roles can be configured in Role Manager with either permission.
insert into public.role_permissions (role_id, permission_key)
select id, 'timeoff.user'
from public.roles
where is_active
on conflict (role_id, permission_key) do nothing;

insert into public.role_permissions (role_id, permission_key)
select id, 'timeoff.admin'
from public.roles
where name = 'Admin' and is_active
on conflict (role_id, permission_key) do nothing;

create table if not exists public.time_off_policies (
  code text primary key check (code in ('vacation', 'sick', 'personal', 'unpaid')),
  label text not null,
  color text not null,
  annual_allowance numeric(6,1),
  counts_toward_balance boolean not null default true,
  requires_approval boolean not null default true,
  position integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((counts_toward_balance and annual_allowance is not null and annual_allowance >= 0)
    or (not counts_toward_balance and annual_allowance is null))
);

insert into public.time_off_policies
  (code, label, color, annual_allowance, counts_toward_balance, requires_approval, position)
values
  ('vacation', 'Annual Leave', '#2f6fed', 15, true, true, 10),
  ('sick', 'Sick Leave', '#e45e70', 5, true, true, 20),
  ('unpaid', 'Unpaid Leave', '#64748b', null, false, true, 30)
on conflict (code) do update set
  label = excluded.label, color = excluded.color,
  annual_allowance = excluded.annual_allowance,
  counts_toward_balance = excluded.counts_toward_balance,
  requires_approval = excluded.requires_approval,
  position = excluded.position, is_active = true, updated_at = now();

update public.time_off_policies
set is_active = false, updated_at = now()
where code = 'personal';

create table if not exists public.time_off_balances (
  account_id uuid not null references public.portal_account(id) on delete cascade,
  policy_code text not null references public.time_off_policies(code) on delete restrict,
  leave_year integer not null check (leave_year between 2020 and 2200),
  entitlement_days numeric(6,1),
  adjustment_days numeric(6,1) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (account_id, policy_code, leave_year),
  check (entitlement_days is null or entitlement_days >= 0)
);

create table if not exists public.time_off_balance_adjustments (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.portal_account(id) on delete cascade,
  policy_code text not null references public.time_off_policies(code) on delete restrict,
  leave_year integer not null check (leave_year between 2020 and 2200),
  effective_month date not null
    check (effective_month = date_trunc('month', effective_month)::date),
  delta_days numeric(6,1) not null check (delta_days <> 0 and delta_days between -366 and 366),
  note text check (note is null or char_length(note) <= 500),
  created_by_id uuid not null references public.portal_account(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (extract(year from effective_month) = leave_year)
);
create index if not exists time_off_balance_adjustments_account_idx
  on public.time_off_balance_adjustments (account_id, leave_year, effective_month desc, created_at desc);

create table if not exists public.time_off_holidays (
  id uuid primary key default gen_random_uuid(),
  holiday_date date not null unique,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  created_by_id uuid references public.portal_account(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.time_off_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.portal_account(id) on delete cascade,
  policy_code text not null references public.time_off_policies(code) on delete restrict,
  start_date date not null,
  end_date date not null,
  total_days numeric(6,1) not null check (total_days > 0),
  reason text check (reason is null or char_length(reason) <= 1000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  reviewer_id uuid references public.portal_account(id) on delete set null,
  reviewer_note text check (reviewer_note is null or char_length(reviewer_note) <= 1000),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date),
  check ((status = 'pending' and reviewer_id is null and reviewed_at is null) or status <> 'pending')
);

create index if not exists time_off_requests_calendar_idx
  on public.time_off_requests (status, start_date, end_date);
create index if not exists time_off_requests_requester_idx
  on public.time_off_requests (requester_id, created_at desc);

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

create or replace function public.adjust_time_off_balance(
  p_account_id uuid,
  p_policy_code text,
  p_leave_year integer,
  p_delta_days numeric,
  p_effective_month date,
  p_note text,
  p_actor_id uuid
) returns table (adjustment_id uuid, adjustment_days numeric, balance_adjustment_days numeric)
language plpgsql security definer set search_path = public as $$
declare
  policy_value public.time_off_policies%rowtype;
  new_adjustment_id uuid;
  new_balance_adjustment numeric(6,1);
begin
  if p_delta_days is null or p_delta_days = 0 or p_delta_days < -366 or p_delta_days > 366 then
    raise exception 'TIME_OFF_INVALID_ADJUSTMENT';
  end if;
  if p_leave_year < 2020 or p_leave_year > 2200
    or p_effective_month is null
    or p_effective_month <> date_trunc('month', p_effective_month)::date
    or extract(year from p_effective_month) <> p_leave_year then
    raise exception 'TIME_OFF_INVALID_EFFECTIVE_MONTH';
  end if;

  select * into policy_value from public.time_off_policies
  where code = p_policy_code and is_active;
  if not found or not policy_value.counts_toward_balance then
    raise exception 'TIME_OFF_POLICY_NOT_ADJUSTABLE';
  end if;
  if not exists (select 1 from public.portal_account where id = p_account_id and is_active)
    or not exists (select 1 from public.portal_account where id = p_actor_id and is_active) then
    raise exception 'TIME_OFF_ACCOUNT_NOT_FOUND';
  end if;

  insert into public.time_off_balances (account_id, policy_code, leave_year, adjustment_days)
  values (p_account_id, p_policy_code, p_leave_year, p_delta_days)
  on conflict (account_id, policy_code, leave_year) do update set
    adjustment_days = time_off_balances.adjustment_days + excluded.adjustment_days,
    updated_at = now()
  returning adjustment_days into new_balance_adjustment;

  insert into public.time_off_balance_adjustments
    (account_id, policy_code, leave_year, effective_month, delta_days, note, created_by_id)
  values
    (p_account_id, p_policy_code, p_leave_year, p_effective_month, p_delta_days,
      nullif(btrim(coalesce(p_note, '')), ''), p_actor_id)
  returning id into new_adjustment_id;

  return query select new_adjustment_id, p_delta_days, new_balance_adjustment;
end;
$$;

revoke all on function public.adjust_time_off_balance(uuid, text, integer, numeric, date, text, uuid)
  from public, anon, authenticated;
grant execute on function public.adjust_time_off_balance(uuid, text, integer, numeric, date, text, uuid)
  to service_role;

commit;

-- Expected: 3 active policies and the atomic approval function exist.
select
  (select count(*) from public.time_off_policies) as policy_count,
  exists (select 1 from pg_proc where proname = 'approve_time_off_request') as approval_rpc_ready;
