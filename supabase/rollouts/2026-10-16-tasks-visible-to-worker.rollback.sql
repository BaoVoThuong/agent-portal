-- Rollback 2026-10-16-tasks-visible-to-worker.sql.
-- Chỉ chạy SAU khi đã revert code gọi `tasks_visible_to_worker`. Code cũ quay lại chuỗi
-- `.or(id.in.(...))`, nên TaskScopeTooLargeError có thể tái xuất hiện, nhưng không mở rộng
-- quyền xem.
drop function if exists public.tasks_visible_to_worker(text, text[]);

notify pgrst, 'reload schema';
