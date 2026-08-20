-- 2026-08-20 — Emoji reactions on task comments.
--
-- Idempotent; safe to re-run. Run 2026-08-20-comment-reactions-test.sql after
-- this to prove the constraints and the soft-delete cleanup actually hold.
--
-- ── Two design points worth knowing before editing ──────────────────────────
--
-- 1. There is deliberately NO task_id column. The loader queries by the
--    comment ids it just fetched, so it would never be read, and an
--    independent foreign key to tasks cannot prove the reaction's comment
--    actually belongs to that task — two sources of truth for one
--    relationship, one of them unenforceable.
--
-- 2. There is deliberately NO separate comment_id index. The unique index
--    below already leads with comment_id and serves those lookups.

create table if not exists public.task_comment_reactions (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.task_comments(id) on delete cascade,
  reactor_email text not null
    constraint task_comment_reactions_reactor_email_normalized
    check (
      reactor_email <> ''
      and reactor_email = lower(btrim(reactor_email))
    ),
  emoji text not null,
  created_at timestamptz not null default now(),
  -- One reaction per person per emoji per comment. PUT relies on this via
  -- `on conflict do nothing`, which is what makes adding idempotent: a retry
  -- after a lost response re-adds rather than toggling the reaction off.
  unique (comment_id, reactor_email, emoji)
);

-- A previous revision may already have created this table without canonical
-- email enforcement. Clean it in a collision-safe order before adding the
-- named constraint, so this rollout stays safe to re-run.
delete from public.task_comment_reactions
where btrim(reactor_email) = '';

with ranked as (
  select
    id,
    row_number() over (
      partition by comment_id, lower(btrim(reactor_email)), emoji
      order by created_at, id
    ) as duplicate_number
  from public.task_comment_reactions
)
delete from public.task_comment_reactions as reaction
using ranked
where reaction.id = ranked.id
  and ranked.duplicate_number > 1;

update public.task_comment_reactions
set reactor_email = lower(btrim(reactor_email))
where reactor_email <> lower(btrim(reactor_email));

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.task_comment_reactions'::regclass
      and conname = 'task_comment_reactions_reactor_email_normalized'
  ) then
    alter table public.task_comment_reactions
      add constraint task_comment_reactions_reactor_email_normalized
      check (
        reactor_email <> ''
        and reactor_email = lower(btrim(reactor_email))
      );
  end if;
end $$;

alter table public.task_comment_reactions enable row level security;
revoke all on table public.task_comment_reactions
  from public, anon, authenticated;
grant all on table public.task_comment_reactions to service_role;

