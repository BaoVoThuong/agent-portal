-- =====================================================================
-- Tự chia lead theo tỉ lệ (smooth weighted round-robin).
--
-- Lead import vào để trống người nhận; cơ chế này chia chúng cho agent theo
-- tỉ lệ admin cấu hình, XEN KẼ chứ không chia khối, và TÁCH THEO PRODUCT.
--
-- Thuật toán nằm ở src/lib/leads/round-robin.ts (có test cho dãy cụ thể);
-- file này giữ TRẠNG THÁI và KHOÁ, hai thứ không thể nằm ở Node.
--
-- Idempotent. Chạy lại lần hai là no-op.
-- =====================================================================

-- ---------- 1. Bảng trọng số ----------
create table if not exists lead_assignment_weights (
  product text not null check (product in ('pc', 'health')),
  agent_email text not null,
  -- Số nguyên, KHÔNG phải phần trăm: lưu phần trăm thì tổng phải luôn bằng 100,
  -- nên thêm một agent là buộc phải sửa mọi dòng còn lại. Với trọng số, thêm
  -- một người weight 30 vào (70,30) thành 54/23/23 mà không đụng gì.
  weight integer not null default 1 check (weight >= 0),
  -- Con trỏ smooth WRR. PHẢI nằm ở đây chứ không tính lại mỗi lượt: nếu mỗi
  -- lượt import khởi tạo lại từ 0 thì mười lần import mỗi lần một lead sẽ cùng
  -- rơi vào người đầu tiên.
  current_weight integer not null default 0,
  position integer not null default 0,
  is_active boolean not null default true,
  updated_by_email text,
  updated_at timestamptz not null default now(),
  primary key (product, agent_email)
);

alter table lead_assignment_weights enable row level security;

-- Bật/tắt toàn cục, mặc định TẮT. Đặt sai tỉ lệ rồi import 2.000 lead là một mớ
-- phải gỡ bằng tay; admin bật sau khi đã xem trước phân bổ.
alter table lead_alert_settings
  add column if not exists auto_assign_enabled boolean not null default false;

create index if not exists lead_assignment_weights_active_idx
  on lead_assignment_weights (product, position, agent_email)
  where is_active and weight > 0;

-- ---------- 2. RPC chia lead ----------
-- Gán nhiều lead đang ở pool theo smooth WRR VÀ ghi lịch sử gán, trong CÙNG một
-- transaction. Route /api/leads/assign hiện tại update trước rồi mới insert
-- history và chỉ console.error khi history hỏng — audit trail mất mà vẫn báo
-- thành công. Đường này không lặp lại lỗi đó.
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

  -- Chuẩn hoá một lần thay vì lower() trong từng vòng lặp.
  select coalesce(array_agg(lower(btrim(value))), array[]::text[])
  into eligible
  from unnest(coalesce(p_eligible_emails, array[]::text[])) as value
  where btrim(value) <> '';

  -- Khoá các dòng trọng số của product này TRƯỚC KHI đọc. Không khoá thì hai
  -- lượt import chạy song song cùng đọc một current_weight và tỉ lệ hỏng im
  -- lặng — không có lỗi nào để nhìn thấy, chỉ có phân bổ sai.
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

  -- Không ai hợp lệ: lead ở lại pool. Đây KHÔNG phải lỗi — làm hỏng cả lượt
  -- import 2.000 dòng vì thiếu cấu hình tỉ lệ là hỏng việc lớn vì việc nhỏ.
  if total_weight <= 0 then
    return;
  end if;

  foreach target_lead in array coalesce(p_lead_ids, array[]::uuid[]) loop
    -- Bước 1: cộng weight cho MỌI ứng viên, trước mọi so sánh.
    update lead_assignment_weights w
    set current_weight = w.current_weight + w.weight
    where w.product = p_product
      and w.is_active
      and w.weight > 0
      and lower(w.agent_email) = any (eligible);

    -- Bước 2: chọn current_weight lớn nhất. ORDER BY phá hoà cố định —
    -- thiếu nó thì kết quả phụ thuộc thứ tự Postgres trả về, tức không tái
    -- lập được và không đối chiếu được với test của thuật toán bên Node.
    select w.agent_email into best_email
    from lead_assignment_weights w
    where w.product = p_product
      and w.is_active
      and w.weight > 0
      and lower(w.agent_email) = any (eligible)
    order by w.current_weight desc, w.position asc, w.agent_email asc
    limit 1;

    -- Bước 3: trừ tổng weight của người được chọn.
    update lead_assignment_weights w
    set current_weight = w.current_weight - total_weight,
        updated_at = now()
    where w.product = p_product and w.agent_email = best_email;

    -- Chỉ chạm lead đang thật sự ở pool. `assigned_to_email is null` là hàng
    -- rào chống chia lại một lead ai đó vừa nhận giữa chừng.
    update leads l
    set assigned_to_email = best_email,
        assigned_at = now(),
        assigned_by_email = actor_value,
        updated_at = now(),
        updated_by_email = actor_value
    where l.id = target_lead
      and l.archived_at is null
      and l.assigned_to_email is null
      and l.product = p_product;

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

-- ---------- 3. Gợi ý seed ----------
-- Đã kiểm production 2026-09-01: role `Health Agent` có 13 người đang hoạt
-- động, `P&C Agent` RỖNG. Vì vậy không thể suy product từ role — chỉ seed
-- Health làm gợi ý, và seed với is_active = false: admin phải chủ động bật và
-- đặt tỉ lệ, chứ không phải phát hiện ra lead đã tự chia mất rồi.
insert into lead_assignment_weights (product, agent_email, weight, position, is_active)
select 'health', pa.email, 1, row_number() over (order by pa.email), false
from portal_account pa
join user_roles ur on ur.user_id = pa.id
join roles r on r.id = ur.role_id
where r.name = 'Health Agent' and pa.is_active
on conflict (product, agent_email) do nothing;

-- ---------- Kiểm chứng ----------
-- Một dòng. Cả bốn cột phải đọc ok.
select
  case when to_regclass('public.lead_assignment_weights') is not null
       then 'ok' else 'FAIL: thiếu bảng trọng số' end                as weights_table,
  case when exists (select 1 from pg_proc where proname = 'assign_leads_round_robin')
       then 'ok' else 'FAIL: thiếu RPC' end                          as rpc,
  case when exists (select 1 from information_schema.columns
                    where table_name = 'lead_alert_settings'
                      and column_name = 'auto_assign_enabled')
       then 'ok' else 'FAIL: thiếu cờ bật/tắt' end                   as toggle,
  -- Không khẳng định "có ít nhất 1 dòng": một DB chưa có tài khoản Health Agent
  -- nào thì seed đúng 0 dòng, và đó vẫn là đúng. Khẳng định seed đã chạy HẾT
  -- những gì nó phải chạy.
  case when (select count(*) from lead_assignment_weights where product = 'health')
          >= (select count(distinct pa.email)
              from portal_account pa
              join user_roles ur on ur.user_id = pa.id
              join roles r on r.id = ur.role_id
              where r.name = 'Health Agent' and pa.is_active)
       then 'ok' else 'FAIL: seed Health chưa đủ' end                   as seeded;
