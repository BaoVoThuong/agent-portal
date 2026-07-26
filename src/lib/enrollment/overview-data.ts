import { getSupabaseAdmin } from "@/lib/supabase";
import { resolveReminderSettings } from "@/lib/tasks/reminder-settings";
import { aggregateEnrollmentOverview } from "./overview";
import {
  ENROLLMENT_OVERVIEW_THRESHOLDS,
  type EnrollmentOverviewAccount,
  type EnrollmentOverviewRecordInput,
  type EnrollmentOverviewSnapshot,
} from "./overview-types";
import type { EnrollmentOption, EnrollmentProgram } from "./types";

const OVERVIEW_RECORD_COLUMNS =
  "id,program,client_name,stage_id,responsible_enroll_email,due_date,qc_checked_at,closed_at,created_at,updated_at,archived_at";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function fetchEnrollmentOverview(
  program: EnrollmentProgram,
  now = new Date()
): Promise<EnrollmentOverviewSnapshot> {
  const supabase = getSupabaseAdmin();
  const [accountsResult, rolesResult, rolePermissionsResult, userRolesResult, stageSetResult, recordsResult, reminderResult] =
    await Promise.all([
      supabase.from("portal_account").select("id,email,name,is_active,role"),
      supabase.from("roles").select("id,name,is_active"),
      supabase
        .from("role_permissions")
        .select("role_id,permission_key")
        .in("permission_key", ["task.work", "task.manage"]),
      supabase.from("user_roles").select("user_id,role_id"),
      supabase
        .from("enrollment_option_sets")
        .select("id")
        .eq("program", program)
        .eq("key", "stage")
        .maybeSingle(),
      supabase
        .from("enrollment_records")
        .select(OVERVIEW_RECORD_COLUMNS)
        .eq("program", program)
        .is("archived_at", null),
      supabase.from("task_reminder_settings").select("*").maybeSingle(),
    ]);

  const firstError = [
    accountsResult.error,
    rolesResult.error,
    rolePermissionsResult.error,
    userRolesResult.error,
    stageSetResult.error,
    recordsResult.error,
    reminderResult.error,
  ].find(Boolean);
  if (firstError) throw new Error(firstError.message);

  const accounts = (accountsResult.data ?? []) as Array<{
    id: string;
    email: string;
    name: string | null;
    is_active: boolean;
    role: string;
  }>;
  const roles = (rolesResult.data ?? []) as Array<{ id: string; name: string; is_active: boolean }>;
  const rolePermissions = (rolePermissionsResult.data ?? []) as Array<{
    role_id: string;
    permission_key: string;
  }>;
  const userRoles = (userRolesResult.data ?? []) as Array<{ user_id: string; role_id: string }>;

  const activeRoleIds = new Set(roles.filter((role) => role.is_active).map((role) => role.id));
  const workRoleIds = new Set(
    rolePermissions
      .filter((row) => row.permission_key === "task.work" && activeRoleIds.has(row.role_id))
      .map((row) => row.role_id)
  );
  const activeAdminRoleIds = new Set(
    roles
      .filter((role) => role.is_active && (role.name === "Admin" || role.name === "Super Admin"))
      .map((role) => role.id)
  );
  const workUserIds = new Set(userRoles.filter((row) => workRoleIds.has(row.role_id)).map((row) => row.user_id));
  const adminUserIds = new Set(
    userRoles.filter((row) => activeAdminRoleIds.has(row.role_id)).map((row) => row.user_id)
  );

  const normalizedAccounts: EnrollmentOverviewAccount[] = accounts
    .filter((account) => account.is_active)
    .map((account) => ({
      email: normalizeEmail(account.email),
      name: account.name,
      isActive: account.is_active,
      canWork: workUserIds.has(account.id),
      isAdmin: account.role === "admin" || adminUserIds.has(account.id),
    }))
    .filter((account) => account.canWork || account.isAdmin);

  const stageSet = stageSetResult.data as { id: string } | null;
  let stageOptions: EnrollmentOption[] = [];
  if (stageSet) {
    const { data: stageOptionRows, error: stageOptionsError } = await supabase
      .from("enrollment_options")
      .select("id,set_id,label,color,position,is_terminal,triggers_qc,archived_at")
      .eq("set_id", stageSet.id)
      .is("archived_at", null)
      .order("position", { ascending: true });
    if (stageOptionsError) throw new Error(stageOptionsError.message);
    stageOptions = (stageOptionRows ?? []).map((option) => ({ ...option, set_key: "stage" as const }));
  }

  const records = ((recordsResult.data ?? []) as EnrollmentOverviewRecordInput[]).map((record) => ({
    ...record,
    responsible_enroll_email: record.responsible_enroll_email
      ? normalizeEmail(record.responsible_enroll_email)
      : null,
  }));

  const reminderSettings = resolveReminderSettings(reminderResult.data);

  return aggregateEnrollmentOverview({
    now,
    program,
    accounts: normalizedAccounts,
    stageOptions,
    records,
    thresholds: ENROLLMENT_OVERVIEW_THRESHOLDS,
    qcStaleHours: reminderSettings.qcHours,
  });
}
