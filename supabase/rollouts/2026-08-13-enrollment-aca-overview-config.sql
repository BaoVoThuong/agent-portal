-- ACA overview configuration semantics.
-- Additive and safe to run before the application deploy. The default keeps
-- existing records running until the two known ACA terminal outcomes are
-- explicitly marked below.
alter table enrollment_options
  add column if not exists treat_as_terminal boolean not null default false;

update enrollment_options options
set treat_as_terminal = true,
    updated_at = now()
from enrollment_option_sets sets
where sets.id = options.set_id
  and sets.program = 'aca'
  and sets.key = 'stage'
  and lower(options.label) in ('can''t contact', 'can not get id card')
  and options.archived_at is null;

-- Keep the setting stable for future seed re-runs without changing user
-- overrides on unrelated stages.
comment on column enrollment_options.treat_as_terminal is
  'ACA overview semantics: stage is terminal for dashboard metrics; independent from is_terminal/QC.';
