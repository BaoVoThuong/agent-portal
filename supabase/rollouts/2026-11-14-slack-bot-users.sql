-- =====================================================================
-- Slack Bot (2026-11-14): danh sách người được dùng Slack bot ở #agent_portal
-- và quyền portal quản lý danh sách đó.
--
--   slack_bot.manage  "Slack Bot - Manage"  (mới)  — mở trang /slack-bot
--
-- Quyền dùng bot cấp THEO NGƯỜI (bảng slack_bot_users), không theo role:
-- mỗi account chỉ có đúng một role, và còn phải cấp cho email ngoài portal.
-- Không tick gì = Ask only. Change access / Edit code / Approve bắt buộc gắn
-- account portal.
--
-- Chạy TRƯỚC khi deploy code. Idempotent.
-- =====================================================================

begin;

insert into permissions (key, label, description, group_key, group_label, sort_order)
values (
  'slack_bot.manage',
  'Slack Bot - Manage',
  'Choose who can use the Slack bot in #agent_portal and what each person can ask it to do.',
  'slack_bot',
  'Slack Bot',
  100
)
on conflict (key) do update set
  label = excluded.label,
  description = excluded.description,
  group_key = excluded.group_key,
  group_label = excluded.group_label,
  sort_order = excluded.sort_order;

-- Cấp cho các role đang có Role Manager (hiện chỉ Admin), như các quyền quản trị khác.
insert into role_permissions (role_id, permission_key)
select distinct rp.role_id, 'slack_bot.manage'
from role_permissions rp
where rp.permission_key = 'management.role_manager'
on conflict do nothing;

create table if not exists public.slack_bot_users (
  id uuid primary key default gen_random_uuid(),
  slack_email text not null,
  portal_account_id uuid references public.portal_account(id) on delete cascade,
  can_diagnose boolean not null default false,
  can_change_access boolean not null default false,
  can_edit_code boolean not null default false,
  can_approve boolean not null default false,
  note text,
  created_by_email text not null,
  updated_by_email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint slack_bot_users_email_shape check (slack_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint slack_bot_users_linked_for_write check (
    portal_account_id is not null
    or not (can_change_access or can_edit_code or can_approve)
  )
);

create unique index if not exists slack_bot_users_email_key
  on public.slack_bot_users (lower(btrim(slack_email)));
create index if not exists slack_bot_users_account_idx
  on public.slack_bot_users (portal_account_id);

alter table public.slack_bot_users enable row level security;
revoke all on table public.slack_bot_users from anon, authenticated;

notify pgrst, 'reload schema';

commit;
