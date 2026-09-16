-- =====================================================================
-- Multi dropdown cho table-config và ACA/Medicare plans của Provider List.
--
-- Idempotent. Chạy SAU 2026-09-16-provider-list.sql.
-- Sau khi chạy thành công: notify pgrst, 'reload schema';
-- =====================================================================

-- 1. Mở kiểu cột mới.
do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.table_column'::regclass
      and conname = 'table_column_type_check'
  ) then
    alter table public.table_column drop constraint table_column_type_check;
  end if;
  alter table public.table_column
    add constraint table_column_type_check
    check (type in ('text','number','dropdown','multiselect','date','checkbox','link','person'));
end $$;

-- 2. Chỉ hai cột provider thật được phép quản lý options dù là system column.
create or replace function public.is_admin_managed_system_column(p_scope text, p_key text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select (p_scope, p_key) in (('provider', 'obamacare'), ('provider', 'medicare'));
$$;

-- 3. Đồng bộ type của hai cột đã được rollout Provider List.
update public.table_column
set type = 'multiselect', updated_at = now()
where scope = 'provider'
  and key in ('obamacare', 'medicare')
  and type <> 'multiselect';

-- 4. Cho phép options trên custom dropdown/multiselect và hai system columns
--    được allowlist; các system column khác vẫn bị khoá.
create or replace function public.create_table_column_option(
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
  column_row public.table_column%rowtype;
  option_row public.table_column_option%rowtype;
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
  from public.table_column
  where id = p_column_id
  for update;
  if not found then raise exception 'COLUMN_NOT_FOUND'; end if;
  if column_row.type not in ('dropdown', 'multiselect')
    or (column_row.is_system
        and not public.is_admin_managed_system_column(column_row.scope, column_row.key))
    or column_row.archived_at is not null then
    raise exception 'CUSTOM_DROPDOWN_REQUIRED';
  end if;

  if p_position is null then
    select coalesce(max(position), 0) + 10 into next_position
    from public.table_column_option
    where column_id = p_column_id and archived_at is null;
    if next_position < 0 then raise exception 'OPTION_POSITION_OVERFLOW'; end if;
  else
    next_position := p_position;
  end if;

  insert into public.table_column_option (column_id, label, color, position)
  values (p_column_id, normalized_label, p_color, next_position)
  returning * into option_row;
  return to_jsonb(option_row);
end;
$$;

revoke all on function public.create_table_column_option(uuid, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.create_table_column_option(uuid, text, text, integer)
  to service_role;

-- 5. Usage count hiểu cả custom_values array và provider text chứa nhãn.
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
  if not found then
    raise exception 'CONFIG_OPTION_NOT_FOUND';
  end if;

  select option_row.label into option_label
  from public.table_column_option option_row
  where option_row.id = p_option_id
    and option_row.column_id = p_column_id
    and option_row.archived_at is null;
  if not found then
    raise exception 'CONFIG_OPTION_NOT_FOUND';
  end if;

  if column_row.scope = 'provider' then
    select count(*)::bigint into usage_count
    from public.provider_address provider_row
    where provider_row.archived_at is null
      and exists (
        select 1
        from unnest(
          string_to_array(
            coalesce(
              case column_row.key
                when 'obamacare' then provider_row.obamacare
                when 'medicare' then provider_row.medicare
              end,
              ''
            ),
            ','
          )
        ) as item
        where btrim(item) = option_label
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

-- 6. Seed các nhãn đang có trong Sheet; không tạo bản ghi trùng khi chạy lại.
insert into public.table_column_option (column_id, label, color, position)
select column_row.id, seed.label, null, seed.position
from public.table_column column_row
cross join (
  values
    ('BCBS Advantage', 10),
    ('UHC', 20),
    ('Ambetter EPO', 30),
    ('Oscar HMO', 40),
    ('Oscar EPO', 50),
    ('BCBS MyBlue Health', 60),
    ('Ambetter HMO', 70),
    ('CHC Premier', 80),
    ('CHC Select', 90),
    ('Wellpoint', 100),
    ('Molina', 110),
    ('Cigna', 120),
    ('Imperial', 130),
    ('UHC Sanitas', 140),
    ('Christus', 150),
    ('BSW', 160),
    ('UHC Kelsey Seybold', 170)
) as seed(label, position)
where column_row.scope = 'provider'
  and column_row.key = 'obamacare'
  and column_row.type = 'multiselect'
  and column_row.archived_at is null
  and not exists (
    select 1
    from public.table_column_option existing
    where existing.column_id = column_row.id
      and existing.archived_at is null
      and lower(btrim(existing.label)) = lower(btrim(seed.label))
  );

insert into public.table_column_option (column_id, label, color, position)
select column_row.id, seed.label, null, seed.position
from public.table_column column_row
cross join (
  values
    ('CHC D-SNP', 10),
    ('Healthspring/Cigna', 20),
    ('Aetna', 30),
    ('Humana', 40),
    ('UHC', 50),
    ('Wellcare', 60),
    ('BCBS', 70),
    ('Molina', 80),
    ('Verda', 90),
    ('CHC Dualcare', 100),
    ('Devoted', 110),
    ('Wellmed', 120),
    ('All Medicare Plans', 130),
    ('Wellpoint', 140)
) as seed(label, position)
where column_row.scope = 'provider'
  and column_row.key = 'medicare'
  and column_row.type = 'multiselect'
  and column_row.archived_at is null
  and not exists (
    select 1
    from public.table_column_option existing
    where existing.column_id = column_row.id
      and existing.archived_at is null
      and lower(btrim(existing.label)) = lower(btrim(seed.label))
  );

-- 7. Xác minh nhanh sau rollout.
select
  key,
  type as kieu_moi,
  count(*) filter (where archived_at is null) as so_cot,
  (
    select count(*)
    from public.table_column_option option_row
    where option_row.column_id = column_row.id
      and option_row.archived_at is null
  ) as so_options
from public.table_column column_row
where scope = 'provider'
  and key in ('obamacare', 'medicare')
group by id, key, type
order by key;
