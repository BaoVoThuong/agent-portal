-- =====================================================================
-- Stage Billing — xem kế hoạch docs/2026-09-12-billing-stage.md
--
-- Billing nằm giữa Waiting và Done trên board, là stage TUỲ CHỌN (In Progress →
-- Done thẳng vẫn hợp lệ), tính là việc ĐANG CHẠY chưa xong, và TẠM DỪNG SLA
-- y hệt Waiting.
--
-- `cancel` GIỮ NGUYÊN là trạng thái hợp lệ. Đợt này chỉ bỏ CỘT Cancel trên
-- board, mà đó là việc của phía code — database không đổi gì cho Cancel.
--
-- ⚠ Chạy TRƯỚC khi deploy code. Rollout chỉ nới ràng buộc và thêm cột; code
--   đang chạy không bao giờ sinh ra 'billing' nên chạy trước là an toàn tuyệt
--   đối, không có cửa sổ hỏng.
-- ⚠ Sau khi chạy: notify pgrst, 'reload schema';
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Nới hai ràng buộc trạng thái
--
-- `task_stage_cycles` được tạo bằng `create table if not exists`, nghĩa là trên
-- database đã có, sửa dòng check trong schema.sql KHÔNG có tác dụng gì. Phải
-- drop/add tường minh ở đây thì ràng buộc mới thật sự đổi.
-- ---------------------------------------------------------------------
alter table tasks drop constraint if exists tasks_status_check;
alter table tasks
  add constraint tasks_status_check
  check (status in ('backlog','todo','in_progress','waiting','billing','done','cancel'));

alter table task_stage_cycles drop constraint if exists task_stage_cycles_stage_check;
alter table task_stage_cycles
  add constraint task_stage_cycles_stage_check
  check (stage in ('backlog','todo','in_progress','waiting','billing','done','cancel'));

-- ---------------------------------------------------------------------
-- 2. Đồng hồ của stage mới
--
-- Đúng khuôn todo/in_progress/waiting:
--   billing_started_at  chỉ khác null KHI task đang ở Billing; xoá khi rời.
--   billing_seconds     tổng tích luỹ của mọi lượt đã đóng.
--
-- `billing_reminded_at` thêm sẵn cho đủ bộ như waiting. Chưa cron nào đọc nó;
-- hôm nào muốn "nằm Billing quá N giờ thì nhắc" thì cột đã có sẵn, khỏi phải
-- migrate lần nữa.
--
-- Không cần backfill: chưa task nào từng ở Billing, nên mặc định 0 / null đã
-- đúng cho toàn bộ bảng.
-- ---------------------------------------------------------------------
alter table tasks add column if not exists billing_started_at timestamptz;
alter table tasks add column if not exists billing_reminded_at timestamptz;
alter table tasks add column if not exists billing_seconds integer not null default 0;

-- ---------------------------------------------------------------------
-- 3. Hai RPC ghi task
--
-- ⚠ ĐÂY LÀ CHỖ DỄ SÓT NHẤT CỦA CẢ ĐỢT.
--
-- `resolveTaskPatch()` bên TypeScript không tự ghi database — nó chỉ dựng ra
-- một object patch rồi giao cho `patch_task_atomic`. Mà hàm đó liệt kê TỪNG CỘT
-- MỘT trong khối SET. Sửa mỗi TypeScript thì patch vẫn mang theo
-- `billing_seconds`, còn SQL lặng lẽ vứt đi: không lỗi, không cảnh báo, chỉ là
-- giờ Billing mãi mãi bằng 0 và không ai biết cho tới lúc xem báo cáo.
--
-- Hai thân hàm dưới đây được TRÍCH NGUYÊN VĂN từ supabase/schema.sql sau khi
-- sửa, không gõ lại tay, nên hai file chắc chắn khớp nhau. So với bản cũ chỉ
-- khác đúng những chỗ có chữ `billing`.
--
-- Chữ ký hàm không đổi, nên `create or replace` giữ nguyên quyền đã cấp —
-- không cần revoke/grant lại.
-- ---------------------------------------------------------------------

