-- =====================================================================
-- Ngưng loại nghỉ "Sick Leave".
--
-- Đội không dùng loại nghỉ này nữa. Từ nay không tạo đơn Sick mới được, và nó
-- biến mất khỏi ô chọn loại nghỉ cùng bảng quỹ ngày.
--
-- ⚠ KHÔNG XOÁ dòng policy. `time_off_requests.policy_code` và
--   `time_off_balances.policy_code` tham chiếu nó bằng `on delete restrict` —
--   xoá dòng vừa bị database chặn, vừa là xoá 1.505 đơn cũ. Ngưng hoạt động là
--   đúng cách, và đúng khuôn đã dùng cho 'personal' trước đây.
--
-- ⚠ ĐỌC KỸ MỤC 2 TRƯỚC KHI CHẠY: hiện có 43 đơn Sick đang CHỜ DUYỆT.
--
-- ⚠ Chạy TRƯỚC khi deploy code. Code cũ vẫn cho tạo đơn Sick, nên chạy sớm chỉ
--   khiến ô chọn mất sớm hơn vài phút — không có cửa sổ hỏng.
-- ⚠ Sau khi chạy: notify pgrst, 'reload schema';
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Ngưng policy
-- ---------------------------------------------------------------------
update time_off_policies
set is_active = false, updated_at = now()
where code = 'sick';

-- ---------------------------------------------------------------------
-- 2. ⚠ 43 ĐƠN SICK ĐANG CHỜ DUYỆT
--
-- `approve_time_off_request` tra policy kèm điều kiện `and is_active`, và ném
-- TIME_OFF_POLICY_NOT_FOUND nếu không thấy. Nghĩa là ngay sau bước 1, 43 đơn
-- đó KHÔNG CÒN DUYỆT ĐƯỢC — bấm Approve sẽ ra lỗi.
--
-- Từ chối và huỷ thì vẫn chạy bình thường (hai thao tác đó là UPDATE thẳng,
-- không đi qua RPC), nên không ai bị kẹt vĩnh viễn: admin vẫn dọn được.
--
-- Khối dưới đây CỐ Ý để nguyên dạng ghi chú. Tự động huỷ 43 đơn của người khác
-- là quyết định của đội, không phải của đợt rollout này. Chọn một trong ba:
--
--   (a) Không làm gì — để admin tự từ chối/huỷ từng đơn trên giao diện.
--       An toàn nhất, và người nộp đơn nhìn thấy kết quả rõ ràng.
--
--   (b) Duyệt nốt TRƯỚC khi chạy bước 1, nếu số đơn đó là thật và hợp lệ.
--
--   (c) Huỷ hàng loạt — bỏ dấu chú thích khối dưới. Chỉ làm khi đội đã đồng ý.
--       Ghi 'cancelled' chứ không 'rejected': đơn bị đóng vì công ty bỏ loại
--       nghỉ, không phải vì quản lý xét rồi bác.
--
-- Đọc thêm: cả 1.505 đơn Sick trong lịch sử đều chưa từng được duyệt
-- (0 approved / 731 rejected / 731 cancelled / 43 pending), và 43 đơn pending
-- có cùng ngày nghỉ lẫn cùng created_at — nhiều khả năng là dữ liệu seed lúc
-- dựng tính năng chứ không phải đơn thật. Vẫn nên nhìn tận mắt trước khi huỷ.
--
-- update time_off_requests
-- set status = 'cancelled', updated_at = now()
-- where policy_code = 'sick' and status = 'pending';

-- ---------------------------------------------------------------------
-- Kiểm chứng
-- ---------------------------------------------------------------------

-- (a) Sick đã ngưng; hai loại còn lại vẫn bật.
select code, label, is_active
from time_off_policies
order by position;

-- (b) Lịch sử còn nguyên — con số này PHẢI không đổi sau rollout.
--     Nếu nó về 0 nghĩa là dòng policy đã bị xoá thay vì ngưng.
select count(*) as don_sick_trong_lich_su
from time_off_requests
where policy_code = 'sick';

-- (c) Còn bao nhiêu đơn Sick chờ duyệt — tức còn bao nhiêu đơn không thể
--     Approve cho tới khi admin dọn (xem mục 2).
select count(*) as don_sick_con_cho_duyet
from time_off_requests
where policy_code = 'sick' and status = 'pending';
