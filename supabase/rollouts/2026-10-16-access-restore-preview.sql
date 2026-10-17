-- READ ONLY. What 2026-10-16-access-restore.sql would change: rows that differ
-- between snapshot __LABEL__ (access_backup) and the live tables. Run this
-- first; an admin's deliberate change made after the backup shows up here too
-- and would be undone by the restore.
with
live_accounts as (select id, email, is_active, agent_id, position_id, manager_id from public.portal_account),
saved_accounts as (select id, email, is_active, agent_id, position_id, manager_id from access_backup.portal_account where label = '__LABEL__'),
live_ur as (select user_id, role_id from public.user_roles),
saved_ur as (select user_id, role_id from access_backup.user_roles where label = '__LABEL__'),
live_rp as (select role_id, permission_key from public.role_permissions),
saved_rp as (select role_id, permission_key from access_backup.role_permissions where label = '__LABEL__'),
live_roles as (select id, name, is_active, is_default from public.roles),
saved_roles as (select id, name, is_active, is_default from access_backup.roles where label = '__LABEL__'),
live_ta as (select email from public.task_agents),
saved_ta as (select email from access_backup.task_agents where label = '__LABEL__'),
live_am as (select agent_email, cs_email, is_assistant from public.agent_members),
saved_am as (select agent_email, cs_email, is_assistant from access_backup.agent_members where label = '__LABEL__'),
live_q as (select email, is_enabled from public.task_assignment_queue_members),
saved_q as (select email, is_enabled from access_backup.task_assignment_queue_members where label = '__LABEL__'),
live_np as (select n.email, to_jsonb(n) as row_data from public.notification_preferences n),
saved_np as (select email, row_data from access_backup.notification_preferences where label = '__LABEL__')
select jsonb_build_object(
  'snapshot', (select to_jsonb(s) from access_backup.snapshots s where label = '__LABEL__'),
  'portal_account', jsonb_build_object(
    'only_live', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (select * from live_accounts except select * from saved_accounts) x),
    'only_saved', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (select * from saved_accounts except select * from live_accounts) x)),
  'user_roles', jsonb_build_object(
    'only_live', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (select * from live_ur except select * from saved_ur) x),
    'only_saved', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (select * from saved_ur except select * from live_ur) x)),
  'role_permissions', jsonb_build_object(
    'only_live', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (select * from live_rp except select * from saved_rp) x),
    'only_saved', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (select * from saved_rp except select * from live_rp) x)),
  'roles', jsonb_build_object(
    'only_live', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (select * from live_roles except select * from saved_roles) x),
    'only_saved', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (select * from saved_roles except select * from live_roles) x)),
  'task_agents', jsonb_build_object(
    'only_live', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (select * from live_ta except select * from saved_ta) x),
    'only_saved', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (select * from saved_ta except select * from live_ta) x)),
  'agent_members', jsonb_build_object(
    'only_live', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (select * from live_am except select * from saved_am) x),
    'only_saved', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (select * from saved_am except select * from live_am) x)),
  'queue', jsonb_build_object(
    'only_live', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (select * from live_q except select * from saved_q) x),
    'only_saved', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (select * from saved_q except select * from live_q) x)),
  'notification_preferences', jsonb_build_object(
    'only_live', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (select * from live_np except select * from saved_np) x),
    'only_saved', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (select * from saved_np except select * from live_np) x))
) as restore_preview;
