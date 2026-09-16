-- =====================================================================
-- Provider List: thêm khoá ổn định + cột tuỳ chỉnh cho provider_address,
-- và mở scope `provider` cho hệ table-config.
--
-- Vì sao an toàn với luồng sync: promote_sheet_sync_run xoá theo ĐÚNG cặp
-- (source_sheet_id, source_gid) rồi chèn lại từ staging. Dòng thêm tay mang
-- ('portal', 'manual') không nằm trong vùng đó nên không lượt sync nào xoá
-- được. Ngược lại, dòng đến từ Sheet bị thay mới mỗi đêm — `id` của chúng đổi
-- theo, và mọi chỉnh sửa tay trên dòng Sheet sẽ mất cho tới khi luồng sync
-- được tắt. Màn hình phải nói rõ điều đó với người dùng.
--
-- Idempotent, chạy lại được. Chạy TRƯỚC khi deploy code.
-- ⚠ Sau khi chạy: notify pgrst, 'reload schema';
-- =====================================================================

alter table provider_address
  add column if not exists id uuid not null default gen_random_uuid(),
  add column if not exists custom_values jsonb not null default '{}'::jsonb,
  add column if not exists created_by_email text,
  add column if not exists updated_by_email text,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists archived_at timestamptz;

-- Khoá tra cứu của API. Cố ý KHÔNG dùng primary key: sync chèn lại toàn bộ
-- phân vùng Sheet mỗi đêm, một unique index đủ để định danh mà không ràng buộc
-- thêm gì vào đường ghi của sync.
create unique index if not exists provider_address_id_idx
  on provider_address (id);

-- Danh sách luôn lọc dòng đã archive rồi sắp theo lần cập nhật gần nhất.
create index if not exists provider_address_active_idx
  on provider_address (archived_at, updated_at desc);

-- ---------------------------------------------------------------------
-- Scope `provider` cho hệ table-config
-- ---------------------------------------------------------------------

-- Thiếu giá trị này thì không thêm được cột nào cho bảng provider.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'table_column_scope_check'
      and conrelid = 'public.table_column'::regclass
  ) then
    alter table public.table_column drop constraint table_column_scope_check;
  end if;

  alter table public.table_column
    add constraint table_column_scope_check
    check (scope in ('cs','aca','medicare','medicaid','lead_pc','lead_health','lead','provider'));
end $$;

-- Layout theo từng người cũng có CHECK cùng danh sách. Quên nó thì bảng hiện
-- ra bình thường nhưng mọi lần đổi độ rộng / ẩn / kéo thứ tự cột đều bị
-- database từ chối — đúng tính năng "nhớ layout" mà màn hình hứa.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'user_table_layout_scope_check'
      and conrelid = 'public.user_table_layout'::regclass
  ) then
    alter table public.user_table_layout drop constraint user_table_layout_scope_check;
  end if;

  alter table public.user_table_layout
    add constraint user_table_layout_scope_check
    check (scope in ('cs','aca','medicare','medicaid','lead_pc','lead_health','lead','provider'));
end $$;

-- `reorder_table_columns_atomic` và `table_config_write_context` đều gác bằng
-- hàm này. Quên nó là kéo đổi thứ tự cột báo "Invalid column order" mà không ai
-- hiểu vì sao — đúng cái bẫy đã mắc một lần với lead_pc/lead_health.
create or replace function is_table_scope(p_scope text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_scope in ('cs', 'aca', 'medicare', 'medicaid', 'lead', 'provider');
$$;

-- ---------------------------------------------------------------------
-- Kiểm chứng. Supabase Studio không hiện RAISE NOTICE nên trả về bảng.
-- Kỳ vọng: đúng một dòng, cả bốn cột đều 'ok'.
-- ---------------------------------------------------------------------
select
  case when (select count(*) from information_schema.columns
             where table_schema = 'public' and table_name = 'provider_address'
               and column_name in ('id','custom_values','archived_at','updated_at',
                                   'created_by_email','updated_by_email')) = 6
       then 'ok' else 'FAIL: thiếu cột' end                         as cot_moi,
  case when is_table_scope('provider')
       then 'ok' else 'FAIL: scope chưa mở' end                     as scope_provider,
  case when (select count(*) from pg_indexes
             where schemaname = 'public' and indexname = 'provider_address_id_idx') = 1
       then 'ok' else 'FAIL: thiếu index id' end                    as index_id,
  case when (select count(*) from provider_address where id is null) = 0
       then 'ok' else 'FAIL: còn dòng thiếu id' end                 as moi_dong_co_id,
  -- Thiếu cái này thì bảng vẫn hiện nhưng không ai lưu được độ rộng cột.
  case when (select count(*) from pg_constraint
             where conname = 'user_table_layout_scope_check'
               and conrelid = 'public.user_table_layout'::regclass
               and pg_get_constraintdef(oid) like '%provider%') = 1
       then 'ok' else 'FAIL: layout chưa nhận scope provider' end   as layout_scope;

-- Số dòng hiện có, để đối chiếu với màn hình sau khi deploy. Cột thu_cong phải
-- là 0 ngay sau rollout: chưa ai thêm dòng nào từ portal.
select
  count(*) as tong_dong,
  count(*) filter (where archived_at is null) as dang_hien,
  count(*) filter (where source_sheet_id = 'portal') as thu_cong
from provider_address;
