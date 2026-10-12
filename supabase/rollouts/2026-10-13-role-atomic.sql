-- Role Manager writes in one transaction (review 2026-10-12, Codex 3).
-- Before: POST inserted the role, then replaced its permissions in a second
-- request — a failure left a role with no permissions; PATCH could rename or
-- disable a role and then fail on its permissions. Only adds functions. Run
-- BEFORE deploying the code that calls them.
begin;

create or replace function public.create_role_atomic(
  p_name text,
  p_description text,
  p_is_active boolean,
  p_permission_keys text[]
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  new_role_id uuid;
begin
  insert into public.roles (name, description, is_active, is_system)
  values (p_name, p_description, coalesce(p_is_active, true), false)
  returning id into new_role_id;

  perform public.replace_role_permissions(new_role_id, p_permission_keys);
  return new_role_id;
end;
$$;

create or replace function public.update_role_atomic(
  p_role_id uuid,
  p_patch jsonb,
  p_permission_keys text[]
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  p_patch := coalesce(p_patch, '{}'::jsonb);
  update public.roles set
    name = case when p_patch ? 'name' then p_patch->>'name' else name end,
    description = case when p_patch ? 'description' then p_patch->>'description' else description end,
    is_active = case when p_patch ? 'is_active' then (p_patch->>'is_active')::boolean else is_active end,
    updated_at = now()
  where id = p_role_id;
  if not found then
    raise exception 'ROLE_NOT_FOUND';
  end if;

  -- null = permissions unchanged; an empty array clears them.
  if p_permission_keys is not null then
    perform public.replace_role_permissions(p_role_id, p_permission_keys);
  end if;
end;
$$;

revoke all on function public.create_role_atomic(text, text, boolean, text[]) from public, anon, authenticated;
grant execute on function public.create_role_atomic(text, text, boolean, text[]) to service_role;
revoke all on function public.update_role_atomic(uuid, jsonb, text[]) from public, anon, authenticated;
grant execute on function public.update_role_atomic(uuid, jsonb, text[]) to service_role;
notify pgrst, 'reload schema';
commit;
