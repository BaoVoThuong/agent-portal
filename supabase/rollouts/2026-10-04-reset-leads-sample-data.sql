-- ═══════════════════════════════════════════════════════════════════════
-- XOÁ TOÀN BỘ LEAD MẪU TRƯỚC KHI NHẬP DỮ LIỆU THẬT  —  2026-10-04
--
--                    ⛔ XOÁ DỮ LIỆU. CHỈ CHẠY MỘT LẦN. ⛔
--
--        FILE NÀY *KHÔNG* IDEMPOTENT. Chạy lần hai sẽ xoá lead thật.
--        PHẦN 0 có chốt chặn để lần hai dừng lại thay vì phá.
--
-- ───────────────────────────────────────────────────────────────────────
-- LÀM TRƯỚC KHI CHẠY
--
--   1. Xác nhận đang ở ĐÚNG database và chỉ có lead mẫu. Chạy riêng:
--        select count(*) as tong,
--               count(*) filter (where archived_at is null) as dang_hien,
--               min(created_at), max(created_at)
--        from leads;
--      Màn Lead đang hiện 94 lead. Nếu đã lỡ Import file thật (vd. Mid-Autumn
--      Festival 0926) thì những lead đó CŨNG bị xoá.
--   2. Đừng Import / tạo lead trong lúc chạy.
--
-- ───────────────────────────────────────────────────────────────────────
-- PHẠM VI (user chốt 2026-10-04: "tất cả lead hiện có", "xoá hẳn")
--   XOÁ:  leads (mọi dòng, kể cả đã archive)
--         └ cascade: lead_interactions, lead_comments (cả reply),
--                    lead_attachments, lead_assignment_history
--         lead_events (mọi event — không còn lead nào trỏ tới)
--         └ cascade: lead_event_assignment_settings / _weights (nếu đã có)
--         Số LD chạy lại từ 1.
--   GIỮ:  lead_statuses, lead_interaction_types, lead_alert_settings,
--         Table Configuration (cột/option Lead), Agent membership, tài khoản.
--
-- File đính kèm trong Storage KHÔNG tự mất theo (xem SAU KHI CHẠY).
-- ═══════════════════════════════════════════════════════════════════════

-- ═══ PHẦN 0 — CHỐT CHẶN ═══════════════════════════════════════════════
do $$
declare
  lead_count bigint;
begin
  if to_regclass('public._bk_20261004_leads') is not null then
    raise exception
      'ĐÃ CHẠY RỒI. Bảng _bk_20261004_* đang tồn tại. Chạy lại sẽ xoá lead thật '
      'phát sinh sau đó. Muốn chạy lại thật thì xoá tay các bảng _bk_20261004_* '
      'trước, sau khi chắc chắn không cần chúng nữa.';
  end if;
  select count(*) into lead_count from public.leads;
  -- Dữ liệu mẫu là ~94 lead. Nhiều hơn hẳn nghĩa là đã có dữ liệu thật.
  if lead_count > 150 then
    raise exception
      'Đang có % lead — nhiều hơn dữ liệu mẫu (~94). Kiểm lại trước khi xoá; '
      'muốn xoá thật thì sửa ngưỡng 150 trong file.', lead_count;
  end if;
end $$;

begin;

-- ═══ PHẦN 1 — SAO LƯU ĐỂ TRA CỨU ══════════════════════════════════════
-- Ảnh chụp để tra cứu, KHÔNG phải đường khôi phục: `create table as select`
-- không chép ràng buộc/index/default. Cố ý không dùng `if not exists`.
create table public._bk_20261004_leads                   as select * from public.leads;
create table public._bk_20261004_lead_interactions       as select * from public.lead_interactions;
create table public._bk_20261004_lead_comments           as select * from public.lead_comments;
create table public._bk_20261004_lead_attachments        as select * from public.lead_attachments;
create table public._bk_20261004_lead_assignment_history as select * from public.lead_assignment_history;
create table public._bk_20261004_lead_events             as select * from public.lead_events;

-- Bảng mới trong `public` mặc định TẮT row level security — mà chúng chứa PII
-- khách (tên, số điện thoại, email, ghi chú). Bật tay để API công khai không
-- đọc được.
alter table public._bk_20261004_leads                   enable row level security;
alter table public._bk_20261004_lead_interactions       enable row level security;
alter table public._bk_20261004_lead_comments           enable row level security;
alter table public._bk_20261004_lead_attachments        enable row level security;
alter table public._bk_20261004_lead_assignment_history enable row level security;
alter table public._bk_20261004_lead_events             enable row level security;

