-- =====================================================================
-- Lưu toàn bộ cấu hình chia pool của MỘT product trong một giao dịch.
--
-- Trước đó route chạy bốn bước rời: đọc -> xoá agent bị bỏ -> upsert phần còn
-- lại -> cập nhật cờ auto-assign. Một bước hỏng giữa chừng để lại cấu hình nửa
-- vời (agent đã xoá nhưng trọng số mới chưa ghi); hai admin lưu cùng lúc thì
-- người sau xoá mất agent người trước vừa thêm. Đây là bảng quyết định lead
-- của ai, nên nửa vời ở đây nghĩa là chia lead sai cho tới khi có người phát hiện.
--
-- `current_weight` KHÔNG nằm trong payload: nó là con trỏ vòng xoay, và đặt lại
-- nó khi admin chỉ sửa tỉ lệ sẽ trao mấy lead kế tiếp cho người đang tụt xa nhất.
--
-- Idempotent. Chạy lại lần hai là no-op.
-- =====================================================================

create or replace function save_lead_assignment_weights(
  p_product text,
  p_rows jsonb,
  p_enabled boolean,
  p_actor_email text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  actor_value text;
  keep text[];
begin
  actor_value := lead_norm_email(p_actor_email);
  if actor_value is null then
    raise exception 'LEAD_ACTOR_REQUIRED';
  end if;
  if p_product is null or p_product not in ('pc', 'health') then
    raise exception 'LEAD_PRODUCT_INVALID';
  end if;

  -- Khoá mọi dòng của product này TRƯỚC khi đụng vào bất cứ thứ gì: hai admin
  -- lưu cùng lúc thì người thứ hai chờ, thay vì ghi đè lên nửa chừng.
  perform 1 from lead_assignment_weights w where w.product = p_product for update;

  select coalesce(array_agg(lower(btrim(value ->> 'agent_email'))), array[]::text[])
  into keep
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as value
  where btrim(coalesce(value ->> 'agent_email', '')) <> '';

  delete from lead_assignment_weights w
  where w.product = p_product
    and lower(w.agent_email) <> all (keep);

  insert into lead_assignment_weights
    (product, agent_email, weight, position, is_active, updated_by_email, updated_at)
  select
    p_product,
    lower(btrim(value ->> 'agent_email')),
    greatest(coalesce((value ->> 'weight')::int, 0), 0),
    coalesce((value ->> 'position')::int, 0),
    coalesce((value ->> 'is_active')::boolean, true),
    actor_value,
    now()
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as value
  where btrim(coalesce(value ->> 'agent_email', '')) <> ''
  on conflict (product, agent_email) do update
  set weight = excluded.weight,
      position = excluded.position,
      is_active = excluded.is_active,
      updated_by_email = excluded.updated_by_email,
      updated_at = excluded.updated_at;

  if p_enabled is not null then
    update lead_alert_settings
    set auto_assign_enabled = p_enabled
    where product = p_product;
  end if;
end $$;

revoke all on function save_lead_assignment_weights(text, jsonb, boolean, text)
  from public, anon, authenticated;
grant execute on function save_lead_assignment_weights(text, jsonb, boolean, text)
  to service_role;

-- ---------- Kiểm chứng ----------
select case when exists (
         select 1 from pg_proc where proname = 'save_lead_assignment_weights'
       ) then 'ok' else 'FAIL: chưa tạo được hàm' end as rpc_created;
