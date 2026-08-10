-- Corrects tasks_updated_at_monotonic so it stops bumping updated_at on writes
-- that never touched it. Safe before or after the application deploy: the
-- function is replaced in place, the trigger binding is unchanged, and the new
-- behaviour is strictly less disruptive than the old one.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f this-file.sql

create or replace function tasks_updated_at_monotonic()
returns trigger language plpgsql as $$
begin
  -- `is distinct from` is load-bearing: in a BEFORE UPDATE row trigger a column
  -- absent from the SET clause carries the OLD value into NEW, so a bare `<=`
  -- matched every write that left updated_at alone -- the six cron reminder
  -- writes and mark_task_overdue_atomic -- and bumped it by 1us, invalidating
  -- every open client's concurrency token.
  if new.updated_at is distinct from old.updated_at
     and new.updated_at <= old.updated_at then
    new.updated_at := old.updated_at + interval '1 microsecond';
  end if;

  if new.last_activity_at is not null
     and old.last_activity_at is not null
     and new.last_activity_at < old.last_activity_at then
    new.last_activity_at := old.last_activity_at;
    new.last_activity_by_email := old.last_activity_by_email;
  end if;
  return new;
end $$;
