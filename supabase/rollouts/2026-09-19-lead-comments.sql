-- Event Leads: regular comments in the same timeline as interaction logs.
-- Forward-only rollout. Do not edit or re-run an older lead rollout.

create table if not exists public.lead_comments (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  parent_id uuid references public.lead_comments(id) on delete cascade,
  author_email text not null,
  body text not null check (btrim(body) <> ''),
  client_request_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index if not exists lead_comments_client_request_id_key
  on public.lead_comments (lead_id, author_email, client_request_id)
  where client_request_id is not null;

create index if not exists lead_comments_lead_idx
  on public.lead_comments (lead_id, created_at);

alter table public.lead_comments enable row level security;

create or replace function public.create_lead_comment_atomic(
  p_lead_id uuid,
  p_author_email text,
  p_body text,
  p_parent_id uuid default null,
  p_client_request_id uuid default null
) returns table (comment jsonb, lead_updated_at timestamptz, was_created boolean)
language plpgsql security definer set search_path = public as $$
declare
  v_lead public.leads%rowtype;
  v_comment public.lead_comments%rowtype;
  v_now timestamptz;
begin
  select * into v_lead
  from public.leads
  where id = p_lead_id
    and archived_at is null
  for update;

  if not found then
    raise exception 'LEAD_NOT_FOUND';
  end if;

  if p_client_request_id is not null then
    select * into v_comment
    from public.lead_comments
    where lead_id = p_lead_id
      and author_email = p_author_email
      and client_request_id = p_client_request_id;
    if found then
      comment := to_jsonb(v_comment);
      lead_updated_at := v_lead.updated_at;
      was_created := false;
      return next;
      return;
    end if;
  end if;

  if p_parent_id is not null then
    perform 1
    from public.lead_comments
    where id = p_parent_id
      and lead_id = p_lead_id
      and parent_id is null
      and deleted_at is null;
    if not found then
      raise exception 'INVALID_PARENT';
    end if;
  end if;

  insert into public.lead_comments (
    lead_id, parent_id, author_email, body, client_request_id
  ) values (
    p_lead_id,
    p_parent_id,
    p_author_email,
    btrim(p_body),
    p_client_request_id
  ) returning * into v_comment;

  v_now := greatest(clock_timestamp(), v_lead.updated_at + interval '1 microsecond');
  update public.leads
  set updated_at = v_now,
      updated_by_email = p_author_email
  where id = p_lead_id;

  comment := to_jsonb(v_comment);
  lead_updated_at := v_now;
  was_created := true;
  return next;
end;
$$;

revoke all on function public.create_lead_comment_atomic(uuid, text, text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.create_lead_comment_atomic(uuid, text, text, uuid, uuid)
  to service_role;

-- Keep the schema's defense-in-depth list current for fresh installs too.
do $$
begin
  if to_regclass('public.lead_comments') is not null then
    alter table public.lead_comments enable row level security;
  end if;
end;
$$;

select
  'lead_comments' as table_name,
  to_regclass('public.lead_comments') is not null as table_exists,
  to_regprocedure('public.create_lead_comment_atomic(uuid,text,text,uuid,uuid)') is not null as rpc_exists;
