-- Run after 2026-08-13-enrollment-aca-overview-config.sql.
do $$
declare
  stale_count integer;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'enrollment_options'
      and column_name = 'treat_as_terminal'
  ) then
    raise exception 'enrollment_options.treat_as_terminal is missing';
  end if;

  select count(*) into stale_count
  from enrollment_options options
  where options.treat_as_terminal is distinct from false;

  if stale_count > 0 then
    raise exception 'legacy treat_as_terminal values remain: %', stale_count;
  end if;
end;
$$;
