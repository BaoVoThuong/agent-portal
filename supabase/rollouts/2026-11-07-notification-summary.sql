-- Apply before deploying the matching app code. Polling the bell previously
-- opened nine concurrent PostgREST requests per user; this combines their
-- reads in one request and one pool connection.
create or replace function public.get_notification_summary(
  p_email text,
  p_unread_since timestamptz
) returns jsonb
language sql stable
security invoker
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'unread',
      (select count(*) from task_notifications
       where recipient_email = p_email and not is_read and created_at >= p_unread_since)
      + (select count(*) from enrollment_notifications
         where recipient_email = p_email and not is_read and created_at >= p_unread_since)
      + (select count(*) from time_off_notifications
         where recipient_email = p_email and not is_read and created_at >= p_unread_since)
      + (select count(*) from provider_notifications
         where recipient_email = p_email and not is_read and created_at >= p_unread_since),
    'assignedTaskIds',
      coalesce((select jsonb_agg(distinct task_id) from task_notifications
                where recipient_email = p_email and type = 'assigned'
                  and not is_read and created_at >= p_unread_since), '[]'::jsonb),
    'latestAt',
      (select max(created_at) from (
        (select created_at from task_notifications
         where recipient_email = p_email order by created_at desc limit 1)
        union all
        (select created_at from enrollment_notifications
         where recipient_email = p_email order by created_at desc limit 1)
        union all
        (select created_at from time_off_notifications
         where recipient_email = p_email order by created_at desc limit 1)
        union all
        (select created_at from provider_notifications
         where recipient_email = p_email order by created_at desc limit 1)
      ) latest)
  );
$$;

revoke all on function public.get_notification_summary(text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.get_notification_summary(text, timestamptz)
  to service_role;
notify pgrst, 'reload schema';
