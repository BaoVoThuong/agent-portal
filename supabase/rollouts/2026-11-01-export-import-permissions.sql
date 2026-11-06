-- =====================================================================
-- Quyền Export / Import riêng cho Lead Management và Provider List
-- (2026-11-01), như task.export / task.import.
--
--   lead.export                 "Export Leads"            (mới)
--   lead.import                 "Import Leads"            (mới — trước là lead.manage)
--   automation.provider_export  "Provider List - Export"  (mới — trước là provider_manage)
--   automation.provider_import  "Provider List - Import"  (mới — trước là provider_finder/manage)
--
-- Manage / Work không còn mở Export / Import. Để không ai mất nút đang
-- dùng, cấp quyền mới cho đúng các vai trò đang có quyền cũ:
--   lead.export, lead.import     ← vai trò có lead.manage
--   provider_export              ← vai trò có provider_manage
--   provider_import              ← vai trò có provider_finder hoặc provider_manage
-- Import vẫn đổ vào đâu theo Manage: có Manage → vào thẳng list, không → Backlog.
--
-- BẮT BUỘC chạy trước khi deploy code: role_permissions.permission_key có
-- khoá ngoại tới permissions(key). Idempotent — chạy lại không nhân đôi gì.
-- =====================================================================

begin;

insert into permissions (key, label, description, group_key, group_label, sort_order)
values
  ('lead.export', 'Export Leads', 'Export the leads on screen to Excel.', 'leads', 'Lead Management', 300),
  ('lead.import', 'Import Leads', 'Import leads from Excel and assign them to Agents.', 'leads', 'Lead Management', 350),
  ('automation.provider_export', 'Provider List - Export', 'Export the Provider List to Excel.', 'provider_list', 'Provider List', 300),
  ('automation.provider_import', 'Provider List - Import',
   'Import provider addresses from Excel. Without Provider List - Manage the rows wait in the Backlog for review.',
   'provider_list', 'Provider List', 350)
on conflict (key) do update set
  label = excluded.label,
  description = excluded.description,
  group_key = excluded.group_key,
  group_label = excluded.group_label,
  sort_order = excluded.sort_order;

-- Mô tả cũ nhắc Import / Export trong Manage / Work.
update permissions
set description = 'Assign and manage every lead, Lead settings and the Lead table configuration. Includes Work Leads.'
where key = 'lead.manage';

update permissions
set description = 'Everything in Provider List - Work, plus: add straight to the list, review the Backlog, delete addresses, comment, and change the Provider List columns. Imports land straight in the list.'
where key = 'automation.provider_manage';

update permissions
set description = 'Open the Provider List and its Finder, edit cells, and add addresses into the Backlog for review.'
where key = 'automation.provider_finder';

insert into role_permissions (role_id, permission_key)
select distinct rp.role_id, grant_key
from role_permissions rp
cross join lateral (
  values
    ('lead.manage', 'lead.export'),
    ('lead.manage', 'lead.import'),
    ('automation.provider_manage', 'automation.provider_export'),
    ('automation.provider_manage', 'automation.provider_import'),
    ('automation.provider_finder', 'automation.provider_import')
) as m(source_key, grant_key)
where rp.permission_key = m.source_key
on conflict (role_id, permission_key) do nothing;

commit;

-- Kiểm: 4 dòng quyền, và vai trò nào đang được cấp.
select key, label, group_key, sort_order
from permissions
where key in ('lead.export', 'lead.import', 'automation.provider_export', 'automation.provider_import')
order by group_key, sort_order;

select rp.permission_key, string_agg(r.name, ', ' order by r.name) as roles
from role_permissions rp
join roles r on r.id = rp.role_id
where rp.permission_key in ('lead.export', 'lead.import', 'automation.provider_export', 'automation.provider_import')
group by rp.permission_key
order by rp.permission_key;

notify pgrst, 'reload schema';
