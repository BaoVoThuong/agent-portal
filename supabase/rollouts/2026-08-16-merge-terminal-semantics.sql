-- Unify workflow and ACA dashboard terminal semantics.
--
-- Run after the stage-catalog rollout (2026-08-15). This is idempotent and
-- deliberately does not delete the legacy column: mixed-version deployments
-- and historical snapshots may still select it.
begin;

-- The ACA stage is terminal in both the workflow and overview. Existing
-- records are not rewritten; the current database has no active records on
-- this stage, and future transitions use the shared is_terminal behavior.
update enrollment_options as options
set is_terminal = true,
    treat_as_terminal = false,
    updated_at = now()
from enrollment_option_sets as sets
where sets.id = options.set_id
  and sets.program = 'aca'
  and sets.key = 'stage'
  and lower(options.label) = '11-id card unavailable'
  and options.archived_at is null;

-- No option may retain the retired dashboard-only flag. The column remains
-- only as a compatibility shell until a later schema cleanup window.
update enrollment_options
set treat_as_terminal = false,
    updated_at = now()
where treat_as_terminal is distinct from false;

commit;
