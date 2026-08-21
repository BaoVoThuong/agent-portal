-- Enrollment parity with the CS mutation/cache work:
--   * comment and attachment writes advance the parent optimistic token
--   * archive is CAS-protected for stale drawers
--   * comment delete is atomic and returns storage cleanup paths
--   * attachment uploads are idempotent across retries

alter table enrollment_attachments
  add column if not exists client_request_id uuid;

create unique index if not exists enrollment_attachments_request_key
  on enrollment_attachments (record_id, uploaded_by, client_request_id)
  where client_request_id is not null;

create table if not exists enrollment_comment_reactions (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references enrollment_comments(id) on delete cascade,
  reactor_email text not null
    constraint enrollment_comment_reactions_reactor_email_normalized
    check (
      reactor_email <> ''
      and reactor_email = lower(btrim(reactor_email))
    ),
  emoji text not null,
  created_at timestamptz not null default now(),
  unique (comment_id, reactor_email, emoji)
);

alter table enrollment_comment_reactions enable row level security;

create or replace function set_enrollment_comment_reaction_atomic(
  p_comment_id uuid,
  p_record_id uuid,
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
  if v_reactor_email = '' then raise exception 'INVALID_REACTOR_EMAIL'; end if;
  if coalesce(char_length(p_emoji), 0) < 1 or char_length(p_emoji) > 16 then
    raise exception 'INVALID_EMOJI';
  end if;
  select comment.id, comment.deleted_at into v_comment_id, v_deleted_at
  from enrollment_comments as comment
  where comment.id = p_comment_id and comment.record_id = p_record_id
  for update;
  if not found or v_deleted_at is not null then raise exception 'COMMENT_NOT_FOUND'; end if;
  if not exists (select 1 from enrollment_records where id = p_record_id) then
    raise exception 'ENROLLMENT_NOT_FOUND';
  end if;
  if p_present then
    insert into enrollment_comment_reactions (comment_id, reactor_email, emoji)
    values (p_comment_id, v_reactor_email, p_emoji)
    on conflict do nothing;
  else
    delete from enrollment_comment_reactions
    where comment_id = p_comment_id
      and reactor_email = v_reactor_email
      and emoji = p_emoji;
  end if;
  return query
  select reaction.comment_id, reaction.emoji, reaction.reactor_email
  from enrollment_comment_reactions as reaction
  where reaction.comment_id = p_comment_id
  order by reaction.created_at, reaction.id;
end;
$$;

revoke all on function set_enrollment_comment_reaction_atomic(uuid, uuid, text, text, boolean)
  from public, anon, authenticated;
grant execute on function set_enrollment_comment_reaction_atomic(uuid, uuid, text, text, boolean)
  to service_role;

create or replace function enrollment_comment_reactions_for_record(
  p_record_id uuid
) returns table (comment_id uuid, emoji text, reactor_email text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select reaction.comment_id, reaction.emoji, reaction.reactor_email
  from enrollment_comment_reactions as reaction
  join enrollment_comments as comment on comment.id = reaction.comment_id
  where comment.record_id = p_record_id and comment.deleted_at is null
  order by reaction.created_at, reaction.id;
$$;

revoke all on function enrollment_comment_reactions_for_record(uuid)
  from public, anon, authenticated;
grant execute on function enrollment_comment_reactions_for_record(uuid)
  to service_role;

create or replace function create_enrollment_comment_idempotent(
  p_record_id uuid,
  p_author_email text,
  p_body text,
  p_parent_id uuid,
  p_client_request_id uuid
) returns table (comment jsonb, parent_updated_at timestamptz, was_created boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_comment enrollment_comments%rowtype;
  v_record enrollment_records%rowtype;
  v_now timestamptz;
begin
  select * into v_record
  from enrollment_records
  where id = p_record_id
  for update;
  if not found then
    raise exception 'ENROLLMENT_NOT_FOUND';
  end if;

  if p_client_request_id is not null then
    select * into v_comment
    from enrollment_comments
    where record_id = p_record_id
      and author_email = p_author_email
      and client_request_id = p_client_request_id;
    if found then
      comment := to_jsonb(v_comment);
      parent_updated_at := v_record.updated_at;
      was_created := false;
      return next;
      return;
    end if;
  end if;

  if p_parent_id is not null then
    perform 1
    from enrollment_comments
    where id = p_parent_id
      and record_id = p_record_id
      and parent_id is null
      and deleted_at is null;
    if not found then
      raise exception 'INVALID_PARENT';
    end if;
  end if;

  insert into enrollment_comments (
    record_id, parent_id, author_email, body, client_request_id
  ) values (
    p_record_id, p_parent_id, p_author_email, p_body, p_client_request_id
  ) returning * into v_comment;

  v_now := greatest(clock_timestamp(), v_record.updated_at + interval '1 microsecond');
  update enrollment_records
  set updated_at = v_now,
      updated_by_email = p_author_email,
      last_activity_at = v_now,
      last_activity_by_email = p_author_email
  where id = p_record_id;

  comment := to_jsonb(v_comment);
  parent_updated_at := v_now;
  was_created := true;
  return next;
end;
$$;

revoke all on function create_enrollment_comment_idempotent(uuid, text, text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function create_enrollment_comment_idempotent(uuid, text, text, uuid, uuid)
  to service_role;

create or replace function enrollment_touch_activity(
  p_record_id uuid,
  p_actor_email text,
  p_now timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor text;
  v_updated_at timestamptz;
begin
  actor := enrollment_norm_email(p_actor_email);
  if actor is null or actor = 'system' then return; end if;
  select updated_at into v_updated_at
  from enrollment_records
  where id = p_record_id
  for update;
  if not found then return; end if;
  v_updated_at := greatest(clock_timestamp(), v_updated_at + interval '1 microsecond');
  update enrollment_records
  set updated_at = v_updated_at,
      updated_by_email = actor,
      last_activity_at = greatest(coalesce(last_activity_at, p_now), p_now),
      last_activity_by_email = case
        when last_activity_at is null or p_now >= last_activity_at then actor
        else last_activity_by_email
      end
  where id = p_record_id;
end;
$$;

create or replace function archive_enrollment_atomic(
  p_record_id uuid,
  p_actor_email text,
  p_expected_updated_at timestamptz,
  p_activity jsonb default '[]'::jsonb,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_record enrollment_records%rowtype;
  next_record enrollment_records%rowtype;
  actor text;
  v_now timestamptz;
begin
  actor := enrollment_norm_email(p_actor_email);
  if actor is null then raise exception 'ENROLLMENT_ACTOR_REQUIRED'; end if;
  if p_expected_updated_at is null then raise exception 'ENROLLMENT_CONFLICT'; end if;
  select * into target_record from enrollment_records where id = p_record_id for update;
  if not found then raise exception 'ENROLLMENT_NOT_FOUND'; end if;
  if target_record.updated_at <> p_expected_updated_at then
    raise exception 'ENROLLMENT_CONFLICT';
  end if;
  if target_record.archived_at is not null then return to_jsonb(target_record); end if;
  v_now := greatest(p_now, target_record.updated_at + interval '1 microsecond');
  update enrollment_records set
    archived_at = v_now,
    updated_at = v_now,
    updated_by_email = actor,
    last_work_activity_at = case when actor <> 'system' then v_now else last_work_activity_at end,
    last_activity_at = greatest(coalesce(last_activity_at, v_now), v_now),
    last_activity_by_email = case
      when last_activity_at is null or v_now >= last_activity_at then actor
      else last_activity_by_email
    end
  where id = p_record_id and updated_at = p_expected_updated_at
  returning * into next_record;
  if not found then raise exception 'ENROLLMENT_CONFLICT'; end if;
  perform enrollment_close_open_cycle_internal(p_record_id, actor, v_now, null, target_record.responsible_enroll_email);
  perform enrollment_write_activity_internal(p_record_id, actor, p_activity, v_now);
  return to_jsonb(next_record);
end;
$$;

revoke all on function archive_enrollment_atomic(uuid, text, timestamptz, jsonb, timestamptz)
  from public, anon, authenticated;
grant execute on function archive_enrollment_atomic(uuid, text, timestamptz, jsonb, timestamptz)
  to service_role;

create or replace function delete_enrollment_comment_atomic(
  p_comment_id uuid,
  p_record_id uuid,
  p_actor_email text
) returns table (
  storage_paths text[],
  attachment_count integer,
  parent_updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_record enrollment_records%rowtype;
  v_comment enrollment_comments%rowtype;
  v_paths text[];
  v_now timestamptz;
  v_actor text;
begin
  v_actor := enrollment_norm_email(p_actor_email);
  select * into v_record from enrollment_records where id = p_record_id for update;
  if not found then raise exception 'ENROLLMENT_NOT_FOUND'; end if;
  select * into v_comment
  from enrollment_comments
  where id = p_comment_id and record_id = p_record_id
  for update;
  if not found then raise exception 'COMMENT_NOT_FOUND'; end if;
  if enrollment_norm_email(v_comment.author_email) <> v_actor then
    raise exception 'FORBIDDEN';
  end if;
  if v_comment.deleted_at is not null then
    storage_paths := '{}';
    attachment_count := 0;
    parent_updated_at := v_record.updated_at;
    return next;
    return;
  end if;

  select coalesce(array_agg(storage_path order by created_at), '{}')
  into v_paths
  from enrollment_attachments
  where comment_id = p_comment_id;
  v_now := greatest(clock_timestamp(), v_record.updated_at + interval '1 microsecond');
  update enrollment_comments
  set body = '', deleted_at = v_now, updated_at = v_now
  where id = p_comment_id;
  delete from enrollment_attachments where comment_id = p_comment_id;
  insert into enrollment_activity (record_id, actor_email, type, meta)
  values (
    p_record_id,
    v_actor,
    'comment_deleted',
    jsonb_build_object('comment_id', p_comment_id,
      'attachment_count', coalesce(array_length(v_paths, 1), 0))
  );
  update enrollment_records
  set updated_at = v_now,
      updated_by_email = v_actor,
      last_activity_at = v_now,
      last_activity_by_email = v_actor
  where id = p_record_id;
  storage_paths := v_paths;
  attachment_count := coalesce(array_length(v_paths, 1), 0);
  parent_updated_at := v_now;
  return next;
end;
$$;

revoke all on function delete_enrollment_comment_atomic(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function delete_enrollment_comment_atomic(uuid, uuid, text)
  to service_role;
