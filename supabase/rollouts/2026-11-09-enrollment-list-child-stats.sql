-- Apply before deploying the matching application code.
-- Aggregate the list's comment and attachment stats in one PostgREST request.
create or replace function public.enrollment_list_child_stats(p_record_ids uuid[])
returns jsonb
language sql stable
security invoker
set search_path = public, pg_temp
as $$
  with comment_stats as (
    select record_id,
           count(*)::int as comment_count,
           string_agg(nullif(body, ''), ' ') as comment_search_text
    from enrollment_comments
    where record_id = any(p_record_ids) and deleted_at is null
    group by record_id
  ),
  attachment_stats as (
    select record_id, count(*)::int as attachment_count
    from enrollment_attachments
    where record_id = any(p_record_ids)
    group by record_id
  )
  select coalesce(jsonb_object_agg(
    coalesce(c.record_id, a.record_id),
    jsonb_build_object(
      'comment_count', coalesce(c.comment_count, 0),
      'attachment_count', coalesce(a.attachment_count, 0),
      'comment_search_text', coalesce(c.comment_search_text, '')
    )
  ), '{}'::jsonb)
  from comment_stats c
  full join attachment_stats a on a.record_id = c.record_id;
$$;

revoke all on function public.enrollment_list_child_stats(uuid[])
  from public, anon, authenticated;
grant execute on function public.enrollment_list_child_stats(uuid[])
  to service_role;
notify pgrst, 'reload schema';
