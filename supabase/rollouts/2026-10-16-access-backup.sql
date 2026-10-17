-- =====================================================================
-- Backup of everything that decides access and notification audiences,
-- taken before each Position stage (plan 2026-10-16-account-position-
-- unification.md). Restore with 2026-10-16-access-restore.sql.
--
-- Copies, under one snapshot label: portal_account (no password_hash),
-- roles, role_permissions, user_roles, task_agents, agent_members,
-- task_assignment_queue_members, notification_preferences, positions.
--
-- Schema access_backup is not exposed by PostgREST and is closed to anon /
-- authenticated. Replace __LABEL__ before running (e.g. before-s2).
-- Running twice with the same label is refused.
-- =====================================================================

begin;

create schema if not exists access_backup;
revoke all on schema access_backup from public, anon, authenticated;

create table if not exists access_backup.snapshots (
  label text primary key,
  taken_at timestamptz not null default now(),
  note text
);

create table if not exists access_backup.portal_account (
  label text not null, id uuid not null, email text not null, name text,
  is_active boolean not null, agent_id text, position_id uuid, manager_id uuid,
  primary key (label, id)
);
create table if not exists access_backup.roles (
  label text not null, id uuid not null, name text not null, description text,
  is_system boolean not null, is_active boolean not null, is_default boolean not null,
  primary key (label, id)
);
create table if not exists access_backup.role_permissions (
  label text not null, role_id uuid not null, permission_key text not null,
  primary key (label, role_id, permission_key)
);
create table if not exists access_backup.user_roles (
  label text not null, user_id uuid not null, role_id uuid not null, created_at timestamptz,
  primary key (label, user_id, role_id)
);
create table if not exists access_backup.task_agents (
  label text not null, email text not null, created_at timestamptz,
  primary key (label, email)
);
create table if not exists access_backup.agent_members (
  label text not null, agent_email text not null, cs_email text not null,
  is_assistant boolean not null, created_at timestamptz,
  primary key (label, agent_email, cs_email)
);
create table if not exists access_backup.task_assignment_queue_members (
  label text not null, email text not null, is_enabled boolean not null,
  updated_by_email text, updated_at timestamptz,
  primary key (label, email)
);
create table if not exists access_backup.notification_preferences (
  label text not null, email text not null, row_data jsonb not null,
  primary key (label, email)
);
create table if not exists access_backup.positions (
  label text not null, id uuid not null, name text not null, kind text not null,
  system_key text, primary key (label, id)
);

revoke all on all tables in schema access_backup from public, anon, authenticated;

insert into access_backup.snapshots (label, note)
values ('__LABEL__', 'Position unification stage backup');

insert into access_backup.portal_account
select '__LABEL__', id, email, name, is_active, agent_id, position_id, manager_id
from public.portal_account;

insert into access_backup.roles
select '__LABEL__', id, name, description, is_system, is_active, is_default
from public.roles;

insert into access_backup.role_permissions
select '__LABEL__', role_id, permission_key from public.role_permissions;

insert into access_backup.user_roles
select '__LABEL__', user_id, role_id, created_at from public.user_roles;

insert into access_backup.task_agents
select '__LABEL__', email, created_at from public.task_agents;

insert into access_backup.agent_members
select '__LABEL__', agent_email, cs_email, is_assistant, created_at from public.agent_members;

insert into access_backup.task_assignment_queue_members
select '__LABEL__', email, is_enabled, updated_by_email, updated_at
from public.task_assignment_queue_members;

insert into access_backup.notification_preferences
select '__LABEL__', n.email, to_jsonb(n) from public.notification_preferences n;

insert into access_backup.positions
select '__LABEL__', id, name, kind, system_key from public.positions;

commit;

-- Verify: each backup count equals its live table.
select
  (select count(*) from access_backup.portal_account where label = '__LABEL__') = (select count(*) from public.portal_account) as accounts_ok,
  (select count(*) from access_backup.roles where label = '__LABEL__') = (select count(*) from public.roles) as roles_ok,
  (select count(*) from access_backup.role_permissions where label = '__LABEL__') = (select count(*) from public.role_permissions) as role_permissions_ok,
  (select count(*) from access_backup.user_roles where label = '__LABEL__') = (select count(*) from public.user_roles) as user_roles_ok,
  (select count(*) from access_backup.task_agents where label = '__LABEL__') = (select count(*) from public.task_agents) as task_agents_ok,
  (select count(*) from access_backup.agent_members where label = '__LABEL__') = (select count(*) from public.agent_members) as agent_members_ok,
  (select count(*) from access_backup.task_assignment_queue_members where label = '__LABEL__') = (select count(*) from public.task_assignment_queue_members) as queue_ok,
  (select count(*) from access_backup.notification_preferences where label = '__LABEL__') = (select count(*) from public.notification_preferences) as notification_preferences_ok,
  (select count(*) from access_backup.positions where label = '__LABEL__') = (select count(*) from public.positions) as positions_ok;
