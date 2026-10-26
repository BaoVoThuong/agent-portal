-- Provider List: Backlog chờ duyệt (2026-10-26).
--
-- Ai xem được Provider List cũng thêm / nhập được, nhưng dòng của người KHÔNG
-- có Provider List - Manage nằm ở Backlog (`pending = true`) cho tới khi một
-- người có Manage duyệt. Người có Manage thêm thì vào thẳng danh sách như cũ.
--
-- Dòng chờ duyệt ở CHUNG bảng provider_directory để comment / activity / thông
-- báo dùng lại nguyên khoá provider_id, và duyệt chỉ là bật cờ về false (giữ
-- nguyên id). Đổi lại, MỌI chỗ đọc danh sách / Finder / Export phải lọc
-- `pending = false` — code mới đã lọc; code đang chạy trên Vercel thì CHƯA,
-- nên giữa lúc chạy file này và lúc deploy, dòng chờ duyệt tạo ra lúc test sẽ
-- hiện trong List / Finder của bản đang chạy.
--
-- `duplicate_of`: dòng gửi lên trùng một dòng đã có (cùng ID trong file nhập,
-- hoặc cùng địa chỉ + cùng NPI / tên). Người duyệt chọn "Update existing" để
-- chép phần khác biệt sang dòng cũ thay vì thêm một bản thứ hai.
--
-- An toàn với code đang chạy: hai cột mới đều có mặc định (dòng cũ và dòng
-- code cũ chèn vào là `pending = false`), CHECK chỉ nới thêm loại.
-- An toàn khi chạy lại: `if not exists`, drop/add constraint trong transaction.

begin;

alter table provider_directory
  add column if not exists pending boolean not null default false,
  add column if not exists duplicate_of uuid
    references provider_directory(id) on delete set null;

-- Tab Backlog đọc đúng tập này; danh sách chính đọc phần bù của nó.
create index if not exists provider_directory_pending_idx
  on provider_directory (created_at desc)
  where pending and archived_at is null;

alter table provider_activity
  drop constraint if exists provider_activity_type_check;
alter table provider_activity
  add constraint provider_activity_type_check
  check (
    type in (
      'created',
      'field_changed',
      'archived',
      'comment_added',
      'comment_edited',
      'comment_deleted',
      'submitted',
      'approved',
      'merged',
      'rejected'
    )
  );

-- 'submitted' → người có Manage (có dòng mới chờ duyệt);
-- 'approved' / 'rejected' → người gửi.
alter table provider_notifications
  drop constraint if exists provider_notifications_type_check;
alter table provider_notifications
  add constraint provider_notifications_type_check
  check (type in ('mentioned', 'submitted', 'approved', 'rejected'));


commit;

notify pgrst, 'reload schema';
