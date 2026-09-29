-- =====================================================================
-- Thêm hai product cho lead: Life và Unknown.
--
-- Luật (chốt 2026-09-29):
--   - Unknown THAY CHỖ "không có product". Mảng rỗng / `product` null không
--     còn tồn tại: trigger tự ghi thành ['unknown'], và mọi lead đang rỗng được
--     backfill sang Unknown. Chỉ còn MỘT cách nói "chưa biết khách quan tâm gì".
--   - Unknown đứng một mình: lead có product thật thì Unknown bị bỏ.
--   - Life và Unknown có vòng xoay (lead_assignment_weights), cờ auto-assign và
--     ngưỡng cảnh báo (lead_alert_settings) riêng, y như P&C và Health. Chưa ai
--     được tick nhận hai product này — admin tự bật ở Distribute pool → Agent
--     config; auto-assign mặc định TẮT.
--
-- Thứ tự product cố định: pc, health, life, unknown — khớp LEAD_PRODUCTS trong
-- src/lib/leads/types.ts. `product` = phần tử đầu theo thứ tự này.
--
-- CHẠY FILE NÀY TRƯỚC KHI DEPLOY CODE: code mới ghi 'life'/'unknown', CHECK cũ
-- sẽ chặn. Ngược lại thì an toàn: code cũ ghi mảng rỗng, trigger mới đổi thành
-- Unknown.
--
-- Idempotent. Chạy lại lần hai là no-op. Supabase Studio bọc cả file trong
-- MỘT transaction, nên hỏng giữa chừng thì không có gì được ghi.
-- =====================================================================

-- ---------- 1. Bỏ các CHECK theo product cũ ----------
-- Phần lớn CHECK cũ viết inline nên tên do Postgres tự đặt (leads_product_check,
-- lead_alert_settings_product_check, ...). Không đoán tên: bỏ mọi CHECK trên ba
-- bảng này có nhắc tới 'pc', rồi mục 4 tạo lại với tên cố định.
do $$
declare
  c record;
begin
  for c in
    select con.conrelid::regclass as tbl, con.conname
    from pg_constraint con
    where con.contype = 'c'
      and con.conrelid in (
        'leads'::regclass,
        'lead_alert_settings'::regclass,
        'lead_assignment_weights'::regclass
      )
      and position('''pc''' in pg_get_constraintdef(con.oid)) > 0
  loop
    execute format('alter table %s drop constraint %I', c.tbl, c.conname);
  end loop;
end $$;

-- ---------- 2. Trigger: rỗng = Unknown, Unknown đứng một mình ----------
-- Bản TS của luật này là normalizeLeadProducts() trong src/lib/leads/types.ts.
create or replace function lead_sync_primary_product()
returns trigger
language plpgsql as $$
declare
  requested text[];
begin
  if tg_op = 'UPDATE'
    and new.products is distinct from old.products then
    -- `products` is authoritative when it was edited — including an empty
    -- array, which now means "back to Unknown".
    requested := coalesce(new.products, '{}'::text[]);
  elsif tg_op = 'UPDATE'
    and new.product is distinct from old.product then
    -- Inline edit vẫn gửi cột `product` riêng. Một lần chọn product mới phải
    -- bỏ trạng thái multi-product cũ thay vì để trigger giữ giá trị cũ.
    requested := case
      when new.product is null then '{}'::text[]
      else array[new.product]
    end;
  elsif new.products is null or cardinality(new.products) = 0 then
    -- Insert kiểu cũ (chỉ set `product`, hoặc không set gì) vẫn hợp lệ.
    requested := case
      when new.product is null then '{}'::text[]
      else array[new.product]
    end;
  else
    requested := new.products;
  end if;

  -- Giá trị lạ phải bị chặn chứ không được lặng lẽ biến thành Unknown.
  if exists (
    select 1 from unnest(requested) as r
    where r not in ('pc', 'health', 'life', 'unknown')
  ) then
    raise exception 'LEAD_PRODUCT_INVALID';
  end if;

  -- Thứ tự cố định để `product` không đổi chỉ vì mảng được ghi khác thứ tự.
  -- Có product thật thì bỏ Unknown; không còn gì thì là Unknown.
  new.products := array(
    select p from unnest(array['pc', 'health', 'life']) as p where p = any (requested)
  );
  if cardinality(new.products) = 0 then
    new.products := array['unknown'];
  end if;
  new.product := new.products[1];
  return new;
end $$;

drop trigger if exists lead_sync_primary_product_trg on leads;
create trigger lead_sync_primary_product_trg
  before insert or update of products, product on leads
  for each row execute function lead_sync_primary_product();

-- ---------- 3. Backfill: lead chưa phân loại → Unknown ----------
-- Không đụng updated_at: đây là đổi cách biểu diễn, không phải ai đó sửa lead.
-- Nhánh `product is not null` chỉ là lưới an toàn — rollout 2026-09-03 đã
-- backfill mảng từ cột cũ nên không nên còn dòng nào như vậy.
update leads
set products = case
  when product is not null then array[product]
  else array['unknown']
end
where products is null or cardinality(products) = 0;

-- ---------- 4. CHECK mới, tên cố định ----------
alter table leads add constraint leads_product_valid check (
  product in ('pc', 'health', 'life', 'unknown')
);
alter table leads add constraint leads_products_valid check (
  products <@ array['pc', 'health', 'life', 'unknown']::text[]
  and cardinality(products) > 0
  and (cardinality(products) = 1 or not ('unknown' = any (products)))
);
alter table lead_alert_settings add constraint lead_alert_settings_product_valid check (
  product in ('pc', 'health', 'life', 'unknown')
);
alter table lead_assignment_weights add constraint lead_assignment_weights_product_valid check (
  product in ('pc', 'health', 'life', 'unknown')
);

