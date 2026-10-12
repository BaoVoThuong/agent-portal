-- Restore assign_unassigned_task to the pre-review body.
create or replace function assign_unassigned_task(
  p_task_id uuid,
  p_cs_email text,
  p_expected_updated_at timestamptz,
  p_actor_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_task tasks%rowtype;
  normalized_cs_email text := lower(trim(p_cs_email));
  now_iso timestamptz := now();
  rotation_minutes integer;
begin
  if not exists (
    select 1
    from portal_account account
    where lower(trim(account.email)) = normalized_cs_email
      and account.is_active
      and exists (
        select 1
        from user_roles ur
        join role_permissions rp on rp.role_id = ur.role_id
        join roles r on r.id = ur.role_id
        where ur.user_id = account.id
          and rp.permission_key = 'task.work'
          and r.is_active
      )
      and not exists (
        select 1 from task_agents ta
        where lower(trim(ta.email)) = normalized_cs_email
      )
      and not exists (
        select 1 from agent_members am
        where lower(trim(am.cs_email)) = normalized_cs_email
          and am.is_assistant
      )
      and not exists (
        select 1 from task_assignment_queue_members queue_member
        where lower(trim(queue_member.email)) = normalized_cs_email
          and not queue_member.is_enabled
      )
  ) then
    raise exception 'INVALID_CS';
  end if;

  select * into target_task
  from tasks
  where id = p_task_id
  for update;

  if not found then
    raise exception 'TASK_NOT_FOUND';
  end if;

  if p_expected_updated_at is not null
    and target_task.updated_at <> p_expected_updated_at then
    raise exception 'ASSIGN_CONFLICT';
  end if;

  if target_task.status <> 'backlog'
    or target_task.assignee_email is not null
    or exists (select 1 from task_assignees ta where ta.task_id = p_task_id) then
    raise exception 'ASSIGN_CONFLICT';
  end if;

  update tasks
  set status = 'todo',
      assignee_email = normalized_cs_email,
      todo_started_at = now_iso,
      todo_reminded_at = null,
      updated_at = now_iso,
      last_activity_at = now_iso,
      last_activity_by_email = p_actor_email,
      stale_reminded_at = null
  where id = p_task_id;

  insert into task_assignees (task_id, email, created_at)
  values (p_task_id, normalized_cs_email, now_iso);

  insert into task_assignment_cycles (
    task_id, email, assigned_at, assigned_by_email, source
  ) values (
    p_task_id, normalized_cs_email, now_iso, p_actor_email, 'overview'
  );

  update task_stage_cycles
  set ended_at = now_iso,
      duration_seconds = greatest(0, extract(epoch from (now_iso - started_at))::integer),
      ended_by_email = p_actor_email,
      to_status = 'todo'
  where task_id = p_task_id
    and ended_at is null;

  insert into task_stage_cycles (
    task_id, stage, started_at, started_by_email, from_status, sla_minutes, due_at, meta
  ) values (
    p_task_id, 'todo', now_iso, p_actor_email, 'backlog', null, null,
    jsonb_build_object('source', 'overview')
  );

  insert into task_activity (task_id, actor_email, type, meta)
  values (
    p_task_id, p_actor_email, 'assigned',
    jsonb_build_object('to', normalized_cs_email, 'source', 'overview')
  );

  select coalesce(
    target_task.sla_minutes,
    (
      select rule.duration_minutes
      from task_sla_rules rule
      where rule.priority = target_task.priority
        and rule.category_id = target_task.category_id
      limit 1
    ),
    (
      select rule.duration_minutes
      from task_sla_rules rule
      where rule.priority = target_task.priority
        and rule.category_id is null
      limit 1
    ),
    case target_task.priority
      when 'urgent' then 60
      when 'high' then 240
      when 'medium' then 480
      else 1440
    end
  ) into rotation_minutes;

  perform bump_task_assignment_rotation(
    normalized_cs_email,
    rotation_minutes,
    now_iso
  );

  return jsonb_build_object(
    'task_id', p_task_id,
    'email', normalized_cs_email,
    'updated_at', now_iso
  );
end;
$$;
