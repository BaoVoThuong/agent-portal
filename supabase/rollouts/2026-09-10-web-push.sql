-- =====================================================================
-- Web Push — đẩy thông báo ra ngoài trình duyệt.
--
-- Xem kế hoạch: docs/2026-09-10-web-push-notifications.md
--
-- Thuần additive: hai bảng mới, không đụng bảng nào đang chạy. Chạy trước khi
-- deploy code cũng được, mà chạy sau cũng không sao — code đọc hai bảng này đều
-- fail mềm (không có bảng = không ai bật push, chuông trong web vẫn chạy).
--
-- ⚠ Sau khi chạy: `notify pgrst, 'reload schema';`
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Địa chỉ đẩy của từng MÁY.
--
-- Khoá chính là `endpoint` chứ không phải email: một người dùng cả máy bàn lẫn
-- laptop thì có hai đăng ký, và endpoint do trình duyệt cấp vốn đã duy nhất
-- toàn cầu. Lấy email làm khoá là mỗi lần đăng ký máy mới sẽ đá máy cũ ra.
--
-- p256dh + auth là hai khoá trình duyệt cấp để mã hoá payload. Không có chúng
-- thì không gửi được — nhưng chúng chỉ dùng được với đúng endpoint đó, nên rò
-- rỉ bảng này không cho phép đọc trộm thông báo của ai.
-- ---------------------------------------------------------------------
create table if not exists push_subscriptions (
  endpoint text primary key,
  recipient_email text not null,
  p256dh text not null,
  auth text not null,
  -- Để người dùng nhận ra máy nào trong danh sách thiết bị khi cần gỡ.
  user_agent text,
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  -- Số lần gửi hỏng LIÊN TIẾP. 404/410 thì xoá thẳng (đăng ký chết hẳn); lỗi
  -- tạm (mạng, 5xx) chỉ tăng số đếm để còn thấy máy nào đang có vấn đề.
  failure_count integer not null default 0
);

create index if not exists push_subscriptions_recipient_idx
  on push_subscriptions (recipient_email);

-- ---------------------------------------------------------------------
-- 2. Bật/tắt theo từng người.
--
-- Gộp cả cờ ÂM THANH vào đây, không tách bảng: đó là một yêu cầu riêng trong
-- cùng đợt feedback ("noti có tiếng có thể bật tắt — Bảo là người quyết định ai
-- bật ai tắt"), và hai cờ này luôn được đọc cùng nhau trong một lần truy vấn.
--
-- Mặc định BẬT cả hai: người chưa có dòng nào trong bảng vẫn nhận như bình
-- thường. Nhờ vậy không cần backfill cho 43 tài khoản đang có.
-- ---------------------------------------------------------------------
create table if not exists notification_preferences (
  email text primary key,
  push_enabled boolean not null default true,
  sound_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  -- Ai đổi — admin đổi hộ người khác thì phải truy được.
  updated_by_email text
);

-- ---------------------------------------------------------------------
-- Kiểm chứng
-- ---------------------------------------------------------------------

-- (a) Hai bảng đã có mặt.
select
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'push_subscriptions') as has_push_subscriptions,
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'notification_preferences') as has_preferences;

-- (b) Sau khi vài người bật: mỗi email có bao nhiêu máy đã đăng ký.
select recipient_email, count(*) as devices, max(created_at) as newest
from push_subscriptions
group by recipient_email
order by recipient_email;

-- (c) Ai đang bị tắt push/tiếng (rỗng lúc mới chạy là đúng).
select email, push_enabled, sound_enabled, updated_by_email, updated_at
from notification_preferences
where not push_enabled or not sound_enabled
order by email;
