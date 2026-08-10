-- Scratch-only assertions for the task version trigger and atomic commands.
-- Run against a disposable database with the complete schema:
--   psql "$SCRATCH_DATABASE_URL" -v ON_ERROR_STOP=1 -f this-file.sql
-- Everything is rolled back, fixtures included. Never run against production.

begin;

do $$
declare
  -- Deliberately NOT named `task_id`: that is also a column on task_activity
  -- and task_comments, and plpgsql raises "column reference is ambiguous" the
  -- moment such a variable appears in a WHERE clause against those tables.
  fixture_task_id uuid;
  v0 timestamptz;
  v1 timestamptz;
begin
  -- status must be 'backlog' or the row needs an assignee:
  -- CHECK (status = 'backlog' OR assignee_email IS NOT NULL)
  insert into tasks (title, status, reporter_email)
  values ('trigger fixture', 'backlog', 'fixture@example.test')
  returning id, updated_at into fixture_task_id, v0;

  -- CASE1: a write that does not name updated_at must leave it alone. This is
  -- the regression: cron reminder writes were version-neutral, and a bare `<=`
  -- guard made every one of them invalidate the client's concurrency token.
  update tasks set overdue_reminded_at = now() where id = fixture_task_id;
  select updated_at into v1 from tasks where id = fixture_task_id;
  if v1 <> v0 then
    raise exception 'CASE1: reminder-only update moved updated_at from % to %', v0, v1;
  end if;

  -- CASE2: a write supplying an OLDER timestamp must still be clamped forward.
  -- This is the original bug the trigger exists to prevent.
  update tasks set updated_at = v0 - interval '1 hour' where id = fixture_task_id;
  select updated_at into v1 from tasks where id = fixture_task_id;
  if v1 <= v0 then
    raise exception 'CASE2: backwards updated_at was accepted (% <= %)', v1, v0;
  end if;

  -- CASE3: documents a deliberate, unavoidable limitation.
  --
  -- A write that SETS updated_at to exactly its current value is left alone. It
  -- is not possible to both leave untouched writes alone (CASE1) and advance an
  -- identical-value write: in a BEFORE UPDATE row trigger, a column absent from
  -- the SET clause and a column set to its own old value produce byte-identical
  -- NEW rows. PostgreSQL exposes no way to tell them apart, so the trigger must
  -- treat them the same, and CASE1 is the behaviour that matters -- it is the
  -- one that was breaking production.
  --
  -- This is safe because no writer in the codebase emits an identical
  -- timestamp: every atomic command computes
  -- greatest(clock_timestamp(), updated_at + interval '1 microsecond'),
  -- which is strictly greater by construction.
  v0 := v1;
  update tasks set updated_at = v0 where id = fixture_task_id;
  select updated_at into v1 from tasks where id = fixture_task_id;
  if v1 <> v0 then
    raise exception 'CASE3: identical-value write was unexpectedly changed (% -> %)', v0, v1;
  end if;

  -- CASE4: a genuine forward write is preserved exactly, not re-clamped.
  v0 := v1 + interval '5 minutes';
  update tasks set updated_at = v0 where id = fixture_task_id;
  select updated_at into v1 from tasks where id = fixture_task_id;
  if v1 <> v0 then
    raise exception 'CASE4: forward updated_at was rewritten from % to %', v0, v1;
  end if;

  -- CASE5: last_activity_at must never regress, and its actor travels with it.
  update tasks set last_activity_at = now(), last_activity_by_email = 'first@example.test'
   where id = fixture_task_id;
  update tasks set last_activity_at = now() - interval '1 hour',
                   last_activity_by_email = 'second@example.test'
   where id = fixture_task_id;
  if (select last_activity_by_email from tasks where id = fixture_task_id)
     <> 'first@example.test' then
    raise exception 'CASE5: regressing last_activity_at did not restore its actor';
  end if;

  -- CASE6: replaying a client_request_id returns the original comment and
  -- writes no second activity row. This is what makes a retry after an
  -- ambiguous response safe.
  declare
    req_id uuid := gen_random_uuid();
    first_result record;
    replay_result record;
    activity_count integer;
  begin
    select * into first_result from create_task_comment_atomic(
      fixture_task_id, 'author@example.test', 'hello', null, req_id, array[]::text[]);
    select * into replay_result from create_task_comment_atomic(
      fixture_task_id, 'author@example.test', 'hello', null, req_id, array[]::text[]);

    if (first_result.comment->>'id') <> (replay_result.comment->>'id') then
      raise exception 'CASE6: replay returned a different comment id';
    end if;
    if replay_result.was_created then
      raise exception 'CASE6: replay reported was_created = true';
    end if;

    select count(*) into activity_count
      from task_activity a
     where a.task_id = fixture_task_id and a.type = 'comment_added';
    if activity_count <> 1 then
      raise exception 'CASE6: replay produced % comment_added rows, expected 1', activity_count;
    end if;
  end;

  -- CASE7: the same text under a NEW request id is a legitimate second comment.
  -- Deduplicating on body text would swallow real user intent.
  declare
    second_result record;
  begin
    select * into second_result from create_task_comment_atomic(
      fixture_task_id, 'author@example.test', 'hello', null,
      gen_random_uuid(), array[]::text[]);
    if not second_result.was_created then
      raise exception 'CASE7: identical text under a new request id was deduplicated';
    end if;
  end;

  -- CASE8: a stale expected version must be rejected, not silently applied.
  declare
    cmt_id uuid;
    stale timestamptz;
  begin
    select (comment->>'id')::uuid, (comment->>'updated_at')::timestamptz
      into cmt_id, stale
      from create_task_comment_atomic(
        fixture_task_id, 'author@example.test', 'original', null,
        gen_random_uuid(), array[]::text[]);

    perform edit_task_comment_atomic(
      cmt_id, fixture_task_id, 'author@example.test', 'first edit', stale, array[]::text[]);
    begin
      perform edit_task_comment_atomic(
        cmt_id, fixture_task_id, 'author@example.test', 'second edit', stale, array[]::text[]);
      raise exception 'CASE8: stale expected_updated_at was accepted';
    exception when others then
      if sqlerrm not like '%COMMENT_CONFLICT%' then raise; end if;
    end;
  end;

  -- CASE9: mark_task_overdue_atomic reports the transition exactly once, so a
  -- second concurrent cron run cannot re-notify or double-count.
  declare
    first_flag boolean;
    second_flag boolean;
    od_task uuid;
    overdue_activity_count integer;
  begin
    -- in_progress requires an assignee under tasks_nonbacklog_has_assignee.
    insert into tasks (title, status, reporter_email, assignee_email, in_progress_at)
    values ('overdue fixture', 'in_progress', 'fixture@example.test',
            'fixture@example.test', now() - interval '2 hours')
    returning id into od_task;

    select mark_task_overdue_atomic(od_task, now() - interval '1 hour', 60) into first_flag;
    select mark_task_overdue_atomic(od_task, now() - interval '1 hour', 60) into second_flag;

    if not first_flag then raise exception 'CASE9: first transition returned false'; end if;
    if second_flag then raise exception 'CASE9: second transition returned true'; end if;

    select count(*) into overdue_activity_count
      from task_activity a
     where a.task_id = od_task and a.type = 'went_overdue';
    if overdue_activity_count <> 1 then
      raise exception 'CASE9: went_overdue written % times, expected 1', overdue_activity_count;
    end if;
  end;
end $$;

rollback;
