-- Allow the enrollment notification bell to announce newly created records.
-- task.manage recipients receive this for ACA, Medicare and Medicaid creation.
do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.enrollment_notifications'::regclass
      and conname = 'enrollment_notifications_type_check'
  ) then
    alter table public.enrollment_notifications
      drop constraint enrollment_notifications_type_check;
  end if;

  alter table public.enrollment_notifications
    add constraint enrollment_notifications_type_check
    check (
      type in (
        'record_created',
        'assigned',
        'mentioned',
        'commented',
        'reacted',
        'due_soon',
        'overdue',
        'overdue_reminder',
        'qc_needed',
        'qc_stale',
        'reopened',
        'stage_changed',
        'qc_reviewed',
        'attachment_added'
      )
    ) not valid;
end $$;

alter table public.enrollment_notifications
  validate constraint enrollment_notifications_type_check;

select pg_get_constraintdef(oid) as enrollment_notifications_type_constraint
from pg_constraint
where conname = 'enrollment_notifications_type_check'
  and conrelid = 'public.enrollment_notifications'::regclass;