-- ---------- 5. Ngưỡng cảnh báo + cờ auto-assign cho hai product mới ----------
insert into lead_alert_settings (product) values ('life'), ('unknown')
on conflict (product) do nothing;

-- ---------- 6. Hai RPC tự kiểm product ----------
-- Chỉ đổi đúng danh sách trong `p_product not in (...)`; phần còn lại giữ
-- nguyên bản trong schema.sql.
create or replace function assign_leads_round_robin(
  p_lead_ids uuid[],
  p_product text,
  p_eligible_emails text[],
  p_actor_email text,
  p_reason text default 'auto: weighted round-robin'
) returns table (lead_id uuid, to_email text)
language plpgsql security definer set search_path = public as $$
declare
  target_lead uuid;
  total_weight integer;
  best_email text;
  actor_value text;
  eligible text[];
begin
  actor_value := lead_norm_email(p_actor_email);
  if actor_value is null then
    raise exception 'LEAD_ACTOR_REQUIRED';
  end if;
  if p_product is null or p_product not in ('pc', 'health', 'life', 'unknown') then
    raise exception 'LEAD_PRODUCT_INVALID';
  end if;

  select coalesce(array_agg(lower(btrim(value))), array[]::text[])
  into eligible
  from unnest(coalesce(p_eligible_emails, array[]::text[])) as value
  where btrim(value) <> '';

  perform 1
  from lead_assignment_weights w
  where w.product = p_product
  for update;

  select coalesce(sum(w.weight), 0) into total_weight
  from lead_assignment_weights w
  where w.product = p_product
    and w.is_active
    and w.weight > 0
    and lower(w.agent_email) = any (eligible);

  if total_weight <= 0 then
    return;
  end if;

  foreach target_lead in array coalesce(p_lead_ids, array[]::uuid[]) loop
    update lead_assignment_weights w
    set current_weight = w.current_weight + w.weight
    where w.product = p_product
      and w.is_active
      and w.weight > 0
      and lower(w.agent_email) = any (eligible);

    select w.agent_email into best_email
    from lead_assignment_weights w
    where w.product = p_product
      and w.is_active
      and w.weight > 0
      and lower(w.agent_email) = any (eligible)
    order by w.current_weight desc, w.position asc, w.agent_email asc
    limit 1;

    update lead_assignment_weights w
    set current_weight = w.current_weight - total_weight,
        updated_at = now()
    where w.product = p_product and w.agent_email = best_email;

    update leads l
    set assigned_to_email = best_email,
        assigned_at = now(),
        assigned_by_email = actor_value,
        updated_at = now(),
        updated_by_email = actor_value
    where l.id = target_lead
      and l.archived_at is null
      and l.assigned_to_email is null
      -- Lead mang product này là đủ; nó có thể mang cả product kia nữa.
      and p_product = any (l.products);

    if found then
      insert into lead_assignment_history
        (lead_id, from_email, to_email, reason, actor_email)
      values (target_lead, null, best_email, p_reason, actor_value);
      lead_id := target_lead;
      to_email := best_email;
      return next;
    end if;
  end loop;
end $$;

revoke all on function assign_leads_round_robin(uuid[], text, text[], text, text)
  from public, anon, authenticated;
grant execute on function assign_leads_round_robin(uuid[], text, text[], text, text)
  to service_role;

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
  if p_product is null or p_product not in ('pc', 'health', 'life', 'unknown') then
    raise exception 'LEAD_PRODUCT_INVALID';
  end if;

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

-- ---------- 7. Màu badge cho cột Product ----------
-- Badge nối màu theo NHÃN, nên hai nhãn này phải khớp LEAD_PRODUCT_LABEL.
-- Admin đổi màu được ở Lead Table Configuration → Values.
insert into table_column_option (column_id, label, color, position)
select column_row.id, seed.label, seed.color, seed.position
from table_column column_row
cross join (values ('Life', '#6554c0', 30), ('Unknown', '#97a0af', 40))
     as seed(label, color, position)
where column_row.scope = 'lead'
  and column_row.key = 'product'
  and not exists (
    select 1
    from table_column_option existing
    where existing.column_id = column_row.id
      and existing.label = seed.label
  );

-- ---------- Kiểm chứng ----------
-- Một dòng. Mọi cột phải đọc ok.
select
  case when (select count(*) from leads
             where products is null or cardinality(products) = 0) = 0
       then 'ok' else 'FAIL: còn lead không có product' end            as no_empty,
  case when (select count(*) from leads
             where product is distinct from products[1]) = 0
       then 'ok' else 'FAIL: product lệch products[1]' end             as in_sync,
  case when (select count(*) from lead_alert_settings
             where product in ('life', 'unknown')) = 2
       then 'ok' else 'FAIL: thiếu lead_alert_settings' end            as alert_rows,
  case when (select count(*) from table_column_option o
             join table_column c on c.id = o.column_id
             where c.scope = 'lead' and c.key = 'product'
               and o.label in ('Life', 'Unknown')) = 2
       then 'ok' else 'FAIL: thiếu màu Product' end                    as badge_options,
  (select count(*) from leads where products = array['unknown'])       as unknown_leads;
