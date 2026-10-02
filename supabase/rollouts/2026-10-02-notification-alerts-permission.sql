-- =====================================================================
-- Notification Alerts — RBAC permission and idempotent preference tables.
-- Run this rollout before deploying the application code.
-- =====================================================================

begin;

insert into permissions (key, label, description, group_key, group_label, sort_order)
values (
  'management.notification_alerts',
  'Notification Alerts',
  'Turn notification sounds, pop-ups and push on or off for each user. Mentions and assignments still alert.',
  'management',
  'Management',
  150
)
on conflict (key) do update set
  label = excluded.label,
  description = excluded.description,
  group_key = excluded.group_key,
  group_label = excluded.group_label,
  sort_order = excluded.sort_order;

insert into role_permissions (role_id, permission_key)
select r.id, 'management.notification_alerts'
from roles r
where r.name = 'Admin'
on conflict (role_id, permission_key) do nothing;

create table if not exists push_subscriptions (
  endpoint text primary key,
  recipient_email text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  failure_count integer not null default 0
);

create index if not exists push_subscriptions_recipient_idx
  on push_subscriptions (recipient_email);

create table if not exists notification_preferences (
  email text primary key,
  push_enabled boolean not null default true,
  sound_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by_email text
);

alter table push_subscriptions enable row level security;
alter table notification_preferences enable row level security;

commit;

select key, label, sort_order
from permissions
where key = 'management.notification_alerts';

select r.name as role, rp.permission_key
from role_permissions rp
join roles r on r.id = rp.role_id
where rp.permission_key = 'management.notification_alerts';

notify pgrst, 'reload schema';
