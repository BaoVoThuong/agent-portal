-- =====================================================================
-- Restore access + notification inputs from snapshot __LABEL__ taken by
-- 2026-10-16-access-backup.sql. Run 2026-10-16-access-restore-preview.sql
-- FIRST: this puts every listed table back exactly as it was, including any
-- deliberate admin change made after the backup.
--
-- Restores: portal_account (is_active, agent_id, position_id, manager_id),
-- roles (name, is_active, is_default), role_permissions, user_roles,
-- task_agents, agent_members, task_assignment_queue_members,
-- notification_preferences. Re-creates Positions deleted since the backup.
-- Does not touch tasks, leads, enrollments, Time Off or notifications sent.
--
-- One transaction: any error (a role or account deleted since the backup,
-- an Agent ID now used by someone else, no Admin left) undoes everything.
-- App caches (RBAC, membership) expire on their own within minutes.
-- =====================================================================

begin;

-- Same locks the app's account and membership writes take.
select pg_advisory_xact_lock(hashtextextended('portal_account:admin_invariant', 0));
select pg_advisory_xact_lock(hashtextextended('assistant-memberships', 0));

do $$
begin
  if not exists (select 1 from access_backup.snapshots where label = '__LABEL__') then
    raise exception 'BACKUP_LABEL_NOT_FOUND';
  end if;
end $$;

insert into public.positions (id, name, kind, system_key)
select id, name, kind, system_key from access_backup.positions where label = '__LABEL__'
on conflict (id) do nothing;

update public.roles r
set name = b.name, is_active = b.is_active, is_default = b.is_default, updated_at = now()
from access_backup.roles b
where b.label = '__LABEL__' and b.id = r.id
  and (r.name, r.is_active, r.is_default) is distinct from (b.name, b.is_active, b.is_default);

delete from public.role_permissions
where role_id in (select id from access_backup.roles where label = '__LABEL__');
insert into public.role_permissions (role_id, permission_key)
select role_id, permission_key from access_backup.role_permissions where label = '__LABEL__';

update public.portal_account a
set is_active = b.is_active, agent_id = b.agent_id,
    position_id = b.position_id, manager_id = b.manager_id
from access_backup.portal_account b
where b.label = '__LABEL__' and b.id = a.id
  and (a.is_active, a.agent_id, a.position_id, a.manager_id)
      is distinct from (b.is_active, b.agent_id, b.position_id, b.manager_id);

delete from public.user_roles
where user_id in (select id from access_backup.portal_account where label = '__LABEL__');
insert into public.user_roles (user_id, role_id, created_at)
select user_id, role_id, created_at from access_backup.user_roles where label = '__LABEL__';

delete from public.task_agents;
insert into public.task_agents (email, created_at)
select email, created_at from access_backup.task_agents where label = '__LABEL__';

delete from public.agent_members;
insert into public.agent_members (agent_email, cs_email, is_assistant, created_at)
select agent_email, cs_email, is_assistant, created_at from access_backup.agent_members where label = '__LABEL__';

delete from public.task_assignment_queue_members;
insert into public.task_assignment_queue_members (email, is_enabled, updated_by_email, updated_at)
select email, is_enabled, updated_by_email, updated_at
from access_backup.task_assignment_queue_members where label = '__LABEL__';

delete from public.notification_preferences;
insert into public.notification_preferences
select (jsonb_populate_record(null::public.notification_preferences, row_data)).*
from access_backup.notification_preferences where label = '__LABEL__';

select public.assert_active_admin_remains();

commit;

notify pgrst, 'reload schema';
