-- Legacy compatibility for the retired ACA-only dashboard terminal flag.
--
-- The application now has one terminal definition: enrollment_options.is_terminal.
-- Keep the old column during the rollout so mixed-version deployments and old
-- snapshots remain readable, but clear every value so it cannot diverge from
-- workflow semantics. The follow-up stage setup marks the canonical ACA
-- terminal stages through is_terminal.
alter table enrollment_options
  add column if not exists treat_as_terminal boolean not null default false;

update enrollment_options options
set treat_as_terminal = false,
    updated_at = now()
where options.treat_as_terminal is distinct from false;

-- Keep the compatibility column documented while old clients are phased out.
comment on column enrollment_options.treat_as_terminal is
  'Legacy compatibility only. Terminal semantics are defined by is_terminal.';
