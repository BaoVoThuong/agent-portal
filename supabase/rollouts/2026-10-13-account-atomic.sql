-- Account Manager writes in one transaction (review 2026-10-12, Codex 2 + 3).
--
-- Before: PATCH /api/admin/users/[id] replaced user_roles, THEN updated
-- portal_account in a second request. If the update failed (e.g. the trigger
-- that blocks deactivating an Agent who still owns Personal leads), the API
-- answered 409 but the role had already changed. The "at least one active
-- Admin" rule was a read before the write, so two concurrent demotions could
-- both pass it.
--
-- Now one RPC per write. Both take the same advisory lock and check the Admin
-- rule AFTER writing, inside the transaction, so a failure rolls everything
-- back. Only adds functions. Run BEFORE deploying the code that calls them.
begin;

create or replace function public.assert_active_admin_remains()
returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- "Admin" is the one role known by name (src/lib/rbac/admin-role.ts).
  if not exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id and r.is_active
    join public.portal_account a on a.id = ur.user_id and a.is_active
    where lower(btrim(r.name)) = 'admin'
  ) then
    raise exception 'LAST_ADMIN';
  end if;
end;
$$;

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

create or replace function public.delete_account_atomic(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('portal_account:admin_invariant', 0));
  -- user_roles rows go with it (on delete cascade).
  delete from public.portal_account where id = p_user_id;
  if not found then
    raise exception 'USER_NOT_FOUND';
  end if;
  perform public.assert_active_admin_remains();
end;
$$;

revoke all on function public.assert_active_admin_remains() from public, anon, authenticated;
revoke all on function public.update_account_atomic(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.update_account_atomic(uuid, jsonb, uuid) to service_role;
revoke all on function public.delete_account_atomic(uuid) from public, anon, authenticated;
grant execute on function public.delete_account_atomic(uuid) to service_role;
notify pgrst, 'reload schema';
commit;
