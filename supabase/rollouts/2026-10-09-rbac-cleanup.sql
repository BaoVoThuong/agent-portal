-- =====================================================================
-- Dọn RBAC (2026-10-09): phân quyền chỉ theo ô tick.
-- Plan: docs/superpowers/plans/2026-10-09-remove-hardcoded-values.md (P1)
--
--  1. Dừng nếu cột cũ portal_account.role và role Admin lệch nhau.
--  2. Quyền mới customer_registration.view_all (tách khỏi company.view_all của
--     Dashboard), cấp cho đúng role đang xem được mọi agent ở Registration.
--  3. Manage bao gồm Work: bỏ task.work / lead.work ở mọi role đã có Manage,
--     gồm cả Admin Health Task. Nhóm CS được sửa ở rollout tiếp theo để manager
--     vẫn làm CS, ngoại trừ role Admin cố định.
--  4. Admin giữ lead.manage (bỏ đường tắt "admin là lead manager").
--     4b. Cấp lead.work cho role Linh Le và Admin Health Task (giữ lead họ đang làm).
--  5. Mô tả quyền khớp thực tế.
--  6. Role mặc định theo cột roles.is_default (Agent), không theo tên.
--  7. assign_unassigned_task: bỏ so tên role và cột cũ; thu quyền gọi của
--     anon / authenticated (hàm SECURITY DEFINER, app gọi bằng service role).
--
-- Chạy TRƯỚC khi deploy code, rồi chờ >= 5 phút (JWT tự nạp lại quyền mỗi 5
-- phút). Chạy một lần: guard 1b cố ý từ chối chạy lại sau khi hàm đã đổi.
-- =====================================================================
begin;

-- 1. Cột cũ và role Admin phải khớp nhau.
do $guard$
declare mismatched integer;
begin
  select count(*) into mismatched
  from portal_account a
  where a.is_active
    and (a.role = 'admin') <> exists (
      select 1 from user_roles ur join roles r on r.id = ur.role_id
      where ur.user_id = a.id and r.is_active and r.name = 'Admin');
  if mismatched > 0 then
    raise exception 'ROLLOUT_ABORTED: % active account(s) disagree between portal_account.role and the Admin role', mismatched;
  end if;
end $guard$;

-- 1b. Hàm assign_unassigned_task trên production phải đúng bản trong schema.sql,
--     nếu không thì DỪNG (tránh ghi đè một bản đã sửa tay mà repo không biết).
do $guard$
declare live_md5 text;
begin
  select md5(p.prosrc) into live_md5
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'assign_unassigned_task';
  if live_md5 is distinct from '3212dfb6066b7cc473269dbe03b1c25d' then
    raise exception 'ROLLOUT_ABORTED: live assign_unassigned_task differs from schema.sql (md5 %); compare before running', live_md5;
  end if;
end $guard$;

-- 2. Registration - View All Agents.
insert into permissions (key, label, description, group_key, group_label, sort_order)
values ('customer_registration.view_all', 'Registration - View All Agents',
        'See every agent''s entries in Health and P&C Customer Registration.',
        'customer_registration', 'Customer Registration', 300)
on conflict (key) do update set
  label = excluded.label, description = excluded.description,
  group_key = excluded.group_key, group_label = excluded.group_label,
  sort_order = excluded.sort_order;

insert into role_permissions (role_id, permission_key)
select distinct v.role_id, 'customer_registration.view_all'
from role_permissions v
where v.permission_key = 'company.view_all'
  and exists (select 1 from role_permissions x
              where x.role_id = v.role_id
                and x.permission_key in ('customer_registration.health', 'customer_registration.pc'))
on conflict (role_id, permission_key) do nothing;

-- Admin luôn đủ quyền (role cố định, chỉ xem trong Role Manager).
insert into role_permissions (role_id, permission_key)
select r.id, 'customer_registration.view_all' from roles r where r.name = 'Admin'
on conflict (role_id, permission_key) do nothing;

-- 3. Manage bao gồm Work.
delete from role_permissions w
where w.permission_key = 'task.work'
  and exists (select 1 from role_permissions m where m.role_id = w.role_id and m.permission_key = 'task.manage');
delete from role_permissions w
where w.permission_key = 'lead.work'
  and exists (select 1 from role_permissions m where m.role_id = w.role_id and m.permission_key = 'lead.manage');

-- 4. Admin giữ lead.manage.
insert into role_permissions (role_id, permission_key)
select r.id, 'lead.manage' from roles r where r.name = 'Admin'
on conflict (role_id, permission_key) do nothing;

