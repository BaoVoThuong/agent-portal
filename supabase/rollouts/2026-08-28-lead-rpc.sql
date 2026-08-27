-- Lead Management: ghi interaction và cập nhật thống kê atomically.
-- Forward-only. Mọi biến local có hậu tố _value và mọi bảng đều có alias để
-- tránh ambiguity giữa tên biến, output parameter và tên cột SQL.

create or replace function log_lead_interaction_atomic(
  p_lead_id uuid,
  p_type_id uuid,
  p_status_id uuid default null,
  p_note text default null,
  p_actor_email text default null,
  p_follow_up_at timestamptz default null,
  p_client_request_id uuid default null,
  p_now timestamptz default now()
) returns table (interaction jsonb, lead jsonb, was_created boolean)
language plpgsql security definer set search_path = public as $$
declare
  lead_value leads%rowtype;
  interaction_value lead_interactions%rowtype;
  type_value lead_interaction_types%rowtype;
  status_kind_value text;
  actor_value text;
begin
  actor_value := lead_norm_email(p_actor_email);
  if actor_value is null then
    raise exception 'LEAD_ACTOR_REQUIRED';
  end if;

  select * into lead_value from leads as lead
  where lead.id = p_lead_id and lead.archived_at is null
  for update;
  if not found then
    raise exception 'LEAD_NOT_FOUND';
  end if;

  select * into type_value from lead_interaction_types as itype
  where itype.id = p_type_id and itype.archived_at is null;
  if not found then
    raise exception 'LEAD_TYPE_NOT_FOUND';
  end if;

  -- A retry with the same client request id returns the original snapshot and
  -- never increments the contact counter again.
  if p_client_request_id is not null then
    select * into interaction_value from lead_interactions as li
    where li.lead_id = p_lead_id
      and li.client_request_id = p_client_request_id;
    if found then
      interaction := to_jsonb(interaction_value);
      lead := to_jsonb(lead_value);
      was_created := false;
      return next;
      return;
    end if;
  end if;

  if p_status_id is not null then
    select st.kind into status_kind_value from lead_statuses as st
    where st.id = p_status_id
      and st.product = lead_value.product
      and st.archived_at is null;
    if status_kind_value is null then
      raise exception 'LEAD_STATUS_NOT_FOUND';
    end if;
    if status_kind_value <> 'scheduled' and p_follow_up_at is not null then
      raise exception 'LEAD_FOLLOW_UP_REQUIRES_SCHEDULED';
    end if;
    if status_kind_value = 'scheduled' and p_follow_up_at is null then
      raise exception 'LEAD_FOLLOW_UP_REQUIRED';
    end if;
  elsif p_follow_up_at is not null then
    raise exception 'LEAD_FOLLOW_UP_REQUIRES_SCHEDULED';
  end if;

  insert into lead_interactions (
    lead_id, type_id, status_id, note, actor_email,
    occurred_at, follow_up_at, client_request_id
  ) values (
    p_lead_id, p_type_id, p_status_id, nullif(btrim(coalesce(p_note, '')), ''),
    actor_value, p_now, p_follow_up_at, p_client_request_id
  ) returning * into interaction_value;

  update leads as lead set
    first_contacted_at = case
      when type_value.counts_as_contact and lead.first_contacted_at is null
      then p_now else lead.first_contacted_at end,
    last_contacted_at = case
      when type_value.counts_as_contact then p_now
      else lead.last_contacted_at end,
    contact_attempt_count = lead.contact_attempt_count
      + case when type_value.counts_as_contact then 1 else 0 end,
    next_follow_up_at = case
      when p_follow_up_at is not null then p_follow_up_at
      when status_kind_value in ('won', 'lost') then null
      else lead.next_follow_up_at end,
    status_id = coalesce(p_status_id, lead.status_id),
    closed_at = case
      when status_kind_value in ('won', 'lost') then p_now
      when status_kind_value is not null then null
      else lead.closed_at end,
    updated_at = p_now,
    updated_by_email = actor_value
  where lead.id = p_lead_id
  returning * into lead_value;

  interaction := to_jsonb(interaction_value);
  lead := to_jsonb(lead_value);
  was_created := true;
  return next;
end;
$$;

revoke all on function log_lead_interaction_atomic(uuid, uuid, uuid, text, text, timestamptz, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function log_lead_interaction_atomic(uuid, uuid, uuid, text, text, timestamptz, uuid, timestamptz)
  to service_role;
