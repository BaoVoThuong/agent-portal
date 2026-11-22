-- =====================================================================
-- State Licensing: gộp "HealthSpring (SHL)" vào "HealthSpring" (2026-11-14)
--
-- User 14/11: SHL và HealthSpring là một hãng. Trong mỗi cột sản phẩm có cả
-- hai giá trị, mọi appointment của "HealthSpring (SHL)" chuyển sang
-- "HealthSpring":
--   - bang chưa có HealthSpring ở cột đó → appointment đổi option_id, giữ dấu
--     "SHL" vào ghi chú (nếu ghi chú đang trống) để không mất thông tin;
--   - bang đã có HealthSpring → appointment SHL bị xoá mềm (trùng).
-- Mỗi thay đổi một dòng licensing_events. Sau đó archive giá trị
-- "HealthSpring (SHL)" ở Table Configuration. Chạy lại không làm gì thêm.
-- =====================================================================

begin;

do $$
declare
  v_pair record;
  v_row record;
  v_before jsonb;
begin
  for v_pair in
    select shl.id as shl_id, plain.id as plain_id
    from table_column c
    join table_column_option shl on shl.column_id = c.id and shl.archived_at is null
      and lower(btrim(shl.label)) = 'healthspring (shl)'
    join table_column_option plain on plain.column_id = c.id and plain.archived_at is null
      and lower(btrim(plain.label)) = 'healthspring'
    where c.scope = 'licensing'
  loop
    for v_row in
      select a.id, a.state_code,
             exists (select 1 from licensing_appointments b
                     where b.state_code = a.state_code and b.option_id = v_pair.plain_id
                       and b.deleted_at is null) as duplicate
      from licensing_appointments a
      where a.option_id = v_pair.shl_id and a.deleted_at is null
      for update of a
    loop
      v_before := public.licensing_appointment_snapshot(v_row.id);
      if v_row.duplicate then
        update licensing_appointments set deleted_at = now(), updated_at = now() where id = v_row.id;
        insert into licensing_events (appointment_id, product_key, state_code, action, before)
        values (v_row.id, v_before->>'product_key', v_row.state_code, 'appointment.delete', v_before);
      else
        update licensing_appointments
        set option_id = v_pair.plain_id,
            note = coalesce(nullif(btrim(note), ''), 'SHL'),
            updated_at = now()
        where id = v_row.id;
        insert into licensing_events (appointment_id, product_key, state_code, action, before, after)
        values (v_row.id, v_before->>'product_key', v_row.state_code, 'appointment.update', v_before,
                public.licensing_appointment_snapshot(v_row.id));
      end if;
    end loop;

    update table_column_option set archived_at = now(), updated_at = now() where id = v_pair.shl_id;
  end loop;
end $$;

commit;

-- Kiểm: không còn appointment nào trỏ giá trị SHL đang hoạt động / đã archive
select a.state_code, o.label, a.note
from licensing_appointments a
join table_column_option o on o.id = a.option_id
join table_column c on c.id = o.column_id
where c.scope = 'licensing' and a.deleted_at is null and o.label ilike 'healthspring%'
  and c.key = 'medicare_advantage'
order by a.state_code;
