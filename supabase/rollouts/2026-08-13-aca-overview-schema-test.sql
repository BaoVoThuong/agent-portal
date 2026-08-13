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
end;
$$;
