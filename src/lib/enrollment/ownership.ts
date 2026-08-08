import { getSupabaseAdmin } from "@/lib/supabase";

export const ENROLLMENT_OWNERSHIP_FIELDS = [
  "agent_email",
  "caller_email",
  "responsible_enroll_email",
] as const;

export type EnrollmentOwnershipField = (typeof ENROLLMENT_OWNERSHIP_FIELDS)[number];
export type EnrollmentOwnershipValues = Partial<
  Record<EnrollmentOwnershipField, string | null>
>;

export type InvalidEnrollmentOwnership = {
  field: EnrollmentOwnershipField;
  email: string;
};

export function findInvalidEnrollmentOwnership(
  values: EnrollmentOwnershipValues,
  activeEmails: ReadonlySet<string>,
  taskAgentEmails: ReadonlySet<string>
): InvalidEnrollmentOwnership | null {
  for (const field of ENROLLMENT_OWNERSHIP_FIELDS) {
    const email = normalizeEmail(values[field]);
    if (!email) continue;
    const allowed =
      field === "agent_email"
        ? taskAgentEmails.has(email)
        : activeEmails.has(email);
    if (!allowed) return { field, email };
  }
  return null;
}

export async function validateEnrollmentOwnership(
  values: EnrollmentOwnershipValues
): Promise<InvalidEnrollmentOwnership | null> {
  const requested = ENROLLMENT_OWNERSHIP_FIELDS.some((field) => normalizeEmail(values[field]));
  if (!requested) return null;

  const supabase = getSupabaseAdmin();
  const [accountsResult, taskAgentsResult] = await Promise.all([
    supabase.from("portal_account").select("email").eq("is_active", true),
    supabase.from("task_agents").select("email"),
  ]);
  if (accountsResult.error) throw new Error(accountsResult.error.message);
  if (taskAgentsResult.error) throw new Error(taskAgentsResult.error.message);

  const activeEmails = new Set(
    ((accountsResult.data ?? []) as Array<{ email?: unknown }>)
      .map((row) => normalizeEmail(row.email))
      .filter(Boolean)
  );
  const selectedAgentEmails = new Set(
    ((taskAgentsResult.data ?? []) as Array<{ email?: unknown }>)
      .map((row) => normalizeEmail(row.email))
      .filter((email) => email && activeEmails.has(email))
  );
  return findInvalidEnrollmentOwnership(values, activeEmails, selectedAgentEmails);
}

export function enrollmentOwnershipFieldLabel(field: EnrollmentOwnershipField): string {
  switch (field) {
    case "agent_email":
      return "Agent";
    case "caller_email":
      return "Caller";
    case "responsible_enroll_email":
      return "Responsible enroll";
  }
}

function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}
