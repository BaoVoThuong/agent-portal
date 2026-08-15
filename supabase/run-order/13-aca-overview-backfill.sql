-- ═══════════════════════════════════════════════════════════════════════
-- 13 — BACKFILL DỮ LIỆU CHO DASHBOARD ACA OVERVIEW
--
-- Nguồn: supabase/rollouts/2026-08-13-aca-overview-schema.sql, dòng 67-84.
-- Rollout đó đã tạo cột và trigger, nhưng PHẦN BACKFILL chưa từng chạy:
-- cả 2 cột hiện 100% null (667/667), nên dashboard ACA Overview trống.
--
-- Điền được bao nhiêu (đo trên DB thật ngày 2026-08-15):
--   • last_work_activity_at   : 340 record ACA active, nguồn 1829 dòng
--                               enrollment_activity
--   • responsible_assigned_at : 340 record ACA (tất cả đều đã có
--                               responsible_enroll_email)
--
-- RỦI RO: THẤP. Chỉ ghi vào 2 cột đang hoàn toàn trống, chỉ program='aca',
-- và cả hai câu đều có guard "is null" nên chạy lại nhiều lần vô hại
-- (idempotent) — lần sau sẽ không còn dòng nào khớp.
--
-- KHÔNG đụng: stage_id, agent_email, updated_at, hay bất kỳ cột nghiệp vụ nào.
--
-- Vì sao gói trong DO: giống file 11 — cả script thành một câu lệnh nên
-- Supabase Studio không tách được, và có chỗ đếm số dòng đã ghi để đối chiếu.
--
-- Trigger enrollment_records_overview_timestamps (before update) KHÔNG bị
-- kích hoạt bởi file này: nhánh UPDATE của nó chỉ chạy khi updated_at đổi
-- hoặc responsible_enroll_email đổi (schema.sql:4467-4476), mà ở đây không
-- câu nào đụng hai cột đó.
-- ═══════════════════════════════════════════════════════════════════════

do $bf$
declare
  work_rows integer;
  resp_rows integer;
begin
  -- Lần hoạt động "thật" gần nhất. Cố ý loại bỏ nhiễu cộng tác
  -- (comment/mention/attachment) và các dòng do cron ghi (actor = 'system').
  --
  -- ĐÃ SỬA so với rollout gốc (2026-08-13-aca-overview-schema.sql:67-78).
  -- Bản gốc viết "from lateral (... where activity.record_id = records.id)".
  -- Postgres KHÔNG cho phép điều đó: trong UPDATE ... FROM, bảng đích không
  -- nằm trong phạm vi LATERAL, nên câu lệnh luôn lỗi:
  --     ERROR: 42P10: invalid reference to FROM-clause entry for table "records"
  -- Đó là lý do phần backfill này chưa bao giờ chạy được.
  --
  -- Cách viết đúng: gom nhóm sẵn theo record_id rồi join. Kết quả giống hệt —
  -- GROUP BY chỉ sinh dòng cho record CÓ hoạt động khớp, đúng bằng cái mà
  -- guard "work_at is not null" của bản gốc lọc ra.
  update enrollment_records records
  set last_work_activity_at = latest.work_at
  from (
    select activity.record_id, max(activity.created_at) as work_at
    from enrollment_activity activity
    where lower(coalesce(activity.actor_email, '')) <> 'system'
      and activity.type not in ('comment_added', 'mentioned', 'attachment_added')
    group by activity.record_id
  ) latest
  where latest.record_id = records.id
    and records.program = 'aca'
    and records.last_work_activity_at is null
    and latest.work_at is not null;
  get diagnostics work_rows = row_count;

  -- Lịch sử giao việc có trước thời điểm có snapshot chủ sở hữu đáng tin,
  -- nên thời điểm tạo record là cận dưới an toàn duy nhất cho các dòng
  -- đang có người phụ trách.
  update enrollment_records
  set responsible_assigned_at = created_at
  where program = 'aca'
    and responsible_enroll_email is not null
    and responsible_assigned_at is null;
  get diagnostics resp_rows = row_count;

  raise notice 'last_work_activity_at: % dòng | responsible_assigned_at: % dòng',
    work_rows, resp_rows;
end
$bf$;
