-- Rollback for 2026-10-16-account-position-write.sql: the CS Manager guard
-- and update_account_atomic as it was before (body read from production
-- 2026-10-16). Deploy the code that no longer sends position_id /
-- assisted_agent_emails / manager_id / expected FIRST. Data written through
-- the new form (Position, task_agents, agent_members) is restored separately
-- with 2026-10-16-access-restore.sql, label before-s2, if needed.

begin;

drop trigger if exists cs_manager_guard_role_permissions on public.role_permissions;
drop trigger if exists cs_manager_guard_roles on public.roles;
drop trigger if exists cs_manager_guard_user_roles on public.user_roles;
drop trigger if exists cs_manager_guard_portal_account on public.portal_account;
drop function if exists public.cs_manager_task_manage_guard();
drop function if exists public.assert_cs_managers_have_task_manage();

create or replace function public.update_account_atomic(
  p_user_id uuid,
  p_patch jsonb,
  p_role_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  result jsonb;
begin
  -- Every write that can remove an Admin takes this lock, so two concurrent
  -- demotions cannot both see "another Admin remains".
  perform pg_advisory_xact_lock(hashtextextended('portal_account:admin_invariant', 0));

  p_patch := coalesce(p_patch, '{}'::jsonb);
  update public.portal_account set
    email = case when p_patch ? 'email' then p_patch->>'email' else email end,
    name = case when p_patch ? 'name' then p_patch->>'name' else name end,
    agent_id = case when p_patch ? 'agent_id' then p_patch->>'agent_id' else agent_id end,
    is_active = case when p_patch ? 'is_active' then (p_patch->>'is_active')::boolean else is_active end,
    password_hash = case when p_patch ? 'password_hash' then p_patch->>'password_hash' else password_hash end
  where id = p_user_id;
  if not found then
    raise exception 'USER_NOT_FOUND';
  end if;

  if p_role_id is not null then
    perform public.replace_user_roles(p_user_id, array[p_role_id]);
  end if;

  perform public.assert_active_admin_remains();

  select jsonb_build_object(
           'id', a.id, 'email', a.email, 'name', a.name, 'agent_id', a.agent_id,
           'is_active', a.is_active, 'created_at', a.created_at)
    into result
  from public.portal_account a
  where a.id = p_user_id;
  return result;
end;
$$;

revoke all on function public.update_account_atomic(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.update_account_atomic(uuid, jsonb, uuid) to service_role;

commit;

notify pgrst, 'reload schema';
