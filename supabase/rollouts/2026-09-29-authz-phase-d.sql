-- Authz Phase D — định danh hoa hồng tách khỏi tên hiển thị (sửa gốc S1).
--
-- Trước đây Registration, Agent Dashboard và AI chat lọc dữ liệu hoa hồng theo
-- `portal_account.name` (tên hiển thị). Hai hệ quả:
--   1. đổi tên hiển thị = đổi phạm vi dữ liệu (Phase A đã khoá tự đổi tên, nhưng
--      Account Manager đổi tên vẫn kéo theo phạm vi);
--   2. hai account trùng tên (sau chuẩn hoá) cùng thấy dữ liệu của nhau.
--
-- Bảng `agent_commission_names`: mỗi account tối đa MỘT tên hoa hồng, tên là
-- DUY NHẤT toàn bảng. Chỉ Account Manager đặt được, qua RPC có audit.
--
-- Backfill: tên hiển thị hiện tại (chuẩn hoá như normalizeAgentName) cho mọi
-- account có tên KHÔNG trùng với account nào khác. Tên trùng KHÔNG được gán —
-- các account đó chỉ còn thấy bản ghi chính họ nộp (agent_email) cho tới khi
-- admin đặt tên hoa hồng riêng trong Account Manager. Danh sách được in ra dưới
-- dạng NOTICE và ở truy vấn kiểm chứng cuối file.
--
-- Chạy SAU 2026-09-28-authz-phase-c.sql (cần access_audit). Chạy lại an toàn.

begin;

-- ---------------------------------------------------------------------------
-- Authz Phase D: định danh hoa hồng tách khỏi tên hiển thị (sửa gốc S1)
-- (xem rollouts/2026-09-29-authz-phase-d.sql để biết lý do từng phần).
-- ---------------------------------------------------------------------------
create table if not exists agent_commission_names (
  account_id uuid primary key references portal_account(id) on delete cascade,
  agent_name text not null,
  updated_at timestamptz not null default now(),
  updated_by_email text,
  constraint agent_commission_names_normalized check (
    agent_name <> '' and agent_name = upper(regexp_replace(btrim(agent_name), '\s+', ' ', 'g'))
  )
);

create unique index if not exists agent_commission_names_name_idx
  on agent_commission_names (agent_name);

alter table agent_commission_names enable row level security;
revoke all on table agent_commission_names from anon, authenticated;

create or replace function set_commission_name_atomic(
  p_account_id uuid,
  p_agent_name text,
  p_actor_account_id uuid,
  p_actor_email text
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text := nullif(upper(regexp_replace(btrim(coalesce(p_agent_name, '')), '\s+', ' ', 'g')), '');
  v_before text;
begin
  perform 1 from portal_account where id = p_account_id for update;
  if not found then
    raise exception using message = 'ACCOUNT_NOT_FOUND';
  end if;

  select agent_name into v_before from agent_commission_names where account_id = p_account_id;
  if v_before is not distinct from v_name then
    return v_name;
  end if;

  if v_name is null then
    delete from agent_commission_names where account_id = p_account_id;
  else
    if exists (
      select 1 from agent_commission_names
      where agent_name = v_name and account_id <> p_account_id
    ) then
      raise exception using message = 'COMMISSION_NAME_TAKEN';
    end if;
    insert into agent_commission_names (account_id, agent_name, updated_at, updated_by_email)
    values (p_account_id, v_name, now(), p_actor_email)
    on conflict (account_id) do update
      set agent_name = excluded.agent_name,
          updated_at = excluded.updated_at,
          updated_by_email = excluded.updated_by_email;
  end if;

  insert into access_audit (actor_account_id, actor_email, event, target_type, target_id, before, after)
  values (p_actor_account_id, p_actor_email, 'account.commission_name', 'account', p_account_id::text,
          jsonb_build_object('agent_name', v_before), jsonb_build_object('agent_name', v_name));
  return v_name;
end;
$$;

revoke all on function set_commission_name_atomic(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function set_commission_name_atomic(uuid, text, uuid, text) to service_role;

insert into agent_commission_names (account_id, agent_name, updated_by_email)
select id, normalized, 'backfill-2026-09-29'
from (
  select
    id,
    upper(regexp_replace(btrim(name), '\s+', ' ', 'g')) as normalized,
    count(*) over (partition by upper(regexp_replace(btrim(name), '\s+', ' ', 'g'))) as holders
  from portal_account
  where name is not null and btrim(name) <> ''
) named
where holders = 1
on conflict do nothing;

do $$
declare
  r record;
begin
  for r in
    select upper(regexp_replace(btrim(name), '\s+', ' ', 'g')) as normalized,
           string_agg(email, ', ' order by email) as emails
    from portal_account
    where name is not null and btrim(name) <> ''
    group by 1
    having count(*) > 1
  loop
    raise notice 'Tên trùng — CHƯA gán định danh hoa hồng, cần đặt trong Account Manager: % (%)', r.normalized, r.emails;
  end loop;
end $$;

commit;

-- Kiểm chứng: account active chưa có tên hoa hồng (tên trùng, hoặc không có tên).
select a.email, a.name
from portal_account a
left join agent_commission_names c on c.account_id = a.id
where a.is_active and c.account_id is null
order by a.email;
