-- =====================================================================
-- Time Off: chọn manager khi nộp đơn, và thông báo cho họ.
--
-- Quyết định đã chốt với đội:
--   * Chọn manager là để BÁO TIN, không giới hạn ai được duyệt. Ai có
--     `timeoff.admin` vẫn duyệt được mọi đơn, y như trước.
--   * Người nhận thông báo = manager được chọn + tất cả người có quyền duyệt.
--   * Thông báo đi theo đúng đường của task.
--
-- ⚠ Chạy SAU rollout org chart (2026-09-12-org-chart-manager.sql): ô chọn
--   manager lấy mặc định từ portal_account.manager_id.
-- ⚠ Chạy TRƯỚC khi deploy code.
-- ⚠ Sau khi chạy: notify pgrst, 'reload schema';
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Manager của từng đơn — BẢN CHỤP, không phải tham chiếu sống
--
-- Cố ý lưu trên chính đơn thay vì tra lại portal_account.manager_id lúc hiển
-- thị. Org chart thay đổi theo thời gian; một đơn nộp tháng trước phải mãi mãi
-- cho thấy nó đã được gửi cho AI, chứ không phải người hiện đang giữ ghế đó.
--
-- `on delete set null`: người đó rời công ty thì đơn cũ vẫn còn, chỉ mất tên.
-- ---------------------------------------------------------------------
alter table time_off_requests
  add column if not exists manager_id uuid references portal_account(id) on delete set null;

create index if not exists time_off_requests_manager_idx
  on time_off_requests (manager_id, status);

-- ---------------------------------------------------------------------
-- 2. Bảng thông báo riêng cho Time Off
--
-- Đi theo đúng khuôn `enrollment_notifications`: mỗi module một bảng, chuông
-- đọc hết rồi trộn lại. KHÔNG nhồi vào `task_notifications` — bảng đó có
-- `task_id not null references tasks(id)`, nên muốn dùng chung phải nới cột đó
-- thành nullable, tức là đụng vào đường thông báo bận nhất của cả ứng dụng để
-- phục vụ một module phụ. Không đáng.
--
-- Danh sách `type` khai sẵn cả vòng đời đơn để sau này khỏi migrate lần nữa,
-- nhưng đợt này CHỈ 'submitted' được phát. Báo cho người nộp lúc đơn được
-- duyệt/từ chối là việc tốt nhưng đội chưa yêu cầu.
-- ---------------------------------------------------------------------
create table if not exists time_off_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_email text not null,
  request_id uuid not null references time_off_requests(id) on delete cascade,
  type text not null check (type in ('submitted', 'approved', 'rejected', 'cancelled')),
  actor_email text not null,
  detail text,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

-- Cùng hình dạng index với hai bảng thông báo kia: chuông luôn hỏi theo
-- "của tôi, chưa đọc, mới nhất trước".
create index if not exists time_off_notifications_recipient_idx
  on time_off_notifications (recipient_email, is_read, created_at desc);

-- Một người chỉ nhận MỘT thông báo cho mỗi sự kiện của mỗi đơn. Người vừa là
-- manager được chọn vừa có quyền duyệt sẽ lọt vào cả hai danh sách người nhận;
-- ràng buộc này khiến việc đó không thể biến thành hai dòng trùng nhau, kể cả
-- khi phía code quên lọc.
create unique index if not exists time_off_notifications_unique_event
  on time_off_notifications (request_id, recipient_email, type);

-- ---------------------------------------------------------------------
-- Kiểm chứng
-- ---------------------------------------------------------------------

-- (a) Cột và bảng đã có. Cả ba phải ra 1.
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'time_off_requests'
      and column_name = 'manager_id') as co_cot_manager_id,
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'time_off_notifications') as co_bang_noti,
  (select count(*) from pg_indexes
    where schemaname = 'public'
      and indexname = 'time_off_notifications_unique_event') as co_index_chong_trung;

-- (b) Đơn cũ chưa có manager — đúng như kỳ vọng, cột vừa mới thêm.
select
  count(*) as tong_don,
  count(manager_id) as don_da_co_manager
from time_off_requests;

-- (c) Bảng thông báo bắt đầu từ rỗng.
select count(*) as so_thong_bao from time_off_notifications;
