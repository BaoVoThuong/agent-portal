-- ═══════════════════════════════════════════════════════════════════════
-- 14 — BACKFILL THỜI GIAN NẰM Ở TỪNG STAGE (enrollment_stage_cycles)
--
--            ⛔ CHẠY SAU FILE 13. SNAPSHOT TRƯỚC. ⛔
--
-- Nguồn: supabase/rollouts/2026-08-09-enrollment-stage-time-backfill.sql
-- Rollout đó chưa từng chạy. Hiện trạng:
--   • enrollment_stage_cycles : 2 dòng (đều source='live', đều đã đóng)
--   • stage_entered_at        : 663/665 record active đang null
--   • stage_entered_source    : 663/665 record active đang null
-- → Mọi thống kê dwell / thời gian mỗi bước đang tính trên đúng 2 record.
--
-- Nguồn dữ liệu để dựng lại: enrollment_stage_history 682 dòng
-- (682 dòng có to_option_id, 15 dòng có from_option_id).
--
-- ───────────────────────────────────────────────────────────────────────
-- ĐÃ PRE-VALIDATE 6 INVARIANT TRÊN DB THẬT — TẤT CẢ ĐỀU QUA
--
-- Phân bố record: 667 tổng | 529 active | 527 active-có-stage | 138 đã
-- closed_at | 0 archived_at | 2 không có stage (do file 11 đưa về null).
--
-- 1. "multiple open cycles": mỗi record chỉ sinh tối đa 1 dòng từ
--    enrollment_backfill_current, các dwell từ history đều đã đóng. ✓
-- 2. "active stage missing open cycle": 527 record active-có-stage đều có
--    live_from = null nên đều lọt vào backfill_current, và vì inactive_at
--    = null nên nhận cycle MỞ. ✓
--    Điểm suýt hỏng đã kiểm: 2 record duy nhất đang có live cycle
--    (#8 Zoe Nguyen, #23 Anh Nguyen) bị loại khỏi backfill_current, mà
--    cycle live của chúng là entry_marker ĐÃ ĐÓNG. May là cả hai đều đã
--    closed_at nên KHÔNG thuộc nhóm 527 → invariant không đụng tới chúng.
-- 3. "inactive record has open cycle": 138 record closed có inactive_at
--    không null → nhận cycle đã đóng. ✓
-- 4. "stage entry missing": hai câu update ở giữa điền stage_entered_at
--    cho mọi record có stage_id. ✓
-- 5. "negative duration": mọi phép tính bọc greatest(0, ...). ✓
-- 6. "invalid entry marker": entry_marker chỉ được chọn khi
--    inactive_at <= started_at, khi đó duration = 0. ✓
--
-- Ràng buộc thêm ở cuối — check ((stage_id is null) = (stage_entered_at is
-- null)) — cũng đã kiểm: 2 record file 11 đưa về null có CẢ HAI cột null
-- nên thoả (null = null). ✓
-- ───────────────────────────────────────────────────────────────────────
--
-- Idempotent: mở đầu xoá sạch các dòng source='backfill' rồi dựng lại.
-- Dòng source='live' do app ghi không bị đụng.
--
-- Gói trong DO vì bản gốc dùng "create temp table ... on commit drop" ở cấp
-- cao nhất — Supabase Studio không giữ được temp table giữa các câu lệnh
-- (đúng lỗi 42P01 đã gặp ở file 11).
-- ═══════════════════════════════════════════════════════════════════════

do $stage$
declare
  dwell_rows    integer;
  current_rows  integer;
  entered_rows  integer;
  activity_rows integer;
begin
  lock table enrollment_records, enrollment_stage_cycles in share row exclusive mode;
  delete from enrollment_stage_cycles where source = 'backfill';

  create temp table enrollment_backfill_watermark on commit drop as
  select
    r.id as record_id,
    r.program,
    r.stage_id,
    r.agent_email,
    r.created_at,
    r.created_by_email,
    r.closed_at,
    r.archived_at,
    r.stage_entered_at as existing_stage_entered_at,
    (
      select min(c.started_at)
      from enrollment_stage_cycles c
      where c.record_id = r.id and c.source = 'live'
    ) as live_from
  from enrollment_records r;

  create index enrollment_backfill_watermark_record_idx
    on enrollment_backfill_watermark (record_id);

  -- Dựng lại các lần dwell đã hoàn tất. Sự kiện tổng hợp đầu tiên khôi phục
  -- stage khởi điểm — thứ vốn chỉ xuất hiện dưới dạng from_option_id.
  with events as (
    select
      h.record_id,
      h.to_option_id as stage_id,
      h.from_option_id as from_stage_id,
      h.changed_at as started_at,
      h.changed_by_email as started_by_email,
      h.id as tie_break,
      1 as ordinal_class
    from enrollment_stage_history h
    where h.to_option_id is not null

    union all

    select
      f.record_id,
      f.from_option_id,
      null::uuid,
      least(w.created_at, f.changed_at),
      w.created_by_email,
      '00000000-0000-0000-0000-000000000000'::uuid,
      0
    from (
      select distinct on (h.record_id)
        h.record_id, h.from_option_id, h.changed_at
      from enrollment_stage_history h
      order by h.record_id, h.changed_at, h.id
    ) f
    join enrollment_backfill_watermark w on w.record_id = f.record_id
    where f.from_option_id is not null
  ),
  paired as (
    select
      e.*,
      lead(e.started_at) over w as next_started_at,
      lead(e.started_by_email) over w as next_by_email,
      lead(e.stage_id) over w as next_stage_id
    from events e
    window w as (
      partition by e.record_id
      order by e.ordinal_class, e.started_at, e.tie_break
    )
  )
  insert into enrollment_stage_cycles (
    record_id, stage_id, from_stage_id, to_stage_id, agent_email, program,
    kind, started_at, ended_at, duration_seconds,
    started_by_email, ended_by_email, source
  )
  select
    p.record_id,
    p.stage_id,
    p.from_stage_id,
    p.next_stage_id,
    w.agent_email,
    w.program,
    'dwell',
    p.started_at,
    greatest(
      p.started_at,
      case when w.live_from is null then p.next_started_at
           else least(p.next_started_at, w.live_from) end
    ),
    greatest(0, round(extract(epoch from (
      greatest(
        p.started_at,
        case when w.live_from is null then p.next_started_at
             else least(p.next_started_at, w.live_from) end
      ) - p.started_at
    )))::integer),
    enrollment_norm_email(p.started_by_email),
    enrollment_norm_email(p.next_by_email),
    'backfill'
  from paired p
  join enrollment_backfill_watermark w on w.record_id = p.record_id
  where p.next_started_at is not null
    and (w.live_from is null or p.started_at < w.live_from);
  get diagnostics dwell_rows = row_count;

  -- Xác định stage hiện tại một lần. Quyết định history_matches được vật chất
  -- hoá và dùng lại cho cả cycle hiện hành lẫn nhãn nguồn đã phi chuẩn hoá.
  create temp table enrollment_backfill_current on commit drop as
  with last_event as (
    select distinct on (h.record_id)
      h.record_id,
      h.to_option_id as stage_id,
      h.from_option_id as from_stage_id,
      h.changed_at as started_at,
      h.changed_by_email as started_by_email
    from enrollment_stage_history h
    where h.to_option_id is not null
    order by h.record_id, h.changed_at desc, h.id desc
  )
  select
    w.record_id,
    w.stage_id,
    w.program,
    w.agent_email,
    (le.stage_id is not distinct from w.stage_id) as history_matches,
    case when le.stage_id is not distinct from w.stage_id
         then le.started_at else w.created_at end as started_at,
    case when le.stage_id is not distinct from w.stage_id
         then le.from_stage_id else null end as from_stage_id,
    case when le.stage_id is not distinct from w.stage_id
         then le.started_by_email else w.created_by_email end as started_by_email,
    case
      when w.closed_at is not null and w.archived_at is not null then least(w.closed_at, w.archived_at)
      else coalesce(w.closed_at, w.archived_at)
    end as inactive_at
  from enrollment_backfill_watermark w
  left join last_event le on le.record_id = w.record_id
  where w.stage_id is not null
    and w.live_from is null;

  create index enrollment_backfill_current_record_idx
    on enrollment_backfill_current (record_id);

  insert into enrollment_stage_cycles (
    record_id, stage_id, from_stage_id, agent_email, program,
    kind, started_at, ended_at, duration_seconds,
    started_by_email, source
  )
  select
    c.record_id,
    c.stage_id,
    c.from_stage_id,
    enrollment_norm_email(c.agent_email),
    c.program,
    -- kind phải khớp với duration. Bảng ràng buộc entry_marker phải có
    -- duration_seconds = 0 ("đã vào, chưa có thời gian đo được"), nên map mọi
    -- record inactive thành entry_marker sẽ sinh marker có duration dương và
    -- làm abort toàn bộ backfill ngay record closed/archived đầu tiên. Một
    -- record inactive mà stage bắt đầu TRƯỚC lúc nó inactive thì CÓ tích luỹ
    -- thời gian: đó là một dwell đã hoàn tất.
    case
      when c.inactive_at is null then 'dwell'
      when greatest(c.inactive_at, c.started_at) > c.started_at then 'dwell'
      else 'entry_marker'
    end,
    c.started_at,
    case when c.inactive_at is not null then greatest(c.inactive_at, c.started_at) else null end,
    case when c.inactive_at is not null
         then greatest(0, round(extract(epoch from (greatest(c.inactive_at, c.started_at) - c.started_at)))::integer)
         else null end,
    enrollment_norm_email(c.started_by_email),
    'backfill'
  from enrollment_backfill_current c;
  get diagnostics current_rows = row_count;

  update enrollment_records r
  set stage_entered_at = c.started_at,
      stage_entered_source = case when c.history_matches then 'history_backfill' else 'record_created' end
  from enrollment_backfill_current c
  where c.record_id = r.id
    and r.stage_entered_at is null;
  get diagnostics entered_rows = row_count;

  update enrollment_records
  set stage_entered_at = created_at,
      stage_entered_source = 'record_created'
  where stage_id is not null and stage_entered_at is null;

  update enrollment_records
  set stage_entered_at = null,
      stage_entered_source = null
  where stage_id is null
    and (stage_entered_at is not null or stage_entered_source is not null);

  update enrollment_records r
  set last_activity_at = a.created_at,
      last_activity_by_email = enrollment_norm_email(a.actor_email)
  from (
    select distinct on (record_id) record_id, created_at, actor_email
    from enrollment_activity
    where lower(btrim(actor_email)) <> 'system'
    order by record_id, created_at desc, id desc
  ) a
  where a.record_id = r.id
    and (r.last_activity_at is null or a.created_at > r.last_activity_at);
  get diagnostics activity_rows = row_count;

  update enrollment_records
  set last_activity_at = created_at,
      last_activity_by_email = enrollment_norm_email(created_by_email)
  where last_activity_at is null;

  alter table enrollment_records
    drop constraint if exists enrollment_records_stage_entry_required_check;
  alter table enrollment_records
    add constraint enrollment_records_stage_entry_required_check
    check ((stage_id is null) = (stage_entered_at is null))
    not valid;

  -- ── Invariant: bất kỳ kết quả khác 0 nào cũng abort toàn bộ ─────────────
  if exists (
    select 1 from enrollment_stage_cycles
    where ended_at is null group by record_id having count(*) > 1
  ) then raise exception 'BACKFILL_INVARIANT: multiple open cycles'; end if;

  if exists (
    select 1 from enrollment_records r
    where r.stage_id is not null and r.closed_at is null and r.archived_at is null
      and not exists (select 1 from enrollment_stage_cycles c where c.record_id = r.id and c.ended_at is null)
  ) then raise exception 'BACKFILL_INVARIANT: active stage missing open cycle'; end if;

  if exists (
    select 1 from enrollment_records r
    join enrollment_stage_cycles c on c.record_id = r.id and c.ended_at is null
    where r.closed_at is not null or r.archived_at is not null
  ) then raise exception 'BACKFILL_INVARIANT: inactive record has open cycle'; end if;

  if exists (
    select 1 from enrollment_records
    where stage_id is not null and (stage_entered_at is null or stage_entered_source is null)
  ) then raise exception 'BACKFILL_INVARIANT: stage entry missing'; end if;

  if exists (select 1 from enrollment_stage_cycles where ended_at < started_at or duration_seconds < 0) then
    raise exception 'BACKFILL_INVARIANT: negative duration';
  end if;

  if exists (
    select 1 from enrollment_stage_cycles
    where kind = 'entry_marker' and (ended_at is null or duration_seconds <> 0)
  ) then raise exception 'BACKFILL_INVARIANT: invalid entry marker'; end if;

  alter table enrollment_records
    validate constraint enrollment_records_stage_entry_required_check;

  raise notice 'dwell: % | cycle hiện hành: % | stage_entered_at: % | last_activity: %',
    dwell_rows, current_rows, entered_rows, activity_rows;
end
$stage$;
