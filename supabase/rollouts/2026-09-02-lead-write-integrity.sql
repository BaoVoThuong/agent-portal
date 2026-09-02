-- =====================================================================
-- Toàn vẹn khi ghi lead. Ba thứ, một file:
--   1. RPC gán lead nguyên tử (thay ba truy vấn rời ở route).
--   2. Unique index cho idempotency khi tạo lead.
--   3. Unique index chặn trùng số điện thoại khi lead KHÔNG thuộc event nào.
--
-- Idempotent. Chạy lại lần hai là no-op.
-- =====================================================================

-- ---------- 1. Gán lead nguyên tử ----------
-- Trước đó route làm: đọc chủ cũ -> update lead -> insert lịch sử. Lỗi ở bước
-- ba chỉ được console.error, nên lead đổi chủ mà bảng lịch sử trống. Và chủ cũ
-- đọc ở bước một dùng ở bước ba: ai gán chen vào giữa thì lịch sử ghi sai người.
--
-- `for update` khoá đúng những dòng sắp sửa, nên chủ cũ được đọc DƯỚI KHOÁ.
-- Hàm là một giao dịch, nên không còn trạng thái "đã gán nhưng chưa có lịch sử".
create or replace function assign_leads_manual(
  p_lead_ids uuid[],
  p_to_email text,
  p_actor_email text,
  p_reason text
) returns table (lead_id uuid, from_email text)
language plpgsql security definer set search_path = public as $$
declare
  actor_value text;
  target_value text;
  r record;
begin
  actor_value := lead_norm_email(p_actor_email);
  if actor_value is null then
    raise exception 'LEAD_ACTOR_REQUIRED';
  end if;
  -- null = bỏ gán, đưa lead về pool. Thao tác hợp lệ, không phải lỗi.
  target_value := lead_norm_email(p_to_email);

  for r in
    select l.id, l.assigned_to_email
    from leads l
    where l.id = any (coalesce(p_lead_ids, array[]::uuid[]))
      and l.archived_at is null
    order by l.id
    for update
  loop
    update leads
    set assigned_to_email = target_value,
        assigned_at = case when target_value is null then null else now() end,
        assigned_by_email = actor_value,
        updated_at = now(),
        updated_by_email = actor_value
    where id = r.id;

    insert into lead_assignment_history
      (lead_id, from_email, to_email, reason, actor_email)
    values (r.id, r.assigned_to_email, target_value, p_reason, actor_value);

    lead_id := r.id;
    from_email := r.assigned_to_email;
    return next;
  end loop;
end $$;

revoke all on function assign_leads_manual(uuid[], text, text, text)
  from public, anon, authenticated;
grant execute on function assign_leads_manual(uuid[], text, text, text)
  to service_role;

-- ---------- 2. Idempotency khi tạo lead ----------
-- `POST /api/leads` chỉ đọc trước rồi mới insert. Không có unique index thì hai
-- request cùng token chạy song song đều "chưa thấy" dòng nào và cùng insert.
--
-- Khoá theo (người tạo, token) chứ không theo mình token: token do client sinh,
-- và nếu hai người vô tình trùng token thì tra theo mình token sẽ trả về lead
-- CỦA NGƯỜI KHÁC.
create unique index if not exists leads_creator_request_unique_idx
  on leads (created_by_email, client_request_id)
  where client_request_id is not null;

-- ---------- 3. Trùng số điện thoại khi không có event ----------
-- Index sẵn có là (event_id, phone). PostgreSQL coi mỗi NULL là KHÁC nhau, nên
-- nó không chặn được gì khi event_id IS NULL — mà lead không thuộc event nào là
-- trạng thái hợp lệ ở cả Create lẫn Import.
create unique index if not exists leads_phone_no_event_unique_idx
  on leads (phone)
  where phone is not null and event_id is null and archived_at is null;

-- ---------- Kiểm chứng ----------
-- Một dòng, cả ba cột phải đọc 'ok'.
select
  case when exists (select 1 from pg_proc where proname = 'assign_leads_manual')
       then 'ok' else 'FAIL: thiếu RPC' end                                as rpc_assign,
  case when exists (select 1 from pg_indexes where indexname = 'leads_creator_request_unique_idx')
       then 'ok' else 'FAIL: thiếu index idempotency' end                  as idx_idempotency,
  case when exists (select 1 from pg_indexes where indexname = 'leads_phone_no_event_unique_idx')
       then 'ok' else 'FAIL: thiếu index phone-không-event' end            as idx_phone;
