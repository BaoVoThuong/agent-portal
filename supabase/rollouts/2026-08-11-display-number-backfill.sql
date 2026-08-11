-- Durable human-facing display numbers for Tasks and Enrollment.
-- Run once against the target database before deploying code that selects
-- display_number. The table locks make backfill and sequence advancement
-- atomic with respect to concurrent creates.

begin;

lock table tasks, enrollment_records in access exclusive mode;

create sequence if not exists tasks_display_number_seq;
alter table tasks add column if not exists display_number bigint;

with missing as (
  select id, row_number() over (order by created_at, id) as row_number
  from tasks
  where display_number is null
), current_max as (
  select coalesce(max(display_number), 0) as value from tasks
)
update tasks as target
set display_number = current_max.value + missing.row_number
from missing, current_max
where target.id = missing.id;

do $$
declare
  max_number bigint;
begin
  select max(display_number) into max_number from tasks;
  if max_number is null then
    perform setval('tasks_display_number_seq', 1, false);
  else
    perform setval('tasks_display_number_seq', max_number, true);
  end if;
end $$;

alter table tasks alter column display_number set default nextval('tasks_display_number_seq');
alter table tasks alter column display_number set not null;
create unique index if not exists tasks_display_number_key on tasks (display_number);

create sequence if not exists enrollment_records_display_number_seq;
alter table enrollment_records add column if not exists display_number bigint;

with missing as (
  select id, row_number() over (order by created_at, id) as row_number
  from enrollment_records
  where display_number is null
), current_max as (
  select coalesce(max(display_number), 0) as value from enrollment_records
)
update enrollment_records as target
set display_number = current_max.value + missing.row_number
from missing, current_max
where target.id = missing.id;

do $$
declare
  max_number bigint;
begin
  select max(display_number) into max_number from enrollment_records;
  if max_number is null then
    perform setval('enrollment_records_display_number_seq', 1, false);
  else
    perform setval('enrollment_records_display_number_seq', max_number, true);
  end if;
end $$;

alter table enrollment_records alter column display_number set default nextval('enrollment_records_display_number_seq');
alter table enrollment_records alter column display_number set not null;
create unique index if not exists enrollment_records_display_number_key on enrollment_records (display_number);

commit;
