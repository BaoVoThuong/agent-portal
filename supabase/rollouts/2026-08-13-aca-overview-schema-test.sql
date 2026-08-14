do $$
begin
  if not exists (select 1 from information_schema.columns where table_name = 'enrollment_records' and column_name = 'last_work_activity_at') then
    raise exception 'last_work_activity_at missing';
  end if;
  if not exists (select 1 from information_schema.columns where table_name = 'enrollment_records' and column_name = 'responsible_assigned_at') then
    raise exception 'responsible_assigned_at missing';
  end if;
  if not exists (select 1 from information_schema.columns where table_name = 'enrollment_stage_cycles' and column_name = 'responsible_start_email') then
    raise exception 'responsible_start_email missing';
  end if;
  if to_regclass('public.enrollment_queue_members') is null then raise exception 'queue table missing'; end if;
  if to_regclass('public.enrollment_overview_settings') is null then raise exception 'settings table missing'; end if;

  -- The anon key ships to the browser, so an unprotected table here is readable
  -- and writable by any visitor. Fail closed rather than discover it later.
  if not (select relrowsecurity from pg_class where oid = 'public.enrollment_queue_members'::regclass) then
    raise exception 'enrollment_queue_members has RLS disabled';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.enrollment_overview_settings'::regclass) then
    raise exception 'enrollment_overview_settings has RLS disabled';
  end if;

  -- Queue membership is per program; a single email-keyed row would let an ACA
  -- toggle silently disable the same person elsewhere.
  if not exists (select 1 from information_schema.columns where table_name = 'enrollment_queue_members' and column_name = 'program') then
    raise exception 'enrollment_queue_members.program missing';
  end if;
  if (select count(*) from information_schema.key_column_usage
      where table_name = 'enrollment_queue_members'
        and constraint_name = 'enrollment_queue_members_pkey') <> 2 then
    raise exception 'enrollment_queue_members primary key must be (email, program)';
  end if;
end;
$$;

-- Assigning a record is real work: it must move BOTH clocks, not just the
-- assignment one. This regressed once when the trigger used an elsif chain.
do $$
declare
  probe uuid;
  before_activity timestamptz;
  after_activity timestamptz;
  after_assigned timestamptz;
begin
  select id, last_work_activity_at into probe, before_activity
  from enrollment_records
  where program = 'aca' and archived_at is null and closed_at is null
  limit 1;
  if probe is null then
    raise notice 'no open ACA record available; skipping trigger assertion';
    return;
  end if;

  update enrollment_records
  set responsible_enroll_email = 'trigger-probe@example.com',
      updated_at = now(),
      updated_by_email = 'trigger-probe@example.com'
  where id = probe;

  select last_work_activity_at, responsible_assigned_at
    into after_activity, after_assigned
  from enrollment_records where id = probe;

  if after_assigned is null then
    raise exception 'assignment did not stamp responsible_assigned_at';
  end if;
  if before_activity is not null and after_activity <= before_activity then
    raise exception 'assignment did not advance last_work_activity_at';
  end if;

  raise exception 'ROLLBACK_TRIGGER_PROBE';
exception
  when others then
    if sqlerrm <> 'ROLLBACK_TRIGGER_PROBE' then raise; end if;
end;
$$;
