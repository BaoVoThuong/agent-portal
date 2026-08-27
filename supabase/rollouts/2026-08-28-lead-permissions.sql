-- Lead Management: add the permissions used by the Next.js routes.
-- Admin receives these new permissions; regular Agent remains opt-in so a
-- role manager can decide who may work or manage lead data.

insert into permissions (key, label, description, group_key, group_label, sort_order)
values
  ('lead.manage', 'Manage Leads', 'Import leads, assign them, and see every agent''s queue.', 'leads', 'Lead Management', 100),
  ('lead.work', 'Work Leads', 'See and log interactions on leads assigned to you.', 'leads', 'Lead Management', 200),
  ('lead.export', 'Export Leads', 'Download the lead table as a spreadsheet.', 'leads', 'Lead Management', 300)
on conflict (key) do update set
  label = excluded.label,
  description = excluded.description,
  group_key = excluded.group_key,
  group_label = excluded.group_label,
  sort_order = excluded.sort_order;

insert into role_permissions (role_id, permission_key)
select roles.id, permissions.key
from roles
cross join permissions
where roles.name = 'Admin'
  and permissions.key in ('lead.manage', 'lead.work', 'lead.export')
on conflict (role_id, permission_key) do nothing;
