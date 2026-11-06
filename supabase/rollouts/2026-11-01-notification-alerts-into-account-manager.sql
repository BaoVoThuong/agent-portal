-- =====================================================================
-- Notification Alerts gộp vào Account Manager (2026-11-01)
--
-- Code mới: ai có `management.account_manager` là bật/tắt được Alerts của
-- từng user (trang Account Manager + PATCH /api/admin/users/[id]/notification-alerts).
-- Key `management.notification_alerts` không còn trong code; file này gỡ nó
-- khỏi DB để Role Manager không hiện nó ở mục "Other".
--
-- Lúc viết, chỉ role Admin có quyền này, và Admin cũng có Account Manager:
-- không ai mất hay thêm quyền.
--
-- Chạy SAU khi deploy code: code cũ còn đòi key này cho cột Alerts.
-- Idempotent.
-- =====================================================================

begin;

delete from role_permissions where permission_key = 'management.notification_alerts';
delete from permissions where key = 'management.notification_alerts';

update permissions
set description = 'Create accounts, assign roles, update status, reset passwords, manage Agents and Assistants, and turn notification alerts on or off for each user.'
where key = 'management.account_manager';

commit;

-- Kiểm: không còn dòng nào.
select count(*) as left_over from permissions where key = 'management.notification_alerts';

notify pgrst, 'reload schema';
