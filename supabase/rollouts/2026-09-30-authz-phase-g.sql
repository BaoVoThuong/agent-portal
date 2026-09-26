-- Authz Phase G — hàng đợi CS và roster/uỷ quyền không còn dựa vào tên role.
--
-- 1. assign_unassigned_task: bỏ bộ lọc đọc `portal_account.role`, permission
--    `task.work` và TÊN role "Admin"/"Super Admin". Ai được nhận việc từ hàng
--    đợi nay là grant `task.queue.member`, kiểm ở /api/tasks/[id]/assign trước
--    khi gọi hàm này (grant tương thích = task.work và không phải admin — đúng
--    tập cũ). Hàm chỉ còn giữ các điều kiện quan hệ.
-- 2. add/remove_task_agent_atomic, add/remove_assistant_delegation_atomic: ghi
--    access_audit cùng transaction với thay đổi roster / uỷ quyền.
--
-- Chạy SAU 2026-09-28-authz-phase-c.sql (cần access_audit). Chạy lại an toàn.

begin;

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
  -- Ai được nhận việc từ hàng đợi là GRANT `task.queue.member` — route
  -- /api/tasks/[id]/assign kiểm trước khi gọi (authz Phase G). Ở đây chỉ còn
  -- các điều kiện quan hệ: account active, không phải agent roster, không là
  -- assistant, không bị tắt trong hàng đợi. Không còn đọc tên role hay cột
  -- portal_account.role.
  if not exists (
    select 1
    from portal_account account
    where lower(trim(account.email)) = normalized_cs_email
      and account.is_active
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

-- Roster agent và uỷ quyền assistant quyết định phạm vi dữ liệu của người khác:
-- mỗi thay đổi ghi access_audit trong CÙNG transaction (authz Phase G, review C
-- P2-05). Các hàm cũ (create_agent_membership_atomic, delete_task_agent_atomic)
-- giữ nguyên và được gọi bên trong.
create or replace function add_task_agent_atomic(
  p_email text,
  p_actor_account_id uuid,
  p_actor_email text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_email text := nullif(lower(btrim(p_email)), '');
  inserted boolean;
begin
  if normalized_email is null then
    raise exception using message = 'AGENT_EMAIL_REQUIRED';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('task-agent|' || normalized_email, 0));
  if not exists (
    select 1 from portal_account
    where lower(btrim(email)) = normalized_email and is_active
  ) then
    raise exception using message = 'AGENT_ACCOUNT_INELIGIBLE';
  end if;
  insert into task_agents (email) values (normalized_email)
  on conflict (email) do nothing;
  inserted := found;
  if inserted then
    insert into access_audit (actor_account_id, actor_email, event, target_type, target_id, before, after)
    values (p_actor_account_id, p_actor_email, 'org.agent_roster.add', 'agent_roster', normalized_email,
            null, jsonb_build_object('email', normalized_email));
  end if;
  return inserted;
end;
$$;

create or replace function remove_task_agent_atomic(
  p_email text,
  p_actor_account_id uuid,
  p_actor_email text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_email text := nullif(lower(btrim(p_email)), '');
  assistants jsonb;
  removed boolean;
begin
  if normalized_email is null then
    raise exception using message = 'AGENT_EMAIL_REQUIRED';
  end if;
  select coalesce(jsonb_agg(lower(btrim(cs_email)) order by cs_email), '[]'::jsonb)
    into assistants
  from agent_members
  where lower(btrim(agent_email)) = normalized_email and is_assistant;
  removed := delete_task_agent_atomic(normalized_email);
  if removed then
    insert into access_audit (actor_account_id, actor_email, event, target_type, target_id, before, after)
    values (p_actor_account_id, p_actor_email, 'org.agent_roster.remove', 'agent_roster', normalized_email,
            jsonb_build_object('email', normalized_email, 'assistants', assistants), null);
  end if;
  return removed;
end;
$$;

create or replace function add_assistant_delegation_atomic(
  p_agent_email text,
  p_cs_email text,
  p_actor_account_id uuid,
  p_actor_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  membership jsonb;
begin
  membership := create_agent_membership_atomic(p_agent_email, p_cs_email);
  insert into access_audit (actor_account_id, actor_email, event, target_type, target_id, before, after)
  values (p_actor_account_id, p_actor_email, 'org.assistant_delegation.add', 'assistant_delegation',
          (membership ->> 'agent_email') || '>' || (membership ->> 'cs_email'), null, membership);
  return membership;
end;
$$;

create or replace function remove_assistant_delegation_atomic(
  p_agent_email text,
  p_cs_email text,
  p_actor_account_id uuid,
  p_actor_email text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_agent text := nullif(lower(btrim(p_agent_email)), '');
  normalized_assistant text := nullif(lower(btrim(p_cs_email)), '');
  removed boolean;
begin
  if normalized_agent is null or normalized_assistant is null then
    raise exception using message = 'ASSISTANT_EMAIL_REQUIRED';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('assistant-memberships', 0));
  delete from agent_members
  where lower(btrim(agent_email)) = normalized_agent
    and lower(btrim(cs_email)) = normalized_assistant
    and is_assistant;
  removed := found;
  if removed then
    insert into access_audit (actor_account_id, actor_email, event, target_type, target_id, before, after)
    values (p_actor_account_id, p_actor_email, 'org.assistant_delegation.remove', 'assistant_delegation',
            normalized_agent || '>' || normalized_assistant,
            jsonb_build_object('agent_email', normalized_agent, 'cs_email', normalized_assistant), null);
  end if;
  return removed;
end;
$$;

revoke all on function add_task_agent_atomic(text, uuid, text) from public, anon, authenticated;
grant execute on function add_task_agent_atomic(text, uuid, text) to service_role;
revoke all on function remove_task_agent_atomic(text, uuid, text) from public, anon, authenticated;
grant execute on function remove_task_agent_atomic(text, uuid, text) to service_role;
revoke all on function add_assistant_delegation_atomic(text, text, uuid, text) from public, anon, authenticated;
grant execute on function add_assistant_delegation_atomic(text, text, uuid, text) to service_role;
revoke all on function remove_assistant_delegation_atomic(text, text, uuid, text) from public, anon, authenticated;
grant execute on function remove_assistant_delegation_atomic(text, text, uuid, text) to service_role;

commit;

-- Kiểm chứng: 4 hàm mới có mặt.
select count(*) as org_rpcs
from pg_proc
where proname in (
  'add_task_agent_atomic', 'remove_task_agent_atomic',
  'add_assistant_delegation_atomic', 'remove_assistant_delegation_atomic'
);
