-- =====================================================================
-- Hai index cho đường đọc chính của danh sách lead.
--
-- 1. Danh sách mặc định (không lọc product) sắp theo created_at desc. Index
--    `leads_product_active_idx (product, created_at desc)` không phục vụ được
--    nếu không có mệnh đề `product = …`, nên Postgres quét toàn bộ tập active
--    rồi sort. Ở vài trăm dòng không đáng kể; ở vài nghìn thì có.
-- 2. Bộ lọc Status (`?status_id=`) và mệnh đề `status_id not in (...)` của truy
--    vấn cảnh báo không có index nào.
--
-- Idempotent. `create index if not exists` chạy lại là no-op.
-- KHÔNG dùng `concurrently`: Supabase Studio bọc mỗi lần gửi trong một
-- transaction, và `create index concurrently` không chạy trong transaction.
-- =====================================================================

create index if not exists leads_active_created_idx
  on leads (created_at desc, id)
  where archived_at is null;

create index if not exists leads_status_active_idx
  on leads (status_id)
  where archived_at is null;

-- Kiểm chứng: cả hai phải xuất hiện.
select indexname
from pg_indexes
where tablename = 'leads'
  and indexname in ('leads_active_created_idx', 'leads_status_active_idx')
order by indexname;