-- One transaction owns validation, mutation, and the returned canonical
-- snapshot. Locking the comment serializes this with soft-delete, which locks
-- the same row before clearing reactions.
create or replace function public.set_task_comment_reaction_atomic(
  p_comment_id uuid,
  p_task_id uuid,
  p_reactor_email text,
  p_emoji text,
  p_present boolean
) returns table (
  comment_id uuid,
  emoji text,
  reactor_email text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_comment_id uuid;
  v_deleted_at timestamptz;
  v_reactor_email text;
begin
  v_reactor_email := lower(btrim(coalesce(p_reactor_email, '')));
  if v_reactor_email = '' then
    raise exception 'INVALID_REACTOR_EMAIL';
  end if;
  if coalesce(char_length(p_emoji), 0) < 1 or char_length(p_emoji) > 16 then
    raise exception 'INVALID_EMOJI';
  end if;

  select comment.id, comment.deleted_at
  into v_comment_id, v_deleted_at
  from public.task_comments as comment
  where comment.id = p_comment_id
    and comment.task_id = p_task_id
  for update;
  if not found or v_deleted_at is not null then
    raise exception 'COMMENT_NOT_FOUND';
  end if;

  if p_present then
    insert into public.task_comment_reactions (
      comment_id,
      reactor_email,
      emoji
    ) values (
      p_comment_id,
      v_reactor_email,
      p_emoji
    )
    on conflict do nothing;
  else
    delete from public.task_comment_reactions as reaction
    where reaction.comment_id = p_comment_id
      and reaction.reactor_email = v_reactor_email
      and reaction.emoji = p_emoji;
  end if;

  return query
  select reaction.comment_id, reaction.emoji, reaction.reactor_email
  from public.task_comment_reactions as reaction
  where reaction.comment_id = p_comment_id
  order by reaction.created_at, reaction.id;
end;
$$;

revoke all on function public.set_task_comment_reaction_atomic(
  uuid, uuid, text, text, boolean
) from public, anon, authenticated;
grant execute on function public.set_task_comment_reaction_atomic(
  uuid, uuid, text, text, boolean
) to service_role;

-- Lightweight canonical read used after a content-free Realtime ping. This
-- avoids reloading comment bodies and re-signing every attachment URL for one
-- emoji tap.
create or replace function public.task_comment_reactions_for_task(
  p_task_id uuid
) returns table (
  comment_id uuid,
  emoji text,
  reactor_email text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select reaction.comment_id, reaction.emoji, reaction.reactor_email
  from public.task_comment_reactions as reaction
  join public.task_comments as comment
    on comment.id = reaction.comment_id
  where comment.task_id = p_task_id
    and comment.deleted_at is null
  order by reaction.created_at, reaction.id;
$$;

revoke all on function public.task_comment_reactions_for_task(uuid)
  from public, anon, authenticated;
grant execute on function public.task_comment_reactions_for_task(uuid)
  to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Comments are SOFT-deleted: delete_task_comment_atomic sets deleted_at and
-- blanks body, so the row survives and `on delete cascade` never fires. Left
-- alone, reaction rows leak forever — invisibly, because loadComments filters
-- on deleted_at and never shows them again.
--
-- Body below is the existing function verbatim plus one delete statement,
-- marked NEW. Signature and return shape are unchanged.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function delete_task_comment_atomic(
  p_comment_id uuid,
  p_task_id uuid,
  p_actor_email text
) returns table (storage_paths text[], attachment_count integer)
language plpgsql security definer set search_path = public as $$
declare
  v_task tasks%rowtype;
  v_row task_comments%rowtype;
  v_paths text[];
  v_now timestamptz;
begin
  select * into v_task from tasks where id = p_task_id for update;
  if not found then raise exception 'TASK_NOT_FOUND'; end if;
  select * into v_row
  from task_comments
  where id = p_comment_id and task_id = p_task_id
  for update;
  if not found then raise exception 'COMMENT_NOT_FOUND'; end if;
  if v_row.author_email <> p_actor_email then raise exception 'FORBIDDEN'; end if;

  if v_row.deleted_at is not null then
    storage_paths := '{}';
    attachment_count := 0;
    return next;
    return;
  end if;

  select coalesce(array_agg(storage_path order by created_at), '{}')
  into v_paths
  from task_attachments
  where comment_id = p_comment_id and deleted_at is null;

  v_now := greatest(clock_timestamp(), v_task.updated_at + interval '1 microsecond');
  update task_comments
  set deleted_at = v_now, body = ''
  where id = p_comment_id;
  update task_attachments
  set deleted_at = v_now
  where comment_id = p_comment_id and deleted_at is null;

  -- NEW: reactions have no meaning once the body is blanked, and the soft
  -- delete means the FK cascade will never collect them.
  delete from task_comment_reactions where comment_id = p_comment_id;

  insert into task_activity (task_id, actor_email, type, meta)
  values (
    p_task_id,
    p_actor_email,
    'comment_deleted',
    jsonb_build_object(
      'comment_id', p_comment_id,
      'attachment_count', coalesce(array_length(v_paths, 1), 0)
    )
  );

  update tasks
  set updated_at = v_now,
      last_activity_at = v_now,
      last_activity_by_email = p_actor_email,
      stale_reminded_at = null
  where id = p_task_id;

  storage_paths := v_paths;
  attachment_count := coalesce(array_length(v_paths, 1), 0);
  return next;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Install check. Supabase Studio never displays `raise notice`, so results
-- come back as a table. Expected: 6 rows, ok = true.
-- Behaviour is proved separately by the -test.sql companion.
-- ─────────────────────────────────────────────────────────────────────────────
select 'table  task_comment_reactions' as object,
       to_regclass('public.task_comment_reactions') is not null as ok
union all
select 'unique (comment_id, reactor_email, emoji)',
       exists (
         select 1
         from pg_indexes
         where schemaname = 'public'
           and tablename = 'task_comment_reactions'
           and indexdef ilike '%unique%'
           and indexdef ilike '%comment_id%'
           and indexdef ilike '%reactor_email%'
           and indexdef ilike '%emoji%'
       )
union all
select 'delete_task_comment_atomic cleans reactions',
       (
         select prosrc like '%delete from task_comment_reactions%'
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'delete_task_comment_atomic'
       )
union all
select 'reactor email is canonical',
       exists (
         select 1
         from pg_constraint
         where conrelid = 'public.task_comment_reactions'::regclass
           and conname = 'task_comment_reactions_reactor_email_normalized'
       )
union all
select 'atomic reaction mutation exists',
       to_regprocedure(
         'public.set_task_comment_reaction_atomic(uuid,uuid,text,text,boolean)'
       ) is not null
union all
select 'task reaction read exists',
       to_regprocedure(
         'public.task_comment_reactions_for_task(uuid)'
       ) is not null;
