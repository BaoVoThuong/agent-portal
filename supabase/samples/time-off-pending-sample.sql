-- ===========================================================================
-- Demo-only: đơn nghỉ phép ĐANG CHỜ DUYỆT cho mọi tài khoản đang hoạt động.
--
-- Tách khỏi `time-off-history-bulk-sample.sql` vì hai bộ này khác bản chất:
-- lịch sử nằm ở QUÁ KHỨ và đã có kết luận; đơn chờ duyệt phải nằm ở TƯƠNG LAI,
-- vì một đơn xin nghỉ cho ngày đã trôi qua thì không còn gì để duyệt.
--
-- 3 đơn / người × 43 tài khoản = ~129 đơn. Con số này cố ý VƯỢT `.limit(100)`
-- của truy vấn hàng đợi duyệt trong `fetchTimeOffDashboard`, để thấy được
-- ngưỡng cắt đó có biểu hiện gì trên màn hình Administration → Approvals.
--
-- ⚠ Supabase này CŨNG là production. Các đơn này hiện trong hàng đợi duyệt
--   thật cho tới khi dọn. Gỡ bằng `time-off-pending-cleanup.sql`.
--
-- Chạy lại được: xoá nhãn của chính nó rồi tạo lại, không nhân đôi.
-- ===========================================================================

do $$
declare
  created integer;
begin
  -- Nhãn hẹp, không đụng khối lịch sử của file bulk (cùng tiền tố, khác đuôi).
  delete from public.time_off_requests
  where reason like '[Sample time off] pending queue%';

  insert into public.time_off_requests (
    requester_id, policy_code, start_date, end_date, total_days, reason, status,
    reviewer_id, reviewer_note, reviewed_at, created_at, updated_at
  )
  select
    account.id,
    sample.policy_code,
    sample.start_date,
    sample.end_date,
    (sample.end_date - sample.start_date + 1)::numeric(6,1),
    '[Sample time off] pending queue #' || sample.n,
    'pending',
    -- BẮT BUỘC null cả hai. Ràng buộc của bảng là
    -- `(status = 'pending' and reviewer_id is null and reviewed_at is null)
    --  or status <> 'pending'` — điền reviewer vào đơn pending là insert hỏng.
    null,
    null,
    null,
    now() - make_interval(days => sample.n),
    now() - make_interval(days => sample.n)
  from public.portal_account account
  cross join lateral (
    select
      n,
      policy_code,
      start_date,
      -- Đơn 1 ngày và 2 ngày xen kẽ, để phần hiển thị khoảng ngày có cả hai dạng.
      start_date + case when n = 2 then 1 else 0 end as end_date
    from (
      select
        n,
        case n when 1 then 'vacation' when 2 then 'sick' else 'unpaid' end as policy_code,
        -- Đẩy khỏi thứ Bảy/Chủ Nhật.
        raw_date + case extract(dow from raw_date)
                     when 0 then 1
                     when 6 then 2
                     else 0
                   end as start_date
      from (
        -- Rải trong ~3 tháng tới: 12, 33, 54 ngày nữa.
        select n, (current_date + (n * 21) - 9) as raw_date
        from generate_series(1, 3) as n
      ) spread
    ) shaped
  ) sample
  where account.is_active;

  get diagnostics created = row_count;
  raise notice 'Đã tạo % đơn chờ duyệt.', created;
end;
$$;

-- Kiểm chứng. `queue_limit_exceeded` = true nghĩa là bộ mẫu đã đủ lớn để chạm
-- ngưỡng 100 của hàng đợi duyệt — đúng mục đích của file này.
select
  count(*)                                            as pending_samples,
  count(distinct requester_id)                        as accounts_covered,
  min(start_date)                                     as earliest_start,
  max(start_date)                                     as latest_start,
  (select count(*) from public.time_off_requests
   where status = 'pending') > 100                    as queue_limit_exceeded
from public.time_off_requests
where reason like '[Sample time off] pending queue%';
