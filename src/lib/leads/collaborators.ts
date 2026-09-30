const EMAIL_RE = /^[^\s@]+@[^\s@]+$/;
const MAX_COLLABORATORS = 50;

export type CollaboratorEmailsResult =
  | { ok: true; emails: string[] }
  | { ok: false; error: string };

/** Normalize a lead's independent collaborator list. */
export function parseCollaboratorEmails(value: unknown): CollaboratorEmailsResult {
  if (value === undefined || value === null) return { ok: true, emails: [] };
  if (!Array.isArray(value)) {
    return { ok: false, error: "Collaborators must be a list of email addresses." };
  }
  if (value.length > MAX_COLLABORATORS) {
    return { ok: false, error: `A lead can have at most ${MAX_COLLABORATORS} collaborators.` };
  }

  const emails: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      return { ok: false, error: "Each collaborator must be a valid email address." };
    }
    const email = item.trim().toLowerCase();
    if (!EMAIL_RE.test(email) || email.length > 320) {
      return { ok: false, error: "Each collaborator must be a valid email address." };
    }
    if (!emails.includes(email)) emails.push(email);
  }
  return { ok: true, emails };
}

export function hasLeadCollaborator(
  emails: readonly string[] | null | undefined,
  actorEmail: string,
): boolean {
  const normalizedActor = actorEmail.trim().toLowerCase();
  return Boolean(normalizedActor) && (emails ?? []).some(
    (email) => email.trim().toLowerCase() === normalizedActor,
  );
}
