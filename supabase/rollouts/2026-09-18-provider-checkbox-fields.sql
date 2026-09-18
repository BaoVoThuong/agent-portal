-- =====================================================================
-- Provider List: checkbox datatypes for boolean fields.
--
-- Must run as a NEW rollout after the provider table-config rollouts.
-- Idempotent. Do not edit or re-run an older rollout to apply this change.
-- =====================================================================

begin;

update public.table_column
set label = 'New Patient',
    type = 'checkbox',
    updated_at = now()
where scope = 'provider'
  and key = 'accepting_new_patients'
  and archived_at is null;

update public.table_column
set label = 'Reviewed',
    type = 'checkbox',
    updated_at = now()
where scope = 'provider'
  and key = 'needs_review'
  and archived_at is null;

do $$
begin
  if not exists (
    select 1
    from public.table_column
    where scope = 'provider'
      and key = 'accepting_new_patients'
      and archived_at is null
      and label = 'New Patient'
      and type = 'checkbox'
  ) then
    raise exception 'Provider New Patient column is missing or has the wrong datatype';
  end if;

  if not exists (
    select 1
    from public.table_column
    where scope = 'provider'
      and key = 'needs_review'
      and archived_at is null
      and label = 'Reviewed'
      and type = 'checkbox'
  ) then
    raise exception 'Provider Reviewed column is missing or has the wrong datatype';
  end if;
end $$;

select key, label, type, position, hidden_default
from public.table_column
where scope = 'provider'
  and key in ('accepting_new_patients', 'needs_review')
  and archived_at is null
order by position;

commit;

notify pgrst, 'reload schema';
