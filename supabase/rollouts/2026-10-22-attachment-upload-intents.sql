-- Run before deploying the 50 MiB direct-upload code. This table is the
-- durable bridge between a browser upload and its attachment metadata row.
-- The app service role is the only reader/writer; no user can forge an intent.
create table if not exists attachment_upload_intents (
  kind text not null check (kind in ('task', 'enrollment', 'lead')),
  record_id uuid not null,
  uploaded_by text not null,
  client_request_id uuid not null,
  comment_id uuid,
  file_name text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 52428800),
  storage_path text not null,
  silent boolean not null default false,
  created_at timestamptz not null default now(),
  next_check_at timestamptz not null default now(),
  completed_at timestamptz,
  failed_at timestamptz,
  failure_reason text,
  primary key (kind, record_id, uploaded_by, client_request_id)
);

create unique index if not exists attachment_upload_intents_path_key
  on attachment_upload_intents (storage_path);
create index if not exists attachment_upload_intents_pending_idx
  on attachment_upload_intents (kind, record_id, next_check_at, created_at)
  where completed_at is null and failed_at is null;

alter table attachment_upload_intents enable row level security;
revoke all on attachment_upload_intents from public, anon, authenticated;
grant select, insert, update, delete on attachment_upload_intents to service_role;
