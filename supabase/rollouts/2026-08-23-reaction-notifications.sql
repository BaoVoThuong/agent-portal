-- 2026-08-23 — Notify only the author of a comment when a new reaction is added.
--
-- The reaction RPCs return `changed` so the API can distinguish a real insert
-- from an idempotent retry. This keeps notification creation race-safe without
-- a separate read-before-write query.

alter table public.task_notifications
  add column if not exists detail text;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.task_notifications'::regclass
      and conname = 'task_notifications_type_check'
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
        'backlog_attention'
      )
    );
end $$;

alter table public.enrollment_notifications
  add column if not exists detail text;

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
    );
end $$;

drop function if exists public.set_task_comment_reaction_atomic(
  uuid, uuid, text, text, boolean
);

create function public.set_task_comment_reaction_atomic(
  p_comment_id uuid,
  p_task_id uuid,
  p_reactor_email text,
  p_emoji text,
  p_present boolean
) returns table (
  comment_id uuid,
  emoji text,
  reactor_email text,
  changed boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_comment_id uuid;
  v_deleted_at timestamptz;
  v_reactor_email text;
  v_changed boolean := false;
  v_row_count integer := 0;
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
    insert into public.task_comment_reactions (comment_id, reactor_email, emoji)
    values (p_comment_id, v_reactor_email, p_emoji)
    on conflict do nothing;
    get diagnostics v_row_count = row_count;
    v_changed := v_row_count > 0;
  else
    delete from public.task_comment_reactions as reaction
    where reaction.comment_id = p_comment_id
      and reaction.reactor_email = v_reactor_email
      and reaction.emoji = p_emoji;
    get diagnostics v_row_count = row_count;
    v_changed := v_row_count > 0;
  end if;

  return query
  select reaction.comment_id, reaction.emoji, reaction.reactor_email, v_changed
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

drop function if exists public.set_enrollment_comment_reaction_atomic(
  uuid, uuid, text, text, boolean
);

create function public.set_enrollment_comment_reaction_atomic(
  p_comment_id uuid,
  p_record_id uuid,
  p_reactor_email text,
  p_emoji text,
  p_present boolean
) returns table (
  comment_id uuid,
  emoji text,
  reactor_email text,
  changed boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_comment_id uuid;
  v_deleted_at timestamptz;
  v_reactor_email text;
  v_changed boolean := false;
  v_row_count integer := 0;
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
  from public.enrollment_comments as comment
  where comment.id = p_comment_id
    and comment.record_id = p_record_id
  for update;
  if not found or v_deleted_at is not null then
    raise exception 'COMMENT_NOT_FOUND';
  end if;

  if not exists (
    select 1 from public.enrollment_records where id = p_record_id
  ) then
    raise exception 'ENROLLMENT_NOT_FOUND';
  end if;

  if p_present then
    insert into public.enrollment_comment_reactions (comment_id, reactor_email, emoji)
    values (p_comment_id, v_reactor_email, p_emoji)
    on conflict do nothing;
    get diagnostics v_row_count = row_count;
    v_changed := v_row_count > 0;
  else
    delete from public.enrollment_comment_reactions as reaction
    where reaction.comment_id = p_comment_id
      and reaction.reactor_email = v_reactor_email
      and reaction.emoji = p_emoji;
    get diagnostics v_row_count = row_count;
    v_changed := v_row_count > 0;
  end if;

  return query
  select reaction.comment_id, reaction.emoji, reaction.reactor_email, v_changed
  from public.enrollment_comment_reactions as reaction
  where reaction.comment_id = p_comment_id
  order by reaction.created_at, reaction.id;
end;
$$;

revoke all on function public.set_enrollment_comment_reaction_atomic(
  uuid, uuid, text, text, boolean
) from public, anon, authenticated;
grant execute on function public.set_enrollment_comment_reaction_atomic(
  uuid, uuid, text, text, boolean
) to service_role;
