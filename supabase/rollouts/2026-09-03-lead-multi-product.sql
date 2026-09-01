-- =====================================================================
-- Một lead có thể thuộc NHIỀU product.
--
-- Luật (chốt 2026-09-01):
--   - Vẫn là MỘT lead, MỘT người nhận. Ai nhận thì nhận cho cả hai product.
--   - Lead nằm trong pool của MỌI product nó mang.
--   - Bấm Distribute ở product nào thì chỉ vòng xoay của product ĐÓ nhúc nhích;
--     con trỏ của product còn lại không bị đụng tới.
--   - Gán xong thì lead rời khỏi pool của cả hai — vì nó chỉ có một chủ.
--   - `products = {}` / `product = null` nghĩa là chưa biết khách quan tâm gì.
--
-- Cách di trú: `products` là nguồn sự thật; cột `product` cũ được một trigger
-- giữ đồng bộ bằng phần tử đầu tiên, nên 33 chỗ đang đọc `lead.product` vẫn
-- chạy trong lúc chuyển dần sang đọc `products`.
--
-- Idempotent. Chạy lại lần hai là no-op.
-- =====================================================================

-- ---------- 1. Cột products ----------
-- Import được lead trước khi biết khách thuộc nhóm nào.
alter table leads alter column product drop not null;

alter table leads
  add column if not exists products text[] not null default '{}'::text[];

-- Backfill từ cột cũ trước khi áp ràng buộc, nếu không CHECK sẽ chặn ngay.
update leads
set products = array[product]
where cardinality(products) = 0 and product is not null;

alter table leads drop constraint if exists leads_products_valid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'leads_products_valid'
  ) then
    -- Cho phép MẢNG RỖNG: một lead có thể chưa được phân loại product. Nó
    -- không khớp pool của product nào nên không bị chia — đúng ý nghĩa "chưa
    -- biết", chứ không phải một trạng thái lỗi cần chặn.
    alter table leads add constraint leads_products_valid check (
      products <@ array['pc', 'health']::text[]
    );
  end if;
end $$;

-- GIN cho `products @> array[...]`: đường đọc nóng nhất là "pool của product X".
create index if not exists leads_products_idx on leads using gin (products);

-- ---------- 2. Giữ cột `product` cũ đồng bộ ----------
-- Không xoá `product` trong đợt này. Nó vẫn được đọc ở hàng chục chỗ, và đổi
-- schema cùng lúc với đổi toàn bộ đường đọc là hai rủi ro cộng vào nhau. Trigger
-- làm `product` thành thứ phái sinh, nên không thể lệch khỏi `products`.
create or replace function lead_sync_primary_product()
returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE'
    and new.products is distinct from old.products then
    -- `products` is authoritative when it was edited. This branch must run
    -- for an empty array too; otherwise removing the last product would see
    -- the old scalar `product` and immediately add it back.
    new.products := array(
      select p from unnest(array['pc', 'health']) as p where p = any (new.products)
    );
    new.product := new.products[1];
  elsif tg_op = 'UPDATE'
    and new.products is not distinct from old.products
    and new.product is distinct from old.product then
    -- Inline edit vẫn gửi cột `product` riêng. Một lần chọn product mới phải
    -- bỏ trạng thái multi-product cũ thay vì để trigger giữ giá trị cũ.
    new.products := case
      when new.product is null then '{}'::text[]
      else array[new.product]
    end;
  elsif new.products is null or cardinality(new.products) = 0 then
    -- Insert kiểu cũ (chỉ set `product`) vẫn hợp lệ: suy ngược ra mảng. Cả hai
    -- NULL/empty đều được giữ nguyên để biểu diễn "chưa biết product".
    new.products := case
      when new.product is null then '{}'::text[]
      else array[new.product]
    end;
  else
    -- Thứ tự cố định để `product` không đổi chỉ vì mảng được ghi khác thứ tự.
    new.products := array(
      select p from unnest(array['pc', 'health']) as p where p = any (new.products)
    );
    new.product := new.products[1];
  end if;
  return new;
end $$;

drop trigger if exists lead_sync_primary_product_trg on leads;
create trigger lead_sync_primary_product_trg
  before insert or update of products, product on leads
  for each row execute function lead_sync_primary_product();

-- ---------- 3. RPC chia lead: khớp theo THÀNH VIÊN mảng ----------
-- Chỉ đổi đúng một mệnh đề: `l.product = p_product` thành `p_product = any(...)`.
-- Phần con trỏ giữ nguyên — nó vốn chỉ đụng lead_assignment_weights của
-- p_product, nên "bên còn lại không ảnh hưởng queue" là đúng sẵn.
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
  if p_product is null or p_product not in ('pc', 'health') then
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

-- ---------- 4. RPC ghi tương tác không còn ràng theo product ----------
-- Nó đã bỏ kiểm `st.product = lead_value.product` ở đợt gộp status; ở đây chỉ
-- xác nhận lại rằng không còn chỗ nào ràng status vào một product duy nhất.

-- ---------- Kiểm chứng ----------
-- Một dòng. Cả bốn cột phải đọc ok.
select
  case when exists (select 1 from information_schema.columns
                    where table_name = 'leads' and column_name = 'products')
       then 'ok' else 'FAIL: thiếu cột products' end                   as products_column,
  -- Lead có `product` mà mảng rỗng nghĩa là backfill sót; mảng rỗng VÀ product
  -- null là trạng thái "chưa phân loại" hợp lệ.
  case when (select count(*) from leads
             where product is not null and cardinality(products) = 0) = 0
       then 'ok' else 'FAIL: có lead chưa backfill' end                as backfilled,
  case when (select count(*) from leads
             where product is distinct from products[1]
               and not (product is null and cardinality(products) = 0)) = 0
       then 'ok' else 'FAIL: product lệch products[1]' end             as in_sync,
  case when exists (select 1 from pg_indexes where indexname = 'leads_products_idx')
       then 'ok' else 'FAIL: thiếu index GIN' end                      as gin_index;
