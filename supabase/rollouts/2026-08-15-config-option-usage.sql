-- Apply outside a transaction so the GIN indexes can be built concurrently.
create index concurrently if not exists tasks_custom_values_active_gin_idx
  on public.tasks using gin (custom_values jsonb_path_ops)
  where archived_at is null;

create index concurrently if not exists enrollment_records_custom_values_active_gin_idx
  on public.enrollment_records using gin (custom_values jsonb_path_ops)
  where archived_at is null;

create or replace function public.table_column_option_usage_count(
  p_column_id uuid,
  p_option_id uuid
)
returns bigint
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  column_row public.table_column%rowtype;
  usage_count bigint;
begin
  select * into column_row
  from public.table_column
  where id = p_column_id
    and archived_at is null
    and not is_system
    and type = 'dropdown';
  if not found then raise exception 'CONFIG_OPTION_NOT_FOUND'; end if;
  if not exists (
    select 1 from public.table_column_option option_row
    where option_row.id = p_option_id
      and option_row.column_id = p_column_id
      and option_row.archived_at is null
  ) then raise exception 'CONFIG_OPTION_NOT_FOUND'; end if;

  if column_row.scope = 'cs' then
    select count(*)::bigint into usage_count
    from public.tasks
    where archived_at is null
      and custom_values @> jsonb_build_object(column_row.key, p_option_id::text);
  else
    select count(*)::bigint into usage_count
    from public.enrollment_records
    where archived_at is null
      and program = column_row.scope
      and custom_values @> jsonb_build_object(column_row.key, p_option_id::text);
  end if;
  return usage_count;
end;
$$;

revoke all on function public.table_column_option_usage_count(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.table_column_option_usage_count(uuid, uuid)
  to service_role;

create or replace function public.enrollment_option_usage_count(p_option_id uuid)
returns bigint
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  option_program text;
  usage_count bigint;
begin
  select option_set.program into option_program
  from public.enrollment_options option_row
  join public.enrollment_option_sets option_set on option_set.id = option_row.set_id
  where option_row.id = p_option_id
    and option_row.archived_at is null;
  if not found then raise exception 'CONFIG_OPTION_NOT_FOUND'; end if;

  select count(*)::bigint into usage_count
  from public.enrollment_records record_row
  where record_row.archived_at is null
    and record_row.program = option_program
    and (
      record_row.stage_id = p_option_id
      or record_row.carrier_id = p_option_id
      or record_row.platform_id = p_option_id
      or record_row.consent_id = p_option_id
      or record_row.payment_status_id = p_option_id
      or record_row.aca_status_id = p_option_id
    );
  return usage_count;
end;
$$;

revoke all on function public.enrollment_option_usage_count(uuid)
  from public, anon, authenticated;
grant execute on function public.enrollment_option_usage_count(uuid)
  to service_role;
