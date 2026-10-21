-- =====================================================================
-- Health Other Service Enrollment — chương trình enrollment thứ tư
-- (user chốt 2026-10-21).
--
-- Giống ACA nhưng BỎ các phần chỉ Marketplace mới có: Carrier, PCP 2025/2026,
-- Platform, Consent, Payment status, ACA status, và hai cột tuỳ chỉnh
-- Household number / Apply number. GIỮ Caller. Dùng chung toàn bộ backend
-- (quyền, scope, realtime, comment, attachment, activity, Overview, export,
-- notification) như Medicaid đã làm — xem 2026-09-09-medicaid-enrollment.sql.
--
--   A. Nới khung: constraint, scope, is_table_scope, bộ đếm OTH-*, trigger.
--   B. Data schema: Stage (4 giá trị đơn giản), cột hệ thống + 4 cột tuỳ chỉnh
--      COPY từ ACA đang chạy (Year, Broker Effective Date, Follow up, ID), kèm
--      giá trị dropdown của Year.
--
-- Idempotent (drop/add constraint, `on conflict do nothing`, `not exists`).
-- Một transaction: lỗi giữa chừng thì không có gì thay đổi.
--
-- ⚠ Chạy TRƯỚC khi deploy code: code mới gửi program = 'other_service', mà
--   constraint cũ sẽ từ chối.
-- Rollback: 2026-10-21-other-service-enrollment.rollback.sql
-- =====================================================================
begin;

-- A1. Bốn bảng có cột `program`.
alter table enrollment_records drop constraint if exists enrollment_records_program_check;
alter table enrollment_records add constraint enrollment_records_program_check
  check (program in ('aca', 'medicare', 'medicaid', 'other_service'));

alter table enrollment_option_sets drop constraint if exists enrollment_option_sets_program_check;
alter table enrollment_option_sets add constraint enrollment_option_sets_program_check
  check (program in ('aca', 'medicare', 'medicaid', 'other_service'));

alter table enrollment_stage_cycles drop constraint if exists enrollment_stage_cycles_program_check;
alter table enrollment_stage_cycles add constraint enrollment_stage_cycles_program_check
  check (program in ('aca', 'medicare', 'medicaid', 'other_service'));

alter table enrollment_queue_members drop constraint if exists enrollment_queue_members_program_check;
alter table enrollment_queue_members add constraint enrollment_queue_members_program_check
  check (program in ('aca', 'medicare', 'medicaid', 'other_service'));

-- A2. Lớp cuối của "không có trường Marketplace" (app đã lọc payload qua
-- INAPPLICABLE_FIELDS_BY_PROGRAM). Chưa có hồ sơ nào nên không cần dọn trước.
alter table enrollment_records drop constraint if exists enrollment_records_other_service_fields_check;
alter table enrollment_records add constraint enrollment_records_other_service_fields_check
  check (
    program <> 'other_service' or (
      carrier_id is null and
      pcp_2025 is null and
      pcp_2026 is null and
      platform_id is null and
      consent_id is null and
      payment_status_id is null and
      aca_status_id is null
    )
  );

-- A3. Ba bảng của Table Configuration (giữ nguyên 'provider' ở hai bảng đang có).
alter table table_column drop constraint if exists table_column_scope_check;
alter table table_column add constraint table_column_scope_check
  check (scope in ('cs','aca','medicare','medicaid','other_service','lead_pc','lead_health','lead','provider'));

alter table user_table_layout drop constraint if exists user_table_layout_scope_check;
alter table user_table_layout add constraint user_table_layout_scope_check
  check (scope in ('cs','aca','medicare','medicaid','other_service','lead_pc','lead_health','lead','provider'));

alter table import_request drop constraint if exists import_request_scope_check;
alter table import_request add constraint import_request_scope_check
  check (scope in ('cs','aca','medicare','medicaid','other_service','lead_pc','lead_health','lead'));

