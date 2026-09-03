-- ===========================================================================
-- Gỡ toàn bộ đơn nghỉ phép mẫu do `time-off-history-bulk-sample.sql` tạo ra.
--
-- Chỉ xoá khối lịch sử (`[Sample time off] backfilled history`). Đơn chờ duyệt
-- mẫu có nhãn riêng — dọn bằng `time-off-pending-cleanup.sql`. Đơn thật của
-- nhân viên không bao giờ mang nhãn nào trong số này.
-- ===========================================================================

delete from public.time_off_requests
where reason like '[Sample time off] backfilled history%';

-- Phải trả về 0.
select count(*) as remaining_sample_rows
from public.time_off_requests
where reason like '[Sample time off] backfilled history%';
