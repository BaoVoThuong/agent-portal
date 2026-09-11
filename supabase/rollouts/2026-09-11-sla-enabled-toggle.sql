-- =====================================================================
-- Nút bật/tắt cho từng tổ hợp Category × Priority trong SLA Times.
--
-- Bối cảnh: đội cần "loại việc này không được đặt mức ưu tiên kia" — ví dụ
-- Order Physical ID card thì không được Urgent. Hệ thống chưa có chỗ khai điều
-- đó, nên admin mượn ô SLA: đặt ĐÚNG 5 phút để ngầm hiểu là cấm (2 giờ 5 phút,
-- tức 125, vẫn là SLA thật).
--
-- Quy ước ngầm ấy không chặn được gì. 5 phút vẫn là một SLA đang chạy, nên task
-- tạo bằng tổ hợp "cấm" sẽ quá hạn thật sau 5 phút: bắn thông báo, bôi đỏ bảng,
-- đếm vào KPI. Nó chỉ đẻ thêm cảnh báo giả.
--
-- Rollout này thay quy ước bằng một nút bật/tắt tường minh:
--   BẬT  → tổ hợp dùng được, và đặt được thời hạn SLA.
--   TẮT  → không đặt được thời hạn, và không chọn được tổ hợp khi tạo/sửa task.
--
-- ⚠ Chạy TRƯỚC khi deploy code: code mới đọc cột `is_enabled`.
-- ⚠ Sau khi chạy: `notify pgrst, 'reload schema';`
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Cột cờ. Mặc định BẬT, nên mọi tổ hợp đang có vẫn dùng được như cũ —
--    trừ những tổ hợp được chuyển đổi ở bước 2.
-- ---------------------------------------------------------------------
alter table task_sla_rules
  add column if not exists is_enabled boolean not null default true;

-- ---------------------------------------------------------------------
-- 2. Chuyển quy ước cũ sang nút mới.
--
-- ĐÚNG 5 phút mới là dấu cấm. 125 phút (2h05) là SLA thật, không đụng tới.
--
-- Thời hạn được đặt lại theo mặc định của từng mức ưu tiên (khớp
-- DEFAULT_SLA_MINUTES trong src/lib/tasks/sla.ts). Lý do không giữ lại số 5:
-- hôm nào đó admin bật lại tổ hợp này thì nó lập tức thành SLA 5 phút thật, mà
-- lúc ấy không ai còn nhớ con số đó vốn chỉ là dấu hiệu chứ không phải thời hạn.
-- ---------------------------------------------------------------------
update task_sla_rules
set
  is_enabled = false,
  duration_minutes = case priority
    when 'urgent' then 60
    when 'high' then 240
    when 'medium' then 480
    else 1440
  end,
  updated_at = clock_timestamp()
where duration_minutes = 5;

-- ---------------------------------------------------------------------
-- 3. RPC lưu nhận thêm cờ.
--
-- Giữ nguyên cơ chế kiểm phiên bản (`expected_updated_at`): hai admin sửa cùng
-- một ô thì người sau bị chặn chứ không ghi đè im lặng.
--
-- `p_is_enabled` có giá trị mặc định `true` để client cũ — chỉ gửi thời hạn —
-- không vô tình tắt mất một tổ hợp.
-- ---------------------------------------------------------------------
create or replace function public.save_task_sla_rule_atomic(
  p_priority text, p_category_id uuid, p_duration_minutes integer,
  p_expected_updated_at timestamptz default null, p_has_expected boolean default false,
  p_is_enabled boolean default true
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare existing_row public.task_sla_rules%rowtype; saved_row public.task_sla_rules%rowtype;
begin
  if p_priority not in ('low','medium','high','urgent') or p_duration_minutes is null or p_duration_minutes <= 0 then
    raise exception 'SLA_RULE_INVALID';
  end if;
  select * into existing_row from public.task_sla_rules
    where priority = p_priority and category_id is not distinct from p_category_id for update;
  if found then
    if not p_has_expected then raise exception 'SLA_RULE_VERSION_REQUIRED'; end if;
    if p_expected_updated_at is null or existing_row.updated_at is distinct from p_expected_updated_at then
      raise exception 'SLA_RULE_STALE';
    end if;
    update public.task_sla_rules
      set duration_minutes = p_duration_minutes,
          is_enabled = coalesce(p_is_enabled, true),
          updated_at = clock_timestamp()
      where id = existing_row.id returning * into saved_row;
  else
    if p_has_expected and p_expected_updated_at is not null then raise exception 'SLA_RULE_STALE'; end if;
    insert into public.task_sla_rules (priority, category_id, duration_minutes, is_enabled, updated_at)
      values (p_priority, p_category_id, p_duration_minutes, coalesce(p_is_enabled, true), clock_timestamp())
      returning * into saved_row;
  end if;
  return jsonb_build_object(
    'id', saved_row.id, 'priority', saved_row.priority, 'category_id', saved_row.category_id,
    'duration_minutes', saved_row.duration_minutes, 'is_enabled', saved_row.is_enabled,
    'updated_at', saved_row.updated_at
  );
end; $$;

revoke all on function public.save_task_sla_rule_atomic(text, uuid, integer, timestamptz, boolean, boolean)
  from public, anon, authenticated;
grant execute on function public.save_task_sla_rule_atomic(text, uuid, integer, timestamptz, boolean, boolean)
  to service_role;

-- ---------------------------------------------------------------------
-- Kiểm chứng
-- ---------------------------------------------------------------------

-- (a) Không còn dòng 5 phút; đúng 8 tổ hợp đang tắt.
select
  count(*) filter (where duration_minutes = 5) as con_lai_5_phut,
  count(*) filter (where not is_enabled) as to_hop_dang_tat,
  count(*) as tong_rule
from task_sla_rules;

-- (b) Tổ hợp nào đang tắt — đối chiếu bằng mắt với ý định của đội.
select
  coalesce(c.name, '(mặc định — mọi category)') as category,
  r.priority,
  r.duration_minutes as thoi_han_khi_bat_lai
from task_sla_rules r
left join task_categories c on c.id = r.category_id
where not r.is_enabled
order by 1, 2;

-- (c) SLA 2h05 phải còn nguyên.
select count(*) as sla_2h05_con_nguyen
from task_sla_rules
where duration_minutes = 125 and is_enabled;
