-- ═══════════════════════════════════════════════════════════════════════
-- 16 — KIỂM TRA TOÀN BỘ TRẠNG THÁI DB. CHỈ ĐỌC, KHÔNG GHI GÌ.
--
-- Trả về một BẢNG kết quả (không dùng RAISE NOTICE, vì Supabase Studio
-- không hiển thị notice — nó chỉ báo "Success. No rows returned").
--
-- Đọc cột "Kết quả": tất cả phải là ✅. Dòng "ℹ️ tham khảo" chỉ để đối chiếu
-- số liệu, không phải điều kiện đúng/sai.
--
-- Bao phủ: kết quả của file 01-15 + đợt gộp terminal semantics (2026-08-16).
-- ═══════════════════════════════════════════════════════════════════════

with aca_stage as (
  select o.*
  from enrollment_options o
  join enrollment_option_sets s on s.id = o.set_id
  where s.program = 'aca' and s.key = 'stage' and o.archived_at is null
),
med_stage as (
  select o.*
  from enrollment_options o
  join enrollment_option_sets s on s.id = o.set_id
  where s.program = 'medicare' and s.key = 'stage' and o.archived_at is null
),
checks(sort, name, actual, expected) as (

  -- ── Gộp terminal semantics (2026-08-16) ──────────────────────────────
  select 1, 'Option còn giữ cờ treat_as_terminal cũ',
    (select count(*) from enrollment_options where treat_as_terminal is distinct from false), 0
  union all
  select 2, 'ACA "11-ID card unavailable" là stage kết thúc',
    (select count(*) from aca_stage
      where lower(label) = '11-id card unavailable' and is_terminal), 1

  -- ── Catalog stage ────────────────────────────────────────────────────
  union all
  select 3, 'Số stage ACA đang active', (select count(*) from aca_stage), 12
  union all
  select 4, 'Số stage Medicare đang active', (select count(*) from med_stage), 11
  union all
  select 5, 'Stage kết thúc ACA chưa bật QC',
    (select count(*) from aca_stage where is_terminal and not triggers_qc), 0

  -- ── Toàn vẹn tham chiếu ──────────────────────────────────────────────
  union all
  select 6, 'Record active trỏ vào stage đã archive',
    (select count(*) from enrollment_records r
      join enrollment_options o on o.id = r.stage_id
      where r.archived_at is null and o.archived_at is not null), 0

  -- ── Backfill stage-time (file 14) ────────────────────────────────────
  union all
  select 7, 'Record có stage nhưng thiếu stage_entered_at/source',
    (select count(*) from enrollment_records
      where stage_id is not null
        and (stage_entered_at is null or stage_entered_source is null)), 0
  union all
  select 8, 'Cycle đang mở (phải bằng số record active có stage)',
    (select count(*) from enrollment_stage_cycles where ended_at is null),
    (select count(*) from enrollment_records
      where stage_id is not null and closed_at is null and archived_at is null)
  union all
  select 9, 'Cycle sai duration hoặc entry_marker',
    (select count(*) from enrollment_stage_cycles
      where duration_seconds < 0 or ended_at < started_at
         or (kind = 'entry_marker' and (ended_at is null or duration_seconds <> 0))), 0
  union all
  select 10, 'Record đã đóng nhưng còn cycle mở',
    (select count(*) from enrollment_stage_cycles c
      join enrollment_records r on r.id = c.record_id
      where c.ended_at is null and (r.closed_at is not null or r.archived_at is not null)), 0

  -- ── Backfill ACA overview (file 13) ──────────────────────────────────
  union all
  select 11, 'Record ACA có người phụ trách nhưng thiếu responsible_assigned_at',
    (select count(*) from enrollment_records
      where program = 'aca' and responsible_enroll_email is not null
        and responsible_assigned_at is null), 0
)
select
  sort                                                     as "#",
  case when actual = expected then '✅' else '❌ SAI' end  as "Kết quả",
  name                                                     as "Kiểm tra",
  actual                                                   as "Thực tế",
  expected                                                 as "Mong đợi"
from checks

union all

-- ── Số liệu tham khảo, không phải điều kiện đúng/sai ────────────────────
select 20, 'ℹ️', 'enrollment_stage_cycles — tổng',
  (select count(*) from enrollment_stage_cycles), null::bigint
union all
select 21, 'ℹ️', 'enrollment_stage_cycles — do backfill dựng',
  (select count(*) from enrollment_stage_cycles where source = 'backfill'), null::bigint
union all
select 22, 'ℹ️', 'Record chưa có stage — cần gán tay trong app',
  (select count(*) from enrollment_records where archived_at is null and stage_id is null), null::bigint
union all
select 23, 'ℹ️', 'Record ACA có last_work_activity_at',
  (select count(*) from enrollment_records
    where program = 'aca' and last_work_activity_at is not null), null::bigint
union all
select 24, 'ℹ️', 'Enrollment record là dữ liệu mẫu [Sample QA]',
  (select count(*) from enrollment_records where client_name like '%Sample QA%'), null::bigint
union all
select 25, 'ℹ️', 'Task là dữ liệu mẫu [Sample QA]',
  (select count(*) from tasks where title like '%Sample QA%'), null::bigint

order by 1;
