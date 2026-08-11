-- Scratch-only Config option position test.
-- Run with ON_ERROR_STOP=1 after supabase/schema.sql in a disposable database.
begin;

insert into public.table_column (scope, key, label, type, is_system, position)
values ('cs', 'fixture_dropdown', 'Fixture dropdown', 'dropdown', false, 999);

do $$
declare
  column_id uuid;
  first_option jsonb;
  second_option jsonb;
begin
  select id into column_id from public.table_column
  where scope = 'cs' and key = 'fixture_dropdown';
  first_option := public.create_table_column_option(column_id, 'First', '#112233');
  second_option := public.create_table_column_option(column_id, 'Second', '#445566');
  if (first_option ->> 'position')::integer <> 10
    or (second_option ->> 'position')::integer <> 20 then
    raise exception 'default option positions were not allocated atomically';
  end if;
end;
$$;

rollback;
