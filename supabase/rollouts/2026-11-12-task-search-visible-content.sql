-- Search only tasks the viewer can read. Apply visibility before LIMIT so
-- thousands of hidden matches cannot bury the first visible result.
-- Deploy this additive function before the application version that calls it.
-- The service role is the only caller; Next.js verifies task.work/task.manage
-- and resolves p_sees_all/p_agent_emails before invoking it.

create or replace function public.search_visible_task_content(
  p_email text,
  p_agent_emails text[],
  p_sees_all boolean,
  p_pattern text
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with task_hits as (
    select t.id, t.display_number, t.title, t.agent_email, t.status, t.updated_at
    from public.tasks t
    where nullif(btrim(p_email), '') is not null
      and t.archived_at is null
      and t.title ilike p_pattern
      and (
        coalesce(p_sees_all, false)
        or t.assignee_email = p_email
        or t.agent_email = p_email
        or t.reporter_email = p_email
        or t.agent_email = any(coalesce(p_agent_emails, '{}'::text[]))
        or exists (
          select 1 from public.task_assignees a
          where a.task_id = t.id and a.email = p_email
        )
        or exists (
          select 1 from public.task_participants p
          where p.task_id = t.id and p.email = p_email
        )
      )
    order by t.updated_at desc, t.id desc
    limit 7
  ), comment_hits as (
    select c.id as comment_id, c.task_id, t.title as task_title,
           c.body, c.author_email, c.created_at
    from public.task_comments c
    join public.tasks t on t.id = c.task_id
    where nullif(btrim(p_email), '') is not null
      and c.deleted_at is null
      and t.archived_at is null
      and c.body ilike p_pattern
      and (
        coalesce(p_sees_all, false)
        or t.assignee_email = p_email
        or t.agent_email = p_email
        or t.reporter_email = p_email
        or t.agent_email = any(coalesce(p_agent_emails, '{}'::text[]))
        or exists (
          select 1 from public.task_assignees a
          where a.task_id = t.id and a.email = p_email
        )
        or exists (
          select 1 from public.task_participants p
          where p.task_id = t.id and p.email = p_email
        )
      )
    order by c.created_at desc, c.id desc
    limit 7
  ), file_hits as (
    select f.id as attachment_id, f.task_id, t.title as task_title,
           f.comment_id, f.file_name, f.created_at
    from public.task_attachments f
    join public.tasks t on t.id = f.task_id
    where nullif(btrim(p_email), '') is not null
      and f.deleted_at is null
      and t.archived_at is null
      and f.file_name ilike p_pattern
      and (
        coalesce(p_sees_all, false)
        or t.assignee_email = p_email
        or t.agent_email = p_email
        or t.reporter_email = p_email
        or t.agent_email = any(coalesce(p_agent_emails, '{}'::text[]))
        or exists (
          select 1 from public.task_assignees a
          where a.task_id = t.id and a.email = p_email
        )
        or exists (
          select 1 from public.task_participants p
          where p.task_id = t.id and p.email = p_email
        )
      )
    order by f.created_at desc, f.id desc
    limit 7
  )
  select jsonb_build_object(
    'tasks', coalesce((
      select jsonb_agg(to_jsonb(h) - 'updated_at' order by h.updated_at desc, h.id desc)
      from task_hits h
    ), '[]'::jsonb),
    'comments', coalesce((
      select jsonb_agg(to_jsonb(h) order by h.created_at desc, h.comment_id desc)
      from comment_hits h
    ), '[]'::jsonb),
    'files', coalesce((
      select jsonb_agg(to_jsonb(h) - 'created_at' order by h.created_at desc, h.attachment_id desc)
      from file_hits h
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.search_visible_task_content(text, text[], boolean, text)
  from public, anon, authenticated;
grant execute on function public.search_visible_task_content(text, text[], boolean, text)
  to service_role;

notify pgrst, 'reload schema';
