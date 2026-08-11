-- Scratch-only transaction-boundary assertion for the Enrollment stage backfill.
-- Run against a disposable PostgreSQL database:
--   psql "$SCRATCH_DATABASE_URL" -v ON_ERROR_STOP=1 -f this-file.sql
-- Everything is rolled back, including the intentionally invalid fixture.

begin;

create temp table enrollment_stage_backfill_fixture (
  stage_id uuid,
  stage_entered_at timestamptz
);

insert into enrollment_stage_backfill_fixture(stage_id, stage_entered_at)
values ('00000000-0000-0000-0000-000000000001', null);

alter table enrollment_stage_backfill_fixture
  add constraint stage_entry_pair_check
  check ((stage_id is null) = (stage_entered_at is null))
  not valid;

do $$
begin
  begin
    alter table enrollment_stage_backfill_fixture
      validate constraint stage_entry_pair_check;
    raise exception 'CASE1: invalid fixture unexpectedly validated';
  exception
    when check_violation then
      null;
  end;

  if not exists (
    select 1
    from enrollment_stage_backfill_fixture
    where stage_id is not null and stage_entered_at is null
  ) then
    raise exception 'CASE2: validation failure did not leave fixture visible in transaction';
  end if;
end
$$;

rollback;
