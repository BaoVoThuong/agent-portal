-- =====================================================================
-- Org chart access: tách quyền xem sơ đồ khỏi quyền thay đổi reporting line.
--
-- View Org Chart: nhân viên xem được cấu trúc công ty.
-- Manage Org Chart: HR/admin đổi trực tiếp manager của một người.
--
-- Giữ tương thích các role đang có management.account_manager: họ từng sửa
-- được sơ đồ ở Account Manager, nên chuyển thẳng sang cả hai quyền mới.
-- =====================================================================

insert into permissions (key, label, description, group_key, group_label, sort_order)
values
  ('people.org_chart_view', 'View Org Chart', 'View the organization chart and reporting lines.', 'people', 'People', 100),
  ('people.org_chart_manage', 'Manage Org Chart', 'Update reporting lines in the organization chart.', 'people', 'People', 200)
on conflict (key) do update set
  label = excluded.label,
  description = excluded.description,
  group_key = excluded.group_key,
  group_label = excluded.group_label,
  sort_order = excluded.sort_order;

-- Mọi Agent mặc định xem được sơ đồ như một team directory; Admin có cả hai.
insert into role_permissions (role_id, permission_key)
select roles.id, 'people.org_chart_view'
from roles
where roles.name in ('Admin', 'Agent')
on conflict (role_id, permission_key) do nothing;

insert into role_permissions (role_id, permission_key)
select roles.id, 'people.org_chart_manage'
from roles
where roles.name = 'Admin'
on conflict (role_id, permission_key) do nothing;

-- Custom role đã được giao Account Manager giữ nguyên quyền quản lý vừa có.
insert into role_permissions (role_id, permission_key)
select distinct existing.role_id, 'people.org_chart_view'
from role_permissions existing
where existing.permission_key = 'management.account_manager'
on conflict (role_id, permission_key) do nothing;

insert into role_permissions (role_id, permission_key)
select distinct existing.role_id, 'people.org_chart_manage'
from role_permissions existing
where existing.permission_key = 'management.account_manager'
on conflict (role_id, permission_key) do nothing;

-- Kiểm chứng: Admin có cả hai; Agent có quyền xem; account manager không mất
-- quyền sửa khi UI chuyển sang màn People độc lập.
select
  exists (
    select 1 from role_permissions rp join roles r on r.id = rp.role_id
    where r.name = 'Admin' and rp.permission_key = 'people.org_chart_view'
  ) as admin_can_view,
  exists (
    select 1 from role_permissions rp join roles r on r.id = rp.role_id
    where r.name = 'Admin' and rp.permission_key = 'people.org_chart_manage'
  ) as admin_can_manage,
  exists (
    select 1 from role_permissions rp join roles r on r.id = rp.role_id
    where r.name = 'Agent' and rp.permission_key = 'people.org_chart_view'
  ) as agent_can_view,
  not exists (
    select 1 from role_permissions old_permission
    where old_permission.permission_key = 'management.account_manager'
      and not exists (
        select 1 from role_permissions new_permission
        where new_permission.role_id = old_permission.role_id
          and new_permission.permission_key = 'people.org_chart_manage'
      )
  ) as existing_account_managers_can_manage;
