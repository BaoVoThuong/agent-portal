-- Scratch-only test for staged Sheet replacement.
-- Run with ON_ERROR_STOP=1 after datasync/schema.sql on a disposable database.
begin;

select public.begin_sheet_sync(
  '00000000-0000-0000-0000-000000000001'::uuid,
  'provider_address', 'fixture-sheet', 'fixture-gid'
);

insert into public.sheet_sync_staging (
  run_id, target_table, source_sheet_id, source_gid, source_row_number, payload
)
values (
  '00000000-0000-0000-0000-000000000001'::uuid,
  'provider_address', 'fixture-sheet', 'fixture-gid', 2,
  jsonb_build_object(
    'source_sheet_id', 'fixture-sheet', 'source_gid', 'fixture-gid',
    'source_row_number', 2, 'source_row_hash', 'hash-1',
    'facility', 'Fixture Clinic', 'raw_row', '{}'::jsonb,
    'synced_at', clock_timestamp()
  )
);

select public.finalize_sheet_sync(
  '00000000-0000-0000-0000-000000000001'::uuid,
  'provider_address', 'fixture-sheet', 'fixture-gid'
);

do $$
begin
  if not exists (
    select 1 from public.provider_address
    where source_sheet_id = 'fixture-sheet'
      and source_gid = 'fixture-gid'
      and facility = 'Fixture Clinic'
  ) then
    raise exception 'successful finalize did not promote staged row';
  end if;

  if public.finalize_sheet_sync(
    '00000000-0000-0000-0000-000000000001'::uuid,
    'provider_address', 'fixture-sheet', 'fixture-gid'
  ) <> 1 then
    raise exception 'same run retry was not idempotent';
  end if;
end;
$$;

rollback;
