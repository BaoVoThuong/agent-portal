-- Restore the pre-review sheet sync functions.
begin;
create or replace function public.begin_sheet_sync(
  p_run_id uuid,
  p_target_table text,
  p_source_sheet_id text,
  p_source_gid text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_run_id is null
    or p_target_table not in ('provider_address', 'pc_raw_data', 'health_raw_data')
    or nullif(btrim(p_source_sheet_id), '') is null
    or nullif(btrim(p_source_gid), '') is null then
    raise exception 'invalid sheet sync metadata';
  end if;

  insert into public.sheet_sync_runs (run_id, target_table, source_sheet_id, source_gid)
  values (p_run_id, p_target_table, p_source_sheet_id, p_source_gid)
  on conflict (run_id) do update
    set target_table = excluded.target_table,
        source_sheet_id = excluded.source_sheet_id,
        source_gid = excluded.source_gid
  where public.sheet_sync_runs.status = 'running'
    and public.sheet_sync_runs.target_table = excluded.target_table
    and public.sheet_sync_runs.source_sheet_id = excluded.source_sheet_id
    and public.sheet_sync_runs.source_gid = excluded.source_gid;

  if not exists (
    select 1 from public.sheet_sync_runs
    where run_id = p_run_id
      and target_table = p_target_table
      and source_sheet_id = p_source_sheet_id
      and source_gid = p_source_gid
  ) then
    raise exception 'run id is already finalized with different metadata';
  end if;
end;
$$;

create or replace function public.finalize_sheet_sync(
  p_run_id uuid,
  p_target_table text,
  p_source_sheet_id text,
  p_source_gid text
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  run_row public.sheet_sync_runs%rowtype;
  v_inserted_count integer;
  v_payload_keys text[];
  v_insert_columns text;
  v_select_columns text;
begin
  if p_run_id is null
    or p_target_table not in ('provider_address', 'pc_raw_data', 'health_raw_data')
    or nullif(btrim(p_source_sheet_id), '') is null
    or nullif(btrim(p_source_gid), '') is null then
    raise exception 'invalid sheet sync metadata';
  end if;

  select * into run_row
  from public.sheet_sync_runs
  where run_id = p_run_id
  for update;

  if not found then
    raise exception 'unknown sheet sync run';
  end if;

  if run_row.target_table <> p_target_table
    or run_row.source_sheet_id <> p_source_sheet_id
    or run_row.source_gid <> p_source_gid then
    raise exception 'sheet sync metadata does not match run';
  end if;

  if run_row.status = 'finalized' then
    return run_row.inserted_count;
  end if;

  -- Only write columns the payload actually carries. The previous version used
  -- `select (jsonb_populate_record(...)).*`, which supplies a value for EVERY
  -- column of the target rowtype, including ones absent from the payload. An
  -- explicit NULL suppresses the column DEFAULT, so health_raw_data.id (uuid
  -- primary key default gen_random_uuid()) received NULL and failed its
  -- not-null constraint with 23502. Leaving the column out of the list is what
  -- lets the default fire. Generated and identity columns are excluded for the
  -- same reason: they cannot be written directly.
  -- One staged row is enough: rowToRecord() in datasync/lib/transform.js builds
  -- every record from the same config.columns list and always assigns each
  -- target (null included), so the key set is identical across the run.
  -- Aggregating over all rows instead costs 285ms per 14.7k rows versus 1ms,
  -- and that difference is most of the statement-timeout budget.
  select array_agg(k)
    into v_payload_keys
  from jsonb_object_keys((
    select s.payload
    from public.sheet_sync_staging s
    where s.run_id = p_run_id
      and s.target_table = p_target_table
      and s.source_sheet_id = p_source_sheet_id
      and s.source_gid = p_source_gid
    limit 1
  )) as k;

  -- Serialize replacement of one source partition. A concurrent run may stage
  -- independently, but only one can promote at a time.
  perform pg_advisory_xact_lock(
    hashtextextended(p_target_table || '|' || p_source_sheet_id || '|' || p_source_gid, 0)
  );

  execute format(
    'delete from public.%I where source_sheet_id = $1 and source_gid = $2',
    p_target_table
  ) using p_source_sheet_id, p_source_gid;

  if v_payload_keys is null then
    -- Nothing staged. Keep the documented contract: an emptied sheet empties
    -- the partition rather than erroring.
    v_inserted_count := 0;
  else
    select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position),
           string_agg('r.' || quote_ident(c.column_name), ', ' order by c.ordinal_position)
      into v_insert_columns, v_select_columns
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = p_target_table
      and c.is_generated = 'NEVER'
      and c.is_identity = 'NO'
      and c.column_name = any(v_payload_keys);

    if v_insert_columns is null then
      raise exception
        'no writable column of public.% matches the staged payload keys (%)',
        p_target_table, array_to_string(v_payload_keys, ', ');
    end if;

    execute format(
      'insert into public.%I (%s)
         select %s
         from public.sheet_sync_staging s
         cross join lateral jsonb_populate_record(null::public.%I, s.payload) r
         where s.run_id = $1
           and s.target_table = $2
           and s.source_sheet_id = $3
           and s.source_gid = $4
         order by s.source_row_number',
      p_target_table, v_insert_columns, v_select_columns, p_target_table
    ) using p_run_id, p_target_table, p_source_sheet_id, p_source_gid;

    get diagnostics v_inserted_count = row_count;
  end if;

  update public.sheet_sync_runs
  set status = 'finalized', inserted_count = v_inserted_count,
      finalized_at = clock_timestamp()
  where run_id = p_run_id;

  delete from public.sheet_sync_staging where run_id = p_run_id;
  return v_inserted_count;
end;
$$;

drop function if exists public.prune_stale_sheet_sync_runs(text, text, text, uuid);
commit;
