-- READ-ONLY production ACL audit for datasync SECURITY DEFINER routines.
-- Run with a privileged, read-only connection:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f datasync/security-definer-acl-audit.sql
--
-- A healthy deployment has no anon/authenticated EXECUTE privilege on a
-- SECURITY DEFINER routine. These functions are called by the server sync
-- process with service_role; exposing them through PostgREST would bypass the
-- application authorization boundary.
select
  p.oid::regprocedure::text as signature,
  has_function_privilege('anon', p.oid, 'execute') as anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_execute,
  has_function_privilege('service_role', p.oid, 'execute') as service_role_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef
order by signature;
