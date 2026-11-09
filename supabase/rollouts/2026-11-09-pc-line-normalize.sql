-- Chuẩn hoá Line of Service trong pc_mart.type: 44 giá trị gốc + ô trống -> 10 line + null (Unspecified).
-- Chỉ đổi cột type của pc_mart. pc_raw_data, số dòng và số tiền không đổi.
-- Hoàn tác: 2026-11-09-pc-line-normalize.rollback.sql

begin;

CREATE OR REPLACE FUNCTION public.refresh_pc_mart()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
      -- Line of Service chuẩn. Giá trị lạ (kể cả tên hãng ghi nhầm vào cột Type)
      -- thành null và hiện là "Unspecified"; line mới phải thêm vào đây.
      case
        when upper(btrim(type)) in ('AUTO', 'ATUO', 'CAR') then 'AUTO'
        when upper(btrim(type)) in ('HOME', 'HO3', 'HOB', 'HOMEOWNER') then 'HOME'
        when upper(btrim(type)) in ('DWELLING', 'DWELING', 'DWELLING FIRE', 'DF', 'DP', 'DP3', 'TDP 3', 'LANDLORD', 'VACANT', 'RENTAL') then 'DWELLING'
        when upper(btrim(type)) in ('COMMERCIAL', 'COMERCIAL', 'COMERICAL', 'COMMERICAL', 'COMM', 'BOP', 'GL', 'AUTO COMERCIAL') then 'COMMERCIAL'
        when upper(btrim(type)) = 'FLOOD' then 'FLOOD'
        when upper(btrim(type)) = 'RENTER' then 'RENTERS'
        when upper(btrim(type)) in ('UMBRELLA', 'UMBREALLA') then 'UMBRELLA'
        when upper(btrim(type)) in ('MOTORCYCLE', 'MOTOCYCLE') then 'MOTORCYCLE'
        when upper(btrim(type)) in ('MOBILE HOME', 'MOBI HOME') then 'MOBILE HOME'
        when upper(btrim(type)) = 'TXWIND' then 'WIND'
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
$function$;

select public.refresh_pc_mart();

commit;
