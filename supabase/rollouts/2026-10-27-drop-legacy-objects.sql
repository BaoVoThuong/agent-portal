-- ═══════════════════════════════════════════════════════════════════════
-- 2026-10-27 — Dọn object thừa sau audit Supabase (mục S2, S3, S4 trong
-- docs/2026-10-27-supabase-cost-audit.md)
--
-- Xoá:
--   • hàm ai_run_select(text): SECURITY DEFINER, chạy SQL tuỳ ý bằng quyền
--     owner. Không có trong repo, không code nào gọi.
--   • hàm create_adaptive_test(...): của project MathIGCSE, tạo nhầm ở đây.
--   • 20 bảng _bk_20260817_* / _bk_20261004_* (bản chụp trước 2 lần reset).
--   • 3 bảng legacy: health_client_submission, pc_month_base_policy,
--     role_permissions_lead_timeoff_backup.
--   • schema access_backup (10 bảng chụp quyền ngày 16–17/10).
--
-- Trước khi chạy: đã xuất CSV đủ 33 bảng (số dòng khớp) ra
--   ~/Project/Web/_db-backups/eps-legacy-tables-2026-10-27
-- Trong đó có dữ liệu khách và nhân viên: chỉ giữ local.
--
-- Không dùng CASCADE: object nào bất ngờ còn phụ thuộc thì cả khối rollback.
-- Chạy lại vô hại (if exists). Chốt chặn của 2026-08-17-reset-cs-for-golive.sql
-- từng dựa vào _bk_20260817_tasks, nên đã đổi sang chặn vô điều kiện trước khi xoá.
-- ═══════════════════════════════════════════════════════════════════════

begin;

drop function if exists public.ai_run_select(text);
drop function if exists public.create_adaptive_test(uuid, integer, integer, integer);

drop table if exists
  public._bk_20260817_tasks,
  public._bk_20260817_task_activity,
  public._bk_20260817_task_assignees,
  public._bk_20260817_task_assignment_cycles,
  public._bk_20260817_task_assignment_rotation,
  public._bk_20260817_task_attachments,
  public._bk_20260817_task_comment_edits,
  public._bk_20260817_task_comments,
  public._bk_20260817_task_notifications,
  public._bk_20260817_task_overdue_events,
  public._bk_20260817_task_participants,
  public._bk_20260817_task_stage_cycles;

drop table if exists
  public._bk_20261004_leads,
  public._bk_20261004_lead_assignment_history,
  public._bk_20261004_lead_attachments,
  public._bk_20261004_lead_comments,
  public._bk_20261004_lead_event_assignment_settings,
  public._bk_20261004_lead_event_assignment_weights,
  public._bk_20261004_lead_events,
  public._bk_20261004_lead_interactions;

drop table if exists
  public.health_client_submission,
  public.pc_month_base_policy,
  public.role_permissions_lead_timeoff_backup;

drop table if exists
  access_backup.agent_members,
  access_backup.notification_preferences,
  access_backup.portal_account,
  access_backup.positions,
  access_backup.role_permissions,
  access_backup.roles,
  access_backup.snapshots,
  access_backup.task_agents,
  access_backup.task_assignment_queue_members,
  access_backup.user_roles;
drop schema if exists access_backup;

commit;

-- Kiểm tra: không được ra dòng nào.
select n.nspname as schema, c.relname as object
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'access_backup'
   or (n.nspname = 'public' and (c.relname like '\_bk\_%'
       or c.relname in ('health_client_submission', 'pc_month_base_policy',
                        'role_permissions_lead_timeoff_backup')))
union all
select n.nspname, p.proname
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('ai_run_select', 'create_adaptive_test');