create or replace function create_task_atomic(
  p_task jsonb,
  p_assignees text[] default '{}'::text[],
  p_actor_email text default null,
  p_client_request_id uuid default null
)
returns table (task jsonb, was_created boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task tasks%rowtype;
  v_now timestamptz := clock_timestamp();
  v_actor text := lower(trim(p_actor_email));
  v_assignees text[];
  v_status text;
  v_started_at timestamptz;
  v_sla_minutes integer;
begin
  if v_actor is null or v_actor = '' then
    raise exception 'TASK_ACTOR_REQUIRED';
  end if;
  if p_task is null or jsonb_typeof(p_task) <> 'object' then
    raise exception 'TASK_PAYLOAD_INVALID';
  end if;
  if btrim(coalesce(p_task->>'title', '')) = '' then
    raise exception 'TASK_TITLE_REQUIRED';
  end if;

  select coalesce(array_agg(distinct lower(trim(input_email.email)) order by lower(trim(input_email.email))), '{}'::text[])
    into v_assignees
  from unnest(coalesce(p_assignees, '{}'::text[])) as input_email(email)
  where btrim(input_email.email) <> '';

  v_status := coalesce(nullif(p_task->>'status', ''), 'backlog');
  if v_status not in ('backlog', 'todo', 'in_progress', 'waiting', 'billing', 'done', 'cancel') then
    raise exception 'TASK_STATUS_INVALID';
  end if;
  v_sla_minutes := nullif(p_task->>'sla_minutes', '')::integer;

  -- ON CONFLICT waits for a concurrent creator to commit, then the replay
  -- SELECT below returns its canonical row. No second activity/cycle is made.
  insert into tasks (
    title, description, fub_link, status, priority, category_id,
    agent_email, assignee_email, reporter_email, custom_values, position,
    last_activity_at, last_activity_by_email, client_request_id,
    todo_started_at, in_progress_at, waiting_started_at, billing_started_at, closed_at,
    sla_minutes, stale_reminded_at, created_at, updated_at
  ) values (
    btrim(p_task->>'title'),
    nullif(btrim(p_task->>'description'), ''),
    nullif(btrim(p_task->>'fub_link'), ''),
    v_status,
    coalesce(nullif(p_task->>'priority', ''), 'medium'),
    nullif(p_task->>'category_id', '')::uuid,
    nullif(lower(trim(p_task->>'agent_email')), ''),
    case when v_status = 'backlog' then null else nullif(lower(trim(p_task->>'assignee_email')), '') end,
    v_actor,
    coalesce(p_task->'custom_values', '{}'::jsonb),
    coalesce(nullif(p_task->>'position', '')::double precision, 0),
    v_now,
    v_actor,
    p_client_request_id,
    nullif(p_task->>'todo_started_at', '')::timestamptz,
    nullif(p_task->>'in_progress_at', '')::timestamptz,
    nullif(p_task->>'waiting_started_at', '')::timestamptz,
    nullif(p_task->>'billing_started_at', '')::timestamptz,
    nullif(p_task->>'closed_at', '')::timestamptz,
    case when v_status = 'in_progress' then v_sla_minutes else null end,
    null,
    v_now,
    v_now
  )
  on conflict (reporter_email, client_request_id) where client_request_id is not null
  do nothing
  returning * into v_task;

  if not found then
    select * into v_task
    from tasks
    where reporter_email = v_actor
      and client_request_id = p_client_request_id
    for update;
    if not found then
      raise exception 'TASK_CREATE_REPLAY_NOT_FOUND';
    end if;
    task := to_jsonb(v_task);
    was_created := false;
    return next;
    return;
  end if;

  if array_length(v_assignees, 1) is not null then
    insert into task_assignees (task_id, email, created_at)
    select v_task.id, assignee_email, v_now
    from unnest(v_assignees) as assignee_email;

    insert into task_assignment_cycles (
      task_id, email, assigned_at, assigned_by_email, source
    )
    select v_task.id, assignee_email, v_now, v_actor, 'create'
    from unnest(v_assignees) as assignee_email;
  end if;

  v_started_at := case v_task.status
    when 'todo' then coalesce(v_task.todo_started_at, v_now)
    when 'in_progress' then coalesce(v_task.in_progress_at, v_now)
    when 'waiting' then coalesce(v_task.waiting_started_at, v_now)
    when 'billing' then coalesce(v_task.billing_started_at, v_now)
    when 'done' then coalesce(v_task.closed_at, v_now)
    when 'cancel' then coalesce(v_task.closed_at, v_now)
    else v_task.created_at
  end;
  insert into task_stage_cycles (
    task_id, stage, started_at, started_by_email, from_status,
    sla_minutes, due_at, meta
  ) values (
    v_task.id,
    v_task.status,
    v_started_at,
    v_actor,
    null,
    case when v_task.status = 'in_progress' then v_task.sla_minutes else null end,
    case when v_task.status = 'in_progress' and v_task.sla_minutes is not null
      then v_started_at + make_interval(mins => v_task.sla_minutes)
      else null end,
    jsonb_build_object('source', 'create')
  );

  insert into task_activity (task_id, actor_email, type, meta)
  values (
    v_task.id,
    v_actor,
    'created',
    case when array_length(v_assignees, 1) is not null
      then jsonb_build_object('assignees', to_jsonb(v_assignees))
      else null end
  );

  task := to_jsonb(v_task);
  was_created := true;
  return next;
end;
$$;

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
  overdue_at timestamptz;
  due_at timestamptz;
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
    billing_started_at = case when p_patch ? 'billing_started_at' then (p_patch->>'billing_started_at')::timestamptz else billing_started_at end,
    billing_reminded_at = case when p_patch ? 'billing_reminded_at' then (p_patch->>'billing_reminded_at')::timestamptz else billing_reminded_at end,
    billing_seconds = case when p_patch ? 'billing_seconds' then (p_patch->>'billing_seconds')::integer else billing_seconds end,
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
    due_at := (p_overdue->>'due_at')::timestamptz;
    resolved_at_value := (p_overdue->>'resolved_at')::timestamptz;
    overdue_seconds_value := greatest(0, round(extract(epoch from (resolved_at_value - due_at)))::integer);
    select id, overdue_at into open_overdue
    from task_overdue_events
    where task_id = p_task_id and resolved_at is null
    order by overdue_at desc
    limit 1
    for update;

    overdue_at := coalesce(open_overdue.overdue_at, target_task.overdue_flagged_at, due_at);
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
        due_at,
        overdue_at,
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
        when 'billing' then coalesce(target_task.billing_started_at, target_task.updated_at, target_task.created_at)
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
          and target_task.billing_started_at is null
          and coalesce(target_task.billing_seconds, 0) = 0
          then target_task.sla_minutes else null end,
        case when target_task.status = 'in_progress'
          and target_task.overdue_count = 0
          and target_task.waiting_started_at is null
          and coalesce(target_task.waiting_seconds, 0) = 0
          and target_task.billing_started_at is null
          and coalesce(target_task.billing_seconds, 0) = 0
          and target_task.sla_minutes is not null
          then old_started_at + make_interval(mins => target_task.sla_minutes) else null end,
        jsonb_build_object('source', 'fallback-close')
      );
    end if;

    next_started_at := case next_task.status
      when 'todo' then coalesce(next_task.todo_started_at, p_now)
      when 'in_progress' then coalesce(next_task.in_progress_at, p_now)
      when 'waiting' then coalesce(next_task.waiting_started_at, p_now)
      when 'billing' then coalesce(next_task.billing_started_at, p_now)
      when 'done' then coalesce(next_task.closed_at, p_now)
      when 'cancel' then coalesce(next_task.closed_at, p_now)
      else p_now
    end;
    -- Billing parks a task exactly the way Waiting does, so a task that has
    -- ever been parked no longer carries a meaningful single-stint due date.
    next_sla_active := next_task.status = 'in_progress'
      and target_task.overdue_count = 0
      and target_task.waiting_started_at is null
      and coalesce(target_task.waiting_seconds, 0) = 0
      and target_task.billing_started_at is null
      and coalesce(target_task.billing_seconds, 0) = 0;
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

