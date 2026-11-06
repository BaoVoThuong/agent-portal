-- =====================================================================
-- Time Off: xoá dữ liệu mẫu cũ, tạo mẫu mới theo ngày hiện tại (2026-11-01)
--
-- Mẫu cũ (2026-09-03): 4.428 đơn "[Sample time off] backfilled history #…"
-- trải từ 2020, 126 đơn pending đã quá hạn (tới 27/10), cộng 2 đơn thử tay
-- không có lý do của bao.vo. Xoá hết.
--
-- Mẫu mới — mọi lý do bắt đầu bằng "[Sample]" để sau này xoá một lệnh:
--   * 2025: 1 đơn Annual Leave đã duyệt mỗi người (Leave history có năm trước).
--   * 2026 đã qua: 2 đơn Annual Leave đã duyệt mỗi người; thêm Unpaid đã duyệt
--     (1/3 số người), bị từ chối (1/4), tự huỷ (1/5).
--   * Sắp tới: đơn pending tháng 11–12 cho ~1/4 số người (+ bao.vo), và đơn đã
--     duyệt dịp cuối năm cho ~1/6 số người.
--   Annual Leave đã duyệt năm 2026 tối đa 8 ngày/người (quỹ 15).
--   manager_id = Manager của người đó (như code mới tự gán); người duyệt = bao.vo.
--   total_days = ngày làm việc, trừ cuối tuần và ngày lễ liên bang (đã tính ngày
--   nghỉ bù), khớp countLeaveBusinessDays.
--
-- Không đụng time_off_balances / policies / accrual rules / holidays.
-- Chạy lại: xoá mẫu "[Sample]" cũ rồi tạo lại, không nhân đôi.
-- =====================================================================

begin;

delete from time_off_requests
where reason like '[Sample time off]%'
   or reason like '[Sample]%'
   or id in ('c6d0c014-8409-452a-9922-bdb06be97207', '158dd4f3-64df-4c15-8678-ed9b40b617d4');

with holidays(day) as (
  values
    ('2025-01-01'::date), ('2025-01-20'), ('2025-02-17'), ('2025-05-26'), ('2025-06-19'), ('2025-07-04'),
    ('2025-09-01'), ('2025-10-13'), ('2025-11-11'), ('2025-11-27'), ('2025-12-25'),
    ('2026-01-01'), ('2026-01-19'), ('2026-02-16'), ('2026-05-25'), ('2026-06-19'), ('2026-07-03'),
    ('2026-09-07'), ('2026-10-12'), ('2026-11-11'), ('2026-11-26'), ('2026-12-25'), ('2027-01-01')
),
people as (
  select id, manager_id, email, row_number() over (order by email) as n
  from portal_account
  where is_active
),
reviewer as (
  select id from portal_account where email = 'bao.vo@excelplannings.com'
),
-- slot: base date, length in calendar days, policy, status, who gets it.
slots as (
  select p.*, s.*
  from people p
  cross join lateral (
    values
      (1, '2025-07-07'::date + (p.n % 25)::int, 3, 'vacation', 'approved',  true),
      (2, '2026-02-02'::date + (p.n % 20)::int, 2, 'vacation', 'approved',  true),
      (3, '2026-06-01'::date + (p.n % 25)::int, 3, 'vacation', 'approved',  true),
      (4, '2026-08-03'::date + (p.n % 20)::int, 1, 'unpaid',   'approved',  p.n % 3 = 0),
      (5, '2026-04-06'::date + (p.n % 20)::int, 2, 'vacation', 'rejected',  p.n % 4 = 1),
      (6, '2026-09-14'::date + (p.n % 20)::int, 2, 'vacation', 'cancelled', p.n % 5 = 2),
      (7, '2026-11-16'::date + (p.n % 35)::int, 1 + (p.n % 3)::int,
          case when p.n % 8 = 0 then 'unpaid' else 'vacation' end, 'pending',
          p.n % 4 = 0 or p.email = 'bao.vo@excelplannings.com'),
      (8, '2026-12-28'::date, 3, 'vacation', 'approved', p.n % 6 = 0)
  ) as s(slot, base, len, policy, status, included)
  where s.included
),
dated as (
  select *,
    -- Weekend start → next Monday, so every request covers working days.
    base + case extract(dow from base) when 6 then 2 when 0 then 1 else 0 end as start_day
  from slots
),
priced as (
  select d.*,
    d.start_day + (d.len - 1) as end_day,
    (
      select count(*)
      from generate_series(d.start_day, d.start_day + (d.len - 1), interval '1 day') as g(day)
      where extract(dow from g.day) not in (0, 6)
        and g.day::date not in (select day from holidays)
    ) as total_days
  from dated d
)
insert into time_off_requests (
  requester_id, policy_code, start_date, end_date, total_days, reason, status,
  reviewer_id, reviewer_note, reviewed_at, created_at, updated_at, manager_id
)
select
  p.id,
  p.policy,
  p.start_day,
  p.end_day,
  p.total_days,
  '[Sample] ' || (array['Family trip', 'Personal errands', 'Medical appointment', 'Moving house', 'Wedding', 'Rest and recharge', 'Child care', 'Travel'])[1 + ((p.n + p.slot) % 8)::int],
  p.status,
  case when p.status in ('approved', 'rejected') then (select id from reviewer) end,
  case when p.status = 'rejected' then 'Team coverage is too thin those days.' end,
  case when p.status in ('approved', 'rejected') then (p.start_day - 9)::timestamptz end,
  case when p.status = 'pending' then now() - make_interval(days => (p.n % 5)::int)
       else (p.start_day - 10)::timestamptz end,
  case when p.status = 'pending' then now() - make_interval(days => (p.n % 5)::int)
       else (p.start_day - 9)::timestamptz end,
  case when p.manager_id is not null and p.manager_id <> p.id then p.manager_id end
from priced p
where p.total_days > 0;

commit;

-- Kiểm: số đơn theo trạng thái, và không ai vượt quỹ Annual Leave 2026.
select status, count(*) as requests, count(distinct requester_id) as people,
       min(start_date) as first_day, max(start_date) as last_day
from time_off_requests
group by status
order by status;

select max(days) as max_vacation_days_2026
from (
  select requester_id, sum(total_days) as days
  from time_off_requests
  where policy_code = 'vacation' and status in ('approved', 'pending')
    and start_date >= '2026-01-01' and start_date < '2027-01-01'
  group by requester_id
) as per_person;
