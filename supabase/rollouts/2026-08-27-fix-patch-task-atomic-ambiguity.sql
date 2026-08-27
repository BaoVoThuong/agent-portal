-- Fix: "column reference \"overdue_at\" is ambiguous" (SQLSTATE 42702) when
-- unlocking an overdue task.
--
-- patch_task_atomic declared a local variable named overdue_at while querying
-- task_overdue_events, which has a column of the same name. PL/pgSQL's default
-- variable_conflict is `error`, so the unqualified references in
--
--     select id, overdue_at into open_overdue
--     from task_overdue_events ... order by overdue_at desc
--
-- could not be resolved and the statement aborted. The branch only runs when
-- p_overdue is passed, i.e. only on POST /api/tasks/[id]/overdue-unlock, which
-- is why every other caller of this RPC kept working.
--
-- Introduced 2026-08-08 by 4f59280 (function) together with 16ad882, which
-- moved the unlock route onto this RPC. Forward-only: the function is already
-- deployed, so this replaces it in place.
--
-- Fixed two ways on purpose: the locals are renamed out of the column
-- namespace (matching resolved_at_value / overdue_seconds_value, which already
-- followed that convention), and the query is aliased so the column references
-- are explicit even if a local is ever renamed back.

create or replace function patch_task_atomic(
  p_task_id uuid,
  p_expected_updated_at timestamptz,
  p_patch jsonb,
  p_before_assignees text[] default '{}'::text[],
  p_next_assignees text[] default null,
  p_actor_email text default null,
  p_activity jsonb default '[]'::jsonb,
  p_overdue jsonb default null,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_task tasks%rowtype;
  next_task tasks%rowtype;
  open_stage record;
  open_overdue record;
  activity_entry jsonb;
  next_assignee_email text;
  old_started_at timestamptz;
  next_started_at timestamptz;
  next_sla_minutes integer;
  next_sla_active boolean;
  -- Suffixed to stay out of task_overdue_events' column namespace. A bare
  -- `overdue_at` here shadowed that table's column and made the SELECT below
  -- fail with 42702 every time an overdue task was unlocked. resolved_at_value
  -- and overdue_seconds_value already followed this convention.
  overdue_at_value timestamptz;
  due_at_value timestamptz;
  resolved_at_value timestamptz;
  overdue_seconds_value integer;
  moves_last_activity boolean;
begin
  if p_actor_email is null or btrim(p_actor_email) = '' then
    raise exception 'TASK_ACTOR_REQUIRED';
  end if;

  select * into target_task
  from tasks
  where id = p_task_id
  for update;

  if not found then
    raise exception 'TASK_NOT_FOUND';
  end if;

  if p_expected_updated_at is null or target_task.updated_at <> p_expected_updated_at then
    raise exception 'TASK_CONFLICT';
  end if;

  -- Reordering a row is a presentation-only mutation. Every other PATCH
  -- represents a human edit (including custom values), and therefore moves
  -- the timestamp/actor pair together. Keep this decision inside the locked
  -- command so callers cannot accidentally update only one side of F10.
  moves_last_activity :=
    coalesce(jsonb_array_length(p_activity), 0) > 0
    or exists (
      select 1
      from jsonb_object_keys(coalesce(p_patch, '{}'::jsonb)) as patch_key(key)
      where patch_key.key <> 'position'
    );

  update tasks
  set
    title = case when p_patch ? 'title' then p_patch->>'title' else title end,
    description = case when p_patch ? 'description' then p_patch->>'description' else description end,
    fub_link = case when p_patch ? 'fub_link' then p_patch->>'fub_link' else fub_link end,
    status = case when p_patch ? 'status' then p_patch->>'status' else status end,
    priority = case when p_patch ? 'priority' then p_patch->>'priority' else priority end,
    category_id = case when p_patch ? 'category_id' then (p_patch->>'category_id')::uuid else category_id end,
    custom_values = case when p_patch ? 'custom_values' then p_patch->'custom_values' else custom_values end,
    agent_email = case when p_patch ? 'agent_email' then p_patch->>'agent_email' else agent_email end,
    assignee_email = case when p_patch ? 'assignee_email' then p_patch->>'assignee_email' else assignee_email end,
    done_reviewed_by_email = case when p_patch ? 'done_reviewed_by_email' then p_patch->>'done_reviewed_by_email' else done_reviewed_by_email end,
    done_reviewed_at = case when p_patch ? 'done_reviewed_at' then (p_patch->>'done_reviewed_at')::timestamptz else done_reviewed_at end,
    position = case when p_patch ? 'position' then (p_patch->>'position')::double precision else position end,
    todo_started_at = case when p_patch ? 'todo_started_at' then (p_patch->>'todo_started_at')::timestamptz else todo_started_at end,
    todo_reminded_at = case when p_patch ? 'todo_reminded_at' then (p_patch->>'todo_reminded_at')::timestamptz else todo_reminded_at end,
    todo_seconds = case when p_patch ? 'todo_seconds' then (p_patch->>'todo_seconds')::integer else todo_seconds end,
    in_progress_at = case when p_patch ? 'in_progress_at' then (p_patch->>'in_progress_at')::timestamptz else in_progress_at end,
    in_progress_seconds = case when p_patch ? 'in_progress_seconds' then (p_patch->>'in_progress_seconds')::integer else in_progress_seconds end,
    waiting_started_at = case when p_patch ? 'waiting_started_at' then (p_patch->>'waiting_started_at')::timestamptz else waiting_started_at end,
    waiting_reminded_at = case when p_patch ? 'waiting_reminded_at' then (p_patch->>'waiting_reminded_at')::timestamptz else waiting_reminded_at end,
    waiting_seconds = case when p_patch ? 'waiting_seconds' then (p_patch->>'waiting_seconds')::integer else waiting_seconds end,
    overdue_flagged_at = case when p_patch ? 'overdue_flagged_at' then (p_patch->>'overdue_flagged_at')::timestamptz else overdue_flagged_at end,
    overdue_reminded_at = case when p_patch ? 'overdue_reminded_at' then (p_patch->>'overdue_reminded_at')::timestamptz else overdue_reminded_at end,
    overdue_unlocked_at = case when p_patch ? 'overdue_unlocked_at' then (p_patch->>'overdue_unlocked_at')::timestamptz else overdue_unlocked_at end,
    due_soon_notified_at = case when p_patch ? 'due_soon_notified_at' then (p_patch->>'due_soon_notified_at')::timestamptz else due_soon_notified_at end,
    sla_minutes = case when p_patch ? 'sla_minutes' then (p_patch->>'sla_minutes')::integer else sla_minutes end,
    overdue_count = case when p_patch ? 'overdue_count' then (p_patch->>'overdue_count')::integer else overdue_count end,
    closed_at = case when p_patch ? 'closed_at' then (p_patch->>'closed_at')::timestamptz else closed_at end,
    reopened_at = case when p_patch ? 'reopened_at' then (p_patch->>'reopened_at')::timestamptz else reopened_at end,
    updated_at = p_now,
    last_activity_at = case
      when moves_last_activity then p_now
      else last_activity_at
    end,
    last_activity_by_email = case
      when moves_last_activity
        and (last_activity_at is null or p_now >= last_activity_at)
        then p_actor_email
      else last_activity_by_email
    end,
    stale_reminded_at = null
  where id = p_task_id
    and updated_at = p_expected_updated_at
  returning * into next_task;

  if not found then
    raise exception 'TASK_CONFLICT';
  end if;

  -- Keep the legacy primary assignee and junction source of truth in one
  -- transaction. A null p_next_assignees means this PATCH did not reassign.
  if p_next_assignees is not null then
    delete from task_assignees where task_id = p_task_id;
    foreach next_assignee_email in array p_next_assignees loop
      insert into task_assignees (task_id, email, created_at)
      values (p_task_id, next_assignee_email, p_now);
    end loop;

    foreach next_assignee_email in array coalesce(p_before_assignees, '{}'::text[]) loop
      if not (next_assignee_email = any(p_next_assignees)) then
        update task_assignment_cycles
        set unassigned_at = p_now,
            unassigned_by_email = p_actor_email,
            source = 'patch'
        where task_id = p_task_id
          and email = next_assignee_email
          and unassigned_at is null;
      end if;
    end loop;

    foreach next_assignee_email in array p_next_assignees loop
      if not (next_assignee_email = any(coalesce(p_before_assignees, '{}'::text[]))) then
        insert into task_assignment_cycles (
          task_id, email, assigned_at, assigned_by_email, source
        ) values (
          p_task_id, next_assignee_email, p_now, p_actor_email, 'patch'
        );
      end if;
    end loop;
  end if;

  -- Resolve an active overdue event before closing the In Progress stage so
  -- the event can retain its current open stage_cycle_id.
  if p_overdue is not null and jsonb_typeof(p_overdue) = 'object' then
    due_at_value := (p_overdue->>'due_at')::timestamptz;
    resolved_at_value := (p_overdue->>'resolved_at')::timestamptz;
    overdue_seconds_value := greatest(0, round(extract(epoch from (resolved_at_value - due_at_value)))::integer);
    select event.id, event.overdue_at into open_overdue
    from task_overdue_events as event
    where event.task_id = p_task_id and event.resolved_at is null
    order by event.overdue_at desc
    limit 1
    for update;

    overdue_at_value := coalesce(
      open_overdue.overdue_at, target_task.overdue_flagged_at, due_at_value);
    if open_overdue.id is not null then
      update task_overdue_events
      set stage_cycle_id = (
            select id from task_stage_cycles
            where task_id = p_task_id and stage = 'in_progress' and ended_at is null
            order by started_at desc limit 1
          ),
          resolved_at = resolved_at_value,
          overdue_seconds = overdue_seconds_value,
          resolved_by_email = p_actor_email,
          reason = p_overdue->>'reason',
          sla_minutes = (p_overdue->>'sla_minutes')::integer
      where id = open_overdue.id;
    else
      insert into task_overdue_events (
        task_id, stage_cycle_id, due_at, overdue_at, resolved_at,
        overdue_seconds, resolved_by_email, reason, sla_minutes
      ) values (
        p_task_id,
        (
          select id from task_stage_cycles
          where task_id = p_task_id and stage = 'in_progress' and ended_at is null
          order by started_at desc limit 1
        ),
        due_at_value,
        overdue_at_value,
        resolved_at_value,
        overdue_seconds_value,
        p_actor_email,
        p_overdue->>'reason',
        (p_overdue->>'sla_minutes')::integer
      ) on conflict do nothing;
    end if;
  end if;

  -- Stage history is required history, not a best-effort notification. Keep
  -- the close/open pair in the same transaction as the task row update.
  if target_task.status <> next_task.status then
    select id, started_at into open_stage
    from task_stage_cycles
    where task_id = p_task_id and ended_at is null
    order by started_at desc
    limit 1
    for update;

    if open_stage.id is not null then
      update task_stage_cycles
      set ended_at = p_now,
          duration_seconds = greatest(0, round(extract(epoch from (p_now - open_stage.started_at)))::integer),
          ended_by_email = p_actor_email,
          to_status = next_task.status
      where id = open_stage.id;
    else
      old_started_at := case target_task.status
        when 'todo' then coalesce(target_task.todo_started_at, target_task.updated_at, target_task.created_at)
        when 'in_progress' then coalesce(target_task.in_progress_at, target_task.updated_at, target_task.created_at)
        when 'waiting' then coalesce(target_task.waiting_started_at, target_task.updated_at, target_task.created_at)
        when 'done' then coalesce(target_task.closed_at, target_task.updated_at, target_task.created_at)
        when 'cancel' then coalesce(target_task.closed_at, target_task.updated_at, target_task.created_at)
        else target_task.created_at
      end;
      insert into task_stage_cycles (
        task_id, stage, started_at, ended_at, duration_seconds,
        ended_by_email, to_status, sla_minutes, due_at, meta
      ) values (
        p_task_id,
        target_task.status,
        old_started_at,
        p_now,
        greatest(0, round(extract(epoch from (p_now - old_started_at)))::integer),
        p_actor_email,
        next_task.status,
        case when target_task.status = 'in_progress'
          and target_task.overdue_count = 0
          and target_task.waiting_started_at is null
          and coalesce(target_task.waiting_seconds, 0) = 0
          then target_task.sla_minutes else null end,
        case when target_task.status = 'in_progress'
          and target_task.overdue_count = 0
          and target_task.waiting_started_at is null
          and coalesce(target_task.waiting_seconds, 0) = 0
          and target_task.sla_minutes is not null
          then old_started_at + make_interval(mins => target_task.sla_minutes) else null end,
        jsonb_build_object('source', 'fallback-close')
      );
    end if;

    next_started_at := case next_task.status
      when 'todo' then coalesce(next_task.todo_started_at, p_now)
      when 'in_progress' then coalesce(next_task.in_progress_at, p_now)
      when 'waiting' then coalesce(next_task.waiting_started_at, p_now)
      when 'done' then coalesce(next_task.closed_at, p_now)
      when 'cancel' then coalesce(next_task.closed_at, p_now)
      else p_now
    end;
    next_sla_active := next_task.status = 'in_progress'
      and target_task.overdue_count = 0
      and target_task.waiting_started_at is null
      and coalesce(target_task.waiting_seconds, 0) = 0;
    next_sla_minutes := case when next_sla_active then next_task.sla_minutes else null end;
    insert into task_stage_cycles (
      task_id, stage, started_at, started_by_email, from_status,
      sla_minutes, due_at, meta
    ) values (
      p_task_id,
      next_task.status,
      next_started_at,
      p_actor_email,
      target_task.status,
      next_sla_minutes,
      case when next_sla_minutes is not null
        then next_started_at + make_interval(mins => next_sla_minutes)
        else null end,
      null
    );
  end if;

  if jsonb_typeof(p_activity) = 'array' then
    for activity_entry in select value from jsonb_array_elements(p_activity) loop
      insert into task_activity (task_id, actor_email, type, meta)
      values (
        p_task_id,
        p_actor_email,
        activity_entry->>'type',
        case when activity_entry->'meta' = 'null'::jsonb then null else activity_entry->'meta' end
      );
    end loop;
  end if;

  return to_jsonb(next_task);
end;
$$;
revoke all on function patch_task_atomic(uuid, timestamptz, jsonb, text[], text[], text, jsonb, jsonb, timestamptz)
  from public, anon, authenticated;
grant execute on function patch_task_atomic(uuid, timestamptz, jsonb, text[], text[], text, jsonb, jsonb, timestamptz)
  to service_role;

-- Verification. Supabase Studio never surfaces RAISE NOTICE, so this returns a
-- table instead. Expect one row, all three columns reading 'ok'. The markers are
-- positive ("the alias is present") rather than "the old text is absent", so a
-- comment mentioning the old code cannot make a broken deploy look healthy.
select
  case when prosrc like '%from task_overdue_events as event%'
       then 'ok' else 'FAIL: query not aliased' end            as aliased_query,
  case when prosrc like '%overdue_at_value timestamptz;%'
       then 'ok' else 'FAIL: local still shadows column' end   as renamed_overdue,
  case when prosrc like '%due_at_value timestamptz;%'
       then 'ok' else 'FAIL: local still shadows column' end   as renamed_due
from pg_proc
where proname = 'patch_task_atomic';
