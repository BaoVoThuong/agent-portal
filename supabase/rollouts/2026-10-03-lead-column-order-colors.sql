-- =====================================================================
-- Lead: thứ tự cột + màu lựa chọn (2026-10-03)
--
-- 1. THỨ TỰ CỘT mặc định của bảng Lead (mỗi người chỉ ẩn/hiện cột, không tự
--    xếp — nên đây là thứ tự mọi người thấy). Nhóm theo cách form Add lead và
--    drawer đã xếp:
--      Khách       Name · Phone · Email · Age · Gender
--      Tiến độ     Status · Follow up
--      Lead        Event · Product · Insurance Needs · Agent · Collaborators ·
--                  Contact Method · Best Time to Contact · Ticket #
--      Liên hệ     Last contact · Interaction history · Attempts
--      Khác        Secondary Phone · FUB Link · Tag · Key · Created date
--    Bước 10 để admin còn chèn cột vào giữa. Cờ ẩn/ghim giữ nguyên.
--
-- 2. MÀU LỰA CHỌN — có ý nghĩa, không ngẫu nhiên:
--    - Insurance Needs theo HỌ MÀU của Product đang dùng: xanh lá = Health,
--      xanh dương = P&C, tím = Life (đậm/nhạt để phân biệt trong cùng họ).
--    - Contact Method theo màu loại tương tác đang dùng: Phone = Call (xanh
--      dương), Text (xanh lá), Email (tím).
--    - Best Time: AM vàng (sáng), PM chàm (tối). Gender: Female hồng, Male xanh.
--    Màu lưu là màu gốc; nhãn trên màn hình là bản nhạt của nó
--    (taskCategoryBadgePalette). Admin đổi lại được ở Config.
--
-- Chỉ đổi theo key/nhãn, chạy lại an toàn.
-- =====================================================================

begin;

update public.table_column c
set position = v.position,
    updated_at = now()
from (values
  ('name',                 10),
  ('phone',                20),
  ('email',                30),
  ('age',                  40),
  ('gender',               50),
  ('status',               60),
  ('followUp',             70),
  ('event',                80),
  ('product',              90),
  ('insurance_needs',     100),
  ('assignee',            110),
  ('collaborators',       120),
  ('contact_method',      130),
  ('best_time_to_contact',140),
  ('ticket_number',       150),
  ('lastContact',         160),
  ('interactionHistory',  170),
  ('attempts',            180),
  ('secondary_phone',     190),
  ('fub',                 200),
  ('tag',                 210),
  ('key',                 220),
  ('createdAt',           230)
) as v(key, position)
where c.scope = 'lead'
  and c.key = v.key;

update public.table_column_option o
set color = v.color,
    updated_at = now()
from public.table_column c,
  (values
    ('insurance_needs',      'Health Insurance', '#36b37e'),
    ('insurance_needs',      'Medicare',         '#00875a'),
    ('insurance_needs',      'Medicaid',         '#57d9a3'),
    ('insurance_needs',      'Obamacare',        '#00a3bf'),
    ('insurance_needs',      'Auto Insurance',   '#4c9aff'),
    ('insurance_needs',      'Home Insurance',   '#0052cc'),
    ('insurance_needs',      'Life Insurance',   '#6554c0'),
    ('insurance_needs',      'College Funding',  '#8777d9'),
    ('contact_method',       'Phone',            '#4c9aff'),
    ('contact_method',       'Text',             '#36b37e'),
    ('contact_method',       'Email',            '#6554c0'),
    ('best_time_to_contact', 'AM',               '#ffab00'),
    ('best_time_to_contact', 'PM',               '#5243aa'),
    ('gender',               'Female',           '#e774bb'),
    ('gender',               'Male',             '#4c9aff')
  ) as v(column_key, label, color)
where o.column_id = c.id
  and c.scope = 'lead'
  and c.key = v.column_key
  and lower(o.label) = lower(v.label)
  and o.archived_at is null;

commit;

-- Kiểm sau khi chạy:
-- select position, key, label from public.table_column
-- where scope = 'lead' and archived_at is null order by position;
