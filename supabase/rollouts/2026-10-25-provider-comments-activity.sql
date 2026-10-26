-- Provider List: Comments + Activity + thông báo @mention (2026-10-25).
--
-- Cùng khuôn với enrollment_comments / enrollment_activity nhưng KHÔNG có đính
-- kèm (user chốt 25/10). Bảng riêng, không nhồi vào bảng của Task/Enrollment:
-- dùng chung giao diện CommentThread nhưng dữ liệu ba module không được lẫn.
--
-- Chỉ người có Provider List - Manage được viết (kiểm ở API); ai xem được
-- Provider List thì đọc được. Mọi hàm chỉ cấp cho service_role.
--
-- An toàn khi chạy lại: mọi lệnh đều `if not exists` / `create or replace`.

begin;

create table if not exists provider_comments (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references provider_directory(id) on delete cascade,
  parent_id uuid references provider_comments(id) on delete cascade,
  author_email text not null,
  body text not null,
  client_request_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index if not exists provider_comments_client_request_id_key
  on provider_comments (provider_id, author_email, client_request_id)
  where client_request_id is not null;

create index if not exists provider_comments_provider_idx
  on provider_comments (provider_id, created_at);

create table if not exists provider_comment_edits (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references provider_comments(id) on delete cascade,
  previous_body text not null,
  edited_by text not null,
  edited_at timestamptz not null default now()
);

create index if not exists provider_comment_edits_comment_idx
  on provider_comment_edits (comment_id, edited_at desc);

create table if not exists provider_comment_reactions (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references provider_comments(id) on delete cascade,
  reactor_email text not null
    constraint provider_comment_reactions_reactor_email_normalized
    check (
      reactor_email <> ''
      and reactor_email = lower(btrim(reactor_email))
    ),
  emoji text not null,
  created_at timestamptz not null default now(),
  unique (comment_id, reactor_email, emoji)
);

-- `meta` của field_changed: {"changes":[{"key","from","to"}], "source"?:"import"}.
-- Chỉ lưu key cột, nhãn tra lúc hiển thị: admin đổi tên cột thì lịch sử cũ
-- vẫn đọc theo tên mới thay vì giữ một tên không còn ai nhận ra.
create table if not exists provider_activity (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references provider_directory(id) on delete cascade,
  actor_email text not null,
  type text not null
    constraint provider_activity_type_check
    check (
      type in (
        'created',
        'field_changed',
        'archived',
        'comment_added',
        'comment_edited',
        'comment_deleted'
      )
    ),
  meta jsonb,
  created_at timestamptz not null default now()
);

create index if not exists provider_activity_provider_idx
  on provider_activity (provider_id, created_at desc);

-- Nguồn thứ tư của chuông (sau task / enrollment / time off). Hiện chỉ có
-- 'mentioned'. Không nhồi vào task_notifications: bảng đó có
-- task_id not null references tasks(id).
create table if not exists provider_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_email text not null,
  provider_id uuid not null references provider_directory(id) on delete cascade,
  type text not null
    constraint provider_notifications_type_check
    check (type in ('mentioned')),
  actor_email text not null,
  comment_id uuid references provider_comments(id) on delete set null,
  detail text,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists provider_notifications_recipient_idx
  on provider_notifications (recipient_email, is_read, created_at desc);

alter table provider_comments enable row level security;
alter table provider_comment_edits enable row level security;
alter table provider_comment_reactions enable row level security;
alter table provider_activity enable row level security;
alter table provider_notifications enable row level security;

create or replace function create_provider_comment_idempotent(
  p_provider_id uuid,
  p_author_email text,
  p_body text,
  p_parent_id uuid,
  p_client_request_id uuid
) returns table (comment jsonb, was_created boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_comment provider_comments%rowtype;
  v_author text;
begin
  v_author := lower(btrim(coalesce(p_author_email, '')));
  if v_author = '' then raise exception 'COMMENT_AUTHOR_REQUIRED'; end if;

  -- Khoá dòng provider để hai lượt gửi cùng client_request_id không cùng lọt
  -- qua bước kiểm trùng bên dưới.
  perform 1
  from provider_directory
  where id = p_provider_id
    and archived_at is null
  for update;
  if not found then raise exception 'PROVIDER_NOT_FOUND'; end if;

  if p_client_request_id is not null then
    select * into v_comment
    from provider_comments
    where provider_id = p_provider_id
      and author_email = v_author
      and client_request_id = p_client_request_id;
    if found then
      comment := to_jsonb(v_comment);
      was_created := false;
      return next;
      return;
    end if;
  end if;

  if p_parent_id is not null then
    perform 1
    from provider_comments
    where id = p_parent_id
      and provider_id = p_provider_id
      and parent_id is null
      and deleted_at is null;
    if not found then raise exception 'INVALID_PARENT'; end if;
  end if;

  insert into provider_comments (
    provider_id, parent_id, author_email, body, client_request_id
  ) values (
    p_provider_id, p_parent_id, v_author, p_body, p_client_request_id
  ) returning * into v_comment;

  insert into provider_activity (provider_id, actor_email, type, meta)
  values (p_provider_id, v_author, 'comment_added',
          jsonb_build_object('comment_id', v_comment.id));

  comment := to_jsonb(v_comment);
  was_created := true;
  return next;
end;
$$;

revoke all on function create_provider_comment_idempotent(uuid, text, text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function create_provider_comment_idempotent(uuid, text, text, uuid, uuid)
  to service_role;

create or replace function edit_provider_comment_atomic(
  p_comment_id uuid,
  p_provider_id uuid,
  p_actor_email text,
  p_body text,
  p_expected_updated_at timestamptz
) returns table (comment jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_comment provider_comments%rowtype;
  v_actor text;
  v_now timestamptz;
begin
  v_actor := lower(btrim(coalesce(p_actor_email, '')));
  select * into v_comment
  from provider_comments
  where id = p_comment_id and provider_id = p_provider_id
  for update;
  if not found then raise exception 'COMMENT_NOT_FOUND'; end if;
  if lower(btrim(v_comment.author_email)) <> v_actor then raise exception 'FORBIDDEN'; end if;
  if v_comment.deleted_at is not null then raise exception 'COMMENT_DELETED'; end if;
  if p_expected_updated_at is not null and v_comment.updated_at <> p_expected_updated_at then
    raise exception 'COMMENT_CONFLICT';
  end if;

  if v_comment.body = p_body then
    comment := to_jsonb(v_comment);
    return next;
    return;
  end if;

  insert into provider_comment_edits (comment_id, previous_body, edited_by)
  values (p_comment_id, v_comment.body, v_actor);
  v_now := greatest(clock_timestamp(), v_comment.updated_at + interval '1 microsecond');
  update provider_comments
  set body = p_body, updated_at = v_now
  where id = p_comment_id
  returning * into v_comment;
  insert into provider_activity (provider_id, actor_email, type, meta)
  values (p_provider_id, v_actor, 'comment_edited',
          jsonb_build_object('comment_id', p_comment_id));

  comment := to_jsonb(v_comment);
  return next;
end;
$$;

revoke all on function edit_provider_comment_atomic(uuid, uuid, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function edit_provider_comment_atomic(uuid, uuid, text, text, timestamptz)
  to service_role;

create or replace function delete_provider_comment_atomic(
  p_comment_id uuid,
  p_provider_id uuid,
  p_actor_email text
) returns table (was_deleted boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_comment provider_comments%rowtype;
  v_actor text;
  v_now timestamptz;
begin
  v_actor := lower(btrim(coalesce(p_actor_email, '')));
  select * into v_comment
  from provider_comments
  where id = p_comment_id and provider_id = p_provider_id
  for update;
  if not found then raise exception 'COMMENT_NOT_FOUND'; end if;
  if lower(btrim(v_comment.author_email)) <> v_actor then raise exception 'FORBIDDEN'; end if;

  if v_comment.deleted_at is not null then
    was_deleted := false;
    return next;
    return;
  end if;

  v_now := greatest(clock_timestamp(), v_comment.updated_at + interval '1 microsecond');
  update provider_comments
  set body = '', deleted_at = v_now, updated_at = v_now
  where id = p_comment_id;
  delete from provider_comment_reactions where comment_id = p_comment_id;
  insert into provider_activity (provider_id, actor_email, type, meta)
  values (p_provider_id, v_actor, 'comment_deleted',
          jsonb_build_object('comment_id', p_comment_id));

  was_deleted := true;
  return next;
end;
$$;

revoke all on function delete_provider_comment_atomic(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function delete_provider_comment_atomic(uuid, uuid, text)
  to service_role;

create or replace function set_provider_comment_reaction_atomic(
  p_comment_id uuid,
  p_provider_id uuid,
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

  select comment.deleted_at
  into v_deleted_at
  from provider_comments as comment
  where comment.id = p_comment_id
    and comment.provider_id = p_provider_id
  for update;
  if not found or v_deleted_at is not null then
    raise exception 'COMMENT_NOT_FOUND';
  end if;

  if p_present then
    insert into provider_comment_reactions (comment_id, reactor_email, emoji)
    values (p_comment_id, v_reactor_email, p_emoji)
    on conflict do nothing;
    get diagnostics v_row_count = row_count;
    v_changed := v_row_count > 0;
  else
    delete from provider_comment_reactions as reaction
    where reaction.comment_id = p_comment_id
      and reaction.reactor_email = v_reactor_email
      and reaction.emoji = p_emoji;
    get diagnostics v_row_count = row_count;
    v_changed := v_row_count > 0;
  end if;

  return query
  select reaction.comment_id, reaction.emoji, reaction.reactor_email, v_changed
  from provider_comment_reactions as reaction
  where reaction.comment_id = p_comment_id
  order by reaction.created_at, reaction.id;
end;
$$;

revoke all on function set_provider_comment_reaction_atomic(
  uuid, uuid, text, text, boolean
) from public, anon, authenticated;
grant execute on function set_provider_comment_reaction_atomic(
  uuid, uuid, text, text, boolean
) to service_role;

create or replace function provider_comment_reactions_for_provider(
  p_provider_id uuid
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
  from provider_comment_reactions as reaction
  join provider_comments as comment
    on comment.id = reaction.comment_id
  where comment.provider_id = p_provider_id
    and comment.deleted_at is null
  order by reaction.created_at, reaction.id;
$$;

revoke all on function provider_comment_reactions_for_provider(uuid)
  from public, anon, authenticated;
grant execute on function provider_comment_reactions_for_provider(uuid)
  to service_role;

commit;

notify pgrst, 'reload schema';
