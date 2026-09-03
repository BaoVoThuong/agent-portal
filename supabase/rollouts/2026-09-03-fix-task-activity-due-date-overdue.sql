-- =====================================================================
-- Fix: Due Date overdue cron writes `due_date_overdue` to task_activity.
--
-- The initial Due Date rollout added the RPC and notification constraint,
-- but an older production `task_activity_type_check` did not yet allow this
-- activity type. The RPC therefore rolled back and made the whole reminder
-- cron return HTTP 500 whenever it found an overdue Due Date task.
--
-- Safe to rerun. Keep NOT VALID so historical activity rows are not scanned
-- or rejected while replacing the vocabulary constraint.
-- =====================================================================

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'task_activity_type_check'
      and conrelid = 'public.task_activity'::regclass
  ) then
    alter table public.task_activity
      drop constraint task_activity_type_check;
  end if;

  alter table public.task_activity
    add constraint task_activity_type_check
    check (
      type in (
        'created',
        'assigned',
        'unassigned',
        'status_changed',
        'reopened',
        'task_reopened',
        'priority_changed',
        'category_changed',
        'agent_changed',
        'done_reviewed',
        'done_review_cleared',
        'edited',
        'comment_added',
        'comment_edited',
        'comment_deleted',
        'attachment_added',
        'attachment_deleted',
        'went_overdue',
        'overdue_unlocked',
        'due_date_overdue'
      )
    ) not valid;
end $$;

-- Expected: `due_date_overdue` is present.
select pg_get_constraintdef(oid) as task_activity_type_constraint
from pg_constraint
where conname = 'task_activity_type_check'
  and conrelid = 'public.task_activity'::regclass;
