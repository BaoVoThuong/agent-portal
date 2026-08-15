-- ACA overview storage. Apply before the application route is enabled.
alter table enrollment_records
  add column if not exists last_work_activity_at timestamptz;
alter table enrollment_records
  add column if not exists responsible_assigned_at timestamptz;
alter table enrollment_stage_cycles
  add column if not exists responsible_start_email text;
alter table enrollment_stage_cycles
  add column if not exists responsible_end_email text;

create or replace function enrollment_sync_cycle_responsibility()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.responsible_start_email is null then
    select responsible_enroll_email into new.responsible_start_email from enrollment_records where id = new.record_id;
  end if;
  if new.ended_at is not null and new.responsible_end_email is null then
    select responsible_enroll_email into new.responsible_end_email from enrollment_records where id = new.record_id;
  end if;
  return new;
end;
$$;
drop trigger if exists enrollment_stage_cycles_responsibility on enrollment_stage_cycles;
create trigger enrollment_stage_cycles_responsibility before insert or update on enrollment_stage_cycles
for each row execute function enrollment_sync_cycle_responsibility();

create or replace function enrollment_sync_overview_timestamps()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if coalesce(lower(new.updated_by_email), '') <> 'system' then
      new.last_work_activity_at := coalesce(new.last_work_activity_at, new.updated_at);
    end if;
    if new.responsible_enroll_email is not null then
      new.responsible_assigned_at := coalesce(new.responsible_assigned_at, new.created_at);
    end if;
  else
    -- Independent branches, deliberately NOT elsif. Assigning a record IS real
    -- work; chaining them meant a handover updated the assignment clock and
    -- then skipped the activity clock, so a record passed between people looked
    -- progressively more neglected the more attention it actually received.
    if new.responsible_enroll_email is distinct from old.responsible_enroll_email then
      new.responsible_assigned_at := new.updated_at;
    end if;
    -- Comments and attachments reach the record through enrollment_touch_activity,
    -- which never changes updated_at, so they cannot bump this. The cron sets
    -- updated_by_email = 'system' and is excluded for the same reason.
    if new.updated_at is distinct from old.updated_at
      and coalesce(lower(new.updated_by_email), '') <> 'system' then
      new.last_work_activity_at := new.updated_at;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists enrollment_records_overview_timestamps on enrollment_records;
create trigger enrollment_records_overview_timestamps before insert or update on enrollment_records
for each row execute function enrollment_sync_overview_timestamps();

create index if not exists enrollment_records_aca_overview_created_idx
  on enrollment_records (program, created_at, archived_at);

-- Backfill is intentionally conservative. Work activity excludes collaboration
-- noise and cron rows. Assignment history predates a reliable owner snapshot,
-- so creation time is the only safe lower bound for currently assigned rows;
-- cycles are not rewritten and the per-person timing plan remains no-backfill.
-- 2026-08-15 FIX. The previous form was `from lateral (... where
-- activity.record_id = records.id)`. PostgreSQL does not put an UPDATE's target
-- table in scope for a LATERAL item in its FROM clause, so that statement could
-- never run:
--     ERROR: 42P10: invalid reference to FROM-clause entry for table "records"
-- This is why the backfill below had never been applied. Pre-aggregating by
-- record_id and joining is equivalent: GROUP BY only emits rows for records that
-- actually have qualifying activity, which is exactly what the old
-- `latest.work_at is not null` guard selected.
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

update enrollment_records
set responsible_assigned_at = created_at
where program = 'aca'
  and responsible_enroll_email is not null
  and responsible_assigned_at is null;

create table if not exists enrollment_queue_members (
  email text primary key,
  enabled boolean not null default true,
  updated_by_email text not null,
  updated_at timestamptz not null default now()
);

-- Keyed per program. Without this the table repeats the flaw this design
-- criticised in the CS queue, where one email row governs every program and
-- disabling someone in one place silently disables them in another.
alter table enrollment_queue_members
  add column if not exists program text not null default 'aca';
alter table enrollment_queue_members
  drop constraint if exists enrollment_queue_members_program_check;
alter table enrollment_queue_members
  add constraint enrollment_queue_members_program_check
  check (program in ('aca', 'medicare'));
alter table enrollment_queue_members
  drop constraint if exists enrollment_queue_members_pkey;
alter table enrollment_queue_members
  add constraint enrollment_queue_members_pkey primary key (email, program);

create table if not exists enrollment_overview_settings (
  id boolean primary key default true check (id),
  threshold_days integer not null default 3 check (threshold_days in (1,3,7,10)),
  updated_by_email text not null,
  updated_at timestamptz not null default now()
);

insert into enrollment_overview_settings (id, threshold_days, updated_by_email)
values (true, 3, 'system')
on conflict (id) do nothing;

-- Both tables are written only through service-role routes. The anon key ships
-- to the browser (NEXT_PUBLIC_SUPABASE_ANON_KEY), so without RLS any visitor
-- could read them and add themselves to the assignment queue or rewrite the
-- dashboard threshold. No policies: service_role bypasses RLS, everyone else
-- is denied.
alter table enrollment_queue_members enable row level security;
alter table enrollment_overview_settings enable row level security;

comment on table enrollment_queue_members is
  'Enrollment-only assignment queue membership; deliberately separate from the CS queue.';
