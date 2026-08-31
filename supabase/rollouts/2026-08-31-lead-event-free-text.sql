-- Lead Management: Event is typed, not chosen.
--
-- Supersedes 2026-08-31-lead-event-column-type.sql, which set the column to
-- 'dropdown' on the reasoning that leads.event_id is a foreign key and could
-- only be picked from a list. The product decision went the other way: the
-- create dialog now takes a typed name and the route finds or creates the
-- event, so a lead never waits on someone registering the event first. The
-- column is text again because a person really does type into it.
--
-- leads.event_id stays a foreign key. That is what keeps the per-event report
-- honest: leads group by a row, not by whatever string was typed.
--
-- The unique index is what makes "find or create" safe. Without it, two people
-- naming the same event at the same moment each insert a row and the report
-- splits one event in two. Matching lower(btrim(name)) also means "Health Fair"
-- and "health fair " resolve to the same event.
--
-- Forward-only and idempotent.

update table_column
set type = 'text',
    updated_at = now()
where scope in ('lead_pc', 'lead_health')
  and key = 'event'
  and type is distinct from 'text';

-- Fold any duplicates that predate the index into the earliest row, so the
-- index can be created. Nothing to do on a database that never had duplicates.
with ranked as (
  select id,
         lower(btrim(name)) as norm,
         row_number() over (partition by lower(btrim(name)) order by created_at, id) as rn
  from lead_events
  where archived_at is null
),
keeper as (
  select norm, id from ranked where rn = 1
)
update leads
set event_id = keeper.id
from ranked
join keeper on keeper.norm = ranked.norm
where leads.event_id = ranked.id
  and ranked.rn > 1;

update lead_events
set archived_at = now()
where id in (
  select id from (
    select id, row_number() over (partition by lower(btrim(name)) order by created_at, id) as rn
    from lead_events where archived_at is null
  ) as dupes
  where rn > 1
);

create unique index if not exists lead_events_name_unique_idx
  on lead_events (lower(btrim(name))) where archived_at is null;

-- Verification. Expect two rows with type = text, and one index row.
select scope, key, type from table_column
where scope in ('lead_pc', 'lead_health') and key = 'event'
order by scope;

select indexname from pg_indexes
where tablename = 'lead_events' and indexname = 'lead_events_name_unique_idx';
