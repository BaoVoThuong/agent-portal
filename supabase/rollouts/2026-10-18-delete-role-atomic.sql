-- Run before deploying the route that calls delete_role_atomic.
-- Moving every holder and deleting the source role is one transaction.
begin;

create or replace function public.delete_role_atomic(
  p_role_id uuid,
  p_move_to_role_id uuid,
  p_actor_email text
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source public.roles%rowtype;
  v_target public.roles%rowtype;
  v_actor_permissions text[];
  v_holders integer;
  v_moved integer := 0;
begin
  -- Role writes lock the same rows. The FK lock on roles also prevents a new
  -- user_roles link to the source while it is being moved and deleted.
  perform 1 from public.roles
  where id in (p_role_id, p_move_to_role_id)
  order by id for update;

  select * into v_source from public.roles where id = p_role_id;
  if not found then raise exception 'ROLE_NOT_FOUND'; end if;
  if lower(btrim(v_source.name)) = 'admin' then
    raise exception 'ROLE_PROTECTED';
  end if;

  select coalesce(array_agg(distinct rp.permission_key), array[]::text[])
    into v_actor_permissions
  from public.portal_account a
  join public.user_roles ur on ur.user_id = a.id
  join public.roles r on r.id = ur.role_id and r.is_active
  join public.role_permissions rp on rp.role_id = r.id
  where lower(btrim(a.email)) = lower(btrim(p_actor_email)) and a.is_active;
  if not ('management.role_manager' = any(v_actor_permissions)) then
    raise exception 'ROLE_MANAGER_REQUIRED';
  end if;

  select count(*) into v_holders from public.user_roles where role_id = p_role_id;
  if v_holders > 0 then
    if p_move_to_role_id is null or p_move_to_role_id = p_role_id then
      raise exception 'ROLE_STILL_HELD';
    end if;
    select * into v_target from public.roles where id = p_move_to_role_id;
    if not found or not v_target.is_active then
      raise exception 'ROLE_MOVE_TARGET_INVALID';
    end if;
    -- Moving holders also touches their current access, so enforce the same
    -- ceiling on the source role as Account Manager uses for an account.
    if exists (
      select 1 from public.role_permissions rp
      where rp.role_id = p_role_id
        and rp.permission_key <> 'settings.access'
        and not (
          rp.permission_key = any(v_actor_permissions)
          or (rp.permission_key = 'task.work' and 'task.manage' = any(v_actor_permissions))
          or (rp.permission_key = 'lead.work' and 'lead.manage' = any(v_actor_permissions))
        )
    ) then
      raise exception 'ROLE_MOVE_FORBIDDEN';
    end if;
    if exists (
      select 1 from public.role_permissions rp
      where rp.role_id = p_move_to_role_id
        and rp.permission_key <> 'settings.access'
        and not (
          rp.permission_key = any(v_actor_permissions)
          or (rp.permission_key = 'task.work' and 'task.manage' = any(v_actor_permissions))
          or (rp.permission_key = 'lead.work' and 'lead.manage' = any(v_actor_permissions))
        )
    ) then
      raise exception 'ROLE_MOVE_FORBIDDEN';
    end if;

    update public.user_roles
    set role_id = p_move_to_role_id, created_at = now()
    where role_id = p_role_id;
    get diagnostics v_moved = row_count;
  end if;

  delete from public.roles where id = p_role_id;
  perform public.assert_active_admin_remains();
  return v_moved;
end;
$$;

revoke all on function public.delete_role_atomic(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.delete_role_atomic(uuid, uuid, text) to service_role;

commit;
notify pgrst, 'reload schema';
