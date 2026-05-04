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
