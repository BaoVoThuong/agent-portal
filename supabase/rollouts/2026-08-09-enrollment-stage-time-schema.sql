-- Enrollment stage-time tracking schema rollout.
-- Additive and safe to run before application code. This file intentionally
-- does not redefine usage-count semantics: Config archive is a soft archive,
-- while historical cycles are not current record usage.

alter table enrollment_records
  add column if not exists stage_entered_at timestamptz,
  add column if not exists stage_entered_source text,
  add column if not exists last_activity_at timestamptz,
  add column if not exists last_activity_by_email text;

alter table enrollment_records
  drop constraint if exists enrollment_records_stage_entered_source_check;
alter table enrollment_records
  add constraint enrollment_records_stage_entered_source_check
  check (
    stage_entered_source is null
    or stage_entered_source in ('live', 'history_backfill', 'record_created')
  );
alter table enrollment_records
  drop constraint if exists enrollment_records_stage_entered_pair_check;
alter table enrollment_records
  add constraint enrollment_records_stage_entered_pair_check
  check ((stage_entered_at is null) = (stage_entered_source is null));

update enrollment_records
set agent_email = nullif(lower(btrim(agent_email)), '')
where agent_email is distinct from nullif(lower(btrim(agent_email)), '');
update enrollment_records
set caller_email = nullif(lower(btrim(caller_email)), '')
where caller_email is distinct from nullif(lower(btrim(caller_email)), '');
update enrollment_records
set responsible_enroll_email = nullif(lower(btrim(responsible_enroll_email)), '')
where responsible_enroll_email is distinct from nullif(lower(btrim(responsible_enroll_email)), '');

create table if not exists enrollment_stage_cycles (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references enrollment_records(id) on delete cascade,
  stage_id uuid not null references enrollment_options(id) on delete restrict,
  from_stage_id uuid references enrollment_options(id) on delete restrict,
  to_stage_id uuid references enrollment_options(id) on delete restrict,
  agent_email text,
  program text not null default 'aca' check (program in ('aca', 'medicare')),
  kind text not null default 'dwell'
    check (kind in ('dwell', 'entry_marker')),
  started_at timestamptz not null,
  ended_at timestamptz,
  duration_seconds integer,
  started_by_email text,
  ended_by_email text,
  source text not null default 'live'
    check (source in ('live', 'backfill')),
  created_at timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at),
  check (duration_seconds is null or duration_seconds >= 0),
  check (
    (ended_at is null and duration_seconds is null)
    or (ended_at is not null and duration_seconds is not null)
  ),
  check (kind <> 'entry_marker' or (ended_at is not null and duration_seconds = 0))
);

create unique index if not exists enrollment_stage_cycles_open_idx
  on enrollment_stage_cycles (record_id)
  where ended_at is null;
create index if not exists enrollment_stage_cycles_record_idx
  on enrollment_stage_cycles (record_id, started_at desc);
create index if not exists enrollment_stage_cycles_dwell_idx
  on enrollment_stage_cycles (record_id, ended_at desc)
  where kind = 'dwell' and source = 'live';
create index if not exists enrollment_records_stage_entered_idx
  on enrollment_records (program, stage_id, stage_entered_at)
  where archived_at is null and closed_at is null;

alter table enrollment_stage_cycles enable row level security;