-- 4b. Giữ quyền làm lead cho người đang làm lead nhờ quyền chéo task.manage
--     (user chốt 2026-10-10). Linh Le đang được giao 9 lead mở; Kay Huynh (role
--     Admin Health Task) là Assistant của Khang Nguyen, người có 10 lead mở.
--     Với lead.work họ vẫn xem / làm lead của mình và của Agent mình phụ; chỉ
--     mất "xem mọi lead" + tab Overview Lead. Không ảnh hưởng chia lead tự động
--     (roster = task_agents + trọng số, không theo lead.work).
insert into role_permissions (role_id, permission_key)
select r.id, 'lead.work'
from roles r
where r.name in ('Linh Le', 'Admin Health Task')
  and not exists (select 1 from role_permissions m where m.role_id = r.id and m.permission_key = 'lead.manage')
on conflict (role_id, permission_key) do nothing;

-- 5. Mô tả quyền (khớp PERMISSION_DEFINITIONS trong src/lib/rbac/permissions.ts).
update permissions set description = 'Full control of Health CS tasks and Enrollment: every record, the backlog, create, assign, delete, CS Overview, SLA and table configuration. Includes Tasks - Work.' where key = 'task.manage';
update permissions set description = 'Work on Health CS tasks and Enrollment records you are part of. Puts you in the CS assignment pool.' where key = 'task.work';
update permissions set description = 'Export the Health CS task and Enrollment tables to Excel.' where key = 'task.export';
update permissions set description = 'Import Enrollment tables from Excel. Separate from Export because it overwrites rows in bulk.' where key = 'task.import';
update permissions set description = 'Import, assign and manage every lead, Lead settings and the Lead table configuration. Includes Work Leads.' where key = 'lead.manage';
update permissions set description = 'See all agents'' data in the Agent Dashboard.' where key = 'company.view_all';
update permissions set description = 'Create accounts, assign roles, update status, reset passwords, and manage Agents and Assistants.' where key = 'management.account_manager';

-- 6. Role mặc định theo cột.
alter table roles add column if not exists is_default boolean not null default false;
create unique index if not exists roles_single_default_idx on roles (is_default) where is_default;
update roles set is_default = true
where name = 'Agent' and not exists (select 1 from roles where is_default);

-- 7. assign_unassigned_task: bỏ `account.role <> 'admin'` và khối so tên
--    ('Admin', 'Super Admin'). Admin không còn task.work nên vẫn bị loại.
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

revoke all on function assign_unassigned_task(uuid, text, timestamptz, text) from public, anon, authenticated;
grant execute on function assign_unassigned_task(uuid, text, timestamptz, text) to service_role;

commit;

-- ---------------------------------------------------------------------
-- Kiểm chứng
-- ---------------------------------------------------------------------
-- a) Không role nào có cả manage và work của cùng module (0 dòng).
select r.name
from roles r
where exists (select 1 from role_permissions a where a.role_id = r.id and a.permission_key = 'task.manage')
  and exists (select 1 from role_permissions b where b.role_id = r.id and b.permission_key = 'task.work')
union all
select r.name
from roles r
where exists (select 1 from role_permissions a where a.role_id = r.id and a.permission_key = 'lead.manage')
  and exists (select 1 from role_permissions b where b.role_id = r.id and b.permission_key = 'lead.work');

-- b) Ai có Registration - View All Agents.
select r.name from role_permissions rp join roles r on r.id = rp.role_id
where rp.permission_key = 'customer_registration.view_all' order by r.name;

-- c) Role mặc định: Agent.
select name, is_default from roles where is_default;

-- d) Admin toàn quyền: quyền nào Admin còn THIẾU (0 dòng; Work đã gồm trong Manage).
select p.key as admin_missing
from permissions p
where p.key not in ('task.work', 'lead.work')
  and not exists (select 1 from role_permissions rp join roles r on r.id = rp.role_id
                  where r.name = 'Admin' and rp.permission_key = p.key);