-- Pool theo Event chỉ có sau rollout 2026-10-03-lead-remove-product-event-pools.
do $$
begin
  if to_regclass('public.lead_event_assignment_settings') is not null then
    execute 'create table public._bk_20261004_lead_event_assignment_settings as select * from public.lead_event_assignment_settings';
    execute 'alter table public._bk_20261004_lead_event_assignment_settings enable row level security';
  end if;
  if to_regclass('public.lead_event_assignment_weights') is not null then
    execute 'create table public._bk_20261004_lead_event_assignment_weights as select * from public.lead_event_assignment_weights';
    execute 'alter table public._bk_20261004_lead_event_assignment_weights enable row level security';
  end if;
end $$;

-- ═══ PHẦN 2 — XOÁ ═════════════════════════════════════════════════════
delete from public.leads;        -- 4 bảng con tự cascade
delete from public.lead_events;  -- settings/weights của pool tự cascade

commit;

-- ═══ PHẦN 3 — ĐÁNH SỐ LẠI TỪ 1 ════════════════════════════════════════
-- Cố ý NGOÀI transaction (setval không bao giờ rollback): chỉ chạy khi việc
-- xoá đã thành công, nếu không lead cũ còn nguyên mà sequence phát lại số cũ
-- → mọi lần tạo lead đều đụng khoá trùng display_number.
-- `false` = số TIẾP THEO là 1 (LD001).
select setval('public.leads_display_number_seq', 1, false);

-- ═══ KIỂM TRA — mọi dòng phải ✅ ═══════════════════════════════════════
select
  case when ok then '✅' else '❌ SAI' end as "Kết quả",
  name as "Kiểm tra", detail as "Giá trị"
from (
  select 1 as sort, 'leads đã rỗng' as name,
    (select count(*) from public.leads) = 0 as ok, (select count(*)::text from public.leads) as detail
  union all select 2, 'lead_interactions đã cascade',
    (select count(*) from public.lead_interactions) = 0, (select count(*)::text from public.lead_interactions)
  union all select 3, 'lead_comments đã cascade',
    (select count(*) from public.lead_comments) = 0, (select count(*)::text from public.lead_comments)
  union all select 4, 'lead_attachments đã cascade',
    (select count(*) from public.lead_attachments) = 0, (select count(*)::text from public.lead_attachments)
  union all select 5, 'lead_assignment_history đã cascade',
    (select count(*) from public.lead_assignment_history) = 0, (select count(*)::text from public.lead_assignment_history)
  union all select 6, 'lead_events đã rỗng',
    (select count(*) from public.lead_events) = 0, (select count(*)::text from public.lead_events)
  union all select 7, 'lead_statuses còn nguyên',
    (select count(*) from public.lead_statuses) > 0, (select count(*)::text from public.lead_statuses)
  union all select 8, 'lead_interaction_types còn nguyên',
    (select count(*) from public.lead_interaction_types) > 0, (select count(*)::text from public.lead_interaction_types)
  union all select 9, 'đã sao lưu lead (số lead bị xoá)',
    (select count(*) from public._bk_20261004_leads) > 0, (select count(*)::text from public._bk_20261004_leads)
  union all select 10, 'file đính kèm cần dọn trong Storage',
    true, (select count(*)::text from public._bk_20261004_lead_attachments)
  union all select 11, 'lead tiếp theo sẽ là LD001',
    (select last_value = 1 and not is_called from public.leads_display_number_seq),
    (select last_value::text from public.leads_display_number_seq)
) checks
order by sort;

-- ───────────────────────────────────────────────────────────────────────
-- SAU KHI CHẠY
--
--   1. File đính kèm: dòng lead_attachments đã xoá nhưng file vẫn nằm trong
--      Storage. Supabase → Storage → bucket `task-attachments` → xoá thư mục
--      `leads/` (mọi file của lead đều nằm dưới đó; file của Task nằm ở
--      `tasks/` — KHÔNG đụng). Danh sách file:
--        select storage_path from public._bk_20261004_lead_attachments;
--   2. Reload trang Lead (realtime không phát cho thao tác SQL tay).
--   3. Khi chắc không cần tra cứu nữa, xoá các bảng sao lưu:
--        drop table public._bk_20261004_leads, public._bk_20261004_lead_interactions,
--          public._bk_20261004_lead_comments, public._bk_20261004_lead_attachments,
--          public._bk_20261004_lead_assignment_history, public._bk_20261004_lead_events;
--        drop table if exists public._bk_20261004_lead_event_assignment_settings,
--          public._bk_20261004_lead_event_assignment_weights;
-- ───────────────────────────────────────────────────────────────────────
