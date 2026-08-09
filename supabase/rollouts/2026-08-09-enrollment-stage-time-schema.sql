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

create or replace function enrollment_norm_email(p_email text)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(lower(btrim(coalesce(p_email, ''))), '');
$$;

create or replace function enrollment_close_open_cycle_internal(
  p_record_id uuid,
  p_actor_email text,
  p_moment timestamptz,
  p_to_stage_id uuid
)
returns integer
language plpgsql
set search_path = public
as $$
declare
  open_cycle record;
  close_at timestamptz;
begin
  select id, started_at into open_cycle
  from enrollment_stage_cycles
  where record_id = p_record_id and ended_at is null
  order by started_at desc
  limit 1
  for update;

  if not found then
    return 0;
  end if;

  close_at := greatest(p_moment, open_cycle.started_at);
  update enrollment_stage_cycles
  set ended_at = close_at,
      duration_seconds = greatest(
        0,
        round(extract(epoch from (close_at - open_cycle.started_at)))::integer
      ),
      ended_by_email = enrollment_norm_email(p_actor_email),
      to_stage_id = p_to_stage_id
  where id = open_cycle.id;

  return 1;
end;
$$;

create or replace function enrollment_write_activity_internal(
  p_record_id uuid,
  p_actor_email text,
  p_activity jsonb,
  p_moment timestamptz
)
returns void
language plpgsql
set search_path = public
as $$
declare
  activity_entry jsonb;
begin
  if p_activity is null then
    return;
  end if;
  if jsonb_typeof(p_activity) <> 'array' then
    raise exception 'ENROLLMENT_ACTIVITY_INVALID: expected array, got %',
      jsonb_typeof(p_activity);
  end if;
  for activity_entry in select value from jsonb_array_elements(p_activity) loop
    if coalesce(btrim(activity_entry->>'type'), '') = '' then
      raise exception 'ENROLLMENT_ACTIVITY_INVALID: entry without type';
    end if;
  end loop;
  for activity_entry in select value from jsonb_array_elements(p_activity) loop
    insert into enrollment_activity (record_id, actor_email, type, meta, created_at)
    values (
      p_record_id,
      enrollment_norm_email(p_actor_email),
      activity_entry->>'type',
      case when activity_entry->'meta' = 'null'::jsonb then null
           else activity_entry->'meta' end,
      p_moment
    );
  end loop;
end;
$$;