create or replace function is_table_scope(p_scope text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_scope in ('cs', 'aca', 'medicare', 'medicaid', 'other_service', 'lead', 'provider');
$$;

-- A4. Bộ đếm riêng OTH-1, OTH-2… Thiếu nhánh trong trigger thì hồ sơ mới rơi
-- vào `else` và lấy số của ACA.
create sequence if not exists enrollment_records_other_service_display_number_seq;

do $$
declare
  other_service_max bigint;
begin
  select max(display_number) into other_service_max
  from enrollment_records where program = 'other_service';
  if other_service_max is null then
    perform setval('enrollment_records_other_service_display_number_seq', 1, false);
  else
    perform setval('enrollment_records_other_service_display_number_seq', other_service_max, true);
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
      when 'medicaid' then nextval('enrollment_records_medicaid_display_number_seq')
      when 'other_service' then nextval('enrollment_records_other_service_display_number_seq')
      else nextval('enrollment_records_aca_display_number_seq')
    end;
  end if;
  return new;
end;
$$;

-- B1. Nhóm option hệ thống duy nhất: Stage.
insert into enrollment_option_sets (program, key, label, is_stage)
select 'other_service', 'stage', 'Stage', true
where not exists (
  select 1 from enrollment_option_sets where program = 'other_service' and key = 'stage'
);

-- B2. Bốn stage đơn giản. "Need quote" đứng đầu nên là stage mặc định khi tạo
-- hồ sơ. Cờ theo cách ACA đặt cho stage kết thúc: is_terminal + triggers_qc,
-- treat_as_terminal = false.
insert into enrollment_options (set_id, label, color, position, is_terminal, treat_as_terminal, triggers_qc)
select s.id, seed.label, seed.color, seed.position, seed.is_terminal, false, seed.triggers_qc
from enrollment_option_sets s
cross join (
  values
    ('Need quote',  '#64748b', 10, false, false),
    ('In progress', '#f59e0b', 20, false, false),
    ('Enrolled',    '#16a34a', 30, true,  true),
    ('Cancelled',   '#9ca3af', 40, true,  true)
) as seed(label, color, position, is_terminal, triggers_qc)
where s.program = 'other_service' and s.key = 'stage'
  and not exists (
    select 1 from enrollment_options existing
    where existing.set_id = s.id and lower(existing.label) = lower(seed.label)
  );

-- B3. Cột: COPY từ bảng ACA đang chạy (nhãn, vị trí, ghim, ẩn, bắt buộc,
-- Detail như admin đã chỉnh), trừ các cột Marketplace.
insert into table_column (
  scope, key, label, type, is_system, position, pinned, hidden_default, required,
  show_in_detail, created_by_email
)
select
  'other_service', c.key, c.label, c.type, c.is_system, c.position, c.pinned,
  c.hidden_default, c.required, c.show_in_detail, c.created_by_email
from table_column c
where c.scope = 'aca'
  and c.archived_at is null
  and c.key in (
    -- hệ thống
    'key', 'client', 'agent', 'stage', 'timeProgress', 'caller', 'responsible',
    'due', 'fub', 'createdBy', 'createdAt', 'updatedBy', 'updated', 'qc',
    -- tuỳ chỉnh
    'year_2', 'effective_date', 'follow_up_2', 'id'
  )
on conflict (scope, key) do nothing;

-- B4. Giá trị dropdown của các cột tuỳ chỉnh vừa copy (hiện chỉ Year có).
insert into table_column_option (column_id, label, color, position)
select target.id, source_option.label, source_option.color, source_option.position
from table_column source
join table_column_option source_option
  on source_option.column_id = source.id and source_option.archived_at is null
join table_column target
  on target.scope = 'other_service' and target.key = source.key
where source.scope = 'aca'
  and source.key in ('year_2', 'effective_date', 'follow_up_2', 'id')
  and not exists (
    select 1 from table_column_option existing
    where existing.column_id = target.id and lower(existing.label) = lower(source_option.label)
  );

commit;
notify pgrst, 'reload schema';

-- =====================================================================
-- KIỂM CHỨNG
-- =====================================================================
-- (a) 4 stage, 2 kết thúc, 2 bật Complete; mặc định = Need quote.
select count(*) as stages,
       count(*) filter (where o.is_terminal) as terminal,
       count(*) filter (where o.triggers_qc) as triggers_complete,
       (array_agg(o.label order by o.position))[1] as default_stage
from enrollment_options o
join enrollment_option_sets s on s.id = o.set_id
where s.program = 'other_service' and s.key = 'stage' and o.archived_at is null;

-- (b) 14 cột hệ thống + 4 cột tuỳ chỉnh; Year có option.
select count(*) filter (where is_system) as system_columns,
       count(*) filter (where not is_system) as custom_columns,
       (select count(*) from table_column_option o join table_column c on c.id = o.column_id
         where c.scope = 'other_service' and c.key = 'year_2') as year_options
from table_column where scope = 'other_service';

-- (c) Constraint nào nhắc 'medicaid' mà chưa nhắc 'other_service' (phải 0 dòng).
select rel.relname, con.conname
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
join pg_namespace nsp on nsp.oid = rel.relnamespace
where nsp.nspname = 'public' and con.contype = 'c'
  and pg_get_constraintdef(con.oid) like '%''medicaid''%'
  and pg_get_constraintdef(con.oid) not like '%other_service%'
  and con.conname <> 'enrollment_records_medicaid_fields_check';
