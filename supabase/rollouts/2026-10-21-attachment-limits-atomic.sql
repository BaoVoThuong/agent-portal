-- Keep attachment limits atomic with metadata writes. Run before deploying the routes.
begin;

create or replace function create_task_attachment_atomic(
  p_task_id uuid,
  p_comment_id uuid,
  p_storage_path text,
  p_file_name text,
  p_mime_type text,
  p_size_bytes bigint,
  p_uploaded_by text,
  p_client_request_id uuid
) returns table (attachment jsonb, was_created boolean, replayed_path text)
language plpgsql security definer set search_path = public as $$
declare
  v_row task_attachments%rowtype;
  v_task tasks%rowtype;
  v_now timestamptz;
begin
  select * into v_task
  from tasks
  where id = p_task_id
  for update;
  if not found then raise exception 'TASK_NOT_FOUND'; end if;

  if p_client_request_id is not null then
    select * into v_row
    from task_attachments
    where task_id = p_task_id
      and uploaded_by = p_uploaded_by
      and client_request_id = p_client_request_id;
    if found then
      attachment := to_jsonb(v_row);
      was_created := false;
      replayed_path := v_row.storage_path;
      return next;
      return;
    end if;
  end if;

  -- The task row lock serializes concurrent finalizations. Check the limits
  -- here, after acquiring it, so two 50 MB uploads cannot both pass a stale
  -- application-side count and push the same attachment set over its cap.
  if p_size_bytes is null or p_size_bytes <= 0 or p_size_bytes > 52428800 then
    raise exception 'ATTACHMENT_FILE_LIMIT';
  end if;
  if (
    select coalesce(sum(size_bytes), 0) + p_size_bytes
    from task_attachments
    where task_id = p_task_id
      and comment_id is not distinct from p_comment_id
      and deleted_at is null
  ) > 262144000 then
    raise exception 'ATTACHMENT_AGGREGATE_LIMIT';
  end if;
  if (
    select count(*)
    from task_attachments
    where task_id = p_task_id
      and comment_id is not distinct from p_comment_id
      and deleted_at is null
  ) >= 50 then
    raise exception 'ATTACHMENT_COUNT_LIMIT';
  end if;

  if p_comment_id is not null then
    perform 1
    from task_comments
    where id = p_comment_id
      and task_id = p_task_id
      and deleted_at is null;
    if not found then raise exception 'INVALID_COMMENT'; end if;
  end if;

  insert into task_attachments (
    task_id, comment_id, storage_path, file_name, mime_type, size_bytes,
    uploaded_by, client_request_id
  ) values (
    p_task_id, p_comment_id, p_storage_path, p_file_name, p_mime_type,
    p_size_bytes, p_uploaded_by, p_client_request_id
  ) returning * into v_row;

  insert into task_activity (task_id, actor_email, type, meta)
  values (
    p_task_id,
    p_uploaded_by,
    'attachment_added',
    jsonb_build_object('attachment_id', v_row.id, 'comment_id', p_comment_id)
  );

  if p_comment_id is null then
    v_now := greatest(clock_timestamp(), v_task.updated_at + interval '1 microsecond');
    update tasks
    set updated_at = v_now,
        last_activity_at = v_now,
        last_activity_by_email = p_uploaded_by,
        stale_reminded_at = null
    where id = p_task_id;
  end if;

  attachment := to_jsonb(v_row);
  was_created := true;
  replayed_path := null;
  return next;
end;
$$;

revoke all on function create_task_attachment_atomic(uuid, uuid, text, text, text, bigint, text, uuid)
  from public, anon, authenticated;
grant execute on function create_task_attachment_atomic(uuid, uuid, text, text, text, bigint, text, uuid)
  to service_role;

create or replace function create_lead_attachment_atomic(
  p_lead_id uuid,
  p_storage_path text,
  p_file_name text,
  p_mime_type text,
  p_size_bytes bigint,
  p_uploaded_by text,
  p_client_request_id uuid
) returns table (attachment jsonb, was_created boolean, replayed_path text)
language plpgsql security definer set search_path = public as $$
declare v_row lead_attachments%rowtype;
begin
  perform 1 from leads
  where id = p_lead_id and archived_at is null
  for update;
  if not found then raise exception 'LEAD_NOT_FOUND'; end if;

  if p_client_request_id is not null then
    select * into v_row from lead_attachments
    where lead_id = p_lead_id
      and uploaded_by = p_uploaded_by
      and client_request_id = p_client_request_id;
    if found then
      attachment := to_jsonb(v_row);
      was_created := false;
      replayed_path := v_row.storage_path;
      return next;
      return;
    end if;
  end if;

  if p_size_bytes is null or p_size_bytes <= 0 or p_size_bytes > 52428800 then
    raise exception 'ATTACHMENT_FILE_LIMIT';
  end if;
  if (select count(*) from lead_attachments where lead_id = p_lead_id) >= 50 then
    raise exception 'LEAD_ATTACHMENT_COUNT_LIMIT';
  end if;

  insert into lead_attachments (
    lead_id, storage_path, file_name, mime_type, size_bytes,
    uploaded_by, client_request_id
  ) values (
    p_lead_id, p_storage_path, p_file_name, p_mime_type, p_size_bytes,
    p_uploaded_by, p_client_request_id
  ) returning * into v_row;

  attachment := to_jsonb(v_row);
  was_created := true;
  replayed_path := null;
  return next;
end;
$$;

revoke all on function create_lead_attachment_atomic(uuid, text, text, text, bigint, text, uuid)
  from public, anon, authenticated;
grant execute on function create_lead_attachment_atomic(uuid, text, text, text, bigint, text, uuid)
  to service_role;

commit;
notify pgrst, 'reload schema';
