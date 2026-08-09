-- Scratch-only assertions for Enrollment stage-time RPCs.
-- Run against a disposable database with the complete schema:
--   psql "$SCRATCH_DATABASE_URL" -v ON_ERROR_STOP=1 -f this-file.sql
-- Everything is rolled back, including fixture options.

begin;

do $$
declare
  set_id uuid;
  stage_a uuid;
  stage_b uuid;
  stage_done uuid;
  rec_id uuid;
  terminal_id uuid;
  no_stage_id uuid;
  active2_id uuid;
  token timestamptz;
  next_token timestamptz;
  t0 timestamptz := timestamptz '2026-01-01 00:00:00+00';
  cur enrollment_records%rowtype;
  n integer;
  dur integer;
  raised text;
begin
  select id into set_id
  from enrollment_option_sets
  where program = 'aca' and key = 'stage'
  limit 1;
  if set_id is null then
    raise exception 'FIXTURE: ACA stage option set not found';
  end if;

  insert into enrollment_options (set_id, label, position, is_terminal)
  values (set_id, 'ZZ-test-A', 9001, false) returning id into stage_a;
  insert into enrollment_options (set_id, label, position, is_terminal)
  values (set_id, 'ZZ-test-B', 9002, false) returning id into stage_b;
  insert into enrollment_options (set_id, label, position, is_terminal)
  values (set_id, 'ZZ-test-Done', 9003, true) returning id into stage_done;

  -- Create active: one normalized open dwell cycle and live denormalized fields.
  rec_id := ((create_enrollment_atomic(
    jsonb_build_object(
      'program', 'aca', 'client_name', 'T1', 'stage_id', stage_a,
      'agent_email', 'Agent@Example.COM'
    ),
    'Creator@Example.com',
    jsonb_build_array(jsonb_build_object('type', 'created', 'meta', null)),
    t0
  ))->>'id')::uuid;

  select count(*) into n from enrollment_stage_cycles where record_id = rec_id;
  if n <> 1 then raise exception 'CASE1: expected one cycle, got %', n; end if;
  select count(*) into n from enrollment_stage_cycles
  where record_id = rec_id and ended_at is null and kind = 'dwell'
    and stage_id = stage_a and agent_email = 'agent@example.com';
  if n <> 1 then raise exception 'CASE1: open dwell/email normalization failed'; end if;
  select * into cur from enrollment_records where id = rec_id;
  if cur.stage_entered_at <> t0 or cur.stage_entered_source <> 'live'
     or cur.last_activity_by_email <> 'creator@example.com' then
    raise exception 'CASE1: denormalized fields incorrect';
  end if;

  -- Create terminal: one closed marker, no open cycle.
  terminal_id := ((create_enrollment_atomic(
    jsonb_build_object(
      'program', 'aca', 'client_name', 'T2', 'stage_id', stage_done,
      'closed_at', to_jsonb(t0)
    ), 'creator@example.com', '[]'::jsonb, t0
  ))->>'id')::uuid;
  select count(*) into n from enrollment_stage_cycles
  where record_id = terminal_id and kind = 'entry_marker' and duration_seconds = 0;
  if n <> 1 then raise exception 'CASE2: terminal marker missing'; end if;
  select count(*) into n from enrollment_stage_cycles
  where record_id = terminal_id and ended_at is null;
  if n <> 0 then raise exception 'CASE2: terminal record has open cycle'; end if;

  -- Create without stage: no cycle and null stage-entry pair.
  no_stage_id := ((create_enrollment_atomic(
    jsonb_build_object('program', 'aca', 'client_name', 'T3'),
    'creator@example.com', '[]'::jsonb, t0
  ))->>'id')::uuid;
  select count(*) into n from enrollment_stage_cycles where record_id = no_stage_id;
  if n <> 0 then raise exception 'CASE3: stage-less create made cycle'; end if;

  -- Stage transition is atomic and uses exactly one new open dwell cycle.
  select updated_at into token from enrollment_records where id = rec_id;
  perform patch_enrollment_atomic(
    rec_id, token,
    jsonb_build_object('stage_id', stage_b),
    'Mover@Example.com',
    jsonb_build_array(jsonb_build_object('type', 'stage_changed', 'meta',
      jsonb_build_object('from', 'ZZ-test-A', 'to', 'ZZ-test-B'))),
    t0 + interval '2 hours'
  );
  select * into cur from enrollment_records where id = rec_id;
  if cur.stage_entered_at <> t0 + interval '2 hours'
     or cur.stage_entered_source <> 'live' then
    raise exception 'CASE4: stage entry did not move';
  end if;
  select duration_seconds into dur from enrollment_stage_cycles
  where record_id = rec_id and stage_id = stage_a;
  if dur <> 7200 then raise exception 'CASE4: expected 7200 seconds, got %', dur; end if;
  select count(*) into n from enrollment_stage_cycles
  where record_id = rec_id and ended_at is null;
  if n <> 1 then raise exception 'CASE4: expected one open cycle, got %', n; end if;
  select count(*) into n from enrollment_stage_history
  where record_id = rec_id and from_option_id = stage_a and to_option_id = stage_b;
  if n <> 1 then raise exception 'CASE4: stage history missing'; end if;

  -- Owner change is not a new stage visit.
  select count(*) into n from enrollment_stage_cycles where record_id = rec_id;
  select updated_at into token from enrollment_records where id = rec_id;
  perform patch_enrollment_atomic(
    rec_id, token, jsonb_build_object('agent_email', 'NewOwner@Example.com'),
    'Mover@Example.com', '[]'::jsonb, t0 + interval '3 hours'
  );
  if (select count(*) from enrollment_stage_cycles where record_id = rec_id) <> n then
    raise exception 'CASE5: owner change split a stage visit';
  end if;
  if (select agent_email from enrollment_stage_cycles where record_id = rec_id and ended_at is null)
     <> 'agent@example.com' then
    raise exception 'CASE5: owner snapshot changed unexpectedly';
  end if;

  -- Active -> terminal in one patch creates only a marker and no open cycle.
  select updated_at into token from enrollment_records where id = rec_id;
  perform patch_enrollment_atomic(
    rec_id, token,
    jsonb_build_object('stage_id', stage_done, 'closed_at', to_jsonb(t0 + interval '4 hours')),
    'Mover@Example.com', '[]'::jsonb, t0 + interval '4 hours'
  );
  select count(*) into n from enrollment_stage_cycles
  where record_id = rec_id and stage_id = stage_done and kind = 'entry_marker'
    and duration_seconds = 0;
  if n <> 1 then raise exception 'CASE6: terminal marker count is %', n; end if;
  if (select count(*) from enrollment_stage_cycles where record_id = rec_id and ended_at is null) <> 0 then
    raise exception 'CASE6: terminal patch left open cycle';
  end if;

  -- Reopen starts a fresh dwell cycle.
  select updated_at into token from enrollment_records where id = rec_id;
  perform patch_enrollment_atomic(
    rec_id, token, jsonb_build_object('closed_at', null),
    'Mover@Example.com', '[]'::jsonb, t0 + interval '5 hours'
  );
  if (select count(*) from enrollment_stage_cycles where record_id = rec_id and ended_at is null) <> 1 then
    raise exception 'CASE7: reopen did not create one open cycle';
  end if;

  -- p_now behind updated_at still advances the token by one microsecond.
  select updated_at into token from enrollment_records where id = rec_id;
  perform patch_enrollment_atomic(rec_id, token, '{"client_name":"T1b"}',
    'Mover@Example.com', '[]'::jsonb, token);
  select updated_at into next_token from enrollment_records where id = rec_id;
  if next_token <= token then raise exception 'CASE8: updated_at did not advance'; end if;

  -- Invalid inputs fail before mutation.
  begin
    perform patch_enrollment_atomic(rec_id, next_token, '{"program":"medicare"}',
      'Mover@Example.com', '[]'::jsonb, t0);
    raise exception 'CASE9: unknown field was accepted';
  exception when others then
    raised := sqlerrm;
    if raised not like '%ENROLLMENT_UNKNOWN_FIELD%' then raise; end if;
  end;
  begin
    perform patch_enrollment_atomic(rec_id, next_token, '{}',
      'Mover@Example.com', '{"type":"not-array"}'::jsonb, t0);
    raise exception 'CASE10: invalid activity was accepted';
  exception when others then
    raised := sqlerrm;
    if raised not like '%ENROLLMENT_ACTIVITY_INVALID%' then raise; end if;
  end;

  -- Archive is idempotent, closes the dwell cycle, and does not add a marker.
  select updated_at into token from enrollment_records where id = rec_id;
  select count(*) into n from enrollment_stage_cycles where record_id = rec_id;
  perform archive_enrollment_atomic(rec_id, 'Mover@Example.com',
    jsonb_build_array(jsonb_build_object('type', 'archived', 'meta', null)),
    t0 + interval '6 hours'
  );
  if (select count(*) from enrollment_stage_cycles where record_id = rec_id) <> n then
    raise exception 'CASE11: archive created an unexpected marker';
  end if;
  if (select count(*) from enrollment_stage_cycles where record_id = rec_id and ended_at is null) <> 0 then
    raise exception 'CASE11: archive left open cycle';
  end if;
  perform archive_enrollment_atomic(rec_id, 'Mover@Example.com', '[]'::jsonb, t0 + interval '7 hours');

  -- System and older activity touches never move the human activity marker.
  select last_activity_at into token from enrollment_records where id = rec_id;
  perform enrollment_touch_activity(rec_id, 'system', t0);
  if (select last_activity_at from enrollment_records where id = rec_id) <> token then
    raise exception 'CASE12: system moved last activity';
  end if;

  -- Unique open-cycle index and marker invariant are database-enforced.
  active2_id := ((create_enrollment_atomic(
    jsonb_build_object('program', 'aca', 'client_name', 'T4', 'stage_id', stage_a),
    'creator@example.com', '[]'::jsonb, t0
  ))->>'id')::uuid;
  begin
    insert into enrollment_stage_cycles (record_id, stage_id, kind, started_at)
    values (active2_id, stage_done, 'dwell', t0);
    raise exception 'CASE13: duplicate open cycle was accepted';
  exception when unique_violation then
    null;
  end;
  begin
    insert into enrollment_stage_cycles (
      record_id, stage_id, kind, started_at, ended_at, duration_seconds
    ) values (terminal_id, stage_done, 'entry_marker', t0, t0, 1);
    raise exception 'CASE14: non-zero entry marker was accepted';
  exception when check_violation then
    null;
  end;
end $$;

rollback;
