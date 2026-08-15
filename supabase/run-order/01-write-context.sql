-- 01 — table_config_write_context
-- FIX: POST/PATCH /api/tasks + POST/PATCH /api/enrollment (hiện trả 503 cho MỌI request)
-- Nguồn: schema.sql:3780-3943 (function này KHÔNG có rollout file riêng)
-- An toàn: chỉ create function, không đụng data. Rollback: drop function.
begin;
-- Narrow, service-role-only validation context used by Task and Enrollment
-- mutations.  Keeping the metadata lookup and conditional Person matching in
-- one RPC prevents inline edits from adding a metadata query plus a full
-- roster load to the write path.
create or replace function table_config_write_context(
  p_scope text,
  p_mode text,
  p_touched_system_keys text[] default array[]::text[],
  p_touched_custom_keys text[] default array[]::text[],
  p_submitted_custom_values jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  requested_keys text[] := array[]::text[];
  candidate_ids uuid[] := array[]::uuid[];
  columns_json jsonb := '[]'::jsonb;
  options_json jsonb := '[]'::jsonb;
  matched_people jsonb := '[]'::jsonb;
  person_emails text[] := array[]::text[];
begin
  if p_scope not in ('cs', 'aca', 'medicare') then
    raise exception 'WRITE_CONTEXT_SCOPE_INVALID';
  end if;
  if p_mode not in ('create', 'patch') then
    raise exception 'WRITE_CONTEXT_MODE_INVALID';
  end if;
  if cardinality(coalesce(p_touched_system_keys, array[]::text[])) > 100
    or cardinality(coalesce(p_touched_custom_keys, array[]::text[])) > 100
    or exists (
      select 1
      from unnest(array_cat(
        coalesce(p_touched_system_keys, array[]::text[]),
        coalesce(p_touched_custom_keys, array[]::text[])
      )) as requested(value)
      where length(requested.value) > 128
    ) then
    raise exception 'WRITE_CONTEXT_INPUT_TOO_LARGE';
  end if;
  if jsonb_typeof(coalesce(p_submitted_custom_values, '{}'::jsonb)) <> 'object'
    or jsonb_object_length(coalesce(p_submitted_custom_values, '{}'::jsonb)) > 100 then
    raise exception 'WRITE_CONTEXT_VALUES_INVALID';
  end if;

  select coalesce(array_agg(distinct btrim(value)), array[]::text[])
  into requested_keys
  from unnest(array_cat(
    coalesce(p_touched_system_keys, array[]::text[]),
    coalesce(p_touched_custom_keys, array[]::text[])
  )) as requested(value)
  where nullif(btrim(value), '') is not null;

  select coalesce(array_agg(column_row.id), array[]::uuid[])
  into candidate_ids
  from table_column column_row
  where column_row.scope = p_scope
    and column_row.archived_at is null
    and (
      (p_mode = 'create' and (column_row.required or column_row.key = any(requested_keys)))
      or (p_mode = 'patch' and column_row.key = any(requested_keys))
    );

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', column_row.id,
        'scope', column_row.scope,
        'key', column_row.key,
        'label', column_row.label,
        'type', column_row.type,
        'is_system', column_row.is_system,
        'position', column_row.position,
        'pinned', column_row.pinned,
        'hidden_default', column_row.hidden_default,
        'show_in_detail', column_row.show_in_detail,
        'required', column_row.required,
        'created_by_email', column_row.created_by_email,
        'created_at', column_row.created_at,
        'updated_at', column_row.updated_at,
        'archived_at', column_row.archived_at
      )
      order by column_row.position, column_row.label, column_row.key
    ),
    '[]'::jsonb
  )
  into columns_json
  from table_column column_row
  where column_row.id = any(candidate_ids);

  if cardinality(candidate_ids) > 0 then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', option_row.id,
          'column_id', option_row.column_id,
          'label', option_row.label,
          'color', option_row.color,
          'position', option_row.position,
          'created_at', option_row.created_at,
          'updated_at', option_row.updated_at,
          'archived_at', option_row.archived_at
        )
        order by option_row.column_id, option_row.position, option_row.label, option_row.id
      ),
      '[]'::jsonb
    )
    into options_json
    from table_column_option option_row
    where option_row.column_id = any(candidate_ids)
      and option_row.archived_at is null;
  end if;

  -- This block is deliberately conditional.  Non-Person writes never touch
  -- the account/role tables, keeping the common dropdown/text path cheap.
  select coalesce(array_agg(distinct lower(btrim(entry.value))), array[]::text[])
  into person_emails
  from table_column column_row
  cross join lateral jsonb_each_text(coalesce(p_submitted_custom_values, '{}'::jsonb)) entry
  where cardinality(candidate_ids) > 0
    and column_row.id = any(candidate_ids)
    and column_row.is_system = false
    and column_row.type = 'person'
    and entry.key = column_row.key
    and nullif(btrim(entry.value), '') is not null;

  if cardinality(person_emails) > 0 then
    if p_scope = 'cs' then
      select coalesce(jsonb_agg(lower(btrim(account.email)) order by lower(btrim(account.email))), '[]'::jsonb)
      into matched_people
      from portal_account account
      where account.is_active
        and lower(btrim(account.email)) = any(person_emails)
        and exists (
          select 1
          from user_roles user_role
          join role_permissions permission on permission.role_id = user_role.role_id
          where user_role.user_id = account.id
            and permission.permission_key in ('task.work', 'task.manage')
        );
    else
      select coalesce(jsonb_agg(lower(btrim(account.email)) order by lower(btrim(account.email))), '[]'::jsonb)
      into matched_people
      from portal_account account
      where account.is_active
        and lower(btrim(account.email)) = any(person_emails);
    end if;
  end if;

  return jsonb_build_object(
    'columns', columns_json,
    'options', options_json,
    'matched_person_emails', matched_people
  );
end;
$$;

revoke all on function table_config_write_context(text, text, text[], text[], jsonb)
  from public, anon, authenticated;
grant execute on function table_config_write_context(text, text, text[], text[], jsonb)
  to service_role;
commit;
