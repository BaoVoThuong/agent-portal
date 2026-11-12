-- Run only against an isolated database after the rollout function is loaded.
-- This fixture deliberately has 1,200 newer hidden title matches before
-- the first visible hit. It also has a seventh visible hit for overflow.

insert into public.tasks (
  id, display_number, title, agent_email, assignee_email,
  reporter_email, status, updated_at, archived_at
)
select (
  '00000000-0000-0000-0000-' || lpad(i::text, 12, '0')
)::uuid, i, 'invoice ' || i, 'other@example.com',
  'other@example.com', 'other@example.com', 'todo',
  '2026-11-12T12:00:00Z'::timestamptz - i * interval '1 second', null
from generate_series(1, 1207) as i;

update public.tasks set assignee_email = 'cs@example.com'
where display_number = 1201;
update public.tasks set agent_email = 'cs@example.com'
where display_number = 1202;
update public.tasks set reporter_email = 'cs@example.com'
where display_number = 1203;
insert into public.task_assignees (task_id, email)
select id, 'cs@example.com' from public.tasks where display_number = 1204;
insert into public.task_participants (task_id, email)
select id, 'cs@example.com' from public.tasks where display_number = 1205;
update public.tasks set agent_email = 'agent@example.com'
where display_number in (1206, 1207);

insert into public.task_comments (id, task_id, body, author_email, created_at, deleted_at)
select gen_random_uuid(), id, 'invoice comment', 'writer@example.com', updated_at, null
from public.tasks where display_number <= 1200 or display_number = 1207;
insert into public.task_attachments (id, task_id, comment_id, file_name, created_at, deleted_at)
select gen_random_uuid(), id, null, 'invoice.pdf', updated_at, null
from public.tasks where display_number <= 1200 or display_number = 1207;

do $$
declare
  scoped jsonb;
  company jsonb;
  outsider jsonb;
begin
  scoped := public.search_visible_task_content(
    'cs@example.com', array['agent@example.com'], false, '%invoice%'
  );
  if jsonb_array_length(scoped->'tasks') <> 7
     or not exists (
       select 1 from jsonb_array_elements(scoped->'tasks') as hit
       where hit->>'display_number' = '1201'
     ) then
    raise exception 'Visible task after 1,200 hidden matches was not returned: %', scoped->'tasks';
  end if;
  if jsonb_array_length(scoped->'comments') <> 1
     or jsonb_array_length(scoped->'files') <> 1
     or scoped->'comments'->0->>'task_id' <> (
       select id::text from public.tasks where display_number = 1207
     )
     or scoped->'files'->0->>'task_id' <> (
       select id::text from public.tasks where display_number = 1207
     ) then
    raise exception 'Comment/file visibility differs from task visibility: %', scoped;
  end if;

  company := public.search_visible_task_content(
    'cs@example.com', '{}'::text[], true, '%invoice%'
  );
  if jsonb_array_length(company->'tasks') <> 7 then
    raise exception 'Company-wide scope failed';
  end if;

  outsider := public.search_visible_task_content(
    'outsider@example.com', '{}'::text[], false, '%invoice%'
  );
  if jsonb_array_length(outsider->'tasks') <> 0
     or jsonb_array_length(outsider->'comments') <> 0
     or jsonb_array_length(outsider->'files') <> 0 then
    raise exception 'Out-of-scope rows were returned: %', outsider;
  end if;

  if has_function_privilege(
    'anon', 'public.search_visible_task_content(text,text[],boolean,text)', 'EXECUTE'
  ) or has_function_privilege(
    'authenticated', 'public.search_visible_task_content(text,text[],boolean,text)', 'EXECUTE'
  ) then
    raise exception 'Search RPC is executable outside service_role';
  end if;
  if not has_function_privilege(
    'service_role', 'public.search_visible_task_content(text,text[],boolean,text)', 'EXECUTE'
  ) then
    raise exception 'Search RPC is not executable by service_role';
  end if;
end;
$$;
