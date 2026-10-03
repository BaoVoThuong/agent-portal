-- =====================================================================
-- Personal lead = lead KHÔNG có event (2026-10-03).
--
-- Lead type (Event lead / Personal lead) không phải một cột: nó suy ra từ
-- `leads.event_id` — xem src/lib/leads/lead-type.ts. Trước khi có Lead type,
-- người dùng gõ tay một event tên "Personal Lead" để đánh dấu lead cá nhân
-- (kiểm read-only ngày 2026-10-03: 1 event, 2 lead — LEAD-227 và LEAD-228).
-- Để nguyên thì hai lead đó bị tính là Event lead của một event giả.
--
-- 1. Bỏ event khỏi các lead đang trỏ vào event "Personal Lead".
-- 2. Archive event đó để nó không còn trong gợi ý và báo cáo theo event.
--
-- Đã kiểm trước: bỏ event không đụng `leads_phone_no_event_unique_idx` — không
-- lead nào khác thiếu event mà trùng số với LEAD-227/228, và hai lead này
-- không trùng số nhau. Chạy lại an toàn: lần hai không còn dòng nào khớp.
-- =====================================================================

begin;

-- Một Event legacy tên "Personal Lead" không được giữ pool. Bảng pool chỉ có
-- sau rollout Event pools, vì vậy dùng to_regclass để file vẫn chạy được trước
-- hoặc sau rollout đó.
do $$
begin
  if to_regclass('public.lead_event_assignment_weights') is not null then
    delete from public.lead_event_assignment_weights weights
    using public.lead_events event_row
    where weights.event_id = event_row.id
      and lower(regexp_replace(btrim(event_row.name), '\s+', ' ', 'g'))
          in ('personal', 'personal lead', 'personal leads');
  end if;
  if to_regclass('public.lead_event_assignment_settings') is not null then
    delete from public.lead_event_assignment_settings settings
    using public.lead_events event_row
    where settings.event_id = event_row.id
      and lower(regexp_replace(btrim(event_row.name), '\s+', ' ', 'g'))
          in ('personal', 'personal lead', 'personal leads');
  end if;
end $$;

update leads l
set event_id = null,
    updated_at = now()
from lead_events e
where l.event_id = e.id
  and lower(regexp_replace(btrim(e.name), '\s+', ' ', 'g'))
      in ('personal', 'personal lead', 'personal leads');

update lead_events
set archived_at = now(),
    updated_at = now()
where archived_at is null
  and lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))
      in ('personal', 'personal lead', 'personal leads');

commit;

-- Kiểm sau khi chạy (phải ra 0 dòng):
-- select l.display_number, e.name
-- from leads l join lead_events e on e.id = l.event_id
-- where lower(regexp_replace(btrim(e.name), '\s+', ' ', 'g'))
--       in ('personal', 'personal lead', 'personal leads');
