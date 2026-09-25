-- =====================================================================
-- Authz Phase B (plan final §I.4): version quyền theo account + nhãn Export/Import.
--
-- 1. portal_account.access_version — tăng khi quyền của account đổi, hoặc khi
--    định nghĩa role của họ đổi. Phiên so version (cache 30 giây) để làm mới
--    quyền ngay thay vì đợi TTL 5 phút. Code chịu được việc cột CHƯA có (coi như
--    "không biết" và giữ TTL cũ), nên thứ tự deploy/rollout không quan trọng.
-- 2. bump_account_access_version / bump_role_members_access_version — gọi từ
--    Account Manager và Role Manager.
-- 3. Đổi nhãn task.export / task.import: chúng dùng chéo domain (Enrollment,
--    Provider), không phải quyền "import task" (audit C9, plan D15).
--
-- Idempotent.
-- =====================================================================
begin;

alter table portal_account
  add column if not exists access_version integer not null default 0;

create or replace function bump_account_access_version(p_account_ids uuid[])
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update portal_account
  set access_version = access_version + 1
  where id = any(coalesce(p_account_ids, array[]::uuid[]));
$$;

create or replace function bump_role_members_access_version(p_role_id uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update portal_account
  set access_version = access_version + 1
  where id in (select user_id from user_roles where role_id = p_role_id);
$$;

revoke all on function bump_account_access_version(uuid[]) from public, anon, authenticated;
grant execute on function bump_account_access_version(uuid[]) to service_role;
revoke all on function bump_role_members_access_version(uuid) from public, anon, authenticated;
grant execute on function bump_role_members_access_version(uuid) to service_role;

update permissions
set label = 'Export (Task, Enrollment, Provider)',
    description = 'Export task, enrollment and provider tables to Excel. Required on its own — a manager role alone does not grant export.'
where key = 'task.export';

update permissions
set label = 'Import (Enrollment, Provider)',
    description = 'Import enrollment and provider tables from Excel. Not a task import — there is none. Enrollment import additionally requires a task admin role. Separate from Export because it OVERWRITES rows in bulk. Required on its own.'
where key = 'task.import';

commit;

-- Kiểm chứng
select
  (select count(*) from information_schema.columns
    where table_name = 'portal_account' and column_name = 'access_version') as has_access_version,
  (select label from permissions where key = 'task.import') as import_label;
