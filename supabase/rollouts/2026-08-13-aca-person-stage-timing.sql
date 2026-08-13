-- Per-person speed attribution. No backfill: old cycles have no trustworthy
-- owner-at-open/owner-at-close values and are intentionally excluded.
alter table enrollment_stage_cycles
  add column if not exists responsible_start_email text,
  add column if not exists responsible_end_email text;
create index if not exists enrollment_stage_cycles_attributed_idx
  on enrollment_stage_cycles (stage_id, responsible_start_email, ended_at desc)
  where kind = 'dwell' and source = 'live' and ended_at is not null
    and responsible_start_email is not null
    and responsible_start_email = responsible_end_email;
