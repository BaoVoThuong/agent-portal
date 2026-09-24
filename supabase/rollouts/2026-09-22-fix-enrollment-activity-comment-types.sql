-- =====================================================================
-- Fix: sửa hoặc xoá bình luận trên hồ sơ Enrollment bị lỗi.
--
-- Triệu chứng người dùng gặp: bấm Save khi sửa một bình luận thì hiện
--   new row for relation "enrollment_activity" violates check constraint
--   "enrollment_activity_type_check"
-- và bình luận KHÔNG được lưu.
--
-- Nguyên nhân: hai RPC `edit_enrollment_comment` và `delete_enrollment_comment`
-- ghi hoạt động kiểu 'comment_edited' / 'comment_deleted'. `schema.sql` có khai
-- hai giá trị đó trong danh sách của bảng, NHƯNG bảng được tạo bằng
-- `create table if not exists` — câu đó không đụng tới bảng đã tồn tại, nên
-- check constraint trên production vẫn là bản cũ chưa có hai giá trị này.
-- Bảng `task_activity` không dính vì nó đã có sẵn khối tự-sửa constraint.
--
-- Đã dò thực tế trên production: chỉ 'comment_edited' và 'comment_deleted' bị
-- chặn; 14 giá trị còn lại đều qua được.
--
-- Chạy lại nhiều lần vẫn an toàn. Giữ NOT VALID để không quét lại toàn bộ
-- hoạt động cũ khi thay constraint.
-- =====================================================================

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'enrollment_activity_type_check'
      and conrelid = 'public.enrollment_activity'::regclass
  ) then
    alter table public.enrollment_activity
      drop constraint enrollment_activity_type_check;
  end if;

  alter table public.enrollment_activity
    add constraint enrollment_activity_type_check
    check (
      type in (
        'created',
        'edited',
        'field_changed',
        'stage_changed',
        'people_changed',
        'comment_added',
        'attachment_added',
        'qc_needed',
        'qc_reviewed',
        'qc_review_cleared',
        'reopened',
        'archived',
        'due_soon',
        'went_overdue',
        'comment_edited',
        'comment_deleted'
      )
    ) not valid;
end $$;

-- Kỳ vọng: chuỗi trả về có cả 'comment_edited' lẫn 'comment_deleted'.
select pg_get_constraintdef(oid) as enrollment_activity_type_constraint
from pg_constraint
where conname = 'enrollment_activity_type_check'
  and conrelid = 'public.enrollment_activity'::regclass;
