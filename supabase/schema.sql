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
  ('task.work', 'Tasks - Work', 'Work on tasks assigned to you.', 'tasks', 'Tasks', 200)
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
  'task.work'
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
  archived_at timestamptz,
  constraint tasks_backlog_no_assignee
    check (status <> 'backlog' or assignee_email is null),
  -- Mặt còn lại của bất biến: task ngoài backlog BẮT BUỘC có assignee.
  constraint tasks_nonbacklog_has_assignee
    check (status = 'backlog' or assignee_email is not null)
);

alter table tasks
add column if not exists agent_email text;

alter table tasks
add column if not exists fub_link text;

alter table tasks
add column if not exists done_reviewed_by_email text;

alter table tasks
add column if not exists done_reviewed_at timestamptz;

alter table tasks add column if not exists in_progress_at timestamptz;

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

-- Anti-duplicate markers for the new cron reminders (mirror the existing
-- overdue_reminded_at / todo_reminded_at / waiting_reminded_at). Cleared when
-- the relevant clock restarts so the reminder can re-arm.
alter table tasks add column if not exists due_soon_notified_at timestamptz;
alter table tasks add column if not exists stale_reminded_at timestamptz;

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

insert into task_reminder_settings (id)
values (true)
on conflict (id) do nothing;

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

create index if not exists task_comments_task_idx on task_comments (task_id, created_at);

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

delete from task_activity
where type = 'due_changed';

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
      'overdue',
      'todo_reminder',
      'overdue_reminder',
      'waiting_reminder',
      'unassigned',
      'reopened',
      'qc_needed',
      'due_soon',
      'stale'
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

-- People selected as task agents/team owners. This is independent of the
-- legacy portal_account.role value.
create table if not exists task_agents (
  email text not null primary key,
  created_at timestamptz not null default now()
);

-- Which CS staff support which task agent (many-to-many). Admin-managed.
-- Drives task visibility: a CS sees tasks whose agent_email is one of their
-- selected task agents.
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

-- Backfill selected task agents from existing groups (idempotent).
insert into task_agents (email)
select distinct agent_email from agent_members
on conflict (email) do nothing;

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
    'task_assignment_cycles'
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
