-- Run this once in the Supabase SQL editor to set up the database.

create extension if not exists "pgcrypto";

do $$
begin
  if to_regclass('public.health_mart') is not null
    and to_regclass('public.health_raw_data') is null then
    alter table public.health_mart rename to health_raw_data;
  end if;
end $$;


create table if not exists portal_account (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text,
  password_hash text,
  role text not null default 'agent',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table portal_account
add column if not exists role text not null default 'agent';

alter table portal_account
add column if not exists is_active boolean not null default true;

alter table portal_account
add column if not exists created_at timestamptz not null default now();

alter table portal_account
add column if not exists agent_id text;

-- agent_id là duy nhất khi có giá trị (account cũ có thể null).
create unique index if not exists portal_account_agent_id_key
  on portal_account (agent_id)
  where agent_id is not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'portal_account_role_check'
  ) then
    alter table portal_account
    add constraint portal_account_role_check check (role in ('admin', 'agent'));
  end if;
end $$;

create index if not exists portal_account_email_idx on portal_account (email);
create index if not exists portal_account_active_idx on portal_account (is_active);

create table if not exists login_attempts (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  ip text,
  success boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists login_attempts_email_idx
  on login_attempts (email, created_at);

create table if not exists roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  is_system boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists permissions (
  key text primary key,
  label text not null,
  description text,
  group_key text not null,
  group_label text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table permissions
add column if not exists description text;

create table if not exists role_permissions (
  role_id uuid not null references roles(id) on delete cascade,
  permission_key text not null references permissions(key) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (role_id, permission_key)
);

create table if not exists user_roles (
  user_id uuid not null references portal_account(id) on delete cascade,
  role_id uuid not null references roles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, role_id)
);

create index if not exists roles_active_idx on roles (is_active);
create index if not exists permissions_group_idx on permissions (group_key, sort_order);
create index if not exists role_permissions_role_idx on role_permissions (role_id);
create index if not exists role_permissions_permission_idx on role_permissions (permission_key);
create index if not exists user_roles_user_idx on user_roles (user_id);
create index if not exists user_roles_role_idx on user_roles (role_id);

create or replace function replace_role_permissions(
  target_role_id uuid,
  permission_keys text[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from role_permissions
  where role_id = target_role_id;

  insert into role_permissions (role_id, permission_key)
  select target_role_id, permission_key
  from unnest(coalesce(permission_keys, array[]::text[])) as permission_key
  on conflict (role_id, permission_key) do nothing;
end;
$$;

create or replace function replace_user_roles(
  target_user_id uuid,
  role_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_role_id uuid;
begin
  select role_id into selected_role_id
  from unnest(coalesce(role_ids, array[]::uuid[])) with ordinality as selected(role_id, sort_order)
  order by sort_order
  limit 1;

  delete from user_roles
  where user_id = target_user_id;

  if selected_role_id is null then
    return;
  end if;

  insert into user_roles (user_id, role_id)
  values (target_user_id, selected_role_id)
  on conflict (user_id) do update set
    role_id = excluded.role_id,
    created_at = now();
end;
$$;

insert into permissions (key, label, description, group_key, group_label, sort_order)
values
  ('customer_registration.health', 'Health Registration', 'View and manage Health registration records.', 'customer_registration', 'Customer Registration', 100),
  ('customer_registration.pc', 'P&C Registration', 'View and manage P&C registration records.', 'customer_registration', 'Customer Registration', 200),
  ('automation.health_statement', 'Health Statement', 'Access and run the Health Statement tool.', 'automation', 'Automation', 100),
  ('automation.pc_statement', 'P&C Statement', 'Access and run the P&C Statement tool.', 'automation', 'Automation', 200),
  ('automation.provider_finder', 'Provider Finder', 'Access and run the Provider Finder tool.', 'automation', 'Automation', 300),
  ('agent_dashboard.health', 'Agent - Health', 'View Health dashboard. Scope limited to own data unless View All Agents is granted.', 'dashboard', 'Dashboard', 100),
  ('agent_dashboard.pc', 'Agent - P&C', 'View P&C dashboard. Scope limited to own data unless View All Agents is granted.', 'dashboard', 'Dashboard', 200),
  ('company_dashboard.health', 'Company - Health', 'View the company-wide Health Sales Dashboard.', 'dashboard', 'Dashboard', 300),
  ('company_dashboard.pc', 'Company - P&C', 'View the company-wide P&C Sales Dashboard.', 'dashboard', 'Dashboard', 400),
  ('company.view_all', 'View All Agents', 'See all agents'' data in Agent Dashboard and Customer Registration.', 'dashboard', 'Dashboard', 500),
  ('management.account_manager', 'Account Manager', 'Create accounts, assign roles, update status, and reset passwords.', 'management', 'Management', 100),
  ('management.role_manager', 'Role Manager', 'Create roles and manage role permissions.', 'management', 'Management', 200),
  ('settings.access', 'Settings', 'Access account settings and change own password.', 'settings', 'Settings', 100),
  ('task.manage', 'Tasks - Manage', 'Create, assign and manage all tasks, and see the backlog.', 'tasks', 'Tasks', 100),
  ('task.work', 'Tasks - Work', 'Work on tasks assigned to you.', 'tasks', 'Tasks', 200),
  ('task.export', 'Tasks - Export', 'Export task and enrollment tables to Excel. Required on its own — a manager role alone does not grant export.', 'tasks', 'Tasks', 300),
  ('lead.manage', 'Manage Leads', 'Import leads, assign them, and see every agent''s queue.', 'leads', 'Lead Management', 100),
  ('lead.work', 'Work Leads', 'See and log interactions on leads assigned to you.', 'leads', 'Lead Management', 200),
  ('lead.export', 'Export Leads', 'Download the lead table as a spreadsheet.', 'leads', 'Lead Management', 300)
on conflict (key) do update set
  label = excluded.label,
  description = excluded.description,
  group_key = excluded.group_key,
  group_label = excluded.group_label,
  sort_order = excluded.sort_order;

with permission_key_migrations (old_key, new_key) as (
  values
    ('performance.own', 'agent_dashboard.health'),
    ('performance.all', 'agent_dashboard.health'),
    ('agent_performance.health.own', 'agent_dashboard.health'),
    ('agent_performance.health.all', 'agent_dashboard.health'),
    ('agent_performance.pc.own', 'agent_dashboard.pc'),
    ('agent_performance.pc.all', 'agent_dashboard.pc'),
    ('sales_performance.access', 'company_dashboard.health'),
    ('dashboard.health.own', 'agent_dashboard.health'),
    ('dashboard.health.all', 'agent_dashboard.health'),
    ('dashboard.pc.own', 'agent_dashboard.pc'),
    ('dashboard.pc.all', 'agent_dashboard.pc'),
    ('sales_dashboard.health', 'company_dashboard.health'),
    ('sales_dashboard.pc', 'company_dashboard.pc'),
    ('customer_registration.health.own', 'customer_registration.health'),
    ('customer_registration.health.all', 'customer_registration.health'),
    ('customer_registration.pc.own', 'customer_registration.pc'),
    ('customer_registration.pc.all', 'customer_registration.pc')
)
insert into role_permissions (role_id, permission_key)
select rp.role_id, migrations.new_key
from role_permissions rp
join permission_key_migrations migrations on migrations.old_key = rp.permission_key
on conflict (role_id, permission_key) do nothing;

delete from permissions
where key not in (
  'customer_registration.health',
  'customer_registration.pc',
  'automation.health_statement',
  'automation.pc_statement',
  'automation.provider_finder',
  'agent_dashboard.health',
  'agent_dashboard.pc',
  'company_dashboard.health',
  'company_dashboard.pc',
  'company.view_all',
  'management.account_manager',
  'management.role_manager',
  'settings.access',
  'task.manage',
  'task.work',
  'task.export',
  'lead.manage',
  'lead.work',
  'lead.export'
);

do $$
declare
  legacy_admin_role_id uuid;
  admin_role_id uuid;
begin
  select id into legacy_admin_role_id
  from roles
  where name = 'Super Admin';

  select id into admin_role_id
  from roles
  where name = 'Admin';

  if legacy_admin_role_id is not null and admin_role_id is null then
    update roles
    set name = 'Admin',
        description = 'Full access to every portal area.',
        is_system = true,
        is_active = true,
        updated_at = now()
    where id = legacy_admin_role_id;
  elsif legacy_admin_role_id is not null and admin_role_id is not null then
    insert into role_permissions (role_id, permission_key)
    select admin_role_id, permission_key
    from role_permissions
    where role_id = legacy_admin_role_id
    on conflict (role_id, permission_key) do nothing;

    insert into user_roles (user_id, role_id)
    select user_id, admin_role_id
    from user_roles
    where role_id = legacy_admin_role_id
    on conflict (user_id, role_id) do nothing;

    delete from roles
    where id = legacy_admin_role_id;
  end if;
end $$;

insert into roles (name, description, is_system, is_active)
values
  ('Admin', 'Full access to every portal area.', true, true),
  ('Agent', 'Default access for regular agents.', false, true)
on conflict (name) do update set
  description = excluded.description,
  is_system = excluded.is_system,
  is_active = excluded.is_active,
  updated_at = now();

delete from role_permissions rp
using roles r
where rp.role_id = r.id
  and r.name in ('Admin', 'Agent');

insert into role_permissions (role_id, permission_key)
select r.id, p.key
from roles r
cross join permissions p
where r.name = 'Admin'
on conflict (role_id, permission_key) do nothing;

insert into role_permissions (role_id, permission_key)
select r.id, p.key
from roles r
join permissions p on p.key in (
  'customer_registration.health',
  'customer_registration.pc',
  'automation.health_statement',
  'automation.pc_statement',
  'automation.provider_finder',
  'agent_dashboard.health',
  'settings.access'
)
where r.name = 'Agent'
on conflict (role_id, permission_key) do nothing;

insert into user_roles (user_id, role_id)
select a.id, r.id
from portal_account a
join roles r on r.name = case when a.role = 'admin' then 'Admin' else 'Agent' end
where not exists (
  select 1
  from user_roles ur
  where ur.user_id = a.id
)
on conflict (user_id, role_id) do nothing;

with ranked_user_roles as (
  select
    ur.ctid,
    row_number() over (
      partition by ur.user_id
      order by
        case when r.name = 'Admin' then 0 else 1 end,
        ur.created_at,
        r.name
    ) as role_rank
  from user_roles ur
  join roles r on r.id = ur.role_id
)
delete from user_roles ur
using ranked_user_roles ranked
where ur.ctid = ranked.ctid
  and ranked.role_rank > 1;

create unique index if not exists user_roles_one_role_per_user_idx
  on user_roles (user_id);

do $$
begin
  if to_regclass('public.entries') is not null
    and to_regclass('public.health_entries') is null then
    alter table public.entries rename to health_entries;
  end if;
end $$;

create table if not exists health_entries (
  id uuid primary key default gen_random_uuid(),
  agent_email text not null,
  agent_name text,
  selected_agent text,
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

-- selected_agent: agent chosen from health_mart for this entry (the submitter
-- stays in agent_email / agent_name). Added after the table already existed.
alter table health_entries
add column if not exists selected_agent text;

create index if not exists health_entries_agent_email_idx on health_entries (agent_email);
create index if not exists health_entries_created_at_idx on health_entries (created_at desc);

create table if not exists pc_entries (
  id uuid primary key default gen_random_uuid(),
  agent_email text not null,
  agent_name text,
  selected_agent text,
  agency text not null,
  insured_name text not null,
  address text not null,
  type text not null,
  company text not null,
  policy_number text not null,
  pay_plan text not null,
  premium text not null,
  effective_date date not null,
  expired_date date not null,
  created_at timestamptz not null default now()
);

-- selected_agent: agent chosen from pc_mart for this P&C entry (the submitter
-- stays in agent_email / agent_name).
alter table pc_entries
add column if not exists selected_agent text;

create index if not exists pc_entries_agent_email_idx on pc_entries (agent_email);
create index if not exists pc_entries_created_at_idx on pc_entries (created_at desc);

create table if not exists dashboard_filter_defaults (
  dashboard_key text not null,
  filter_key text not null default 'report_month_range',
  default_type text not null default 'latest_n_months',
  start_month date,
  end_month date,
  rolling_months integer,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (dashboard_key, filter_key),
  constraint dashboard_filter_defaults_default_type_check
    check (
      default_type in (
        'all',
        'current_year',
        'fixed_range',
        'latest_n_months'
      )
    ),
  constraint dashboard_filter_defaults_rolling_months_check
    check (rolling_months is null or (rolling_months between 1 and 120))
);

create index if not exists dashboard_filter_defaults_dashboard_idx
  on dashboard_filter_defaults (dashboard_key);

with dashboard_key_migrations (old_key, new_key) as (
  values
    ('agent_performance_health', 'agent_dashboard_health'),
    ('sales_performance_health', 'company_dashboard_health'),
    ('sales_performance_pc', 'company_dashboard_pc'),
    ('company_dashboard_health', 'company_dashboard_health'),
    ('company_dashboard_pc', 'company_dashboard_pc')
)
insert into dashboard_filter_defaults (
  dashboard_key,
  filter_key,
  default_type,
  start_month,
  end_month,
  rolling_months,
  updated_by,
  created_at,
  updated_at
)
select
  migrations.new_key,
  defaults.filter_key,
  defaults.default_type,
  defaults.start_month,
  defaults.end_month,
  defaults.rolling_months,
  defaults.updated_by,
  defaults.created_at,
  defaults.updated_at
from dashboard_filter_defaults defaults
join dashboard_key_migrations migrations on migrations.old_key = defaults.dashboard_key
on conflict (dashboard_key, filter_key) do nothing;

with dashboard_key_migrations (old_key, new_key) as (
  values
    ('agent_performance_health', 'agent_dashboard_health'),
    ('sales_performance_health', 'company_dashboard_health'),
    ('sales_performance_pc', 'company_dashboard_pc'),
    ('company_dashboard_health', 'company_dashboard_health'),
    ('company_dashboard_pc', 'company_dashboard_pc')
)
delete from dashboard_filter_defaults defaults
using dashboard_key_migrations migrations
where defaults.dashboard_key = migrations.old_key;

insert into dashboard_filter_defaults (
  dashboard_key,
  filter_key,
  default_type,
  rolling_months
)
values
  (
    'agent_dashboard_health',
    'report_month_range',
    'latest_n_months',
    12
  ),
  (
    'company_dashboard_health',
    'report_month_range',
    'latest_n_months',
    12
  ),
  (
    'agent_dashboard_pc',
    'report_month_range',
    'latest_n_months',
    12
  ),
  (
    'company_dashboard_pc',
    'report_month_range',
    'latest_n_months',
    12
  )
on conflict (dashboard_key, filter_key) do nothing;

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

create table if not exists provider_address (
  source_sheet_id text not null,
  source_gid text not null,
  source_row_number integer not null,
  source_row_hash text not null,
  facility text,
  doctors text,
  npi text,
  practices_as text,
  accepting_new_patients text,
  business_hours text,
  phone text,
  street text,
  city text,
  state text,
  zip_code text,
  obamacare text,
  medicare text,
  other_plans text,
  verified_by text,
  date text,
  raw_row jsonb not null,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (source_sheet_id, source_gid, source_row_number)
);

create index if not exists provider_address_npi_idx
  on provider_address (npi);

create index if not exists provider_address_city_idx
  on provider_address (city);

create index if not exists provider_address_zip_code_idx
  on provider_address (zip_code);

alter table provider_address
add column if not exists facility text,
add column if not exists doctors text,
add column if not exists npi text,
add column if not exists practices_as text,
add column if not exists accepting_new_patients text,
add column if not exists business_hours text,
add column if not exists phone text,
add column if not exists street text,
add column if not exists city text,
add column if not exists state text,
add column if not exists zip_code text,
add column if not exists obamacare text,
add column if not exists medicare text,
add column if not exists other_plans text,
add column if not exists verified_by text,
add column if not exists date text;

create table if not exists pc_raw_data (
  source_sheet_id text not null,
  source_gid text not null,
  source_row_number integer not null,
  source_row_hash text not null,
  agent text,
  agency text,
  insured_name text,
  zipcode text,
  type text,
  company text,
  policy_number text,
  premium text,
  true_premium text,
  effective_date text,
  expired_date text,
  carrier_commission text,
  paid_producer text,
  statement_number text,
  raw_row jsonb not null,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (source_sheet_id, source_gid, source_row_number)
);

create index if not exists pc_raw_data_policy_number_idx
  on pc_raw_data (policy_number);

create index if not exists pc_raw_data_statement_number_idx
  on pc_raw_data (statement_number);

alter table pc_raw_data
add column if not exists agent text,
add column if not exists agency text,
add column if not exists insured_name text,
add column if not exists zipcode text,
add column if not exists type text,
add column if not exists company text,
add column if not exists policy_number text,
add column if not exists premium text,
add column if not exists true_premium text,
add column if not exists effective_date text,
add column if not exists expired_date text,
add column if not exists carrier_commission text,
add column if not exists paid_producer text,
add column if not exists statement_number text;

-- ZIP -> city/state reference table. Row data is imported separately.
-- zip is numeric so source values like "601.0" match pc_mart.zipcode.
create table if not exists zipcode_lookup (
  zip numeric primary key,
  city text,
  state text
);

create table if not exists pc_mart (
  agent_id text,
  agent_name text,
  agency_id text,
  agency_name text,
  insured_name text,
  zipcode integer,
  type text,
  company text,
  policy_number text,
  premium double precision,
  effective_date date,
  expired_date date,
  carrier_commission double precision,
  paid_producer text,
  statement_number text,
  true_premium double precision,
  expired_month_year text,
  effective_month_year text,
  status text,
  city text,
  state text,
  agent_commission_rate double precision,
  total_commission double precision,
  agent_commission_amount double precision,
  eps_commission_amount double precision
);

create index if not exists pc_mart_policy_number_idx
  on pc_mart (policy_number);

create index if not exists pc_mart_effective_date_idx
  on pc_mart (effective_date);

create index if not exists pc_mart_statement_number_idx
  on pc_mart (statement_number);

create table if not exists health_raw_data (
  source_sheet_id text not null,
  source_gid text not null,
  source_row_number integer not null,
  source_row_hash text not null,
  deal_name text,
  deal_stage text,
  state text,
  carrier text,
  plan_name text,
  primary_member_id text,
  agent text,
  broker_effective text,
  paid_to_date text,
  report_month text,
  month_report text,
  carriers_messer_paid text,
  agent_received text,
  eps_override text,
  eps_override_received text,
  eps_split text,
  pay_rate_level text,
  transaction_id text,
  messer_statement text,
  num_client text,
  raw_row jsonb not null,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (source_sheet_id, source_gid, source_row_number)
);

create index if not exists health_raw_data_carrier_idx
  on health_raw_data (carrier);

create index if not exists health_raw_data_report_month_idx
  on health_raw_data (month_report);

alter table health_raw_data
add column if not exists deal_name text,
add column if not exists deal_stage text,
add column if not exists state text,
add column if not exists carrier text,
add column if not exists plan_name text,
add column if not exists primary_member_id text,
add column if not exists agent text,
add column if not exists broker_effective text,
add column if not exists paid_to_date text,
add column if not exists report_month text,
add column if not exists month_report text,
add column if not exists carriers_messer_paid text,
add column if not exists agent_received text,
add column if not exists eps_override text,
add column if not exists eps_override_received text,
add column if not exists eps_split text,
add column if not exists pay_rate_level text,
add column if not exists transaction_id text,
add column if not exists messer_statement text,
add column if not exists num_client text;

create table if not exists health_mart (
  deal_name text,
  deal_stage text,
  state text,
  carrier text,
  plan_name text,
  primary_member_id text,
  agent text,
  broker_effective_date date,
  paid_to_date date,
  paid_to_date_raw text,
  report_month date,
  carriers_messer_paid double precision,
  agent_received double precision,
  eps_override double precision,
  eps_override_received double precision,
  eps_split double precision,
  pay_rate_level text,
  transaction_id text,
  messer_statement text,
  num_client integer,
  report_month_label text
);

alter table health_mart
add column if not exists paid_to_date_raw text;

create index if not exists health_mart_carrier_idx
  on health_mart (carrier);

create index if not exists health_mart_report_month_idx
  on health_mart (report_month);

create index if not exists health_mart_primary_member_id_idx
  on health_mart (primary_member_id);

drop function if exists refresh_health_mart();
drop function if exists parse_health_date(text);
drop function if exists parse_health_date_token(text);
drop function if exists parse_health_money(text);
drop function if exists parse_health_int(text);

create or replace function parse_health_date_token(value text)
returns date
language plpgsql
immutable
as $$
declare
  text_value text := btrim(value);
  first_number integer;
  second_number integer;
  third_number integer;
  parsed_month integer;
  parsed_year integer;
begin
  if nullif(text_value, '') is null then
    return null;
  end if;

  begin
    if text_value ~ '^\d{4}/\d{1,2}/\d{1,2}$' then
      return make_date(
        split_part(text_value, '/', 1)::integer,
        split_part(text_value, '/', 2)::integer,
        split_part(text_value, '/', 3)::integer
      );
    elsif text_value ~ '^\d{1,2}/\d{1,2}/\d{4}$' then
      first_number := split_part(text_value, '/', 1)::integer;
      second_number := split_part(text_value, '/', 2)::integer;
      third_number := split_part(text_value, '/', 3)::integer;

      -- Source data is normally MM/DD/YYYY. Treat values with a first
      -- component above 12 as the unambiguous DD/MM/YYYY exception.
      if first_number > 12 and second_number between 1 and 12 then
        return make_date(third_number, second_number, first_number);
      end if;

      return make_date(third_number, first_number, second_number);
    elsif text_value ~ '^\d{1,2}/\d{4}$' then
      return make_date(
        split_part(text_value, '/', 2)::integer,
        split_part(text_value, '/', 1)::integer,
        1
      );
    elsif text_value ~ '^\d{4}-\d{1,2}-\d{1,2}$' then
      return make_date(
        split_part(text_value, '-', 1)::integer,
        split_part(text_value, '-', 2)::integer,
        split_part(text_value, '-', 3)::integer
      );
    elsif text_value ~ '^\d{8}$' then
      return make_date(
        substring(text_value from 1 for 4)::integer,
        substring(text_value from 5 for 2)::integer,
        substring(text_value from 7 for 2)::integer
      );
    elsif text_value ~* '^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)-\d{2}$' then
      parsed_month := case lower(left(text_value, 3))
        when 'jan' then 1
        when 'feb' then 2
        when 'mar' then 3
        when 'apr' then 4
        when 'may' then 5
        when 'jun' then 6
        when 'jul' then 7
        when 'aug' then 8
        when 'sep' then 9
        when 'oct' then 10
        when 'nov' then 11
        when 'dec' then 12
      end;
      parsed_year := 2000 + right(text_value, 2)::integer;

      return (
        make_date(parsed_year, parsed_month, 1)
        + interval '1 month - 1 day'
      )::date;
    end if;
  exception when others then
    return null;
  end;

  return null;
end;
$$;

create or replace function parse_health_date(value text)
returns date
language plpgsql
immutable
as $$
declare
  normalized_value text := regexp_replace(
    btrim(coalesce(value, '')),
    '[[:space:]]*/[[:space:]]*',
    '/',
    'g'
  );
  parsed_date date;
begin
  if nullif(normalized_value, '') is null then
    return null;
  end if;

  select max(parse_health_date_token(part))
  into parsed_date
  from regexp_split_to_table(normalized_value, '[[:space:],;|]+') as parts(part);

  return parsed_date;
end;
$$;

create or replace function parse_health_money(value text)
returns double precision
language sql
immutable
as $$
  select case
    when nullif(regexp_replace(btrim(coalesce(value, '')), '[\$,]', '', 'g'), '') ~ '^-?\d+(\.\d+)?$'
      then nullif(regexp_replace(btrim(coalesce(value, '')), '[\$,]', '', 'g'), '')::double precision
    else null
  end;
$$;

create or replace function parse_health_int(value text)
returns integer
language sql
immutable
as $$
  select case
    when btrim(coalesce(value, '')) ~ '^-?\d+$'
      then btrim(value)::integer
    else null
  end;
$$;

drop function if exists refresh_pc_mart();
drop function if exists parse_pc_date(text);

create or replace function parse_pc_date(value text)
returns date
language plpgsql
immutable
as $$
declare
  text_value text := regexp_replace(
    regexp_replace(replace(btrim(coalesce(value, '')), '.', '/'), '[^0-9/]', '', 'g'),
    '(\d{4})\d+$',
    '\1'
  );
begin
  if nullif(text_value, '') is null then
    return null;
  end if;

  begin
    if text_value ~ '^\d{1,2}/\d{1,2}/\d{4}$' then
      return to_date(text_value, 'MM/DD/YYYY');
    end if;
  exception when others then
    return null;
  end;

  return null;
end;
$$;

create or replace function refresh_pc_mart()
returns void
language sql
security definer
as $$
  truncate table pc_mart;

  insert into pc_mart (
    agent_id,
    agent_name,
    agency_id,
    agency_name,
    insured_name,
    zipcode,
    type,
    company,
    policy_number,
    premium,
    effective_date,
    expired_date,
    carrier_commission,
    paid_producer,
    statement_number,
    true_premium,
    expired_month_year,
    effective_month_year,
    status,
    city,
    state,
    agent_commission_rate,
    total_commission,
    agent_commission_amount,
    eps_commission_amount
  )
  with clean_excel as (
    select
      upper(btrim(agent)) as agent,
      upper(btrim(split_part(agency, '-', 1))) as agency,
      insured_name,
      parse_health_int(max(zipcode)::text) as zipcode,
      case
        when upper(btrim(type)) in ('AUTO', 'ATUO', 'CAR') then 'AUTO'
        when upper(btrim(type)) in ('COMMERCIAL', 'COMMERICAL', 'COMERCIAL', 'COMM') then 'COMMERCIAL'
        when upper(btrim(type)) in ('HOME', 'HOMEOWNER', 'DWELLING', 'DWELLING FIRE') then 'HOME'
        when upper(btrim(type)) in ('DP', 'DP3') then 'DP'
        else upper(btrim(type))
      end as type,
      case
        when upper(btrim(company)) ~ 'ARI|AMERICAN\s*RISK' then 'AMERICAN RISK'
        when upper(btrim(company)) ~ 'ALLSTATE' then 'ALLSTATE'
        when upper(btrim(company)) ~ 'ATTUNE' then 'ATTUNE'
        when upper(btrim(company)) ~ 'CLEAR\s*COVER' then 'CLEARCOVER'
        when upper(btrim(company)) ~ 'COMMER' then 'COMMERCIAL'
        when upper(btrim(company)) ~ 'ELEPHANT' then 'ELEPHANT'
        when upper(btrim(company)) ~ 'FARMERS' then 'FARMERS'
        when upper(btrim(company)) ~ 'GEICO' then 'GEICO'
        when upper(btrim(company)) ~ 'HAR.?FORD' then 'HARTFORD'
        when upper(btrim(company)) ~ 'HISCOX' then 'HISCOX'
        when upper(btrim(company)) ~ 'HOME.*AMERICA|HOA' then 'HOMEOWNERS OF AMERICA'
        when upper(btrim(company)) ~ 'LLOYD' then 'LLOYD OF LONDON'
        when upper(btrim(company)) ~ 'NAT.*GEN|NATIONAL\s*GENERAL' then 'NATIONAL GENERAL'
        when upper(btrim(company)) ~ 'NAT.*SUM|NATIONAL\s*SUMMIT' then 'NATIONAL SUMMIT'
        when upper(btrim(company)) ~ 'OCCIDENTAL' then 'OCCIDENTAL'
        when upper(btrim(company)) ~ 'ORCHID' then 'ORCHID'
        when upper(btrim(company)) ~ 'PROGRESSIVE' then 'PROGRESSIVE'
        when upper(btrim(company)) ~ 'RLI' then 'RLI'
        when upper(btrim(company)) ~ 'ROOT' then 'ROOT'
        when upper(btrim(company)) ~ 'SAFECO' then 'SAFECO'
        when upper(btrim(company)) ~ 'SAFEPOINT' then 'SAFEPOINT'
        when upper(btrim(company)) ~ 'SAFEPORT' then 'SAFEPORT'
        when upper(btrim(company)) ~ 'SAGE|SAG|SURE' then 'SAGESURE'
        when upper(btrim(company)) ~ 'STATE\s*AUTO' then 'STATE AUTO'
        when upper(btrim(company)) ~ 'STEADILY' then 'STEADILY'
        when upper(btrim(company)) ~ 'TAPCO' then 'TAPCO'
        when upper(btrim(company)) ~ 'TOWERHILL' then 'TOWERHILL'
        when upper(btrim(company)) ~ 'TRAVELERS' then 'TRAVELERS'
        when upper(btrim(company)) ~ 'TX.*FAIR' then 'TX FAIR PLAN'
        when upper(btrim(company)) ~ 'TX.*WIND' then 'TX WINDSTORM'
        when upper(btrim(company)) ~ 'WELLINGTON' then 'WELLINGTON'
        when upper(btrim(company)) ~ 'WRIGHT' then 'WRIGHT FLOOD'
        when upper(btrim(company)) ~ 'CENTURY' then 'CENTURY SURETY'
        else upper(btrim(company))
      end as company,
      policy_number,
      round(sum(parse_health_money(premium))::numeric, 2)::double precision as premium,
      round(sum(parse_health_money(true_premium))::numeric, 2)::double precision as true_premium,
      parse_pc_date(effective_date) as effective_date,
      parse_pc_date(expired_date) as expired_date,
      case
        when nullif(replace(btrim(coalesce(carrier_commission, '')), '%', ''), '') ~ '^-?\d+(\.\d+)?$'
          then nullif(replace(btrim(coalesce(carrier_commission, '')), '%', ''), '')::double precision / 100
        else null
      end as carrier_commission,
      to_char(
        case
          when paid_producer ~ '\d{4}$' then parse_pc_date(paid_producer)
          else parse_pc_date(concat(paid_producer, '/2025'))
        end,
        'MM/DD/YYYY'
      ) as paid_producer,
      statement_number
    from pc_raw_data
    group by
      agent,
      agency,
      type,
      company,
      policy_number,
      effective_date,
      expired_date,
      carrier_commission,
      insured_name,
      paid_producer,
      statement_number
  ),
  rn_excel as (
    select
      *,
      row_number() over (partition by policy_number order by effective_date) as rn
    from clean_excel
  ),
  base as (
    select
      case
        when f.agent = 'Fiona Huynh' then 'EPS1001'
        when f.agent = 'Linh Le' then 'EPS1002'
        when f.agent = 'Nam Nguyen' then 'EPS1003'
        when f.agent = 'Vuong Pham' then 'EPS1004'
      end as agent_id,
      f.agent as agent_name,
      case
        when f.agency = 'DP' then 'EPSA001'
        when f.agency = 'TWFG' then 'EPSA002'
      end as agency_id,
      case
        when f.agency = 'DP' then 'DP'
        when f.agency = 'TWFG' then 'TWFG'
      end as agency_name,
      f.insured_name,
      f.zipcode,
      f.type,
      f.company,
      f.policy_number,
      f.premium,
      f.effective_date,
      f.expired_date,
      f.carrier_commission,
      f.paid_producer,
      f.statement_number,
      coalesce(f.true_premium, f.premium) as true_premium,
      to_char(f.expired_date, 'YYYY-MM') as expired_month_year,
      to_char(f.effective_date, 'YYYY-MM') as effective_month_year,
      case
        when f.premium < 0 then 'CANCEL'
        when f.rn = 1 then 'NEW'
        else 'RENEWAL'
      end as status,
      z.city as city,
      z.state as state
    from rn_excel f
    left join zipcode_lookup z on z.zip = f.zipcode
    where not (f.agent is null and f.agency is null and f.policy_number is null)
  ),
  monetary as (
    select
      b.*,
      case when b.agent_id = 'EPS1001' then 0.60 else 0.75 end as agent_commission_rate,
      round((
        b.carrier_commission * b.true_premium *
        case
          when b.agency_name = 'DP' then 0.75
          when b.agency_name = 'TWFG' then 0.80
          else 0
        end
      )::numeric, 2)::double precision as total_commission
    from base b
  ),
  final as (
    select
      m.*,
      round((m.agent_commission_rate * m.total_commission)::numeric, 2)::double precision as agent_commission_amount,
      round((m.total_commission - (m.agent_commission_rate * m.total_commission))::numeric, 2)::double precision as eps_commission_amount
    from monetary m
  )
  select
    agent_id,
    agent_name,
    agency_id,
    agency_name,
    insured_name,
    zipcode,
    type,
    company,
    policy_number,
    premium,
    effective_date,
    expired_date,
    carrier_commission,
    paid_producer,
    statement_number,
    true_premium,
    expired_month_year,
    effective_month_year,
    status,
    city,
    state,
    agent_commission_rate,
    total_commission,
    agent_commission_amount,
    eps_commission_amount
  from final;
$$;

create or replace function refresh_health_mart()
returns void
language sql
security definer
as $$
  truncate table health_mart;

  insert into health_mart (
    deal_name,
    deal_stage,
    state,
    carrier,
    plan_name,
    primary_member_id,
    agent,
    broker_effective_date,
    paid_to_date,
    paid_to_date_raw,
    report_month,
    carriers_messer_paid,
    agent_received,
    eps_override,
    eps_override_received,
    eps_split,
    pay_rate_level,
    transaction_id,
    messer_statement,
    num_client,
    report_month_label
  )
  select
    btrim(r.deal_name),
    upper(btrim(r.deal_stage)),
    upper(btrim(r.state)),
    upper(btrim(r.carrier)),
    upper(btrim(r.plan_name)),
    upper(btrim(r.primary_member_id)),
    upper(btrim(r.agent)),
    parse_health_date(r.broker_effective),
    parse_health_date(r.paid_to_date),
    btrim(r.paid_to_date),
    date_trunc('month', parse_health_date(r.month_report))::date,
    parse_health_money(r.carriers_messer_paid),
    parse_health_money(r.agent_received),
    parse_health_money(r.eps_override),
    parse_health_money(r.eps_override_received),
    parse_health_money(r.eps_split),
    upper(btrim(r.pay_rate_level)),
    upper(btrim(r.transaction_id)),
    btrim(r.messer_statement),
    parse_health_int(r.num_client::text),
    to_char(date_trunc('month', parse_health_date(r.month_report))::date, 'YYYY-MM')
  from health_raw_data r
  where not (
    r.deal_name is null
    and btrim(r.deal_name) <> ''
    and r.primary_member_id is null
  );
$$;

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

create or replace function replace_health_payment_summary(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  inserted_count integer;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array';
  end if;

  if jsonb_array_length(p_rows) > 100000 then
    raise exception 'p_rows exceeds the maximum replacement size';
  end if;

  truncate table public.health_payment_summary;

  insert into public.health_payment_summary (
    agent, carrier_name, customer_id, customer_name, effective_date,
    paid_to_date, gross_compensation, transaction_id, statement
  )
  select payload.agent, payload.carrier_name, payload.customer_id,
    payload.customer_name, payload.effective_date, payload.paid_to_date,
    payload.gross_compensation, payload.transaction_id, payload.statement
  from jsonb_to_recordset(p_rows) as payload(
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

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

revoke all on function replace_health_payment_summary(jsonb) from public, anon, authenticated;
grant execute on function replace_health_payment_summary(jsonb) to service_role;

-- ============================================================
-- Task Board (customer-service work tracking)
-- ============================================================
create table if not exists task_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  color text,
  position integer not null default 0,
  is_active boolean not null default true,
  created_by text,
  created_at timestamptz not null default now()
);

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  fub_link text,
  status text not null default 'backlog'
    check (status in ('backlog','todo','in_progress','waiting','done','cancel')),
  priority text not null default 'medium'
    check (priority in ('low','medium','high','urgent')),
  category_id uuid references task_categories(id) on delete set null,
  agent_email text,
  assignee_email text,
  reporter_email text not null,
  done_reviewed_by_email text,
  done_reviewed_at timestamptz,
  position double precision not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  custom_values jsonb not null default '{}'::jsonb,
  archived_at timestamptz,
  constraint tasks_backlog_no_assignee
    check (status <> 'backlog' or assignee_email is null),
  -- Mặt còn lại của bất biến: task ngoài backlog BẮT BUỘC có assignee.
  constraint tasks_nonbacklog_has_assignee
    check (status = 'backlog' or assignee_email is not null)
);

-- A category can remain referenced by historical tasks after it is archived,
-- but new references must point to an active category. Keep this invariant in
-- the same transaction as both atomic task commands so no route pre-read can
-- race a concurrent archive.
create or replace function enforce_active_task_category()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.category_id is not null then
    if tg_op = 'INSERT' or new.category_id is distinct from old.category_id then
      if not exists (
        select 1
        from task_categories c
        where c.id = new.category_id
          and c.is_active = true
      ) then
        raise exception 'TASK_CATEGORY_INACTIVE';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_active_category_guard on tasks;
create trigger tasks_active_category_guard
before insert or update of category_id on tasks
for each row execute function enforce_active_task_category();

revoke all on function enforce_active_task_category() from public, anon, authenticated;

alter table tasks
add column if not exists agent_email text;

alter table tasks
add column if not exists fub_link text;

alter table tasks
add column if not exists done_reviewed_by_email text;

alter table tasks
add column if not exists done_reviewed_at timestamptz;

alter table tasks add column if not exists in_progress_at timestamptz;
alter table tasks add column if not exists custom_values jsonb not null default '{}'::jsonb;

-- Set the first time a cron detection pass (see /api/cron/check-overdue)
-- notices the task has crossed its SLA deadline; cleared whenever
-- the task leaves/reopens from its overdue run. This is what makes
-- "this task went overdue" a permanent,
-- tamper-resistant fact in the activity log instead of something that
-- disappears the instant someone bounces the status back and forth — needed
-- now that overdue counts feed into KPI.
alter table tasks add column if not exists overdue_flagged_at timestamptz;

-- SLA minutes resolved and locked in the moment in_progress_at is (re)stamped
-- (each start into In Progress) — NOT recomputed from the task's
-- current priority/category afterwards. Without this, an agent owner or the
-- task's reporter (both allowed to edit priority/category) could silently
-- lower the priority on an already-overdue task and make it stop counting as
-- overdue with no reason required, defeating the same KPI integrity goal as
-- the status-bounce and reopen-reason protections above. Null means "not
-- started yet" or a pre-migration row — isTaskOverdue falls back to live
-- resolution for those.
alter table tasks add column if not exists sla_minutes integer;

-- Permanent tally of how many times this task has gone overdue. Unlike
-- overdue_flagged_at, this never resets, including once the task reaches
-- Done/Cancel. Powers historical "was overdue" indicators once the live
-- In Progress overdue state no longer applies.
alter table tasks add column if not exists overdue_count integer not null default 0;

-- Stage timestamps used for operational clocks and reminders. Assignment time
-- lives in task_assignees.created_at; these columns cover the stages that are
-- owned by the task row itself. A `*_started_at` is non-null ONLY while the
-- task is currently in that stage (marks the current stint's start); it's
-- cleared when the task leaves the stage.
alter table tasks add column if not exists todo_started_at timestamptz;
alter table tasks add column if not exists todo_reminded_at timestamptz;
alter table tasks add column if not exists waiting_started_at timestamptz;
alter table tasks add column if not exists waiting_reminded_at timestamptz;
alter table tasks add column if not exists overdue_reminded_at timestamptz;
alter table tasks add column if not exists overdue_unlocked_at timestamptz;
alter table tasks add column if not exists reopened_at timestamptz;
alter table tasks add column if not exists closed_at timestamptz;

-- Bumped on every meaningful action (status change, comment, assignment,
-- edit). Powers the "stale task" reminder and the card-ordering "recent
-- activity" tier. Backfilled from updated_at for existing rows.
alter table tasks add column if not exists last_activity_at timestamptz;
update tasks set last_activity_at = coalesce(updated_at, created_at)
where last_activity_at is null;

-- Actor paired with the last activity timestamp. Keeping this on the parent
-- row makes list consumers deterministic even when an activity feed is
-- eventually pruned, and lets atomic collaboration commands update the pair
-- under the same row lock.
alter table tasks add column if not exists last_activity_by_email text;
alter table tasks add column if not exists client_request_id uuid;

create unique index if not exists tasks_client_request_id_key
  on tasks (reporter_email, client_request_id)
  where client_request_id is not null;

-- Clamp optimistic-concurrency and last-activity tokens at the database
-- column so application clocks cannot move either value backwards.
create or replace function tasks_updated_at_monotonic()
returns trigger language plpgsql as $$
begin
  -- Correct a genuine regression only. `is distinct from` is load-bearing: in a
  -- BEFORE UPDATE row trigger a column absent from the SET clause carries the
  -- OLD value into NEW, so a bare `<=` matched every write that left updated_at
  -- alone -- the six cron reminder writes and mark_task_overdue_atomic -- and
  -- bumped it by 1us. Both concurrency checks compare updated_at by exact
  -- equality, so that silently invalidated every open client's token and
  -- produced 409s on tasks nobody had edited.
  --
  -- A write that SUPPLIES updated_at equal to the old value is still advanced:
  -- two writers in the same microsecond must not share one version.
  if new.updated_at is distinct from old.updated_at
     and new.updated_at <= old.updated_at then
    new.updated_at := old.updated_at + interval '1 microsecond';
  end if;
  if new.last_activity_at is not null
     and old.last_activity_at is not null
     and new.last_activity_at < old.last_activity_at then
    new.last_activity_at := old.last_activity_at;
    new.last_activity_by_email := old.last_activity_by_email;
  end if;
  return new;
end $$;

drop trigger if exists tasks_updated_at_monotonic on tasks;
create trigger tasks_updated_at_monotonic
  before update on tasks
  for each row execute function tasks_updated_at_monotonic();

-- Anti-duplicate markers for the new cron reminders (mirror the existing
-- overdue_reminded_at / todo_reminded_at / waiting_reminded_at). Cleared when
-- the relevant clock restarts so the reminder can re-arm.
alter table tasks add column if not exists due_soon_notified_at timestamptz;
alter table tasks add column if not exists stale_reminded_at timestamptz;
alter table tasks add column if not exists qc_reminded_at timestamptz;

-- Cumulative time (seconds) a task has spent in each stage across ALL visits,
-- banked when the task leaves that stage. Display time in a stage = the
-- accumulator + (now - *_started_at) while currently in it. This is what makes
-- the stage clocks consistent across every allowed stage transition.
--
-- in_progress_seconds is historical/KPI time only. Active SLA overdue uses
-- the current in_progress_at stint before any Waiting. Once a task has entered
-- Waiting, later In Progress time is plain effort tracking without active SLA.
alter table tasks add column if not exists todo_seconds integer not null default 0;
alter table tasks add column if not exists in_progress_seconds integer not null default 0;
alter table tasks add column if not exists waiting_seconds integer not null default 0;

update tasks
set todo_started_at = coalesce(updated_at, created_at)
where status = 'todo'
  and todo_started_at is null;

update tasks
set waiting_started_at = coalesce(updated_at, created_at)
where status = 'waiting'
  and waiting_started_at is null;

update tasks
set closed_at = coalesce(updated_at, created_at)
where status in ('done', 'cancel')
  and closed_at is null;

alter table tasks drop column if exists waiting_reason;

do $$
begin
  if exists (
    select 1 from pg_constraint where conname = 'tasks_status_check'
  ) then
    alter table tasks drop constraint tasks_status_check;
  end if;

  alter table tasks
  add constraint tasks_status_check
  check (status in ('backlog','todo','in_progress','waiting','done','cancel'));
end $$;

drop index if exists tasks_due_date_idx;

alter table tasks
drop column if exists due_date;

-- Durable human-facing key. UUIDs remain the internal/API identifier; this
-- sequence-backed number is the only value rendered as CS-... in the UI.
create sequence if not exists tasks_display_number_seq;
alter table tasks add column if not exists display_number bigint;
do $$
declare
  max_number bigint;
begin
  select max(display_number) into max_number from tasks;
  if max_number is not null then
    perform setval('tasks_display_number_seq', max_number, true);
  end if;
end $$;
with missing as (
  select id, row_number() over (order by created_at, id) as row_number
  from tasks
  where display_number is null
), current_max as (
  select coalesce(max(display_number), 0) as value from tasks
)
update tasks as target
set display_number = current_max.value + missing.row_number
from missing, current_max
where target.id = missing.id;
do $$
declare
  max_number bigint;
begin
  select max(display_number) into max_number from tasks;
  if max_number is not null then
    perform setval('tasks_display_number_seq', max_number, true);
  end if;
end $$;
alter table tasks alter column display_number set default nextval('tasks_display_number_seq');
alter table tasks alter column display_number set not null;
create unique index if not exists tasks_display_number_key on tasks (display_number);

-- Áp bất biến "non-backlog phải có assignee" cho DB đã tồn tại (create table
-- if not exists ở trên không thêm constraint vào bảng cũ).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'tasks_nonbacklog_has_assignee'
  ) then
    alter table tasks
    add constraint tasks_nonbacklog_has_assignee
    check (status = 'backlog' or assignee_email is not null);
  end if;
end $$;

create index if not exists tasks_assignee_idx on tasks (assignee_email);
create index if not exists tasks_agent_email_idx on tasks (agent_email);
create index if not exists tasks_status_position_idx on tasks (status, position);
create index if not exists tasks_done_review_idx on tasks (status, done_reviewed_at);
create index if not exists tasks_category_idx on tasks (category_id);
create index if not exists tasks_archived_idx on tasks (archived_at);

create table if not exists task_stage_cycles (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  stage text not null check (stage in ('backlog','todo','in_progress','waiting','done','cancel')),
  started_at timestamptz not null,
  ended_at timestamptz,
  duration_seconds integer,
  started_by_email text,
  ended_by_email text,
  responsible_start_email text,
  responsible_end_email text,
  from_status text,
  to_status text,
  sla_minutes integer,
  due_at timestamptz,
  meta jsonb,
  created_at timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at),
  check (duration_seconds is null or duration_seconds >= 0)
);

create index if not exists task_stage_cycles_task_idx
  on task_stage_cycles (task_id, started_at desc);

drop index if exists task_stage_cycles_open_idx;
create unique index task_stage_cycles_open_idx
  on task_stage_cycles (task_id)
  where ended_at is null;

insert into task_stage_cycles (
  task_id,
  stage,
  started_at,
  started_by_email,
  sla_minutes,
  due_at,
  meta
)
select
  t.id,
  t.status,
  case
    when t.status = 'todo' then coalesce(t.todo_started_at, t.updated_at, t.created_at)
    when t.status = 'in_progress' then coalesce(t.in_progress_at, t.updated_at, t.created_at)
    when t.status = 'waiting' then coalesce(t.waiting_started_at, t.updated_at, t.created_at)
    when t.status in ('done', 'cancel') then coalesce(t.closed_at, t.updated_at, t.created_at)
    else t.created_at
  end,
  t.reporter_email,
  case when t.status = 'in_progress' then t.sla_minutes else null end,
  case
    when t.status = 'in_progress' and t.in_progress_at is not null and t.sla_minutes is not null
      then t.in_progress_at + make_interval(mins => t.sla_minutes)
    else null
  end,
  jsonb_build_object('source', 'backfill')
from tasks t
where not exists (
  select 1 from task_stage_cycles c
  where c.task_id = t.id and c.ended_at is null
);

-- Backfill the stage-time accumulators from any CLOSED cycles already on
-- record. Pre-existing rows only have their current (open) stint, so their
-- accumulators start at 0 and the current stint is measured live from
-- *_started_at — the best we can do without historical cycle data. Going
-- forward every closed stint banks its seconds here. Idempotent: recomputes
-- from the immutable closed-cycle durations, so re-running schema.sql can't
-- double-count.
update tasks t set
  todo_seconds = coalesce((
    select sum(c.duration_seconds) from task_stage_cycles c
    where c.task_id = t.id and c.stage = 'todo' and c.ended_at is not null
  ), 0),
  in_progress_seconds = coalesce((
    select sum(c.duration_seconds) from task_stage_cycles c
    where c.task_id = t.id and c.stage = 'in_progress' and c.ended_at is not null
  ), 0),
  waiting_seconds = coalesce((
    select sum(c.duration_seconds) from task_stage_cycles c
    where c.task_id = t.id and c.stage = 'waiting' and c.ended_at is not null
  ), 0);

create table if not exists task_overdue_events (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  stage_cycle_id uuid references task_stage_cycles(id) on delete set null,
  due_at timestamptz not null,
  overdue_at timestamptz not null,
  resolved_at timestamptz,
  overdue_seconds integer,
  resolved_by_email text,
  reason text,
  sla_minutes integer,
  created_at timestamptz not null default now(),
  check (resolved_at is null or resolved_at >= overdue_at),
  check (overdue_seconds is null or overdue_seconds >= 0)
);

create index if not exists task_overdue_events_task_idx
  on task_overdue_events (task_id, overdue_at desc);

create unique index if not exists task_overdue_events_open_idx
  on task_overdue_events (task_id)
  where resolved_at is null;

insert into task_overdue_events (
  task_id,
  stage_cycle_id,
  due_at,
  overdue_at,
  sla_minutes
)
select
  t.id,
  (
    select c.id
    from task_stage_cycles c
    where c.task_id = t.id
      and c.stage = 'in_progress'
      and c.ended_at is null
    order by c.started_at desc
    limit 1
  ),
  t.in_progress_at + make_interval(mins => t.sla_minutes),
  t.overdue_flagged_at,
  t.sla_minutes
from tasks t
where t.status = 'in_progress'
  and t.in_progress_at is not null
  and t.sla_minutes is not null
  and t.overdue_flagged_at is not null
  and not exists (
    select 1 from task_overdue_events e
    where e.task_id = t.id and e.resolved_at is null
  );

-- SLA time budget per priority, optionally overridden per category.
-- category_id = null means "default for this priority, any/no category".
create table if not exists task_sla_rules (
  id uuid primary key default gen_random_uuid(),
  priority text not null check (priority in ('low','medium','high','urgent')),
  category_id uuid references task_categories(id) on delete cascade,
  duration_minutes integer not null check (duration_minutes > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Primary key can't have a nullable column, so enforce one row per
-- (priority, category) with a functional unique index over a sentinel for null.
create unique index if not exists task_sla_rules_priority_category_key
  on task_sla_rules (priority,
    coalesce(category_id, '00000000-0000-0000-0000-000000000000'));

create or replace function save_task_sla_rule_atomic(
  p_priority text,
  p_category_id uuid,
  p_duration_minutes integer,
  p_expected_updated_at timestamptz default null,
  p_has_expected boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  existing_row task_sla_rules%rowtype;
  saved_row task_sla_rules%rowtype;
begin
  if p_priority not in ('low', 'medium', 'high', 'urgent')
    or p_duration_minutes is null or p_duration_minutes <= 0 then
    raise exception 'SLA_RULE_INVALID';
  end if;

  select * into existing_row
  from task_sla_rules
  where priority = p_priority
    and category_id is not distinct from p_category_id
  for update;

  if found then
    if not p_has_expected then raise exception 'SLA_RULE_VERSION_REQUIRED'; end if;
    if p_expected_updated_at is null or existing_row.updated_at is distinct from p_expected_updated_at then
      raise exception 'SLA_RULE_STALE';
    end if;
    update task_sla_rules
    set duration_minutes = p_duration_minutes,
        updated_at = clock_timestamp()
    where id = existing_row.id
    returning * into saved_row;
  else
    if p_has_expected and p_expected_updated_at is not null then
      raise exception 'SLA_RULE_STALE';
    end if;
    insert into task_sla_rules (priority, category_id, duration_minutes, updated_at)
    values (p_priority, p_category_id, p_duration_minutes, clock_timestamp())
    returning * into saved_row;
  end if;

  return jsonb_build_object(
    'id', saved_row.id,
    'priority', saved_row.priority,
    'category_id', saved_row.category_id,
    'duration_minutes', saved_row.duration_minutes,
    'updated_at', saved_row.updated_at
  );
end;
$$;

create or replace function delete_task_sla_rule_atomic(
  p_priority text,
  p_category_id uuid,
  p_expected_updated_at timestamptz default null,
  p_has_expected boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  existing_row task_sla_rules%rowtype;
begin
  if p_priority not in ('low', 'medium', 'high', 'urgent') then
    raise exception 'SLA_RULE_INVALID';
  end if;
  select * into existing_row
  from task_sla_rules
  where priority = p_priority
    and category_id is not distinct from p_category_id
  for update;
  if not found then
    if p_expected_updated_at is not null then raise exception 'SLA_RULE_STALE'; end if;
    return jsonb_build_object('deleted', false);
  end if;
  if not p_has_expected then raise exception 'SLA_RULE_VERSION_REQUIRED'; end if;
  if p_expected_updated_at is null or existing_row.updated_at is distinct from p_expected_updated_at then
    raise exception 'SLA_RULE_STALE';
  end if;
  delete from task_sla_rules where id = existing_row.id;
  return jsonb_build_object('deleted', true);
end;
$$;

revoke all on function save_task_sla_rule_atomic(text, uuid, integer, timestamptz, boolean) from public, anon, authenticated;
revoke all on function delete_task_sla_rule_atomic(text, uuid, timestamptz, boolean) from public, anon, authenticated;
grant execute on function save_task_sla_rule_atomic(text, uuid, integer, timestamptz, boolean) to service_role;
grant execute on function delete_task_sla_rule_atomic(text, uuid, timestamptz, boolean) to service_role;

-- Seed a default per priority if missing (idempotent).
do $$
declare
  seed record;
begin
  for seed in
    select * from (values
      ('low', 1440),
      ('medium', 480),
      ('high', 240),
      ('urgent', 60)
    ) as s(priority, duration_minutes)
  loop
    if not exists (
      select 1 from task_sla_rules
      where priority = seed.priority and category_id is null
    ) then
      insert into task_sla_rules (priority, category_id, duration_minutes)
      values (seed.priority, null, seed.duration_minutes::integer);
    end if;
  end loop;
end $$;

-- Global reminder thresholds (one row). Managed in the SLA Times modal.
create table if not exists task_reminder_settings (
  id boolean primary key default true check (id),
  due_soon_minutes integer not null default 15 check (due_soon_minutes > 0),
  todo_hours integer not null default 24 check (todo_hours > 0),
  overdue_reminder_hours integer not null default 24 check (overdue_reminder_hours > 0),
  waiting_hours integer not null default 24 check (waiting_hours > 0),
  stale_hours integer not null default 48 check (stale_hours > 0),
  updated_at timestamptz not null default now()
);

alter table task_reminder_settings
add column if not exists todo_hours integer not null default 24 check (todo_hours > 0);

alter table task_reminder_settings
add column if not exists qc_hours integer not null default 24 check (qc_hours > 0);

insert into task_reminder_settings (id)
values (true)
on conflict (id) do nothing;

create or replace function update_task_reminder_setting_atomic(
  p_key text,
  p_value integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  settings_row task_reminder_settings%rowtype;
begin
  if p_key not in ('dueSoonMinutes', 'todoHours', 'overdueReminderHours', 'waitingHours', 'staleHours', 'qcHours')
    or p_value is null or p_value <= 0 then
    raise exception 'REMINDER_SETTING_INVALID';
  end if;
  if (p_key = 'dueSoonMinutes' and p_value > 10080)
    or (p_key <> 'dueSoonMinutes' and p_value > 8760) then
    raise exception 'REMINDER_SETTING_INVALID';
  end if;

  select * into settings_row
  from task_reminder_settings
  where id = true
  for update;
  if not found then
    insert into task_reminder_settings (id) values (true);
    select * into settings_row from task_reminder_settings where id = true for update;
  end if;

  update task_reminder_settings
  set due_soon_minutes = case when p_key = 'dueSoonMinutes' then p_value else due_soon_minutes end,
      todo_hours = case when p_key = 'todoHours' then p_value else todo_hours end,
      overdue_reminder_hours = case when p_key = 'overdueReminderHours' then p_value else overdue_reminder_hours end,
      waiting_hours = case when p_key = 'waitingHours' then p_value else waiting_hours end,
      stale_hours = case when p_key = 'staleHours' then p_value else stale_hours end,
      qc_hours = case when p_key = 'qcHours' then p_value else qc_hours end,
      updated_at = clock_timestamp()
  where id = true
  returning * into settings_row;

  return jsonb_build_object(
    'due_soon_minutes', settings_row.due_soon_minutes,
    'todo_hours', settings_row.todo_hours,
    'overdue_reminder_hours', settings_row.overdue_reminder_hours,
    'waiting_hours', settings_row.waiting_hours,
    'stale_hours', settings_row.stale_hours,
    'qc_hours', settings_row.qc_hours,
    'updated_at', settings_row.updated_at
  );
end;
$$;

revoke all on function update_task_reminder_setting_atomic(text, integer) from public, anon, authenticated;
grant execute on function update_task_reminder_setting_atomic(text, integer) to service_role;

create table if not exists task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  parent_id uuid references task_comments(id) on delete cascade,
  author_email text not null,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Optional request token used by the client to make comment retries safe.
-- Nullable keeps older clients compatible during a rolling deployment.
alter table task_comments add column if not exists client_request_id uuid;

create unique index if not exists task_comments_client_request_id_key
  on task_comments (task_id, author_email, client_request_id)
  where client_request_id is not null;

create index if not exists task_comments_task_idx on task_comments (task_id, created_at);

-- Emoji reactions. No task_id column on purpose: the loader queries by the
-- comment ids it just fetched, and an independent FK to tasks could not prove
-- the reaction's comment belongs to that task. No separate comment_id index
-- either — the unique constraint below already leads with it.
-- RLS comes from the `protected_tables` loop at the end of this file.
create table if not exists task_comment_reactions (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references task_comments(id) on delete cascade,
  reactor_email text not null
    constraint task_comment_reactions_reactor_email_normalized
    check (
      reactor_email <> ''
      and reactor_email = lower(btrim(reactor_email))
    ),
  emoji text not null,
  created_at timestamptz not null default now(),
  -- Makes PUT idempotent via `on conflict do nothing`, so a retry after a lost
  -- response re-adds the reaction instead of toggling it off.
  unique (comment_id, reactor_email, emoji)
);

-- Keep identity canonical even when this idempotent schema is applied over a
-- database created by an earlier reaction rollout.
delete from task_comment_reactions
where btrim(reactor_email) = '';

with ranked as (
  select
    id,
    row_number() over (
      partition by comment_id, lower(btrim(reactor_email)), emoji
      order by created_at, id
    ) as duplicate_number
  from task_comment_reactions
)
delete from task_comment_reactions as reaction
using ranked
where reaction.id = ranked.id
  and ranked.duplicate_number > 1;

update task_comment_reactions
set reactor_email = lower(btrim(reactor_email))
where reactor_email <> lower(btrim(reactor_email));

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'task_comment_reactions'::regclass
      and conname = 'task_comment_reactions_reactor_email_normalized'
  ) then
    alter table task_comment_reactions
      add constraint task_comment_reactions_reactor_email_normalized
      check (
        reactor_email <> ''
        and reactor_email = lower(btrim(reactor_email))
      );
  end if;
end $$;

create or replace function set_task_comment_reaction_atomic(
  p_comment_id uuid,
  p_task_id uuid,
  p_reactor_email text,
  p_emoji text,
  p_present boolean
) returns table (
  comment_id uuid,
  emoji text,
  reactor_email text,
  changed boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_comment_id uuid;
  v_deleted_at timestamptz;
  v_reactor_email text;
  v_changed boolean := false;
  v_row_count integer := 0;
begin
  v_reactor_email := lower(btrim(coalesce(p_reactor_email, '')));
  if v_reactor_email = '' then
    raise exception 'INVALID_REACTOR_EMAIL';
  end if;
  if coalesce(char_length(p_emoji), 0) < 1 or char_length(p_emoji) > 16 then
    raise exception 'INVALID_EMOJI';
  end if;

  select comment.id, comment.deleted_at
  into v_comment_id, v_deleted_at
  from task_comments as comment
  where comment.id = p_comment_id
    and comment.task_id = p_task_id
  for update;
  if not found or v_deleted_at is not null then
    raise exception 'COMMENT_NOT_FOUND';
  end if;

  if p_present then
    insert into task_comment_reactions (comment_id, reactor_email, emoji)
    values (p_comment_id, v_reactor_email, p_emoji)
    on conflict do nothing;
    get diagnostics v_row_count = row_count;
    v_changed := v_row_count > 0;
  else
    delete from task_comment_reactions as reaction
    where reaction.comment_id = p_comment_id
      and reaction.reactor_email = v_reactor_email
      and reaction.emoji = p_emoji;
    get diagnostics v_row_count = row_count;
    v_changed := v_row_count > 0;
  end if;

  return query
  select reaction.comment_id, reaction.emoji, reaction.reactor_email, v_changed
  from task_comment_reactions as reaction
  where reaction.comment_id = p_comment_id
  order by reaction.created_at, reaction.id;
end;
$$;

revoke all on function set_task_comment_reaction_atomic(
  uuid, uuid, text, text, boolean
) from public, anon, authenticated;
grant execute on function set_task_comment_reaction_atomic(
  uuid, uuid, text, text, boolean
) to service_role;

create or replace function task_comment_reactions_for_task(
  p_task_id uuid
) returns table (
  comment_id uuid,
  emoji text,
  reactor_email text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select reaction.comment_id, reaction.emoji, reaction.reactor_email
  from task_comment_reactions as reaction
  join task_comments as comment
    on comment.id = reaction.comment_id
  where comment.task_id = p_task_id
    and comment.deleted_at is null
  order by reaction.created_at, reaction.id;
$$;

revoke all on function task_comment_reactions_for_task(uuid)
  from public, anon, authenticated;
grant execute on function task_comment_reactions_for_task(uuid)
  to service_role;

-- Edit history: one row per edit, holding the body BEFORE that edit.
create table if not exists task_comment_edits (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references task_comments(id) on delete cascade,
  previous_body text not null,
  edited_by text not null,
  edited_at timestamptz not null default now()
);

create index if not exists task_comment_edits_comment_idx
  on task_comment_edits (comment_id, edited_at desc);

create table if not exists task_attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  comment_id uuid references task_comments(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  mime_type text,
  size_bytes bigint,
  uploaded_by text,
  created_at timestamptz not null default now()
);

-- Optional upload token makes a retried multipart request return the original
-- attachment instead of creating a second metadata row. Scope it to the task
-- and uploader so two people can legitimately upload the same file.
alter table task_attachments add column if not exists client_request_id uuid;
alter table task_attachments add column if not exists deleted_at timestamptz;

create unique index if not exists task_attachments_client_request_id_key
  on task_attachments (task_id, uploaded_by, client_request_id)
  where client_request_id is not null;

create index if not exists task_attachments_active_idx
  on task_attachments (task_id)
  where deleted_at is null;

-- Comment and attachment writes are intentionally command-only (the atomic
-- RPCs below validate task_id/parent_id together). Keep this narrow index for
-- the command/audit lookups; a trigger would add avoidable write overhead and
-- still could not repair legacy inconsistent rows automatically.
create index if not exists task_attachments_comment_active_idx
  on task_attachments (comment_id)
  where deleted_at is null;

create index if not exists task_attachments_task_idx on task_attachments (task_id);

create table if not exists task_activity (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  actor_email text not null,
  type text not null,
  meta jsonb,
  created_at timestamptz not null default now()
);

create index if not exists task_activity_task_idx on task_activity (task_id, created_at);

-- Backfill the actor side of the timestamp pair after the activity table
-- exists. The tie-breaker keeps the result deterministic for same-timestamp
-- historical rows.
-- Use a correlated scalar subquery instead of a FROM LATERAL reference. The
-- PostgreSQL UPDATE target alias is not visible inside a FROM item at this
-- level (42P10), while it is valid in the SET expression and preserves the
-- same deterministic latest-human-actor selection.
update tasks t
set last_activity_by_email = (
  select a.actor_email
  from task_activity a
  where a.task_id = t.id and a.actor_email <> 'system'
  order by a.created_at desc, a.id desc
  limit 1
)
where t.last_activity_by_email is null
  and exists (
    select 1
    from task_activity a
    where a.task_id = t.id and a.actor_email <> 'system'
  );

create or replace function task_list_metadata(task_ids uuid[])
returns table (
  task_id uuid,
  last_activity_by_email text,
  comment_count integer,
  attachment_count integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    ids.id as task_id,
    t.last_activity_by_email,
    (
      select count(*)::integer
      from task_comments c
      where c.task_id = t.id
        and c.deleted_at is null
    ) as comment_count,
    (
      select count(*)::integer
      from task_attachments att
      where att.task_id = t.id
        and att.deleted_at is null
    ) as attachment_count
  from unnest(task_ids) as ids(id)
  left join tasks t on t.id = ids.id;
$$;

delete from task_activity
where type = 'due_changed';

do $$
begin
  if exists (
    select 1 from pg_constraint where conname = 'task_activity_type_check'
  ) then
    alter table task_activity drop constraint task_activity_type_check;
  end if;

  alter table task_activity
  add constraint task_activity_type_check
  check (
    type in (
      'created',
      'assigned',
      'unassigned',
      'status_changed',
      'reopened',
      'task_reopened',
      'priority_changed',
      'category_changed',
      'agent_changed',
      'done_reviewed',
      'done_review_cleared',
      'edited',
      'comment_added',
      'comment_edited',
      'comment_deleted',
      'attachment_added',
      'attachment_deleted',
      'went_overdue',
      'overdue_unlocked'
    )
  ) not valid;
end $$;

-- Read-only reconciliation helpers for task collaboration. They are
-- intentionally reporting-only: repair scripts must use an approved target
-- list rather than guessing from duplicate text or incomplete activity.
create or replace function audit_comment_activity_gaps()
returns table (task_id uuid, comment_count bigint, activity_count bigint)
language sql stable security definer set search_path = public as $$
  select c.task_id, count(*) as comment_count,
    (select count(*) from task_activity a where a.task_id = c.task_id and a.type = 'comment_added')
  from task_comments c
  where c.deleted_at is null
  group by c.task_id
  having count(*) <> (select count(*) from task_activity a where a.task_id = c.task_id and a.type = 'comment_added');
$$;

create or replace function audit_last_activity_mismatch()
returns table (task_id uuid, last_activity_at timestamptz, newest_actor text,
               newest_activity_at timestamptz, newest_type text)
language sql stable security definer set search_path = public as $$
  select t.id, t.last_activity_at, a.actor_email, a.created_at, a.type
  from tasks t join lateral (
    select actor_email, created_at, type from task_activity
    where task_id = t.id order by created_at desc limit 1
  ) a on true
  where a.actor_email = 'system' and t.last_activity_at is not null and a.created_at > t.last_activity_at;
$$;

create or replace function audit_overdue_gaps()
returns table (task_id uuid, has_activity boolean, has_event boolean)
language sql stable security definer set search_path = public as $$
  select t.id,
    exists (select 1 from task_activity a where a.task_id = t.id and a.type = 'went_overdue'),
    exists (select 1 from task_overdue_events e where e.task_id = t.id)
  from tasks t
  where t.overdue_flagged_at is not null and (
    not exists (select 1 from task_activity a where a.task_id = t.id and a.type = 'went_overdue')
    or not exists (select 1 from task_overdue_events e where e.task_id = t.id)
  );
$$;

create or replace function audit_duplicate_comments()
returns table (task_id uuid, author_email text, body text, copies bigint,
               spread_seconds double precision, ids uuid[])
language sql stable security definer set search_path = public as $$
  select task_id, author_email, body, count(*),
    extract(epoch from (max(created_at) - min(created_at))), array_agg(id order by created_at)
  from task_comments
  where deleted_at is null and body <> ''
  group by task_id, author_email, parent_id, body
  having count(*) > 1;
$$;

create or replace function audit_cross_task_comment_links()
returns table (kind text, row_id uuid, task_id uuid, linked_task_id uuid)
language sql stable security definer set search_path = public as $$
  select 'reply_cross_task'::text, child.id, child.task_id, parent.task_id
  from task_comments child
  join task_comments parent on parent.id = child.parent_id
  where child.task_id <> parent.task_id
  union all
  select 'reply_nested'::text, child.id, child.task_id, parent.task_id
  from task_comments child
  join task_comments parent on parent.id = child.parent_id
  where parent.parent_id is not null
  union all
  select 'attachment_cross_task'::text, attachment.id, attachment.task_id, comment.task_id
  from task_attachments attachment
  join task_comments comment on comment.id = attachment.comment_id
  where attachment.task_id <> comment.task_id;
$$;

revoke all on function audit_comment_activity_gaps() from public, anon, authenticated;
revoke all on function audit_last_activity_mismatch() from public, anon, authenticated;
revoke all on function audit_overdue_gaps() from public, anon, authenticated;
revoke all on function audit_duplicate_comments() from public, anon, authenticated;
revoke all on function audit_cross_task_comment_links() from public, anon, authenticated;
grant execute on function audit_comment_activity_gaps() to service_role;
grant execute on function audit_last_activity_mismatch() to service_role;
grant execute on function audit_overdue_gaps() to service_role;
grant execute on function audit_duplicate_comments() to service_role;
grant execute on function audit_cross_task_comment_links() to service_role;

-- Commit attachment metadata removal and its required audit event first. The
-- storage object is returned to the route for best-effort cleanup after the
-- database transaction, so a storage outage can only leave an orphan object,
-- never visible metadata pointing at a missing file.
create or replace function delete_task_attachment_atomic(
  p_attachment_id uuid,
  p_actor_email text
) returns table (storage_path text, task_id uuid, comment_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_row task_attachments%rowtype;
  v_task tasks%rowtype;
  v_now timestamptz;
begin
  select * into v_row from task_attachments where id = p_attachment_id for update;
  if not found then raise exception 'ATTACHMENT_NOT_FOUND'; end if;
  select * into v_task from tasks where id = v_row.task_id for update;
  if not found then raise exception 'TASK_NOT_FOUND'; end if;
  delete from task_attachments where id = p_attachment_id;
  insert into task_activity (task_id, actor_email, type, meta)
  values (v_row.task_id, p_actor_email, 'attachment_deleted',
    jsonb_build_object('attachment_id', p_attachment_id, 'comment_id', v_row.comment_id));
  v_now := greatest(clock_timestamp(), v_task.updated_at + interval '1 microsecond');
  update tasks set updated_at = v_now, last_activity_at = v_now, stale_reminded_at = null
  where id = v_row.task_id;
  storage_path := v_row.storage_path;
  task_id := v_row.task_id;
  comment_id := v_row.comment_id;
  return next;
end $$;

revoke all on function delete_task_attachment_atomic(uuid, text) from public, anon, authenticated;
grant execute on function delete_task_attachment_atomic(uuid, text) to service_role;

-- Create a comment, its required audit row, mention participants, and the
-- parent activity/version bump as one transaction. The task lock is acquired
-- before the idempotency lookup so two concurrent retries cannot both observe
-- a missing request token and race into a unique-index error.
create or replace function create_task_comment_atomic(
  p_task_id uuid,
  p_author_email text,
  p_body text,
  p_parent_id uuid,
  p_client_request_id uuid,
  p_mentions text[]
) returns table (comment jsonb, parent_updated_at timestamptz, was_created boolean)
language plpgsql security definer set search_path = public as $$
declare
  v_comment task_comments%rowtype;
  v_task tasks%rowtype;
  v_now timestamptz;
begin
  select * into v_task
  from tasks
  where id = p_task_id
  for update;
  if not found then
    raise exception 'TASK_NOT_FOUND';
  end if;

  -- A retry returns the committed row and the current parent version without
  -- writing a second activity row or touching task timestamps.
  if p_client_request_id is not null then
    select * into v_comment
    from task_comments
    where task_id = p_task_id
      and author_email = p_author_email
      and client_request_id = p_client_request_id;
    if found then
      comment := to_jsonb(v_comment);
      parent_updated_at := v_task.updated_at;
      was_created := false;
      return next;
      return;
    end if;
  end if;

  if p_parent_id is not null then
    perform 1
    from task_comments
    where id = p_parent_id
      and task_id = p_task_id
      and parent_id is null
      and deleted_at is null;
    if not found then
      raise exception 'INVALID_PARENT';
    end if;
  end if;

  insert into task_comments (
    task_id, parent_id, author_email, body, client_request_id
  ) values (
    p_task_id, p_parent_id, p_author_email, p_body, p_client_request_id
  ) returning * into v_comment;

  insert into task_activity (task_id, actor_email, type, meta)
  values (
    p_task_id,
    p_author_email,
    'comment_added',
    jsonb_build_object('comment_id', v_comment.id, 'parent_id', p_parent_id)
  );

  if p_mentions is not null and array_length(p_mentions, 1) > 0 then
    insert into task_participants (task_id, email, source)
    select p_task_id, mention_email, 'mention'
    from unnest(p_mentions) as mention_email
    where mention_email is not null and btrim(mention_email) <> ''
    on conflict (task_id, email) do nothing;
  end if;

  v_now := greatest(clock_timestamp(), v_task.updated_at + interval '1 microsecond');
  update tasks
  set updated_at = v_now,
      last_activity_at = v_now,
      last_activity_by_email = p_author_email,
      stale_reminded_at = null
  where id = p_task_id;

  comment := to_jsonb(v_comment);
  parent_updated_at := v_now;
  was_created := true;
  return next;
end;
$$;

revoke all on function create_task_comment_atomic(uuid, text, text, uuid, uuid, text[])
  from public, anon, authenticated;
grant execute on function create_task_comment_atomic(uuid, text, text, uuid, uuid, text[])
  to service_role;

-- Commit attachment metadata and its audit event together. Storage is outside
-- the database transaction, so the route uploads first and compensates only
-- the just-created object if this command fails. On an idempotent replay it
-- returns the original path so the route never deletes the valid first upload.
create or replace function create_task_attachment_atomic(
  p_task_id uuid,
  p_comment_id uuid,
  p_storage_path text,
  p_file_name text,
  p_mime_type text,
  p_size_bytes bigint,
  p_uploaded_by text,
  p_client_request_id uuid
) returns table (attachment jsonb, was_created boolean, replayed_path text)
language plpgsql security definer set search_path = public as $$
declare
  v_row task_attachments%rowtype;
  v_task tasks%rowtype;
  v_now timestamptz;
begin
  select * into v_task
  from tasks
  where id = p_task_id
  for update;
  if not found then raise exception 'TASK_NOT_FOUND'; end if;

  if p_client_request_id is not null then
    select * into v_row
    from task_attachments
    where task_id = p_task_id
      and uploaded_by = p_uploaded_by
      and client_request_id = p_client_request_id;
    if found then
      attachment := to_jsonb(v_row);
      was_created := false;
      replayed_path := v_row.storage_path;
      return next;
      return;
    end if;
  end if;

  if p_comment_id is not null then
    perform 1
    from task_comments
    where id = p_comment_id
      and task_id = p_task_id
      and deleted_at is null;
    if not found then raise exception 'INVALID_COMMENT'; end if;
  end if;

  insert into task_attachments (
    task_id, comment_id, storage_path, file_name, mime_type, size_bytes,
    uploaded_by, client_request_id
  ) values (
    p_task_id, p_comment_id, p_storage_path, p_file_name, p_mime_type,
    p_size_bytes, p_uploaded_by, p_client_request_id
  ) returning * into v_row;

  insert into task_activity (task_id, actor_email, type, meta)
  values (
    p_task_id,
    p_uploaded_by,
    'attachment_added',
    jsonb_build_object('attachment_id', v_row.id, 'comment_id', p_comment_id)
  );

  if p_comment_id is null then
    v_now := greatest(clock_timestamp(), v_task.updated_at + interval '1 microsecond');
    update tasks
    set updated_at = v_now,
        last_activity_at = v_now,
        last_activity_by_email = p_uploaded_by,
        stale_reminded_at = null
    where id = p_task_id;
  end if;

  attachment := to_jsonb(v_row);
  was_created := true;
  replayed_path := null;
  return next;
end;
$$;

revoke all on function create_task_attachment_atomic(uuid, uuid, text, text, text, bigint, text, uuid)
  from public, anon, authenticated;
grant execute on function create_task_attachment_atomic(uuid, uuid, text, text, text, bigint, text, uuid)
  to service_role;

-- Compare-and-swap comment edits. The task lock keeps the returned parent
-- version aligned with the activity/timestamp update, while the history and
-- audit inserts remain in the same transaction as the new body.
create or replace function edit_task_comment_atomic(
  p_comment_id uuid,
  p_task_id uuid,
  p_actor_email text,
  p_body text,
  p_expected_updated_at timestamptz,
  p_new_mentions text[]
) returns table (comment jsonb, parent_updated_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_task tasks%rowtype;
  v_row task_comments%rowtype;
  v_now timestamptz;
begin
  select * into v_task from tasks where id = p_task_id for update;
  if not found then raise exception 'TASK_NOT_FOUND'; end if;

  select * into v_row
  from task_comments
  where id = p_comment_id and task_id = p_task_id
  for update;
  if not found then raise exception 'COMMENT_NOT_FOUND'; end if;
  if v_row.author_email <> p_actor_email then raise exception 'FORBIDDEN'; end if;
  if v_row.deleted_at is not null then raise exception 'COMMENT_DELETED'; end if;
  if p_expected_updated_at is not null and v_row.updated_at <> p_expected_updated_at then
    raise exception 'COMMENT_CONFLICT';
  end if;

  if v_row.body = p_body then
    comment := to_jsonb(v_row);
    parent_updated_at := v_task.updated_at;
    return next;
    return;
  end if;

  insert into task_comment_edits (comment_id, previous_body, edited_by)
  values (p_comment_id, v_row.body, p_actor_email);

  v_now := greatest(clock_timestamp(), v_row.updated_at + interval '1 microsecond');
  update task_comments
  set body = p_body, updated_at = v_now
  where id = p_comment_id
  returning * into v_row;

  insert into task_activity (task_id, actor_email, type, meta)
  values (
    p_task_id,
    p_actor_email,
    'comment_edited',
    jsonb_build_object('comment_id', p_comment_id)
  );

  if p_new_mentions is not null and array_length(p_new_mentions, 1) > 0 then
    insert into task_participants (task_id, email, source)
    select p_task_id, mention_email, 'mention'
    from unnest(p_new_mentions) as mention_email
    where mention_email is not null and btrim(mention_email) <> ''
    on conflict (task_id, email) do nothing;
  end if;

  v_now := greatest(clock_timestamp(), v_task.updated_at + interval '1 microsecond');
  update tasks
  set updated_at = v_now,
      last_activity_at = v_now,
      last_activity_by_email = p_actor_email,
      stale_reminded_at = null
  where id = p_task_id;

  comment := to_jsonb(v_row);
  parent_updated_at := v_now;
  return next;
end;
$$;

revoke all on function edit_task_comment_atomic(uuid, uuid, text, text, timestamptz, text[])
  from public, anon, authenticated;
grant execute on function edit_task_comment_atomic(uuid, uuid, text, text, timestamptz, text[])
  to service_role;

-- Soft-delete a comment and all linked attachment metadata in one transaction.
-- Replies remain under the deleted-parent placeholder. Storage objects are
-- removed after commit as best-effort, so a storage outage cannot roll back or
-- leave searchable active metadata behind.
create or replace function delete_task_comment_atomic(
  p_comment_id uuid,
  p_task_id uuid,
  p_actor_email text
) returns table (storage_paths text[], attachment_count integer)
language plpgsql security definer set search_path = public as $$
declare
  v_task tasks%rowtype;
  v_row task_comments%rowtype;
  v_paths text[];
  v_now timestamptz;
begin
  select * into v_task from tasks where id = p_task_id for update;
  if not found then raise exception 'TASK_NOT_FOUND'; end if;
  select * into v_row
  from task_comments
  where id = p_comment_id and task_id = p_task_id
  for update;
  if not found then raise exception 'COMMENT_NOT_FOUND'; end if;
  if v_row.author_email <> p_actor_email then raise exception 'FORBIDDEN'; end if;

  if v_row.deleted_at is not null then
    storage_paths := '{}';
    attachment_count := 0;
    return next;
    return;
  end if;

  select coalesce(array_agg(storage_path order by created_at), '{}')
  into v_paths
  from task_attachments
  where comment_id = p_comment_id and deleted_at is null;

  v_now := greatest(clock_timestamp(), v_task.updated_at + interval '1 microsecond');
  update task_comments
  set deleted_at = v_now, body = ''
  where id = p_comment_id;
  update task_attachments
  set deleted_at = v_now
  where comment_id = p_comment_id and deleted_at is null;

  -- Reactions mean nothing once the body is blanked, and because this is a
  -- SOFT delete the comment row survives, so the FK cascade never collects
  -- them. Without this they leak forever, invisibly.
  delete from task_comment_reactions where comment_id = p_comment_id;

  insert into task_activity (task_id, actor_email, type, meta)
  values (
    p_task_id,
    p_actor_email,
    'comment_deleted',
    jsonb_build_object(
      'comment_id', p_comment_id,
      'attachment_count', coalesce(array_length(v_paths, 1), 0)
    )
  );

  update tasks
  set updated_at = v_now,
      last_activity_at = v_now,
      last_activity_by_email = p_actor_email,
      stale_reminded_at = null
  where id = p_task_id;

  storage_paths := v_paths;
  attachment_count := coalesce(array_length(v_paths, 1), 0);
  return next;
end;
$$;

revoke all on function delete_task_comment_atomic(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function delete_task_comment_atomic(uuid, uuid, text)
  to service_role;

create table if not exists task_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_email text not null,
  task_id uuid not null references tasks(id) on delete cascade,
  type text not null check (type in ('assigned','mentioned','commented')),
  actor_email text not null,
  comment_id uuid,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists task_notifications_recipient_idx
  on task_notifications (recipient_email, is_read, created_at desc);

-- Optional free-text detail carried by a notification (e.g. the overdue reason).
alter table task_notifications add column if not exists detail text;

do $$
begin
  if exists (
    select 1 from pg_constraint where conname = 'task_notifications_type_check'
  ) then
    alter table task_notifications drop constraint task_notifications_type_check;
  end if;

  alter table task_notifications
  add constraint task_notifications_type_check
  check (
    type in (
      'assigned',
      'mentioned',
      'commented',
      'reacted',
      'overdue',
      'todo_reminder',
      'overdue_reminder',
      'waiting_reminder',
      'unassigned',
      'reopened',
      'qc_needed',
      'due_soon',
      'stale',
      'overdue_unlocked',
      'qc_stale',
      'sla_escalated',
      'qc_reviewed',
      'cancelled',
      'attachment_added',
      'backlog_attention'
    )
  );
end $$;

-- People who can see a task without being its assignee (e.g. @mentioned in a
-- comment, or explicitly added). Used to widen task visibility for collaboration.
create table if not exists task_participants (
  task_id uuid not null references tasks(id) on delete cascade,
  email text not null,
  source text not null default 'mention'
    check (source in ('mention', 'added')),
  created_at timestamptz not null default now(),
  primary key (task_id, email)
);

create index if not exists task_participants_email_idx
  on task_participants (email);

-- Multi-assignee source of truth for tasks. The legacy tasks.assignee_email
-- column is kept temporarily and mirrored by application code during rollout.
create table if not exists task_assignees (
  task_id uuid not null references tasks(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now(),
  primary key (task_id, email)
);

create index if not exists task_assignees_email_idx
  on task_assignees (email);

-- Backfill from the legacy single-assignee column (idempotent).
insert into task_assignees (task_id, email)
select id, assignee_email from tasks
where assignee_email is not null
on conflict (task_id, email) do nothing;

create table if not exists task_assignment_cycles (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  email text not null,
  assigned_at timestamptz not null,
  unassigned_at timestamptz,
  assigned_by_email text,
  unassigned_by_email text,
  source text,
  created_at timestamptz not null default now(),
  check (unassigned_at is null or unassigned_at >= assigned_at)
);

create index if not exists task_assignment_cycles_task_idx
  on task_assignment_cycles (task_id, email, assigned_at desc);

create unique index if not exists task_assignment_cycles_open_idx
  on task_assignment_cycles (task_id, email)
  where unassigned_at is null;

insert into task_assignment_cycles (
  task_id,
  email,
  assigned_at,
  source
)
select
  ta.task_id,
  ta.email,
  ta.created_at,
  'backfill'
from task_assignees ta
where not exists (
  select 1 from task_assignment_cycles c
  where c.task_id = ta.task_id
    and c.email = ta.email
    and c.unassigned_at is null
);

-- Create the task, its initial collaboration history, and assignment/stage
-- cycles as one durable command. Rotation, notifications, and broadcasts stay
-- outside this transaction because they affect other rows/providers. A
-- request token replays the committed task without duplicating any audit row.
create or replace function create_task_atomic(
  p_task jsonb,
  p_assignees text[] default '{}'::text[],
  p_actor_email text default null,
  p_client_request_id uuid default null
)
returns table (task jsonb, was_created boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task tasks%rowtype;
  v_now timestamptz := clock_timestamp();
  v_actor text := lower(trim(p_actor_email));
  v_assignees text[];
  v_status text;
  v_started_at timestamptz;
  v_sla_minutes integer;
begin
  if v_actor is null or v_actor = '' then
    raise exception 'TASK_ACTOR_REQUIRED';
  end if;
  if p_task is null or jsonb_typeof(p_task) <> 'object' then
    raise exception 'TASK_PAYLOAD_INVALID';
  end if;
  if btrim(coalesce(p_task->>'title', '')) = '' then
    raise exception 'TASK_TITLE_REQUIRED';
  end if;

  select coalesce(array_agg(distinct lower(trim(input_email.email)) order by lower(trim(input_email.email))), '{}'::text[])
    into v_assignees
  from unnest(coalesce(p_assignees, '{}'::text[])) as input_email(email)
  where btrim(input_email.email) <> '';

  v_status := coalesce(nullif(p_task->>'status', ''), 'backlog');
  if v_status not in ('backlog', 'todo', 'in_progress', 'waiting', 'done', 'cancel') then
    raise exception 'TASK_STATUS_INVALID';
  end if;
  v_sla_minutes := nullif(p_task->>'sla_minutes', '')::integer;

  -- ON CONFLICT waits for a concurrent creator to commit, then the replay
  -- SELECT below returns its canonical row. No second activity/cycle is made.
  insert into tasks (
    title, description, fub_link, status, priority, category_id,
    agent_email, assignee_email, reporter_email, custom_values, position,
    last_activity_at, last_activity_by_email, client_request_id,
    todo_started_at, in_progress_at, waiting_started_at, closed_at,
    sla_minutes, stale_reminded_at, created_at, updated_at
  ) values (
    btrim(p_task->>'title'),
    nullif(btrim(p_task->>'description'), ''),
    nullif(btrim(p_task->>'fub_link'), ''),
    v_status,
    coalesce(nullif(p_task->>'priority', ''), 'medium'),
    nullif(p_task->>'category_id', '')::uuid,
    nullif(lower(trim(p_task->>'agent_email')), ''),
    case when v_status = 'backlog' then null else nullif(lower(trim(p_task->>'assignee_email')), '') end,
    v_actor,
    coalesce(p_task->'custom_values', '{}'::jsonb),
    coalesce(nullif(p_task->>'position', '')::double precision, 0),
    v_now,
    v_actor,
    p_client_request_id,
    nullif(p_task->>'todo_started_at', '')::timestamptz,
    nullif(p_task->>'in_progress_at', '')::timestamptz,
    nullif(p_task->>'waiting_started_at', '')::timestamptz,
    nullif(p_task->>'closed_at', '')::timestamptz,
    case when v_status = 'in_progress' then v_sla_minutes else null end,
    null,
    v_now,
    v_now
  )
  on conflict (reporter_email, client_request_id) where client_request_id is not null
  do nothing
  returning * into v_task;

  if not found then
    select * into v_task
    from tasks
    where reporter_email = v_actor
      and client_request_id = p_client_request_id
    for update;
    if not found then
      raise exception 'TASK_CREATE_REPLAY_NOT_FOUND';
    end if;
    task := to_jsonb(v_task);
    was_created := false;
    return next;
    return;
  end if;

  if array_length(v_assignees, 1) is not null then
    insert into task_assignees (task_id, email, created_at)
    select v_task.id, assignee_email, v_now
    from unnest(v_assignees) as assignee_email;

    insert into task_assignment_cycles (
      task_id, email, assigned_at, assigned_by_email, source
    )
    select v_task.id, assignee_email, v_now, v_actor, 'create'
    from unnest(v_assignees) as assignee_email;
  end if;

  v_started_at := case v_task.status
    when 'todo' then coalesce(v_task.todo_started_at, v_now)
    when 'in_progress' then coalesce(v_task.in_progress_at, v_now)
    when 'waiting' then coalesce(v_task.waiting_started_at, v_now)
    when 'done' then coalesce(v_task.closed_at, v_now)
    when 'cancel' then coalesce(v_task.closed_at, v_now)
    else v_task.created_at
  end;
  insert into task_stage_cycles (
    task_id, stage, started_at, started_by_email, from_status,
    sla_minutes, due_at, meta
  ) values (
    v_task.id,
    v_task.status,
    v_started_at,
    v_actor,
    null,
    case when v_task.status = 'in_progress' then v_task.sla_minutes else null end,
    case when v_task.status = 'in_progress' and v_task.sla_minutes is not null
      then v_started_at + make_interval(mins => v_task.sla_minutes)
      else null end,
    jsonb_build_object('source', 'create')
  );

  insert into task_activity (task_id, actor_email, type, meta)
  values (
    v_task.id,
    v_actor,
    'created',
    case when array_length(v_assignees, 1) is not null
      then jsonb_build_object('assignees', to_jsonb(v_assignees))
      else null end
  );

  task := to_jsonb(v_task);
  was_created := true;
  return next;
end;
$$;

revoke all on function create_task_atomic(jsonb, text[], text, uuid)
  from public, anon, authenticated;
grant execute on function create_task_atomic(jsonb, text[], text, uuid)
  to service_role;

-- Flip a task into overdue exactly once and commit its event/audit rows with
-- that flip. A concurrent cron invocation sees row_count = 0 and must not
-- notify or insert a second event. System bookkeeping deliberately does not
-- move the human last-activity pair.
create or replace function mark_task_overdue_atomic(
  p_task_id uuid,
  p_due_at timestamptz,
  p_sla_minutes integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_updated integer;
begin
  update tasks
  set overdue_flagged_at = v_now,
      overdue_reminded_at = v_now,
      overdue_count = coalesce(overdue_count, 0) + 1
  where id = p_task_id
    and status = 'in_progress'
    and overdue_flagged_at is null;
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    return false;
  end if;

  insert into task_overdue_events (
    task_id, stage_cycle_id, due_at, overdue_at, sla_minutes
  ) values (
    p_task_id,
    (
      select c.id
      from task_stage_cycles c
      where c.task_id = p_task_id
        and c.stage = 'in_progress'
        and c.ended_at is null
      order by c.started_at desc
      limit 1
    ),
    p_due_at,
    v_now,
    p_sla_minutes
  )
  -- Targets task_overdue_events_open_idx (unique on task_id where resolved_at
  -- is null). The guard above only proves tasks.overdue_flagged_at was null;
  -- it does not prove there is no open event, and those two drifted apart on
  -- 2026-08-16 (60 tasks). The insert then raised a duplicate-key error that
  -- escaped the cron handler and killed the whole sweep every 15 minutes.
  -- Keeping the existing open event is the correct outcome: the task is
  -- already recorded as overdue.
  on conflict (task_id) where resolved_at is null do nothing;

  insert into task_activity (task_id, actor_email, type, meta)
  values (
    p_task_id,
    'system',
    'went_overdue',
    jsonb_build_object('due_at', p_due_at, 'flagged_at', v_now)
  );
  return true;
end;
$$;

revoke all on function mark_task_overdue_atomic(uuid, timestamptz, integer)
  from public, anon, authenticated;
grant execute on function mark_task_overdue_atomic(uuid, timestamptz, integer)
  to service_role;

-- Generic task PATCH command. The API validates permissions, field shape, SLA
-- transitions, and required fields before calling this function; the
-- function is the transaction boundary for the writes that must describe one
-- mutation consistently: the canonical task row, assignee junction/cycles,
-- stage/overdue history, last-activity token, and task activity entries.
-- Notifications and realtime broadcasts remain best-effort side effects after
-- this command and must never make a committed task mutation look failed.
create or replace function patch_task_atomic(
  p_task_id uuid,
  p_expected_updated_at timestamptz,
  p_patch jsonb,
  p_before_assignees text[] default '{}'::text[],
  p_next_assignees text[] default null,
  p_actor_email text default null,
  p_activity jsonb default '[]'::jsonb,
  p_overdue jsonb default null,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_task tasks%rowtype;
  next_task tasks%rowtype;
  open_stage record;
  open_overdue record;
  activity_entry jsonb;
  next_assignee_email text;
  old_started_at timestamptz;
  next_started_at timestamptz;
  next_sla_minutes integer;
  next_sla_active boolean;
  overdue_at timestamptz;
  due_at timestamptz;
  resolved_at_value timestamptz;
  overdue_seconds_value integer;
  moves_last_activity boolean;
begin
  if p_actor_email is null or btrim(p_actor_email) = '' then
    raise exception 'TASK_ACTOR_REQUIRED';
  end if;

  select * into target_task
  from tasks
  where id = p_task_id
  for update;

  if not found then
    raise exception 'TASK_NOT_FOUND';
  end if;

  if p_expected_updated_at is null or target_task.updated_at <> p_expected_updated_at then
    raise exception 'TASK_CONFLICT';
  end if;

  -- Reordering a row is a presentation-only mutation. Every other PATCH
  -- represents a human edit (including custom values), and therefore moves
  -- the timestamp/actor pair together. Keep this decision inside the locked
  -- command so callers cannot accidentally update only one side of F10.
  moves_last_activity :=
    coalesce(jsonb_array_length(p_activity), 0) > 0
    or exists (
      select 1
      from jsonb_object_keys(coalesce(p_patch, '{}'::jsonb)) as patch_key(key)
      where patch_key.key <> 'position'
    );

  update tasks
  set
    title = case when p_patch ? 'title' then p_patch->>'title' else title end,
    description = case when p_patch ? 'description' then p_patch->>'description' else description end,
    fub_link = case when p_patch ? 'fub_link' then p_patch->>'fub_link' else fub_link end,
    status = case when p_patch ? 'status' then p_patch->>'status' else status end,
    priority = case when p_patch ? 'priority' then p_patch->>'priority' else priority end,
    category_id = case when p_patch ? 'category_id' then (p_patch->>'category_id')::uuid else category_id end,
    custom_values = case when p_patch ? 'custom_values' then p_patch->'custom_values' else custom_values end,
    agent_email = case when p_patch ? 'agent_email' then p_patch->>'agent_email' else agent_email end,
    assignee_email = case when p_patch ? 'assignee_email' then p_patch->>'assignee_email' else assignee_email end,
    done_reviewed_by_email = case when p_patch ? 'done_reviewed_by_email' then p_patch->>'done_reviewed_by_email' else done_reviewed_by_email end,
    done_reviewed_at = case when p_patch ? 'done_reviewed_at' then (p_patch->>'done_reviewed_at')::timestamptz else done_reviewed_at end,
    position = case when p_patch ? 'position' then (p_patch->>'position')::double precision else position end,
    todo_started_at = case when p_patch ? 'todo_started_at' then (p_patch->>'todo_started_at')::timestamptz else todo_started_at end,
    todo_reminded_at = case when p_patch ? 'todo_reminded_at' then (p_patch->>'todo_reminded_at')::timestamptz else todo_reminded_at end,
    todo_seconds = case when p_patch ? 'todo_seconds' then (p_patch->>'todo_seconds')::integer else todo_seconds end,
    in_progress_at = case when p_patch ? 'in_progress_at' then (p_patch->>'in_progress_at')::timestamptz else in_progress_at end,
    in_progress_seconds = case when p_patch ? 'in_progress_seconds' then (p_patch->>'in_progress_seconds')::integer else in_progress_seconds end,
    waiting_started_at = case when p_patch ? 'waiting_started_at' then (p_patch->>'waiting_started_at')::timestamptz else waiting_started_at end,
    waiting_reminded_at = case when p_patch ? 'waiting_reminded_at' then (p_patch->>'waiting_reminded_at')::timestamptz else waiting_reminded_at end,
    waiting_seconds = case when p_patch ? 'waiting_seconds' then (p_patch->>'waiting_seconds')::integer else waiting_seconds end,
    overdue_flagged_at = case when p_patch ? 'overdue_flagged_at' then (p_patch->>'overdue_flagged_at')::timestamptz else overdue_flagged_at end,
    overdue_reminded_at = case when p_patch ? 'overdue_reminded_at' then (p_patch->>'overdue_reminded_at')::timestamptz else overdue_reminded_at end,
    overdue_unlocked_at = case when p_patch ? 'overdue_unlocked_at' then (p_patch->>'overdue_unlocked_at')::timestamptz else overdue_unlocked_at end,
    due_soon_notified_at = case when p_patch ? 'due_soon_notified_at' then (p_patch->>'due_soon_notified_at')::timestamptz else due_soon_notified_at end,
    sla_minutes = case when p_patch ? 'sla_minutes' then (p_patch->>'sla_minutes')::integer else sla_minutes end,
    overdue_count = case when p_patch ? 'overdue_count' then (p_patch->>'overdue_count')::integer else overdue_count end,
    closed_at = case when p_patch ? 'closed_at' then (p_patch->>'closed_at')::timestamptz else closed_at end,
    reopened_at = case when p_patch ? 'reopened_at' then (p_patch->>'reopened_at')::timestamptz else reopened_at end,
    updated_at = p_now,
    last_activity_at = case
      when moves_last_activity then p_now
      else last_activity_at
    end,
    last_activity_by_email = case
      when moves_last_activity
        and (last_activity_at is null or p_now >= last_activity_at)
        then p_actor_email
      else last_activity_by_email
    end,
    stale_reminded_at = null
  where id = p_task_id
    and updated_at = p_expected_updated_at
  returning * into next_task;

  if not found then
    raise exception 'TASK_CONFLICT';
  end if;

  -- Keep the legacy primary assignee and junction source of truth in one
  -- transaction. A null p_next_assignees means this PATCH did not reassign.
  if p_next_assignees is not null then
    delete from task_assignees where task_id = p_task_id;
    foreach next_assignee_email in array p_next_assignees loop
      insert into task_assignees (task_id, email, created_at)
      values (p_task_id, next_assignee_email, p_now);
    end loop;

    foreach next_assignee_email in array coalesce(p_before_assignees, '{}'::text[]) loop
      if not (next_assignee_email = any(p_next_assignees)) then
        update task_assignment_cycles
        set unassigned_at = p_now,
            unassigned_by_email = p_actor_email,
            source = 'patch'
        where task_id = p_task_id
          and email = next_assignee_email
          and unassigned_at is null;
      end if;
    end loop;

    foreach next_assignee_email in array p_next_assignees loop
      if not (next_assignee_email = any(coalesce(p_before_assignees, '{}'::text[]))) then
        insert into task_assignment_cycles (
          task_id, email, assigned_at, assigned_by_email, source
        ) values (
          p_task_id, next_assignee_email, p_now, p_actor_email, 'patch'
        );
      end if;
    end loop;
  end if;

  -- Resolve an active overdue event before closing the In Progress stage so
  -- the event can retain its current open stage_cycle_id.
  if p_overdue is not null and jsonb_typeof(p_overdue) = 'object' then
    due_at := (p_overdue->>'due_at')::timestamptz;
    resolved_at_value := (p_overdue->>'resolved_at')::timestamptz;
    overdue_seconds_value := greatest(0, round(extract(epoch from (resolved_at_value - due_at)))::integer);
    select id, overdue_at into open_overdue
    from task_overdue_events
    where task_id = p_task_id and resolved_at is null
    order by overdue_at desc
    limit 1
    for update;

    overdue_at := coalesce(open_overdue.overdue_at, target_task.overdue_flagged_at, due_at);
    if open_overdue.id is not null then
      update task_overdue_events
      set stage_cycle_id = (
            select id from task_stage_cycles
            where task_id = p_task_id and stage = 'in_progress' and ended_at is null
            order by started_at desc limit 1
          ),
          resolved_at = resolved_at_value,
          overdue_seconds = overdue_seconds_value,
          resolved_by_email = p_actor_email,
          reason = p_overdue->>'reason',
          sla_minutes = (p_overdue->>'sla_minutes')::integer
      where id = open_overdue.id;
    else
      insert into task_overdue_events (
        task_id, stage_cycle_id, due_at, overdue_at, resolved_at,
        overdue_seconds, resolved_by_email, reason, sla_minutes
      ) values (
        p_task_id,
        (
          select id from task_stage_cycles
          where task_id = p_task_id and stage = 'in_progress' and ended_at is null
          order by started_at desc limit 1
        ),
        due_at,
        overdue_at,
        resolved_at_value,
        overdue_seconds_value,
        p_actor_email,
        p_overdue->>'reason',
        (p_overdue->>'sla_minutes')::integer
      ) on conflict do nothing;
    end if;
  end if;

  -- Stage history is required history, not a best-effort notification. Keep
  -- the close/open pair in the same transaction as the task row update.
  if target_task.status <> next_task.status then
    select id, started_at into open_stage
    from task_stage_cycles
    where task_id = p_task_id and ended_at is null
    order by started_at desc
    limit 1
    for update;

    if open_stage.id is not null then
      update task_stage_cycles
      set ended_at = p_now,
          duration_seconds = greatest(0, round(extract(epoch from (p_now - open_stage.started_at)))::integer),
          ended_by_email = p_actor_email,
          to_status = next_task.status
      where id = open_stage.id;
    else
      old_started_at := case target_task.status
        when 'todo' then coalesce(target_task.todo_started_at, target_task.updated_at, target_task.created_at)
        when 'in_progress' then coalesce(target_task.in_progress_at, target_task.updated_at, target_task.created_at)
        when 'waiting' then coalesce(target_task.waiting_started_at, target_task.updated_at, target_task.created_at)
        when 'done' then coalesce(target_task.closed_at, target_task.updated_at, target_task.created_at)
        when 'cancel' then coalesce(target_task.closed_at, target_task.updated_at, target_task.created_at)
        else target_task.created_at
      end;
      insert into task_stage_cycles (
        task_id, stage, started_at, ended_at, duration_seconds,
        ended_by_email, to_status, sla_minutes, due_at, meta
      ) values (
        p_task_id,
        target_task.status,
        old_started_at,
        p_now,
        greatest(0, round(extract(epoch from (p_now - old_started_at)))::integer),
        p_actor_email,
        next_task.status,
        case when target_task.status = 'in_progress'
          and target_task.overdue_count = 0
          and target_task.waiting_started_at is null
          and coalesce(target_task.waiting_seconds, 0) = 0
          then target_task.sla_minutes else null end,
        case when target_task.status = 'in_progress'
          and target_task.overdue_count = 0
          and target_task.waiting_started_at is null
          and coalesce(target_task.waiting_seconds, 0) = 0
          and target_task.sla_minutes is not null
          then old_started_at + make_interval(mins => target_task.sla_minutes) else null end,
        jsonb_build_object('source', 'fallback-close')
      );
    end if;

    next_started_at := case next_task.status
      when 'todo' then coalesce(next_task.todo_started_at, p_now)
      when 'in_progress' then coalesce(next_task.in_progress_at, p_now)
      when 'waiting' then coalesce(next_task.waiting_started_at, p_now)
      when 'done' then coalesce(next_task.closed_at, p_now)
      when 'cancel' then coalesce(next_task.closed_at, p_now)
      else p_now
    end;
    next_sla_active := next_task.status = 'in_progress'
      and target_task.overdue_count = 0
      and target_task.waiting_started_at is null
      and coalesce(target_task.waiting_seconds, 0) = 0;
    next_sla_minutes := case when next_sla_active then next_task.sla_minutes else null end;
    insert into task_stage_cycles (
      task_id, stage, started_at, started_by_email, from_status,
      sla_minutes, due_at, meta
    ) values (
      p_task_id,
      next_task.status,
      next_started_at,
      p_actor_email,
      target_task.status,
      next_sla_minutes,
      case when next_sla_minutes is not null
        then next_started_at + make_interval(mins => next_sla_minutes)
        else null end,
      null
    );
  end if;

  if jsonb_typeof(p_activity) = 'array' then
    for activity_entry in select value from jsonb_array_elements(p_activity) loop
      insert into task_activity (task_id, actor_email, type, meta)
      values (
        p_task_id,
        p_actor_email,
        activity_entry->>'type',
        case when activity_entry->'meta' = 'null'::jsonb then null else activity_entry->'meta' end
      );
    end loop;
  end if;

  return to_jsonb(next_task);
end;
$$;

create table if not exists task_assignment_rotation (
  email text primary key,
  queue_due_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists task_assignment_rotation_due_idx
  on task_assignment_rotation (queue_due_at, email);

create table if not exists task_assignment_queue_members (
  email text primary key,
  is_enabled boolean not null default true,
  updated_by_email text,
  updated_at timestamptz not null default now()
);

create index if not exists task_assignment_queue_members_enabled_idx
  on task_assignment_queue_members (is_enabled, email);

create or replace function bump_task_assignment_rotation(
  p_email text,
  p_minutes integer,
  p_now timestamptz default now()
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_email text := lower(trim(p_email));
  minutes integer := greatest(0, coalesce(p_minutes, 0));
  next_due_at timestamptz;
begin
  if normalized_email is null or normalized_email = '' then
    raise exception 'ROTATION_EMAIL_REQUIRED';
  end if;

  insert into task_assignment_rotation as rotation (
    email,
    queue_due_at,
    updated_at
  ) values (
    normalized_email,
    p_now + make_interval(mins => minutes),
    p_now
  )
  on conflict (email) do update
  set queue_due_at = greatest(rotation.queue_due_at, p_now) + make_interval(mins => minutes),
      updated_at = p_now
  returning queue_due_at into next_due_at;

  return next_due_at;
end;
$$;

-- People selected as task agents/team owners. This is independent of the
-- legacy portal_account.role value.
create table if not exists task_agents (
  email text not null primary key,
  created_at timestamptz not null default now()
);

-- Which assistants support which task agent (many-to-many). Admin-managed.
-- CS assignees are a company pool; this table only grants assistant/agent-owner
-- task management scope for a specific agent.
create table if not exists agent_members (
  agent_email text not null,
  cs_email text not null,
  created_at timestamptz not null default now(),
  primary key (agent_email, cs_email)
);
create index if not exists agent_members_cs_idx on agent_members (cs_email);
create index if not exists agent_members_agent_idx on agent_members (agent_email);

-- A CS member promoted to "Assistant" for that agent gets the same rights as
-- the agent owner on that agent's tasks (edit content, reopen overdue,
-- reopen, QC review, assign, delete) — a deputy, not just a worker.
alter table agent_members add column if not exists is_assistant boolean not null default false;

-- Admin membership writes are serialized and validated in one transaction. The
-- graph is deliberately one-hop for authorization, but rejecting reachability
-- cycles keeps future scope expansion from creating an accidental privilege
-- loop. Existing non-assistant legacy rows are promoted in place; an active
-- assistant duplicate is reported to the API as a conflict.
create or replace function create_agent_membership_atomic(
  p_agent_email text,
  p_cs_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_agent text := nullif(lower(btrim(p_agent_email)), '');
  normalized_assistant text := nullif(lower(btrim(p_cs_email)), '');
  existing_is_assistant boolean;
begin
  if normalized_agent is null or normalized_assistant is null then
    raise exception using message = 'ASSISTANT_EMAIL_REQUIRED';
  end if;

  if normalized_agent = normalized_assistant then
    raise exception using message = 'ASSISTANT_SELF_MEMBERSHIP';
  end if;

  -- A single lock serializes membership mutations, including concurrent writes
  -- that would otherwise both pass the duplicate/cycle checks.
  perform pg_advisory_xact_lock(hashtextextended('assistant-memberships', 0));

  if not exists (
    select 1
    from task_agents agent
    join portal_account account
      on lower(btrim(account.email)) = normalized_agent
     and account.is_active
    where lower(btrim(agent.email)) = normalized_agent
  ) then
    raise exception using message = 'ASSISTANT_AGENT_INELIGIBLE';
  end if;

  if not exists (
    select 1
    from portal_account account
    where lower(btrim(account.email)) = normalized_assistant
      and account.is_active
  ) then
    raise exception using message = 'ASSISTANT_ACCOUNT_INELIGIBLE';
  end if;

  select is_assistant into existing_is_assistant
  from agent_members
  where lower(btrim(agent_email)) = normalized_agent
    and lower(btrim(cs_email)) = normalized_assistant
  for update;

  if coalesce(existing_is_assistant, false) then
    raise exception using message = 'ASSISTANT_DUPLICATE_MEMBERSHIP';
  end if;

  if exists (
    with recursive reachable(email) as (
      select lower(btrim(member.cs_email))
      from agent_members member
      where lower(btrim(member.agent_email)) = normalized_assistant
        and member.is_assistant
      union
      select lower(btrim(member.cs_email))
      from agent_members member
      join reachable parent on lower(btrim(member.agent_email)) = parent.email
      where member.is_assistant
    )
    select 1 from reachable where email = normalized_agent
  ) then
    raise exception using message = 'ASSISTANT_MEMBERSHIP_CYCLE';
  end if;

  if existing_is_assistant is not null then
    update agent_members
    set agent_email = normalized_agent,
        cs_email = normalized_assistant,
        is_assistant = true
    where lower(btrim(agent_email)) = normalized_agent
      and lower(btrim(cs_email)) = normalized_assistant;
  else
    insert into agent_members (agent_email, cs_email, is_assistant)
    values (normalized_agent, normalized_assistant, true)
    on conflict (agent_email, cs_email)
    do update set is_assistant = true;
  end if;

  return jsonb_build_object(
    'agent_email', normalized_agent,
    'cs_email', normalized_assistant,
    'is_assistant', true
  );
end;
$$;

revoke all on function create_agent_membership_atomic(text, text) from public, anon, authenticated;
grant execute on function create_agent_membership_atomic(text, text) to service_role;

create or replace function delete_task_agent_atomic(p_email text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_email text := nullif(lower(btrim(p_email)), '');
  deleted_agent boolean := false;
begin
  if normalized_email is null then
    raise exception 'AGENT_EMAIL_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('task-agent|' || normalized_email, 0));
  delete from agent_members
  where lower(btrim(agent_email)) = normalized_email;
  delete from task_agents
  where lower(btrim(email)) = normalized_email;
  deleted_agent := found;
  return deleted_agent;
end;
$$;

revoke all on function delete_task_agent_atomic(text) from public, anon, authenticated;
grant execute on function delete_task_agent_atomic(text) to service_role;

-- Atomic admin claim used by the CS workload overview. The task row lock is the
-- concurrency boundary: only one manager can turn a backlog task into a todo
-- assignment, while the legacy assignee column and the junction remain mirrored.
create or replace function assign_unassigned_task(
  p_task_id uuid,
  p_cs_email text,
  p_expected_updated_at timestamptz,
  p_actor_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_task tasks%rowtype;
  normalized_cs_email text := lower(trim(p_cs_email));
  now_iso timestamptz := now();
  rotation_minutes integer;
begin
  if not exists (
    select 1
    from portal_account account
    where lower(trim(account.email)) = normalized_cs_email
      and account.is_active
      and account.role <> 'admin'
      and exists (
        select 1
        from user_roles ur
        join role_permissions rp on rp.role_id = ur.role_id
        join roles r on r.id = ur.role_id
        where ur.user_id = account.id
          and rp.permission_key = 'task.work'
          and r.is_active
      )
      and not exists (
        select 1 from task_agents ta
        where lower(trim(ta.email)) = normalized_cs_email
      )
      and not exists (
        select 1 from agent_members am
        where lower(trim(am.cs_email)) = normalized_cs_email
          and am.is_assistant
      )
      and not exists (
        select 1 from task_assignment_queue_members queue_member
        where lower(trim(queue_member.email)) = normalized_cs_email
          and not queue_member.is_enabled
      )
      and not exists (
        select 1
        from user_roles ur
        join roles r on r.id = ur.role_id
        where ur.user_id = account.id
          and r.is_active
          and r.name in ('Admin', 'Super Admin')
      )
  ) then
    raise exception 'INVALID_CS';
  end if;

  select * into target_task
  from tasks
  where id = p_task_id
  for update;

  if not found then
    raise exception 'TASK_NOT_FOUND';
  end if;

  if p_expected_updated_at is not null
    and target_task.updated_at <> p_expected_updated_at then
    raise exception 'ASSIGN_CONFLICT';
  end if;

  if target_task.status <> 'backlog'
    or target_task.assignee_email is not null
    or exists (select 1 from task_assignees ta where ta.task_id = p_task_id) then
    raise exception 'ASSIGN_CONFLICT';
  end if;

  update tasks
  set status = 'todo',
      assignee_email = normalized_cs_email,
      todo_started_at = now_iso,
      todo_reminded_at = null,
      updated_at = now_iso,
      last_activity_at = now_iso,
      last_activity_by_email = p_actor_email,
      stale_reminded_at = null
  where id = p_task_id;

  insert into task_assignees (task_id, email, created_at)
  values (p_task_id, normalized_cs_email, now_iso);

  insert into task_assignment_cycles (
    task_id, email, assigned_at, assigned_by_email, source
  ) values (
    p_task_id, normalized_cs_email, now_iso, p_actor_email, 'overview'
  );

  update task_stage_cycles
  set ended_at = now_iso,
      duration_seconds = greatest(0, extract(epoch from (now_iso - started_at))::integer),
      ended_by_email = p_actor_email,
      to_status = 'todo'
  where task_id = p_task_id
    and ended_at is null;

  insert into task_stage_cycles (
    task_id, stage, started_at, started_by_email, from_status, sla_minutes, due_at, meta
  ) values (
    p_task_id, 'todo', now_iso, p_actor_email, 'backlog', null, null,
    jsonb_build_object('source', 'overview')
  );

  insert into task_activity (task_id, actor_email, type, meta)
  values (
    p_task_id, p_actor_email, 'assigned',
    jsonb_build_object('to', normalized_cs_email, 'source', 'overview')
  );

  select coalesce(
    target_task.sla_minutes,
    (
      select rule.duration_minutes
      from task_sla_rules rule
      where rule.priority = target_task.priority
        and rule.category_id = target_task.category_id
      limit 1
    ),
    (
      select rule.duration_minutes
      from task_sla_rules rule
      where rule.priority = target_task.priority
        and rule.category_id is null
      limit 1
    ),
    case target_task.priority
      when 'urgent' then 60
      when 'high' then 240
      when 'medium' then 480
      else 1440
    end
  ) into rotation_minutes;

  perform bump_task_assignment_rotation(
    normalized_cs_email,
    rotation_minutes,
    now_iso
  );

  return jsonb_build_object(
    'task_id', p_task_id,
    'email', normalized_cs_email,
    'updated_at', now_iso
  );
end;
$$;

-- Backfill selected task agents from existing groups (idempotent).
insert into task_agents (email)
select distinct agent_email from agent_members
on conflict (email) do nothing;

-- Health Enrollment module. Kept separate from CS task tables to avoid
-- polymorphic collaboration-table risk during task go-live.
create table if not exists enrollment_option_sets (
  id uuid primary key default gen_random_uuid(),
  program text not null default 'aca'
    check (program in ('aca', 'medicare')),
  key text not null
    check (key in ('stage', 'carrier', 'platform', 'consent', 'payment_status', 'aca_status')),
  label text not null,
  is_stage boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Program split: option sets are scoped per program (ACA vs Medicare), so each
-- program configures its own Stage/Carrier/etc. Migrate an existing single-program
-- table: add the column, drop the old key-only unique, enforce uniqueness per program.
alter table enrollment_option_sets
  add column if not exists program text not null default 'aca';
alter table enrollment_option_sets
  drop constraint if exists enrollment_option_sets_key_key;
alter table enrollment_option_sets
  drop constraint if exists enrollment_option_sets_program_check;
alter table enrollment_option_sets
  add constraint enrollment_option_sets_program_check
  check (program in ('aca', 'medicare'));
create unique index if not exists enrollment_option_sets_program_key_idx
  on enrollment_option_sets (program, key);

create table if not exists enrollment_options (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references enrollment_option_sets(id) on delete restrict,
  label text not null,
  color text,
  position integer not null default 0,
  is_terminal boolean not null default false,
  treat_as_terminal boolean not null default false,
  triggers_qc boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

-- Added after the table shipped, so it needs its own ALTER: `create table if
-- not exists` is a no-op on an existing database and would leave the column
-- missing, which the ACA option seed below then fails on.
alter table enrollment_options
  add column if not exists treat_as_terminal boolean not null default false;

create unique index if not exists enrollment_options_active_label_key
  on enrollment_options (set_id, lower(label))
  where archived_at is null;

create index if not exists enrollment_options_set_position_idx
  on enrollment_options (set_id, archived_at, position, label);

create table if not exists table_column (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('cs','aca','medicare')),
  key text not null,
  label text not null,
  type text not null
    check (type in ('text','number','dropdown','date','checkbox','link','person')),
  is_system boolean not null default false,
  position integer not null default 0,
  pinned boolean not null default false,
  hidden_default boolean not null default false,
  show_in_detail boolean not null default false,
  required boolean not null default false,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (scope, key)
);

create table if not exists table_column_option (
  id uuid primary key default gen_random_uuid(),
  column_id uuid not null references table_column(id) on delete cascade,
  label text not null,
  color text,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

-- Version-aware single-statement column reorder. The expected order is
-- compared only after deterministic row locks are acquired, so concurrent
-- Config editors cannot silently overwrite one another.
create or replace function reorder_table_columns_atomic(
  p_scope text,
  p_expected_column_keys text[],
  p_column_keys text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_keys text[] := array[]::text[];
  active_count integer := 0;
  duplicate_count integer := 0;
begin
  if p_scope not in ('cs', 'aca', 'medicare')
    or p_expected_column_keys is null
    or p_column_keys is null then
    raise exception 'COLUMN_ORDER_INVALID';
  end if;

  if exists (
    select 1
    from unnest(p_expected_column_keys) as requested(value)
    where requested.value is null or btrim(requested.value) = ''
  ) or exists (
    select 1
    from unnest(p_column_keys) as requested(value)
    where requested.value is null or btrim(requested.value) = ''
  ) then
    raise exception 'COLUMN_ORDER_INVALID';
  end if;

  select count(*) into duplicate_count
  from (
    select value
    from unnest(p_column_keys) as requested(value)
    group by value
    having count(*) > 1
  ) duplicates;
  if duplicate_count > 0 then raise exception 'COLUMN_ORDER_INVALID'; end if;

  -- Lock in a deterministic order before reading current positions.
  perform 1
  from table_column column_row
  where column_row.scope = p_scope
    and column_row.archived_at is null
  order by column_row.id
  for update;

  select count(*) into active_count
  from table_column column_row
  where column_row.scope = p_scope
    and column_row.archived_at is null;

  if cardinality(p_column_keys) <> active_count
    or cardinality(p_expected_column_keys) <> active_count
    or exists (
      select 1
      from unnest(p_column_keys) as requested(value)
      where not exists (
        select 1
        from table_column column_row
        where column_row.scope = p_scope
          and column_row.archived_at is null
          and column_row.key = requested.value
      )
    ) then
    raise exception 'COLUMN_ORDER_INVALID';
  end if;

  select coalesce(
    array_agg(column_row.key order by column_row.position, column_row.label, column_row.key),
    array[]::text[]
  )
  into current_keys
  from table_column column_row
  where column_row.scope = p_scope
    and column_row.archived_at is null;

  if current_keys is distinct from p_expected_column_keys then
    raise exception 'COLUMN_ORDER_STALE';
  end if;

  update table_column column_row
  set position = desired.position,
      updated_at = clock_timestamp()
  from unnest(p_column_keys) with ordinality as desired(key, position)
  where column_row.scope = p_scope
    and column_row.archived_at is null
    and column_row.key = desired.key;

  return jsonb_build_object(
    'scope', p_scope,
    'column_keys', coalesce(
      (select jsonb_agg(column_row.key order by column_row.position, column_row.label, column_row.key)
       from table_column column_row
       where column_row.scope = p_scope and column_row.archived_at is null),
      '[]'::jsonb
    )
  );
end;
$$;

revoke all on function reorder_table_columns_atomic(text, text[], text[]) from public, anon, authenticated;
grant execute on function reorder_table_columns_atomic(text, text[], text[]) to service_role;

-- Narrow, service-role-only validation context used by Task and Enrollment
-- mutations.  Keeping the metadata lookup and conditional Person matching in
-- one RPC prevents inline edits from adding a metadata query plus a full
-- roster load to the write path.
create or replace function table_config_write_context(
  p_scope text,
  p_mode text,
  p_touched_system_keys text[] default array[]::text[],
  p_touched_custom_keys text[] default array[]::text[],
  p_submitted_custom_values jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  requested_keys text[] := array[]::text[];
  candidate_ids uuid[] := array[]::uuid[];
  columns_json jsonb := '[]'::jsonb;
  options_json jsonb := '[]'::jsonb;
  matched_people jsonb := '[]'::jsonb;
  person_emails text[] := array[]::text[];
begin
  if p_scope not in ('cs', 'aca', 'medicare') then
    raise exception 'WRITE_CONTEXT_SCOPE_INVALID';
  end if;
  if p_mode not in ('create', 'patch') then
    raise exception 'WRITE_CONTEXT_MODE_INVALID';
  end if;
  if cardinality(coalesce(p_touched_system_keys, array[]::text[])) > 100
    or cardinality(coalesce(p_touched_custom_keys, array[]::text[])) > 100
    or exists (
      select 1
      from unnest(array_cat(
        coalesce(p_touched_system_keys, array[]::text[]),
        coalesce(p_touched_custom_keys, array[]::text[])
      )) as requested(value)
      where length(requested.value) > 128
    ) then
    raise exception 'WRITE_CONTEXT_INPUT_TOO_LARGE';
  end if;
  -- These two guards MUST stay separate. PostgreSQL does not promise
  -- left-to-right short-circuiting of OR, so folding them into one condition
  -- lets jsonb_object_keys() run against a non-object and raise 22023 before
  -- the type check can reject it.
  if jsonb_typeof(coalesce(p_submitted_custom_values, '{}'::jsonb)) <> 'object' then
    raise exception 'WRITE_CONTEXT_VALUES_INVALID';
  end if;
  -- There is no jsonb_object_length() in PostgreSQL. The earlier call to it
  -- parsed fine (plpgsql bodies are not resolved at CREATE time) and then
  -- failed at 42883 on every single invocation, which the client mapped to
  -- "Table configuration is temporarily unavailable" and hid the real cause.
  if (select count(*)
      from jsonb_object_keys(coalesce(p_submitted_custom_values, '{}'::jsonb))) > 100 then
    raise exception 'WRITE_CONTEXT_VALUES_INVALID';
  end if;

  select coalesce(array_agg(distinct btrim(value)), array[]::text[])
  into requested_keys
  from unnest(array_cat(
    coalesce(p_touched_system_keys, array[]::text[]),
    coalesce(p_touched_custom_keys, array[]::text[])
  )) as requested(value)
  where nullif(btrim(value), '') is not null;

  select coalesce(array_agg(column_row.id), array[]::uuid[])
  into candidate_ids
  from table_column column_row
  where column_row.scope = p_scope
    and column_row.archived_at is null
    and (
      (p_mode = 'create' and (column_row.required or column_row.key = any(requested_keys)))
      or (p_mode = 'patch' and column_row.key = any(requested_keys))
    );

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', column_row.id,
        'scope', column_row.scope,
        'key', column_row.key,
        'label', column_row.label,
        'type', column_row.type,
        'is_system', column_row.is_system,
        'position', column_row.position,
        'pinned', column_row.pinned,
        'hidden_default', column_row.hidden_default,
        'show_in_detail', column_row.show_in_detail,
        'required', column_row.required,
        'created_by_email', column_row.created_by_email,
        'created_at', column_row.created_at,
        'updated_at', column_row.updated_at,
        'archived_at', column_row.archived_at
      )
      order by column_row.position, column_row.label, column_row.key
    ),
    '[]'::jsonb
  )
  into columns_json
  from table_column column_row
  where column_row.id = any(candidate_ids);

  if cardinality(candidate_ids) > 0 then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', option_row.id,
          'column_id', option_row.column_id,
          'label', option_row.label,
          'color', option_row.color,
          'position', option_row.position,
          'created_at', option_row.created_at,
          'updated_at', option_row.updated_at,
          'archived_at', option_row.archived_at
        )
        order by option_row.column_id, option_row.position, option_row.label, option_row.id
      ),
      '[]'::jsonb
    )
    into options_json
    from table_column_option option_row
    where option_row.column_id = any(candidate_ids)
      and option_row.archived_at is null;
  end if;

  -- This block is deliberately conditional.  Non-Person writes never touch
  -- the account/role tables, keeping the common dropdown/text path cheap.
  select coalesce(array_agg(distinct lower(btrim(entry.value))), array[]::text[])
  into person_emails
  from table_column column_row
  cross join lateral jsonb_each_text(coalesce(p_submitted_custom_values, '{}'::jsonb)) entry
  where cardinality(candidate_ids) > 0
    and column_row.id = any(candidate_ids)
    and column_row.is_system = false
    and column_row.type = 'person'
    and entry.key = column_row.key
    and nullif(btrim(entry.value), '') is not null;

  if cardinality(person_emails) > 0 then
    if p_scope = 'cs' then
      select coalesce(jsonb_agg(lower(btrim(account.email)) order by lower(btrim(account.email))), '[]'::jsonb)
      into matched_people
      from portal_account account
      where account.is_active
        and lower(btrim(account.email)) = any(person_emails)
        and exists (
          select 1
          from user_roles user_role
          join role_permissions permission on permission.role_id = user_role.role_id
          where user_role.user_id = account.id
            and permission.permission_key in ('task.work', 'task.manage')
        );
    else
      select coalesce(jsonb_agg(lower(btrim(account.email)) order by lower(btrim(account.email))), '[]'::jsonb)
      into matched_people
      from portal_account account
      where account.is_active
        and lower(btrim(account.email)) = any(person_emails);
    end if;
  end if;

  return jsonb_build_object(
    'columns', columns_json,
    'options', options_json,
    'matched_person_emails', matched_people
  );
end;
$$;

revoke all on function table_config_write_context(text, text, text[], text[], jsonb)
  from public, anon, authenticated;
grant execute on function table_config_write_context(text, text, text[], text[], jsonb)
  to service_role;

create or replace function create_table_column_option(
  p_column_id uuid,
  p_label text,
  p_color text default null,
  p_position integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  column_row table_column%rowtype;
  option_row table_column_option%rowtype;
  next_position integer;
  normalized_label text := nullif(btrim(p_label), '');
begin
  if p_column_id is null or normalized_label is null then
    raise exception 'COLUMN_AND_LABEL_REQUIRED';
  end if;
  if p_color is not null and p_color !~ '^#[0-9a-fA-F]{6}$' then
    raise exception 'INVALID_OPTION_COLOR';
  end if;
  if p_position is not null and (p_position < 0 or p_position > 2147483647) then
    raise exception 'INVALID_OPTION_POSITION';
  end if;

  select * into column_row
  from table_column
  where id = p_column_id
  for update;
  if not found then raise exception 'COLUMN_NOT_FOUND'; end if;
  if column_row.type <> 'dropdown' or column_row.is_system or column_row.archived_at is not null then
    raise exception 'CUSTOM_DROPDOWN_REQUIRED';
  end if;

  if p_position is null then
    select coalesce(max(position), 0) + 10 into next_position
    from table_column_option
    where column_id = p_column_id and archived_at is null;
    if next_position < 0 then raise exception 'OPTION_POSITION_OVERFLOW'; end if;
  else
    next_position := p_position;
  end if;

  insert into table_column_option (column_id, label, color, position)
  values (p_column_id, normalized_label, p_color, next_position)
  returning * into option_row;
  return to_jsonb(option_row);
end;
$$;

revoke all on function create_table_column_option(uuid, text, text, integer) from public, anon, authenticated;
grant execute on function create_table_column_option(uuid, text, text, integer) to service_role;

create index if not exists table_column_scope_position_idx
  on table_column (scope, archived_at, position, label);
create index if not exists table_column_option_column_idx
  on table_column_option (column_id, archived_at, position, label);
create unique index if not exists table_column_option_active_label_uniq
  on table_column_option (column_id, lower(btrim(label)))
  where archived_at is null;

alter table table_column
  add column if not exists pinned boolean not null default false;
alter table table_column
  add column if not exists show_in_detail boolean not null default false;

create table if not exists user_table_layout (
  id uuid primary key default gen_random_uuid(),
  user_email text not null,
  scope text not null check (scope in ('cs','aca','medicare')),
  layout jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  unique (user_email, scope)
);

create table if not exists import_request (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('cs','aca','medicare')),
  submitted_by_email text not null,
  status text not null default 'pending'
    check (status in ('pending','processing','approved','rejected','failed')),
  match_column_key text not null,
  column_mapping jsonb not null default '{}'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  reviewed_by_email text,
  reviewed_at timestamptz,
  reject_reason text,
  created_at timestamptz not null default now()
);

create table if not exists import_request_row (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references import_request(id) on delete cascade,
  action text not null check (action in ('add','update','error')),
  target_record_id uuid,
  values jsonb not null default '{}'::jsonb,
  error_text text,
  created_at timestamptz not null default now()
);

create index if not exists user_table_layout_user_scope_idx
  on user_table_layout (user_email, scope);
create index if not exists import_request_pending_idx
  on import_request (scope, status);
create index if not exists import_request_row_req_idx
  on import_request_row (request_id);
alter table import_request
  drop constraint if exists import_request_status_check;
alter table import_request
  add constraint import_request_status_check
  check (status in ('pending','processing','approved','rejected','failed'));

create table if not exists enrollment_records (
  id uuid primary key default gen_random_uuid(),
  program text not null default 'aca'
    check (program in ('aca', 'medicare')),
  client_name text,
  description text,
  fub_link text,
  due_date date,
  stage_id uuid references enrollment_options(id) on delete restrict,
  carrier_id uuid references enrollment_options(id) on delete restrict,
  platform_id uuid references enrollment_options(id) on delete restrict,
  consent_id uuid references enrollment_options(id) on delete restrict,
  payment_status_id uuid references enrollment_options(id) on delete restrict,
  aca_status_id uuid references enrollment_options(id) on delete restrict,
  pcp_2025 text,
  pcp_2026 text,
  caller_email text,
  -- Declared here as well as in the later ADD COLUMN IF NOT EXISTS: the
  -- normalization UPDATE further down runs before that ALTER, so on a database
  -- where this CREATE TABLE actually creates the table the file used to abort
  -- with 42703. Both statements must stay -- this one serves fresh databases,
  -- the ALTER serves databases that predate the column.
  agent_email text,
  responsible_enroll_email text,
  qc_checked_by_email text,
  qc_checked_at timestamptz,
  due_soon_notified_at timestamptz,
  overdue_notified_at timestamptz,
  overdue_reminded_at timestamptz,
  qc_stale_notified_at timestamptz,
  closed_at timestamptz,
  created_by_email text not null,
  created_at timestamptz not null default now(),
  updated_by_email text,
  updated_at timestamptz not null default now(),
  custom_values jsonb not null default '{}'::jsonb,
  archived_at timestamptz,
  stage_entered_at timestamptz,
  stage_entered_source text,
  last_activity_at timestamptz,
  last_activity_by_email text,
  last_work_activity_at timestamptz,
  responsible_assigned_at timestamptz
);

-- Durable human-facing key. UUIDs remain the internal/API identifier. ACA and
-- Medicare have independent counters and render as ACA-* and MED-*.
create sequence if not exists enrollment_records_aca_display_number_seq;
create sequence if not exists enrollment_records_medicare_display_number_seq;
alter table enrollment_records add column if not exists display_number bigint;
alter table enrollment_records alter column display_number drop default;
drop index if exists enrollment_records_display_number_key;

do $$
declare
  aca_max bigint;
  medicare_max bigint;
begin
  select max(display_number) into aca_max
  from enrollment_records
  where program = 'aca';
  select max(display_number) into medicare_max
  from enrollment_records
  where program = 'medicare';

  if aca_max is null then
    perform setval('enrollment_records_aca_display_number_seq', 1, false);
  else
    perform setval('enrollment_records_aca_display_number_seq', aca_max, true);
  end if;
  if medicare_max is null then
    perform setval('enrollment_records_medicare_display_number_seq', 1, false);
  else
    perform setval('enrollment_records_medicare_display_number_seq', medicare_max, true);
  end if;
end $$;

create or replace function enrollment_records_assign_display_number()
returns trigger
language plpgsql
as $$
begin
  if new.display_number is null then
    new.display_number := case new.program
      when 'medicare' then nextval('enrollment_records_medicare_display_number_seq')
      else nextval('enrollment_records_aca_display_number_seq')
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists enrollment_records_assign_display_number_trigger
  on enrollment_records;
create trigger enrollment_records_assign_display_number_trigger
before insert on enrollment_records
for each row
execute function enrollment_records_assign_display_number();

alter table enrollment_records alter column display_number set not null;
create unique index if not exists enrollment_records_program_display_number_key
  on enrollment_records (program, display_number);

alter table enrollment_records
  add column if not exists stage_entered_at timestamptz,
  add column if not exists stage_entered_source text,
  add column if not exists last_activity_at timestamptz,
  add column if not exists last_activity_by_email text;

-- Archive confirmation counts use JSONB containment over active records only.
-- Keep these indexes partial so archived history does not inflate the index or
-- the on-demand count path. The production rollout creates them concurrently.
create index if not exists tasks_custom_values_active_gin_idx
  on tasks using gin (custom_values jsonb_path_ops)
  where archived_at is null;

create or replace function table_column_option_usage_count(
  p_column_id uuid,
  p_option_id uuid
)
returns bigint
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  column_row table_column%rowtype;
  usage_count bigint;
begin
  select * into column_row
  from table_column
  where id = p_column_id
    and archived_at is null
    and not is_system
    and type = 'dropdown';
  if not found then
    raise exception 'CONFIG_OPTION_NOT_FOUND';
  end if;

  if not exists (
    select 1
    from table_column_option option_row
    where option_row.id = p_option_id
      and option_row.column_id = p_column_id
      and option_row.archived_at is null
  ) then
    raise exception 'CONFIG_OPTION_NOT_FOUND';
  end if;

  if column_row.scope = 'cs' then
    select count(*)::bigint into usage_count
    from tasks
    where archived_at is null
      and custom_values @> jsonb_build_object(column_row.key, p_option_id::text);
  else
    select count(*)::bigint into usage_count
    from enrollment_records
    where archived_at is null
      and program = column_row.scope
      and custom_values @> jsonb_build_object(column_row.key, p_option_id::text);
  end if;
  return usage_count;
end;
$$;

revoke all on function table_column_option_usage_count(uuid, uuid)
  from public, anon, authenticated;
grant execute on function table_column_option_usage_count(uuid, uuid)
  to service_role;

create or replace function enrollment_option_usage_count(p_option_id uuid)
returns bigint
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  option_program text;
  usage_count bigint;
begin
  select option_set.program into option_program
  from enrollment_options option_row
  join enrollment_option_sets option_set on option_set.id = option_row.set_id
  where option_row.id = p_option_id
    and option_row.archived_at is null;
  if not found then
    raise exception 'CONFIG_OPTION_NOT_FOUND';
  end if;

  select count(*)::bigint into usage_count
  from enrollment_records record_row
  where record_row.archived_at is null
    and record_row.program = option_program
    and (
      record_row.stage_id = p_option_id
      or record_row.carrier_id = p_option_id
      or record_row.platform_id = p_option_id
      or record_row.consent_id = p_option_id
      or record_row.payment_status_id = p_option_id
      or record_row.aca_status_id = p_option_id
    );
  return usage_count;
end;
$$;

revoke all on function enrollment_option_usage_count(uuid)
  from public, anon, authenticated;
grant execute on function enrollment_option_usage_count(uuid)
  to service_role;

alter table enrollment_records
  drop constraint if exists enrollment_records_stage_entered_source_check;
alter table enrollment_records
  add constraint enrollment_records_stage_entered_source_check
  check (
    stage_entered_source is null
    or stage_entered_source in ('live', 'history_backfill', 'record_created')
  );
alter table enrollment_records
  drop constraint if exists enrollment_records_stage_entered_pair_check;
alter table enrollment_records
  add constraint enrollment_records_stage_entered_pair_check
  check ((stage_entered_at is null) = (stage_entered_source is null));

-- Scope list queries use exact lowercase email matching. Normalize existing data
-- once; all future mutation RPCs apply the same normalization.
update enrollment_records
set agent_email = nullif(lower(btrim(agent_email)), '')
where agent_email is distinct from nullif(lower(btrim(agent_email)), '');
update enrollment_records
set caller_email = nullif(lower(btrim(caller_email)), '')
where caller_email is distinct from nullif(lower(btrim(caller_email)), '');
update enrollment_records
set responsible_enroll_email = nullif(lower(btrim(responsible_enroll_email)), '')
where responsible_enroll_email is distinct from nullif(lower(btrim(responsible_enroll_email)), '');

create index if not exists enrollment_records_stage_idx
  on enrollment_records (stage_id, archived_at, updated_at desc);
create index if not exists enrollment_records_due_idx
  on enrollment_records (due_date, archived_at, closed_at);
create index if not exists enrollment_records_caller_idx
  on enrollment_records (caller_email, archived_at);
create index if not exists enrollment_records_responsible_idx
  on enrollment_records (responsible_enroll_email, archived_at);
create index if not exists enrollment_records_updated_idx
  on enrollment_records (archived_at, updated_at desc);

create or replace function enrollment_option_usage_counts()
returns table (
  option_id uuid,
  usage_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select option_id, count(*)::bigint as usage_count
  from (
    select stage_id as option_id from enrollment_records where archived_at is null
    union all
    select carrier_id from enrollment_records where archived_at is null
    union all
    select platform_id from enrollment_records where archived_at is null
    union all
    select consent_id from enrollment_records where archived_at is null
    union all
    select payment_status_id from enrollment_records where archived_at is null
    union all
    select aca_status_id from enrollment_records where archived_at is null
  ) as option_references
  where option_id is not null
  group by option_id;
$$;
revoke all on function enrollment_option_usage_counts() from public, anon, authenticated;
grant execute on function enrollment_option_usage_counts() to service_role;

-- The global SECURITY DEFINER ACL sweep used to live here. It was moved to the
-- very end of this file: a pg_proc scan only protects the routines that already
-- exist when it runs, so every function defined below this point kept the
-- default PUBLIC EXECUTE grant on a first apply. See the sweep and its
-- fail-closed assertion at the end of the file.

-- Program split for records: backfill existing rows as ACA, scope list queries.
alter table enrollment_records
  add column if not exists program text not null default 'aca';
alter table enrollment_records
  add column if not exists description text;
alter table enrollment_records
  add column if not exists custom_values jsonb not null default '{}'::jsonb;
create index if not exists enrollment_records_custom_values_active_gin_idx
  on enrollment_records using gin (custom_values jsonb_path_ops)
  where archived_at is null;
alter table enrollment_records
  add column if not exists agent_email text;
create index if not exists enrollment_records_agent_idx
  on enrollment_records (agent_email, archived_at);
alter table enrollment_records
  drop constraint if exists enrollment_records_program_check;
alter table enrollment_records
  add constraint enrollment_records_program_check
  check (program in ('aca', 'medicare'));
update enrollment_records
  set
    caller_email = null,
    pcp_2026 = null,
    platform_id = null,
    consent_id = null,
    payment_status_id = null,
    aca_status_id = null
  where program = 'medicare'
    and (
      caller_email is not null or
      pcp_2026 is not null or
      platform_id is not null or
      consent_id is not null or
      payment_status_id is not null or
      aca_status_id is not null
    );
alter table enrollment_records
  drop constraint if exists enrollment_records_medicare_fields_check;
alter table enrollment_records
  add constraint enrollment_records_medicare_fields_check
  check (
    program <> 'medicare' or (
      caller_email is null and
      pcp_2026 is null and
      platform_id is null and
      consent_id is null and
      payment_status_id is null and
      aca_status_id is null
    )
  );
create index if not exists enrollment_records_program_updated_idx
  on enrollment_records (program, archived_at, updated_at desc);

-- One row represents one visit to a stage. Ownership changes do not split a visit;
-- agent_email is the owner snapshot when that visit begins. Terminal transitions
-- use kind = entry_marker so the zero-duration marker is never mistaken
-- for a dwell sample.
create table if not exists enrollment_stage_cycles (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references enrollment_records(id) on delete cascade,
  stage_id uuid not null references enrollment_options(id) on delete restrict,
  from_stage_id uuid references enrollment_options(id) on delete restrict,
  to_stage_id uuid references enrollment_options(id) on delete restrict,
  agent_email text,
  program text not null default 'aca' check (program in ('aca', 'medicare')),
  kind text not null default 'dwell'
    check (kind in ('dwell', 'entry_marker')),
  started_at timestamptz not null,
  ended_at timestamptz,
  duration_seconds integer,
  started_by_email text,
  ended_by_email text,
  source text not null default 'live'
    check (source in ('live', 'backfill')),
  created_at timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at),
  check (duration_seconds is null or duration_seconds >= 0),
  check (
    (ended_at is null and duration_seconds is null)
    or (ended_at is not null and duration_seconds is not null)
  ),
  check (kind <> 'entry_marker' or (ended_at is not null and duration_seconds = 0))
);

-- Per-person speed attribution, added after the table shipped. The trigger and
-- the atomic RPCs below both write these, so a database built without them
-- fails at the first stage transition.
alter table enrollment_stage_cycles
  add column if not exists responsible_start_email text;
alter table enrollment_stage_cycles
  add column if not exists responsible_end_email text;

create unique index if not exists enrollment_stage_cycles_open_idx
  on enrollment_stage_cycles (record_id)
  where ended_at is null;
create index if not exists enrollment_stage_cycles_record_idx
  on enrollment_stage_cycles (record_id, started_at desc);
create or replace function enrollment_sync_cycle_responsibility()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.responsible_start_email is null then
    select responsible_enroll_email into new.responsible_start_email
    from enrollment_records where id = new.record_id;
  end if;
  if new.ended_at is not null and new.responsible_end_email is null then
    select responsible_enroll_email into new.responsible_end_email
    from enrollment_records where id = new.record_id;
  end if;
  return new;
end;
$$;
drop trigger if exists enrollment_stage_cycles_responsibility on enrollment_stage_cycles;
create trigger enrollment_stage_cycles_responsibility
before insert or update on enrollment_stage_cycles
for each row execute function enrollment_sync_cycle_responsibility();
create index if not exists enrollment_stage_cycles_dwell_idx
  on enrollment_stage_cycles (record_id, ended_at desc)
  where kind = 'dwell' and source = 'live';
-- Backs the per-person stage-timing query, which only counts a visit whose
-- owner did not change mid-visit. Shipped in
-- rollouts/2026-08-13-aca-person-stage-timing.sql but never mirrored here, so
-- a rebuild from this file alone silently lost it. Added 2026-08-16.
create index if not exists enrollment_stage_cycles_attributed_idx
  on enrollment_stage_cycles (stage_id, responsible_start_email, ended_at desc)
  where kind = 'dwell' and source = 'live' and ended_at is not null
    and responsible_start_email is not null
    and responsible_start_email = responsible_end_email;
create index if not exists enrollment_records_stage_entered_idx
  on enrollment_records (program, stage_id, stage_entered_at)
  where archived_at is null and closed_at is null;
alter table enrollment_records add column if not exists last_work_activity_at timestamptz;
alter table enrollment_records add column if not exists responsible_assigned_at timestamptz;
create index if not exists enrollment_records_aca_overview_created_idx
  on enrollment_records (program, created_at, archived_at);

create or replace function enrollment_sync_overview_timestamps()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if coalesce(lower(new.updated_by_email), '') <> 'system' then
      new.last_work_activity_at := coalesce(new.last_work_activity_at, new.updated_at);
    end if;
    if new.responsible_enroll_email is not null then
      new.responsible_assigned_at := coalesce(new.responsible_assigned_at, new.created_at);
    end if;
  else
    -- Independent branches, deliberately NOT elsif. Assigning a record IS real
    -- work; chaining them meant a handover updated the assignment clock and
    -- then skipped the activity clock, so a record passed between people looked
    -- progressively more neglected the more attention it actually received.
    if new.responsible_enroll_email is distinct from old.responsible_enroll_email then
      new.responsible_assigned_at := new.updated_at;
    end if;
    -- System cron writes updated_by_email = 'system' and is excluded from the
    -- user-work clock. Comments and attachments bump updated_at through their
    -- atomic mutation/touch helpers just like field edits.
    if new.updated_at is distinct from old.updated_at
      and coalesce(lower(new.updated_by_email), '') <> 'system' then
      new.last_work_activity_at := new.updated_at;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists enrollment_records_overview_timestamps on enrollment_records;
create trigger enrollment_records_overview_timestamps
before insert or update on enrollment_records
for each row execute function enrollment_sync_overview_timestamps();

-- ACA overview configuration. Keyed per program so an ACA toggle cannot
-- silently govern another program, unlike the CS queue table.
create table if not exists enrollment_queue_members (
  email text not null,
  program text not null default 'aca' check (program in ('aca', 'medicare')),
  enabled boolean not null default true,
  updated_by_email text not null,
  updated_at timestamptz not null default now(),
  primary key (email, program)
);

create table if not exists enrollment_overview_settings (
  id boolean primary key default true check (id),
  threshold_days integer not null default 3 check (threshold_days in (1,3,7,10)),
  updated_by_email text not null,
  updated_at timestamptz not null default now()
);

insert into enrollment_overview_settings (id, threshold_days, updated_by_email)
values (true, 3, 'system')
on conflict (id) do nothing;

-- RLS for both is enabled through the `protected_tables` loop at the end of this
-- file, which is the canonical registry. They must stay in that list: the anon
-- key ships to the browser, so an unprotected table here would let any visitor
-- read it, add themselves to the assignment queue, or rewrite the dashboard
-- threshold. No policies are needed — the service role bypasses RLS and
-- everyone else is denied.

-- Enrollment stage-time mutation commands. These are intentionally RPCs rather
-- than triggers: the route supplies one timestamp, locks the parent row, and
-- commits record/cycle/history/activity changes together.
create or replace function enrollment_norm_email(p_email text)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(lower(btrim(coalesce(p_email, ''))), '');
$$;

create or replace function enrollment_close_open_cycle_internal(
  p_record_id uuid,
  p_actor_email text,
  p_moment timestamptz,
  p_to_stage_id uuid,
  p_responsible_end_email text default null
)
returns integer
language plpgsql
set search_path = public
as $$
declare
  open_cycle record;
  close_at timestamptz;
begin
  select id, started_at into open_cycle
  from enrollment_stage_cycles
  where record_id = p_record_id and ended_at is null
  order by started_at desc
  limit 1
  for update;

  if not found then
    return 0;
  end if;

  close_at := greatest(p_moment, open_cycle.started_at);
  update enrollment_stage_cycles
  set ended_at = close_at,
      duration_seconds = greatest(
        0,
        round(extract(epoch from (close_at - open_cycle.started_at)))::integer
      ),
      ended_by_email = enrollment_norm_email(p_actor_email),
      to_stage_id = p_to_stage_id,
      responsible_end_email = enrollment_norm_email(p_responsible_end_email)
  where id = open_cycle.id;

  return 1;
end;
$$;

create or replace function enrollment_write_activity_internal(
  p_record_id uuid,
  p_actor_email text,
  p_activity jsonb,
  p_moment timestamptz
)
returns void
language plpgsql
set search_path = public
as $$
declare
  activity_entry jsonb;
begin
  if p_activity is null then
    return;
  end if;
  if jsonb_typeof(p_activity) <> 'array' then
    raise exception 'ENROLLMENT_ACTIVITY_INVALID: expected array, got %',
      jsonb_typeof(p_activity);
  end if;
  for activity_entry in select value from jsonb_array_elements(p_activity) loop
    if coalesce(btrim(activity_entry->>'type'), '') = '' then
      raise exception 'ENROLLMENT_ACTIVITY_INVALID: entry without type';
    end if;
  end loop;
  for activity_entry in select value from jsonb_array_elements(p_activity) loop
    insert into enrollment_activity (record_id, actor_email, type, meta, created_at)
    values (
      p_record_id,
      enrollment_norm_email(p_actor_email),
      activity_entry->>'type',
      case when activity_entry->'meta' = 'null'::jsonb then null
           else activity_entry->'meta' end,
      p_moment
    );
  end loop;
end;
$$;

create or replace function patch_enrollment_atomic(
  p_record_id uuid,
  p_expected_updated_at timestamptz,
  p_patch jsonb,
  p_actor_email text,
  p_activity jsonb default '[]'::jsonb,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_record enrollment_records%rowtype;
  next_record enrollment_records%rowtype;
  unknown_keys text[];
  actor text;
  v_now timestamptz;
  next_stage_id uuid;
  next_closed_at timestamptz;
  next_archived_at timestamptz;
  next_agent text;
  next_responsible text;
  was_inactive boolean;
  now_inactive boolean;
  stage_changed boolean;
  became_active boolean;
  became_inactive boolean;
  next_stage_entered_at timestamptz;
  next_stage_entered_source text;
begin
  actor := enrollment_norm_email(p_actor_email);
  if actor is null then
    raise exception 'ENROLLMENT_ACTOR_REQUIRED';
  end if;

  select array_agg(k) into unknown_keys
  from jsonb_object_keys(coalesce(p_patch, '{}'::jsonb)) as k
  where k <> all (array[
    'client_name','description','fub_link','due_date',
    'stage_id','carrier_id','platform_id','consent_id',
    'payment_status_id','aca_status_id','pcp_2025','pcp_2026',
    'agent_email','caller_email','responsible_enroll_email',
    'qc_checked_by_email','qc_checked_at','qc_stale_notified_at',
    'due_soon_notified_at','overdue_notified_at','overdue_reminded_at',
    'closed_at','archived_at','custom_values'
  ]);
  if unknown_keys is not null then
    raise exception 'ENROLLMENT_UNKNOWN_FIELD: %', array_to_string(unknown_keys, ',');
  end if;
  if p_activity is not null and jsonb_typeof(p_activity) <> 'array' then
    raise exception 'ENROLLMENT_ACTIVITY_INVALID: expected array, got %',
      jsonb_typeof(p_activity);
  end if;

  select * into target_record
  from enrollment_records
  where id = p_record_id
  for update;
  if not found then
    raise exception 'ENROLLMENT_NOT_FOUND';
  end if;
  if p_expected_updated_at is null or target_record.updated_at <> p_expected_updated_at then
    raise exception 'ENROLLMENT_CONFLICT';
  end if;

  v_now := greatest(p_now, target_record.updated_at + interval '1 microsecond');
  next_stage_id := case when p_patch ? 'stage_id'
    then (p_patch->>'stage_id')::uuid else target_record.stage_id end;
  next_closed_at := case when p_patch ? 'closed_at'
    then (p_patch->>'closed_at')::timestamptz else target_record.closed_at end;
  next_archived_at := case when p_patch ? 'archived_at'
    then (p_patch->>'archived_at')::timestamptz else target_record.archived_at end;
  next_agent := case when p_patch ? 'agent_email'
    then enrollment_norm_email(p_patch->>'agent_email') else target_record.agent_email end;
  next_responsible := case when p_patch ? 'responsible_enroll_email'
    then enrollment_norm_email(p_patch->>'responsible_enroll_email') else target_record.responsible_enroll_email end;

  was_inactive := target_record.closed_at is not null or target_record.archived_at is not null;
  now_inactive := next_closed_at is not null or next_archived_at is not null;
  stage_changed := next_stage_id is distinct from target_record.stage_id;
  became_active := was_inactive and not now_inactive;
  became_inactive := now_inactive and not was_inactive;

  next_stage_entered_at := case
    when next_stage_id is null then null
    when stage_changed or became_active then v_now
    else target_record.stage_entered_at end;
  next_stage_entered_source := case
    when next_stage_id is null then null
    when stage_changed or became_active then 'live'
    else target_record.stage_entered_source end;

  update enrollment_records set
    client_name = case when p_patch ? 'client_name' then p_patch->>'client_name' else client_name end,
    description = case when p_patch ? 'description' then p_patch->>'description' else description end,
    fub_link = case when p_patch ? 'fub_link' then p_patch->>'fub_link' else fub_link end,
    due_date = case when p_patch ? 'due_date' then (p_patch->>'due_date')::date else due_date end,
    stage_id = next_stage_id,
    carrier_id = case when p_patch ? 'carrier_id' then (p_patch->>'carrier_id')::uuid else carrier_id end,
    platform_id = case when p_patch ? 'platform_id' then (p_patch->>'platform_id')::uuid else platform_id end,
    consent_id = case when p_patch ? 'consent_id' then (p_patch->>'consent_id')::uuid else consent_id end,
    payment_status_id = case when p_patch ? 'payment_status_id' then (p_patch->>'payment_status_id')::uuid else payment_status_id end,
    aca_status_id = case when p_patch ? 'aca_status_id' then (p_patch->>'aca_status_id')::uuid else aca_status_id end,
    pcp_2025 = case when p_patch ? 'pcp_2025' then p_patch->>'pcp_2025' else pcp_2025 end,
    pcp_2026 = case when p_patch ? 'pcp_2026' then p_patch->>'pcp_2026' else pcp_2026 end,
    agent_email = next_agent,
    caller_email = case when p_patch ? 'caller_email' then enrollment_norm_email(p_patch->>'caller_email') else caller_email end,
    responsible_enroll_email = next_responsible,
    qc_checked_by_email = case when p_patch ? 'qc_checked_by_email' then enrollment_norm_email(p_patch->>'qc_checked_by_email') else qc_checked_by_email end,
    qc_checked_at = case when p_patch ? 'qc_checked_at' then (p_patch->>'qc_checked_at')::timestamptz else qc_checked_at end,
    qc_stale_notified_at = case when p_patch ? 'qc_stale_notified_at' then (p_patch->>'qc_stale_notified_at')::timestamptz else qc_stale_notified_at end,
    due_soon_notified_at = case when p_patch ? 'due_soon_notified_at' then (p_patch->>'due_soon_notified_at')::timestamptz else due_soon_notified_at end,
    overdue_notified_at = case when p_patch ? 'overdue_notified_at' then (p_patch->>'overdue_notified_at')::timestamptz else overdue_notified_at end,
    overdue_reminded_at = case when p_patch ? 'overdue_reminded_at' then (p_patch->>'overdue_reminded_at')::timestamptz else overdue_reminded_at end,
    closed_at = next_closed_at,
    archived_at = next_archived_at,
    custom_values = case when p_patch ? 'custom_values' then p_patch->'custom_values' else custom_values end,
    stage_entered_at = next_stage_entered_at,
    stage_entered_source = next_stage_entered_source,
    last_activity_at = greatest(coalesce(last_activity_at, v_now), v_now),
    last_activity_by_email = case
      when last_activity_at is null or v_now >= last_activity_at then actor
      else last_activity_by_email end,
    last_work_activity_at = case
      when actor <> 'system' and exists (
        select 1 from jsonb_array_elements(coalesce(p_activity, '[]'::jsonb)) item
        where coalesce(item->>'type', '') not in ('comment_added','mentioned','attachment_added')
      ) then v_now
      else last_work_activity_at end,
    responsible_assigned_at = case
      when next_responsible is distinct from target_record.responsible_enroll_email then v_now
      else responsible_assigned_at end,
    updated_by_email = actor,
    updated_at = v_now
  where id = p_record_id and updated_at = p_expected_updated_at
  returning * into next_record;
  if not found then
    raise exception 'ENROLLMENT_CONFLICT';
  end if;

  if stage_changed or became_active or became_inactive then
    perform enrollment_close_open_cycle_internal(p_record_id, actor, v_now, next_record.stage_id, target_record.responsible_enroll_email);
    if next_record.stage_id is not null then
      if not now_inactive then
        insert into enrollment_stage_cycles (
          record_id, stage_id, from_stage_id, agent_email, program,
          kind, started_at, started_by_email, responsible_start_email, source
        ) values (
          p_record_id, next_record.stage_id,
          case when stage_changed then target_record.stage_id else null end,
          next_record.agent_email, next_record.program,
          'dwell', v_now, actor, next_record.responsible_enroll_email, 'live'
        );
      elsif stage_changed then
        insert into enrollment_stage_cycles (
          record_id, stage_id, from_stage_id, agent_email, program,
          kind, started_at, ended_at, duration_seconds,
          started_by_email, ended_by_email, responsible_start_email, responsible_end_email, source
        ) values (
          p_record_id, next_record.stage_id, target_record.stage_id,
          next_record.agent_email, next_record.program,
          'entry_marker', v_now, v_now, 0, actor, actor,
          next_record.responsible_enroll_email, next_record.responsible_enroll_email, 'live'
        );
      end if;
    end if;
  end if;

  if stage_changed then
    insert into enrollment_stage_history (
      record_id, from_option_id, to_option_id, changed_by_email, changed_at
    ) values (p_record_id, target_record.stage_id, next_record.stage_id, actor, v_now);
  end if;
  perform enrollment_write_activity_internal(p_record_id, actor, p_activity, v_now);
  return to_jsonb(next_record);
end;
$$;

create or replace function create_enrollment_atomic(
  p_record jsonb,
  p_actor_email text,
  p_activity jsonb default '[]'::jsonb,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  new_record enrollment_records%rowtype;
  unknown_keys text[];
  actor text;
  is_inactive boolean;
begin
  actor := enrollment_norm_email(p_actor_email);
  if actor is null then raise exception 'ENROLLMENT_ACTOR_REQUIRED'; end if;
  select array_agg(k) into unknown_keys
  from jsonb_object_keys(coalesce(p_record, '{}'::jsonb)) as k
  where k <> all (array[
    'program','client_name','description','fub_link','due_date',
    'stage_id','carrier_id','platform_id','consent_id',
    'payment_status_id','aca_status_id','pcp_2025','pcp_2026',
    'agent_email','caller_email','responsible_enroll_email',
    'qc_checked_by_email','qc_checked_at','closed_at','custom_values'
  ]);
  if unknown_keys is not null then
    raise exception 'ENROLLMENT_UNKNOWN_FIELD: %', array_to_string(unknown_keys, ',');
  end if;
  if p_activity is not null and jsonb_typeof(p_activity) <> 'array' then
    raise exception 'ENROLLMENT_ACTIVITY_INVALID: expected array, got %', jsonb_typeof(p_activity);
  end if;
  is_inactive := (p_record->>'closed_at') is not null;

  insert into enrollment_records (
    program, client_name, description, fub_link, due_date,
    stage_id, carrier_id, platform_id, consent_id, payment_status_id, aca_status_id,
    pcp_2025, pcp_2026, agent_email, caller_email, responsible_enroll_email,
    qc_checked_by_email, qc_checked_at, closed_at, custom_values,
    created_by_email, created_at, updated_by_email, updated_at,
    stage_entered_at, stage_entered_source, last_activity_at, last_activity_by_email,
    last_work_activity_at, responsible_assigned_at
  ) values (
    coalesce(p_record->>'program', 'aca'), p_record->>'client_name', p_record->>'description',
    p_record->>'fub_link', (p_record->>'due_date')::date,
    (p_record->>'stage_id')::uuid, (p_record->>'carrier_id')::uuid,
    (p_record->>'platform_id')::uuid, (p_record->>'consent_id')::uuid,
    (p_record->>'payment_status_id')::uuid, (p_record->>'aca_status_id')::uuid,
    p_record->>'pcp_2025', p_record->>'pcp_2026',
    enrollment_norm_email(p_record->>'agent_email'), enrollment_norm_email(p_record->>'caller_email'),
    enrollment_norm_email(p_record->>'responsible_enroll_email'),
    enrollment_norm_email(p_record->>'qc_checked_by_email'), (p_record->>'qc_checked_at')::timestamptz,
    (p_record->>'closed_at')::timestamptz, coalesce(p_record->'custom_values', '{}'::jsonb),
    actor, p_now, actor, p_now,
    case when (p_record->>'stage_id') is null then null else p_now end,
    case when (p_record->>'stage_id') is null then null else 'live' end,
    p_now, actor,
    case when actor <> 'system' then p_now else null end,
    case when (p_record ? 'responsible_enroll_email') and (p_record->>'responsible_enroll_email') is not null then p_now else null end
  ) returning * into new_record;

  if new_record.stage_id is not null then
    if is_inactive then
      insert into enrollment_stage_cycles (
        record_id, stage_id, agent_email, program, kind,
        started_at, ended_at, duration_seconds, started_by_email, ended_by_email,
        responsible_start_email, responsible_end_email, source
      ) values (new_record.id, new_record.stage_id, new_record.agent_email, new_record.program,
                'entry_marker', p_now, p_now, 0, actor, actor,
                new_record.responsible_enroll_email, new_record.responsible_enroll_email, 'live');
    else
      insert into enrollment_stage_cycles (
        record_id, stage_id, agent_email, program, kind, started_at, started_by_email,
        responsible_start_email, source
      ) values (new_record.id, new_record.stage_id, new_record.agent_email, new_record.program,
                'dwell', p_now, actor, new_record.responsible_enroll_email, 'live');
    end if;
    insert into enrollment_stage_history (
      record_id, from_option_id, to_option_id, changed_by_email, changed_at
    ) values (new_record.id, null, new_record.stage_id, actor, p_now);
  end if;
  perform enrollment_write_activity_internal(new_record.id, actor, p_activity, p_now);
  return to_jsonb(new_record);
end;
$$;

create or replace function archive_enrollment_atomic(
  p_record_id uuid,
  p_actor_email text,
  p_activity jsonb default '[]'::jsonb,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_record enrollment_records%rowtype;
  next_record enrollment_records%rowtype;
  actor text;
  v_now timestamptz;
begin
  actor := enrollment_norm_email(p_actor_email);
  if actor is null then raise exception 'ENROLLMENT_ACTOR_REQUIRED'; end if;
  if p_activity is not null and jsonb_typeof(p_activity) <> 'array' then
    raise exception 'ENROLLMENT_ACTIVITY_INVALID: expected array, got %', jsonb_typeof(p_activity);
  end if;
  select * into target_record from enrollment_records where id = p_record_id for update;
  if not found then raise exception 'ENROLLMENT_NOT_FOUND'; end if;
  if target_record.archived_at is not null then return to_jsonb(target_record); end if;
  v_now := greatest(p_now, target_record.updated_at + interval '1 microsecond');
  update enrollment_records set
    archived_at = v_now,
    updated_at = v_now,
    updated_by_email = actor,
    last_work_activity_at = case when actor <> 'system' then v_now else last_work_activity_at end,
    last_activity_at = greatest(coalesce(last_activity_at, v_now), v_now),
    last_activity_by_email = case when last_activity_at is null or v_now >= last_activity_at then actor else last_activity_by_email end
  where id = p_record_id
  returning * into next_record;
  perform enrollment_close_open_cycle_internal(p_record_id, actor, v_now, null, target_record.responsible_enroll_email);
  perform enrollment_write_activity_internal(p_record_id, actor, p_activity, v_now);
  return to_jsonb(next_record);
end;
$$;

-- CAS-protected archive variant used by the browser. Keep the legacy overload
-- above for existing maintenance scripts, but never let a stale drawer archive
-- a record that changed in another tab.
create or replace function archive_enrollment_atomic(
  p_record_id uuid,
  p_actor_email text,
  p_expected_updated_at timestamptz,
  p_activity jsonb default '[]'::jsonb,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_record enrollment_records%rowtype;
  next_record enrollment_records%rowtype;
  actor text;
  v_now timestamptz;
begin
  actor := enrollment_norm_email(p_actor_email);
  if actor is null then raise exception 'ENROLLMENT_ACTOR_REQUIRED'; end if;
  if p_expected_updated_at is null then raise exception 'ENROLLMENT_CONFLICT'; end if;
  if p_activity is not null and jsonb_typeof(p_activity) <> 'array' then
    raise exception 'ENROLLMENT_ACTIVITY_INVALID: expected array, got %', jsonb_typeof(p_activity);
  end if;

  select * into target_record
  from enrollment_records
  where id = p_record_id
  for update;
  if not found then raise exception 'ENROLLMENT_NOT_FOUND'; end if;
  if target_record.updated_at <> p_expected_updated_at then
    raise exception 'ENROLLMENT_CONFLICT';
  end if;
  if target_record.archived_at is not null then return to_jsonb(target_record); end if;

  v_now := greatest(p_now, target_record.updated_at + interval '1 microsecond');
  update enrollment_records set
    archived_at = v_now,
    updated_at = v_now,
    updated_by_email = actor,
    last_work_activity_at = case when actor <> 'system' then v_now else last_work_activity_at end,
    last_activity_at = greatest(coalesce(last_activity_at, v_now), v_now),
    last_activity_by_email = case when last_activity_at is null or v_now >= last_activity_at then actor else last_activity_by_email end
  where id = p_record_id and updated_at = p_expected_updated_at
  returning * into next_record;
  if not found then raise exception 'ENROLLMENT_CONFLICT'; end if;
  perform enrollment_close_open_cycle_internal(p_record_id, actor, v_now, null, target_record.responsible_enroll_email);
  perform enrollment_write_activity_internal(p_record_id, actor, p_activity, v_now);
  return to_jsonb(next_record);
end;
$$;

revoke all on function archive_enrollment_atomic(uuid, text, timestamptz, jsonb, timestamptz)
  from public, anon, authenticated;
grant execute on function archive_enrollment_atomic(uuid, text, timestamptz, jsonb, timestamptz)
  to service_role;

create or replace function enrollment_touch_activity(
  p_record_id uuid,
  p_actor_email text,
  p_now timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor text;
  v_updated_at timestamptz;
begin
  actor := enrollment_norm_email(p_actor_email);
  if actor is null or actor = 'system' then return; end if;
  select updated_at into v_updated_at
  from enrollment_records
  where id = p_record_id
  for update;
  if not found then return; end if;
  v_updated_at := greatest(clock_timestamp(), v_updated_at + interval '1 microsecond');
  update enrollment_records
  set updated_at = v_updated_at,
      updated_by_email = actor,
      last_activity_at = greatest(coalesce(last_activity_at, p_now), p_now),
      last_activity_by_email = case when last_activity_at is null or p_now >= last_activity_at then actor else last_activity_by_email end
  where id = p_record_id;
end;
$$;

alter table enrollment_records
add column if not exists qc_stale_notified_at timestamptz;

create index if not exists enrollment_records_qc_idx
  on enrollment_records (stage_id, closed_at, qc_checked_at, qc_stale_notified_at)
  where archived_at is null;

create table if not exists enrollment_stage_history (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references enrollment_records(id) on delete cascade,
  from_option_id uuid references enrollment_options(id) on delete set null,
  to_option_id uuid references enrollment_options(id) on delete set null,
  changed_by_email text not null,
  changed_at timestamptz not null default now()
);

create index if not exists enrollment_stage_history_record_idx
  on enrollment_stage_history (record_id, changed_at desc);

create table if not exists enrollment_comments (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references enrollment_records(id) on delete cascade,
  parent_id uuid references enrollment_comments(id) on delete cascade,
  author_email text not null,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Shared comment composer idempotency key. Nullable keeps existing clients
-- valid while the Tasks and Enrollment UIs roll out together.
alter table enrollment_comments add column if not exists client_request_id uuid;

create unique index if not exists enrollment_comments_client_request_id_key
  on enrollment_comments (record_id, author_email, client_request_id)
  where client_request_id is not null;

create index if not exists enrollment_comments_record_idx
  on enrollment_comments (record_id, created_at);

-- Enrollment comment reactions mirror CS task reactions. They are kept in a
-- separate table so task and enrollment data cannot cross-contaminate while
-- sharing the same CommentThread UI.
create table if not exists enrollment_comment_reactions (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references enrollment_comments(id) on delete cascade,
  reactor_email text not null
    constraint enrollment_comment_reactions_reactor_email_normalized
    check (
      reactor_email <> ''
      and reactor_email = lower(btrim(reactor_email))
    ),
  emoji text not null,
  created_at timestamptz not null default now(),
  unique (comment_id, reactor_email, emoji)
);

delete from enrollment_comment_reactions
where btrim(reactor_email) = '';

with ranked as (
  select
    id,
    row_number() over (
      partition by comment_id, lower(btrim(reactor_email)), emoji
      order by created_at, id
    ) as duplicate_number
  from enrollment_comment_reactions
)
delete from enrollment_comment_reactions as reaction
using ranked
where reaction.id = ranked.id
  and ranked.duplicate_number > 1;

update enrollment_comment_reactions
set reactor_email = lower(btrim(reactor_email))
where reactor_email <> lower(btrim(reactor_email));

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'enrollment_comment_reactions'::regclass
      and conname = 'enrollment_comment_reactions_reactor_email_normalized'
  ) then
    alter table enrollment_comment_reactions
      add constraint enrollment_comment_reactions_reactor_email_normalized
      check (
        reactor_email <> ''
        and reactor_email = lower(btrim(reactor_email))
      );
  end if;
end $$;

create or replace function set_enrollment_comment_reaction_atomic(
  p_comment_id uuid,
  p_record_id uuid,
  p_reactor_email text,
  p_emoji text,
  p_present boolean
) returns table (
  comment_id uuid,
  emoji text,
  reactor_email text,
  changed boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_comment_id uuid;
  v_deleted_at timestamptz;
  v_reactor_email text;
  v_changed boolean := false;
  v_row_count integer := 0;
begin
  v_reactor_email := lower(btrim(coalesce(p_reactor_email, '')));
  if v_reactor_email = '' then
    raise exception 'INVALID_REACTOR_EMAIL';
  end if;
  if coalesce(char_length(p_emoji), 0) < 1 or char_length(p_emoji) > 16 then
    raise exception 'INVALID_EMOJI';
  end if;

  select comment.id, comment.deleted_at
  into v_comment_id, v_deleted_at
  from enrollment_comments as comment
  where comment.id = p_comment_id
    and comment.record_id = p_record_id
  for update;
  if not found or v_deleted_at is not null then
    raise exception 'COMMENT_NOT_FOUND';
  end if;

  if not exists (
    select 1 from enrollment_records where id = p_record_id
  ) then
    raise exception 'ENROLLMENT_NOT_FOUND';
  end if;

  if p_present then
    insert into enrollment_comment_reactions (comment_id, reactor_email, emoji)
    values (p_comment_id, v_reactor_email, p_emoji)
    on conflict do nothing;
    get diagnostics v_row_count = row_count;
    v_changed := v_row_count > 0;
  else
    delete from enrollment_comment_reactions as reaction
    where reaction.comment_id = p_comment_id
      and reaction.reactor_email = v_reactor_email
      and reaction.emoji = p_emoji;
    get diagnostics v_row_count = row_count;
    v_changed := v_row_count > 0;
  end if;

  return query
  select reaction.comment_id, reaction.emoji, reaction.reactor_email, v_changed
  from enrollment_comment_reactions as reaction
  where reaction.comment_id = p_comment_id
  order by reaction.created_at, reaction.id;
end;
$$;

revoke all on function set_enrollment_comment_reaction_atomic(
  uuid, uuid, text, text, boolean
) from public, anon, authenticated;
grant execute on function set_enrollment_comment_reaction_atomic(
  uuid, uuid, text, text, boolean
) to service_role;

create or replace function enrollment_comment_reactions_for_record(
  p_record_id uuid
) returns table (
  comment_id uuid,
  emoji text,
  reactor_email text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select reaction.comment_id, reaction.emoji, reaction.reactor_email
  from enrollment_comment_reactions as reaction
  join enrollment_comments as comment
    on comment.id = reaction.comment_id
  where comment.record_id = p_record_id
    and comment.deleted_at is null
  order by reaction.created_at, reaction.id;
$$;

revoke all on function enrollment_comment_reactions_for_record(uuid)
  from public, anon, authenticated;
grant execute on function enrollment_comment_reactions_for_record(uuid)
  to service_role;

create or replace function create_enrollment_comment_idempotent(
  p_record_id uuid,
  p_author_email text,
  p_body text,
  p_parent_id uuid,
  p_client_request_id uuid
) returns table (comment jsonb, parent_updated_at timestamptz, was_created boolean)
language plpgsql security definer set search_path = public as $$
declare
  v_comment enrollment_comments%rowtype;
  v_record enrollment_records%rowtype;
  v_now timestamptz;
begin
  select * into v_record
  from enrollment_records
  where id = p_record_id
  for update;
  if not found then
    raise exception 'ENROLLMENT_NOT_FOUND';
  end if;

  if p_client_request_id is not null then
    select * into v_comment
    from enrollment_comments
    where record_id = p_record_id
      and author_email = p_author_email
      and client_request_id = p_client_request_id;
    if found then
      comment := to_jsonb(v_comment);
      parent_updated_at := v_record.updated_at;
      was_created := false;
      return next;
      return;
    end if;
  end if;

  if p_parent_id is not null then
    perform 1
    from enrollment_comments
    where id = p_parent_id
      and record_id = p_record_id
      and parent_id is null
      and deleted_at is null;
    if not found then
      raise exception 'INVALID_PARENT';
    end if;
  end if;

  insert into enrollment_comments (
    record_id, parent_id, author_email, body, client_request_id
  ) values (
    p_record_id, p_parent_id, p_author_email, p_body, p_client_request_id
  ) returning * into v_comment;

  -- Comments participate in the same optimistic-concurrency stream as field
  -- edits. Touching only last_activity_at leaves PATCH requests carrying the
  -- previous updated_at token and creates a stale-write race immediately
  -- after a successful comment.
  v_now := greatest(clock_timestamp(), v_record.updated_at + interval '1 microsecond');
  update enrollment_records
  set updated_at = v_now,
      updated_by_email = p_author_email,
      last_activity_at = v_now,
      last_activity_by_email = p_author_email
  where id = p_record_id;

  comment := to_jsonb(v_comment);
  parent_updated_at := v_now;
  was_created := true;
  return next;
end;
$$;

revoke all on function create_enrollment_comment_idempotent(uuid, text, text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function create_enrollment_comment_idempotent(uuid, text, text, uuid, uuid)
  to service_role;

create table if not exists enrollment_comment_edits (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references enrollment_comments(id) on delete cascade,
  previous_body text not null,
  edited_by text not null,
  edited_at timestamptz not null default now()
);

create index if not exists enrollment_comment_edits_comment_idx
  on enrollment_comment_edits (comment_id, edited_at desc);

create table if not exists enrollment_activity (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references enrollment_records(id) on delete cascade,
  actor_email text not null,
  type text not null check (
    type in (
      'created',
      'edited',
      'field_changed',
      'stage_changed',
      'people_changed',
      'comment_added',
      'attachment_added',
      'qc_needed',
      'qc_reviewed',
      'qc_review_cleared',
      'reopened',
      'archived',
      'due_soon',
      'went_overdue',
      'comment_edited',
      'comment_deleted'
    )
  ),
  meta jsonb,
  created_at timestamptz not null default now()
);

create index if not exists enrollment_activity_record_idx
  on enrollment_activity (record_id, created_at desc);

create or replace function edit_enrollment_comment_atomic(
  p_comment_id uuid,
  p_record_id uuid,
  p_actor_email text,
  p_body text,
  p_expected_updated_at timestamptz
) returns table (comment jsonb, parent_updated_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_record enrollment_records%rowtype;
  v_comment enrollment_comments%rowtype;
  v_now timestamptz;
begin
  select * into v_record from enrollment_records where id = p_record_id for update;
  if not found then raise exception 'ENROLLMENT_NOT_FOUND'; end if;
  select * into v_comment
  from enrollment_comments
  where id = p_comment_id and record_id = p_record_id
  for update;
  if not found then raise exception 'COMMENT_NOT_FOUND'; end if;
  if v_comment.author_email <> p_actor_email then raise exception 'FORBIDDEN'; end if;
  if v_comment.deleted_at is not null then raise exception 'COMMENT_DELETED'; end if;
  if p_expected_updated_at is not null and v_comment.updated_at <> p_expected_updated_at then
    raise exception 'COMMENT_CONFLICT';
  end if;

  if v_comment.body = p_body then
    comment := to_jsonb(v_comment);
    parent_updated_at := v_record.updated_at;
    return next;
    return;
  end if;

  insert into enrollment_comment_edits (comment_id, previous_body, edited_by)
  values (p_comment_id, v_comment.body, p_actor_email);
  v_now := greatest(clock_timestamp(), v_comment.updated_at + interval '1 microsecond');
  update enrollment_comments
  set body = p_body, updated_at = v_now
  where id = p_comment_id
  returning * into v_comment;
  insert into enrollment_activity (record_id, actor_email, type, meta)
  values (p_record_id, p_actor_email, 'comment_edited',
          jsonb_build_object('comment_id', p_comment_id));
  v_now := greatest(clock_timestamp(), v_record.updated_at + interval '1 microsecond');
  update enrollment_records
  set updated_at = v_now,
      updated_by_email = p_actor_email,
      last_activity_at = v_now,
      last_activity_by_email = p_actor_email
  where id = p_record_id;
  comment := to_jsonb(v_comment);
  parent_updated_at := v_now;
  return next;
end;
$$;

revoke all on function edit_enrollment_comment_atomic(uuid, uuid, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function edit_enrollment_comment_atomic(uuid, uuid, text, text, timestamptz)
  to service_role;

create or replace function delete_enrollment_comment_atomic(
  p_comment_id uuid,
  p_record_id uuid,
  p_actor_email text
) returns table (
  storage_paths text[],
  attachment_count integer,
  parent_updated_at timestamptz
)
language plpgsql security definer set search_path = public as $$
declare
  v_record enrollment_records%rowtype;
  v_comment enrollment_comments%rowtype;
  v_paths text[];
  v_now timestamptz;
  v_actor text;
begin
  v_actor := enrollment_norm_email(p_actor_email);
  select * into v_record from enrollment_records where id = p_record_id for update;
  if not found then raise exception 'ENROLLMENT_NOT_FOUND'; end if;
  select * into v_comment
  from enrollment_comments
  where id = p_comment_id and record_id = p_record_id
  for update;
  if not found then raise exception 'COMMENT_NOT_FOUND'; end if;
  if enrollment_norm_email(v_comment.author_email) <> v_actor then
    raise exception 'FORBIDDEN';
  end if;

  if v_comment.deleted_at is not null then
    storage_paths := '{}';
    attachment_count := 0;
    parent_updated_at := v_record.updated_at;
    return next;
    return;
  end if;

  select coalesce(array_agg(storage_path order by created_at), '{}')
  into v_paths
  from enrollment_attachments
  where comment_id = p_comment_id;

  v_now := greatest(clock_timestamp(), v_record.updated_at + interval '1 microsecond');
  update enrollment_comments
  set body = '', deleted_at = v_now, updated_at = v_now
  where id = p_comment_id;
  delete from enrollment_attachments where comment_id = p_comment_id;
  delete from enrollment_comment_reactions where comment_id = p_comment_id;
  insert into enrollment_activity (record_id, actor_email, type, meta)
  values (
    p_record_id,
    v_actor,
    'comment_deleted',
    jsonb_build_object(
      'comment_id', p_comment_id,
      'attachment_count', coalesce(array_length(v_paths, 1), 0)
    )
  );
  update enrollment_records
  set updated_at = v_now,
      updated_by_email = v_actor,
      last_activity_at = v_now,
      last_activity_by_email = v_actor
  where id = p_record_id;

  storage_paths := v_paths;
  attachment_count := coalesce(array_length(v_paths, 1), 0);
  parent_updated_at := v_now;
  return next;
end;
$$;

revoke all on function delete_enrollment_comment_atomic(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function delete_enrollment_comment_atomic(uuid, uuid, text)
  to service_role;

create table if not exists enrollment_attachments (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references enrollment_records(id) on delete cascade,
  comment_id uuid references enrollment_comments(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  mime_type text,
  size_bytes bigint,
  uploaded_by text not null,
  client_request_id uuid,
  created_at timestamptz not null default now()
);

alter table enrollment_attachments
add column if not exists client_request_id uuid;

create index if not exists enrollment_attachments_record_idx
  on enrollment_attachments (record_id, created_at);
create index if not exists enrollment_attachments_comment_idx
  on enrollment_attachments (comment_id);
create unique index if not exists enrollment_attachments_request_key
  on enrollment_attachments (record_id, uploaded_by, client_request_id)
  where client_request_id is not null;

create table if not exists enrollment_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_email text not null,
  record_id uuid not null references enrollment_records(id) on delete cascade,
  type text not null check (
    type in (
      'assigned',
      'mentioned',
      'commented',
      'reacted',
      'due_soon',
      'overdue',
      'overdue_reminder',
      'qc_needed',
      'qc_stale',
      'reopened',
      'stage_changed',
      'qc_reviewed',
      'attachment_added'
    )
  ),
  actor_email text not null,
  comment_id uuid references enrollment_comments(id) on delete set null,
  detail text,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists enrollment_notifications_recipient_idx
  on enrollment_notifications (recipient_email, is_read, created_at desc);

insert into enrollment_option_sets (program, key, label, is_stage)
values
  ('aca', 'stage', 'Stage', true),
  ('aca', 'carrier', 'Carrier', false),
  ('aca', 'platform', 'Platform', false),
  ('aca', 'consent', 'Consent', false),
  ('aca', 'payment_status', 'Payment Status', false),
  ('aca', 'aca_status', 'ACA Status', false),
  ('medicare', 'stage', 'Stage', true),
  ('medicare', 'carrier', 'Carrier', false)
on conflict (program, key) do update
set label = excluded.label,
    is_stage = excluded.is_stage,
    updated_at = now();

delete from enrollment_option_sets sets
where sets.program = 'medicare'
  and sets.key in ('platform', 'consent', 'payment_status', 'aca_status')
  and not exists (
    select 1
    from enrollment_options options
    where options.set_id = sets.id
  );

with option_seed(set_key, label, color, position, is_terminal, triggers_qc) as (
  values
    ('stage', '1-Need quote', '#6B778C', 10, false, false),
    ('stage', '2-Quoted', '#0C66E4', 20, false, false),
    ('stage', '3-Waiting for Confirmation', '#F5A524', 30, false, false),
    ('stage', '4-Need documents', '#FFAB00', 40, false, false),
    ('stage', '5-Ready to Enroll', '#36B37E', 50, false, false),
    ('stage', '6-Enrolled', '#00A3BF', 60, false, false),
    ('stage', '7-1st payment done', '#6554C0', 70, false, false),
    ('stage', '8-Need assign PCP', '#FF7452', 80, false, false),
    ('stage', '9-Need ID card', '#00875A', 90, false, false),
    ('stage', '10-ID card done', '#00875A', 100, true, true),
    ('stage', '11-ID card unavailable', '#FF7452', 110, true, true),
    ('stage', '12-Terminated', '#C9372C', 120, true, true),
    ('carrier', 'Oscar HMO', '#0C66E4', 10, false, false),
    ('carrier', 'Oscar EPO', '#0C66E4', 20, false, false),
    ('carrier', 'CHC 019', '#00875A', 30, false, false),
    ('carrier', 'CHC Select', '#00875A', 40, false, false),
    ('carrier', 'CHC Premier', '#00875A', 50, false, false),
    ('carrier', 'Ambetter EPO', '#FF7452', 60, false, false),
    ('carrier', 'Ambetter HMO', '#FF7452', 70, false, false),
    ('carrier', 'UHC', '#0052CC', 80, false, false),
    ('carrier', 'UHC Sanitas', '#0052CC', 90, false, false),
    ('carrier', 'BCBS Advantage', '#0747A6', 100, false, false),
    ('carrier', 'BCBS Myblue', '#0747A6', 110, false, false),
    ('carrier', 'BCBS', '#0747A6', 120, false, false),
    ('carrier', 'Kaiser', '#BF2600', 130, false, false),
    ('carrier', 'Christus', '#6554C0', 140, false, false),
    ('carrier', 'Molina', '#00A3BF', 150, false, false),
    ('carrier', 'Community First', '#36B37E', 160, false, false),
    ('carrier', 'Wellpoint', '#FFAB00', 170, false, false),
    ('carrier', 'Sentara', '#8F7EE7', 180, false, false),
    ('carrier', 'BSW', '#253858', 190, false, false),
    ('carrier', 'Providence', '#4C9AFF', 200, false, false),
    ('carrier', 'Other', '#97A0AF', 210, false, false),
    ('platform', 'MyMFG', '#0C66E4', 10, false, false),
    ('platform', 'HSP', '#00875A', 20, false, false),
    ('platform', 'Other', '#97A0AF', 30, false, false),
    ('consent', 'Yes', '#00875A', 10, false, false),
    ('consent', 'Not Yet', '#FFAB00', 20, false, false),
    ('payment_status', 'Auto pay', '#00875A', 10, false, false),
    ('payment_status', '$0', '#36B37E', 20, false, false),
    ('payment_status', 'Selfpay', '#FFAB00', 30, false, false),
    ('payment_status', 'Need make manually', '#FF7452', 40, false, false),
    ('payment_status', 'Need auto pay', '#FF7452', 50, false, false),
    ('aca_status', 'Need to create ACA account', '#FF7452', 10, false, false),
    ('aca_status', 'Created - Waiting for verify', '#FFAB00', 20, false, false),
    ('aca_status', 'Created - Need information to verify', '#F5A524', 30, false, false),
    ('aca_status', 'ACA account done', '#00875A', 40, false, false)
)
insert into enrollment_options (
  set_id, label, color, position, is_terminal, treat_as_terminal, triggers_qc
)
select sets.id, seed.label, seed.color, seed.position, seed.is_terminal,
       false,
       seed.triggers_qc
from option_seed seed
join enrollment_option_sets sets on sets.key = seed.set_key and sets.program = 'aca'
where not exists (
  select 1
  from enrollment_options existing
  where existing.set_id = sets.id
    and lower(existing.label) = lower(seed.label)
    and existing.archived_at is null
);

-- Medicare uses the same ordered enrollment workflow as ACA, with the
-- Medicare-specific combined "Enrolled-1stpayment done" step and no ACA-only
-- option sets. Existing databases receive the same setup through the
-- 2026-08-15 rollout migration below; this seed keeps fresh databases aligned.
with medicare_option_seed(set_key, label, color, position, is_terminal, triggers_qc) as (
  values
    ('stage', '1-Need quote', '#6B778C', 10, false, false),
    ('stage', '2-Quoted', '#0C66E4', 20, false, false),
    ('stage', '3-Waiting for Confirmation', '#F5A524', 30, false, false),
    ('stage', '4-Need documents', '#FFAB00', 40, false, false),
    ('stage', '5-Ready to Enroll', '#36B37E', 50, false, false),
    ('stage', '6-Enrolled-1stpayment done', '#6554C0', 60, false, false),
    ('stage', '7-Need assign PCP', '#FF7452', 70, false, false),
    ('stage', '8-Need ID card', '#00875A', 80, false, false),
    ('stage', '9-ID card done', '#00875A', 90, true, true),
    ('stage', '10-ID card unavailable', '#FF7452', 100, false, false),
    ('stage', '11-Terminated', '#C9372C', 110, true, false),
    ('carrier', 'Healthspring/Cigna', '#0C66E4', 10, false, false),
    ('carrier', 'Devoted', '#36B37E', 20, false, false),
    ('carrier', 'UHC', '#0052CC', 30, false, false),
    ('carrier', 'Humana', '#6554C0', 40, false, false)
)
insert into enrollment_options (
  set_id, label, color, position, is_terminal, treat_as_terminal, triggers_qc
)
select mset.id, seed.label, seed.color, seed.position, seed.is_terminal, false, seed.triggers_qc
from medicare_option_seed seed
join enrollment_option_sets mset on mset.program = 'medicare' and mset.key = seed.set_key
where not exists (
  select 1
  from enrollment_options existing
  where existing.set_id = mset.id
    and lower(existing.label) = lower(seed.label)
    and existing.archived_at is null
);

with system_column_seed(scope, key, label, type, position, hidden_default) as (
  values
    ('cs', 'key', 'Key', 'text', 10, false),
    ('cs', 'summary', 'Client Name', 'text', 20, false),
    ('cs', 'assignee', 'Assignee', 'person', 30, false),
    ('cs', 'category', 'Category', 'dropdown', 40, false),
    ('cs', 'status', 'Stage', 'dropdown', 50, false),
    ('cs', 'priority', 'Priority', 'dropdown', 60, false),
    ('cs', 'slaRemaining', 'Time Progress', 'text', 70, false),
    ('cs', 'agent', 'Agent', 'person', 80, false),
    ('cs', 'reporter', 'Opened by', 'person', 90, false),
    ('cs', 'created', 'Created date', 'date', 100, false),
    ('cs', 'activity', 'Last activity', 'date', 110, false),
    ('cs', 'review', 'QC', 'checkbox', 120, false),
    ('aca', 'key', 'Key', 'text', 10, false),
    ('aca', 'client', 'Client Name', 'text', 20, false),
    ('aca', 'agent', 'Agent', 'person', 25, false),
    ('aca', 'stage', 'Stage', 'dropdown', 30, false),
    ('aca', 'caller', 'Caller', 'person', 40, false),
    ('aca', 'responsible', 'Responsible Enroll', 'person', 50, false),
    ('aca', 'payment', 'Payment status', 'dropdown', 60, false),
    ('aca', 'carrier', 'Carrier', 'dropdown', 70, false),
    ('aca', 'aca', 'AC', 'dropdown', 80, false),
    ('aca', 'consent', 'Consent', 'checkbox', 90, false),
    ('aca', 'platform', 'Platform', 'dropdown', 100, false),
    ('aca', 'pcp2025', 'PCP 2025', 'text', 110, false),
    ('aca', 'pcp2026', 'PCP 2026', 'text', 120, false),
    ('aca', 'due', 'Due Date', 'date', 130, false),
    ('aca', 'fub', 'FUB Link', 'link', 140, false),
    ('aca', 'createdBy', 'Created by', 'person', 150, true),
    ('aca', 'createdAt', 'Created time', 'date', 160, true),
    ('aca', 'updatedBy', 'Last edited by', 'person', 170, true),
    ('aca', 'updated', 'Last edited time', 'date', 180, true),
    ('aca', 'qc', 'QC', 'checkbox', 190, false),
    ('medicare', 'key', 'Key', 'text', 10, false),
    ('medicare', 'client', 'Client Name', 'text', 20, false),
    ('medicare', 'agent', 'Agent', 'person', 25, false),
    ('medicare', 'stage', 'Stage', 'dropdown', 30, false),
    ('medicare', 'responsible', 'Assignee', 'person', 50, false),
    ('medicare', 'carrier', 'Carrier', 'dropdown', 70, false),
    ('medicare', 'pcp2025', 'PCP', 'text', 110, false),
    ('medicare', 'due', 'Due Date', 'date', 130, false),
    ('medicare', 'fub', 'FUB Link', 'link', 140, false),
    ('medicare', 'createdBy', 'Created by', 'person', 150, true),
    ('medicare', 'createdAt', 'Created time', 'date', 160, true),
    ('medicare', 'updatedBy', 'Last edited by', 'person', 170, true),
    ('medicare', 'updated', 'Last edited time', 'date', 180, true),
    ('medicare', 'qc', 'QC', 'checkbox', 190, false)
)
insert into table_column (
  scope, key, label, type, is_system, position, pinned, hidden_default, required
)
select
  scope,
  key,
  label,
  type,
  true,
  position,
  case
    when scope = 'cs' and key in ('key', 'summary') then true
    when scope in ('aca', 'medicare') and key in ('key', 'client') then true
    else false
  end,
  hidden_default,
  case
    when scope = 'cs' and key in ('summary', 'agent', 'category') then true
    when scope in ('aca', 'medicare') and key in ('agent', 'client') then true
    else false
  end
from system_column_seed
on conflict (scope, key) do nothing;

update table_column
set pinned = true
where
  (scope = 'cs' and key in ('key', 'summary'))
  or (scope in ('aca', 'medicare') and key in ('key', 'client'));

-- Agent/Category (CS) and Agent/Client Name (Enrollment) are hard-required to
-- submit Create — see canSubmit in NewTaskDialog.tsx / the disabled= check in
-- NewEnrollmentDialog. Marking them required=true here (idempotent, safe to
-- re-run) locks their Hidden checkbox off in Config so an admin can never
-- brick record creation by hiding one of them — see the required/hidden_default
-- mutual exclusion in api/config/columns/[id]/route.ts.
update table_column
set required = true, updated_at = now()
where
  (scope = 'cs' and key in ('summary', 'agent', 'category') and is_system = true)
  or (scope in ('aca', 'medicare') and key in ('agent', 'client') and is_system = true);

-- show_in_detail is only READ for custom (non-system) columns — see
-- taskDetailColumns in TaskBoardClient.tsx / detailCustomColumns in
-- EnrollmentClient.tsx, and Config's "Detail" checkbox is disabled for
-- system rows for the same reason (app logic never checks it for them).
-- Still: seed it true here for every system column that genuinely has an
-- editable input on the Create dialog today, so the stored data honestly
-- reflects reality instead of the false the col()/seed defaults leave it at
-- — protects any future code that reads show_in_detail without the
-- is_system guard, and keeps Config's table state legible to a human admin
-- inspecting raw rows. Columns intentionally excluded: key/reporter/created/
-- activity (cs) and key/createdBy/createdAt/updatedBy/updated (aca/medicare)
-- — no create-time input, auto-generated; review/qc — Detail-drawer only,
-- never appears on Create; status/slaRemaining (cs) — no Create input either
-- (status comes from board-column assignment, slaRemaining is computed).
update table_column
set show_in_detail = true, updated_at = now()
where
  (scope = 'cs' and key in ('summary', 'priority', 'category', 'agent', 'assignee') and is_system = true)
  or (
    scope in ('aca', 'medicare')
    and key in (
      'client', 'fub', 'stage', 'due', 'agent', 'responsible',
      'payment', 'carrier', 'aca', 'consent', 'platform', 'caller',
      'pcp2025', 'pcp2026'
    )
    and is_system = true
  );

-- Medicare has no Payment/Consent/Platform/AC/Caller concept (its option sets
-- only cover stage/carrier — see enrollment_option_sets seed below) and its
-- EnrollmentClient.tsx render path (MEDICARE_HIDDEN_COLUMNS) has always
-- excluded these unconditionally. Seeding them as editable system columns for
-- scope 'medicare' let an admin toggle Pinned/Hidden/label in Config Table
-- with zero real effect, since the render-side exclusion always wins anyway
-- — archive any that a previous run of this seed already created.
update table_column
set archived_at = now(), updated_at = now()
where scope = 'medicare'
  and key in ('caller', 'payment', 'aca', 'consent', 'platform', 'pcp2026')
  and is_system = true
  and archived_at is null;

-- Defense-in-depth: enable RLS on every table. The app talks to Supabase only
-- through the service-role key, which bypasses RLS, so behavior is unchanged.
-- With RLS on and no public policies, anon/authenticated keys are denied by
-- default — so a leaked anon key (or accidental client-side query) reads nothing.
do $$
declare
  table_name text;
  protected_tables text[] := array[
    'portal_account',
    'login_attempts',
    'roles',
    'permissions',
    'role_permissions',
    'user_roles',
    'health_entries',
    'pc_entries',
    'dashboard_filter_defaults',
    'health_payment_summary',
    'provider_address',
    'pc_raw_data',
    'pc_mart',
    'health_raw_data',
    'health_mart',
    'task_categories',
    'tasks',
    'task_comments',
    'task_comment_reactions',
    'task_attachments',
    'task_activity',
    'task_notifications',
    'task_participants',
    'task_assignees',
    'task_agents',
    'agent_members',
    'task_sla_rules',
    'task_reminder_settings',
    'task_stage_cycles',
    'task_overdue_events',
    'task_assignment_cycles',
    'task_assignment_rotation',
    'task_assignment_queue_members',
    'enrollment_option_sets',
    'enrollment_options',
    'table_column',
    'table_column_option',
    'user_table_layout',
    'import_request',
    'import_request_row',
    'enrollment_records',
    'enrollment_stage_cycles',
    'enrollment_stage_history',
    'enrollment_comments',
    'enrollment_comment_reactions',
    'enrollment_comment_edits',
    'enrollment_activity',
    'enrollment_attachments',
    'enrollment_notifications',
    'enrollment_queue_members',
    'enrollment_overview_settings'
  ];
begin
  foreach table_name in array protected_tables loop
    if to_regclass('public.' || table_name) is not null then
      execute format(
        'alter table public.%I enable row level security',
        table_name
      );
    end if;
  end loop;
end $$;

-- Global task search (trigram substring match on title / comment body / file name).
create extension if not exists pg_trgm;
create index if not exists tasks_title_trgm_idx
  on tasks using gin (title gin_trgm_ops);
create index if not exists task_comments_body_trgm_idx
  on task_comments using gin (body gin_trgm_ops);
create index if not exists task_attachments_file_name_trgm_idx
  on task_attachments using gin (file_name gin_trgm_ops);
create index if not exists enrollment_records_client_name_trgm_idx
  on enrollment_records using gin (client_name gin_trgm_ops);
create index if not exists enrollment_comments_body_trgm_idx
  on enrollment_comments using gin (body gin_trgm_ops);
create index if not exists enrollment_attachments_file_name_trgm_idx
  on enrollment_attachments using gin (file_name gin_trgm_ops);

-- Lead Management: schema nền. Forward-only.
-- Quy ước theo enrollment_records: uuid pk, custom_values jsonb cho cột do
-- admin thêm, archived_at cho soft-delete, email luôn chuẩn hoá lower+btrim.

create or replace function lead_norm_email(p_email text)
returns text language sql immutable set search_path = public as $$
  select nullif(lower(btrim(coalesce(p_email, ''))), '');
$$;

create table if not exists lead_events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  event_date date,
  location text,
  notes text,
  created_by_email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

-- kind là thứ máy đọc; label là thứ người đọc. Admin đặt nhãn tiếng Việt hay
-- tiếng Anh tuỳ ý, engine cảnh báo chỉ nhìn kind.
create table if not exists lead_statuses (
  id uuid primary key default gen_random_uuid(),
  product text not null check (product in ('pc', 'health')),
  label text not null,
  color text,
  position integer not null default 0,
  kind text not null check (kind in ('open', 'scheduled', 'won', 'lost')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

-- counts_as_contact quyết định loại này có tắt đèn đỏ hay không.
-- Call/Text/Email = true, Note = false.
create table if not exists lead_interaction_types (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  color text,
  position integer not null default 0,
  counts_as_contact boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create sequence if not exists leads_display_number_seq;

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  display_number bigint not null default nextval('leads_display_number_seq'),
  product text not null check (product in ('pc', 'health')),
  event_id uuid references lead_events(id) on delete set null,
  full_name text,
  phone text,
  email text,
  assigned_to_email text,
  assigned_at timestamptz,
  assigned_by_email text,
  status_id uuid references lead_statuses(id) on delete restrict,
  -- Bốn cột dưới suy ra được từ lead_interactions nhưng cố tình lưu sẵn: bảng
  -- List phải hiện "3 lần thử, lần cuối 2 ngày trước" cho vài trăm dòng cùng
  -- lúc, aggregate cho từng dòng là đúng lỗi MEDIUM-09 trong review 23/08.
  -- log_lead_interaction_atomic là nơi DUY NHẤT được ghi bốn cột này.
  first_contacted_at timestamptz,
  last_contacted_at timestamptz,
  contact_attempt_count integer not null default 0,
  next_follow_up_at timestamptz,
  closed_at timestamptz,
  created_by_email text not null,
  created_at timestamptz not null default now(),
  updated_by_email text,
  updated_at timestamptz not null default now(),
  custom_values jsonb not null default '{}'::jsonb,
  archived_at timestamptz,
  client_request_id uuid
);

create table if not exists lead_interactions (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  type_id uuid not null references lead_interaction_types(id) on delete restrict,
  status_id uuid references lead_statuses(id) on delete restrict,
  note text,
  actor_email text not null,
  occurred_at timestamptz not null default now(),
  follow_up_at timestamptz,
  client_request_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists lead_assignment_history (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  from_email text,
  to_email text,
  reason text,
  actor_email text not null,
  created_at timestamptz not null default now()
);

create table if not exists lead_alert_settings (
  product text primary key check (product in ('pc', 'health')),
  no_contact_hours integer not null default 24 check (no_contact_hours > 0),
  stale_days integer not null default 3 check (stale_days > 0),
  max_attempts integer not null default 4 check (max_attempts > 0),
  updated_by_email text,
  updated_at timestamptz not null default now()
);

insert into lead_alert_settings (product) values ('pc'), ('health')
on conflict (product) do nothing;



-- Index bám đúng cách bảng được đọc: luôn lọc archived_at is null, rồi lọc
-- theo product, rồi sắp theo created_at.
-- Bắt buộc phải có trước phần seed bên trên: `on conflict do nothing` không có
-- unique index nào để bấu vào thì nó im lặng không làm gì cả, và chạy lại
-- rollout lần hai sẽ nhân đôi toàn bộ từ vựng.
create unique index if not exists lead_interaction_types_label_unique_idx
  on lead_interaction_types (label) where archived_at is null;
create unique index if not exists lead_statuses_label_unique_idx
  on lead_statuses (product, label) where archived_at is null;

create index if not exists leads_product_active_idx
  on leads (product, created_at desc) where archived_at is null;
create index if not exists leads_assigned_idx
  on leads (assigned_to_email, product) where archived_at is null;
create index if not exists leads_event_idx on leads (event_id);
create index if not exists lead_interactions_lead_idx
  on lead_interactions (lead_id, occurred_at desc);
create index if not exists lead_assignment_history_lead_idx
  on lead_assignment_history (lead_id, created_at desc);

-- Chống import trùng: cùng một sự kiện không được có hai lead trùng số.
create unique index if not exists leads_event_phone_unique_idx
  on leads (event_id, phone) where phone is not null and archived_at is null;

-- Từ vựng mặc định. Admin sửa/xoá/thêm thoải mái sau, nhưng phải có sẵn thứ gì
-- đó ngay từ đầu: không có status và loại tương tác thì form ghi nhật ký chỉ
-- là hai dropdown rỗng và cả module không dùng được.
insert into lead_interaction_types (label, position, counts_as_contact) values
  ('Call',  10, true),
  ('Text',  20, true),
  ('Email', 30, true),
  ('Note',  40, false)
on conflict do nothing;

do $$
declare
  product_value text;
begin
  foreach product_value in array array['pc', 'health'] loop
    insert into lead_statuses (product, label, position, kind) values
      (product_value, 'New',             10, 'open'),
      (product_value, 'Working',         20, 'open'),
      (product_value, 'No answer',       30, 'open'),
      (product_value, 'Call back',       40, 'scheduled'),
      (product_value, 'Won',             50, 'won'),
      (product_value, 'Not interested',  60, 'lost'),
      (product_value, 'Wrong number',    70, 'lost')
    on conflict do nothing;
  end loop;
end $$;

-- These tables are created after the repository-wide RLS sweep above, so they
-- need the same fail-closed protection locally. The app uses service_role only
-- after Next.js performs its authentication/authorization checks.
alter table lead_events enable row level security;
alter table lead_statuses enable row level security;
alter table lead_interaction_types enable row level security;
alter table leads enable row level security;
alter table lead_interactions enable row level security;
alter table lead_assignment_history enable row level security;
alter table lead_alert_settings enable row level security;

-- ---------------------------------------------------------------------------
-- Lead Management: ghi interaction và cập nhật thống kê atomically.
-- Forward-only. Mọi biến local có hậu tố _value và mọi bảng đều có alias để
-- tránh ambiguity giữa tên biến, output parameter và tên cột SQL.

create or replace function log_lead_interaction_atomic(
  p_lead_id uuid,
  p_type_id uuid,
  p_status_id uuid default null,
  p_note text default null,
  p_actor_email text default null,
  p_follow_up_at timestamptz default null,
  p_client_request_id uuid default null,
  p_now timestamptz default now()
) returns table (interaction jsonb, lead jsonb, was_created boolean)
language plpgsql security definer set search_path = public as $$
declare
  lead_value leads%rowtype;
  interaction_value lead_interactions%rowtype;
  type_value lead_interaction_types%rowtype;
  status_kind_value text;
  actor_value text;
begin
  actor_value := lead_norm_email(p_actor_email);
  if actor_value is null then
    raise exception 'LEAD_ACTOR_REQUIRED';
  end if;

  -- Alias `l`, not `lead`: `lead` is also the name of this function's OUT
  -- parameter. It happens to resolve today only because that parameter is
  -- jsonb and therefore not composite, so `lead.id` cannot be field access.
  -- This repo already lost a day to SQLSTATE 42702 from a local shadowing a
  -- column (patch_task_atomic, 08/08) — do not leave the same trap set.
  select * into lead_value from leads as l
  where l.id = p_lead_id and l.archived_at is null
  for update;
  if not found then
    raise exception 'LEAD_NOT_FOUND';
  end if;

  select * into type_value from lead_interaction_types as itype
  where itype.id = p_type_id and itype.archived_at is null;
  if not found then
    raise exception 'LEAD_TYPE_NOT_FOUND';
  end if;

  -- A retry with the same client request id returns the original snapshot and
  -- never increments the contact counter again.
  if p_client_request_id is not null then
    select * into interaction_value from lead_interactions as li
    where li.lead_id = p_lead_id
      and li.client_request_id = p_client_request_id;
    if found then
      interaction := to_jsonb(interaction_value);
      lead := to_jsonb(lead_value);
      was_created := false;
      return next;
      return;
    end if;
  end if;

  if p_status_id is not null then
    select st.kind into status_kind_value from lead_statuses as st
    where st.id = p_status_id
      and st.product = lead_value.product
      and st.archived_at is null;
    if status_kind_value is null then
      raise exception 'LEAD_STATUS_NOT_FOUND';
    end if;
    if status_kind_value <> 'scheduled' and p_follow_up_at is not null then
      raise exception 'LEAD_FOLLOW_UP_REQUIRES_SCHEDULED';
    end if;
    if status_kind_value = 'scheduled' and p_follow_up_at is null then
      raise exception 'LEAD_FOLLOW_UP_REQUIRED';
    end if;
  elsif p_follow_up_at is not null then
    raise exception 'LEAD_FOLLOW_UP_REQUIRES_SCHEDULED';
  end if;

  insert into lead_interactions (
    lead_id, type_id, status_id, note, actor_email,
    occurred_at, follow_up_at, client_request_id
  ) values (
    p_lead_id, p_type_id, p_status_id, nullif(btrim(coalesce(p_note, '')), ''),
    actor_value, p_now, p_follow_up_at, p_client_request_id
  ) returning * into interaction_value;

  update leads as l set
    first_contacted_at = case
      when type_value.counts_as_contact and l.first_contacted_at is null
      then p_now else l.first_contacted_at end,
    last_contacted_at = case
      when type_value.counts_as_contact then p_now
      else l.last_contacted_at end,
    contact_attempt_count = l.contact_attempt_count
      + case when type_value.counts_as_contact then 1 else 0 end,
    next_follow_up_at = case
      when p_follow_up_at is not null then p_follow_up_at
      when status_kind_value in ('won', 'lost') then null
      else l.next_follow_up_at end,
    status_id = coalesce(p_status_id, l.status_id),
    closed_at = case
      when status_kind_value in ('won', 'lost') then p_now
      when status_kind_value is not null then null
      else l.closed_at end,
    updated_at = p_now,
    updated_by_email = actor_value
  where l.id = p_lead_id
  returning * into lead_value;

  interaction := to_jsonb(interaction_value);
  lead := to_jsonb(lead_value);
  was_created := true;
  return next;
end;
$$;

revoke all on function log_lead_interaction_atomic(uuid, uuid, uuid, text, text, timestamptz, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function log_lead_interaction_atomic(uuid, uuid, uuid, text, text, timestamptz, uuid, timestamptz)
  to service_role;

-- SECURITY DEFINER ACL — must remain the LAST executable block in this file.
-- ---------------------------------------------------------------------------
-- All SECURITY DEFINER routines in this schema are server-only RPCs. Their
-- callers perform authentication/authorization in Next.js before using the
-- service-role client; leaving the default PUBLIC EXECUTE grant would expose
-- privileged writes (or protected metadata reads) through PostgREST's RPC
-- endpoint and bypass that application boundary.
--
-- This sweep is positional: it protects every SECURITY DEFINER routine that
-- exists when it runs. It previously sat mid-file, so patch_enrollment_atomic,
-- create_enrollment_atomic, archive_enrollment_atomic and
-- enrollment_touch_activity -- all defined below that point -- were reachable
-- by `authenticated` after a first apply. Do not move this block upwards, and
-- do not append executable statements after it.
do $$
declare
  routine record;
begin
  for routine in
    select p.oid::regprocedure::text as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
  loop
    execute format(
      'revoke all on function %s from public, anon, authenticated',
      routine.signature
    );
    execute format(
      'grant execute on function %s to service_role',
      routine.signature
    );
  end loop;
end
$$;

-- Fail-closed invariant. A positional sweep cannot defend itself against a
-- function appended below it, so assert the end state instead. This turns the
-- next occurrence from a silent authorization hole into a failed deploy.
-- Note this is a ratchet, not a gate: it catches a stray function on the NEXT
-- apply, not the one that introduced it. Anyone adding a SECURITY DEFINER
-- function must still write its revoke/grant pair at the definition site.
do $$
declare leaked text;
begin
  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text)
    into leaked
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef
    and (has_function_privilege('authenticated', p.oid, 'execute')
      or has_function_privilege('anon', p.oid, 'execute'));

  if leaked is not null then
    raise exception
      'SECURITY DEFINER functions are still executable by anon/authenticated: %. '
      'Move the ACL sweep below every function definition.', leaked;
  end if;
end
$$;
