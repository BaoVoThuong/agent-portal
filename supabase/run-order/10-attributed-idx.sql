-- 10 — index bị thiếu trong schema.sql (drift thật)
-- Chỉ tồn tại trong 2026-08-13-aca-person-stage-timing.sql, dựng lại DB từ schema.sql sẽ mất.
begin;
create index if not exists enrollment_stage_cycles_attributed_idx
  on enrollment_stage_cycles (stage_id, responsible_start_email, ended_at desc)
  where kind = 'dwell' and source = 'live' and ended_at is not null
    and responsible_start_email is not null
    and responsible_start_email = responsible_end_email;
commit;
