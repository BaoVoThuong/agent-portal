-- First Google sign-in creates the account WITHOUT a role (user decision
-- 2026-10-17). The account has no permissions and lands on /unauthorized
-- ("No Access") until an admin sets its Accessibility in Account Manager.
-- Before: it got the default role (Agent, 7 permissions).
--
-- Keeps the function name so the deployed code (src/auth.ts) works unchanged.
-- Clears roles.is_default: no role is the default any more, so Agent can be
-- deleted like any other role. The column and roles_single_default_idx stay
-- (deployed code still reads is_default).
-- Rollback: 2026-10-17-signup-without-role.rollback.sql
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
  new_user_id uuid;
begin
  insert into public.portal_account (email, name, password_hash, is_active)
  values (p_email, p_name, 'google-auth', true)
  returning id into new_user_id;

  return new_user_id;
end;
$$;

revoke all on function public.create_account_with_default_role(text, text) from public, anon, authenticated;
grant execute on function public.create_account_with_default_role(text, text) to service_role;

update public.roles set is_default = false, updated_at = now() where is_default;

notify pgrst, 'reload schema';
commit;

-- Check (expect: 0 default roles; function no longer touches user_roles)
select count(*) as default_roles from public.roles where is_default;
select position('user_roles' in pg_get_functiondef('public.create_account_with_default_role(text,text)'::regprocedure)) = 0
  as signup_assigns_no_role;
