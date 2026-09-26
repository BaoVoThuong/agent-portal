-- =====================================================================
-- Khoá RLS cho các bảng tạo sau vòng protected_tables của schema.sql
-- (audit 2026-09-25, S0).
--
-- Server dùng service role (BYPASSRLS) nên app không đổi hành vi. Trình duyệt
-- chỉ dùng anon key cho Realtime broadcast, không đọc bảng. `datasync/` dùng
-- service role key.
--
-- KHÔNG có bản "đảo ngược" của file này: mở lại quyền là mở lại lỗ hổng.
-- Nếu có chức năng hỏng, sửa chức năng đó chứ không nới bảng.
--
-- Idempotent. Bảng chưa tồn tại thì bỏ qua.
-- =====================================================================
begin;

do $$
declare
  t text;
begin
  foreach t in array array[
    'time_off_policies',
    'time_off_balances',
    'time_off_balance_adjustments',
    'time_off_balance_adjustment_batches',
    'time_off_holidays',
    'time_off_requests',
    'time_off_monthly_accrual_rules',
    'time_off_notifications',
    'push_subscriptions',
    'notification_preferences',
    'task_comment_edits',
    'zipcode_lookup',
    'provider_directory',
    'sheet_sync_runs',
    'sheet_sync_staging'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I enable row level security', t);
      execute format('revoke all on table public.%I from anon, authenticated', t);
    end if;
  end loop;
end $$;

-- Hậu kiểm NGAY TRONG transaction (review A P1-04): còn bảng public mở cho
-- anon/authenticated mà chưa bật RLS thì RAISE → rollback toàn bộ, kèm tên bảng.
do $$
declare
  leaked text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into leaked
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
    and not c.relrowsecurity
    and (has_table_privilege('anon', c.oid, 'SELECT')
      or has_table_privilege('anon', c.oid, 'INSERT')
      or has_table_privilege('anon', c.oid, 'UPDATE')
      or has_table_privilege('anon', c.oid, 'DELETE')
      or has_table_privilege('authenticated', c.oid, 'SELECT')
      or has_table_privilege('authenticated', c.oid, 'INSERT')
      or has_table_privilege('authenticated', c.oid, 'UPDATE')
      or has_table_privilege('authenticated', c.oid, 'DELETE'));
  if leaked is not null then
    raise exception 'Còn bảng public mở cho anon/authenticated mà chưa bật RLS: %. Thêm vào danh sách ở trên rồi chạy lại.', leaked;
  end if;
end $$;

commit;

-- Bảng trong danh sách mà CHƯA tồn tại (được bỏ qua ở trên). Bảng nào lẽ ra
-- phải có (vd time_off_*) mà nằm đây nghĩa là rollout tạo nó chưa chạy.
select t as missing_table
from unnest(array[

    'time_off_policies',
    'time_off_balances',
    'time_off_balance_adjustments',
    'time_off_balance_adjustment_batches',
    'time_off_holidays',
    'time_off_requests',
    'time_off_monthly_accrual_rules',
    'time_off_notifications',
    'push_subscriptions',
    'notification_preferences',
    'task_comment_edits',
    'zipcode_lookup',
    'provider_directory',
    'sheet_sync_runs',
    'sheet_sync_staging'
]) as t
where to_regclass('public.' || t) is null;
