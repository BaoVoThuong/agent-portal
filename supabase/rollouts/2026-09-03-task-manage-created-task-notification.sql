-- =====================================================================
-- Notify every active holder of RBAC `task.manage` when a new task is created.
--
-- The app resolves recipients from role_permissions → user_roles, then writes
-- `task_created`. This rollout lets the database accept that notification type
-- while retaining the Due Date notification values already deployed.
-- =====================================================================

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'task_notifications_type_check'
      and conrelid = 'public.task_notifications'::regclass
  ) then
    alter table public.task_notifications
      drop constraint task_notifications_type_check;
  end if;

  alter table public.task_notifications
    add constraint task_notifications_type_check
    check (
      type in (
        'assigned',
        'mentioned',
        'commented',
        'reacted',
        'overdue',
        'todo_reminder',
        'overdue_reminder',
        'waiting_reminder',
        'unassigned',
        'reopened',
        'qc_needed',
        'due_soon',
        'stale',
        'overdue_unlocked',
        'qc_stale',
        'sla_escalated',
        'qc_reviewed',
        'cancelled',
        'attachment_added',
        'backlog_attention',
        'due_date_overdue',
        'due_date_overdue_reminder',
        'task_created'
      )
    ) not valid;
end $$;

-- Expected: `task_created` appears in the returned constraint definition.
select pg_get_constraintdef(oid) as task_notifications_type_constraint
from pg_constraint
where conname = 'task_notifications_type_check'
  and conrelid = 'public.task_notifications'::regclass;
