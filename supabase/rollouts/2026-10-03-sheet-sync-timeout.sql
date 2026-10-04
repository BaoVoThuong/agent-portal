-- Health Mart sync promotes an entire Sheet partition in one transaction.
-- At 17k+ rows, the default service_role statement timeout can cancel that
-- promotion even though all rows already reached sheet_sync_staging.
--
-- This is deliberately a role setting: changing statement_timeout inside
-- finalize_sheet_sync() is too late because the timer began before the RPC
-- entered the function. New service_role connections pick this up on their
-- next request — after the PostgREST reload below.
--
-- Run once in Supabase SQL Editor as the database administrator.

alter role service_role set statement_timeout = '120s';

-- PostgREST (the API datasync calls) caches each role's settings and applies
-- them per request. Without this reload it keeps cutting finalize_sheet_sync
-- at the old ~8s limit even though the role setting above is saved.
notify pgrst, 'reload config';

-- Confirm the persisted setting without exposing any credentials.
select coalesce(
  (
    select config.setting
    from pg_db_role_setting setting_row
    join pg_roles role_row on role_row.oid = setting_row.setrole
    cross join lateral unnest(setting_row.setconfig) as config(setting)
    where role_row.rolname = 'service_role'
      and config.setting like 'statement_timeout=%'
    limit 1
  ),
  'statement_timeout is not configured'
) as service_role_statement_timeout;
