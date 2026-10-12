-- Fix: the daily cron /api/cron/time-off-monthly-accrual has failed every run
-- since 2026-09-04 with `column reference "policy_code" is ambiguous` (42702).
--
-- apply_time_off_monthly_accruals() returns table (policy_code, ...), which makes
-- `policy_code` a PL/pgSQL OUT variable. Bare `policy_code` inside the SQL
-- statements (`order by policy_code`, both `on conflict (... policy_code ...)`)
-- then matches both the variable and the table column, and Postgres refuses.
-- No monthly_accrual batch was ever written, so no member received accrual.
--
-- `#variable_conflict use_column` makes bare names in SQL resolve to columns.
-- Assignments such as `policy_code := ...` still target the OUT variable.
-- The body is otherwise unchanged from 2026-09-04-time-off-monthly-accruals.sql.
--
-- Run once in Supabase SQL Editor. Grants are kept by create or replace.

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
#variable_conflict use_column
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

-- Pause accrual so the now-working cron credits nothing yet:
-- - sick: the policy is retired (time_off_policies.is_active = false) but its
--   accrual rule was still active.
-- - vacation: Time Off has not gone live. Re-enable this rule from the Time Off
--   admin page on go-live. No backfill for September or October.
update public.time_off_monthly_accrual_rules
set is_active = false, updated_at = now()
where policy_code in ('sick', 'vacation') and is_active;
