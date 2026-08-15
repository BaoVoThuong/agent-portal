-- Normalize the ACA and Medicare enrollment stage catalogs.
--
-- This migration is intentionally additive/archival:
--   * existing option IDs are reused when their labels map to a new stage;
--   * enrollment_records and enrollment_stage_history therefore keep their
--     foreign keys and historical meaning;
--   * stages outside the requested catalog are archived, never deleted;
--   * the migration is safe to run repeatedly.
--
-- Apply during a maintenance window. The application can continue to read
-- archived options for historical records, while new selectors expose only
-- active canonical stages.

begin;

lock table enrollment_option_sets, enrollment_options in share row exclusive mode;

insert into enrollment_option_sets (program, key, label, is_stage)
values
  ('aca', 'stage', 'Stage', true),
  ('medicare', 'stage', 'Stage', true)
on conflict (program, key) do update
set label = excluded.label,
    is_stage = excluded.is_stage,
    updated_at = now();

create temporary table _enrollment_stage_setup (
  program text not null,
  label text not null,
  color text not null,
  position integer not null,
  is_terminal boolean not null,
  treat_as_terminal boolean not null,
  triggers_qc boolean not null,
  primary key (program, label)
) on commit drop;

insert into _enrollment_stage_setup
  (program, label, color, position, is_terminal, treat_as_terminal, triggers_qc)
values
  ('aca', '1-Need quote', '#6B778C', 10, false, false, false),
  ('aca', '2-Quoted', '#0C66E4', 20, false, false, false),
  ('aca', '3-Waiting for Confirmation', '#F5A524', 30, false, false, false),
  ('aca', '4-Need documents', '#FFAB00', 40, false, false, false),
  ('aca', '5-Ready to Enroll', '#36B37E', 50, false, false, false),
  ('aca', '6-Enrolled', '#00A3BF', 60, false, false, false),
  ('aca', '7-1st payment done', '#6554C0', 70, false, false, false),
  ('aca', '8-Need assign PCP', '#FF7452', 80, false, false, false),
  ('aca', '9-Need ID card', '#00875A', 90, false, false, false),
  ('aca', '10-ID card done', '#00875A', 100, true, false, true),
  ('aca', '11-ID card unavailable', '#FF7452', 110, false, true, false),
  ('aca', '12-Terminated', '#C9372C', 120, true, false, false),
  ('medicare', '1-Need quote', '#6B778C', 10, false, false, false),
  ('medicare', '2-Quoted', '#0C66E4', 20, false, false, false),
  ('medicare', '3-Waiting for Confirmation', '#F5A524', 30, false, false, false),
  ('medicare', '4-Need documents', '#FFAB00', 40, false, false, false),
  ('medicare', '5-Ready to Enroll', '#36B37E', 50, false, false, false),
  ('medicare', '6-Enrolled-1stpayment done', '#6554C0', 60, false, false, false),
  ('medicare', '7-Need assign PCP', '#FF7452', 70, false, false, false),
  ('medicare', '8-Need ID card', '#00875A', 80, false, false, false),
  ('medicare', '9-ID card done', '#00875A', 90, true, false, true),
  ('medicare', '10-ID card unavailable', '#FF7452', 100, false, false, false),
  ('medicare', '11-Terminated', '#C9372C', 110, true, false, false);

create temporary table _enrollment_stage_renames (
  program text not null,
  old_label text not null,
  new_label text not null,
  primary key (program, old_label)
) on commit drop;

insert into _enrollment_stage_renames (program, old_label, new_label)
values
  ('aca', '5-Ready to enroll', '5-Ready to Enroll'),
  ('aca', '9-Assigned PCP/Get ID Card', '9-Need ID card'),
  ('aca', '10-DONE', '10-ID card done'),
  ('aca', '11-Terminated', '12-Terminated'),
  ('aca', 'Can not get ID card', '11-ID card unavailable'),
  ('medicare', 'New', '1-Need quote'),
  ('medicare', 'E- ID Card Unavailable', '10-ID card unavailable'),
  ('medicare', '10 - DONE', '9-ID card done');

-- Reuse old IDs where the business meaning is unambiguous. If an admin has
-- already created the target label, leave the old option in place so the
-- unique active-label index is not violated; it is archived in the cleanup
-- step below.
update enrollment_options as options
set label = renames.new_label,
    updated_at = now()
from enrollment_option_sets as sets
join _enrollment_stage_renames as renames
  on renames.program = sets.program
where options.set_id = sets.id
  and sets.key = 'stage'
  and options.archived_at is null
  and lower(options.label) = lower(renames.old_label)
  and not exists (
    select 1
    from enrollment_options as target
    where target.set_id = options.set_id
      and target.archived_at is null
      and target.id <> options.id
      and lower(target.label) = lower(renames.new_label)
  );

-- Canonicalize spelling, color, ordering, and stage semantics for active rows.
update enrollment_options as options
set label = setup.label,
    color = setup.color,
    position = setup.position,
    is_terminal = setup.is_terminal,
    treat_as_terminal = setup.treat_as_terminal,
    triggers_qc = setup.triggers_qc,
    updated_at = now()
from enrollment_option_sets as sets
join _enrollment_stage_setup as setup
  on setup.program = sets.program
where options.set_id = sets.id
  and sets.key = 'stage'
  and options.archived_at is null
  and lower(options.label) = lower(setup.label);

-- Add any missing canonical stage without touching existing record references.
insert into enrollment_options (
  set_id, label, color, position, is_terminal, treat_as_terminal, triggers_qc
)
select sets.id, setup.label, setup.color, setup.position,
       setup.is_terminal, setup.treat_as_terminal, setup.triggers_qc
from enrollment_option_sets as sets
join _enrollment_stage_setup as setup
  on setup.program = sets.program
where sets.key = 'stage'
  and not exists (
    select 1
    from enrollment_options as existing
    where existing.set_id = sets.id
      and existing.archived_at is null
      and lower(existing.label) = lower(setup.label)
  );

-- Keep historical rows readable, but prevent non-canonical stages from being
-- offered to new records or edits.
update enrollment_options as options
set archived_at = coalesce(options.archived_at, now()),
    updated_at = now()
from enrollment_option_sets as sets
where options.set_id = sets.id
  and sets.key = 'stage'
  and options.archived_at is null
  and not exists (
    select 1
    from _enrollment_stage_setup as setup
    where setup.program = sets.program
      and lower(setup.label) = lower(options.label)
  );

do $$
declare
  missing_count integer;
  extra_count integer;
begin
  select count(*)
    into missing_count
  from _enrollment_stage_setup as setup
  join enrollment_option_sets as sets
    on sets.program = setup.program and sets.key = 'stage'
  where not exists (
    select 1
    from enrollment_options as options
    where options.set_id = sets.id
      and options.archived_at is null
      and lower(options.label) = lower(setup.label)
  );

  if missing_count <> 0 then
    raise exception 'enrollment stage setup is missing % canonical options', missing_count;
  end if;

  select count(*)
    into extra_count
  from enrollment_option_sets as sets
  join enrollment_options as options on options.set_id = sets.id
  where sets.key = 'stage'
    and options.archived_at is null
    and not exists (
      select 1
      from _enrollment_stage_setup as setup
      where setup.program = sets.program
        and lower(setup.label) = lower(options.label)
    );

  if extra_count <> 0 then
    raise exception 'enrollment stage setup left % non-canonical active options', extra_count;
  end if;
end $$;

commit;
