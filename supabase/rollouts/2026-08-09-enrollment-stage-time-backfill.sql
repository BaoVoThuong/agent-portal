-- Enrollment stage-time historical backfill.
-- Run only after the atomic application RPCs are deployed:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f this-file.sql
-- It is idempotent for rows marked source='backfill'.

begin;

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

-- Reconstruct completed dwell visits. The synthetic first event recovers the
-- initial stage that otherwise appears only as from_option_id in history.
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

-- Resolve the current stage once. The history_matches decision is materialized
-- and reused for both the current cycle and the denormalized source label.
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
  case when c.inactive_at is not null then 'entry_marker' else 'dwell' end,
  c.started_at,
  case when c.inactive_at is not null then greatest(c.inactive_at, c.started_at) else null end,
  case when c.inactive_at is not null
       then greatest(0, round(extract(epoch from (greatest(c.inactive_at, c.started_at) - c.started_at)))::integer)
       else null end,
  enrollment_norm_email(c.started_by_email),
  'backfill'
from enrollment_backfill_current c;

update enrollment_records r
set stage_entered_at = c.started_at,
    stage_entered_source = case when c.history_matches then 'history_backfill' else 'record_created' end
from enrollment_backfill_current c
where c.record_id = r.id
  and r.stage_entered_at is null;

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

-- Any non-zero result is a hard stop. Inspect and rollback before retrying.
do $$
begin
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
end $$;

commit;

alter table enrollment_records
  validate constraint enrollment_records_stage_entry_required_check;
