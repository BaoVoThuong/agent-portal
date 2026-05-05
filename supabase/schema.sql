-- Run this once in the Supabase SQL editor to set up the database.

create extension if not exists "pgcrypto";

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text,
  password_hash text,
  role text not null default 'agent',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table users
add column if not exists role text not null default 'agent';

alter table users
add column if not exists is_active boolean not null default true;

alter table users
add column if not exists created_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'users_role_check'
  ) then
    alter table users
    add constraint users_role_check check (role in ('admin', 'agent'));
  end if;
end $$;

create index if not exists users_email_idx on users (email);
create index if not exists users_active_idx on users (is_active);

create table if not exists entries (
  id uuid primary key default gen_random_uuid(),
  agent_email text not null,
  agent_name text,
  carrier_name text not null,
  state text not null,
  zipcode text not null,
  effective_date date not null,
  customer_name text not null,
  policy_id text not null,
  number_of_members integer,
  fub_link text,
  created_at timestamptz not null default now()
);

create index if not exists entries_agent_email_idx on entries (agent_email);
create index if not exists entries_created_at_idx on entries (created_at desc);

create table if not exists health_payment_summary (
  agent text,
  carrier_name text,
  customer_id text,
  customer_name text,
  effective_date text,
  paid_to_date text,
  gross_compensation numeric,
  transaction_id text,
  statement text
);

create index if not exists health_payment_summary_agent_idx
  on health_payment_summary (agent);

alter table health_payment_summary
add column if not exists agent text;

alter table health_payment_summary
add column if not exists carrier_name text;

alter table health_payment_summary
add column if not exists customer_id text;

alter table health_payment_summary
add column if not exists customer_name text;

alter table health_payment_summary
add column if not exists effective_date text;

alter table health_payment_summary
add column if not exists paid_to_date text;

alter table health_payment_summary
add column if not exists gross_compensation numeric;

alter table health_payment_summary
add column if not exists transaction_id text;

alter table health_payment_summary
add column if not exists statement text;

alter table health_payment_summary
drop column if exists id cascade,
drop column if exists run_id cascade,
drop column if exists statement_number cascade,
drop column if exists carrier_input cascade,
drop column if exists month_report cascade,
drop column if exists uploaded_file_name cascade,
drop column if exists source_row_number cascade,
drop column if exists source_row_hash cascade,
drop column if exists source_sheet_name cascade,
drop column if exists raw_row cascade,
drop column if exists synced_at cascade,
drop column if exists created_at cascade,
drop column if exists source_sheet_id cascade,
drop column if exists source_gid cascade;

create or replace function clear_health_payment_summary()
returns void
language sql
security definer
as $$
  truncate table health_payment_summary;
$$;
