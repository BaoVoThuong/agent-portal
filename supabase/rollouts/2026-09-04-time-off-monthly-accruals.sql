-- ===========================================================================
-- Time Off monthly accruals + one-time team adjustments.
-- Run once in Supabase SQL Editor / psql. Safe to rerun.
-- ===========================================================================
begin;

create table if not exists public.time_off_monthly_accrual_rules (
  policy_code text primary key references public.time_off_policies(code) on delete restrict,
  credit_days numeric(6,1) not null check (credit_days > 0 and credit_days <= 31),
  start_month date not null check (start_month = date_trunc('month', start_month)::date),
  is_active boolean not null default true,
  updated_by_id uuid references public.portal_account(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.time_off_balance_adjustment_batches (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('monthly_accrual', 'bulk_adjustment')),
  policy_code text not null references public.time_off_policies(code) on delete restrict,
  leave_year integer not null check (leave_year between 2020 and 2200),
  effective_month date not null check (effective_month = date_trunc('month', effective_month)::date),
  delta_days numeric(6,1) not null check (delta_days <> 0 and delta_days between -366 and 366),
  note text check (note is null or char_length(note) <= 500),
  idempotency_key uuid unique,
  created_by_id uuid references public.portal_account(id) on delete set null,
  created_at timestamptz not null default now(),
  check (extract(year from effective_month) = leave_year)
);

alter table public.time_off_balance_adjustments
  add column if not exists source text not null default 'manual'
    check (source in ('manual', 'monthly_accrual', 'bulk_adjustment')),
  add column if not exists batch_id uuid references public.time_off_balance_adjustment_batches(id) on delete set null;

-- The schedule has no human actor. `null` identifies an automated credit in
-- the audit log; manual adjustments continue to require a real admin.
alter table public.time_off_balance_adjustments
  alter column created_by_id drop not null;

create unique index if not exists time_off_balance_adjustment_batches_monthly_once_idx
  on public.time_off_balance_adjustment_batches (policy_code, effective_month)
  where kind = 'monthly_accrual';
create unique index if not exists time_off_balance_adjustments_batch_account_idx
  on public.time_off_balance_adjustments (batch_id, account_id)
  where batch_id is not null;

create or replace function public.configure_time_off_monthly_accrual(
  p_policy_code text,
  p_credit_days numeric,
  p_start_month date,
  p_is_active boolean,
  p_actor_id uuid
) returns public.time_off_monthly_accrual_rules
language plpgsql security definer set search_path = public as $$
declare
  policy_value public.time_off_policies%rowtype;
  rule_value public.time_off_monthly_accrual_rules%rowtype;
begin
  if p_credit_days is null or p_credit_days <= 0 or p_credit_days > 31
    or round(p_credit_days, 1) <> p_credit_days then
    raise exception 'TIME_OFF_INVALID_MONTHLY_CREDIT';
  end if;
  if p_start_month is null
    or p_start_month <> date_trunc('month', p_start_month)::date then
    raise exception 'TIME_OFF_INVALID_EFFECTIVE_MONTH';
  end if;
  if not exists (select 1 from public.portal_account where id = p_actor_id and is_active) then
    raise exception 'TIME_OFF_ACCOUNT_NOT_FOUND';
  end if;
  select * into policy_value from public.time_off_policies
  where code = p_policy_code and is_active;
  if not found or not policy_value.counts_toward_balance then
    raise exception 'TIME_OFF_POLICY_NOT_ADJUSTABLE';
  end if;

  insert into public.time_off_monthly_accrual_rules
    (policy_code, credit_days, start_month, is_active, updated_by_id)
  values (p_policy_code, p_credit_days, p_start_month, coalesce(p_is_active, true), p_actor_id)
  on conflict (policy_code) do update set
    credit_days = excluded.credit_days,
    start_month = excluded.start_month,
    is_active = excluded.is_active,
    updated_by_id = excluded.updated_by_id,
    updated_at = now()
  returning * into rule_value;

  return rule_value;
end;
$$;

create or replace function public.apply_time_off_monthly_accruals(
  p_effective_month date,
  p_actor_id uuid default null
) returns table (
  policy_code text,
  credit_days numeric,
  member_count integer,
  applied boolean
)
language plpgsql security definer set search_path = public as $$
declare
  rule_value public.time_off_monthly_accrual_rules%rowtype;
  new_batch_id uuid;
  recipient_count integer;
  leave_year_value integer;
begin
  if p_effective_month is null
    or p_effective_month <> date_trunc('month', p_effective_month)::date
    or extract(year from p_effective_month) not between 2020 and 2200 then
    raise exception 'TIME_OFF_INVALID_EFFECTIVE_MONTH';
  end if;
  if p_actor_id is not null
    and not exists (select 1 from public.portal_account where id = p_actor_id and is_active) then
    raise exception 'TIME_OFF_ACCOUNT_NOT_FOUND';
  end if;
  leave_year_value := extract(year from p_effective_month);

  for rule_value in
    select * from public.time_off_monthly_accrual_rules
    where is_active and start_month <= p_effective_month
    order by policy_code
  loop
    new_batch_id := null;
    insert into public.time_off_balance_adjustment_batches
      (kind, policy_code, leave_year, effective_month, delta_days, note, created_by_id)
    values
      ('monthly_accrual', rule_value.policy_code, leave_year_value, p_effective_month,
       rule_value.credit_days, 'Scheduled monthly accrual.', p_actor_id)
    on conflict (policy_code, effective_month) where kind = 'monthly_accrual' do nothing
    returning id into new_batch_id;

    if new_batch_id is null then
      policy_code := rule_value.policy_code;
      credit_days := rule_value.credit_days;
      member_count := 0;
      applied := false;
      return next;
      continue;
    end if;

    insert into public.time_off_balances
      (account_id, policy_code, leave_year, adjustment_days)
    select account.id, rule_value.policy_code, leave_year_value, rule_value.credit_days
    from public.portal_account account
    where account.is_active
    on conflict (account_id, policy_code, leave_year) do update set
      adjustment_days = public.time_off_balances.adjustment_days + excluded.adjustment_days,
      updated_at = now();
    get diagnostics recipient_count = row_count;

    insert into public.time_off_balance_adjustments
      (account_id, policy_code, leave_year, effective_month, delta_days, note, created_by_id, source, batch_id)
    select account.id, rule_value.policy_code, leave_year_value, p_effective_month,
      rule_value.credit_days, 'Scheduled monthly accrual.', p_actor_id, 'monthly_accrual', new_batch_id
    from public.portal_account account
    where account.is_active;

    policy_code := rule_value.policy_code;
    credit_days := rule_value.credit_days;
    member_count := recipient_count;
    applied := true;
    return next;
  end loop;
end;
$$;

create or replace function public.bulk_adjust_time_off_balances(
  p_policy_code text,
  p_leave_year integer,
  p_delta_days numeric,
  p_effective_month date,
  p_note text,
  p_actor_id uuid,
  p_idempotency_key uuid
) returns table (
  batch_id uuid,
  member_count integer,
  applied boolean
)
language plpgsql security definer set search_path = public as $$
declare
  policy_value public.time_off_policies%rowtype;
  new_batch_id uuid;
  existing_batch_id uuid;
  recipient_count integer;
begin
  if p_delta_days is null or p_delta_days = 0 or p_delta_days < -366 or p_delta_days > 366
    or round(p_delta_days, 1) <> p_delta_days then
    raise exception 'TIME_OFF_INVALID_ADJUSTMENT';
  end if;
  if p_leave_year < 2020 or p_leave_year > 2200
    or p_effective_month is null
    or p_effective_month <> date_trunc('month', p_effective_month)::date
    or extract(year from p_effective_month) <> p_leave_year then
    raise exception 'TIME_OFF_INVALID_EFFECTIVE_MONTH';
  end if;
  if p_idempotency_key is null then
    raise exception 'TIME_OFF_IDEMPOTENCY_KEY_REQUIRED';
  end if;
  if not exists (select 1 from public.portal_account where id = p_actor_id and is_active) then
    raise exception 'TIME_OFF_ACCOUNT_NOT_FOUND';
  end if;
  select * into policy_value from public.time_off_policies
  where code = p_policy_code and is_active;
  if not found or not policy_value.counts_toward_balance then
    raise exception 'TIME_OFF_POLICY_NOT_ADJUSTABLE';
  end if;

  insert into public.time_off_balance_adjustment_batches
    (kind, policy_code, leave_year, effective_month, delta_days, note, idempotency_key, created_by_id)
  values
    ('bulk_adjustment', p_policy_code, p_leave_year, p_effective_month, p_delta_days,
     nullif(btrim(coalesce(p_note, '')), ''), p_idempotency_key, p_actor_id)
  on conflict (idempotency_key) do nothing
  returning id into new_batch_id;

  if new_batch_id is null then
    select id into existing_batch_id from public.time_off_balance_adjustment_batches
    where idempotency_key = p_idempotency_key;
    batch_id := existing_batch_id;
    member_count := 0;
    applied := false;
    return next;
    return;
  end if;

  insert into public.time_off_balances
    (account_id, policy_code, leave_year, adjustment_days)
  select account.id, p_policy_code, p_leave_year, p_delta_days
  from public.portal_account account
  where account.is_active
  on conflict (account_id, policy_code, leave_year) do update set
    adjustment_days = public.time_off_balances.adjustment_days + excluded.adjustment_days,
    updated_at = now();
  get diagnostics recipient_count = row_count;

  insert into public.time_off_balance_adjustments
    (account_id, policy_code, leave_year, effective_month, delta_days, note, created_by_id, source, batch_id)
  select account.id, p_policy_code, p_leave_year, p_effective_month, p_delta_days,
    nullif(btrim(coalesce(p_note, '')), ''), p_actor_id, 'bulk_adjustment', new_batch_id
  from public.portal_account account
  where account.is_active;

  batch_id := new_batch_id;
  member_count := recipient_count;
  applied := true;
  return next;
end;
$$;

revoke all on function public.configure_time_off_monthly_accrual(text, numeric, date, boolean, uuid)
  from public, anon, authenticated;
grant execute on function public.configure_time_off_monthly_accrual(text, numeric, date, boolean, uuid)
  to service_role;
revoke all on function public.apply_time_off_monthly_accruals(date, uuid)
  from public, anon, authenticated;
grant execute on function public.apply_time_off_monthly_accruals(date, uuid)
  to service_role;
revoke all on function public.bulk_adjust_time_off_balances(text, integer, numeric, date, text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.bulk_adjust_time_off_balances(text, integer, numeric, date, text, uuid, uuid)
  to service_role;

commit;
