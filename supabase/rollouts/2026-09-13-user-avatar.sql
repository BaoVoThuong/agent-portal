-- =====================================================================
-- Ảnh đại diện người dùng.
--
-- Mỗi người tự tải ảnh ở /settings; ảnh đó thay hai chữ viết tắt ở mọi nơi đang
-- hiện người — bảng task, thẻ board, comment, ô chọn người, danh sách lead,
-- TopBar.
--
-- Rollout này CHỈ thêm một cột. Bucket `avatars` được tạo bằng mã lúc chạy
-- (`configureAvatarBucket` trong src/lib/people/avatar-storage.ts), theo đúng
-- khuôn của bucket task-attachments — để môi trường mới dựng lại được mà không
-- cần ai nhớ các bước bấm tay trên giao diện Supabase.
--
-- ⚠ Chạy TRƯỚC khi deploy code.
-- ⚠ Sau khi chạy: notify pgrst, 'reload schema';
-- =====================================================================

-- ---------------------------------------------------------------------
-- Cột ảnh
--
-- Lưu URL công khai đầy đủ, không lưu đường dẫn trong bucket. Lý do: URL là thứ
-- thẻ <img> cần, và đọc nó ra là dùng được ngay — không phải ghép chuỗi ở mọi
-- nơi hiển thị, cũng không phải nhớ tên bucket ở phía giao diện.
--
-- null = chưa đặt ảnh, giao diện quay về hai chữ viết tắt như trước.
--
-- Mỗi lần đổi ảnh ghi vào một UUID mới rồi xoá tệp cũ, nên giá trị cột luôn đổi
-- theo. Đây là cách tránh việc bucket công khai cache ảnh cũ hàng tuần.
-- ---------------------------------------------------------------------
alter table portal_account
  add column if not exists avatar_url text;

-- ---------------------------------------------------------------------
-- Kiểm chứng
-- ---------------------------------------------------------------------

-- (a) Cột đã có. Phải ra 1.
select count(*) as co_cot_avatar_url
from information_schema.columns
where table_schema = 'public'
  and table_name = 'portal_account'
  and column_name = 'avatar_url';

-- (b) Chưa ai có ảnh ngay sau rollout — đúng như kỳ vọng.
select
  count(*) as tong_tai_khoan,
  count(avatar_url) as da_co_anh
from portal_account
where is_active;
