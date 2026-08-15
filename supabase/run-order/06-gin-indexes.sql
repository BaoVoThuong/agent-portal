-- 06 — 2 GIN index cho custom_values
-- Đã BỎ chữ CONCURRENTLY: Supabase Studio tự bọc transaction nên CONCURRENTLY sẽ lỗi.
-- Bảng nhỏ (tasks 431, enrollment_records 667) nên build thường chỉ vài ms.
begin;
create index if not exists tasks_custom_values_active_gin_idx
  on public.tasks using gin (custom_values jsonb_path_ops)
  where archived_at is null;

create index if not exists enrollment_records_custom_values_active_gin_idx
  on public.enrollment_records using gin (custom_values jsonb_path_ops)
  where archived_at is null;
commit;
