-- Demo-only Time Off data for the 2026 UI. Safe to re-run: it removes and
-- recreates only requests tagged `[Sample time off]`. Do not run in production
-- unless these demonstrative requests are wanted there.
--
-- It creates pending, approved, rejected, and cancelled requests so the
-- Administration > Leave history screen and its embedded approval queue can
-- be reviewed without using real employee leave.

do $$
declare
  reviewer_account_id uuid;
begin
  select id into reviewer_account_id
  from public.portal_account
  where is_active
  order by case when role = 'admin' then 0 else 1 end, email
  limit 1;

  if reviewer_account_id is null then
    raise notice 'No active portal account found; Time Off samples were not created.';
    return;
  end if;

  delete from public.time_off_requests
  where reason like '[Sample time off]%';

  with requesters as (
    select id, row_number() over (order by email) as position
    from public.portal_account
    where is_active and id <> reviewer_account_id
  ), samples as (
    select * from (values
      (1, 'vacation', date '2026-09-14', date '2026-09-15', 2.0::numeric, 'pending',   '[Sample time off] Family trip request.',                           null::text,                    null::timestamptz, timestamptz '2026-09-03 09:00:00+00'),
      (2, 'sick',     date '2026-09-18', date '2026-09-18', 1.0::numeric, 'pending',   '[Sample time off] Medical appointment.',                            null::text,                    null::timestamptz, timestamptz '2026-09-03 10:00:00+00'),
      (3, 'vacation', date '2026-08-24', date '2026-08-26', 3.0::numeric, 'approved',  '[Sample time off] Summer travel.',                                  'Approved — enjoy your trip.',  timestamptz '2026-08-12 16:00:00+00', timestamptz '2026-08-10 09:00:00+00'),
      (4, 'unpaid',   date '2026-09-21', date '2026-09-22', 2.0::numeric, 'approved',  '[Sample time off] Personal commitment.',                            'Coverage confirmed.',          timestamptz '2026-09-01 15:00:00+00', timestamptz '2026-08-28 09:00:00+00'),
      (5, 'vacation', date '2026-10-05', date '2026-10-06', 2.0::numeric, 'rejected',  '[Sample time off] Requested dates overlap team coverage.',          'Please choose another week.',  timestamptz '2026-08-30 14:00:00+00', timestamptz '2026-08-29 09:00:00+00'),
      (6, 'sick',     date '2026-07-17', date '2026-07-17', 1.0::numeric, 'cancelled', '[Sample time off] Cancelled after the appointment was rescheduled.', null::text,                    null::timestamptz, timestamptz '2026-07-10 09:00:00+00')
    ) as values_table(position, policy_code, start_date, end_date, total_days, status, reason, reviewer_note, reviewed_at, created_at)
  )
  insert into public.time_off_requests (
    requester_id, policy_code, start_date, end_date, total_days, reason, status,
    reviewer_id, reviewer_note, reviewed_at, created_at, updated_at
  )
  select
    requesters.id,
    samples.policy_code,
    samples.start_date,
    samples.end_date,
    samples.total_days,
    samples.reason,
    samples.status,
    case when samples.status in ('approved', 'rejected') then reviewer_account_id else null end,
    samples.reviewer_note,
    samples.reviewed_at,
    samples.created_at,
    coalesce(samples.reviewed_at, samples.created_at)
  from requesters
  join samples on samples.position = requesters.position
  join public.time_off_policies policy
    on policy.code = samples.policy_code and policy.is_active;
end;
$$;

select status, count(*) as requests
from public.time_off_requests
where reason like '[Sample time off]%'
group by status
order by status;
