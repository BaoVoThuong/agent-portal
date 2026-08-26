-- Comment review fixes: do not leave reactions attached to soft-deleted
-- Enrollment comments. The original delete function was already deployed, so
-- this is a forward-only replacement migration.

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
  select * into v_record
  from enrollment_records
  where id = p_record_id
  for update;
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
  delete from enrollment_comment_reactions where comment_id = p_comment_id;

  insert into enrollment_activity (record_id, actor_email, type, meta)
  values (
    p_record_id,
    v_actor,
    'comment_deleted',
    jsonb_build_object(
      'comment_id', p_comment_id,
      'attachment_count', coalesce(array_length(v_paths, 1), 0)
    )
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
