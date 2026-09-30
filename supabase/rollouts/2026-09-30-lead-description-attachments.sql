-- Lead create dialog: persistent description and private file metadata.
-- Existing lead rows are left intact. The app accesses this table with the
-- service role only after checking lead-level permissions in the API route.
begin;

alter table public.leads add column if not exists description text;

create table if not exists public.lead_attachments (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null,
  mime_type text,
  size_bytes bigint not null,
  uploaded_by text not null,
  client_request_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists lead_attachments_lead_idx
  on public.lead_attachments (lead_id, created_at);
create unique index if not exists lead_attachments_request_key
  on public.lead_attachments (lead_id, uploaded_by, client_request_id)
  where client_request_id is not null;
alter table public.lead_attachments enable row level security;

commit;
notify pgrst, 'reload schema';
