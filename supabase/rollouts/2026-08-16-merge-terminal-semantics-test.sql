-- Verification for 2026-08-16-merge-terminal-semantics.sql.
do $$
declare
  stale_count integer;
begin
  select count(*) into stale_count
  from enrollment_options
  where treat_as_terminal is distinct from false;
  if stale_count <> 0 then
    raise exception 'legacy dashboard terminal flags remain: %', stale_count;
  end if;

  if not exists (
    select 1
    from enrollment_options options
    join enrollment_option_sets sets on sets.id = options.set_id
    where sets.program = 'aca'
      and sets.key = 'stage'
      and lower(options.label) = '11-id card unavailable'
      and options.archived_at is null
      and options.is_terminal
      and not options.treat_as_terminal
  ) then
    raise exception 'ACA ID card unavailable is not a final stage';
  end if;
end;
$$;