-- ---------------------------------------------------------------------
-- Kiểm chứng — chạy hết rồi đọc bằng mắt
-- ---------------------------------------------------------------------

-- (a) Ba cột đồng hồ đã có mặt. Cả ba phải ra 1.
select
  count(*) filter (where column_name = 'billing_started_at') as co_started_at,
  count(*) filter (where column_name = 'billing_reminded_at') as co_reminded_at,
  count(*) filter (where column_name = 'billing_seconds') as co_seconds
from information_schema.columns
where table_schema = 'public' and table_name = 'tasks';

-- (b) Hai ràng buộc đã nhận 'billing' và VẪN CÒN 'cancel'.
--     Hai bảng, bốn cột true. Cột `con_cancel` là chốt chặn cho hiểu nhầm
--     "bỏ Cancel" — Cancel chỉ rời board chứ không rời database.
select
  rel.relname as bang,
  pg_get_constraintdef(con.oid) like '%billing%' as co_billing,
  pg_get_constraintdef(con.oid) like '%cancel%' as con_cancel
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
join pg_namespace nsp on nsp.oid = rel.relnamespace
where nsp.nspname = 'public'
  and con.conname in ('tasks_status_check', 'task_stage_cycles_stage_check');

-- (c) Chốt chặn cho đúng cái bẫy ở mục 3: thân hàm ĐANG CHẠY trên database có
--     thật sự nhận cột billing không. Cả hai dòng phải ra true.
--     Nếu patch_task_atomic ra false thì giờ Billing sẽ vĩnh viễn bằng 0 mà
--     không có một dòng lỗi nào báo cho biết.
--
--     Kỳ vọng khác nhau giữa hai hàm, nên không so cùng một điều kiện:
--       patch  — phải ghi được cả billing_started_at lẫn billing_seconds, và
--                phải có nhánh `when 'billing'` cho mốc bắt đầu stage.
--       create — chỉ cần nhận billing_started_at và chấp nhận status
--                'billing'. Nó KHÔNG ghi billing_seconds, và như vậy là đúng:
--                task vừa tạo thì thời gian tích luỹ phải là 0.
select
  p.proname as ham,
  case p.proname
    when 'patch_task_atomic' then
      pg_get_functiondef(p.oid) like '%billing_started_at =%'
      and pg_get_functiondef(p.oid) like '%billing_seconds =%'
      and pg_get_functiondef(p.oid) like '%when ''billing'' then%'
    when 'create_task_atomic' then
      pg_get_functiondef(p.oid) like '%billing_started_at%'
      and pg_get_functiondef(p.oid) like '%''billing''%'
  end as dat_yeu_cau
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('patch_task_atomic', 'create_task_atomic');

-- (d) Chưa task nào ở Billing — đúng như kỳ vọng ngay sau rollout.
select count(*) as task_dang_o_billing from tasks where status = 'billing';
