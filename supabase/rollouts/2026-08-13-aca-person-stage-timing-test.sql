do $$
begin
  if not exists (select 1 from information_schema.columns where table_name = 'enrollment_stage_cycles' and column_name = 'responsible_start_email') then raise exception 'responsible_start_email missing'; end if;
  if not exists (select 1 from information_schema.columns where table_name = 'enrollment_stage_cycles' and column_name = 'responsible_end_email') then raise exception 'responsible_end_email missing'; end if;
end;
$$;
