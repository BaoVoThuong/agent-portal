-- ACA overview storage. Apply before the application route is enabled.
alter table enrollment_records
  add column if not exists last_work_activity_at timestamptz;
alter table enrollment_records
  add column if not exists responsible_assigned_at timestamptz;

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
  elsif new.responsible_enroll_email is distinct from old.responsible_enroll_email then
    new.responsible_assigned_at := new.updated_at;
  elsif new.updated_at is distinct from old.updated_at
    and coalesce(lower(new.updated_by_email), '') <> 'system' then
    new.last_work_activity_at := new.updated_at;
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
update enrollment_records records
set last_work_activity_at = latest.work_at
from lateral (
  select max(activity.created_at) as work_at
  from enrollment_activity activity
  where activity.record_id = records.id
    and lower(coalesce(activity.actor_email, '')) <> 'system'
    and activity.type not in ('comment_added', 'mentioned', 'attachment_added')
) latest
where records.program = 'aca'
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

create table if not exists enrollment_overview_settings (
  id boolean primary key default true check (id),
  threshold_days integer not null default 3 check (threshold_days in (1,3,7,10)),
  updated_by_email text not null,
  updated_at timestamptz not null default now()
);

insert into enrollment_overview_settings (id, threshold_days, updated_by_email)
values (true, 3, 'system')
on conflict (id) do nothing;

comment on table enrollment_queue_members is
  'Enrollment-only assignment queue membership; deliberately separate from the CS queue.';