-- e) Chỉ service_role (và chủ hàm) được gọi assign_unassigned_task.
select grantee, privilege_type from information_schema.routine_privileges
where routine_schema = 'public' and routine_name = 'assign_unassigned_task';

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- ROLLBACK hàm (chỉ khi cần) — bản cũ y như schema.sql trước 2026-10-09:
-- ---------------------------------------------------------------------
-- create or replace function assign_unassigned_task(
--   p_task_id uuid,
--   p_cs_email text,
--   p_expected_updated_at timestamptz,
--   p_actor_email text
-- )
-- returns jsonb
-- language plpgsql
-- security definer
-- set search_path = public
-- as $$
-- declare
--   target_task tasks%rowtype;
--   normalized_cs_email text := lower(trim(p_cs_email));
--   now_iso timestamptz := now();
--   rotation_minutes integer;
-- begin
--   if not exists (
--     select 1
--     from portal_account account
--     where lower(trim(account.email)) = normalized_cs_email
--       and account.is_active
--       and account.role <> 'admin'
--       and exists (
--         select 1
--         from user_roles ur
--         join role_permissions rp on rp.role_id = ur.role_id
--         join roles r on r.id = ur.role_id
--         where ur.user_id = account.id
--           and rp.permission_key = 'task.work'
--           and r.is_active
--       )
--       and not exists (
--         select 1 from task_agents ta
--         where lower(trim(ta.email)) = normalized_cs_email
--       )
--       and not exists (
--         select 1 from agent_members am
--         where lower(trim(am.cs_email)) = normalized_cs_email
--           and am.is_assistant
--       )
--       and not exists (
--         select 1 from task_assignment_queue_members queue_member
--         where lower(trim(queue_member.email)) = normalized_cs_email
--           and not queue_member.is_enabled
--       )
--       and not exists (
--         select 1
--         from user_roles ur
--         join roles r on r.id = ur.role_id
--         where ur.user_id = account.id
--           and r.is_active
--           and r.name in ('Admin', 'Super Admin')
--       )
--   ) then
--     raise exception 'INVALID_CS';
--   end if;
--
--   select * into target_task
--   from tasks
--   where id = p_task_id
--   for update;
--
--   if not found then
--     raise exception 'TASK_NOT_FOUND';
--   end if;
--
--   if p_expected_updated_at is not null
--     and target_task.updated_at <> p_expected_updated_at then
--     raise exception 'ASSIGN_CONFLICT';
--   end if;
--
--   if target_task.status <> 'backlog'
--     or target_task.assignee_email is not null
--     or exists (select 1 from task_assignees ta where ta.task_id = p_task_id) then
--     raise exception 'ASSIGN_CONFLICT';
--   end if;
--
--   update tasks
--   set status = 'todo',
--       assignee_email = normalized_cs_email,
--       todo_started_at = now_iso,
--       todo_reminded_at = null,
--       updated_at = now_iso,
--       last_activity_at = now_iso,
--       last_activity_by_email = p_actor_email,
--       stale_reminded_at = null
--   where id = p_task_id;
--
--   insert into task_assignees (task_id, email, created_at)
--   values (p_task_id, normalized_cs_email, now_iso);
--
--   insert into task_assignment_cycles (
--     task_id, email, assigned_at, assigned_by_email, source
--   ) values (
--     p_task_id, normalized_cs_email, now_iso, p_actor_email, 'overview'
--   );
--
--   update task_stage_cycles
--   set ended_at = now_iso,
--       duration_seconds = greatest(0, extract(epoch from (now_iso - started_at))::integer),
--       ended_by_email = p_actor_email,
--       to_status = 'todo'
--   where task_id = p_task_id
--     and ended_at is null;
--
--   insert into task_stage_cycles (
--     task_id, stage, started_at, started_by_email, from_status, sla_minutes, due_at, meta
--   ) values (
--     p_task_id, 'todo', now_iso, p_actor_email, 'backlog', null, null,
--     jsonb_build_object('source', 'overview')
--   );
--
--   insert into task_activity (task_id, actor_email, type, meta)
--   values (
--     p_task_id, p_actor_email, 'assigned',
--     jsonb_build_object('to', normalized_cs_email, 'source', 'overview')
--   );
--
--   select coalesce(
--     target_task.sla_minutes,
--     (
--       select rule.duration_minutes
--       from task_sla_rules rule
--       where rule.priority = target_task.priority
--         and rule.category_id = target_task.category_id
--       limit 1
--     ),
--     (
--       select rule.duration_minutes
--       from task_sla_rules rule
--       where rule.priority = target_task.priority
--         and rule.category_id is null
--       limit 1
--     ),
--     case target_task.priority
--       when 'urgent' then 60
--       when 'high' then 240
--       when 'medium' then 480
--       else 1440
--     end
--   ) into rotation_minutes;
--
--   perform bump_task_assignment_rotation(
--     normalized_cs_email,
--     rotation_minutes,
--     now_iso
--   );
--
--   return jsonb_build_object(
--     'task_id', p_task_id,
--     'email', normalized_cs_email,
--     'updated_at', now_iso
--   );
-- end;
-- $$;
