export const ENROLLMENT_PROGRAMS = ["aca", "medicare"] as const;
export type EnrollmentProgram = (typeof ENROLLMENT_PROGRAMS)[number];

export const ENROLLMENT_PROGRAM_LABELS: Record<EnrollmentProgram, string> = {
  aca: "Health ACA Enroll",
  medicare: "Health Medicare Enrollment",
};

export function isEnrollmentProgram(value: unknown): value is EnrollmentProgram {
  return value === "aca" || value === "medicare";
}

export function toEnrollmentProgram(value: unknown): EnrollmentProgram {
  return isEnrollmentProgram(value) ? value : "aca";
}

export const ENROLLMENT_OPTION_SET_KEYS = [
  "stage",
  "carrier",
  "platform",
  "consent",
  "payment_status",
  "aca_status",
] as const;

export type EnrollmentOptionSetKey = (typeof ENROLLMENT_OPTION_SET_KEYS)[number];

export const ENROLLMENT_OPTION_SET_KEYS_BY_PROGRAM: Record<
  EnrollmentProgram,
  readonly EnrollmentOptionSetKey[]
> = {
  aca: ENROLLMENT_OPTION_SET_KEYS,
  medicare: ["stage", "carrier"],
};

export function enrollmentOptionSetKeysForProgram(
  program: EnrollmentProgram
): readonly EnrollmentOptionSetKey[] {
  return ENROLLMENT_OPTION_SET_KEYS_BY_PROGRAM[program];
}

export type EnrollmentOptionSet = {
  id: string;
  program: EnrollmentProgram;
  key: EnrollmentOptionSetKey;
  label: string;
  is_stage: boolean;
  created_at?: string;
  updated_at?: string;
};

export type EnrollmentOption = {
  id: string;
  set_id: string;
  set_key: EnrollmentOptionSetKey;
  label: string;
  color: string | null;
  position: number;
  is_terminal: boolean;
  triggers_qc: boolean;
  archived_at: string | null;
};

export type EnrollmentRecord = {
  id: string;
  program: EnrollmentProgram;
  client_name: string | null;
  description: string | null;
  fub_link: string | null;
  due_date: string | null;
  stage_id: string | null;
  carrier_id: string | null;
  platform_id: string | null;
  consent_id: string | null;
  payment_status_id: string | null;
  aca_status_id: string | null;
  pcp_2025: string | null;
  pcp_2026: string | null;
  custom_values?: Record<string, unknown>;
  caller_email: string | null;
  responsible_enroll_email: string | null;
  qc_checked_by_email: string | null;
  qc_checked_at: string | null;
  due_soon_notified_at: string | null;
  overdue_notified_at: string | null;
  overdue_reminded_at: string | null;
  qc_stale_notified_at: string | null;
  closed_at: string | null;
  created_by_email: string;
  created_at: string;
  updated_by_email: string | null;
  updated_at: string;
  archived_at: string | null;
};

export type EnrollmentRecordWithStats = EnrollmentRecord & {
  comment_count: number;
  attachment_count: number;
  comment_search_text?: string;
};

export type EnrollmentPerson = {
  email: string;
  name: string | null;
  agent_id?: string | null;
};

export type EnrollmentActivityRow = {
  id: string;
  actor_email: string;
  type: string;
  meta: Record<string, unknown> | null;
  created_at: string;
};

export type EnrollmentSignedAttachment = {
  id: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  url: string;
};

export type EnrollmentCommentWithAttachments = Record<string, unknown> & {
  id: string;
  attachments: EnrollmentSignedAttachment[];
};

export type EnrollmentDetail = {
  comments: EnrollmentCommentWithAttachments[];
  activity: EnrollmentActivityRow[];
  attachments: EnrollmentSignedAttachment[];
};

export type EnrollmentNotificationType =
  | "assigned"
  | "mentioned"
  | "commented"
  | "due_soon"
  | "overdue"
  | "overdue_reminder"
  | "qc_needed"
  | "qc_stale"
  | "reopened"
  | "stage_changed"
  | "qc_reviewed"
  | "attachment_added";
