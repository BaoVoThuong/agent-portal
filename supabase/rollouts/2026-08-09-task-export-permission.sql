-- Idempotent production rollout for the task.export permission.
-- Run this file as one session in Supabase SQL Editor or psql.

begin;

insert into permissions (key, label, description, group_key, group_label, sort_order)
values (
  'task.export',
  'Tasks - Export',
  'Export task and enrollment tables to Excel. Required on its own — a manager role alone does not grant export.',
  'tasks',
  'Tasks',
  300
)
on conflict (key) do update
  set label = excluded.label,
      description = excluded.description,
      group_key = excluded.group_key,
      group_label = excluded.group_label,
      sort_order = excluded.sort_order;

-- The catalogue row alone grants nobody. Grant only the seeded Admin role;
-- deployment owners can grant any environment-specific task-admin roles via
-- Role Manager after reviewing them.
insert into role_permissions (role_id, permission_key)
select r.id, 'task.export'
from roles r
where r.name = 'Admin'
on conflict (role_id, permission_key) do nothing;

commit;

-- Verification: expected seeded grant is exactly Admin.
select r.name
from role_permissions rp
join roles r on r.id = rp.role_id
where rp.permission_key = 'task.export'
order by r.name;

-- Review environment-specific task-admin roles before granting in Role Manager.
select name
from roles
where name in ('Admin Health Task', 'Task Admin')
order by name;

-- Name every active account that will lose export after deployment.
select
  a.email,
  coalesce(string_agg(r.name, ', ' order by r.name), '(no roles)') as roles
from portal_account a
left join user_roles ur on ur.user_id = a.id
left join roles r on r.id = ur.role_id
where a.is_active
  and a.id not in (
    select ur2.user_id
    from user_roles ur2
    join role_permissions rp on rp.role_id = ur2.role_id
    where rp.permission_key = 'task.export'
  )
group by a.email
order by a.email;
