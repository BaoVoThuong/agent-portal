-- ===========================================================================
-- Gỡ các đơn chờ duyệt mẫu do `time-off-pending-sample.sql` tạo ra.
--
-- Chỉ xoá dòng mang nhãn `[Sample time off] pending queue`. Khối lịch sử của
-- `time-off-history-bulk-sample.sql` và đơn thật của nhân viên không bị đụng.
-- ===========================================================================

delete from public.time_off_requests
where reason like '[Sample time off] pending queue%';

-- Phải trả về 0.
select count(*) as remaining_pending_samples
from public.time_off_requests
where reason like '[Sample time off] pending queue%';
