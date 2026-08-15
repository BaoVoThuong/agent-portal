-- 08 — unique index label dropdown (đã BỎ CONCURRENTLY, lý do như file 06)
-- Preflight đã chạy: table_column_option 4 dòng, không trùng label chuẩn hoá → build được.
begin;
create unique index if not exists table_column_option_active_label_uniq
  on public.table_column_option (column_id, lower(btrim(label)))
  where archived_at is null;
commit;