create or replace function patch_enrollment_atomic(
  p_record_id uuid,
  p_expected_updated_at timestamptz,
  p_patch jsonb,
  p_actor_email text,
  p_activity jsonb default '[]'::jsonb,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_record enrollment_records%rowtype;
  next_record enrollment_records%rowtype;
  unknown_keys text[];
  actor text;
  v_now timestamptz;
  next_stage_id uuid;
  next_closed_at timestamptz;
  next_archived_at timestamptz;
  next_agent text;
  was_inactive boolean;
  now_inactive boolean;
  stage_changed boolean;
  became_active boolean;
  became_inactive boolean;
  next_stage_entered_at timestamptz;
  next_stage_entered_source text;
begin
  actor := enrollment_norm_email(p_actor_email);
  if actor is null then
    raise exception 'ENROLLMENT_ACTOR_REQUIRED';
  end if;

  select array_agg(k) into unknown_keys
  from jsonb_object_keys(coalesce(p_patch, '{}'::jsonb)) as k
  where k <> all (array[
    'client_name','description','fub_link','due_date',
    'stage_id','carrier_id','platform_id','consent_id',
    'payment_status_id','aca_status_id','pcp_2025','pcp_2026',
    'agent_email','caller_email','responsible_enroll_email',
    'qc_checked_by_email','qc_checked_at','qc_stale_notified_at',
    'due_soon_notified_at','overdue_notified_at','overdue_reminded_at',
    'closed_at','archived_at','custom_values'
  ]);
  if unknown_keys is not null then
    raise exception 'ENROLLMENT_UNKNOWN_FIELD: %', array_to_string(unknown_keys, ',');
  end if;
  if p_activity is not null and jsonb_typeof(p_activity) <> 'array' then
    raise exception 'ENROLLMENT_ACTIVITY_INVALID: expected array, got %',
      jsonb_typeof(p_activity);
  end if;

  select * into target_record
  from enrollment_records
  where id = p_record_id
  for update;
  if not found then
    raise exception 'ENROLLMENT_NOT_FOUND';
  end if;
  if p_expected_updated_at is null or target_record.updated_at <> p_expected_updated_at then
    raise exception 'ENROLLMENT_CONFLICT';
  end if;

  v_now := greatest(p_now, target_record.updated_at + interval '1 microsecond');
  next_stage_id := case when p_patch ? 'stage_id'
    then (p_patch->>'stage_id')::uuid else target_record.stage_id end;
  next_closed_at := case when p_patch ? 'closed_at'
    then (p_patch->>'closed_at')::timestamptz else target_record.closed_at end;
  next_archived_at := case when p_patch ? 'archived_at'
    then (p_patch->>'archived_at')::timestamptz else target_record.archived_at end;
  next_agent := case when p_patch ? 'agent_email'
    then enrollment_norm_email(p_patch->>'agent_email') else target_record.agent_email end;

  was_inactive := target_record.closed_at is not null or target_record.archived_at is not null;
  now_inactive := next_closed_at is not null or next_archived_at is not null;
  stage_changed := next_stage_id is distinct from target_record.stage_id;
  became_active := was_inactive and not now_inactive;
  became_inactive := now_inactive and not was_inactive;

  next_stage_entered_at := case
    when next_stage_id is null then null
    when stage_changed or became_active then v_now
    else target_record.stage_entered_at end;
  next_stage_entered_source := case
    when next_stage_id is null then null
    when stage_changed or became_active then 'live'
    else target_record.stage_entered_source end;

  update enrollment_records set
    client_name = case when p_patch ? 'client_name' then p_patch->>'client_name' else client_name end,
    description = case when p_patch ? 'description' then p_patch->>'description' else description end,
    fub_link = case when p_patch ? 'fub_link' then p_patch->>'fub_link' else fub_link end,
    due_date = case when p_patch ? 'due_date' then (p_patch->>'due_date')::date else due_date end,
    stage_id = next_stage_id,
    carrier_id = case when p_patch ? 'carrier_id' then (p_patch->>'carrier_id')::uuid else carrier_id end,
    platform_id = case when p_patch ? 'platform_id' then (p_patch->>'platform_id')::uuid else platform_id end,
    consent_id = case when p_patch ? 'consent_id' then (p_patch->>'consent_id')::uuid else consent_id end,
    payment_status_id = case when p_patch ? 'payment_status_id' then (p_patch->>'payment_status_id')::uuid else payment_status_id end,
    aca_status_id = case when p_patch ? 'aca_status_id' then (p_patch->>'aca_status_id')::uuid else aca_status_id end,
    pcp_2025 = case when p_patch ? 'pcp_2025' then p_patch->>'pcp_2025' else pcp_2025 end,
    pcp_2026 = case when p_patch ? 'pcp_2026' then p_patch->>'pcp_2026' else pcp_2026 end,
    agent_email = next_agent,
    caller_email = case when p_patch ? 'caller_email' then enrollment_norm_email(p_patch->>'caller_email') else caller_email end,
    responsible_enroll_email = case when p_patch ? 'responsible_enroll_email' then enrollment_norm_email(p_patch->>'responsible_enroll_email') else responsible_enroll_email end,
    qc_checked_by_email = case when p_patch ? 'qc_checked_by_email' then enrollment_norm_email(p_patch->>'qc_checked_by_email') else qc_checked_by_email end,
    qc_checked_at = case when p_patch ? 'qc_checked_at' then (p_patch->>'qc_checked_at')::timestamptz else qc_checked_at end,
    qc_stale_notified_at = case when p_patch ? 'qc_stale_notified_at' then (p_patch->>'qc_stale_notified_at')::timestamptz else qc_stale_notified_at end,
    due_soon_notified_at = case when p_patch ? 'due_soon_notified_at' then (p_patch->>'due_soon_notified_at')::timestamptz else due_soon_notified_at end,
    overdue_notified_at = case when p_patch ? 'overdue_notified_at' then (p_patch->>'overdue_notified_at')::timestamptz else overdue_notified_at end,
    overdue_reminded_at = case when p_patch ? 'overdue_reminded_at' then (p_patch->>'overdue_reminded_at')::timestamptz else overdue_reminded_at end,
    closed_at = next_closed_at,
    archived_at = next_archived_at,
    custom_values = case when p_patch ? 'custom_values' then p_patch->'custom_values' else custom_values end,
    stage_entered_at = next_stage_entered_at,
    stage_entered_source = next_stage_entered_source,
    last_activity_at = greatest(coalesce(last_activity_at, v_now), v_now),
    last_activity_by_email = case
      when last_activity_at is null or v_now >= last_activity_at then actor
      else last_activity_by_email end,
    updated_by_email = actor,
    updated_at = v_now
  where id = p_record_id and updated_at = p_expected_updated_at
  returning * into next_record;
  if not found then
    raise exception 'ENROLLMENT_CONFLICT';
  end if;

  if stage_changed or became_active or became_inactive then
    perform enrollment_close_open_cycle_internal(p_record_id, actor, v_now, next_record.stage_id);
    if next_record.stage_id is not null then
      if not now_inactive then
        insert into enrollment_stage_cycles (
          record_id, stage_id, from_stage_id, agent_email, program,
          kind, started_at, started_by_email, source
        ) values (
          p_record_id, next_record.stage_id,
          case when stage_changed then target_record.stage_id else null end,
          next_record.agent_email, next_record.program,
          'dwell', v_now, actor, 'live'
        );
      elsif stage_changed then
        insert into enrollment_stage_cycles (
          record_id, stage_id, from_stage_id, agent_email, program,
          kind, started_at, ended_at, duration_seconds,
          started_by_email, ended_by_email, source
        ) values (
          p_record_id, next_record.stage_id, target_record.stage_id,
          next_record.agent_email, next_record.program,
          'entry_marker', v_now, v_now, 0, actor, actor, 'live'
        );
      end if;
    end if;
  end if;

  if stage_changed then
    insert into enrollment_stage_history (
      record_id, from_option_id, to_option_id, changed_by_email, changed_at
    ) values (p_record_id, target_record.stage_id, next_record.stage_id, actor, v_now);
  end if;
  perform enrollment_write_activity_internal(p_record_id, actor, p_activity, v_now);
  return to_jsonb(next_record);
end;
$$;

create or replace function create_enrollment_atomic(
  p_record jsonb,
  p_actor_email text,
  p_activity jsonb default '[]'::jsonb,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  new_record enrollment_records%rowtype;
  unknown_keys text[];
  actor text;
  is_inactive boolean;
begin
  actor := enrollment_norm_email(p_actor_email);
  if actor is null then raise exception 'ENROLLMENT_ACTOR_REQUIRED'; end if;
  select array_agg(k) into unknown_keys
  from jsonb_object_keys(coalesce(p_record, '{}'::jsonb)) as k
  where k <> all (array[
    'program','client_name','description','fub_link','due_date',
    'stage_id','carrier_id','platform_id','consent_id',
    'payment_status_id','aca_status_id','pcp_2025','pcp_2026',
    'agent_email','caller_email','responsible_enroll_email',
    'qc_checked_by_email','qc_checked_at','closed_at','custom_values'
  ]);
  if unknown_keys is not null then
    raise exception 'ENROLLMENT_UNKNOWN_FIELD: %', array_to_string(unknown_keys, ',');
  end if;
  if p_activity is not null and jsonb_typeof(p_activity) <> 'array' then
    raise exception 'ENROLLMENT_ACTIVITY_INVALID: expected array, got %', jsonb_typeof(p_activity);
  end if;
  is_inactive := (p_record->>'closed_at') is not null;

  insert into enrollment_records (
    program, client_name, description, fub_link, due_date,
    stage_id, carrier_id, platform_id, consent_id, payment_status_id, aca_status_id,
    pcp_2025, pcp_2026, agent_email, caller_email, responsible_enroll_email,
    qc_checked_by_email, qc_checked_at, closed_at, custom_values,
    created_by_email, created_at, updated_by_email, updated_at,
    stage_entered_at, stage_entered_source, last_activity_at, last_activity_by_email
  ) values (
    coalesce(p_record->>'program', 'aca'), p_record->>'client_name', p_record->>'description',
    p_record->>'fub_link', (p_record->>'due_date')::date,
    (p_record->>'stage_id')::uuid, (p_record->>'carrier_id')::uuid,
    (p_record->>'platform_id')::uuid, (p_record->>'consent_id')::uuid,
    (p_record->>'payment_status_id')::uuid, (p_record->>'aca_status_id')::uuid,
    p_record->>'pcp_2025', p_record->>'pcp_2026',
    enrollment_norm_email(p_record->>'agent_email'), enrollment_norm_email(p_record->>'caller_email'),
    enrollment_norm_email(p_record->>'responsible_enroll_email'),
    enrollment_norm_email(p_record->>'qc_checked_by_email'), (p_record->>'qc_checked_at')::timestamptz,
    (p_record->>'closed_at')::timestamptz, coalesce(p_record->'custom_values', '{}'::jsonb),
    actor, p_now, actor, p_now,
    case when (p_record->>'stage_id') is null then null else p_now end,
    case when (p_record->>'stage_id') is null then null else 'live' end,
    p_now, actor
  ) returning * into new_record;

  if new_record.stage_id is not null then
    if is_inactive then
      insert into enrollment_stage_cycles (
        record_id, stage_id, agent_email, program, kind,
        started_at, ended_at, duration_seconds, started_by_email, ended_by_email, source
      ) values (new_record.id, new_record.stage_id, new_record.agent_email, new_record.program,
                'entry_marker', p_now, p_now, 0, actor, actor, 'live');
    else
      insert into enrollment_stage_cycles (
        record_id, stage_id, agent_email, program, kind, started_at, started_by_email, source
      ) values (new_record.id, new_record.stage_id, new_record.agent_email, new_record.program,
                'dwell', p_now, actor, 'live');
    end if;
  end if;
  perform enrollment_write_activity_internal(new_record.id, actor, p_activity, p_now);
  return to_jsonb(new_record);
end;
$$;

create or replace function archive_enrollment_atomic(
  p_record_id uuid,
  p_actor_email text,
  p_activity jsonb default '[]'::jsonb,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_record enrollment_records%rowtype;
  next_record enrollment_records%rowtype;
  actor text;
  v_now timestamptz;
begin
  actor := enrollment_norm_email(p_actor_email);
  if actor is null then raise exception 'ENROLLMENT_ACTOR_REQUIRED'; end if;
  if p_activity is not null and jsonb_typeof(p_activity) <> 'array' then
    raise exception 'ENROLLMENT_ACTIVITY_INVALID: expected array, got %', jsonb_typeof(p_activity);
  end if;
  select * into target_record from enrollment_records where id = p_record_id for update;
  if not found then raise exception 'ENROLLMENT_NOT_FOUND'; end if;
  if target_record.archived_at is not null then return to_jsonb(target_record); end if;
  v_now := greatest(p_now, target_record.updated_at + interval '1 microsecond');
  update enrollment_records set
    archived_at = v_now,
    updated_at = v_now,
    updated_by_email = actor,
    last_activity_at = greatest(coalesce(last_activity_at, v_now), v_now),
    last_activity_by_email = case when last_activity_at is null or v_now >= last_activity_at then actor else last_activity_by_email end
  where id = p_record_id
  returning * into next_record;
  perform enrollment_close_open_cycle_internal(p_record_id, actor, v_now, null);
  perform enrollment_write_activity_internal(p_record_id, actor, p_activity, v_now);
  return to_jsonb(next_record);
end;
$$;

create or replace function enrollment_touch_activity(
  p_record_id uuid,
  p_actor_email text,
  p_now timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor text;
begin
  actor := enrollment_norm_email(p_actor_email);
  if actor is null or actor = 'system' then return; end if;
  update enrollment_records
  set last_activity_at = greatest(coalesce(last_activity_at, p_now), p_now),
      last_activity_by_email = case when last_activity_at is null or p_now >= last_activity_at then actor else last_activity_by_email end
  where id = p_record_id;
end;
$$;



do $$
declare
  routine_signature text;
begin
  foreach routine_signature in array array[
    'enrollment_norm_email(text)',
    'enrollment_close_open_cycle_internal(uuid, text, timestamptz, uuid)',
    'enrollment_write_activity_internal(uuid, text, jsonb, timestamptz)',
    'patch_enrollment_atomic(uuid, timestamptz, jsonb, text, jsonb, timestamptz)',
    'create_enrollment_atomic(jsonb, text, jsonb, timestamptz)',
    'archive_enrollment_atomic(uuid, text, jsonb, timestamptz)',
    'enrollment_touch_activity(uuid, text, timestamptz)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', routine_signature);
    execute format('grant execute on function %s to service_role', routine_signature);
  end loop;
end $$;
