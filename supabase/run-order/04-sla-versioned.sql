begin;
-- Apply after task_sla_rules exists and before deploying the versioned SLA UI.
create or replace function public.save_task_sla_rule_atomic(
  p_priority text, p_category_id uuid, p_duration_minutes integer,
  p_expected_updated_at timestamptz default null, p_has_expected boolean default false
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare existing_row public.task_sla_rules%rowtype; saved_row public.task_sla_rules%rowtype;
begin
  if p_priority not in ('low','medium','high','urgent') or p_duration_minutes is null or p_duration_minutes <= 0 then raise exception 'SLA_RULE_INVALID'; end if;
  select * into existing_row from public.task_sla_rules where priority = p_priority and category_id is not distinct from p_category_id for update;
  if found then
    if not p_has_expected then raise exception 'SLA_RULE_VERSION_REQUIRED'; end if;
    if p_expected_updated_at is null or existing_row.updated_at is distinct from p_expected_updated_at then raise exception 'SLA_RULE_STALE'; end if;
    update public.task_sla_rules set duration_minutes = p_duration_minutes, updated_at = clock_timestamp() where id = existing_row.id returning * into saved_row;
  else
    if p_has_expected and p_expected_updated_at is not null then raise exception 'SLA_RULE_STALE'; end if;
    insert into public.task_sla_rules (priority, category_id, duration_minutes, updated_at) values (p_priority, p_category_id, p_duration_minutes, clock_timestamp()) returning * into saved_row;
  end if;
  return jsonb_build_object('id', saved_row.id, 'priority', saved_row.priority, 'category_id', saved_row.category_id, 'duration_minutes', saved_row.duration_minutes, 'updated_at', saved_row.updated_at);
end; $$;
create or replace function public.delete_task_sla_rule_atomic(
  p_priority text, p_category_id uuid, p_expected_updated_at timestamptz default null, p_has_expected boolean default false
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare existing_row public.task_sla_rules%rowtype;
begin
  if p_priority not in ('low','medium','high','urgent') then raise exception 'SLA_RULE_INVALID'; end if;
  select * into existing_row from public.task_sla_rules where priority = p_priority and category_id is not distinct from p_category_id for update;
  if not found then if p_expected_updated_at is not null then raise exception 'SLA_RULE_STALE'; end if; return jsonb_build_object('deleted', false); end if;
  if not p_has_expected then raise exception 'SLA_RULE_VERSION_REQUIRED'; end if;
  if p_expected_updated_at is null or existing_row.updated_at is distinct from p_expected_updated_at then raise exception 'SLA_RULE_STALE'; end if;
  delete from public.task_sla_rules where id = existing_row.id;
  return jsonb_build_object('deleted', true);
end; $$;
revoke all on function public.save_task_sla_rule_atomic(text, uuid, integer, timestamptz, boolean) from public, anon, authenticated;
revoke all on function public.delete_task_sla_rule_atomic(text, uuid, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.save_task_sla_rule_atomic(text, uuid, integer, timestamptz, boolean) to service_role;
grant execute on function public.delete_task_sla_rule_atomic(text, uuid, timestamptz, boolean) to service_role;
commit;
