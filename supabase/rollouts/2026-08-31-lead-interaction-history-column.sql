-- Lead Management: add the compact, read-only interaction rail to both Lead
-- tables. It is visible by default and can still be reordered or hidden from
-- Lead Table Configuration like every other system column.
--
-- Forward-only and idempotent.

insert into table_column (
  scope, key, label, type, is_system, position,
  pinned, hidden_default, show_in_detail, required
)
values
  ('lead_pc', 'interactionHistory', 'Interaction history', 'text', true, 65,
   false, false, false, false),
  ('lead_health', 'interactionHistory', 'Interaction history', 'text', true, 65,
   false, false, false, false)
on conflict (scope, key) do nothing;

-- Verification: expect one visible system column per lead scope.
select scope, key, label, position, is_system, hidden_default
from table_column
where scope in ('lead_pc', 'lead_health')
  and key = 'interactionHistory'
  and archived_at is null
order by scope;
