-- =====================================================================
-- Lead: bỏ cột Tag (2026-10-03)
--
-- User bỏ cột Tag (nhãn cảnh báo No contact / Stale…) cùng ô lọc theo nó khỏi
-- bảng Lead. Code đã ẩn cột này (LEAD_LIST_RETIRED_COLUMN_KEYS trong
-- src/lib/leads/list-column-visibility.ts), nên KHÔNG bắt buộc chạy file này;
-- chạy để trang Table Configuration cũng không còn liệt kê cột Tag.
--
-- Archive (không xoá): cột hệ thống không archive được từ màn Config, nên làm
-- bằng SQL. Chạy lại an toàn.
-- =====================================================================

update public.table_column
set archived_at = now(),
    updated_at = now()
where scope = 'lead'
  and key = 'tag'
  and archived_at is null;
