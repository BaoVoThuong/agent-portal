-- Lead Management: widen the table-config scope constraints.
--
-- TABLE_SCOPES in src/lib/table-config/types.ts gained 'lead_pc' and
-- 'lead_health', but nothing widened the matching CHECK constraints, so the
-- first visit to /leads failed at ensureTableColumns():
--
--   new row for relation "table_column" violates check constraint
--   "table_column_scope_check"
--
-- Three tables carry the same enum. Widening only table_column would move the
-- failure to whichever screen writes a layout or an import request next, so all
-- three change together.
--
-- Forward-only and idempotent: each constraint is dropped by name if present,
-- then recreated with the full list.

do $$
declare
  target record;
begin
  for target in
    select unnest(array['table_column', 'user_table_layout', 'import_request']) as table_name
  loop
    execute format(
      'alter table %I drop constraint if exists %I',
      target.table_name, target.table_name || '_scope_check'
    );
    execute format(
      'alter table %I add constraint %I check (scope in (%L, %L, %L, %L, %L))',
      target.table_name, target.table_name || '_scope_check',
      'cs', 'aca', 'medicare', 'lead_pc', 'lead_health'
    );
  end loop;
end $$;

-- Verification. Expect three rows, each listing all five scopes.
select
  rel.relname as table_name,
  pg_get_constraintdef(con.oid) as constraint_definition
from pg_constraint as con
join pg_class as rel on rel.oid = con.conrelid
where con.conname in (
  'table_column_scope_check',
  'user_table_layout_scope_check',
  'import_request_scope_check'
)
order by rel.relname;
