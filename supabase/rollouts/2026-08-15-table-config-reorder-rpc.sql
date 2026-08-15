-- Apply outside an explicit transaction. The function is additive and can be
-- installed before the application route starts sending the new wire contract.
create or replace function public.reorder_table_columns_atomic(
  p_scope text,
  p_expected_column_keys text[],
  p_column_keys text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_keys text[] := array[]::text[];
  active_count integer := 0;
  duplicate_count integer := 0;
begin
  if p_scope not in ('cs', 'aca', 'medicare')
    or p_expected_column_keys is null
    or p_column_keys is null then
    raise exception 'COLUMN_ORDER_INVALID';
  end if;
  if exists (select 1 from unnest(p_expected_column_keys) requested(value) where requested.value is null or btrim(requested.value) = '')
    or exists (select 1 from unnest(p_column_keys) requested(value) where requested.value is null or btrim(requested.value) = '') then
    raise exception 'COLUMN_ORDER_INVALID';
  end if;
  select count(*) into duplicate_count from (
    select value from unnest(p_column_keys) requested(value) group by value having count(*) > 1
  ) duplicates;
  if duplicate_count > 0 then raise exception 'COLUMN_ORDER_INVALID'; end if;
  perform 1 from public.table_column column_row
    where column_row.scope = p_scope and column_row.archived_at is null
    order by column_row.id for update;
  select count(*) into active_count from public.table_column column_row
    where column_row.scope = p_scope and column_row.archived_at is null;
  if cardinality(p_column_keys) <> active_count or cardinality(p_expected_column_keys) <> active_count
    or exists (select 1 from unnest(p_column_keys) requested(value)
      where not exists (select 1 from public.table_column column_row
        where column_row.scope = p_scope and column_row.archived_at is null and column_row.key = requested.value)) then
    raise exception 'COLUMN_ORDER_INVALID';
  end if;
  select coalesce(array_agg(column_row.key order by column_row.position, column_row.label, column_row.key), array[]::text[])
    into current_keys from public.table_column column_row
    where column_row.scope = p_scope and column_row.archived_at is null;
  if current_keys is distinct from p_expected_column_keys then raise exception 'COLUMN_ORDER_STALE'; end if;
  update public.table_column column_row
    set position = desired.position, updated_at = clock_timestamp()
    from unnest(p_column_keys) with ordinality as desired(key, position)
    where column_row.scope = p_scope and column_row.archived_at is null and column_row.key = desired.key;
  return jsonb_build_object('scope', p_scope, 'column_keys', coalesce(
    (select jsonb_agg(column_row.key order by column_row.position, column_row.label, column_row.key)
      from public.table_column column_row where column_row.scope = p_scope and column_row.archived_at is null), '[]'::jsonb));
end;
$$;
revoke all on function public.reorder_table_columns_atomic(text, text[], text[]) from public, anon, authenticated;
grant execute on function public.reorder_table_columns_atomic(text, text[], text[]) to service_role;
