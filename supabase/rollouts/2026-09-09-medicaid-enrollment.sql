-- =====================================================================
-- Health Medicaid Enrollment — chương trình enrollment thứ ba.
--
-- Medicaid dùng CHUNG toàn bộ backend với ACA — quyền, scope, realtime, comment,
-- attachment, activity, Overview, export, notification đều là code sẵn có. Khác
-- duy nhất ở DATA SCHEMA: bảng của nó là Name / Who need? / Renewal Date /
-- End Date / Status / Program / Link / People / Agent / Complete, không phải bộ
-- Carrier / Platform / Consent / Payment / AC / PCP của ACA.
--
-- Dữ liệu tách hoàn toàn: hồ sơ, option, cột, số thứ tự và notification của hai
-- chương trình không dính nhau, sửa bên này không đụng bên kia.
--
-- Rollout gồm hai phần:
--   A. Nới khung (constraint, sequence, trigger) — không đụng dữ liệu.
--   B. Khai báo data schema của Medicaid — chỉ ghi khi còn trống, nên chạy lại
--      file này KHÔNG ghi đè thứ admin đã sửa.
--
-- Idempotent. Chạy trong Supabase SQL Editor.
--
-- ⚠ Sau khi chạy: `notify pgrst, 'reload schema';` một lần.
-- ⚠ Chạy rollout NÀY trước khi deploy code, không phải sau: code mới gửi
--   program = 'medicaid', mà constraint cũ sẽ từ chối.
-- =====================================================================

-- =====================================================================
-- A. NỚI KHUNG
-- =====================================================================

-- A1. Hồ sơ và nhóm option nhận thêm giá trị 'medicaid'.
alter table enrollment_records
  drop constraint if exists enrollment_records_program_check;
alter table enrollment_records
  add constraint enrollment_records_program_check
  check (program in ('aca', 'medicare', 'medicaid'));

alter table enrollment_option_sets
  drop constraint if exists enrollment_option_sets_program_check;
alter table enrollment_option_sets
  add constraint enrollment_option_sets_program_check
  check (program in ('aca', 'medicare', 'medicaid'));

-- Ràng buộc "Medicare không có các trường của ACA" giữ NGUYÊN: nó chỉ nói về
-- program = 'medicare'. Medicaid dùng đủ trường như ACA nên không thêm gì.

-- A2. Ba bảng của Table Configuration cùng nhận scope mới.
alter table table_column
  drop constraint if exists table_column_scope_check;
alter table table_column
  add constraint table_column_scope_check
  check (scope in ('cs','aca','medicare','medicaid','lead_pc','lead_health','lead'));

alter table user_table_layout
  drop constraint if exists user_table_layout_scope_check;
alter table user_table_layout
  add constraint user_table_layout_scope_check
  check (scope in ('cs','aca','medicare','medicaid','lead_pc','lead_health','lead'));

alter table import_request
  drop constraint if exists import_request_scope_check;
alter table import_request
  add constraint import_request_scope_check
  check (scope in ('cs','aca','medicare','medicaid','lead_pc','lead_health','lead'));

