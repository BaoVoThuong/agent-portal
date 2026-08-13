-- Run after 2026-08-13-enrollment-aca-overview-config.sql.
do $$
declare
  missing_count integer;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'enrollment_options'
      and column_name = 'treat_as_terminal'
  ) then
    raise exception 'enrollment_options.treat_as_terminal is missing';
  end if;

  select count(*) into missing_count
  from enrollment_options options
  join enrollment_option_sets sets on sets.id = options.set_id
  where sets.program = 'aca'
    and sets.key = 'stage'
    and lower(options.label) in ('can''t contact', 'can not get id card')
    and options.archived_at is null
    and options.treat_as_terminal is distinct from true;

  if missing_count > 0 then
    raise exception 'expected ACA terminal stages to be configured, found %', missing_count;
  end if;
end;
$$;
