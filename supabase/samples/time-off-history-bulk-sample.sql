-- ===========================================================================
-- Demo-only: 100 PAST time-off requests for every active account.
--
-- Purpose: fill `My requests → View full history` and
-- `Administration → Leave history` with enough rows to judge scrolling,
-- ordering and the 250-row read cap. 43 active accounts × 100 = ~4,300 rows.
--
-- ⚠ This Supabase project is ALSO production. These rows appear on the real
--   HR screens until cleaned up. Run `time-off-history-bulk-cleanup.sql` to
--   remove them; mọi dòng mang nhãn `[Sample time off] backfilled history`
--   nên bộ pending mẫu và đơn thật đều không bị đụng.
--
-- Safe to re-run: it deletes the tagged rows first, then recreates them.
-- ===========================================================================

do $$
declare
  reviewer_account_id uuid;
  created integer;
begin
  -- Ai đứng tên người duyệt. Lấy một admin đang hoạt động; nếu không có thì
  -- lấy tài khoản đầu tiên — dữ liệu demo không cần đúng người, chỉ cần một
  -- reviewer_id hợp lệ để qua ràng buộc của bảng.
  select id into reviewer_account_id
  from public.portal_account
  where is_active
  order by case when role = 'admin' then 0 else 1 end, email
  limit 1;

  if reviewer_account_id is null then
    raise notice 'Không có tài khoản nào đang hoạt động; bỏ qua.';
    return;
  end if;

  -- Nhãn hẹp: chỉ dọn đúng khối lịch sử của file này, không đụng bộ pending
  -- mẫu ở `time-off-pending-sample.sql` (nhãn khác, cùng tiền tố).
  delete from public.time_off_requests
  where reason like '[Sample time off] backfilled history%';

  insert into public.time_off_requests (
    requester_id, policy_code, start_date, end_date, total_days, reason, status,
    reviewer_id, reviewer_note, reviewed_at, created_at, updated_at
  )
  select
    account.id,
    sample.policy_code,
    sample.start_date,
    sample.end_date,
    sample.total_days,
    sample.reason,
    sample.status,
    reviewer_account_id,
    case sample.status
      when 'rejected' then 'Sample rejection — team coverage.'
      when 'approved' then 'Sample approval.'
      else null
    end,
    sample.decided_at,
    sample.created_at,
    coalesce(sample.decided_at, sample.created_at)
  from public.portal_account account
  cross join lateral (
    select
      n,
      policy_code,
      start_date,
      end_date,
      -- Đếm thô theo số ngày lịch. Đây là dữ liệu minh hoạ, không phải nguồn
      -- sự thật cho quỹ phép — và mọi dòng `approved` đều là `unpaid`, tức
      -- không cộng vào quỹ của ai (xem chú thích dưới).
      (end_date - start_date + 1)::numeric(6,1) as total_days,
      status,
      '[Sample time off] backfilled history #' || n as reason,
      (start_date - 7)::timestamptz as created_at,
      case when status = 'pending' then null
           else (start_date - 6)::timestamptz end as decided_at
    from (
      select
        n,
        policy_code,
        start_date,
        start_date + case when n % 4 = 0 then 2 else 0 end as end_date,
        status
      from (
        select
          n,
          -- Trải ngược ~6 năm: 100 đơn × 22 ngày ≈ 2.200 ngày.
          weekday_start as start_date,
          case n % 3 when 0 then 'vacation' when 1 then 'sick' else 'unpaid' end as policy_code,
          -- CHỈ `unpaid` được `approved`. `used_days` trong
          -- approve_time_off_request chỉ cộng các đơn `approved`, và `unpaid`
          -- có counts_toward_balance = false — nên toàn bộ khối mẫu này KHÔNG
          -- làm lệch quỹ phép của bất kỳ ai, kể cả các năm cũ. vacation/sick
          -- luôn là rejected/cancelled để màn hình vẫn có đủ màu trạng thái.
          case
            when n % 3 = 2 then 'approved'
            when n % 2 = 0 then 'rejected'
            else 'cancelled'
          end as status
        from (
          select
            n,
            -- Đẩy khỏi thứ Bảy/Chủ Nhật cho giống đơn thật.
            raw_date + case extract(dow from raw_date)
                         when 0 then 1
                         when 6 then 2
                         else 0
                       end as weekday_start
          from (
            select n, (current_date - (n * 22)) as raw_date
            from generate_series(1, 100) as n
          ) spread
        ) weekday
      ) shaped
    ) built
  ) sample
  where account.is_active;

  get diagnostics created = row_count;
  raise notice 'Đã tạo % đơn mẫu.', created;
end;
$$;

-- Kiểm chứng: mỗi tài khoản đang hoạt động phải có đúng 100 dòng mẫu, và
-- không dòng `approved` nào thuộc policy có tính vào quỹ.
select
  (select count(*) from public.time_off_requests
   where reason like '[Sample time off] backfilled history%')                       as sample_rows,
  (select count(distinct requester_id) from public.time_off_requests
   where reason like '[Sample time off] backfilled history%')                       as accounts_covered,
  (select count(*) from public.time_off_requests request
   join public.time_off_policies policy on policy.code = request.policy_code
   where request.reason like '[Sample time off] backfilled history%'
     and request.status = 'approved'
     and policy.counts_toward_balance)                           as balance_affecting_rows;
