-- =====================================================================
-- Provider List: tên + nhóm quyền trong Role Manager (2026-10-31)
--
-- Code đã làm `automation.provider_manage` bao gồm `automation.provider_finder`
-- như task.manage / task.work. File này chỉ đổi phần HIỂN THỊ trong Role
-- Manager cho khớp:
--
--   automation.provider_finder  "Provider Finder"        → "Provider List - Work"
--   automation.provider_manage  "Provider List - Manage" (giữ tên)
--   nhóm "Automation"  →  nhóm riêng "Provider List" (Manage 100, Work 200),
--   như Tasks / Lead Management.
--
-- KHÔNG đổi key, không đụng role_permissions / user_roles: không ai được
-- thêm hay mất quyền. Idempotent — chạy lại không đổi gì thêm.
-- =====================================================================

begin;

update permissions
set label = 'Provider List - Manage',
    group_key = 'provider_list',
    group_label = 'Provider List',
    sort_order = 100,
    description = 'Everything in Provider List - Work, plus: add straight to the list, review the Backlog, delete addresses, comment, export, and change the Provider List columns.'
where key = 'automation.provider_manage';

update permissions
set label = 'Provider List - Work',
    group_key = 'provider_list',
    group_label = 'Provider List',
    sort_order = 200,
    description = 'Open the Provider List and its Finder, edit cells, and add or import addresses into the Backlog for review.'
where key = 'automation.provider_finder';

-- Kiểm: phải ra đúng 2 dòng trong nhóm provider_list.
select key, label, group_key, group_label, sort_order
from permissions
where key in ('automation.provider_finder', 'automation.provider_manage')
order by sort_order;

commit;
