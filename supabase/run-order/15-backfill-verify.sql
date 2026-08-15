-- 15 — VERIFY file 13 + 14. CHỈ ĐỌC, không ghi gì.
-- Chạy xong không báo lỗi = thành công. Xem phần NOTICE để đối chiếu số liệu.

do $v$
declare
  n_cycles        integer;
  n_backfill      integer;
  n_live          integer;
  n_open          integer;
  n_need_open     integer;
  n_entered_null  integer;
  n_stage_null    integer;
  n_work_null     integer;
  n_resp_null      integer;
  n_aca           integer;
begin
  select count(*) into n_cycles   from enrollment_stage_cycles;
  select count(*) into n_backfill from enrollment_stage_cycles where source = 'backfill';
  select count(*) into n_live     from enrollment_stage_cycles where source = 'live';
  select count(*) into n_open     from enrollment_stage_cycles where ended_at is null;

  select count(*) into n_need_open
  from enrollment_records
  where stage_id is not null and closed_at is null and archived_at is null;

  select count(*) into n_entered_null
  from enrollment_records
  where archived_at is null and stage_id is not null and stage_entered_at is null;

  select count(*) into n_stage_null
  from enrollment_records where archived_at is null and stage_id is null;

  select count(*) into n_aca
  from enrollment_records where program = 'aca' and archived_at is null;

  select count(*) into n_work_null
  from enrollment_records
  where program = 'aca' and archived_at is null and last_work_activity_at is null;

  select count(*) into n_resp_null
  from enrollment_records
  where program = 'aca' and archived_at is null
    and responsible_enroll_email is not null and responsible_assigned_at is null;

  -- ── Kiểm tra cứng ────────────────────────────────────────────────────
  if n_entered_null <> 0 then
    raise exception 'FAIL: % record có stage nhưng thiếu stage_entered_at', n_entered_null;
  end if;

  if n_open <> n_need_open then
    raise exception 'FAIL: % cycle mở nhưng có % record active cần cycle mở', n_open, n_need_open;
  end if;

  if exists (
    select 1 from enrollment_stage_cycles
    where ended_at is null group by record_id having count(*) > 1
  ) then raise exception 'FAIL: có record đang mở nhiều cycle cùng lúc'; end if;

  if exists (
    select 1 from enrollment_stage_cycles where ended_at < started_at or duration_seconds < 0
  ) then raise exception 'FAIL: có cycle duration âm'; end if;

  if n_resp_null <> 0 then
    raise exception 'FAIL: % record ACA có người phụ trách nhưng thiếu responsible_assigned_at', n_resp_null;
  end if;

  -- ── Báo cáo ──────────────────────────────────────────────────────────
  raise notice '─────────────────────────────────────────────';
  raise notice 'enrollment_stage_cycles : % dòng (backfill %, live %)', n_cycles, n_backfill, n_live;
  raise notice 'cycle đang mở           : %  (khớp % record active có stage)', n_open, n_need_open;
  raise notice 'record thiếu stage_entered_at : %  (phải = 0)', n_entered_null;
  raise notice 'record chưa có stage    : %  ← cần gán tay trong app', n_stage_null;
  raise notice '─────────────────────────────────────────────';
  raise notice 'ACA active              : % record', n_aca;
  raise notice '  thiếu last_work_activity_at : %  (còn lại là record chưa có hoạt động nào)', n_work_null;
  raise notice '  thiếu responsible_assigned_at : %  (phải = 0)', n_resp_null;
  raise notice '─────────────────────────────────────────────';
  raise notice 'TẤT CẢ KIỂM TRA ĐỀU QUA.';
end
$v$;
