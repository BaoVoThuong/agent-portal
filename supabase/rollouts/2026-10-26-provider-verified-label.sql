-- Provider List: cột needs_review đổi nhãn "Reviewed" → "Verified" (2026-10-26).
--
-- Reviewed và Verified là MỘT trạng thái: tick ô này là hệ thống đóng dấu
-- Verified by / Verified date, và nút Verify của Backlog cũng đóng đúng dấu đó
-- (user chốt 26/10: chỉ đổi tên, cách hoạt động giữ nguyên). Một chữ cho cả ô
-- tick trên form, cột trên bảng và nhãn trên dialog.
--
-- Chỉ đổi khi nhãn còn là "Reviewed": admin đã đặt tên khác trong /config thì
-- giữ tên của admin. File Excel cũ có cột "Reviewed" vẫn nhập được — alias
-- `reviewed` trong lib/providers/import.ts.
-- An toàn khi chạy lại.

begin;

update table_column
set label = 'Verified',
    updated_at = now()
where scope = 'provider'
  and key = 'needs_review'
  and label = 'Reviewed'
  and archived_at is null;

commit;
