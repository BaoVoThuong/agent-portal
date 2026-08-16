-- ═══════════════════════════════════════════════════════════════════════
-- 19 — BÁO CÁO PHÂN BỐ DỮ LIỆU MẪU SAU FILE 18. CHỈ ĐỌC.
--
-- Trả về BẢNG (không dùng RAISE NOTICE — Supabase Studio không hiện notice).
-- Cột "Kết quả": ✅ = đạt, ❌ = còn phẳng / sai ràng buộc.
-- ═══════════════════════════════════════════════════════════════════════

with sample as (
  select * from enrollment_records where client_name like '%Sample QA%'
),
stask as (
  select * from tasks where title like '%Sample QA%'
),
-- Độ phẳng: tỉ lệ giữa nhóm đông nhất và nhóm thưa nhất. Càng gần 1 càng phẳng.
stage_spread as (
  select max(c)::numeric / nullif(min(c), 0) as ratio
  from (select stage_id, count(*) c from sample where stage_id is not null group by stage_id) x
),
person_spread as (
  select max(c)::numeric / nullif(min(c), 0) as ratio
  from (select responsible_enroll_email, count(*) c from sample
        where responsible_enroll_email is not null group by responsible_enroll_email) x
),
checks(sort, name, actual, note) as (

  -- ── Ràng buộc bắt buộc ───────────────────────────────────────────────
  select 1, 'Medicare còn dữ liệu ở cột riêng ACA (phải 0)',
    (select count(*) from sample where program = 'medicare' and (
      caller_email is not null or pcp_2026 is not null or platform_id is not null
      or consent_id is not null or payment_status_id is not null or aca_status_id is not null)),
    'constraint enrollment_records_medicare_fields_check'
  union all
  select 2, 'Record có stage nhưng thiếu stage_entered_at (phải 0)',
    (select count(*) from sample where stage_id is not null and stage_entered_at is null), 'constraint'
  union all
  select 3, 'Cycle có ended_at < started_at (phải 0)',
    (select count(*) from enrollment_stage_cycles where ended_at < started_at), 'constraint'
  union all
  select 4, 'Cycle lệch cặp ended_at/duration (phải 0)',
    (select count(*) from enrollment_stage_cycles
      where (ended_at is null) <> (duration_seconds is null)), 'constraint'
  union all
  select 5, 'Record đã đóng mà còn cycle mở (phải 0)',
    (select count(*) from enrollment_stage_cycles c join enrollment_records r on r.id = c.record_id
      where c.ended_at is null and r.closed_at is not null), 'invariant file 14'
  union all
  select 6, 'Task backlog mà có người nhận (phải 0)',
    (select count(*) from stask where status = 'backlog' and assignee_email is not null), 'constraint'
  union all
  select 7, 'Task khác backlog mà thiếu người nhận (phải 0)',
    (select count(*) from stask where status <> 'backlog' and assignee_email is null), 'constraint'
  union all
  select 8, 'Task trỏ vào category đã tắt (phải 0)',
    (select count(*) from stask t join task_categories c on c.id = t.category_id
      where not c.is_active), 'trigger tasks_active_category_guard'
  union all
  select 9, 'Mốc thời gian rơi vào tương lai (phải 0)',
    (select count(*) from sample where closed_at > now() or stage_entered_at > now()
        or created_at > now() or qc_checked_at > now())
    + (select count(*) from stask where closed_at > now() or in_progress_at > now()), 'plausibility'

  -- ── Đã hết phẳng chưa ────────────────────────────────────────────────
  union all
  select 10, 'Số stage khác nhau đang được dùng (cần ≥ 18)',
    (select count(distinct stage_id) from sample where stage_id is not null), 'trước đây chỉ 13'
  union all
  select 11, 'Chênh lệch stage đông nhất / thưa nhất (cần ≥ 3)',
    (select round(ratio) from stage_spread)::bigint, 'trước đây ~1 (phẳng lì)'
  union all
  select 12, 'Chênh lệch người ôm nhiều nhất / ít nhất (cần ≥ 3)',
    (select round(ratio) from person_spread)::bigint, 'trước đây ~1'
  union all
  select 13, 'Số tháng khác nhau có record được tạo (cần ≥ 4)',
    (select count(distinct to_char(created_at, 'YYYY-MM')) from sample), 'trước đây chỉ 1'
  union all
  select 14, 'Số nhóm tuổi stage có mặt (cần ≥ 5)',
    (select count(distinct width_bucket(
       extract(epoch from (now() - stage_entered_at)) / 86400,
       array[0,4,11,21,46,91]::numeric[]))
     from sample where stage_entered_at is not null), 'trước đây 99.8% dồn 1 nhóm'
  union all
  select 15, 'Record chưa có người phụ trách (hàng chờ giao việc)',
    (select count(*) from sample where responsible_enroll_email is null), 'trước đây 0'
  union all
  select 16, 'Task ở backlog (cột chờ nhận việc)',
    (select count(*) from stask where status = 'backlog'), 'trước đây 0'
)
select
  sort as "#",
  case
    when sort <= 9  and actual = 0 then '✅'
    when sort <= 9                 then '❌ SAI'
    when sort = 10 and actual >= 18 then '✅'
    when sort = 11 and actual >= 3  then '✅'
    when sort = 12 and actual >= 3  then '✅'
    when sort = 13 and actual >= 4  then '✅'
    when sort = 14 and actual >= 5  then '✅'
    when sort in (15,16) and actual > 0 then '✅'
    else '❌ CÒN PHẲNG'
  end as "Kết quả",
  name as "Chỉ số", actual as "Giá trị", note as "Ghi chú"
from checks

union all
select 30, 'ℹ️', 'Enrollment mẫu / thật',
  (select count(*) from sample),
  (select count(*)::text from enrollment_records where client_name not like '%Sample QA%') || ' record thật'
union all
select 31, 'ℹ️', 'Task mẫu / thật',
  (select count(*) from stask),
  (select count(*)::text from tasks where title not like '%Sample QA%') || ' task thật'
union all
select 32, 'ℹ️', 'Tổng cycle sau khi dựng lại',
  (select count(*) from enrollment_stage_cycles), 'gồm cả chặng dwell trước đó'
union all
select 33, 'ℹ️', 'Record mẫu đã quá hạn due_date',
  (select count(*) from sample where due_date < current_date and closed_at is null), 'để test bộ lọc quá hạn'
union all
select 34, 'ℹ️', 'Task mẫu bị đánh dấu trễ',
  (select count(*) from stask where overdue_flagged_at is not null), 'để test bộ lọc trễ hạn'
order by 1;
