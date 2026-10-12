-- First Google sign-in creates the account and gives it the default role in
-- one transaction (review 2026-10-12, Codex 4). Before: an insert error was
-- ignored and the sign-in still succeeded; a failed role assignment left an
-- account with no role that was never retried. Email is stored exactly as
-- Google sends it, as before — the RBAC lookup matches it verbatim.
-- Only adds a function. Run BEFORE deploying the code that calls it.
begin;

create or replace function public.create_account_with_default_role(
  p_email text,
  p_name text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  default_role_id uuid;
  new_user_id uuid;
begin
  -- At most one default role (roles_single_default_idx).
  select id into default_role_id from public.roles where is_default and is_active;
  if default_role_id is null then
    raise exception 'NO_DEFAULT_ROLE';
  end if;

  insert into public.portal_account (email, name, password_hash, is_active)
  values (p_email, p_name, 'google-auth', true)
  returning id into new_user_id;

  insert into public.user_roles (user_id, role_id) values (new_user_id, default_role_id);
  return new_user_id;
end;
$$;

revoke all on function public.create_account_with_default_role(text, text) from public, anon, authenticated;
grant execute on function public.create_account_with_default_role(text, text) to service_role;
notify pgrst, 'reload schema';
commit;