-- A3. Hàm dùng chung cho các RPC cấu hình bảng.
create or replace function is_table_scope(p_scope text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_scope in ('cs', 'aca', 'medicare', 'medicaid', 'lead');
$$;

-- A4. Số thứ tự hiển thị: mỗi chương trình một bộ đếm riêng (ACA-1, MED-1,
--     MCD-1 chạy độc lập). Bộ đếm mới bắt đầu từ 1.
create sequence if not exists enrollment_records_medicaid_display_number_seq;

do $$
declare
  medicaid_max bigint;
begin
  select max(display_number) into medicaid_max
  from enrollment_records
  where program = 'medicaid';

  if medicaid_max is null then
    perform setval('enrollment_records_medicaid_display_number_seq', 1, false);
  else
    -- Chạy lại sau khi đã có hồ sơ: đẩy bộ đếm lên quá số lớn nhất, đừng cấp
    -- lại số đã dùng.
    perform setval('enrollment_records_medicaid_display_number_seq', medicaid_max, true);
  end if;
end $$;

-- Trigger cũ có nhánh `else` rơi về bộ đếm ACA, nên nếu chỉ thêm sequence mà
-- quên sửa đây thì hồ sơ Medicaid sẽ lấy số của ACA và hai bên đụng số nhau.
create or replace function enrollment_records_assign_display_number()
returns trigger
language plpgsql
as $$
begin
  if new.display_number is null then
    new.display_number := case new.program
      when 'medicare' then nextval('enrollment_records_medicare_display_number_seq')
      when 'medicaid' then nextval('enrollment_records_medicaid_display_number_seq')
      else nextval('enrollment_records_aca_display_number_seq')
    end;
  end if;
  return new;
end;
$$;

-- =====================================================================
-- B. DATA SCHEMA CỦA MEDICAID
--
-- Backend giống ACA hoàn toàn (quyền, scope, realtime, comment, attachment,
-- activity, Overview, export). Chỉ DỮ LIỆU là khác, và đây là chỗ khai báo nó.
--
-- Bảng nghiệp vụ:
--   Name | Who need? | Renewal Date | End Date | Status | Program | Link |
--   People | Agent | Complete
--
-- Ánh xạ sang cột có sẵn (không thêm cột nào vào enrollment_records):
--   Name         -> client_name             (cột hệ thống `client`)
--   Renewal Date -> due_date                (`due`) — nhờ vậy ăn theo nhắc hạn
--   Status       -> stage_id                (`stage`) — có lịch sử stage + Overview
--   Link         -> fub_link                (`fub`)
--   People       -> responsible_enroll_email(`responsible`)
--   Agent        -> agent_email             (`agent`)
--   Complete     -> QC                      (`qc`)
-- Ba cột còn lại là cột TUỲ CHỈNH, giá trị nằm trong enrollment_records.custom_values:
--   Who need?  (dropdown)  Program (dropdown)  End Date (date)
--
-- Mọi khối đều `where not exists`: chạy lại là no-op, không ghi đè thứ admin sửa.
-- =====================================================================

-- B1. Nhóm option hệ thống duy nhất của Medicaid: Stage.
insert into enrollment_option_sets (program, key, label, is_stage)
select 'medicaid', 'stage', 'Status', true
where not exists (
  select 1 from enrollment_option_sets
  where program = 'medicaid' and key = 'stage'
);

-- B2. Mười hai giá trị Status.
--
-- Thứ tự lấy theo `position`, KHÔNG theo bảng chữ cái — xem
-- compareEnrollmentOptions trong src/lib/enrollment/options.ts. "To Do" đứng
-- đầu nên nó là stage mặc định khi tạo hồ sơ mới (firstStageOption lấy phần tử
-- đầu danh sách đã sắp). Nếu ai đó kéo một trạng thái khác lên đầu trong
-- /config thì mặc định đổi theo — đúng như mong đợi.
--
-- is_terminal = hồ sơ đã tới kết cục: hết đếm quá hạn, hết nhắc. Approved,
-- Denied, Cancelled và Expired thuộc nhóm này. "Need to renewal" thì KHÔNG —
-- đó vẫn là việc phải làm.
--
-- triggers_qc = vào trạng thái này thì bật ô Complete để soát. Chỉ Approved.
insert into enrollment_options (
  set_id, label, color, position, is_terminal, treat_as_terminal, triggers_qc
)
select s.id, seed.label, seed.color, seed.position, seed.is_terminal, seed.is_terminal, seed.triggers_qc
from enrollment_option_sets s
cross join (
  values
    ('To Do',                        '#64748b', 5,   false, false),
    ('URGENT',                       '#dc2626', 10,  false, false),
    ('Hold',                         '#f472b6', 20,  false, false),
    ('In processing',                '#f59e0b', 30,  false, false),
    ('Need Apply',                   '#f97316', 35,  false, false),
    ('Need Upload',                  '#f59e0b', 40,  false, false),
    ('Waiting for collect document', '#a855f7', 50,  false, false),
    ('Need to renewal',              '#3b82f6', 60,  false, false),
    ('Approved',                     '#16a34a', 70,  true,  true),
    ('Denied',                       '#6b7280', 80,  true,  false),
    ('Cancelled',                    '#84cc16', 90,  true,  false),
    ('Expired',                      '#9ca3af', 100, true,  false)
) as seed(label, color, position, is_terminal, triggers_qc)
where s.program = 'medicaid' and s.key = 'stage'
  and not exists (
    select 1 from enrollment_options existing
    where existing.set_id = s.id and lower(existing.label) = lower(seed.label)
  );

-- B3. Cột hệ thống của bảng Medicaid.
--
-- Cùng danh sách với DEFAULT_TABLE_COLUMNS.medicaid trong
-- src/lib/table-config/queries.ts — đó là bản dự phòng khi database chưa seed,
-- đây là bản thật. Hai chỗ phải khớp nhau.
insert into table_column (
  scope, key, label, type, is_system, position, pinned, hidden_default, required
)
select
  'medicaid', seed.key, seed.label, seed.type, true, seed.position,
  seed.key in ('key', 'client'),
  seed.hidden_default,
  seed.key in ('agent', 'client')
from (
  values
    ('key',         'Key',              'text',     10,  false),
    ('client',      'Name',             'text',     20,  false),
    ('due',         'Renewal Date',     'date',     40,  false),
    ('stage',       'Status',           'dropdown', 60,  false),
    ('fub',         'Link',             'link',     80,  false),
    ('responsible', 'People',           'person',   90,  false),
    ('agent',       'Agent',            'person',   100, false),
    ('qc',          'Complete',         'checkbox', 110, false),
    ('createdBy',   'Created by',       'person',   150, true),
    ('createdAt',   'Created time',     'date',     160, true),
    ('updatedBy',   'Last edited by',   'person',   170, true),
    ('updated',     'Last edited time', 'date',     180, true)
) as seed(key, label, type, position, hidden_default)
on conflict (scope, key) do nothing;

-- B4. Ba cột riêng của Medicaid, dạng cột tuỳ chỉnh.
--
-- Cố ý KHÔNG thêm cột mới vào enrollment_records: giá trị đi vào
-- `custom_values`, đường mà list, detail, create, export và activity đều đã
-- xử lý sẵn. Nhờ vậy backend không phải biết Medicaid có gì khác ACA, và admin
-- sửa/thêm giá trị ngay trong /config mà không cần một rollout nữa.
insert into table_column (
  scope, key, label, type, is_system, position, pinned, hidden_default, required
)
select 'medicaid', seed.key, seed.label, seed.type, false, seed.position, false, false, false
from (
  values
    ('whoNeed',         'Who need?', 'dropdown', 30),
    ('endDate',         'End Date',  'date',     50),
    ('medicaidProgram', 'Program',   'dropdown', 70)
) as seed(key, label, type, position)
on conflict (scope, key) do nothing;

-- B5. Giá trị của hai dropdown tuỳ chỉnh.
insert into table_column_option (column_id, label, color, position)
select c.id, seed.label, seed.color, seed.position
from table_column c
join (
  values
    ('whoNeed',         'Family',                  '#f59e0b', 10),
    ('whoNeed',         'Individual',              '#16a34a', 20),
    ('whoNeed',         'Kids',                    '#3b82f6', 30),
    ('whoNeed',         'Mother',                  '#a855f7', 40),
    ('medicaidProgram', 'SNAP',                    '#dc2626', 10),
    ('medicaidProgram', 'Medicaid/CHIP',           '#0ea5e9', 20),
    ('medicaidProgram', 'Medicaid Medicare Saving', '#16a34a', 30),
    ('medicaidProgram', 'Long term care',          '#6366f1', 40)
) as seed(column_key, label, color, position) on seed.column_key = c.key
where c.scope = 'medicaid'
  and not exists (
    select 1 from table_column_option existing
    where existing.column_id = c.id and lower(existing.label) = lower(seed.label)
  );

-- =====================================================================
-- KIỂM CHỨNG — đọc bằng mắt trước khi đóng tab.
-- =====================================================================

-- (a) Medicaid có đúng MỘT nhóm option (Stage). ACA có 6 — hai bên khác nhau
--     là đúng, không phải thiếu sót.
select program, count(*) as option_sets
from enrollment_option_sets
group by program
order by program;

-- (b) Đủ 12 trạng thái; 4 trạng thái kết thúc (Approved/Denied/Cancelled/Expired);
--     1 trạng thái bật ô Complete (Approved).
select
  count(*) as statuses,
  count(*) filter (where o.is_terminal) as terminal_statuses,
  count(*) filter (where o.triggers_qc) as triggers_complete
from enrollment_options o
join enrollment_option_sets s on s.id = o.set_id
where s.program = 'medicaid' and s.key = 'stage';

-- (b2) Stage mặc định khi tạo hồ sơ mới — phải là "To Do".
select o.label as default_stage_on_create
from enrollment_options o
join enrollment_option_sets s on s.id = o.set_id
where s.program = 'medicaid' and s.key = 'stage' and o.archived_at is null
order by o.position, o.label
limit 1;

-- (c) 12 cột hệ thống + 3 cột tuỳ chỉnh = 15.
select
  count(*) filter (where is_system) as system_columns,
  count(*) filter (where not is_system) as custom_columns
from table_column
where scope = 'medicaid';

-- (d) Bốn giá trị "Who need?" và bốn giá trị "Program".
select c.key, count(o.id) as options
from table_column c
left join table_column_option o on o.column_id = c.id
where c.scope = 'medicaid' and c.type = 'dropdown' and not c.is_system
group by c.key
order by c.key;

-- (e) Bộ đếm số thứ tự đã sẵn sàng.
select last_value, is_called
from enrollment_records_medicaid_display_number_seq;

-- (f) BẮT BUỘC ĐỌC: còn constraint nào nhắc 'medicare' mà KHÔNG nhắc 'medicaid'
--     không. Các lệnh `drop constraint if exists` ở phần A dựa vào tên mặc định
--     Postgres đặt (<bảng>_<cột>_check). Nếu một constraint từng được đặt tên
--     khác, lệnh drop là no-op còn lệnh add vẫn chạy — và constraint cũ vẫn âm
--     thầm chặn 'medicaid'. Truy vấn này phải trả về 0 dòng.
select
  rel.relname as table_name,
  con.conname as constraint_name,
  pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
join pg_namespace nsp on nsp.oid = rel.relnamespace
where nsp.nspname = 'public'
  and con.contype = 'c'
  and pg_get_constraintdef(con.oid) like '%medicare%'
  and pg_get_constraintdef(con.oid) not like '%medicaid%'
  -- Ràng buộc riêng của Medicare (các trường ACA phải null) đúng là chỉ nhắc
  -- medicare — nó không phải danh sách chương trình hợp lệ.
  and con.conname <> 'enrollment_records_medicare_fields_check'
order by 1, 2;
