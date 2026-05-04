-- Run this once in the Supabase SQL editor to set up the database.

create extension if not exists "pgcrypto";

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
