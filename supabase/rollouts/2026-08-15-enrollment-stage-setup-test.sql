-- Scratch-only assertions. Run after 2026-08-15-enrollment-stage-setup.sql.

do $$
declare
  aca_actual text;
  medicare_actual text;
  aca_expected constant text := '1-Need quote|2-Quoted|3-Waiting for Confirmation|4-Need documents|5-Ready to Enroll|6-Enrolled|7-1st payment done|8-Need assign PCP|9-Need ID card|10-ID card done|11-ID card unavailable|12-Terminated';
  medicare_expected constant text := '1-Need quote|2-Quoted|3-Waiting for Confirmation|4-Need documents|5-Ready to Enroll|6-Enrolled-1stpayment done|7-Need assign PCP|8-Need ID card|9-ID card done|10-ID card unavailable|11-Terminated';
begin
  select string_agg(options.label, '|' order by options.position)
    into aca_actual
  from enrollment_options options
  join enrollment_option_sets sets on sets.id = options.set_id
  where sets.program = 'aca'
    and sets.key = 'stage'
    and options.archived_at is null;

  select string_agg(options.label, '|' order by options.position)
    into medicare_actual
  from enrollment_options options
  join enrollment_option_sets sets on sets.id = options.set_id
  where sets.program = 'medicare'
    and sets.key = 'stage'
    and options.archived_at is null;

  if aca_actual is distinct from aca_expected then
    raise exception 'ACA stage catalog mismatch: %', aca_actual;
  end if;
  if medicare_actual is distinct from medicare_expected then
    raise exception 'Medicare stage catalog mismatch: %', medicare_actual;
  end if;

  if not exists (
    select 1
    from enrollment_options options
    join enrollment_option_sets sets on sets.id = options.set_id
    where sets.program = 'aca'
      and sets.key = 'stage'
      and lower(options.label) = '10-id card done'
      and options.archived_at is null
      and options.is_terminal
      and options.triggers_qc
  ) then
    raise exception 'ACA ID card done stage semantics are incorrect';
  end if;

  if not exists (
    select 1
    from enrollment_options options
    join enrollment_option_sets sets on sets.id = options.set_id
    where sets.program = 'aca'
      and sets.key = 'stage'
      and lower(options.label) = '11-id card unavailable'
      and options.archived_at is null
      and options.treat_as_terminal
      and not options.is_terminal
  ) then
    raise exception 'ACA ID card unavailable dashboard semantics are incorrect';
  end if;

  if not exists (
    select 1
    from enrollment_options options
    join enrollment_option_sets sets on sets.id = options.set_id
    where sets.program = 'medicare'
      and sets.key = 'stage'
      and lower(options.label) = '9-id card done'
      and options.archived_at is null
      and options.is_terminal
      and options.triggers_qc
  ) then
    raise exception 'Medicare ID card done stage semantics are incorrect';
  end if;
end $$;
