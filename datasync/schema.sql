-- Run this once in the Supabase SQL editor before running the sync script.

create extension if not exists "pgcrypto";

do $$
begin
  if to_regclass('public.health_mart') is not null
    and to_regclass('public.health_raw_data') is null then
    alter table public.health_mart rename to health_raw_data;
  end if;
end $$;

create table if not exists public.health_payment_summary (
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

create table if not exists public.provider_address (
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
  on public.provider_address (npi);

create index if not exists provider_address_city_idx
  on public.provider_address (city);

create index if not exists provider_address_zip_code_idx
  on public.provider_address (zip_code);

alter table public.provider_address
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

create table if not exists public.pc_raw_data (
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
  on public.pc_raw_data (policy_number);

create index if not exists pc_raw_data_statement_number_idx
  on public.pc_raw_data (statement_number);

alter table public.pc_raw_data
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

create table if not exists public.pc_mart (
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
  on public.pc_mart (policy_number);

create index if not exists pc_mart_effective_date_idx
  on public.pc_mart (effective_date);

create index if not exists pc_mart_statement_number_idx
  on public.pc_mart (statement_number);

create table if not exists public.health_raw_data (
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
  on public.health_raw_data (carrier);

create index if not exists health_raw_data_report_month_idx
  on public.health_raw_data (month_report);

alter table public.health_raw_data
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

create table if not exists public.health_mart (
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

alter table public.health_mart
add column if not exists paid_to_date_raw text;

create index if not exists health_mart_carrier_idx
  on public.health_mart (carrier);

create index if not exists health_mart_report_month_idx
  on public.health_mart (report_month);

create index if not exists health_mart_primary_member_id_idx
  on public.health_mart (primary_member_id);

drop function if exists public.refresh_health_mart();
drop function if exists public.parse_health_date(text);
drop function if exists public.parse_health_date_token(text);
drop function if exists public.parse_health_money(text);
drop function if exists public.parse_health_int(text);

create or replace function public.parse_health_date_token(value text)
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

create or replace function public.parse_health_date(value text)
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

  select max(public.parse_health_date_token(part))
  into parsed_date
  from regexp_split_to_table(normalized_value, '[[:space:],;|]+') as parts(part);

  return parsed_date;
end;
$$;

create or replace function public.parse_health_money(value text)
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

create or replace function public.parse_health_int(value text)
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

-- ZIP -> city/state reference table. Structure only; the row data is
-- imported separately (one-time CSV load in the Supabase dashboard).
-- zip is numeric so the source CSV's "601.0" style values import cleanly;
-- numeric = integer comparison still matches pc_mart.zipcode in refresh_pc_mart.
create table if not exists public.zipcode_lookup (
  zip   numeric primary key,
  city  text,
  state text
);

drop function if exists public.refresh_pc_mart();
drop function if exists public.parse_pc_date(text);

create or replace function public.parse_pc_date(value text)
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

create or replace function public.refresh_pc_mart()
returns void
language sql
security definer
as $$
  truncate table public.pc_mart;

  insert into public.pc_mart (
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
      public.parse_health_int(max(zipcode)::text) as zipcode,
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
      round(sum(public.parse_health_money(premium))::numeric, 2)::double precision as premium,
      round(sum(public.parse_health_money(true_premium))::numeric, 2)::double precision as true_premium,
      public.parse_pc_date(effective_date) as effective_date,
      public.parse_pc_date(expired_date) as expired_date,
      case
        when nullif(replace(btrim(coalesce(carrier_commission, '')), '%', ''), '') ~ '^-?\d+(\.\d+)?$'
          then nullif(replace(btrim(coalesce(carrier_commission, '')), '%', ''), '')::double precision / 100
        else null
      end as carrier_commission,
      to_char(
        case
          when paid_producer ~ '\d{4}$' then public.parse_pc_date(paid_producer)
          else public.parse_pc_date(concat(paid_producer, '/2025'))
        end,
        'MM/DD/YYYY'
      ) as paid_producer,
      statement_number
    from public.pc_raw_data
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
        when f.agent = 'FIONA' then 'EPS1001'
        when f.agent = 'LINH' then 'EPS1002'
        when f.agent = 'NAM' then 'EPS1003'
        when f.agent = 'VUONG' then 'EPS1004'
      end as agent_id,
      case
        when f.agent = 'FIONA' then 'FIONA'
        when f.agent = 'LINH' then 'LINH'
        when f.agent = 'NAM' then 'NAM'
        when f.agent = 'VUONG' then 'VUONG'
      end as agent_name,
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
    left join public.zipcode_lookup z on z.zip = f.zipcode
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

create or replace function public.refresh_health_mart()
returns void
language sql
security definer
as $$
  truncate table public.health_mart;

  insert into public.health_mart (
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
    public.parse_health_date(r.broker_effective),
    public.parse_health_date(r.paid_to_date),
    btrim(r.paid_to_date),
    date_trunc('month', public.parse_health_date(r.month_report))::date,
    public.parse_health_money(r.carriers_messer_paid),
    public.parse_health_money(r.agent_received),
    public.parse_health_money(r.eps_override),
    public.parse_health_money(r.eps_override_received),
    public.parse_health_money(r.eps_split),
    upper(btrim(r.pay_rate_level)),
    upper(btrim(r.transaction_id)),
    btrim(r.messer_statement),
    public.parse_health_int(r.num_client::text),
    to_char(date_trunc('month', public.parse_health_date(r.month_report))::date, 'YYYY-MM')
  from public.health_raw_data r
  where not (
    r.deal_name is null
    and btrim(r.deal_name) <> ''
    and r.primary_member_id is null
  );
$$;

create index if not exists health_payment_summary_agent_idx
  on public.health_payment_summary (agent);

alter table public.health_payment_summary
add column if not exists agent text;

alter table public.health_payment_summary
add column if not exists carrier_name text;

alter table public.health_payment_summary
add column if not exists customer_id text;

alter table public.health_payment_summary
add column if not exists customer_name text;

alter table public.health_payment_summary
add column if not exists effective_date text;

alter table public.health_payment_summary
add column if not exists paid_to_date text;

alter table public.health_payment_summary
add column if not exists gross_compensation numeric;

alter table public.health_payment_summary
add column if not exists transaction_id text;

alter table public.health_payment_summary
add column if not exists statement text;

alter table public.health_payment_summary
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

create or replace function public.clear_health_payment_summary()
returns void
language sql
security definer
as $$
  truncate table public.health_payment_summary;
$$;
