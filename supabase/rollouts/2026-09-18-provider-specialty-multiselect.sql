-- =====================================================================
-- Provider Specialty: chuẩn hoá dữ liệu và chuyển sang multiselect.
--
-- Chạy SAU 2026-09-17-multiselect-column-type.sql.
-- Idempotent: chạy lại không nhân đôi option và không đổi thứ tự specialty
-- trong một ô đã được chuẩn hoá.
-- Sau khi chạy thành công: notify pgrst, 'reload schema';
-- =====================================================================

begin;

-- 1. Specialty là system column nhưng được quản lý option giống ACA/Medicare.
update public.table_column
set type = 'multiselect', updated_at = now()
where scope = 'provider'
  and key = 'practices_as'
  and type <> 'multiselect';

create or replace function public.is_admin_managed_system_column(p_scope text, p_key text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select (p_scope, p_key) in (
    ('provider', 'practices_as'),
    ('provider', 'obamacare'),
    ('provider', 'medicare')
  );
$$;

-- 2. Chuẩn hoá các ô đang chứa nhiều Specialty thành danh sách nhãn canonical.
-- `Does not take ACA` là trạng thái bảo hiểm, không phải Specialty, nên loại
-- khỏi practices_as. Các nhãn loại cơ sở khác vẫn giữ nguyên để không mất dữ liệu.
with raw_tokens as (
  select
    provider_row.id,
    token.ordinality,
    case lower(btrim(token.value))
      when 'opthamology' then 'Ophthalmology'
      when 'pcp - family (adults and children)' then 'PCP - Family'
      when 'does not take aca' then null
      else nullif(btrim(token.value), '')
    end as canonical_value
  from public.provider_directory provider_row
  cross join lateral regexp_split_to_table(
    coalesce(provider_row.practices_as, ''), ','
  ) with ordinality as token(value, ordinality)
  where provider_row.practices_as is not null
), deduped_tokens as (
  select distinct on (id, lower(canonical_value))
    id,
    canonical_value,
    ordinality
  from raw_tokens
  where canonical_value is not null
  order by id, lower(canonical_value), ordinality
), normalized_rows as (
  select
    id,
    string_agg(canonical_value, ', ' order by ordinality) as practices_as
  from deduped_tokens
  group by id
), all_rows as (
  select provider_row.id, normalized_rows.practices_as
  from public.provider_directory provider_row
  left join normalized_rows on normalized_rows.id = provider_row.id
  where provider_row.practices_as is not null
)
update public.provider_directory provider_row
set practices_as = all_rows.practices_as,
    updated_at = now()
from all_rows
where provider_row.id = all_rows.id
  and provider_row.practices_as is distinct from all_rows.practices_as;

-- 3. Bộ options lấy từ toàn bộ giá trị Specialty hiện có sau chuẩn hoá.
update public.table_column_option option_row
set archived_at = now(), updated_at = now()
from public.table_column column_row
where option_row.column_id = column_row.id
  and column_row.scope = 'provider'
  and column_row.key = 'practices_as'
  and lower(btrim(option_row.label)) = 'does not take aca'
  and option_row.archived_at is null;

insert into public.table_column_option (column_id, label, color, position)
select column_row.id, seed.label, null, seed.position
from public.table_column column_row
cross join (
  values
    ('Allergist', 10),
    ('Cardiologist', 20),
    ('Dentist', 30),
    ('Dermatology', 40),
    ('Emergency Medicine', 50),
    ('Endocrinology', 60),
    ('ER', 70),
    ('Gastroenterology', 80),
    ('General Surgeon', 90),
    ('Geriatric', 100),
    ('Hematology', 110),
    ('Hospital', 120),
    ('Imaging Facility', 130),
    ('Location Closed', 140),
    ('Nephrology', 150),
    ('Neurology', 160),
    ('Nurse Practitioner', 170),
    ('OBGYN', 180),
    ('Oncology', 190),
    ('Ophthalmology', 200),
    ('Orthopedic', 210),
    ('Otolaryngologist (ENT)', 220),
    ('PCP - Adults', 230),
    ('PCP - Children', 240),
    ('PCP - Family', 250),
    ('Pharmacy', 260),
    ('Physician Assistant', 270),
    ('Podiatrist', 280),
    ('Psychiatrist', 290),
    ('Pulmonologist', 300),
    ('Rheumatology', 310),
    ('Specialists', 320),
    ('Urgent Care', 330),
    ('Urology', 340)
) as seed(label, position)
where column_row.scope = 'provider'
  and column_row.key = 'practices_as'
  and column_row.type = 'multiselect'
  and column_row.archived_at is null
  and not exists (
    select 1
    from public.table_column_option existing
    where existing.column_id = column_row.id
      and existing.archived_at is null
      and lower(btrim(existing.label)) = lower(btrim(seed.label))
  );

-- 4. Option usage phải đọc đúng provider_directory và hiểu cả Specialty.
create or replace function public.table_column_option_usage_count(
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
  column_row public.table_column%rowtype;
  option_label text;
  usage_count bigint;
begin
  select * into column_row
  from public.table_column
  where id = p_column_id
    and archived_at is null
    and type in ('dropdown', 'multiselect')
    and (not is_system or public.is_admin_managed_system_column(scope, key));
  if not found then raise exception 'CONFIG_OPTION_NOT_FOUND'; end if;

  select option_row.label into option_label
  from public.table_column_option option_row
  where option_row.id = p_option_id
    and option_row.column_id = p_column_id
    and option_row.archived_at is null;
  if not found then raise exception 'CONFIG_OPTION_NOT_FOUND'; end if;

  if column_row.scope = 'provider' then
    select count(*)::bigint into usage_count
    from public.provider_directory provider_row
    where provider_row.archived_at is null
      and exists (
        select 1
        from unnest(
          string_to_array(
            coalesce(
              case column_row.key
                when 'practices_as' then provider_row.practices_as
                when 'obamacare' then provider_row.obamacare
                when 'medicare' then provider_row.medicare
              end,
              ''
            ),
            ','
          )
        ) as item
        where lower(btrim(item)) = lower(btrim(option_label))
      );
  elsif column_row.scope = 'cs' then
    select count(*)::bigint into usage_count
    from public.tasks task_row
    where task_row.archived_at is null
      and task_row.custom_values @> jsonb_build_object(
        column_row.key,
        case
          when column_row.type = 'multiselect' then jsonb_build_array(p_option_id::text)
          else to_jsonb(p_option_id::text)
        end
      );
  else
    select count(*)::bigint into usage_count
    from public.enrollment_records record_row
    where record_row.archived_at is null
      and record_row.program = column_row.scope
      and record_row.custom_values @> jsonb_build_object(
        column_row.key,
        case
          when column_row.type = 'multiselect' then jsonb_build_array(p_option_id::text)
          else to_jsonb(p_option_id::text)
        end
      );
  end if;
  return usage_count;
end;
$$;

revoke all on function public.table_column_option_usage_count(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.table_column_option_usage_count(uuid, uuid)
  to service_role;

-- 5. Kiểm chứng sau rollout.
select
  column_row.key,
  column_row.type as kieu_moi,
  count(distinct option_row.id) filter (where option_row.archived_at is null) as so_options,
  count(distinct provider_row.id) filter (where provider_row.practices_as is not null) as so_dong_co_du_lieu
from public.table_column column_row
left join public.table_column_option option_row
  on option_row.column_id = column_row.id
left join public.provider_directory provider_row
  on provider_row.archived_at is null
where column_row.scope = 'provider'
  and column_row.key = 'practices_as'
group by column_row.key, column_row.type;

commit;

notify pgrst, 'reload schema';
